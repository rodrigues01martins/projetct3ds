// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Backup externo (.zip próprio do Project3DS, compactado com o fflate já presente no repositório):
//
//   manifest.json                         { format: 'project3ds-backup', formatVersion: 1, createdAt, app, projects: [ … ] }
//   projects/<id>/project.json            metadados do projeto (nome, datas, origem, descrição, miniatura)
//   projects/<id>/state.json              estado atual (mesmo formato do JSON do editor — pode ser aberto à parte)
//   projects/<id>/versions/<versionId>.json   versões incluídas
//
// O manifesto lista cada arquivo com tamanho e SHA-256; a importação recalcula e compara (integridade VERIFICADA
// somente quando o hash confere). A exportação JSON individual do editor continua igual e independente.
//
// Importação segura: limite de tamanho do arquivo, de quantidade e de tamanho descompactado das entradas (checado
// antes de descompactar), caminhos restritos ao padrão acima (sem "..", barras iniciais ou referências externas),
// nenhum script executado, JSON de cada projeto validado. Cada projeto é importado numa transação própria; o resumo
// informa o que entrou e o que falhou, sem tocar nos projetos existentes (conflito de ID nunca sobrescreve sozinho).

import { zipSync, unzipSync, strToU8, strFromU8 } from '../../examples/jsm/libs/fflate.module.js';

import { parseState, createRecord, cleanName, cleanText, uniqueName, withProjectMeta, contentKey, digest, byteSize, newProjectId, PROJECT_SCHEMA } from './SimpleMode.ProjectData.js';

const FORMAT = 'project3ds-backup';
const FORMAT_VERSION = 1;
const LIMITS = { fileBytes: 300 * 1024 * 1024, entries: 5000, entryBytes: 200 * 1024 * 1024, totalBytes: 800 * 1024 * 1024 };
const PATH = /^(manifest\.json|projects\/[0-9a-f-]{36}\/(project\.json|state\.json|versions\/[0-9a-f-]{36}\.json))$/;

class BackupError extends Error {}

function projectMeta( project ) {

	return {
		id: project.id,
		name: project.name,
		description: project.description || '',
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		lastOpenedAt: project.lastOpenedAt,
		sourceTemplate: project.sourceTemplate || null,
		schemaVersion: project.schemaVersion || PROJECT_SCHEMA,
		thumbnail: typeof project.thumbnail === 'string' && project.thumbnail.startsWith( 'data:image/jpeg' ) && project.thumbnail.length < 200000 ? project.thumbnail : null
	};

}

// exportação ------------------------------------------------------------------------------------------------------

// ids: projetos incluídos; withVersions: inclui as versões. getLiveState(id) opcional devolve o estado vivo do projeto ativo
async function exportBackup( storage, ids, { withVersions = true, getLiveState = null } = {} ) {

	const files = {};
	const manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(), app: 'Project3DS', projects: [] };

	for ( const id of ids ) {

		const project = await storage.getProject( id );
		const record = await storage.getState( id );
		if ( project === undefined || record === undefined ) continue;

		const data = getLiveState !== null && getLiveState( id ) !== null ? getLiveState( id ) : record.data;
		const base = `projects/${id}/`;
		const entry = { id, name: project.name, files: [] };

		const add = async ( path, text, extra = {} ) => {

			files[ path ] = strToU8( text );
			entry.files.push( Object.assign( { path, size: files[ path ].length, sha256: await digest( text ) }, extra ) );

		};

		await add( base + 'project.json', JSON.stringify( projectMeta( project ) ), { role: 'project' } );
		await add( base + 'state.json', data, { role: 'state' } );

		if ( withVersions ) {

			const versions = ( await storage.listVersions( id ) ).sort( ( a, b ) => a.number - b.number );
			for ( const version of versions ) {

				const text = await storage.getVersionData( version.id );
				if ( text === undefined ) continue;
				await add( `${base}versions/${version.id}.json`, text, { role: 'version', version: { id: version.id, number: version.number, name: version.name, kind: version.kind, pinned: version.pinned === true, createdAt: version.createdAt } } );

			}

		}

		manifest.projects.push( entry );

	}

	files[ 'manifest.json' ] = strToU8( JSON.stringify( manifest, null, 1 ) );
	const zipped = zipSync( files, { level: 6 } );
	return { blob: new Blob( [ zipped ], { type: 'application/zip' } ), manifest };

}

// análise da importação ------------------------------------------------------------------------------------------------

