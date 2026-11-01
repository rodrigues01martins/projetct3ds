// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Backup do catálogo técnico: JSON estruturado e versionado ('project3ds-technical-catalog' v1) com hash SHA-256
// do conteúdo (fichas vigentes, TODAS as revisões e regras de compatibilidade). Também exporta uma única ficha.
// Importação: valida formato, versão, tamanho e integridade; rejeita o arquivo inteiro se houver dado numérico
// inválido ou endereço não permitido (nada é corrigido em silêncio); nunca executa scripts nem carrega conteúdo
// remoto. Conflitos: manter existente · importar como cópia com novo código · mesclar revisões compatíveis (somente
// quando nenhuma revisão de mesmo número diverge) · cancelar. Uma revisão existente nunca é substituída.

import { digestBytes } from './SimpleMode.ShareData.js';
import {
	TechnicalError, sanitizePart, sanitizeRule, revisionKey, newId, codeKey, cleanCode, DIMENSION_KEYS
} from './SimpleMode.TechnicalCatalogData.js';

const BACKUP_FORMAT = 'project3ds-technical-catalog';
const BACKUP_VERSION = 1;
const MAX_BYTES = 20 * 1024 * 1024;

const encoder = new TextEncoder();
const hashOf = ( content ) => digestBytes( encoder.encode( JSON.stringify( content ) ) );

async function buildBackup( catalog, catalogIds = null ) {

	await catalog.load();
	const heads = ( catalogIds === null ? catalog.list() : catalogIds.map( ( id ) => catalog.getPart( id ) ).filter( Boolean ) );
	const ids = new Set( heads.map( ( p ) => p.catalogId ) );
	const revisions = [];
	for ( const id of ids ) revisions.push( ...catalog.revisionsOf( id ).slice().reverse() );
	const families = new Set();
	for ( const r of revisions ) for ( const c of r.connectors ) if ( c.family !== '' ) families.add( c.family );
	const rules = catalogIds === null ? catalog.getRules() : catalog.getRules().filter( ( r ) => families.has( r.familyA ) || families.has( r.familyB ) );
	const content = { parts: heads, revisions, rules };
	const integrity = { algorithm: 'SHA-256', hash: await hashOf( content ) };
	const data = Object.assign( { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, app: 'Project3DS', exportedAt: new Date().toISOString(), counts: { parts: heads.length, revisions: revisions.length, rules: rules.length } }, content, { integrity } );
	const stamp = new Date().toISOString().slice( 0, 10 );
	const name = catalogIds !== null && heads.length === 1 ? `ficha-${heads[ 0 ].code.replace( /[^A-Za-z0-9._-]+/g, '_' )}-rev${heads[ 0 ].revision}.p3ds-parts.json` : `catalogo-tecnico-project3ds-${stamp}.p3ds-parts.json`;
	return { blob: new Blob( [ JSON.stringify( data, null, 1 ) ], { type: 'application/json' } ), name, counts: data.counts };

}

