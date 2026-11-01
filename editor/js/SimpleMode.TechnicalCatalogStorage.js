// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Catálogo técnico em banco IndexedDB PRÓPRIO, "project3ds-parts" (project3ds-library, -assets, -assemblies e
// -projects não são tocados):
//   parts          (keyPath catalogId)  ficha vigente (cópia da revisão mais recente) + { deletedAt: null }
//   revisions      (keyPath key = '<catalogId>@<revision>', índice catalogId)  revisões IMUTÁVEIS
//   compatibility  (keyPath id)  regras técnicas declaradas entre famílias de conectores
// Revisões são gravadas com add(): uma revisão existente nunca é sobrescrita (a transação inteira é abortada).
// Excluir uma ficha remove apenas a ficha vigente; as revisões históricas permanecem recuperáveis.
// Toda operação ocorre numa única transação e só resolve no oncomplete.

import { sanitizePart, sanitizeRule, revisionKey } from './SimpleMode.TechnicalCatalogData.js';

const DB_NAME = 'project3ds-parts';
const STORES = [ 'parts', 'revisions', 'compatibility' ];

class TechnicalStorageError extends Error {

	constructor( code, message ) {

		super( message );
		this.name = 'TechnicalStorageError';
		this.code = code;

	}

}

function mapError( error ) {

	if ( error instanceof TechnicalStorageError ) return error;
	if ( error && error.name === 'QuotaExceededError' ) return new TechnicalStorageError( 'quota', 'Espaço de armazenamento do navegador insuficiente para gravar o catálogo técnico.' );
	if ( error && error.name === 'ConstraintError' ) return new TechnicalStorageError( 'exists', 'Esta revisão da ficha já existe no catálogo e não pode ser sobrescrita.' );
	return new TechnicalStorageError( 'failed', ( error && error.message ) || 'Falha ao gravar o catálogo técnico no navegador.' );

}

function TechnicalCatalogStorage() {

	let dbPromise = null;

	function open() {

		if ( dbPromise !== null ) return dbPromise;
		dbPromise = new Promise( ( resolve, reject ) => {

			if ( typeof indexedDB === 'undefined' ) return reject( new TechnicalStorageError( 'unavailable', 'O armazenamento local (IndexedDB) não está disponível neste navegador.' ) );
			const create = ( db, tx ) => {

				if ( db.objectStoreNames.contains( 'parts' ) === false ) db.createObjectStore( 'parts', { keyPath: 'catalogId' } );
				if ( db.objectStoreNames.contains( 'revisions' ) === false ) db.createObjectStore( 'revisions', { keyPath: 'key' } ).createIndex( 'catalogId', 'catalogId', { unique: false } );
				else if ( tx && tx.objectStore( 'revisions' ).indexNames.contains( 'catalogId' ) === false ) tx.objectStore( 'revisions' ).createIndex( 'catalogId', 'catalogId', { unique: false } );
				if ( db.objectStoreNames.contains( 'compatibility' ) === false ) db.createObjectStore( 'compatibility', { keyPath: 'id' } );

			};

			const complete = ( db ) => STORES.every( ( s ) => db.objectStoreNames.contains( s ) );
			const request = indexedDB.open( DB_NAME );
			request.onupgradeneeded = () => create( request.result, request.transaction );
			request.onsuccess = () => {

				const db = request.result;
				if ( complete( db ) ) return resolve( db );
				const version = db.version + 1;
				db.close();
				const upgrade = indexedDB.open( DB_NAME, version );
				upgrade.onupgradeneeded = () => create( upgrade.result, upgrade.transaction );
				upgrade.onsuccess = () => resolve( upgrade.result );
				upgrade.onerror = () => reject( new TechnicalStorageError( 'unavailable', 'Não foi possível preparar o catálogo técnico.' ) );

			};

			request.onerror = () => reject( new TechnicalStorageError( 'unavailable', 'Não foi possível abrir o catálogo técnico.' ) );
			request.onblocked = () => reject( new TechnicalStorageError( 'unavailable', 'O catálogo técnico está bloqueado por outra aba.' ) );

		} );
		dbPromise.catch( () => {

			dbPromise = null;

		} );
		return dbPromise;

	}

	const request = ( req ) => new Promise( ( resolve, reject ) => {

		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error );

	} );

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
			tx.oncomplete = () => ( failure !== null ? reject( mapError( failure ) ) : resolve( result ) );
			tx.onabort = () => reject( mapError( failure || tx.error ) );

		} );

	}

	// carrega tudo, saneando; registros corrompidos são ignorados e informados (nunca apagados automaticamente)
	async function loadAll() {

		const raw = await run( STORES, 'readonly', async ( s ) => ( {
			parts: await request( s.parts.getAll() ),
			revisions: await request( s.revisions.getAll() ),
			rules: await request( s.compatibility.getAll() )
		} ) );

		const corrupted = [];
		const clean = ( item, fn ) => {

			try {

				return fn( item );

			} catch ( error ) {

				corrupted.push( item && ( item.catalogId || item.id || item.key ) );
				return null;

			}

		};

		const parts = raw.parts.map( ( p ) => clean( p, ( item ) => Object.assign( sanitizePart( item ), { deletedAt: null } ) ) ).filter( ( p ) => p !== null && p.catalogId !== null && p.revision >= 1 );
		const revisions = raw.revisions.map( ( r ) => clean( r, ( item ) => sanitizePart( item ) ) ).filter( ( r ) => r !== null && r.catalogId !== null && r.revision >= 1 );
		const rules = raw.rules.map( ( r ) => clean( r, sanitizeRule ) ).filter( Boolean );
		return { parts, revisions, rules, corrupted };

	}

	// grava uma nova revisão + ficha vigente (atômico; falha se a revisão já existir)
	async function commitRevision( record ) {

		await run( [ 'parts', 'revisions' ], 'readwrite', async ( s ) => {

			await request( s.revisions.add( Object.assign( { key: revisionKey( record.catalogId, record.revision ) }, record ) ) );
			await request( s.parts.put( Object.assign( {}, record ) ) );

		} );
		return record;

	}

	async function removePart( catalogId ) {

		await run( [ 'parts' ], 'readwrite', ( s ) => request( s.parts.delete( catalogId ) ) );

	}

	async function putRule( rule ) {

		await run( [ 'compatibility' ], 'readwrite', ( s ) => request( s.compatibility.put( Object.assign( {}, rule ) ) ) );
		return rule;

	}

	async function removeRule( id ) {

		await run( [ 'compatibility' ], 'readwrite', ( s ) => request( s.compatibility.delete( id ) ) );

	}

	// importação em lote: revisões novas (add), fichas vigentes e regras — tudo ou nada
	async function importBatch( { revisions = [], heads = [], rules = [] } ) {

		await run( STORES, 'readwrite', async ( s ) => {

			for ( const record of revisions ) await request( s.revisions.add( Object.assign( { key: revisionKey( record.catalogId, record.revision ) }, record ) ) );
			for ( const head of heads ) await request( s.parts.put( Object.assign( {}, head ) ) );
			for ( const rule of rules ) await request( s.compatibility.put( Object.assign( {}, rule ) ) );

		} );

	}

	return { open, loadAll, commitRevision, removePart, putRule, removeRule, importBatch };

}

export { TechnicalCatalogStorage, TechnicalStorageError, DB_NAME as TECHNICAL_DB_NAME };