async function readBackup( file ) {

	if ( file.size > LIMITS.fileBytes ) throw new BackupError( 'Arquivo grande demais para importar (limite de 300 MB).' );

	const bytes = new Uint8Array( await file.arrayBuffer() );
	if ( bytes[ 0 ] !== 0x50 || bytes[ 1 ] !== 0x4b ) throw new BackupError( 'O arquivo não é um backup do Project3DS (.zip).' );

	let count = 0, total = 0;
	const rejected = [];
	let entries;

	try {

		entries = unzipSync( bytes, {
			filter: ( info ) => {

				count ++;
				if ( count > LIMITS.entries ) throw new BackupError( 'O backup contém arquivos demais.' );
				if ( PATH.test( info.name ) === false ) {

					rejected.push( info.name );
					return false; // nada fora do formato é extraído

				}

				total += info.originalSize;
				if ( info.originalSize > LIMITS.entryBytes || total > LIMITS.totalBytes ) throw new BackupError( 'O conteúdo descompactado do backup excede o limite seguro.' );
				return true;

			}
		} );

	} catch ( error ) {

		if ( error instanceof BackupError ) throw error;
		throw new BackupError( 'O arquivo .zip está corrompido ou incompleto.' );

	}

	if ( entries[ 'manifest.json' ] === undefined ) throw new BackupError( 'Manifesto ausente: o arquivo não é um backup do Project3DS.' );

	let manifest;
	try {

		manifest = JSON.parse( strFromU8( entries[ 'manifest.json' ] ) );

	} catch ( error ) {

		throw new BackupError( 'Manifesto corrompido.' );

	}

	if ( manifest.format !== FORMAT ) throw new BackupError( 'Formato de backup desconhecido.' );
	if ( manifest.formatVersion !== FORMAT_VERSION ) throw new BackupError( `Versão de backup não suportada (${manifest.formatVersion}).` );
	if ( Array.isArray( manifest.projects ) === false ) throw new BackupError( 'Manifesto sem lista de projetos.' );

	const projects = [];

	for ( const entry of manifest.projects.slice( 0, 1000 ) ) {

		const result = { id: entry && entry.id, name: cleanText( entry && entry.name, 80 ) || 'Projeto', problems: [], meta: null, state: null, versions: [], verified: true };
		projects.push( result );

		if ( typeof result.id !== 'string' || /^[0-9a-f-]{36}$/.test( result.id ) === false ) {

			result.problems.push( 'Identificador inválido.' );
			continue;

		}

		for ( const fileInfo of Array.isArray( entry.files ) ? entry.files : [] ) {

			if ( typeof fileInfo.path !== 'string' || fileInfo.path.startsWith( `projects/${result.id}/` ) === false ) {

				result.problems.push( 'Caminho inesperado no manifesto.' );
				continue;

			}

			const raw = entries[ fileInfo.path ];
			if ( raw === undefined ) {

				result.problems.push( `Arquivo ausente: ${fileInfo.path}` );
				continue;

			}

			const text = strFromU8( raw );
			const hash = await digest( text );
			if ( hash !== fileInfo.sha256 ) {

				result.problems.push( `Integridade não confere: ${fileInfo.path}` );
				continue;

			}

			if ( fileInfo.role === 'project' ) {

				try {

					result.meta = JSON.parse( text );

				} catch ( error ) {

					result.problems.push( 'Metadados corrompidos.' );

				}

			} else if ( fileInfo.role === 'state' ) {

				const parsed = parseState( text );
				if ( parsed.error !== null ) result.problems.push( 'Estado inválido: ' + parsed.error );
				else result.state = text;

			} else if ( fileInfo.role === 'version' ) {

				const parsed = parseState( text );
				if ( parsed.error !== null ) result.problems.push( `Versão ${fileInfo.version && fileInfo.version.number} inválida.` );
				else result.versions.push( { info: fileInfo.version || {}, data: text } );

			}

		}

		if ( result.state === null ) result.problems.push( 'Estado do projeto ausente ou inválido.' );
		result.valid = result.state !== null;

	}

	return { manifest, projects, rejected };

}

// importação de um projeto analisado: mode 'new' (sem conflito), 'copy' (novo ID) ou 'replace' (explícito)
async function importAnalyzed( storage, item, mode, existingNames ) {

	const id = mode === 'copy' ? newProjectId() : item.id;
	const meta = item.meta || {};
	const baseName = cleanName( meta.name || item.name );
	const name = mode === 'replace' ? baseName : uniqueName( mode === 'copy' ? `${baseName} — Importado` : baseName, existingNames );

	const prepare = async ( text ) => {

		const json = withProjectMeta( JSON.parse( text ), { id } );
		const data = JSON.stringify( json );
		return { data, hash: await digest( data ), contentHash: await digest( contentKey( json ) ), size: byteSize( data ), savedAt: Date.now() };

	};

	const state = await prepare( item.state );
	const record = Object.assign( createRecord( { id, name, description: meta.description, sourceTemplate: meta.sourceTemplate || null } ), {
		createdAt: Number.isFinite( meta.createdAt ) ? meta.createdAt : Date.now(),
		updatedAt: state.savedAt,
		size: state.size,
		contentHash: state.contentHash,
		thumbnail: typeof meta.thumbnail === 'string' && meta.thumbnail.startsWith( 'data:image/jpeg' ) ? meta.thumbnail : null
	} );

	const versions = [];
	for ( const version of item.versions ) {

		const prepared = await prepare( version.data );
		versions.push( {
			meta: {
				id: newProjectId(), // IDs novos: nunca colidem com versões existentes
				name: cleanText( version.info.name, 80 ) || 'Versão importada',
				kind: [ 'manual', 'auto', 'recovery' ].includes( version.info.kind ) ? version.info.kind : 'manual',
				pinned: version.info.pinned === true,
				createdAt: Number.isFinite( version.info.createdAt ) ? version.info.createdAt : Date.now(),
				size: prepared.size,
				hash: prepared.hash,
				contentHash: prepared.contentHash,
				thumbnail: null,
				imported: true
			},
			data: prepared.data
		} );

	}

	return storage.importProject( record, state, versions, { replace: mode === 'replace' } );

}

export { exportBackup, readBackup, importAnalyzed, BackupError, FORMAT as BACKUP_FORMAT, FORMAT_VERSION as BACKUP_FORMAT_VERSION, LIMITS as BACKUP_LIMITS };
