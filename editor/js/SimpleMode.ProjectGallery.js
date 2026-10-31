// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Interface "Meus projetos": galeria (pesquisa, ordenação, recentes), ações por projeto (abrir, renomear, duplicar,
// versões, exportar, excluir), histórico de versões, lixeira, armazenamento local e importação de backups.
// Toda alteração passa pelo ProjectManager/ProjectStorage; a galeria só lê metadados (nunca carrega cenas para montar
// a lista — as miniaturas são imagens estáticas).

import { exportBackup, readBackup, importAnalyzed } from './SimpleMode.ProjectBackup.js';
import { formatBytes, formatDate, safeFileName, parseState } from './SimpleMode.ProjectData.js';

import { createIcon, createSimpleButton } from './SimpleMode.Icons.js';

const RECENT_DAYS = 7;
const KIND_LABELS = { manual: 'Manual', auto: 'Automática', recovery: 'Ponto de recuperação' };

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function button( label, onClick, { icon, className = '', title } = {} ) {

	const node = createSimpleButton( { icon, label, title: title || label, className, onClick } ).dom;
	return node;

}

function SimpleModeProjectGallery( editor, context, root ) {

	const manager = context.projects;
	const storage = manager.storage;
	const dialog = context.dialog;

	const state = { open: false, tab: 'projects', view: 'list', versionsOf: null, search: '', sort: 'updated', recent: false, importing: null, busy: false };

	const overlay = el( 'div', 'SimpleProjectsOverlay' );
	overlay.id = 'simple-projects';
	overlay.hidden = true;
	root.appendChild( overlay );

	const panel = el( 'div', 'SimpleProjects' );
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-modal', 'true' );
	panel.setAttribute( 'aria-labelledby', 'simple-projects-title' );
	overlay.appendChild( panel );

	const header = el( 'div', 'SimpleProjectsHeader' );
	panel.appendChild( header );
	const title = el( 'h2', 'SimpleProjectsTitle', 'Meus projetos' );
	title.id = 'simple-projects-title';
	header.appendChild( title );

	const tabs = el( 'div', 'SimpleBudgetTabs SimpleProjectsTabs' );
	tabs.setAttribute( 'role', 'tablist' );
	header.appendChild( tabs );
	const tabButtons = {};
	for ( const [ id, label ] of [[ 'projects', 'Projetos' ], [ 'trash', 'Lixeira' ], [ 'storage', 'Armazenamento' ]] ) {

		const tab = el( 'button', 'SimpleBudgetTab', label );
		tab.type = 'button';
		tab.dataset.tab = id;
		tab.setAttribute( 'role', 'tab' );
		tab.addEventListener( 'click', () => {

			state.tab = id;
			state.view = 'list';
			render();

		} );
		tabs.appendChild( tab );
		tabButtons[ id ] = tab;

	}

	header.appendChild( button( 'Fechar', () => close(), { icon: 'close', className: 'SimpleProjectsClose', title: 'Fechar Meus projetos (Esc)' } ) );

	const notice = el( 'p', 'SimpleProjectsNotice', 'Os projetos ficam guardados somente neste navegador, neste perfil e neste endereço do aplicativo. Limpar os dados do site ou trocar de navegador/dispositivo pode torná-los inacessíveis — exporte backups para guardar cópias fora do navegador.' );
	panel.appendChild( notice );

	const body = el( 'div', 'SimpleProjectsBody' );
	panel.appendChild( body );

	const fileInput = el( 'input' );
	fileInput.type = 'file';
	fileInput.accept = '.json,.zip,application/json,application/zip';
	fileInput.hidden = true;
	fileInput.dataset.role = 'project-import';
	overlay.appendChild( fileInput );

	// ações comuns ---------------------------------------------------------------------------------------------------

	async function guarded( work ) {

		if ( state.busy ) return;
		state.busy = true;
		panel.setAttribute( 'aria-busy', 'true' );

		try {

			return await work();

		} catch ( error ) {

			console.error( error );
			context.notify( error.message || 'A operação não pôde ser concluída.', 'error' );

		} finally {

			state.busy = false;
			panel.removeAttribute( 'aria-busy' );

		}

	}

	async function askName( titleText, value, confirmLabel ) {

		const result = await dialog.ask( { title: titleText, input: { label: 'Nome do projeto', value, maxLength: 80 }, choices: [ { id: 'ok', label: confirmLabel, kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		return result.choice === 'ok' ? result.value.trim() : null;

	}

	async function newProject() {

		const name = await askName( 'Novo projeto', '', 'Criar projeto' );
		if ( name === null ) return;
		if ( name === '' ) return context.notify( 'Informe um nome para o projeto.', 'warning' );
		await guarded( async () => {

			if ( await manager.newBlank( { name } ) ) {

				close();
				context.notify( `Projeto "${manager.getActive() ? manager.getActive().name : name}" criado.`, 'success' );

			}

		} );

	}

	async function openProject( project ) {

		await guarded( async () => {

			if ( await manager.openProject( project.id ) ) {

				close();
				context.notify( `Projeto "${project.name}" aberto.`, 'success' );

			}

		} );

	}

	async function rename( project ) {

		const name = await askName( 'Renomear projeto', project.name, 'Renomear' );
		if ( name === null || name === project.name ) return;
		await guarded( async () => {

			const { duplicate } = await manager.renameProject( project.id, name );
			context.notify( duplicate ? 'Projeto renomeado. Já existe outro projeto com esse nome (os dois continuam separados).' : 'Projeto renomeado.', duplicate ? 'warning' : 'success' );
			render();

		} );

	}

	async function duplicate( project ) {

		await guarded( async () => {

			const copy = await manager.duplicateProject( project.id );
			context.notify( `Cópia "${copy.name}" criada.`, 'success' );
			render();

		} );

	}

	async function exportJSON( project ) {

		await guarded( async () => {

			const active = manager.getActive();
			if ( active !== null && active.id === project.id ) return manager.exportCurrent();
			const record = await storage.getState( project.id );
			const json = JSON.parse( record.data );
			json.project = Object.assign( {}, json.project, { title: project.name } );
			editor.utils.save( new Blob( [ JSON.stringify( json ) ], { type: 'application/json' } ), safeFileName( project.name, '.json' ) );

		} );

	}

	function liveState( id ) {

		const active = manager.getActive();
		return active !== null && active.id === id && manager.isDirty() ? JSON.stringify( editor.toJSON() ) : null;

	}

	async function exportZip( ids, withVersions, name ) {

		await guarded( async () => {

			const { blob, manifest } = await exportBackup( storage, ids, { withVersions, getLiveState: liveState } );
			const stamp = new Date().toISOString().slice( 0, 10 );
			editor.utils.save( blob, safeFileName( `${name}-backup-${stamp}`, '.zip' ) );
			context.notify( `Backup com ${manifest.projects.length} projeto(s) exportado.`, 'success' );

		} );

	}

	async function remove( project ) {

		const choice = await dialog.ask( { title: 'Excluir projeto', message: `Mover "${project.name}" para a lixeira? Ele sai da lista principal e pode ser restaurado depois. Outros projetos e "Meus componentes" não são afetados.`, choices: [ { id: 'trash', label: 'Mover para a lixeira', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'trash' ) return;
		await guarded( async () => {

			await manager.trashProject( project.id );
			context.notify( `"${project.name}" foi para a lixeira.`, 'success' );
			render();

		} );

	}

	async function purge( project ) {

		const choice = await dialog.ask( { title: 'Excluir permanentemente', message: `Excluir "${project.name}" e todas as suas versões deste navegador? Esta ação não pode ser desfeita.`, choices: [ { id: 'delete', label: 'Excluir permanentemente', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'delete' ) return;
		await guarded( async () => {

			await manager.deletePermanently( project.id );
			context.notify( `"${project.name}" foi excluído permanentemente.`, 'success' );
			render();

		} );

	}

	// importação: JSON do editor (projeto novo) ou backup .zip (resumo antes de confirmar)
	fileInput.addEventListener( 'change', async () => {

		const file = fileInput.files[ 0 ];
		fileInput.value = '';
		if ( file === undefined ) return;

		if ( /\.zip$/i.test( file.name ) || file.type === 'application/zip' ) {

			await guarded( async () => {

				const analysis = await readBackup( file );
				const existing = new Map( ( await storage.listProjects() ).map( ( p ) => [ p.id, p ] ) );
				state.importing = {
					file: file.name,
					analysis,
					items: analysis.projects.map( ( item ) => {

						const conflict = item.valid && existing.has( item.id ) ? existing.get( item.id ) : null;
						return { item, conflict, mode: item.valid === false ? 'skip' : ( conflict !== null ? 'copy' : 'new' ) };

					} )
				};
				state.tab = 'projects';
				state.view = 'import';
				render();

			} );
			return;

		}

		await guarded( async () => {

			let json;
			try {

				json = JSON.parse( await file.text() );

			} catch ( error ) {

				throw new Error( 'O arquivo não é um JSON válido. Nada foi alterado.' );

			}

			const parsed = parseState( json );
			if ( parsed.error !== null ) throw new Error( parsed.error + ' Nada foi alterado.' );
			const titleText = json.project && typeof json.project.title === 'string' && json.project.title !== '' ? json.project.title : file.name.replace( /\.json$/i, '' );

			if ( await manager.importJSON( json, titleText ) ) {

				close();
				context.notify( `"${manager.getActive() ? manager.getActive().name : titleText}" importado como projeto novo.`, 'success' );

			}

		} );

	} );

	async function confirmImport() {

		const importing = state.importing;
		if ( importing === null ) return;

		await guarded( async () => {

			const results = [];
			const names = ( await storage.listProjects() ).filter( ( p ) => p.deletedAt === null ).map( ( p ) => p.name );
			const active = manager.getActive();
			let replacedActive = false;

			for ( const entry of importing.items ) {

				if ( entry.mode === 'skip' ) {

					results.push( `${entry.item.name}: ignorado${entry.item.valid ? '' : ' (' + entry.item.problems.join( ' ' ) + ')'}` );
					continue;

				}

				try {

					if ( entry.mode === 'replace' ) await manager.createRecoveryPoint( entry.item.id, 'Antes de substituir pela importação de backup' );
					const saved = await importAnalyzed( storage, entry.item, entry.mode, names );
					names.push( saved.name );
					if ( entry.mode === 'replace' && active !== null && active.id === saved.id ) replacedActive = true;
					results.push( `${saved.name}: importado${entry.mode === 'copy' ? ' como cópia' : ( entry.mode === 'replace' ? ' (substituiu o existente; ponto de recuperação criado)' : '' )}${entry.item.problems.length > 0 ? ' — avisos: ' + entry.item.problems.join( ' ' ) : ''}` );

				} catch ( error ) {

					results.push( `${entry.item.name}: falhou — ${error.message}` );

				}

			}

			state.importing = null;
			state.view = 'list';
			manager.libraryChanged.dispatch();
			if ( replacedActive ) await manager.openProject( active.id, { discardCurrent: true } );
			render();
			await dialog.ask( { title: 'Importação concluída', message: `Arquivo ${importing.file}:`, details: results, choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );

		} );

	}

	// renderização --------------------------------------------------------------------------------------------------------

	let renderToken = 0;

	async function render() {

		if ( state.open === false ) return;
		const token = ++ renderToken;

		for ( const [ id, tab ] of Object.entries( tabButtons ) ) {

			tab.classList.toggle( 'active', id === state.tab );
			tab.setAttribute( 'aria-selected', id === state.tab );

		}

		let content;
		try {

			if ( state.tab === 'projects' && state.view === 'versions' ) content = await renderVersions();
			else if ( state.tab === 'projects' && state.view === 'import' ) content = renderImport();
			else if ( state.tab === 'projects' ) content = await renderProjects();
			else if ( state.tab === 'trash' ) content = await renderTrash();
			else content = await renderStorage();

		} catch ( error ) {

			console.error( error );
			content = el( 'p', 'SimpleBudgetEmpty', 'Não foi possível ler os projetos deste navegador: ' + ( error.message || '' ) );

		}

		if ( token !== renderToken ) return;
		const focusKey = document.activeElement && panel.contains( document.activeElement ) ? document.activeElement.dataset.focus : undefined;
		body.textContent = '';
		body.appendChild( content );
		if ( focusKey ) {

			const next = body.querySelector( `[data-focus="${focusKey}"]` );
			if ( next ) next.focus();

		}

		const trashed = ( await storage.listProjects() ).filter( ( p ) => p.deletedAt !== null ).length;
		tabButtons.trash.textContent = trashed > 0 ? `Lixeira (${trashed})` : 'Lixeira';

	}

	function activeBar() {

		const bar = el( 'div', 'SimpleProjectsActive' );
		const active = manager.getActive();
		const status = manager.state.status;

		if ( active === null ) {

			bar.appendChild( el( 'span', '', manager.state.detached === 'declined' ? 'A cena atual não está em Meus projetos.' : 'A cena atual ainda não foi salva em Meus projetos.' ) );
			bar.appendChild( button( 'Salvar em Meus projetos', () => guarded( async () => {

				await manager.save( 'manual' );
				render();

			} ), { icon: 'save', className: 'active', title: 'Registrar a cena atual como projeto neste navegador' } ) );
			return bar;

		}

		const label = el( 'span', 'SimpleProjectsActiveName' );
		label.append( el( 'small', '', 'Projeto aberto' ), el( 'strong', '', active.name ) );
		bar.appendChild( label );
		bar.appendChild( el( 'span', 'SimpleProjectStatusText', statusText( status ) ) );
		bar.appendChild( button( 'Salvar projeto', () => guarded( async () => {

			if ( await manager.save( 'manual' ) ) context.notify( 'Projeto salvo neste navegador.', 'success' );
			render();

		} ), { icon: 'save', className: 'active', title: 'Gravar o estado atual neste navegador (Ctrl+S)' } ) );
		bar.appendChild( button( 'Salvar versão', () => saveVersion(), { icon: 'bookmark', title: 'Criar um snapshot identificado (histórico de versões)' } ) );
		bar.appendChild( button( 'Versões', () => showVersions( active.id ), { icon: 'views', title: 'Histórico de versões do projeto aberto' } ) );

		const autosave = el( 'label', 'SimpleCheckboxRow SimpleProjectsAutosave' );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.checked = editor.config.getKey( 'projects/autosave' ) !== false;
		box.dataset.focus = 'autosave';
		box.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		box.addEventListener( 'change', () => {

			editor.config.setKey( 'projects/autosave', box.checked );
			context.notify( box.checked ? 'Salvamento automático no navegador ligado.' : 'Salvamento automático desligado: as alterações ficam em rascunho até "Salvar projeto".' );
			manager.changed.dispatch();

		} );
		autosave.append( box, el( 'span', '', 'Salvar automaticamente' ) );
		bar.appendChild( autosave );
		return bar;

	}

	async function saveVersion() {

		const result = await dialog.ask( { title: 'Salvar versão', message: 'A versão é um snapshot imutável do estado atual do projeto.', input: { label: 'Nome da versão', value: '', maxLength: 80 }, choices: [ { id: 'ok', label: 'Salvar versão', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( result.choice !== 'ok' ) return;
		await guarded( async () => {

			const version = await manager.createVersion( result.value.trim() || 'Versão manual' );
			if ( version !== null ) context.notify( `Versão ${version.number} — ${version.name} salva.`, 'success' );
			render();

		} );

	}

	function statusText( status ) {

		return { saved: 'Salvo', pending: 'Alterações pendentes', draft: 'Alterações pendentes (rascunho guardado)', saving: 'Salvando…', error: 'Erro ao salvar', conflict: 'Conflito com outra aba', loading: 'Carregando…', unregistered: 'Não salvo em Meus projetos', idle: '' }[ status ] || '';

	}

	function recoveryBanner() {

		const box = el( 'div', 'SimpleNotice SimpleProjectsBanners' );
		const recovery = manager.state.pendingRecovery;
		const migration = manager.state.pendingMigration;
		if ( recovery === null && migration === null ) return null;

		if ( recovery !== null ) {

			box.appendChild( el( 'p', '', `Encontramos alterações recentes (${formatDate( recovery.draft.savedAt )}) que podem ser recuperadas.` ) );
			const actions = el( 'div', 'SimpleProjectsBannerActions' );
			actions.append(
				button( 'Recuperar alterações', () => guarded( () => manager.recoverDraft( recovery.projectId ).then( render ) ), { className: 'active' } ),
				button( 'Abrir última versão salva', () => guarded( () => manager.keepSavedVersion( recovery.projectId ).then( render ) ) ),
				button( 'Decidir depois', () => {

					manager.postponeRecovery();
					render();

				} )
			);
			box.appendChild( actions );

		}

		if ( migration !== null ) {

			box.appendChild( el( 'p', '', 'Encontramos um projeto de trabalho de uma versão anterior do aplicativo. Deseja incorporá-lo a Meus projetos? O estado original não é apagado.' ) );
			const actions = el( 'div', 'SimpleProjectsBannerActions' );
			actions.append(
				button( 'Incorporar a Meus projetos', () => guarded( () => manager.acceptMigration().then( render ) ), { className: 'active' } ),
				button( 'Agora não', () => guarded( () => manager.declineMigration().then( render ) ) )
			);
			box.appendChild( actions );

		}

		return box;

	}

	async function renderProjects() {

		const wrap = el( 'div', 'SimpleProjectsList' );
		const banner = recoveryBanner();
		if ( banner !== null ) wrap.appendChild( banner );
		wrap.appendChild( activeBar() );

		const toolbar = el( 'div', 'SimpleBudgetToolbar SimpleProjectsToolbar' );
		const search = el( 'input', 'SimpleTextInput SimpleBudgetSearch' );
		search.type = 'search';
		search.placeholder = 'Pesquisar por nome';
		search.setAttribute( 'aria-label', 'Pesquisar projetos por nome' );
		search.value = state.search;
		search.dataset.focus = 'search';
		search.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		search.addEventListener( 'input', () => {

			state.search = search.value;
			render();

		} );

		const sort = el( 'select', 'SimpleSelect' );
		sort.setAttribute( 'aria-label', 'Ordenar projetos' );
		for ( const [ value, label ] of [[ 'updated', 'Última modificação' ], [ 'name', 'Nome (A–Z)' ], [ 'created', 'Data de criação' ]] ) {

			const option = el( 'option', '', label );
			option.value = value;
			sort.appendChild( option );

		}

		sort.value = state.sort;
		sort.dataset.focus = 'sort';
		sort.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		sort.addEventListener( 'change', () => {

			state.sort = sort.value;
			render();

		} );

		const recent = el( 'label', 'SimpleCheckboxRow SimpleBudgetCheck' );
		const recentBox = el( 'input' );
		recentBox.type = 'checkbox';
		recentBox.checked = state.recent;
		recentBox.dataset.focus = 'recent';
		recentBox.addEventListener( 'change', () => {

			state.recent = recentBox.checked;
			render();

		} );
		recent.append( recentBox, el( 'span', '', `Recentes (${RECENT_DAYS} dias)` ) );

		toolbar.append( search, sort, recent,
			button( 'Novo projeto', newProject, { icon: 'new', className: 'SimpleProjectsNew' } ),
			button( 'Modelo pronto', () => {

				close();
				context.openTemplates();

			}, { icon: 'templates' } ),
			button( 'Importar', () => fileInput.click(), { icon: 'open', title: 'Importar projeto JSON ou backup .zip' } ),
			button( 'Exportar backup', () => backupAll(), { icon: 'save', title: 'Exportar um .zip com todos os projetos (e versões)' } ) );
		wrap.appendChild( toolbar );

		const [ projects, versions ] = await Promise.all( [ storage.listProjects(), storage.listAllVersions() ] );
		const counts = new Map();
		for ( const v of versions ) counts.set( v.projectId, ( counts.get( v.projectId ) || 0 ) + 1 );

		const query = state.search.trim().toLocaleLowerCase( 'pt-BR' );
		const limit = Date.now() - RECENT_DAYS * 86400000;
		const list = projects.filter( ( p ) => p.deletedAt === null && ( query === '' || p.name.toLocaleLowerCase( 'pt-BR' ).includes( query ) ) && ( state.recent === false || Math.max( p.updatedAt, p.lastOpenedAt || 0 ) >= limit ) )
			.sort( ( a, b ) => ( state.sort === 'name' ? a.name.localeCompare( b.name, 'pt-BR' ) : ( state.sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt ) ) );

		if ( projects.filter( ( p ) => p.deletedAt === null ).length === 0 ) {

			const empty = el( 'div', 'SimpleProjectsEmpty' );
			empty.appendChild( el( 'p', '', 'Você ainda não possui projetos salvos neste navegador.' ) );
			const actions = el( 'div', 'SimpleProjectsBannerActions' );
			actions.append( button( 'Criar projeto em branco', newProject, { icon: 'new', className: 'active' } ), button( 'Começar com modelo pronto', () => {

				close();
				context.openTemplates();

			}, { icon: 'templates' } ), button( 'Importar projeto', () => fileInput.click(), { icon: 'open' } ) );
			empty.appendChild( actions );
			wrap.appendChild( empty );
			return wrap;

		}

		if ( list.length === 0 ) {

			wrap.appendChild( el( 'p', 'SimpleBudgetEmpty', 'Nenhum projeto corresponde à pesquisa ou ao filtro.' ) );
			return wrap;

		}

		const grid = el( 'div', 'SimpleProjectsGrid' );
		const active = manager.getActive();

		for ( const project of list ) {

			const card = el( 'article', 'SimpleProjectCard' );
			card.dataset.project = project.id;
			const isActive = active !== null && active.id === project.id;
			card.classList.toggle( 'active', isActive );

			const thumb = el( 'div', 'SimpleProjectThumb' );
			if ( project.thumbnail ) {

				const img = el( 'img' );
				img.src = project.thumbnail;
				img.alt = '';
				thumb.appendChild( img );

			} else thumb.appendChild( createIcon( 'templates' ) );

			if ( isActive ) thumb.appendChild( el( 'span', 'SimpleProjectBadge', 'Aberto' ) );
			card.appendChild( thumb );

			const info = el( 'div', 'SimpleProjectInfo' );
			info.appendChild( el( 'h3', 'SimpleProjectName', project.name ) );
			if ( project.description ) info.appendChild( el( 'p', 'SimpleProjectDescription', project.description ) );
			const versionCount = counts.get( project.id ) || 0;
			info.appendChild( el( 'p', 'SimpleProjectMeta', `Modificado em ${formatDate( project.updatedAt )} · ${versionCount} ${versionCount === 1 ? 'versão' : 'versões'}` ) );
			const created = el( 'p', 'SimpleProjectMeta', `Criado em ${formatDate( project.createdAt )}${project.sourceTemplate ? ' · modelo: ' + project.sourceTemplate.name : ''} · ${formatBytes( project.size )}` );
			info.appendChild( created );
			card.appendChild( info );

			const actions = el( 'div', 'SimpleProjectActions' );
			const open = button( isActive ? 'Aberto' : 'Abrir', () => ( isActive ? close() : openProject( project ) ), { icon: 'open', className: 'active SimpleProjectOpen' } );
			actions.append(
				open,
				button( 'Renomear', () => rename( project ), { icon: 'edit', className: 'SimpleIconButton', title: `Renomear "${project.name}"` } ),
				button( 'Duplicar', () => duplicate( project ), { icon: 'duplicate', className: 'SimpleIconButton', title: `Duplicar "${project.name}"` } ),
				button( 'Versões', () => showVersions( project.id ), { icon: 'views', className: 'SimpleIconButton', title: `Versões de "${project.name}"` } ),
				button( 'Exportar JSON', () => exportJSON( project ), { icon: 'save', className: 'SimpleIconButton', title: `Exportar "${project.name}" (JSON do estado atual)` } ),
				button( 'Exportar backup', () => exportZip( [ project.id ], true, project.name ), { icon: 'bookmark', className: 'SimpleIconButton', title: `Backup .zip de "${project.name}" com versões` } ),
				button( 'Excluir', () => remove( project ), { icon: 'delete', className: 'SimpleIconButton danger', title: `Excluir "${project.name}"` } )
			);
			for ( const node of actions.querySelectorAll( '.SimpleIconButton' ) ) node.dataset.action = node.getAttribute( 'aria-label' ).split( ' ' )[ 0 ].toLowerCase();
			card.appendChild( actions );
			grid.appendChild( card );

		}

		wrap.appendChild( grid );
		return wrap;

	}

	async function backupAll() {

		const projects = ( await storage.listProjects() ).filter( ( p ) => p.deletedAt === null );
		if ( projects.length === 0 ) return context.notify( 'Não há projetos para exportar.', 'warning' );
		const choice = await dialog.ask( { title: 'Exportar backup', message: `Exportar ${projects.length} projeto(s) em um arquivo .zip.`, choices: [ { id: 'versions', label: 'Com histórico de versões', kind: 'primary' }, { id: 'current', label: 'Somente o estado atual' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice === 'cancel' ) return;
		await exportZip( projects.map( ( p ) => p.id ), choice === 'versions', 'project3ds' );

	}

	function showVersions( projectId ) {

		state.versionsOf = projectId;
		state.tab = 'projects';
		state.view = 'versions';
		render();

	}

	async function renderVersions() {

		const project = await storage.getProject( state.versionsOf );
		const wrap = el( 'div', 'SimpleProjectsVersions' );
		const top = el( 'div', 'SimpleBudgetToolbar' );
		top.appendChild( button( 'Voltar', () => {

			state.view = 'list';
			render();

		}, { icon: 'previous' } ) );

		if ( project === undefined ) {

			wrap.append( top, el( 'p', 'SimpleBudgetEmpty', 'O projeto não existe mais.' ) );
			return wrap;

		}

		const active = manager.getActive();
		const isActive = active !== null && active.id === project.id;
		top.appendChild( el( 'h3', 'SimpleProjectsSectionTitle', `Histórico de versões — ${project.name}` ) );
		if ( isActive ) top.appendChild( button( 'Salvar versão', () => saveVersion(), { icon: 'bookmark', className: 'active' } ) );
		wrap.appendChild( top );

		const draft = await storage.getDraft( project.id );
		if ( draft !== undefined ) {

			const box = el( 'div', 'SimpleNotice SimpleProjectsDraft' );
			box.appendChild( el( 'p', '', `Rascunho de recuperação de ${formatDate( draft.savedAt )} (${formatBytes( draft.data.length )}).` ) );
			const actions = el( 'div', 'SimpleProjectsBannerActions' );
			actions.append( button( 'Recuperar rascunho', () => guarded( async () => {

				if ( await manager.recoverDraft( project.id ) ) close();

			} ), { className: 'active' } ), button( 'Descartar rascunho', async () => {

				const choice = await dialog.ask( { title: 'Descartar rascunho', message: 'O rascunho será apagado deste navegador. O projeto salvo e as versões não mudam.', choices: [ { id: 'discard', label: 'Descartar', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'discard' ) await guarded( () => manager.discardDraft( project.id ).then( render ) );

			} ) );
			box.appendChild( actions );
			wrap.appendChild( box );

		}

		const versions = ( await storage.listVersions( project.id ) ).sort( ( a, b ) => b.number - a.number );
		if ( versions.length === 0 ) {

			wrap.appendChild( el( 'p', 'SimpleBudgetEmpty', 'Nenhuma versão salva. Use "Salvar versão" para guardar um snapshot identificado do projeto.' ) );
			return wrap;

		}

		const table = el( 'table', 'SimpleBudgetTable SimpleProjectsVersionTable' );
		const head = el( 'tr' );
		for ( const label of [ 'Nº', 'Nome', 'Data', 'Tipo', 'Tamanho', 'Ações' ] ) head.appendChild( el( 'th', '', label ) );
		const thead = el( 'thead' );
		thead.appendChild( head );
		table.appendChild( thead );
		const tbody = el( 'tbody' );

		for ( const version of versions ) {

			const tr = el( 'tr' );
			tr.dataset.version = version.id;
			tr.appendChild( el( 'td', 'num', String( version.number ) ) );
			const name = el( 'td' );
			name.appendChild( el( 'strong', '', version.name ) );
			if ( version.pinned ) name.appendChild( el( 'small', 'SimpleProjectPinned', ' · fixada' ) );
			tr.appendChild( name );
			tr.appendChild( el( 'td', '', formatDate( version.createdAt ) ) );
			tr.appendChild( el( 'td', '', KIND_LABELS[ version.kind ] || version.kind ) );
			tr.appendChild( el( 'td', 'num', formatBytes( version.size ) ) );

			const actions = el( 'td', 'SimpleProjectVersionActions' );
			actions.append(
				button( 'Detalhes', () => details( version ), { className: 'SimpleIconButton', icon: 'help', title: `Detalhes da versão ${version.number}` } ),
				button( 'Restaurar', () => restore( version ), { className: 'SimpleVersionRestore', icon: 'undo', title: `Restaurar a versão ${version.number}` } ),
				button( 'Criar cópia', () => guarded( async () => {

					const copy = await manager.copyFromVersion( version.id );
					context.notify( `Projeto "${copy.name}" criado a partir da versão ${version.number}.`, 'success' );

				} ), { className: 'SimpleIconButton', icon: 'duplicate', title: `Criar projeto a partir da versão ${version.number}` } ),
				button( 'Exportar', () => guarded( async () => {

					const data = await storage.getVersionData( version.id );
					editor.utils.save( new Blob( [ data ], { type: 'application/json' } ), safeFileName( `${project.name}-versao-${version.number}`, '.json' ) );

				} ), { className: 'SimpleIconButton', icon: 'save', title: `Exportar a versão ${version.number} (JSON)` } ),
				button( version.pinned ? 'Desafixar' : 'Fixar', () => guarded( async () => {

					await storage.updateVersion( version.id, { pinned: ! version.pinned } );
					render();

				} ), { className: 'SimpleIconButton', icon: 'lock', title: version.pinned ? 'Desafixar (volta a seguir a retenção automática)' : 'Fixar como importante (nunca excluída automaticamente)' } )
			);

			if ( version.kind === 'manual' ) actions.appendChild( button( 'Renomear', () => renameVersion( version ), { className: 'SimpleIconButton', icon: 'edit', title: `Renomear a versão ${version.number}` } ) );
			actions.appendChild( button( 'Excluir', () => deleteVersion( version ), { className: 'SimpleIconButton danger', icon: 'delete', title: `Excluir a versão ${version.number}` } ) );
			tr.appendChild( actions );
			tbody.appendChild( tr );

		}

		table.appendChild( tbody );
		wrap.appendChild( table );
		return wrap;

	}

	async function details( version ) {

		const lines = [ `Tipo: ${KIND_LABELS[ version.kind ] || version.kind}`, `Data: ${formatDate( version.createdAt )}`, `Tamanho: ${formatBytes( version.size )}`, `Integridade: ${version.hash}` ];
		if ( version.imported ) lines.push( 'Importada de um backup.' );
		if ( version.thumbnail === null || version.thumbnail === undefined ) lines.push( 'Sem miniatura (a restauração não depende dela).' );
		await dialog.ask( { title: `Versão ${version.number} — ${version.name}`, details: lines, choices: [ { id: 'ok', label: 'Fechar', kind: 'primary' } ] } );

	}

	async function restore( version ) {

		const choice = await dialog.ask( { title: `Restaurar a versão ${version.number}?`, message: `"${version.name}" passa a ser o estado atual do projeto. Antes disso é criado um ponto de recuperação do estado atual; a versão histórica não é apagada.`, choices: [ { id: 'restore', label: 'Restaurar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'restore' ) return;
		await guarded( async () => {

			if ( await manager.restoreVersion( version.id ) ) close();

		} );

	}

	async function renameVersion( version ) {

		const result = await dialog.ask( { title: `Renomear versão ${version.number}`, input: { label: 'Nome da versão', value: version.name, maxLength: 80 }, choices: [ { id: 'ok', label: 'Renomear', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( result.choice !== 'ok' || result.value.trim() === '' ) return;
		await guarded( async () => {

			await storage.updateVersion( version.id, { name: result.value.trim().slice( 0, 80 ) } );
			render();

		} );

	}

	async function deleteVersion( version ) {

		if ( version.pinned ) return context.notify( 'Desafixe a versão antes de excluí-la.', 'warning' );
		const choice = await dialog.ask( { title: `Excluir a versão ${version.number}?`, message: `"${version.name}" será apagada deste navegador. O projeto e as demais versões não mudam.`, choices: [ { id: 'delete', label: 'Excluir versão', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'delete' ) return;
		await guarded( async () => {

			await storage.deleteVersion( version.id );
			render();

		} );

	}

	function renderImport() {

		const importing = state.importing;
		const wrap = el( 'div', 'SimpleProjectsImport' );
		wrap.appendChild( el( 'h3', 'SimpleProjectsSectionTitle', `Importar backup — ${importing.file}` ) );
		wrap.appendChild( el( 'p', 'SimpleBudgetHint', `${importing.items.length} projeto(s) no arquivo. Projetos com o mesmo identificador de um existente nunca são sobrescritos sem escolha explícita.${importing.analysis.rejected.length > 0 ? ` ${importing.analysis.rejected.length} arquivo(s) fora do formato foram ignorados.` : ''}` ) );

		const table = el( 'table', 'SimpleBudgetTable' );
		const head = el( 'tr' );
		for ( const label of [ 'Projeto', 'Versões', 'Verificação', 'Situação', 'Importar como' ] ) head.appendChild( el( 'th', '', label ) );
		table.appendChild( head );

		importing.items.forEach( ( entry, index ) => {

			const tr = el( 'tr' );
			tr.dataset.import = entry.item.id || String( index );
			tr.appendChild( el( 'td', '', entry.item.name ) );
			tr.appendChild( el( 'td', 'num', String( entry.item.versions.length ) ) );
			tr.appendChild( el( 'td', '', entry.item.problems.length === 0 ? 'Integridade verificada (SHA-256)' : entry.item.problems.join( ' ' ) ) );
			tr.appendChild( el( 'td', '', entry.item.valid === false ? 'Inválido — não será importado' : ( entry.conflict !== null ? `Conflito: já existe "${entry.conflict.name}"` : 'Novo' ) ) );

			const cell = el( 'td' );
			const select = el( 'select', 'SimpleSelect' );
			const options = entry.item.valid === false ? [[ 'skip', 'Ignorar' ]] : ( entry.conflict !== null ? [[ 'copy', 'Cópia (novo ID)' ], [ 'replace', 'Substituir (com ponto de recuperação)' ], [ 'skip', 'Ignorar' ]] : [[ 'new', 'Novo projeto' ], [ 'skip', 'Ignorar' ]] );
			for ( const [ value, label ] of options ) {

				const option = el( 'option', '', label );
				option.value = value;
				select.appendChild( option );

			}

			select.value = entry.mode;
			select.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
			select.addEventListener( 'change', () => {

				entry.mode = select.value;

			} );
			cell.appendChild( select );
			tr.appendChild( cell );
			table.appendChild( tr );

		} );

		wrap.appendChild( table );
		const actions = el( 'div', 'SimpleProjectsBannerActions' );
		actions.append( button( 'Confirmar importação', () => confirmImport(), { className: 'active SimpleImportConfirm' } ), button( 'Cancelar', () => {

			state.importing = null;
			state.view = 'list';
			render();

		} ) );
		wrap.appendChild( actions );
		return wrap;

	}

	async function renderTrash() {

		const wrap = el( 'div', 'SimpleProjectsTrash' );
		const trashed = ( await storage.listProjects() ).filter( ( p ) => p.deletedAt !== null ).sort( ( a, b ) => b.deletedAt - a.deletedAt );

		if ( trashed.length === 0 ) {

			wrap.appendChild( el( 'p', 'SimpleBudgetEmpty', 'A lixeira está vazia.' ) );
			return wrap;

		}

		const top = el( 'div', 'SimpleBudgetToolbar' );
		top.appendChild( button( 'Esvaziar lixeira', () => emptyTrash(), { icon: 'delete', className: 'danger' } ) );
		wrap.appendChild( top );

		for ( const project of trashed ) {

			const row = el( 'div', 'SimpleProjectsTrashRow' );
			row.dataset.project = project.id;
			const info = el( 'div' );
			info.append( el( 'strong', '', project.name ), el( 'small', '', ` · excluído em ${formatDate( project.deletedAt )}` ) );
			row.append( info, button( 'Restaurar', () => guarded( async () => {

				await manager.restoreFromTrash( project.id );
				context.notify( `"${project.name}" foi restaurado.`, 'success' );
				render();

			} ), { icon: 'undo', className: 'SimpleTrashRestore' } ), button( 'Excluir permanentemente', () => purge( project ), { icon: 'delete', className: 'danger SimpleTrashPurge' } ) );
			wrap.appendChild( row );

		}

		return wrap;

	}

	async function emptyTrash() {

		const choice = await dialog.ask( { title: 'Esvaziar lixeira', message: 'Todos os projetos da lixeira e suas versões serão excluídos permanentemente deste navegador.', choices: [ { id: 'empty', label: 'Esvaziar lixeira', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'empty' ) return;
		await guarded( async () => {

			const count = await manager.emptyTrash();
			context.notify( `${count} projeto(s) excluído(s) permanentemente.`, 'success' );
			render();

		} );

	}

	async function renderStorage() {

		const report = await manager.storageReport();
		const wrap = el( 'div', 'SimpleProjectsStorage' );
		wrap.appendChild( el( 'h3', 'SimpleProjectsSectionTitle', 'Armazenamento local' ) );

		const list = el( 'dl', 'SimpleBudgetMeasures SimpleProjectsStorageList' );
		const add = ( label, value ) => list.append( el( 'dt', '', label ), el( 'dd', '', value ) );
		if ( report.estimate !== null && Number.isFinite( report.estimate.usage ) ) {

			add( 'Espaço usado pelo site (estimativa)', formatBytes( report.estimate.usage ) );
			if ( Number.isFinite( report.estimate.quota ) ) add( 'Espaço disponível (estimativa do navegador)', formatBytes( Math.max( 0, report.estimate.quota - report.estimate.usage ) ) );

		} else add( 'Estimativa de espaço', 'Não informada por este navegador' );

		add( 'Armazenamento persistente', report.persisted === null ? 'Não suportado' : ( report.persisted ? 'Concedido' : 'Não concedido' ) );
		add( 'Projetos', String( report.projects ) );
		add( 'Na lixeira', String( report.trashed ) );
		add( 'Versões', `${report.versions} (${report.autoVersions} automáticas não fixadas)` );
		add( 'Rascunhos de recuperação', String( report.drafts ) );
		wrap.appendChild( list );
		wrap.appendChild( el( 'p', 'SimpleBudgetHint', 'As estimativas são fornecidas pelo navegador e não garantem disponibilidade. Versões manuais nunca são apagadas automaticamente.' ) );

		if ( report.largest.length > 0 ) {

			wrap.appendChild( el( 'h4', 'SimpleProjectsSectionTitle', 'Projetos que ocupam mais espaço' ) );
			const table = el( 'table', 'SimpleBudgetTable SimpleBudgetCompact' );
			for ( const entry of report.largest ) {

				const tr = el( 'tr' );
				tr.append( el( 'td', '', entry.project.name + ( entry.project.deletedAt !== null ? ' (lixeira)' : '' ) ), el( 'td', 'num', `${entry.versions} versões` ), el( 'td', 'num', formatBytes( entry.size ) ) );
				table.appendChild( tr );

			}

			wrap.appendChild( table );

		}

		const actions = el( 'div', 'SimpleProjectsBannerActions' );
		actions.append(
			button( 'Exportar backup', () => backupAll(), { icon: 'save' } ),
			button( 'Excluir versões automáticas antigas', async () => {

				const choice = await dialog.ask( { title: 'Excluir versões automáticas antigas', message: 'Mantém as 2 versões automáticas mais recentes de cada projeto. Versões manuais, fixadas e pontos de recuperação não são apagados.', choices: [ { id: 'prune', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'prune' ) await guarded( async () => {

					const removed = await manager.pruneAutoVersions( 2 );
					context.notify( `${removed} versão(ões) automática(s) excluída(s).`, 'success' );
					render();

				} );

			} ),
			button( 'Esvaziar lixeira', () => emptyTrash(), { icon: 'delete' } )
		);

		if ( report.persisted === false ) actions.appendChild( button( 'Solicitar armazenamento persistente', () => guarded( async () => {

			const granted = await manager.requestPersistence();
			context.notify( granted ? 'O navegador concedeu armazenamento persistente.' : 'O navegador não concedeu armazenamento persistente (a decisão é dele).', granted ? 'success' : 'warning' );
			render();

		} ), { title: 'Pede ao navegador para não apagar os dados do site automaticamente; a concessão depende do navegador' } ) );

		wrap.appendChild( actions );
		return wrap;

	}

	// abrir e fechar ------------------------------------------------------------------------------------------------------------

	function open( tab = 'projects' ) {

		state.open = true;
		state.tab = tab;
		state.view = state.importing !== null && tab === 'projects' ? 'import' : 'list';
		overlay.hidden = false;
		if ( context.interaction !== undefined ) context.interaction.deactivate();
		render().then( () => {

			const first = panel.querySelector( '.SimpleProjectsNew, .SimpleProjectOpen, button' );
			if ( first ) first.focus();

		} );

	}

	function close() {

		if ( state.open === false ) return;
		state.open = false;
		overlay.hidden = true;

	}

	overlay.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' && dialog.isOpen() === false ) {

			event.preventDefault();
			close();

		}

		event.stopPropagation(); // atalhos do editor não agem por trás da galeria

	} );

	overlay.addEventListener( 'mousedown', ( event ) => {

		if ( event.target === overlay ) close();

	} );

	manager.libraryChanged.add( () => render() );
	manager.changed.add( () => {

		if ( state.open && state.view === 'list' && state.tab === 'projects' ) render();

	} );

	return { open, close, isOpen: () => state.open, render, showVersions };

}

export { SimpleModeProjectGallery };
