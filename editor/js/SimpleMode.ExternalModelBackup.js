// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Backup da BIBLIOTECA de modelos importados (independente do backup de projetos da EV-011, que já leva as
// instâncias inseridas dentro de cada projeto):
//
//   manifest.json                         { format: 'project3ds-model-library', formatVersion: 1, createdAt, models: [
//                                           { id, name, files: [ { path, role, size, sha256 } ] } ] }
//   models/<id>/model.json                metadados (nome, categoria, palavras-chave, padrões, licença, miniatura)
//   models/<id>/files/<nome>              arquivo original e auxiliares
//
// Importação: limites de tamanho, caminhos restritos ao padrão, SHA-256 conferido, estrutura glTF revalidada;
// duplicados detectados por identificador ou hash — nada é sobrescrito sem escolha explícita.

import { zipSync, unzipSync, strToU8, strFromU8 } from '../../examples/jsm/libs/fflate.module.js';

import { digestBytes } from './SimpleMode.ShareData.js';
import { inspectFiles, getLimits, ModelError } from './SimpleMode.ExternalModelValidation.js';
import { cleanModelText, cleanKeywords, cleanLicense, MODEL_CATEGORIES } from './SimpleMode.ExternalModelStorage.js';
import { sanitizeSettings } from './SimpleMode.ExternalModelTransforms.js';
import { newId } from './SimpleMode.ReviewData.js';

const FORMAT = 'project3ds-model-library';
const FORMAT_VERSION = 1;
const LIMITS = { zipBytes: 1024 * 1024 * 1024, entries: 4000, entryBytes: 120 * 1024 * 1024, totalBytes: 1536 * 1024 * 1024, models: 500 };
const ID = '[A-Za-z0-9_-]{1,64}';
const PATH = new RegExp( `^(manifest\\.json|models/${ID}/model\\.json|models/${ID}/files/[^/\\\\]{1,120})$` );

async function exportLibrary( library, records ) {

	const files = {};
	const manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(), app: 'Project3DS', models: [] };

	for ( const record of records ) {

		const stored = await library.storage.getFiles( record.id );
		const entry = { id: record.id, name: record.name, files: [] };
		const base = `models/${record.id}/`;
		const meta = strToU8( JSON.stringify( record ) );
		files[ base + 'model.json' ] = meta;
		entry.files.push( { path: base + 'model.json', role: 'meta', size: meta.length, sha256: await digestBytes( meta ) } );

		for ( const file of stored ) {

			const bytes = new Uint8Array( await file.arrayBuffer() );
			const path = base + 'files/' + file.name.replace( /[/\\]/g, '_' );
			files[ path ] = bytes;
			entry.files.push( { path, role: file.name === record.mainFile ? 'main' : 'aux', size: bytes.length, sha256: await digestBytes( bytes ) } );

		}

		manifest.models.push( entry );

	}

	files[ 'manifest.json' ] = strToU8( JSON.stringify( manifest, null, 1 ) );
	return { blob: new Blob( [ zipSync( files, { level: 0 } ) ], { type: 'application/zip' } ), manifest };

}

