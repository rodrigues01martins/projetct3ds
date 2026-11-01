// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Pacote portátil de conjuntos: "<nome>.p3ds-assembly.zip"
//   manifest.json                       { format: 'project3ds-assembly-package', formatVersion: 1, createdAt,
//                                         assemblies: [ { id, name, files } ], models: [ { id, name, files } ] }
//   assemblies/<id>/meta.json           dimensões, quantidade de componentes, miniatura, datas
//   assemblies/<id>/definition.json     definição 'project3ds-modular-assembly' v1
//   models/<assetId>/model.json         metadados do modelo importado (EV-013) — UMA vez por modelo
//   models/<assetId>/files/<nome>       arquivo original e auxiliares
// Cada arquivo com SHA-256 conferido na importação. Projetos, versões e orçamentos NÃO entram no pacote.
// Importação: limites, caminhos restritos, hashes, estrutura glTF revalidada; modelos ausentes entram na
// biblioteca de modelos (duplicados por ID/hash reaproveitados); conjuntos existentes nunca são sobrescritos.

import { zipSync, unzipSync, strToU8, strFromU8 } from '../../examples/jsm/libs/fflate.module.js';

import { digestBytes } from './SimpleMode.ShareData.js';
import { inspectFiles, getLimits } from './SimpleMode.ExternalModelValidation.js';
import { sanitizeSettings } from './SimpleMode.ExternalModelTransforms.js';
import { MODEL_CATEGORIES, cleanModelText, cleanKeywords, cleanLicense } from './SimpleMode.ExternalModelStorage.js';
import { AssemblyError, validateDefinition } from './SimpleMode.AssemblyFactory.js';
import { safeFileName } from './SimpleMode.ProjectData.js';

const FORMAT = 'project3ds-assembly-package';
const FORMAT_VERSION = 1;
const LIMITS = { zipBytes: 512 * 1024 * 1024, entries: 2000, entryBytes: 120 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 };
const ID = '[A-Za-z0-9_-]{1,64}';
const PATH = new RegExp( `^(manifest\\.json|assemblies/${ID}/(meta|definition)\\.json|models/${ID}/model\\.json|models/${ID}/files/[^/\\\\]{1,120})$` );

async function exportAssemblies( assemblyLibrary, modelLibrary, records ) {

	const files = {};
	const manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(), app: 'Project3DS', assemblies: [], models: [] };
	const add = async ( entry, path, bytes, role ) => {

		files[ path ] = bytes;
		entry.files.push( { path, role, size: bytes.length, sha256: await digestBytes( bytes ) } );

	};

	const assetIds = new Set();
	for ( const record of records ) {

		const definition = await assemblyLibrary.definitionOf( record );
		const entry = { id: record.id, name: record.name, files: [] };
		const meta = { dimensions: record.dimensions, componentCount: record.componentCount, thumbnail: record.thumbnail, createdAt: record.createdAt, updatedAt: record.updatedAt };
		await add( entry, `assemblies/${record.id}/meta.json`, strToU8( JSON.stringify( meta ) ), 'meta' );
		await add( entry, `assemblies/${record.id}/definition.json`, strToU8( JSON.stringify( definition ) ), 'definition' );
		manifest.assemblies.push( entry );
		for ( const dependency of definition.dependencies ) if ( dependency.kind === 'reference' ) assetIds.add( dependency.assetId );

	}

	// modelos externos necessários: cada um UMA vez, mesmo que vários conjuntos o usem
	if ( assetIds.size > 0 && modelLibrary.isLoaded() === false ) await modelLibrary.load();
	const missing = [];
	for ( const assetId of assetIds ) {

		const record = modelLibrary.getRecord( assetId );
		if ( record === null ) {

			missing.push( assetId );
			continue;

		}

		const stored = await modelLibrary.storage.getFiles( record.id );
		const entry = { id: record.id, name: record.name, files: [] };
		await add( entry, `models/${record.id}/model.json`, strToU8( JSON.stringify( record ) ), 'meta' );
		for ( const file of stored ) await add( entry, `models/${record.id}/files/${file.name.replace( /[/\\]/g, '_' )}`, new Uint8Array( await file.arrayBuffer() ), file.name === record.mainFile ? 'main' : 'aux' );
		manifest.models.push( entry );

	}

	if ( missing.length > 0 ) throw new AssemblyError( 'Não é possível gerar um pacote portátil: modelos externos usados pelo conjunto não estão na biblioteca de modelos deste navegador.', missing );

	files[ 'manifest.json' ] = strToU8( JSON.stringify( manifest, null, 1 ) );
	const name = records.length === 1 ? safeFileName( records[ 0 ].name, '.p3ds-assembly.zip' ) : `conjuntos-project3ds-${new Date().toISOString().slice( 0, 10 )}.p3ds-assembly.zip`;
	return { blob: new Blob( [ zipSync( files, { level: 6 } ) ], { type: 'application/zip' } ), manifest, name };

}

