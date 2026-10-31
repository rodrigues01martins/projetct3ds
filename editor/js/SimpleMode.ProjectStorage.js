// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Banco IndexedDB próprio da gestão de projetos: "project3ds-projects" (não toca em "threejs-editor" nem em
// "project3ds-library").
//
//   projects     (keyPath id)        metadados: nome, datas, revisão, origem, exclusão lógica, tamanho, miniatura
//   states       (keyPath projectId) estado atual persistido: { projectId, revision, data (texto JSON), hash, contentHash, savedAt }
//   versions     (keyPath id, índice projectId) metadados das versões: número, nome, tipo, fixada, tamanho, hash, miniatura
//   versionData  (keyPath id)        texto JSON de cada versão (separado: listar versões não carrega os snapshots)
//   drafts       (keyPath projectId) rascunho de recuperação: { data, contentHash, baseRevision, savedAt, session, dismissed }
//   meta         (keyPath key)       projeto ativo, migração do estado antigo, exclusões permanentes
//
// Todas as gravações de um passo lógico acontecem numa única transação: sucesso só depois de "complete";
// em erro (inclusive falta de espaço) a transação é abortada e nada do que já estava gravado se perde.
// Concorrência: saveState compara a revisão esperada com a do banco dentro da transação (controle otimista).

const DB_NAME = 'project3ds-projects';
const DB_VERSION = 1;
const STORES = [ 'projects', 'states', 'versions', 'versionData', 'drafts', 'meta' ];

class StorageError extends Error {

	constructor( code, message, cause ) {

		super( message );
		this.code = code; // 'quota' | 'conflict' | 'missing' | 'deleted' | 'unavailable' | 'failed'
		this.cause = cause;

	}

}