// lê e valida um backup -> { models: [ { id, record, files, problems, valid, duplicate } ] }
async function readLibraryBackup( file, library, config ) {

	if ( file.size > LIMITS.zipBytes ) throw new ModelError( 'Backup grande demais para importar.' );
	const bytes = new Uint8Array( await file.arrayBuffer() );
	if ( bytes[ 0 ] !== 0x50 || bytes[ 1 ] !== 0x4b ) throw new ModelError( 'O arquivo não é um backup de modelos do Project3DS (.zip).' );

	let count = 0, total = 0;
	let entries;
	try {

		entries = unzipSync( bytes, { filter: ( info ) => {

			count ++;
			if ( count > LIMITS.entries ) throw new ModelError( 'O backup contém arquivos demais.' );
			if ( PATH.test( info.name ) === false ) return false;
			total += info.originalSize;
			if ( info.originalSize > LIMITS.entryBytes || total > LIMITS.totalBytes ) throw new ModelError( 'O conteúdo descompactado do backup excede o limite seguro.' );
			return true;

		} } );

	} catch ( error ) {

		if ( error instanceof ModelError ) throw error;
		throw new ModelError( 'O arquivo .zip está corrompido ou incompleto.' );

	}

	let manifest;
	try {

		manifest = JSON.parse( strFromU8( entries[ 'manifest.json' ] || new Uint8Array() ) );

	} catch ( error ) {

		throw new ModelError( 'Manifesto ausente ou corrompido: o arquivo não é um backup de modelos.' );

	}

	if ( manifest === null || manifest.format !== FORMAT ) throw new ModelError( 'O arquivo não é um backup da biblioteca de modelos do Project3DS.' );
	if ( manifest.formatVersion !== FORMAT_VERSION ) throw new ModelError( `Versão de backup não suportada (${String( manifest.formatVersion ).slice( 0, 10 )}).` );
	if ( Array.isArray( manifest.models ) === false ) throw new ModelError( 'Manifesto sem a lista de modelos.' );

	const existing = library.getRecords();
	const limits = getLimits( config );
	const models = [];

	for ( const entry of manifest.models.slice( 0, LIMITS.models ) ) {

		const item = { id: entry && entry.id, name: cleanModelText( entry && entry.name, 80 ) || 'Modelo', problems: [], files: [], record: null, valid: false, duplicate: null };
		models.push( item );
		if ( typeof item.id !== 'string' || new RegExp( `^${ID}$` ).test( item.id ) === false ) {

			item.problems.push( 'Identificador inválido.' );
			continue;

		}

		for ( const info of Array.isArray( entry.files ) ? entry.files : [] ) {

			if ( typeof info.path !== 'string' || info.path.startsWith( `models/${item.id}/` ) === false || entries[ info.path ] === undefined ) {

				item.problems.push( `Arquivo ausente ou fora do padrão: ${String( info.path ).slice( 0, 80 )}` );
				continue;

			}

			const raw = entries[ info.path ];
			if ( raw.length !== info.size || await digestBytes( raw ) !== info.sha256 ) {

				item.problems.push( `Integridade não confere: ${info.path.split( '/' ).pop()}` );
				continue;

			}

			if ( info.role === 'meta' ) {

				try {

					item.record = JSON.parse( strFromU8( raw ) );

				} catch ( error ) {

					item.problems.push( 'Metadados corrompidos.' );

				}

			} else {

				item.files.push( { file: new File( [ raw ], info.path.split( '/' ).pop() ), role: info.role } );

			}

		}

		const record = item.record;
		if ( record === null || typeof record !== 'object' ) {

			item.problems.push( 'Metadados ausentes.' );
			continue;

		}

		const main = item.files.find( ( f ) => f.role === 'main' );
		if ( main === undefined ) {

			item.problems.push( 'Arquivo principal ausente.' );
			continue;

		}

		try {

			await inspectFiles( item.files.map( ( f ) => f.file ), limits ); // estrutura glTF, caminhos e recursos

		} catch ( error ) {

			item.problems.push( error.message + ( error.details && error.details.length ? ' ' + error.details.join( '; ' ) : '' ) );
			continue;

		}

		const dims = Array.isArray( record.dimensions ) && record.dimensions.length === 3 && record.dimensions.every( ( v ) => Number.isFinite( v ) && v > 0 ) ? record.dimensions : null;
		if ( dims === null ) {

			item.problems.push( 'Dimensões ausentes nos metadados.' );
			continue;

		}

		item.valid = true;
		item.duplicate = existing.find( ( r ) => r.id === item.id ) || ( typeof record.hash === 'string' ? existing.find( ( r ) => r.hash === record.hash ) : undefined ) || null;

	}

	return { manifest, models };

}

// importa um item validado. mode: 'new' | 'copy' | 'replace'
async function importLibraryItem( library, item, mode ) {

	const source = item.record;
	const id = mode === 'copy' || ( mode === 'new' && library.getRecord( item.id ) !== null ) ? newId() : item.id;
	if ( mode === 'replace' && item.duplicate !== null && item.duplicate.id !== id ) await library.storage.remove( item.duplicate.id );
	const record = {
		id,
		name: cleanModelText( source.name, 80 ) + ( mode === 'copy' ? ' (cópia)' : '' ),
		category: MODEL_CATEGORIES.some( ( c ) => c.id === source.category ) ? source.category : 'others',
		keywords: cleanKeywords( source.keywords ),
		format: source.format === 'gltf' ? 'gltf' : 'glb',
		originalName: cleanModelText( source.originalName, 120 ) || item.files.find( ( f ) => f.role === 'main' ).file.name,
		mainFile: item.files.find( ( f ) => f.role === 'main' ).file.name,
		auxNames: item.files.filter( ( f ) => f.role === 'aux' ).map( ( f ) => f.file.name ),
		hash: typeof source.hash === 'string' ? source.hash : null,
		size: item.files.reduce( ( sum, f ) => sum + f.file.size, 0 ),
		dimensions: source.dimensions.slice(),
		defaults: sanitizeSettings( source.defaults ),
		stats: source.stats && typeof source.stats === 'object' ? { meshes: source.stats.meshes | 0, vertices: source.stats.vertices | 0, triangles: source.stats.triangles | 0, materials: source.stats.materials | 0, textures: source.stats.textures | 0 } : { meshes: 0, vertices: 0, triangles: 0, materials: 0, textures: 0 },
		license: cleanLicense( source.license ),
		thumbnail: typeof source.thumbnail === 'string' && source.thumbnail.startsWith( 'data:image/jpeg;base64,' ) && source.thumbnail.length < 300000 ? source.thumbnail : null,
		importedAt: Number.isFinite( source.importedAt ) ? source.importedAt : Date.now()
	};

	const main = item.files.find( ( f ) => f.role === 'main' ).file;
	return library.storage.put( record, [ main, ...item.files.filter( ( f ) => f.role === 'aux' ).map( ( f ) => f.file ) ] );

}

export { exportLibrary, readLibraryBackup, importLibraryItem, FORMAT as MODEL_BACKUP_FORMAT };
