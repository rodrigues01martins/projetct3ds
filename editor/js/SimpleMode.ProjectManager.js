// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Identidade do projeto ativo, salvamento automático, transições seguras entre projetos, versões, recuperação,
// migração do estado antigo e prevenção de conflitos entre abas. Reutiliza o editor original (Editor.toJSON/fromJSON).
//
// Identidade: o gerenciador guarda o projeto ativo; toda serialização (Editor.toJSON — arquivo exportado, estado de
// trabalho do editor, biblioteca, versões) recebe scene.userData.project3ds.project = { id, version } por um envoltório,
// sem alterar Editor.js. Cenas abertas por outros caminhos (Modo Avançado) ficam "sem projeto" até serem registradas
// com um ID NOVO — nunca adotam o ID de um arquivo, para não sobrescrever um projeto da biblioteca.
//
// Salvamento automático (2,5 s após a última alteração confirmada; um único temporizador do gerenciador):
//   - projeto registrado + "Salvar automaticamente" ligado → grava o estado atual (revisão + 1, controle otimista);
//   - desligado → grava só um rascunho de recuperação (o estado salvo muda apenas em "Salvar projeto");
//   - cena nova sem projeto → registra o projeto (UUID novo) na primeira gravação.
//   Gravações nunca são concorrentes; uma gravação iniciada antes de uma troca de projeto é descartada (época).
//   O salvamento nativo do editor (index.html) é suspenso durante transições e refeito em seguida.
//
// Transições (abrir, novo, importar, modelo, restaurar, recuperar): sequenciais e com bloqueio; o conteúdo novo é
// validado e pré-carregado ANTES de Editor.clear(); a cena atual vira cópia de recuperação e volta se algo falhar.

import * as THREE from 'three';

import { ProjectStorage, StorageError } from './SimpleMode.ProjectStorage.js';
import { PROJECT_LIMITS, DEFAULT_NAME, newProjectId, cleanName, uniqueName, createRecord, parseState, projectMetaOf, withProjectMeta, contentKey, digest, byteSize, cleanText } from './SimpleMode.ProjectData.js';
import { captureThumbnail } from './SimpleMode.ProjectThumbnails.js';

const AUTOSAVE_DELAY = 2500;
const NATIVE_BASE_KEY = 'project3ds-native-base';
const THUMBNAIL_INTERVAL = 120000;
const AUTO_VERSION_CHECK = 60000;
const CHANGE_SIGNALS = [ 'sceneGraphChanged', 'geometryChanged', 'objectAdded', 'objectRemoved', 'objectChanged', 'materialChanged', 'historyChanged', 'sceneBackgroundChanged', 'sceneEnvironmentChanged', 'sceneFogChanged', 'scriptChanged' ];