async function readAssemblyPackage( file, config ) {

	if ( file.size > LIMITS.zipBytes ) throw new AssemblyError( 'Pacote grande demais para importar.' );
	const bytes = new Uint8Array( await file.arrayBuffer() );
	if ( bytes[ 0 ] !== 0x50 || bytes[ 1 ] !== 0x4b ) throw new AssemblyError( 'O arquivo não é um pacote de conjunto do Project3DS (.p3ds-assembly.zip).' );

	let count = 0, total = 0, entries;
	const rejected = [];
	try {

		entries = unzipSync( bytes, { filter: ( info ) => {

			count ++;
			if ( count > LIMITS.entries ) throw new AssemblyError( 'O pacote contém arquivos demais.' );
			if ( PATH.test( info.name ) === false ) {

				rejected.push( info.name );
				return false;

			}

			total += info.originalSize;
			if ( info.originalSize > LIMITS.entryBytes || total > LIMITS.totalBytes ) throw new AssemblyError( 'O conteúdo descompactado do pacote excede o limite seguro.' );
			return true;

		} } );

	} catch ( error ) {

		if ( error instanceof AssemblyError ) throw error;
		throw new AssemblyError( 'O arquivo .zip está corrompido ou incompleto.' );

	}

	if ( rejected.length > 0 ) throw new AssemblyError( `O pacote contém arquivos não permitidos (${rejected.slice( 0, 3 ).join( ', ' )}).` );

	let manifest;
	try {

		manifest = JSON.parse( strFromU8( entries[ 'manifest.json' ] || new Uint8Array() ) );

	} catch ( error ) {

		throw new AssemblyError( 'Manifesto ausente ou corrompido.' );

	}

	if ( manifest === null || manifest.format !== FORMAT ) throw new AssemblyError( 'O arquivo não é um pacote de conjunto do Project3DS.' );
	if ( manifest.formatVersion !== FORMAT_VERSION ) throw new AssemblyError( `Versão de pacote não suportada (${String( manifest.formatVersion ).slice( 0, 10 )}).` );
	if ( Array.isArray( manifest.assemblies ) === false || Array.isArray( manifest.models ) === false ) throw new AssemblyError( 'Manifesto incompleto.' );

	const verify = async ( info, prefix ) => {

		if ( typeof info.path !== 'string' || info.path.startsWith( prefix ) === false || entries[ info.path ] === undefined ) throw new AssemblyError( `Pacote incompleto: ${String( info.path ).slice( 0, 80 )}.` );
		const raw = entries[ info.path ];
		if ( raw.length !== info.size || await digestBytes( raw ) !== info.sha256 ) throw new AssemblyError( `Falha de integridade: ${info.path.split( '/' ).pop()} foi alterado ou corrompido.` );
		return raw;

	};

	const models = [];
	for ( const entry of manifest.models.slice( 0, 200 ) ) {

		if ( typeof entry.id !== 'string' || new RegExp( `^${ID}$` ).test( entry.id ) === false ) throw new AssemblyError( 'Modelo com identificador inválido no pacote.' );
		const item = { id: entry.id, record: null, files: [] };
		for ( const info of entry.files || [] ) {

			const raw = await verify( info, `models/${entry.id}/` );
			if ( info.role === 'meta' ) item.record = JSON.parse( strFromU8( raw ) );
			else item.files.push( { file: new File( [ raw ], info.path.split( '/' ).pop() ), role: info.role } );

		}

		if ( item.record === null || item.files.some( ( f ) => f.role === 'main' ) === false ) throw new AssemblyError( 'Modelo incompleto no pacote.' );
		await inspectFiles( item.files.map( ( f ) => f.file ), getLimits( config ) ); // estrutura glTF e recursos
		models.push( item );

	}

	const assemblies = [];
	for ( const entry of manifest.assemblies.slice( 0, 200 ) ) {

		if ( typeof entry.id !== 'string' || new RegExp( `^${ID}$` ).test( entry.id ) === false ) throw new AssemblyError( 'Conjunto com identificador inválido no pacote.' );
		let definition = null, meta = {};
		for ( const info of entry.files || [] ) {

			const raw = await verify( info, `assemblies/${entry.id}/` );
			const data = JSON.parse( strFromU8( raw ) );
			if ( info.role === 'definition' ) definition = data;
			else meta = data;

		}

		validateDefinition( definition );
		for ( const dependency of definition.dependencies ) {

			if ( dependency.kind === 'reference' && models.some( ( m ) => m.id === dependency.assetId ) === false ) throw new AssemblyError( `Dependência ausente no pacote: "${dependency.name}".` );

		}

		assemblies.push( { id: entry.id, definition, meta } );

	}

	return { manifest, models, assemblies };

}

