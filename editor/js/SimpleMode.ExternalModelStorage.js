// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Armazenamento próprio dos modelos importados: banco IndexedDB SEPARADO "project3ds-assets" (o banco
// "project3ds-library" dos componentes pessoais da EV-003 não é tocado nem migrado; seus limites continuam iguais).
//
//   models  (keyPath id)  metadados: { id, version, name, category, keywords, format, originalName, mainFile, auxNames,
//                         hash, size, dimensions, defaults, stats, license, thumbnail, importedAt, updatedAt }
//   files   (keyPath id)  binários: { id, files: [ { name, type, size, data: Blob } ] } — carregados só quando o
//                         modelo é usado (a lista da biblioteca lê apenas os metadados e as miniaturas)
//
// Cada operação resolve somente quando a transação é CONCLUÍDA (oncomplete): nada é anunciado como salvo antes disso.

const DB_NAME = 'project3ds-assets';
const RECORD_VERSION = 1;

const CATEGORIES = [
	{ id: 'furniture', name: 'Mobiliário' },
	{ id: 'equipment', name: 'Equipamentos' },
	{ id: 'structures', name: 'Estruturas' },
	{ id: 'decor', name: 'Decoração' },
	{ id: 'architecture', name: 'Elementos arquitetônicos' },
	{ id: 'others', name: 'Outros' }
];

const LIMITS = { name: 80, keywords: 12, keyword: 30, licenseField: 200, notes: 600 };

class AssetStorageError extends Error {

	constructor( code, message ) {

		super( message );
		this.name = 'AssetStorageError';
		this.code = code;

	}

}

function categoryName( id ) {

	const category = CATEGORIES.find( ( c ) => c.id === id );
	return category !== undefined ? category.name : 'Outros';

}

function cleanText( value, max ) {

	if ( typeof value !== 'string' ) return '';
	let out = '';
	for ( const char of value ) out += char.codePointAt( 0 ) < 32 ? ' ' : char;
	return Array.from( out.replace( /\s+/g, ' ' ).trim() ).slice( 0, max ).join( '' );

}

function cleanLicense( value ) {

	const v = value !== null && typeof value === 'object' ? value : {};
	return {
		author: cleanText( v.author, LIMITS.licenseField ),
		source: cleanText( v.source, LIMITS.licenseField ),
		url: cleanText( v.url, LIMITS.licenseField ), // apenas texto informativo: nunca aberto nem carregado
		license: cleanText( v.license, LIMITS.licenseField ),
		notes: cleanText( v.notes, LIMITS.notes )
	};

}

function cleanKeywords( value ) {

	const list = Array.isArray( value ) ? value : ( typeof value === 'string' ? value.split( /[,;]/ ) : [] );
	return [ ...new Set( list.map( ( k ) => cleanText( k, LIMITS.keyword ).toLowerCase() ).filter( Boolean ) ) ].slice( 0, LIMITS.keywords );

}

function mapError( error ) {

	if ( error instanceof AssetStorageError ) return error;
	const name = error && error.name;
	if ( name === 'QuotaExceededError' ) return new AssetStorageError( 'quota', 'Espaço de armazenamento do navegador insuficiente para salvar o modelo.' );
	return new AssetStorageError( 'failed', 'Falha ao gravar no armazenamento local do navegador.' );

}