function ProjectManager( editor, context ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const storage = ProjectStorage();
	const changed = new Signal(); // identidade/estado de salvamento
	const libraryChanged = new Signal(); // lista de projetos/versões
	const session = THREE.MathUtils.generateUUID();
	const config = editor.config;

	const state = {
		ready: false,
		available: true,
		active: null, // registro do projeto ativo (cópia do banco)
		transitioning: true, // até a inicialização terminar nada é gravado
		epoch: 0,
		counter: 0,
		savedCounter: 0,
		status: 'idle', // idle | unregistered | pending | draft | saving | saved | error | conflict | loading
		error: null,
		saving: null,
		saveAgain: false,
		timer: 0,
		detached: 'new', // motivo de cena sem projeto: new | external | declined | deleted
		lastThumbnailAt: 0,
		lastAutoVersionAt: Date.now(),
		counterAtAutoVersion: 0,
		pendingRecovery: null, // { projectId, draft }
		pendingMigration: null, // { contentHash, title }
		remote: null, // { revision } salvo por outra aba
		conflictOpen: false,
		capturedOnFailure: null, // texto da cena anterior quando a gravação de saída falhou
		lastSaved: { id: null, revision: 0 } // última revisão gravada por esta aba (mesmo após troca de projeto)
	};

	let nativeSave = () => {};

	const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel( 'project3ds-projects' ) : null;

	const autosaveEnabled = () => config.getKey( 'projects/autosave' ) !== false;
	const autoVersionMinutes = () => {

		const value = Number( config.getKey( 'projects/autoVersionMinutes' ) );
		return Number.isFinite( value ) && value > 0 ? value : 15;

	};

	const hasContent = () => editor.scene.children.length > 0;
	const isDirty = () => state.counter !== state.savedCounter;
	const ask = ( options ) => ( context.dialog !== undefined ? context.dialog.ask( options ) : Promise.resolve( options.cancel || 'cancel' ) );
	const notify = ( message, type ) => context.notify( message, type );

	function setStatus( status, error = null ) {

		state.status = status;
		state.error = error;
		changed.dispatch();

	}

	function refreshStatus() {

		if ( state.transitioning ) return setStatus( 'loading' );
		if ( state.saving !== null ) return setStatus( 'saving' );
		if ( state.status === 'conflict' || state.status === 'error' ) return changed.dispatch();
		if ( state.active === null ) return setStatus( hasContent() || isDirty() ? 'unregistered' : 'idle' );
		setStatus( isDirty() ? ( autosaveEnabled() ? 'pending' : 'draft' ) : 'saved' );

	}

	// envoltórios no editor (sem alterar Editor.js) ----------------------------------------------------------------

	const baseToJSON = editor.toJSON.bind( editor );
	editor.toJSON = function () {

		// base do estado de trabalho: em qual revisão salva ele se apoia (decide, no próximo início, entre retomar o
		// trabalho direto ou oferecê-lo como rascunho). Fica fora do JSON para não alterar exportações nem o hash
		writeNativeBase( state.active !== null ? { id: state.active.id, revision: state.active.revision } : null );
		return withProjectMeta( baseToJSON(), state.active !== null ? { id: state.active.id } : null );

	};

	function writeNativeBase( base ) {

		try {

			if ( base === null ) localStorage.removeItem( NATIVE_BASE_KEY );
			else localStorage.setItem( NATIVE_BASE_KEY, JSON.stringify( base ) );

		} catch ( error ) { /* armazenamento indisponível: cai no caminho do rascunho */ }

	}

	function readNativeBase() {

		try {

			const base = JSON.parse( localStorage.getItem( NATIVE_BASE_KEY ) );
			return base && typeof base.id === 'string' && Number.isFinite( base.revision ) ? base : null;

		} catch ( error ) {

			return null;

		}

	}

	const baseClear = editor.clear.bind( editor );
	editor.clear = function () {

		// limpeza fora de uma transição (Modo Avançado, carregamento por URL): protege o trabalho e desvincula a cena
		if ( state.transitioning === false ) protectBeforeExternalClear();
		baseClear();
		if ( state.transitioning === false ) detach( 'external' );

	};

	// todo carregamento (inclusive a restauração de segurança feita por outros módulos a partir de editor.toJSON) deixa a
	// identidade só no gerenciador: a cena viva nunca carrega o ID do projeto
	const baseFromJSON = editor.fromJSON.bind( editor );
	editor.fromJSON = async function ( json ) {

		await baseFromJSON( json );
		stripSceneMeta();

	};

	function stripSceneMeta() {

		const meta = editor.scene.userData.project3ds;
		if ( meta !== undefined && meta !== null && meta.project !== undefined ) {

			const copy = Object.assign( {}, meta );
			delete copy.project;
			if ( Object.keys( copy ).length > 0 ) editor.scene.userData.project3ds = copy;
			else delete editor.scene.userData.project3ds;

		}

	}

	function detach( reason ) {

		clearTimeout( state.timer );
		state.epoch ++;
		state.active = null;
		state.detached = reason;
		state.counter = 0;
		state.savedCounter = 0;
		state.remote = null;
		state.pendingRecovery = null;
		storage.setMeta( 'active', null ).catch( () => {} );
		refreshStatus();

	}

	// serialização ------------------------------------------------------------------------------------------------------

	async function serialize() {

		const json = editor.toJSON();
		const data = JSON.stringify( json );
		const [ hash, contentHash ] = await Promise.all( [ digest( data ), digest( contentKey( json ) ) ] );
		return { json, data, hash, contentHash, size: byteSize( data ), savedAt: Date.now() };

	}

	function thumbnailIfDue( force = false ) {

		if ( force === false && Date.now() - state.lastThumbnailAt < THUMBNAIL_INTERVAL ) return undefined;
		const thumbnail = captureThumbnail( editor );
		if ( thumbnail !== null ) state.lastThumbnailAt = Date.now();
		return thumbnail !== null ? thumbnail : undefined;

	}

	function broadcast( message ) {

		if ( channel !== null ) try {

			channel.postMessage( Object.assign( { session }, message ) );

		} catch ( error ) { /* canal indisponível */ }

	}

	// registro de projetos -----------------------------------------------------------------------------------------------

	async function existingNames() {

		return ( await storage.listProjects() ).filter( ( p ) => p.deletedAt === null ).map( ( p ) => p.name );

	}

	function templateOfScene() {

		const meta = editor.scene.userData.project3ds;
		return meta !== undefined && meta !== null && meta.template !== undefined ? { id: meta.template.id, name: meta.template.name } : null;

	}

	// registra a cena atual como projeto NOVO (UUID próprio) e grava seu primeiro estado
	async function registerCurrent( { name = config.getKey( 'project/title' ), sourceTemplate = templateOfScene(), description = '', initialVersion = null } = {} ) {

		const epoch = state.epoch;
		const id = newProjectId();
		// o título escolhido pelo usuário (ou vindo do arquivo/modelo) é mantido como está: nomes iguais são permitidos,
		// cada projeto tem seu próprio ID — renomear sozinho mudaria o nome do arquivo exportado e o título da janela
		const record = createRecord( { id, name: cleanName( name ), description, sourceTemplate } );

		if ( epoch !== state.epoch ) return null;

		const previous = state.active;
		state.active = record; // a serialização já leva o ID novo
		const counter = state.counter;
		let snapshot;

		try {

			snapshot = await serialize();

		} catch ( error ) {

			state.active = previous;
			throw error;

		}

		snapshot.thumbnail = thumbnailIfDue( true );
		if ( snapshot.thumbnail !== undefined ) record.thumbnail = snapshot.thumbnail;

		const version = initialVersion !== null ? { meta: versionMeta( id, initialVersion.name, initialVersion.kind || 'manual', snapshot ) } : null;

		try {

			const saved = await storage.createProject( record, snapshot, version );
			if ( epoch !== state.epoch ) return saved;

			state.active = saved;
			state.savedCounter = counter;
			state.detached = null;
			state.lastAutoVersionAt = Date.now();
			state.counterAtAutoVersion = counter;
			applyTitle( saved.name );
			await storage.setMeta( 'active', saved.id );
			broadcast( { type: 'created', id: saved.id } );
			setStatus( 'idle' );
			refreshStatus();
			libraryChanged.dispatch();
			return saved;

		} catch ( error ) {

			if ( state.active === record ) state.active = previous;
			setStatus( 'error', error.message );
			throw error;

		}

	}

	function applyTitle( name ) {

		config.setKey( 'project/title', name );
		if ( context.setProjectTitle !== undefined ) context.setProjectTitle( name );

	}

	// salvamento ----------------------------------------------------------------------------------------------------------

	// Grava o estado atual do projeto ativo (ou registra a cena). reason: auto | manual | switch | version
	function save( reason = 'manual' ) {

		if ( state.transitioning ) return Promise.resolve( false );

		if ( state.saving !== null ) {

			state.saveAgain = true;
			return state.saving;

		}

		state.saving = doSave( reason ).finally( () => {

			state.saving = null;
			refreshStatus();

			if ( state.saveAgain ) {

				state.saveAgain = false;
				if ( isDirty() && state.active !== null ) schedule();

			}

		} );

		refreshStatus();
		return state.saving;

	}

	async function doSave( reason ) {

		clearTimeout( state.timer );

		if ( state.active === null ) {

			if ( state.detached === 'deleted' || state.detached === 'declined' && reason === 'auto' ) return false;
			if ( hasContent() === false && reason === 'auto' ) return false;

			try {

				await registerCurrent();
				return true;

			} catch ( error ) {

				reportError( error );
				return false;

			}

		}

		const epoch = state.epoch;
		const project = state.active;
		const counter = state.counter;

		try {

			const snapshot = await serialize();
			if ( epoch !== state.epoch ) return false; // outro projeto foi aberto durante a serialização

			if ( snapshot.contentHash === project.contentHash && reason === 'auto' ) {

				state.savedCounter = counter; // nada mudou de fato: não grava um estado idêntico
				return true;

			}

			const thumbnail = thumbnailIfDue( reason !== 'auto' );
			const saved = await storage.saveState( project.id, project.revision, snapshot, thumbnail !== undefined ? { thumbnail } : {} );
			state.lastSaved = { id: saved.id, revision: saved.revision };
			if ( epoch !== state.epoch ) return true;

			state.active = saved;
			state.savedCounter = counter;
			state.remote = null;
			if ( state.status === 'error' ) state.status = 'idle';
			broadcast( { type: 'saved', id: saved.id, revision: saved.revision } );
			libraryChanged.dispatch();
			checkAutoVersion();
			return true;

		} catch ( error ) {

			if ( epoch !== state.epoch ) return false;
			reportError( error );
			return false;

		}

	}

	function reportError( error ) {

		const storageError = error instanceof StorageError ? error : null;

		if ( storageError !== null && storageError.code === 'conflict' ) {

			setStatus( 'conflict', storageError.message );
			resolveConflict();
			return;

		}

		if ( storageError !== null && ( storageError.code === 'deleted' || storageError.code === 'missing' ) ) {

			notify( storageError.message, 'warning' );
			detach( 'deleted' );
			return;

		}

		console.error( error );
		setStatus( 'error', error.message || 'Falha ao salvar.' );
		notify( ( storageError !== null && storageError.code === 'quota' ) ? error.message : 'Erro ao salvar o projeto no navegador: ' + ( error.message || '' ), 'error' );

	}

	// rascunho de recuperação (salvamento automático desligado ou gravação recusada)
	async function writeDraft() {

		if ( state.active === null || state.transitioning ) return false;

		const epoch = state.epoch;
		const project = state.active;

		try {

			const snapshot = await serialize();
			if ( epoch !== state.epoch ) return false;
			await storage.putDraft( { projectId: project.id, data: snapshot.data, contentHash: snapshot.contentHash, baseRevision: project.revision, savedAt: snapshot.savedAt, session, dismissed: false } );
			refreshStatus();
			return true;

		} catch ( error ) {

			setStatus( 'error', error.message );
			return false;

		}

	}

	function schedule() {

		clearTimeout( state.timer );
		state.timer = setTimeout( () => {

			if ( state.transitioning ) return;
			if ( state.active !== null && autosaveEnabled() === false ) writeDraft();
			else if ( state.status !== 'conflict' ) save( 'auto' );

		}, AUTOSAVE_DELAY );

	}

	function onChange() {

		if ( state.transitioning ) return;
		state.counter ++;
		schedule();
		if ( state.status !== 'saving' ) refreshStatus();

	}

	for ( const name of CHANGE_SIGNALS ) editor.signals[ name ].add( onChange );

	// limpeza externa: grava o que estiver pendente com o texto capturado AGORA (antes de a cena sumir)
	function protectBeforeExternalClear() {

		if ( isDirty() === false && state.active !== null ) return false;
		if ( hasContent() === false ) return false;
		if ( state.active === null && ( state.detached === 'deleted' || state.detached === 'declined' || isDirty() === false ) ) return false;

		clearTimeout( state.timer );
		const json = editor.toJSON();
		const data = JSON.stringify( json );
		const project = state.active;
		const inflight = state.saving;

		( async () => {

			const snapshot = { data, hash: await digest( data ), contentHash: await digest( contentKey( json ) ), size: byteSize( data ), savedAt: Date.now() };

			try {

				if ( inflight !== null ) await inflight.catch( () => {} );
				const revision = project !== null && state.lastSaved.id === project.id ? Math.max( project.revision, state.lastSaved.revision ) : ( project !== null ? project.revision : 0 );
				if ( project !== null ) state.lastSaved = { id: project.id, revision: ( await storage.saveState( project.id, revision, snapshot ) ).revision };
				else {

					const record = createRecord( { name: cleanName( json.project && json.project.title ) || DEFAULT_NAME } );
					await storage.createProject( record, Object.assign( snapshot, { data: JSON.stringify( withProjectMeta( JSON.parse( data ), record ) ) } ) );

				}

				libraryChanged.dispatch();

			} catch ( error ) {

				state.capturedOnFailure = data;
				notify( 'Não foi possível guardar as alterações da cena anterior. Use "Meus projetos" → exportar a cópia mantida em memória.', 'error' );

			}

		} )();

		return true;

	}

	// transições ----------------------------------------------------------------------------------------------------------

	// Antes de trocar de projeto: grava ou pergunta. Retorna false se o usuário cancelar.
	async function settleCurrent() {

		clearTimeout( state.timer );
		if ( state.saving !== null ) await state.saving.catch( () => {} );
		if ( hasContent() === false || isDirty() === false && state.active !== null ) return true;
		if ( state.active === null && state.detached === 'deleted' ) return true;
		if ( state.active === null && isDirty() === false && state.detached !== 'declined' ) return true;

		// projeto registrado com salvamento automático (ou cena nova): grava sem perguntar
		if ( state.detached !== 'declined' && ( state.active === null || autosaveEnabled() ) ) {

			const ok = await save( 'switch' );
			if ( ok && isDirty() === false ) return true;

		}

		const choice = await ask( {
			title: 'Alterações pendentes',
			message: state.active !== null ? `O projeto "${state.active.name}" tem alterações que ainda não foram salvas neste navegador.` : 'A cena atual não está salva em "Meus projetos".',
			choices: [ { id: 'save', label: state.active !== null ? 'Salvar e continuar' : 'Salvar em Meus projetos e continuar', kind: 'primary' }, { id: 'export', label: 'Exportar cópia' }, { id: 'cancel', label: 'Cancelar' } ]
		} );

		if ( choice === 'save' ) {

			if ( state.active === null ) {

				state.detached = 'new';
				try {

					await registerCurrent();

				} catch ( error ) {

					reportError( error );
					return false;

				}

				return true;

			}

			return ( await save( 'manual' ) ) && isDirty() === false;

		}

		if ( choice === 'export' ) {

			exportCurrent();
			return true;

		}

		return false;

	}

	function exportCurrent() {

		const json = editor.toJSON();
		json.project.title = config.getKey( 'project/title' ) || '';
		const name = ( json.project.title || 'projeto' ).trim().normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[\\/:*?"<>|]+/g, '' ).replace( /\s+/g, '-' ) || 'projeto';
		editor.utils.save( new Blob( [ JSON.stringify( json ) ], { type: 'application/json' } ), name + '.json' );

	}

	// pré-carregamento: interpreta a cena num objeto descartável para detectar arquivos corrompidos antes de limpar
	async function preflight( json ) {

		const loader = new THREE.ObjectLoader();
		await loader.parseAsync( json.scene );
		await loader.parseAsync( json.camera );

	}

	let busyNotice = 0;

	function busy() {

		if ( state.transitioning ) {

			if ( Date.now() - busyNotice > 1500 ) notify( 'Aguarde: outra operação de projeto está em andamento.', 'warning' );
			busyNotice = Date.now();
			return true;

		}

		return false;

	}

	// prepare(): { json, project (registro ou null), title, dirty } — chamado DEPOIS de liberar o projeto atual
	async function transition( prepare, { settle = true, onLoaded = null } = {} ) {

		if ( busy() ) return false;

		if ( settle && ( await settleCurrent() ) === false ) return false;
		if ( busy() ) return false;

		state.transitioning = true;
		clearTimeout( state.timer );
		refreshStatus();

		let prepared;

		try {

			prepared = await prepare();
			if ( prepared.json !== null ) await preflight( prepared.json );

		} catch ( error ) {

			state.transitioning = false;
			refreshStatus();
			notify( error.message || 'Não foi possível abrir o projeto.', 'error' );
			return false;

		}

		const previous = { data: JSON.stringify( baseToJSON() ), active: state.active, detached: state.detached, title: config.getKey( 'project/title' ) };

		try {

			state.epoch ++;
			baseClear();
			if ( prepared.json !== null ) await editor.fromJSON( prepared.json );
			stripSceneMeta();
			state.active = prepared.project;
			state.detached = prepared.project !== null ? null : ( prepared.detached || 'new' );
			state.pendingRecovery = null;
			state.remote = null;
			applyTitle( prepared.title || ( prepared.project !== null ? prepared.project.name : DEFAULT_NAME ) );

		} catch ( error ) {

			console.error( error );

			try {

				baseClear();
				await editor.fromJSON( JSON.parse( previous.data ) );
				stripSceneMeta();

			} catch ( restoreError ) {

				console.error( restoreError );

			}

			state.active = previous.active;
			state.detached = previous.detached;
			applyTitle( previous.title || '' );
			state.transitioning = false;
			refreshStatus();
			nativeSave();
			notify( 'Não foi possível carregar o projeto. O projeto anterior foi mantido.', 'error' );
			return false;

		}

		state.counter = prepared.dirty ? 1 : 0;
		state.savedCounter = 0;
		state.lastAutoVersionAt = Date.now();
		state.counterAtAutoVersion = state.counter;
		state.status = 'idle';
		state.transitioning = false;

		if ( state.active !== null ) {

			storage.setMeta( 'active', state.active.id ).catch( () => {} );
			storage.updateProject( state.active.id, { lastOpenedAt: Date.now() } ).then( ( saved ) => {

				if ( state.active !== null && state.active.id === saved.id ) state.active = Object.assign( {}, state.active, { lastOpenedAt: saved.lastOpenedAt } );

			} ).catch( () => {} );

		} else {

			storage.setMeta( 'active', null ).catch( () => {} );

		}

		nativeSave();
		if ( onLoaded !== null ) await onLoaded();
		if ( prepared.dirty ) schedule();
		refreshStatus();
		libraryChanged.dispatch();
		return true;

	}

	async function loadProjectState( id ) {

		const project = await storage.getProject( id );
		if ( project === undefined ) throw new Error( 'O projeto não existe mais neste navegador.' );
		if ( project.deletedAt !== null ) throw new Error( 'O projeto está na lixeira. Restaure-o antes de abrir.' );
		const record = await storage.getState( id );
		if ( record === undefined ) throw new Error( 'O estado salvo do projeto não foi encontrado.' );
		const parsed = parseState( record.data );
		if ( parsed.error !== null ) throw new Error( 'O projeto salvo está corrompido: ' + parsed.error + ' Nada foi alterado.' );
		return { project, stateRecord: record, json: parsed.json };

	}

	async function checkDraft( projectId, stateRecord ) {

		const draft = await storage.getDraft( projectId );
		if ( draft !== undefined && draft.dismissed !== true && draft.contentHash !== stateRecord.contentHash ) {

			state.pendingRecovery = { projectId, draft: { savedAt: draft.savedAt, session: draft.session } };
			changed.dispatch();

		}

	}

	// operações públicas ---------------------------------------------------------------------------------------------------

	// discardCurrent: só quando o estado atual já foi preservado (ex.: ponto de recuperação antes de uma substituição)
	function openProject( id, { discardCurrent = false } = {} ) {

		let stateRecord = null;
		return transition( async () => {

			const loaded = await loadProjectState( id );
			stateRecord = loaded.stateRecord;
			return { json: loaded.json, project: loaded.project, title: loaded.project.name };

		}, { settle: discardCurrent === false, onLoaded: () => checkDraft( id, stateRecord ) } );

	}

	// Novo projeto em branco. Caminho rápido (salvamento automático ligado): a cena atual é capturada agora e gravada
	// em segundo plano, e a cena é limpa imediatamente. Sem salvamento automático, pergunta antes (settleCurrent).
	// O novo projeto recebe UUID próprio ao ser criado pela galeria (com nome) ou na primeira gravação.
	async function newBlank( { name = null } = {} ) {

		if ( busy() ) return false;

		const fast = state.detached !== 'declined' && ( state.active === null || autosaveEnabled() ) && state.status !== 'conflict';
		let ok;

		if ( fast ) {

			protectBeforeExternalClear();
			state.transitioning = true;
			state.epoch ++;
			baseClear();
			state.active = null;
			state.detached = 'new';
			state.pendingRecovery = null;
			state.remote = null;
			state.counter = 0;
			state.savedCounter = 0;
			state.status = 'idle';
			state.transitioning = false;
			applyTitle( name || '' );
			storage.setMeta( 'active', null ).catch( () => {} );
			nativeSave();
			refreshStatus();
			ok = true;

		} else {

			ok = await transition( async () => ( { json: null, project: null, title: name || '', detached: 'new' } ) );

		}

		if ( ok && name !== null ) {

			try {

				await registerCurrent( { name, sourceTemplate: null } );

			} catch ( error ) {

				reportError( error );

			}

		}

		return ok;

	}

	// importa um arquivo JSON do editor como projeto NOVO (nunca sobrescreve um projeto de mesmo ID)
	async function importJSON( json, title ) {

		const parsed = parseState( json );
		if ( parsed.error !== null ) {

			notify( parsed.error, 'error' );
			return false;

		}

		const ok = await transition( async () => ( { json: parsed.json, project: null, title, detached: 'new' } ) );
		if ( ok ) {

			try {

				await registerCurrent( { name: title } );

			} catch ( error ) {

				reportError( error );

			}

		}

		return ok;

	}

	// modelo pronto (EV-005): a fábrica limpa e monta a cena; ao final o resultado vira um projeto independente
	async function applyTemplate( run, template ) {

		if ( busy() ) return false;
		if ( ( await settleCurrent() ) === false ) return false;

		const previous = { active: state.active, detached: state.detached };
		state.transitioning = true;
		state.epoch ++;
		refreshStatus();

		try {

			await run();

		} catch ( error ) {

			state.active = previous.active;
			state.detached = previous.detached;
			state.transitioning = false;
			refreshStatus();
			throw error;

		}

		stripSceneMeta();
		state.active = null;
		state.detached = 'new';
		state.counter = 0;
		state.savedCounter = 0;
		state.transitioning = false;
		nativeSave();

		try {

			await registerCurrent( { name: template.name, sourceTemplate: { id: template.id, name: template.name } } );

		} catch ( error ) {

			reportError( error );

		}

		return true;

	}

	function versionMeta( projectId, name, kind, snapshot ) {

		return {
			id: THREE.MathUtils.generateUUID(),
			projectId,
			name: cleanText( name, PROJECT_LIMITS.versionName ) || 'Versão',
			kind,
			pinned: false,
			createdAt: snapshot.savedAt,
			size: snapshot.size,
			hash: snapshot.hash,
			contentHash: snapshot.contentHash,
			thumbnail: snapshot.thumbnail || null
		};

	}

	// Salvar versão (snapshot imutável do estado atual); grava antes o estado do projeto
	async function createVersion( name, { kind = 'manual', skipIdentical = kind !== 'manual' } = {} ) {

		if ( busy() ) return null;

		if ( state.active === null ) {

			try {

				await registerCurrent();

			} catch ( error ) {

				reportError( error );
				return null;

			}

		} else if ( isDirty() && autosaveEnabled() ) {

			await save( 'version' );

		}

		if ( state.active === null ) return null;

		const project = state.active;
		const snapshot = await serialize();

		if ( skipIdentical ) {

			const versions = await storage.listVersions( project.id );
			const latest = versions.sort( ( a, b ) => b.number - a.number )[ 0 ];
			if ( latest !== undefined && latest.contentHash === snapshot.contentHash ) return null;

		}

		snapshot.thumbnail = captureThumbnail( editor ) || null;

		try {

			const { version } = await storage.addVersion( versionMeta( project.id, name, kind, snapshot ), snapshot.data, { keep: { auto: PROJECT_LIMITS.autoVersions, recovery: PROJECT_LIMITS.recoveryVersions } } );
			if ( kind === 'auto' ) {

				state.lastAutoVersionAt = Date.now();
				state.counterAtAutoVersion = state.counter;

			}

			libraryChanged.dispatch();
			return version;

		} catch ( error ) {

			reportError( error );
			return null;

		}

	}

	// pontos automáticos de segurança: só com alterações reais e após o intervalo mínimo
	function checkAutoVersion() {

		if ( state.active === null || state.transitioning ) return;
		if ( state.counter === state.counterAtAutoVersion ) return;
		if ( Date.now() - state.lastAutoVersionAt < autoVersionMinutes() * 60000 ) return;
		createVersion( 'Automática — ' + new Date().toLocaleString( 'pt-BR' ), { kind: 'auto' } );

	}

	setInterval( checkAutoVersion, AUTO_VERSION_CHECK );

	// ponto de recuperação de um projeto (do estado vivo se ativo; senão do estado salvo)
	async function recoveryPoint( projectId, name ) {

		if ( state.active !== null && state.active.id === projectId ) return createVersion( name, { kind: 'recovery', skipIdentical: false } );

		const record = await storage.getState( projectId );
		if ( record === undefined ) return null;
		const meta = versionMeta( projectId, name, 'recovery', { savedAt: Date.now(), size: byteSize( record.data ), hash: record.hash, contentHash: record.contentHash } );
		const { version } = await storage.addVersion( meta, record.data, { keep: { recovery: PROJECT_LIMITS.recoveryVersions } } );
		return version;

	}

	// Restaurar: ponto de recuperação do estado atual → valida → carrega com o MESMO ID → grava como estado atual
	async function restoreVersion( versionId ) {

		if ( busy() ) return false;

		const versions = await storage.listAllVersions();
		const version = versions.find( ( v ) => v.id === versionId );
		if ( version === undefined ) {

			notify( 'A versão não existe mais.', 'error' );
			return false;

		}

		const data = await storage.getVersionData( versionId );
		const parsed = parseState( data );
		if ( parsed.error !== null ) {

			notify( 'A versão está corrompida e não foi restaurada. O projeto atual não foi alterado.', 'error' );
			return false;

		}

		const project = await storage.getProject( version.projectId );
		if ( project === undefined || project.deletedAt !== null ) {

			notify( 'O projeto desta versão não está disponível.', 'error' );
			return false;

		}

		const isActive = state.active !== null && state.active.id === project.id;
		if ( isActive === false && ( await settleCurrent() ) === false ) return false;

		try {

			await recoveryPoint( project.id, `Antes de restaurar a versão ${version.number}` );

		} catch ( error ) {

			reportError( error );
			return false;

		}

		const ok = await transition( async () => ( { json: parsed.json, project: await storage.getProject( project.id ), title: project.name, dirty: true } ), { settle: false } );

		if ( ok ) {

			await save( 'manual' );
			notify( `Versão ${version.number} — ${version.name} restaurada. A versão histórica foi mantida.`, 'success' );

		}

		return ok;

	}

	// cópia independente (novo UUID). Os UUIDs internos dos objetos são mantidos — os projetos nunca se misturam numa
	// mesma cena — e assim aberturas (fixtureUuid), pisos da planta e itens do orçamento continuam válidos.
	async function createCopy( data, name, sourceTemplate, note ) {

		const parsed = parseState( data );
		if ( parsed.error !== null ) throw new Error( 'O conteúdo de origem está corrompido: ' + parsed.error );

		const record = createRecord( { name: uniqueName( cleanName( name ), await existingNames() ), sourceTemplate } );
		const json = withProjectMeta( parsed.json, { id: record.id } );
		const text = JSON.stringify( json );
		const snapshot = { data: text, hash: await digest( text ), contentHash: await digest( contentKey( json ) ), size: byteSize( text ), savedAt: Date.now() };
		const saved = await storage.createProject( record, snapshot, { meta: versionMeta( record.id, note, 'manual', snapshot ) } );
		libraryChanged.dispatch();
		return saved;

	}

	async function duplicateProject( id ) {

		if ( state.active !== null && state.active.id === id && isDirty() ) await save( 'manual' );
		const project = await storage.getProject( id );
		const record = await storage.getState( id );
		if ( project === undefined || record === undefined ) throw new Error( 'O projeto não existe mais.' );
		const saved = await createCopy( record.data, `${project.name} — Cópia`, project.sourceTemplate, `Criado como cópia de "${project.name}"` );
		if ( project.thumbnail ) await storage.updateProject( saved.id, { thumbnail: project.thumbnail } );
		libraryChanged.dispatch();
		return saved;

	}

	async function copyFromVersion( versionId ) {

		const version = ( await storage.listAllVersions() ).find( ( v ) => v.id === versionId );
		if ( version === undefined ) throw new Error( 'A versão não existe mais.' );
		const project = await storage.getProject( version.projectId );
		const data = await storage.getVersionData( versionId );
		return createCopy( data, `${project ? project.name : 'Projeto'} — Versão ${version.number}`, project ? project.sourceTemplate : null, `Criado a partir da versão ${version.number} — ${version.name}` );

	}

	async function renameProject( id, name ) {

		const clean = cleanName( name, '' );
		if ( clean === '' ) throw new Error( 'Informe um nome para o projeto.' );
		const saved = await storage.updateProject( id, { name: clean } );
		if ( state.active !== null && state.active.id === id ) {

			state.active = Object.assign( {}, state.active, { name: saved.name } );
			applyTitle( saved.name );

		}

		const duplicates = ( await existingNames() ).filter( ( n ) => n.toLocaleLowerCase( 'pt-BR' ) === clean.toLocaleLowerCase( 'pt-BR' ) ).length;
		libraryChanged.dispatch();
		changed.dispatch();
		return { saved, duplicate: duplicates > 1 };

	}

	// título editado no cabeçalho: renomeia o projeto ativo (mesmo ID)
	function renameActive( title ) {

		if ( state.active === null ) return;
		const clean = cleanName( title, '' );
		if ( clean === '' || clean === state.active.name ) return;
		renameProject( state.active.id, clean ).catch( ( error ) => notify( error.message, 'error' ) );

	}

	async function trashProject( id ) {

		await storage.trash( id );
		if ( state.active !== null && state.active.id === id ) detach( 'deleted' );
		broadcast( { type: 'deleted', id } );
		libraryChanged.dispatch();

	}

	async function restoreFromTrash( id ) {

		await storage.untrash( id );
		libraryChanged.dispatch();

	}

	async function deletePermanently( id ) {

		await storage.deleteProject( id );
		if ( state.active !== null && state.active.id === id ) detach( 'deleted' );
		broadcast( { type: 'deleted', id } );
		libraryChanged.dispatch();

	}

	// recuperação -------------------------------------------------------------------------------------------------------------

	async function recoverDraft( projectId ) {

		const draft = await storage.getDraft( projectId );
		if ( draft === undefined ) {

			notify( 'Não há rascunho para recuperar.', 'warning' );
			return false;

		}

		const parsed = parseState( draft.data );
		if ( parsed.error !== null ) {

			notify( 'O rascunho está corrompido e não foi aplicado. O projeto salvo não foi alterado.', 'error' );
			return false;

		}

		const isActive = state.active !== null && state.active.id === projectId;
		const ok = await transition( async () => ( { json: parsed.json, project: await storage.getProject( projectId ), dirty: true } ), { settle: isActive === false } );

		if ( ok ) {

			state.pendingRecovery = null;
			const saved = await save( 'manual' );
			if ( saved === false ) await storage.putDraft( Object.assign( {}, draft, { dismissed: false } ) ).catch( () => {} );
			notify( 'Alterações recuperadas.', 'success' );

		}

		return ok;

	}

	// "Abrir última versão salva": o rascunho é mantido (pode ser recuperado depois em Versões), sem novo aviso
	async function keepSavedVersion( projectId ) {

		const draft = await storage.getDraft( projectId );
		if ( draft !== undefined ) await storage.putDraft( Object.assign( {}, draft, { dismissed: true } ) );
		state.pendingRecovery = null;
		changed.dispatch();
		libraryChanged.dispatch();

	}

	function postponeRecovery() {

		state.pendingRecovery = null; // o aviso volta na próxima abertura (decisão não concluída)
		changed.dispatch();

	}

	async function discardDraft( projectId ) {

		await storage.deleteDraft( projectId );
		if ( state.pendingRecovery !== null && state.pendingRecovery.projectId === projectId ) state.pendingRecovery = null;
		changed.dispatch();
		libraryChanged.dispatch();

	}

	// migração do estado de trabalho anterior à EV-011 (o estado antigo nunca é apagado)
	async function acceptMigration() {

		const migration = state.pendingMigration;
		if ( migration === null ) return null;

		try {

			const saved = await registerCurrent( { name: migration.title || 'Projeto recuperado' } );
			await storage.setMeta( 'migration', { contentHash: migration.contentHash, projectId: saved.id, at: Date.now() } );
			state.pendingMigration = null;
			changed.dispatch();
			notify( `"${saved.name}" foi incorporado a Meus projetos.`, 'success' );
			return saved;

		} catch ( error ) {

			reportError( error );
			return null;

		}

	}

	async function declineMigration() {

		const migration = state.pendingMigration;
		if ( migration === null ) return;
		await storage.setMeta( 'migration', { contentHash: migration.contentHash, declined: true, at: Date.now() } ).catch( () => {} );
		state.pendingMigration = null;
		state.detached = 'declined';
		changed.dispatch();

	}

	// conflitos entre abas ------------------------------------------------------------------------------------------------

	async function resolveConflict() {

		if ( state.conflictOpen || state.active === null ) return;
		state.conflictOpen = true;

		const project = state.active;
		const choice = await ask( {
			title: 'Projeto alterado em outra aba',
			message: `"${project.name}" foi salvo em outra aba ou janela depois que você o abriu. Para não sobrescrever aquele trabalho, escolha como continuar.`,
			choices: [ { id: 'reload', label: 'Recarregar a versão mais recente' }, { id: 'copy', label: 'Salvar minhas alterações como cópia', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ]
		} );

		state.conflictOpen = false;

		if ( choice === 'copy' ) {

			state.status = 'idle';
			state.active = null;
			state.detached = 'new';
			try {

				await registerCurrent( { name: `${project.name} — Cópia (conflito)` } );
				notify( 'Suas alterações foram salvas como um projeto novo.', 'success' );

			} catch ( error ) {

				reportError( error );

			}

			return;

		}

		if ( choice === 'reload' ) {

			// as alterações desta aba viram um ponto de recuperação antes de recarregar (nada é descartado em silêncio)
			try {

				await createVersion( 'Alterações desta aba antes de recarregar (conflito)', { kind: 'recovery', skipIdentical: false } );

			} catch ( error ) { /* segue: a versão é uma proteção extra */ }

			state.status = 'idle';
			await transition( async () => {

				const loaded = await loadProjectState( project.id );
				return { json: loaded.json, project: loaded.project, title: loaded.project.name };

			}, { settle: false } );
			return;

		}

		changed.dispatch(); // continua em conflito: o salvamento automático fica suspenso até uma decisão

	}

	if ( channel !== null ) {

		channel.onmessage = ( event ) => {

			const message = event.data || {};
			if ( message.session === session ) return;
			if ( message.type === 'saved' && state.active !== null && message.id === state.active.id && message.revision > state.active.revision ) {

				state.remote = { revision: message.revision };
				changed.dispatch();

			}

			if ( message.type === 'saved' || message.type === 'created' || message.type === 'deleted' ) libraryChanged.dispatch();

		};

	}

	// inicialização (chamada pelo index.html no lugar do carregamento automático original) -------------------------------

	async function startup( nativeState, { external = false } = {} ) {

		state.transitioning = true;

		try {

			await storage.open();

		} catch ( error ) {

			state.available = false;
			console.warn( 'Gestão de projetos indisponível:', error );
			if ( external === false ) await loadNative( nativeState );
			return finishStartup();

		}

		if ( external ) return finishStartup();

		try {

			const activeId = await storage.getMeta( 'active' );
			const nativeMeta = nativeState !== undefined ? projectMetaOf( nativeState ) : null;
			const candidateId = nativeMeta !== null ? nativeMeta.id : ( nativeState === undefined ? activeId : null );
			let loaded = false;

			if ( candidateId ) {

				const project = await storage.getProject( candidateId );
				const tombstones = await storage.getTombstones();

				if ( project !== undefined && project.deletedAt === null ) {

					const record = await storage.getState( candidateId );
					const parsed = record !== undefined ? parseState( record.data ) : { error: 'sem estado' };

					if ( parsed.error === null ) {

						// o estado de trabalho do editor é mais novo que o salvo?
						//  - apoiado na revisão salva atual e com salvamento automático ligado: é a continuação direta do
						//    trabalho (o recarregamento ocorreu antes do salvamento automático) — retomado e salvo em seguida;
						//  - caso contrário (salvamento automático desligado ou outra aba salvou depois): vira rascunho ANTES
						//    de carregar o salvo, e a decisão fica com o usuário
						let resume = null;
						if ( nativeState !== undefined && nativeMeta !== null ) {

							const nativeContent = await digest( contentKey( nativeState ) );
							const base = readNativeBase();
							if ( nativeContent !== record.contentHash && autosaveEnabled() && base !== null && base.id === candidateId && base.revision === project.revision ) {

								resume = nativeState;

							} else if ( nativeContent !== record.contentHash ) {

								const draft = await storage.getDraft( candidateId );
								if ( draft === undefined || draft.contentHash !== nativeContent ) await storage.putDraft( { projectId: candidateId, data: JSON.stringify( nativeState ), contentHash: nativeContent, baseRevision: project.revision, savedAt: Date.now(), session: 'sessão anterior', dismissed: false } );

							}

						}

						await editor.fromJSON( resume !== null ? resume : parsed.json );
						stripSceneMeta();
						state.active = project;
						state.detached = null;
						state.resumeUnsaved = resume !== null;
						applyTitle( project.name );
						await checkDraft( candidateId, record );
						storage.updateProject( candidateId, { lastOpenedAt: Date.now() } ).then( ( saved ) => {

							if ( state.active !== null && state.active.id === saved.id ) state.active = saved;

						} ).catch( () => {} );
						loaded = true;

					}

				} else if ( ( project !== undefined && project.deletedAt !== null ) || tombstones.includes( candidateId ) ) {

					editor.signals.sceneEnvironmentChanged.dispatch( 'Default' ); // projeto excluído: não é recriado
					state.detached = 'deleted';
					loaded = true;

				}

			}

			if ( loaded === false ) {

				await loadNative( nativeState );

				if ( nativeState !== undefined && hasContent() ) {

					const contentHash = await digest( contentKey( nativeState ) );
					const migration = await storage.getMeta( 'migration' );
					if ( migration === undefined || migration.contentHash !== contentHash ) {

						state.pendingMigration = { contentHash, title: config.getKey( 'project/title' ) || ( nativeState.project && nativeState.project.title ) || '' };

					} else if ( migration.declined ) {

						state.detached = 'declined';

					}

				}

			}

		} catch ( error ) {

			console.error( error );
			if ( hasContent() === false && nativeState !== undefined ) await loadNative( nativeState );

		}

		return finishStartup();

	}

	async function loadNative( nativeState ) {

		if ( nativeState !== undefined ) {

			await editor.fromJSON( nativeState );
			stripSceneMeta();
			if ( state.detached === 'new' ) state.detached = 'external';

		} else {

			editor.signals.sceneEnvironmentChanged.dispatch( 'Default' );

		}

	}

	function finishStartup() {

		state.counter = state.resumeUnsaved ? 1 : 0;
		state.savedCounter = 0;
		state.resumeUnsaved = false;
		state.transitioning = false;
		state.ready = true;
		if ( isDirty() ) schedule();
		if ( state.active !== null ) storage.setMeta( 'active', state.active.id ).catch( () => {} );
		refreshStatus();
		nativeSave();
		libraryChanged.dispatch();
		return state.active;

	}

	// armazenamento --------------------------------------------------------------------------------------------------------

	async function storageReport() {

		const [ projects, versions, drafts ] = await Promise.all( [ storage.listProjects(), storage.listAllVersions(), storage.listDrafts() ] );
		const sizes = new Map( projects.map( ( p ) => [ p.id, { project: p, size: p.size || 0, versions: 0 } ] ) );
		for ( const v of versions ) {

			const entry = sizes.get( v.projectId );
			if ( entry !== undefined ) {

				entry.size += v.size || 0;
				entry.versions ++;

			}

		}

		let estimate = null, persisted = null;
		try {

			if ( navigator.storage && navigator.storage.estimate ) estimate = await navigator.storage.estimate();
			if ( navigator.storage && navigator.storage.persisted ) persisted = await navigator.storage.persisted();

		} catch ( error ) { /* API opcional */ }

		return {
			estimate,
			persisted,
			projects: projects.filter( ( p ) => p.deletedAt === null ).length,
			trashed: projects.filter( ( p ) => p.deletedAt !== null ).length,
			versions: versions.length,
			autoVersions: versions.filter( ( v ) => v.kind === 'auto' && v.pinned !== true ).length,
			drafts: drafts.length,
			largest: [ ...sizes.values() ].sort( ( a, b ) => b.size - a.size ).slice( 0, 5 )
		};

	}

	async function requestPersistence() {

		if ( ! ( navigator.storage && navigator.storage.persist ) ) return null;
		return navigator.storage.persist();

	}

	// exclui versões automáticas não fixadas mais antigas, mantendo as N mais recentes de cada projeto (manuais nunca)
	async function pruneAutoVersions( keep = 2 ) {

		const versions = await storage.listAllVersions();
		const byProject = new Map();
		for ( const v of versions.filter( ( x ) => x.kind === 'auto' && x.pinned !== true ) ) {

			if ( byProject.has( v.projectId ) === false ) byProject.set( v.projectId, [] );
			byProject.get( v.projectId ).push( v );

		}

		let removed = 0;
		for ( const list of byProject.values() ) {

			for ( const v of list.sort( ( a, b ) => b.number - a.number ).slice( keep ) ) {

				await storage.deleteVersion( v.id );
				removed ++;

			}

		}

		libraryChanged.dispatch();
		return removed;

	}

	async function emptyTrash() {

		const trashed = ( await storage.listProjects() ).filter( ( p ) => p.deletedAt !== null );
		for ( const p of trashed ) await storage.deleteProject( p.id );
		libraryChanged.dispatch();
		return trashed.length;

	}

	// atalho Ctrl+S: salvar no navegador
	document.addEventListener( 'keydown', ( event ) => {

		if ( ( event.ctrlKey || event.metaKey ) && event.key.toLowerCase() === 's' && document.body.classList.contains( 'mode-simple' ) ) {

			event.preventDefault();
			save( 'manual' ).then( ( ok ) => ok && notify( 'Projeto salvo neste navegador.', 'success' ) );

		}

	} );

	// ao sair da página com alterações ainda não gravadas, o navegador pede confirmação
	window.addEventListener( 'beforeunload', ( event ) => {

		if ( state.ready && ( state.saving !== null || ( state.active !== null && isDirty() && autosaveEnabled() === false ) ) ) {

			event.preventDefault();
			event.returnValue = '';

		}

	} );

	return {
		storage,
		changed,
		libraryChanged,
		state,
		session,
		startup,
		setNativeSave: ( fn ) => {

			nativeSave = typeof fn === 'function' ? fn : () => {};

		},
		isTransitioning: () => state.transitioning,
		isDirty,
		getActive: () => state.active,
		save,
		writeDraft,
		openProject,
		newBlank,
		importJSON,
		applyTemplate,
		createVersion,
		createRecoveryPoint: recoveryPoint,
		restoreVersion,
		duplicateProject,
		copyFromVersion,
		renameProject,
		renameActive,
		trashProject,
		restoreFromTrash,
		deletePermanently,
		recoverDraft,
		keepSavedVersion,
		postponeRecovery,
		discardDraft,
		acceptMigration,
		declineMigration,
		resolveConflict,
		storageReport,
		requestPersistence,
		pruneAutoVersions,
		emptyTrash,
		exportCurrent,
		checkAutoVersion,
		getCapturedOnFailure: () => state.capturedOnFailure
	};

}

export { ProjectManager, AUTOSAVE_DELAY };