// grava os modelos que faltam na biblioteca de modelos (mesmo ID ou mesmo hash: reaproveitado)
async function importModels( modelLibrary, models ) {

	if ( modelLibrary.isLoaded() === false ) await modelLibrary.load();
	let added = 0, reused = 0;
	for ( const item of models ) {

		const source = item.record;
		const existing = modelLibrary.getRecord( item.id ) || ( source.hash ? modelLibrary.getRecords().find( ( r ) => r.hash === source.hash ) : null );
		if ( existing ) {

			reused ++;
			continue;

		}

		const main = item.files.find( ( f ) => f.role === 'main' ).file;
		await modelLibrary.storage.put( {
			id: item.id,
			name: cleanModelText( source.name, 80 ) || 'Modelo',
			category: MODEL_CATEGORIES.some( ( c ) => c.id === source.category ) ? source.category : 'others',
			keywords: cleanKeywords( source.keywords ),
			format: source.format === 'gltf' ? 'gltf' : 'glb',
			originalName: cleanModelText( source.originalName, 120 ) || main.name,
			mainFile: main.name,
			auxNames: item.files.filter( ( f ) => f.role === 'aux' ).map( ( f ) => f.file.name ),
			hash: typeof source.hash === 'string' ? source.hash : null,
			size: item.files.reduce( ( sum, f ) => sum + f.file.size, 0 ),
			dimensions: Array.isArray( source.dimensions ) ? source.dimensions : [ 1, 1, 1 ],
			defaults: sanitizeSettings( source.defaults ),
			stats: source.stats || { meshes: 0, vertices: 0, triangles: 0, materials: 0, textures: 0 },
			license: cleanLicense( source.license ),
			thumbnail: typeof source.thumbnail === 'string' && source.thumbnail.startsWith( 'data:image/jpeg;base64,' ) ? source.thumbnail : null,
			importedAt: Number.isFinite( source.importedAt ) ? source.importedAt : Date.now()
		}, [ main, ...item.files.filter( ( f ) => f.role === 'aux' ).map( ( f ) => f.file ) ] );
		added ++;

	}

	if ( added > 0 ) await modelLibrary.load();
	return { added, reused };

}

export { exportAssemblies, readAssemblyPackage, importModels, FORMAT as ASSEMBLY_PACKAGE_FORMAT };
