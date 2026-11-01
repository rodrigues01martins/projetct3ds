// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Biblioteca modular em banco IndexedDB PRÓPRIO, "project3ds-assemblies" (nenhum registro de project3ds-library,
// project3ds-assets ou project3ds-projects é alterado):
//   assemblies   (keyPath id)  metadados: { id, version, name, category, keywords, dimensions, componentCount,
//                              dependencies, thumbnail, createdAt, updatedAt, size }
//   definitions  (keyPath id)  { id, data } — definição 'project3ds-modular-assembly' em texto (lida só ao usar)
// Operações em transação única; a promessa só resolve no oncomplete (nada é anunciado como salvo antes).

import { ASSEMBLY_CATEGORIES, ASSEMBLY_LIMITS, cleanText } from './SimpleMode.AssemblyData.js';

const DB_NAME = 'project3ds-assemblies';
const RECORD_VERSION = 1;

class AssemblyStorageError extends Error {

	constructor( code, message ) {

		super( message );
		this.name = 'AssemblyStorageError';
		this.code = code;

	}

}

function mapError( error ) {

	if ( error instanceof AssemblyStorageError ) return error;
	if ( error && error.name === 'QuotaExceededError' ) return new AssemblyStorageError( 'quota', 'Espaço de armazenamento do navegador insuficiente para salvar o conjunto.' );
	return new AssemblyStorageError( 'failed', ( error && error.message ) || 'Falha ao gravar no armazenamento local do navegador.' );

}

function cleanKeywords( value ) {

	const list = Array.isArray( value ) ? value : ( typeof value === 'string' ? value.split( /[,;]/ ) : [] );
	return [ ...new Set( list.map( ( k ) => cleanText( k, 30 ).toLowerCase() ).filter( Boolean ) ) ].slice( 0, ASSEMBLY_LIMITS.keywords );

}

function sanitizeRecord( record ) {

	if ( record === null || typeof record !== 'object' || typeof record.id !== 'string' ) return null;
	if ( Array.isArray( record.dimensions ) === false || record.dimensions.length !== 3 || record.dimensions.some( ( v ) => Number.isFinite( v ) === false ) ) return null;
	return Object.assign( {}, record, {
		name: cleanText( record.name, ASSEMBLY_LIMITS.name ) || 'Conjunto',
		category: ASSEMBLY_CATEGORIES.some( ( c ) => c.id === record.category ) ? record.category : 'others',
		keywords: cleanKeywords( record.keywords ),
		dependencies: Array.isArray( record.dependencies ) ? record.dependencies : [],
		componentCount: Number.isInteger( record.componentCount ) ? record.componentCount : 0,
		thumbnail: typeof record.thumbnail === 'string' && record.thumbnail.startsWith( 'data:image/jpeg;base64,' ) && record.thumbnail.length < 300000 ? record.thumbnail : null
	} );

}