function isQuota( error ) {

	return error !== null && error !== undefined && ( error.name === 'QuotaExceededError' || error.code === 22 || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' );

}

function wrapError( error ) {

	if ( error instanceof StorageError ) return error;
	if ( isQuota( error ) ) return new StorageError( 'quota', 'Espaço de armazenamento do navegador insuficiente. Nada do que já estava salvo foi perdido.', error );
	return new StorageError( 'failed', 'Falha ao acessar o armazenamento local do navegador.', error );

}

const request = ( req ) => new Promise( ( resolve, reject ) => {

	req.onsuccess = () => resolve( req.result );
	req.onerror = () => reject( req.error );

} );

function ProjectStorage() {

	let db = null;
	let opening = null;

	function open() {

		if ( db !== null ) return Promise.resolve( db );
		if ( opening !== null ) return opening;

		opening = new Promise( ( resolve, reject ) => {

			if ( typeof indexedDB === 'undefined' ) return reject( new StorageError( 'unavailable', 'IndexedDB indisponível neste navegador.' ) );

			const req = indexedDB.open( DB_NAME, DB_VERSION );

			// atualização de esquema versionada: cada versão só cria o que falta
			req.onupgradeneeded = ( event ) => {

				const database = req.result;
				if ( event.oldVersion < 1 ) {

					database.createObjectStore( 'projects', { keyPath: 'id' } );
					database.createObjectStore( 'states', { keyPath: 'projectId' } );
					database.createObjectStore( 'versions', { keyPath: 'id' } ).createIndex( 'projectId', 'projectId', { unique: false } );
					database.createObjectStore( 'versionData', { keyPath: 'id' } );
					database.createObjectStore( 'drafts', { keyPath: 'projectId' } );
					database.createObjectStore( 'meta', { keyPath: 'key' } );

				}

			};

			req.onsuccess = () => {

				db = req.result;
				db.onversionchange = () => {

					db.close();
					db = null;

				};

				resolve( db );

			};

			req.onerror = () => reject( wrapError( req.error ) );
			req.onblocked = () => reject( new StorageError( 'unavailable', 'O banco de projetos está bloqueado por outra aba.' ) );

		} ).finally( () => {

			opening = null;

		} );

		return opening;

	}

	// executa `work(stores, tx)` numa transação; resolve com o valor de work somente após "complete"
	async function run( names, mode, work ) {

		const database = await open();

		return new Promise( ( resolve, reject ) => {

			let tx, result, failure = null;

			try {

				tx = database.transaction( names, mode );

			} catch ( error ) {

				return reject( wrapError( error ) );

			}

			const stores = Object.fromEntries( names.map( ( name ) => [ name, tx.objectStore( name ) ] ) );

			tx.oncomplete = () => resolve( result );
			tx.onabort = () => reject( failure || wrapError( tx.error ) );
			tx.onerror = ( event ) => event.preventDefault(); // tratado no onabort

			Promise.resolve().then( () => work( stores, tx ) ).then( ( value ) => {

				result = value;

			}, ( error ) => {

				failure = error instanceof StorageError ? error : wrapError( error );
				try {

					tx.abort();

				} catch ( abortError ) { /* já finalizada */ }

			} );

		} );

	}

	// projetos ------------------------------------------------------------------------------------------------------

	const listProjects = () => run( [ 'projects' ], 'readonly', ( s ) => request( s.projects.getAll() ) );
	const getProject = ( id ) => run( [ 'projects' ], 'readonly', ( s ) => request( s.projects.get( id ) ) );
	const getState = ( id ) => run( [ 'states' ], 'readonly', ( s ) => request( s.states.get( id ) ) );

	// cria um projeto com seu primeiro estado (e versão inicial opcional), tudo ou nada
	function createProject( record, state, initialVersion = null ) {

		return run( [ 'projects', 'states', 'versions', 'versionData', 'meta' ], 'readwrite', async ( s ) => {

			if ( await request( s.projects.get( record.id ) ) !== undefined ) throw new StorageError( 'conflict', 'Já existe um projeto com este identificador.' );

			const saved = Object.assign( {}, record, { revision: 1, size: state.size, contentHash: state.contentHash, updatedAt: state.savedAt } );
			s.projects.put( saved );
			s.states.put( { projectId: record.id, revision: 1, data: state.data, hash: state.hash, contentHash: state.contentHash, savedAt: state.savedAt } );

			if ( initialVersion !== null ) {

				s.versions.put( Object.assign( {}, initialVersion.meta, { projectId: record.id, number: 1 } ) );
				s.versionData.put( { id: initialVersion.meta.id, data: state.data } );

			}

			return saved;

		} );

	}

	// grava o estado atual: falha com 'conflict' se outra aba/sessão já gravou uma revisão mais nova
	function saveState( id, expectedRevision, state, patch = {} ) {

		return run( [ 'projects', 'states', 'drafts' ], 'readwrite', async ( s ) => {

			const project = await request( s.projects.get( id ) );
			if ( project === undefined ) throw new StorageError( 'missing', 'O projeto não existe mais neste navegador.' );
			if ( project.deletedAt !== null ) throw new StorageError( 'deleted', 'O projeto foi excluído; ele não será recriado pelo salvamento automático.' );
			if ( project.revision !== expectedRevision ) throw new StorageError( 'conflict', 'O projeto foi alterado em outra aba ou janela.', project.revision );

			const revision = project.revision + 1;
			const saved = Object.assign( {}, project, patch, { revision, updatedAt: state.savedAt, size: state.size, contentHash: state.contentHash } );
			s.projects.put( saved );
			s.states.put( { projectId: id, revision, data: state.data, hash: state.hash, contentHash: state.contentHash, savedAt: state.savedAt } );
			s.drafts.delete( id );
			return saved;

		} );

	}

	// metadados (nome, descrição, miniatura, último acesso) sem alterar o estado nem a revisão do conteúdo
	function updateProject( id, patch ) {

		return run( [ 'projects' ], 'readwrite', async ( s ) => {

			const project = await request( s.projects.get( id ) );
			if ( project === undefined ) throw new StorageError( 'missing', 'O projeto não existe mais neste navegador.' );
			const saved = Object.assign( {}, project, patch );
			s.projects.put( saved );
			return saved;

		} );

	}

	const trash = ( id ) => updateProject( id, { deletedAt: Date.now() } );
	const untrash = ( id ) => updateProject( id, { deletedAt: null } );

	// exclusão permanente: projeto, estado, versões e rascunho — somente deste projeto
	function deleteProject( id ) {

		return run( [ 'projects', 'states', 'versions', 'versionData', 'drafts', 'meta' ], 'readwrite', async ( s ) => {

			const versions = await request( s.versions.index( 'projectId' ).getAll( id ) );
			for ( const version of versions ) {

				s.versions.delete( version.id );
				s.versionData.delete( version.id );

			}

			s.projects.delete( id );
			s.states.delete( id );
			s.drafts.delete( id );

			const tombstones = await request( s.meta.get( 'tombstones' ) );
			const ids = tombstones !== undefined ? tombstones.ids.slice( - 200 ) : [];
			ids.push( id );
			s.meta.put( { key: 'tombstones', ids } );

		} );

	}

	// versões ---------------------------------------------------------------------------------------------------------

	const listVersions = ( projectId ) => run( [ 'versions' ], 'readonly', ( s ) => request( s.versions.index( 'projectId' ).getAll( projectId ) ) );
	const listAllVersions = () => run( [ 'versions' ], 'readonly', ( s ) => request( s.versions.getAll() ) );
	const getVersionData = ( id ) => run( [ 'versionData' ], 'readonly', async ( s ) => {

		const entry = await request( s.versionData.get( id ) );
		return entry !== undefined ? entry.data : undefined;

	} );

	// nova versão (número sequencial calculado na transação) + retenção das automáticas/recuperação não fixadas
	function addVersion( meta, data, { keep = {} } = {} ) {

		return run( [ 'projects', 'versions', 'versionData' ], 'readwrite', async ( s ) => {

			const project = await request( s.projects.get( meta.projectId ) );
			if ( project === undefined ) throw new StorageError( 'missing', 'O projeto não existe mais neste navegador.' );

			const existing = await request( s.versions.index( 'projectId' ).getAll( meta.projectId ) );
			const number = existing.reduce( ( max, v ) => Math.max( max, v.number ), 0 ) + 1;
			const version = Object.assign( {}, meta, { number } );
			s.versions.put( version );
			s.versionData.put( { id: version.id, data } );

			const removed = [];
			for ( const [ kind, limit ] of Object.entries( keep ) ) {

				const list = existing.concat( version ).filter( ( v ) => v.kind === kind && v.pinned !== true ).sort( ( a, b ) => b.number - a.number );
				for ( const old of list.slice( limit ) ) {

					s.versions.delete( old.id );
					s.versionData.delete( old.id );
					removed.push( old.id );

				}

			}

			return { version, removed };

		} );

	}

	function updateVersion( id, patch ) {

		return run( [ 'versions' ], 'readwrite', async ( s ) => {

			const version = await request( s.versions.get( id ) );
			if ( version === undefined ) throw new StorageError( 'missing', 'A versão não existe mais.' );
			const saved = Object.assign( {}, version, patch, { id: version.id, projectId: version.projectId, number: version.number } );
			s.versions.put( saved );
			return saved;

		} );

	}

	const deleteVersion = ( id ) => run( [ 'versions', 'versionData' ], 'readwrite', ( s ) => {

		s.versions.delete( id );
		s.versionData.delete( id );

	} );

	// rascunhos e meta -------------------------------------------------------------------------------------------------

	const getDraft = ( id ) => run( [ 'drafts' ], 'readonly', ( s ) => request( s.drafts.get( id ) ) );
	const listDrafts = () => run( [ 'drafts' ], 'readonly', ( s ) => request( s.drafts.getAll() ) );
	const putDraft = ( draft ) => run( [ 'drafts' ], 'readwrite', ( s ) => {

		s.drafts.put( draft );

	} );
	const deleteDraft = ( id ) => run( [ 'drafts' ], 'readwrite', ( s ) => {

		s.drafts.delete( id );

	} );
	const getMeta = ( key ) => run( [ 'meta' ], 'readonly', async ( s ) => {

		const entry = await request( s.meta.get( key ) );
		return entry !== undefined ? entry.value : undefined;

	} );
	const setMeta = ( key, value ) => run( [ 'meta' ], 'readwrite', ( s ) => {

		s.meta.put( { key, value } );

	} );
	const getTombstones = () => run( [ 'meta' ], 'readonly', async ( s ) => {

		const entry = await request( s.meta.get( 'tombstones' ) );
		return entry !== undefined ? entry.ids : [];

	} );

	// importação de backup: projeto + estado + versões numa transação (nunca sobrescreve sem ordem explícita)
	function importProject( record, state, versions, { replace = false } = {} ) {

		return run( [ 'projects', 'states', 'versions', 'versionData', 'drafts' ], 'readwrite', async ( s ) => {

			const existing = await request( s.projects.get( record.id ) );
			if ( existing !== undefined && replace === false ) throw new StorageError( 'conflict', 'Já existe um projeto com este identificador.' );

			const revision = existing !== undefined ? existing.revision + 1 : 1;
			const saved = Object.assign( {}, record, { revision, deletedAt: null } );
			s.projects.put( saved );
			s.states.put( { projectId: record.id, revision, data: state.data, hash: state.hash, contentHash: state.contentHash, savedAt: state.savedAt } );

			const current = await request( s.versions.index( 'projectId' ).getAll( record.id ) );
			let number = current.reduce( ( max, v ) => Math.max( max, v.number ), 0 );
			for ( const version of versions ) {

				number ++;
				s.versions.put( Object.assign( {}, version.meta, { projectId: record.id, number } ) );
				s.versionData.put( { id: version.meta.id, data: version.data } );

			}

			return saved;

		} );

	}

	return {
		DB_NAME,
		STORES,
		open,
		listProjects,
		getProject,
		getState,
		createProject,
		saveState,
		updateProject,
		trash,
		untrash,
		deleteProject,
		listVersions,
		listAllVersions,
		getVersionData,
		addVersion,
		updateVersion,
		deleteVersion,
		getDraft,
		listDrafts,
		putDraft,
		deleteDraft,
		getMeta,
		setMeta,
		getTombstones,
		importProject
	};

}

export { ProjectStorage, StorageError, isQuota };
