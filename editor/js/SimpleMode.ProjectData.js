// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Esquemas, validações e utilidades dos projetos locais.
//
// Identidade: cada projeto tem um UUID estável (independente do nome), guardado no registro do projeto e gravado em
// toda serialização da cena em scene.userData.project3ds.project = { id, version } (ver ProjectManager). O nome é só
// um rótulo: renomear nunca cria outro projeto.
//
// Fonte de verdade:
//   - registro do projeto (metadados) + estado atual persistido  → o que "Abrir" carrega;
//   - versões                                                     → snapshots imutáveis (texto JSON congelado);
//   - rascunho                                                    → alterações ainda não gravadas no estado atual;
//   - estado de trabalho do editor (threejs-editor/states/0)      → cache da sessão, continua com o editor original.

import * as THREE from 'three';

const PROJECT_SCHEMA = 1;
const LIMITS = { name: 80, description: 240, versionName: 80, autoVersions: 10, recoveryVersions: 10 };
const DEFAULT_NAME = 'Projeto sem título';

function newProjectId() {

	return THREE.MathUtils.generateUUID();

}

function cleanText( value, max ) {

	return typeof value === 'string' ? Array.from( value, ( c ) => ( c.charCodeAt( 0 ) < 32 ? ' ' : c ) ).join( '' ).replace( /\s+/g, ' ' ).trim().slice( 0, max ) : '';

}

// nome válido: sem vazios nem excessos; colisões recebem sufixo " (2)", " (3)"… (projetos nunca se sobrescrevem)
function cleanName( value, fallback = DEFAULT_NAME ) {

	return cleanText( value, LIMITS.name ) || fallback;

}

function uniqueName( name, existing ) {

	const taken = new Set( existing.map( ( n ) => n.toLocaleLowerCase( 'pt-BR' ) ) );
	if ( taken.has( name.toLocaleLowerCase( 'pt-BR' ) ) === false ) return name;

	for ( let i = 2; i < 1000; i ++ ) {

		const candidate = cleanName( `${name} (${i})` );
		if ( taken.has( candidate.toLocaleLowerCase( 'pt-BR' ) ) === false ) return candidate;

	}

	return cleanName( name + ' ' + Date.now() );

}

function createRecord( { id = newProjectId(), name, description = '', sourceTemplate = null, now = Date.now() } = {} ) {

	return {
		id,
		name: cleanName( name ),
		description: cleanText( description, LIMITS.description ),
		createdAt: now,
		updatedAt: now,
		lastOpenedAt: now,
		revision: 0,
		sourceTemplate: sourceTemplate !== null && typeof sourceTemplate === 'object' ? { id: String( sourceTemplate.id || '' ).slice( 0, 60 ), name: cleanText( sourceTemplate.name, 80 ) } : null,
		schemaVersion: PROJECT_SCHEMA,
		deletedAt: null,
		size: 0,
		contentHash: null,
		thumbnail: null
	};

}

// estado serializado do editor (Editor.toJSON): estrutura mínima antes de qualquer substituição da cena
function validateState( json ) {

	if ( json === null || typeof json !== 'object' ) return 'O arquivo não é um projeto válido.';
	if ( json.scene === undefined || json.scene === null || typeof json.scene !== 'object' ) return 'O projeto não contém uma cena.';
	if ( json.scene.object === undefined || typeof json.scene.object !== 'object' ) return 'A cena do projeto está incompleta.';
	if ( json.camera === undefined || json.camera === null || typeof json.camera !== 'object' ) return 'O projeto não contém a câmera do editor.';
	if ( json.scene.metadata !== undefined && json.scene.metadata.type !== undefined && json.scene.metadata.type !== 'Object' ) return 'Formato de cena desconhecido.';
	return null;

}

function parseState( text ) {

	let json;

	try {

		json = typeof text === 'string' ? JSON.parse( text ) : text;

	} catch ( error ) {

		return { json: null, error: 'O conteúdo está corrompido (JSON inválido).' };

	}

	const problem = validateState( json );
	return problem === null ? { json, error: null } : { json: null, error: problem };

}

function projectMetaOf( json ) {

	const meta = json && json.scene && json.scene.object && json.scene.object.userData && json.scene.object.userData.project3ds;
	return meta && meta.project && typeof meta.project.id === 'string' ? meta.project : null;

}

// grava (cópia) a identidade no JSON serializado, sem tocar na cena viva
function withProjectMeta( json, project ) {

	const object = json.scene.object;
	const userData = Object.assign( {}, object.userData );
	const meta = Object.assign( {}, userData.project3ds );

	if ( project !== null ) meta.project = { id: project.id, version: PROJECT_SCHEMA };
	else delete meta.project;

	if ( Object.keys( meta ).length > 0 ) userData.project3ds = meta;
	else delete userData.project3ds;

	if ( Object.keys( userData ).length > 0 ) object.userData = userData;
	else delete object.userData;

	return json;

}

// conteúdo comparável (sem câmera/controles, que mudam sem editar o projeto) — evita gravar snapshots idênticos
function contentKey( json ) {

	return JSON.stringify( [ json.scene, json.scripts || null, json.history || null, json.backgroundType || null, json.environmentType || null, json.project || null ] );

}

// SHA-256 (Web Crypto, contextos seguros); sem ela, FNV-1a de 64 bits marcado como "fnv" (nunca usado como verificação forte)
async function digest( text ) {

	const subtle = globalThis.crypto && globalThis.crypto.subtle;

	if ( subtle !== undefined ) {

		const buffer = await subtle.digest( 'SHA-256', new TextEncoder().encode( text ) );
		return 'sha256:' + Array.from( new Uint8Array( buffer ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

	}

	let h1 = 0x811c9dc5, h2 = 0x01000193;
	for ( let i = 0; i < text.length; i ++ ) {

		const c = text.charCodeAt( i );
		h1 = Math.imul( h1 ^ c, 16777619 ) >>> 0;
		h2 = Math.imul( h2 ^ ( c >> 3 ), 16777619 ) >>> 0;

	}

	return 'fnv:' + h1.toString( 16 ).padStart( 8, '0' ) + h2.toString( 16 ).padStart( 8, '0' ) + ':' + text.length;

}

function byteSize( text ) {

	return new Blob( [ text ] ).size;

}

function formatBytes( bytes ) {

	if ( ! Number.isFinite( bytes ) ) return '—';
	const units = [ 'B', 'KB', 'MB', 'GB' ];
	let value = bytes, unit = 0;
	while ( value >= 1024 && unit < units.length - 1 ) {

		value /= 1024;
		unit ++;

	}

	return value.toLocaleString( 'pt-BR', { maximumFractionDigits: unit === 0 ? 0 : 1 } ) + ' ' + units[ unit ];

}

function formatDate( time ) {

	return Number.isFinite( time ) ? new Date( time ).toLocaleString( 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } ) : '—';

}

function safeFileName( name, extension ) {

	const safe = String( name || '' ).trim().normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[\\/:*?"<>|]+/g, '' ).replace( /\s+/g, '-' ).slice( 0, 80 );
	return ( safe !== '' ? safe : 'projeto' ) + extension;

}

export { PROJECT_SCHEMA, LIMITS as PROJECT_LIMITS, DEFAULT_NAME, newProjectId, cleanText, cleanName, uniqueName, createRecord, validateState, parseState, projectMetaOf, withProjectMeta, contentKey, digest, byteSize, formatBytes, formatDate, safeFileName };