function AssemblyStorage() {

	let dbPromise = null;

	function open() {

		if ( dbPromise !== null ) return dbPromise;
		dbPromise = new Promise( ( resolve, reject ) => {

			if ( typeof indexedDB === 'undefined' ) return reject( new AssemblyStorageError( 'unavailable', 'O armazenamento local (IndexedDB) não está disponível neste navegador.' ) );
			const create = ( db ) => {

				if ( db.objectStoreNames.contains( 'assemblies' ) === false ) db.createObjectStore( 'assemblies', { keyPath: 'id' } );
				if ( db.objectStoreNames.contains( 'definitions' ) === false ) db.createObjectStore( 'definitions', { keyPath: 'id' } );

			};

			const request = indexedDB.open( DB_NAME );
			request.onupgradeneeded = () => create( request.result );
			request.onsuccess = () => {

				const db = request.result;
				if ( db.objectStoreNames.contains( 'assemblies' ) && db.objectStoreNames.contains( 'definitions' ) ) return resolve( db );
				const version = db.version + 1;
				db.close();
				const upgrade = indexedDB.open( DB_NAME, version );
				upgrade.onupgradeneeded = () => create( upgrade.result );
				upgrade.onsuccess = () => resolve( upgrade.result );
				upgrade.onerror = () => reject( new AssemblyStorageError( 'unavailable', 'Não foi possível preparar a biblioteca modular.' ) );

			};

			request.onerror = () => reject( new AssemblyStorageError( 'unavailable', 'Não foi possível abrir a biblioteca modular.' ) );
			request.onblocked = () => reject( new AssemblyStorageError( 'unavailable', 'A biblioteca modular está bloqueada por outra aba.' ) );

		} );
		dbPromise.catch( () => {

			dbPromise = null;

		} );
		return dbPromise;

	}

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

		} );

	}

	const request = ( req ) => new Promise( ( resolve, reject ) => {

		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error );

	} );

	async function list() {

		const raw = await run( [ 'assemblies' ], 'readonly', ( s ) => request( s.assemblies.getAll() ) );
		const records = [], corrupted = [];
		for ( const item of raw ) {

			const clean = sanitizeRecord( item );
			if ( clean === null ) corrupted.push( item && item.id );
			else records.push( clean );

		}

		return { records: records.sort( ( a, b ) => a.name.localeCompare( b.name, 'pt-BR' ) ), corrupted };

	}

	async function getDefinition( id ) {

		const entry = await run( [ 'definitions' ], 'readonly', ( s ) => request( s.definitions.get( id ) ) );
		if ( entry === undefined || typeof entry.data !== 'string' ) throw new AssemblyStorageError( 'missing', 'A definição do conjunto não foi encontrada (registro incompleto).' );
		try {

			return JSON.parse( entry.data );

		} catch ( error ) {

			throw new AssemblyStorageError( 'corrupted', 'A definição do conjunto está corrompida.' );

		}

	}

	async function put( record, definition ) {

		const data = JSON.stringify( definition );
		if ( data.length > ASSEMBLY_LIMITS.definitionChars ) throw new AssemblyStorageError( 'size', 'O conjunto é grande demais para a biblioteca modular.' );
		const clean = Object.assign( {}, record, { version: RECORD_VERSION, name: cleanText( record.name, ASSEMBLY_LIMITS.name ) || 'Conjunto', keywords: cleanKeywords( record.keywords ), size: data.length, updatedAt: Date.now() } );
		await run( [ 'assemblies', 'definitions' ], 'readwrite', ( s ) => {

			s.assemblies.put( clean );
			s.definitions.put( { id: record.id, data } );

		} );
		return clean;

	}

	async function update( id, patch ) {

		return run( [ 'assemblies', 'definitions' ], 'readwrite', async ( s ) => {

			const current = await request( s.assemblies.get( id ) );
			if ( current === undefined ) throw new AssemblyStorageError( 'missing', 'O conjunto não existe mais na biblioteca.' );
			const next = Object.assign( {}, current, patch, { id, updatedAt: Date.now() } );
			if ( patch.name !== undefined ) next.name = cleanText( patch.name, ASSEMBLY_LIMITS.name ) || current.name;
			if ( patch.category !== undefined ) next.category = ASSEMBLY_CATEGORIES.some( ( c ) => c.id === patch.category ) ? patch.category : current.category;
			if ( patch.keywords !== undefined ) next.keywords = cleanKeywords( patch.keywords );
			s.assemblies.put( next );
			// a definição acompanha nome e categoria
			const definition = await request( s.definitions.get( id ) );
			if ( definition !== undefined ) {

				const data = JSON.parse( definition.data );
				data.name = next.name;
				data.category = next.category;
				data.keywords = next.keywords;
				s.definitions.put( { id, data: JSON.stringify( data ) } );

			}

			return next;

		} );

	}

	async function remove( id ) {

		return run( [ 'assemblies', 'definitions' ], 'readwrite', ( s ) => {

			s.assemblies.delete( id );
			s.definitions.delete( id );

		} );

	}

	return { open, list, getDefinition, put, update, remove, sanitizeRecord, DB_NAME };

}

export { AssemblyStorage, AssemblyStorageError, cleanKeywords as cleanAssemblyKeywords };