// problemas que tornam o registro inaceitável (em vez de serem anulados silenciosamente)
function strictProblems( raw, label ) {

	const problems = [];
	const isNumberOrEmpty = ( value ) => value === null || value === undefined || value === '' || ( typeof value === 'number' && Number.isFinite( value ) && value >= 0 );
	const d = raw.dimensions || {}, ph = raw.physical || {}, tol = d.tolerance || {};
	for ( const key of DIMENSION_KEYS ) if ( isNumberOrEmpty( d[ key ] ) === false ) problems.push( `${label}: dimensão "${key}" não é um número válido.` );
	for ( const [ key, value ] of [[ 'tolerância absoluta', tol.absolute ], [ 'tolerância relativa', tol.relative ], [ 'peso', ph.weight ], [ 'peso embalado', ph.packagedWeight ]] ) if ( isNumberOrEmpty( value ) === false ) problems.push( `${label}: ${key} não é um número válido.` );
	for ( const url of [ raw.manufacturer && raw.manufacturer.url, raw.references && raw.references.url ] ) if ( typeof url === 'string' && url.trim() !== '' && /^https?:\/\//i.test( url.trim() ) === false ) problems.push( `${label}: endereço de referência não permitido (somente http/https informativo).` );
	if ( typeof raw.code === 'string' && raw.code.trim() !== '' && cleanCode( raw.code ) === '' ) problems.push( `${label}: código técnico inválido.` );
	return problems;

}

async function readBackup( file, catalog ) {

	if ( file.size > MAX_BYTES ) throw new TechnicalError( 'Arquivo de catálogo grande demais (limite de 20 MB).' );
	let data;
	try {

		data = JSON.parse( await file.text() );

	} catch ( error ) {

		throw new TechnicalError( 'O arquivo não é um catálogo técnico válido (JSON ilegível).' );

	}

	if ( data === null || typeof data !== 'object' || data.format !== BACKUP_FORMAT ) throw new TechnicalError( 'O arquivo não é um catálogo técnico do Project3DS.' );
	if ( data.formatVersion !== BACKUP_VERSION ) throw new TechnicalError( `Versão de catálogo não suportada (${String( data.formatVersion ).slice( 0, 10 )}).` );
	if ( Array.isArray( data.parts ) === false || Array.isArray( data.revisions ) === false || Array.isArray( data.rules ) === false ) throw new TechnicalError( 'O catálogo está incompleto.' );
	const hash = await hashOf( { parts: data.parts, revisions: data.revisions, rules: data.rules } );
	if ( data.integrity === null || typeof data.integrity !== 'object' || data.integrity.hash !== hash ) throw new TechnicalError( 'Falha na verificação de integridade: o conteúdo do arquivo foi alterado ou está corrompido.' );

	const problems = [];
	const revisions = [], heads = [], rules = [];
	data.revisions.forEach( ( raw, i ) => {

		const label = `Revisão ${i + 1}${raw && raw.code ? ` (${String( raw.code ).slice( 0, 40 )})` : ''}`;
		if ( raw === null || typeof raw !== 'object' ) return problems.push( `${label}: registro inválido.` );
		problems.push( ...strictProblems( raw, label ) );
		try {

			const part = sanitizePart( raw );
			if ( part.catalogId === null || part.revision < 1 ) problems.push( `${label}: identificador interno ou número de revisão ausente.` );
			else revisions.push( part );

		} catch ( error ) {

			problems.push( `${label}: ${error.message}` );

		}

	} );

	data.parts.forEach( ( raw, i ) => {

		try {

			const part = sanitizePart( raw );
			if ( part.catalogId === null || part.revision < 1 ) throw new TechnicalError( 'identificador ausente' );
			if ( revisions.some( ( r ) => r.catalogId === part.catalogId && r.revision === part.revision ) === false ) throw new TechnicalError( 'a revisão vigente não acompanha o arquivo' );
			heads.push( part );

		} catch ( error ) {

			problems.push( `Ficha ${i + 1}: ${error.message}` );

		}

	} );

	data.rules.forEach( ( raw, i ) => {

		try {

			rules.push( sanitizeRule( raw ) );

		} catch ( error ) {

			problems.push( `Regra ${i + 1}: ${error.message}` );

		}

	} );

	if ( problems.length > 0 ) throw new TechnicalError( 'O catálogo contém dados inválidos e não foi importado.', problems.slice( 0, 20 ) );

	await catalog.load();
	return analyze( { heads, revisions, rules }, catalog );

}

// classifica cada ficha: nova, idêntica, mesclável (revisões novas), divergente (mesma revisão com conteúdo diferente)
// ou com código já usado por outra ficha local
function analyze( incoming, catalog ) {

	const items = incoming.heads.map( ( head ) => {

		const revs = incoming.revisions.filter( ( r ) => r.catalogId === head.catalogId );
		const local = catalog.getPart( head.catalogId );
		const localRevs = catalog.revisionsOf( head.catalogId );
		const codeOwner = catalog.findByCode( head.code, head.catalogId );
		let kind;
		const divergent = revs.some( ( r ) => {

			const mine = catalog.getRevision( r.catalogId, r.revision );
			return mine !== null && JSON.stringify( Object.assign( {}, mine, { control: null } ) ) !== JSON.stringify( Object.assign( {}, r, { control: null } ) );

		} );
		const missing = revs.filter( ( r ) => catalog.getRevision( r.catalogId, r.revision ) === null );
		if ( local === null && localRevs.length === 0 ) kind = codeOwner !== null ? 'code' : 'new';
		else if ( divergent ) kind = 'divergent';
		else if ( missing.length > 0 ) kind = codeOwner !== null ? 'code' : 'mergeable';
		else kind = 'same';
		return { head, revisions: revs, missing, kind, codeOwner };

	} );

	const rules = incoming.rules.map( ( rule ) => {

		const mine = catalog.getRules().find( ( r ) => r.id === rule.id );
		return { rule, kind: mine === undefined ? 'new' : JSON.stringify( mine ) === JSON.stringify( rule ) ? 'same' : 'divergent' };

	} );

	const conflicts = items.filter( ( i ) => i.kind === 'code' || i.kind === 'divergent' || i.kind === 'mergeable' );
	return {
		incoming, items, rules,
		counts: { parts: items.length, revisions: incoming.revisions.length, rules: rules.length, new: items.filter( ( i ) => i.kind === 'new' ).length, same: items.filter( ( i ) => i.kind === 'same' ).length },
		conflicts,
		canMerge: conflicts.every( ( i ) => i.kind === 'mergeable' )
	};

}

// aplica a decisão: 'keep' | 'copy' | 'merge'
async function applyImport( analysis, catalog, choice ) {

	const batch = { revisions: [], heads: [], rules: [] };
	const usedCodes = new Set( catalog.list().map( ( p ) => codeKey( p.code ) ) );
	const freeCode = ( code ) => {

		let n = 1, candidate;
		do {

			candidate = `${code.slice( 0, 34 )}-IMP${n > 1 ? n : ''}`;
			n ++;

		} while ( usedCodes.has( codeKey( candidate ) ) );

		usedCodes.add( codeKey( candidate ) );
		return candidate;

	};

	const result = { added: 0, merged: 0, copied: 0, kept: 0, rules: 0 };
	for ( const item of analysis.items ) {

		if ( item.kind === 'same' ) {

			result.kept ++;
			continue;

		}

		if ( item.kind === 'new' ) {

			batch.revisions.push( ...item.revisions );
			batch.heads.push( item.head );
			usedCodes.add( codeKey( item.head.code ) );
			result.added ++;
			continue;

		}

		if ( choice === 'merge' && item.kind === 'mergeable' ) {

			batch.revisions.push( ...item.missing );
			const local = catalog.getPart( item.head.catalogId );
			if ( local === null || local.revision < item.head.revision ) batch.heads.push( item.head );
			result.merged ++;

		} else if ( choice === 'copy' ) {

			const copy = JSON.parse( JSON.stringify( item.head ) );
			copy.catalogId = newId( 'part' );
			copy.revision = 1;
			copy.code = freeCode( item.head.code );
			copy.control = Object.assign( {}, copy.control, { revisionNote: `Importada como cópia de ${item.head.code} rev. ${item.head.revision}`, changedFields: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } );
			const clean = sanitizePart( copy );
			clean.catalogId = copy.catalogId;
			clean.revision = 1;
			batch.revisions.push( clean );
			batch.heads.push( clean );
			result.copied ++;

		} else {

			result.kept ++;

		}

	}

	for ( const { rule, kind } of analysis.rules ) {

		if ( kind === 'new' ) {

			batch.rules.push( rule );
			result.rules ++;

		} else if ( kind === 'divergent' && choice === 'copy' ) {

			batch.rules.push( Object.assign( {}, rule, { id: newId( 'rule' ) } ) );
			result.rules ++;

		}

	}

	// revisões já existentes nunca são reenviadas (add() abortaria tudo)
	batch.revisions = batch.revisions.filter( ( r, i, all ) => catalog.getRevision( r.catalogId, r.revision ) === null && all.findIndex( ( o ) => revisionKey( o.catalogId, o.revision ) === revisionKey( r.catalogId, r.revision ) ) === i );
	if ( batch.revisions.length > 0 || batch.heads.length > 0 || batch.rules.length > 0 ) await catalog.applyBatch( batch );
	return result;

}

export { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, readBackup, applyImport, strictProblems };