function ExternalModelStorage() {

	let dbPromise = null;

	function open() {

		if ( dbPromise !== null ) return dbPromise;

		dbPromise = new Promise( ( resolve, reject ) => {

			if ( typeof indexedDB === 'undefined' ) return reject( new AssetStorageError( 'unavailable', 'O armazenamento local (IndexedDB) não está disponível neste navegador.' ) );

			let request;
			try {

				request = indexedDB.open( DB_NAME );

			} catch ( error ) {

				return reject( new AssetStorageError( 'unavailable', 'O armazenamento local (IndexedDB) não está disponível neste navegador.' ) );

			}

			request.onupgradeneeded = () => {

				const db = request.result;
				if ( db.objectStoreNames.contains( 'models' ) === false ) db.createObjectStore( 'models', { keyPath: 'id' } );
				if ( db.objectStoreNames.contains( 'files' ) === false ) db.createObjectStore( 'files', { keyPath: 'id' } );

			};

			request.onsuccess = () => {

				const db = request.result;
				if ( db.objectStoreNames.contains( 'models' ) && db.objectStoreNames.contains( 'files' ) ) return resolve( db );

				// banco existente sem as tabelas (criado por outra ferramenta): nova versão só para criá-las
				const version = db.version + 1;
				db.close();
				const upgrade = indexedDB.open( DB_NAME, version );
				upgrade.onupgradeneeded = () => {

					const target = upgrade.result;
					if ( target.objectStoreNames.contains( 'models' ) === false ) target.createObjectStore( 'models', { keyPath: 'id' } );
					if ( target.objectStoreNames.contains( 'files' ) === false ) target.createObjectStore( 'files', { keyPath: 'id' } );

				};

				upgrade.onsuccess = () => resolve( upgrade.result );
				upgrade.onerror = () => reject( new AssetStorageError( 'unavailable', 'Não foi possível preparar o armazenamento de modelos.' ) );

			};

			request.onerror = () => reject( new AssetStorageError( 'unavailable', 'Não foi possível abrir o armazenamento de modelos.' ) );
			request.onblocked = () => reject( new AssetStorageError( 'unavailable', 'O armazenamento de modelos está bloqueado por outra aba.' ) );

		} );

		dbPromise.catch( () => {

			dbPromise = null;

		} );
		return dbPromise;

	}

	// executa work(stores) numa transação; resolve com o resultado SOMENTE após oncomplete
	async function run( names, mode, work ) {

		const db = await open();
		return new Promise( ( resolve, reject ) => {

			let tx;
			try {

				tx = db.transaction( names, mode );

			} catch ( error ) {

				return reject( mapError( error ) );

			}

			const stores = {};
			for ( const name of names ) stores[ name ] = tx.objectStore( name );
			let result, failure = null;

			Promise.resolve().then( () => work( stores ) ).then( ( value ) => {

				result = value;

			} ).catch( ( error ) => {

				failure = error;
				try {

					tx.abort();

				} catch ( e ) { /* já encerrada */ }

			} );

			tx.oncomplete = () => failure !== null ? reject( mapError( failure ) ) : resolve( result );
			tx.onabort = () => reject( mapError( failure || tx.error ) );
			tx.onerror = () => {};

		} );

	}

	const request = ( req ) => new Promise( ( resolve, reject ) => {

		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error );

	} );

	function sanitizeRecord( record ) {

		if ( record === null || typeof record !== 'object' || typeof record.id !== 'string' ) return null;
		const dims = Array.isArray( record.dimensions ) && record.dimensions.length === 3 && record.dimensions.every( ( v ) => Number.isFinite( v ) && v >= 0 ) ? record.dimensions : null;
		if ( dims === null || [ 'glb', 'gltf' ].includes( record.format ) === false ) return null; // registro corrompido: não listado
		return Object.assign( {}, record, {
			name: cleanText( record.name, LIMITS.name ) || 'Modelo',
			category: CATEGORIES.some( ( c ) => c.id === record.category ) ? record.category : 'others',
			keywords: cleanKeywords( record.keywords ),
			license: cleanLicense( record.license ),
			thumbnail: typeof record.thumbnail === 'string' && record.thumbnail.startsWith( 'data:image/jpeg;base64,' ) && record.thumbnail.length < 300000 ? record.thumbnail : null
		} );

	}

	async function list() {

		const records = await run( [ 'models' ], 'readonly', ( s ) => request( s.models.getAll() ) );
		const valid = [], corrupted = [];
		for ( const record of records ) {

			const clean = sanitizeRecord( record );
			if ( clean === null ) corrupted.push( record && record.id );
			else valid.push( clean );

		}

		return { records: valid.sort( ( a, b ) => a.name.localeCompare( b.name, 'pt-BR' ) ), corrupted };

	}

	async function get( id ) {

		return sanitizeRecord( await run( [ 'models' ], 'readonly', ( s ) => request( s.models.get( id ) ) ) );

	}

	async function getFiles( id ) {

		const entry = await run( [ 'files' ], 'readonly', ( s ) => request( s.files.get( id ) ) );
		if ( entry === undefined || Array.isArray( entry.files ) === false || entry.files.length === 0 ) throw new AssetStorageError( 'missing', 'Os arquivos do modelo não foram encontrados no armazenamento (registro incompleto).' );
		return entry.files.map( ( file ) => new File( [ file.data ], file.name, { type: file.type || 'application/octet-stream' } ) );

	}

	async function findByHash( hash ) {

		const { records } = await list();
		return records.filter( ( record ) => record.hash === hash );

	}

	// grava metadados e arquivos numa única transação
	async function put( record, files ) {

		const entry = { id: record.id, files: [] };
		for ( const file of files ) entry.files.push( { name: file.name, type: file.type || '', size: file.size, data: file instanceof Blob ? file : new Blob( [ file ] ) } );
		const clean = Object.assign( {}, record, {
			version: RECORD_VERSION,
			name: cleanText( record.name, LIMITS.name ) || 'Modelo',
			category: CATEGORIES.some( ( c ) => c.id === record.category ) ? record.category : 'others',
			keywords: cleanKeywords( record.keywords ),
			license: cleanLicense( record.license ),
			updatedAt: Date.now()
		} );
		await run( [ 'models', 'files' ], 'readwrite', ( s ) => {

			s.models.put( clean );
			s.files.put( entry );

		} );
		return clean;

	}

	// metadados apenas (nome, categoria, palavras-chave, licença, padrões de escala/orientação)
	async function update( id, patch ) {

		return run( [ 'models' ], 'readwrite', async ( s ) => {

			const current = await request( s.models.get( id ) );
			if ( current === undefined ) throw new AssetStorageError( 'missing', 'O modelo não existe mais na biblioteca.' );
			const next = Object.assign( {}, current, patch, { id, updatedAt: Date.now() } );
			if ( patch.name !== undefined ) next.name = cleanText( patch.name, LIMITS.name ) || current.name;
			if ( patch.category !== undefined ) next.category = CATEGORIES.some( ( c ) => c.id === patch.category ) ? patch.category : current.category;
			if ( patch.keywords !== undefined ) next.keywords = cleanKeywords( patch.keywords );
			if ( patch.license !== undefined ) next.license = cleanLicense( patch.license );
			s.models.put( next );
			return next;

		} );

	}

	async function remove( id ) {

		return run( [ 'models', 'files' ], 'readwrite', ( s ) => {

			s.models.delete( id );
			s.files.delete( id );

		} );

	}

	return { open, list, get, getFiles, findByHash, put, update, remove, sanitizeRecord, DB_NAME };

}

export { ExternalModelStorage, AssetStorageError, CATEGORIES as MODEL_CATEGORIES, LIMITS as MODEL_RECORD_LIMITS, categoryName, cleanText as cleanModelText, cleanKeywords, cleanLicense };
