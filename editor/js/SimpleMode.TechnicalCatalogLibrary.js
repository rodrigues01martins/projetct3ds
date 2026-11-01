// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Catálogo técnico local (consulta e gerenciamento). Regras:
//   - catalogId é o identificador interno estável (nunca o nome, nunca o código temporário da EV-010);
//   - o código técnico é único no catálogo local (sem diferenciar maiúsculas); editar o código gera nova revisão e
//     não quebra associações (elas apontam para catalogId + revisão);
//   - toda alteração de conteúdo gera uma NOVA revisão (a anterior permanece intacta e recuperável);
//   - o histórico do editor (projeto atual) não desfaz alterações do catálogo global: a edição de fichas é confirmada
//     e versionada aqui, separadamente.

import {
	TechnicalError, sanitizePart, sanitizeRule, codeKey, newId, revisionKey, changedFields, isTechnicalChange,
	searchText, normalizeQuery, validationProblem, setLocalResolver, TECHNICAL_LIMITS, FIELD_LABELS
} from './SimpleMode.TechnicalCatalogData.js';
import { TechnicalCatalogStorage } from './SimpleMode.TechnicalCatalogStorage.js';

function TechnicalCatalogLibrary() {

	const storage = new TechnicalCatalogStorage();
	const state = { loaded: false, available: true, error: null, corrupted: [], parts: new Map(), revisions: new Map(), rules: new Map() };
	const listeners = new Set();
	let loading = null;

	const changed = { add: ( fn ) => listeners.add( fn ), remove: ( fn ) => listeners.delete( fn ) };
	const emit = () => listeners.forEach( ( fn ) => fn() );

	setLocalResolver( ( catalogId, revision ) => state.revisions.get( revisionKey( catalogId, revision ) ) || null );

	function load() {

		if ( loading !== null ) return loading;
		loading = storage.loadAll().then( ( data ) => {

			state.parts = new Map( data.parts.map( ( p ) => [ p.catalogId, p ] ) );
			state.revisions = new Map( data.revisions.map( ( r ) => [ revisionKey( r.catalogId, r.revision ), r ] ) );
			// ficha vigente sem a revisão correspondente (gravação antiga/interrompida): a revisão é considerada a própria ficha
			for ( const head of state.parts.values() ) if ( state.revisions.has( revisionKey( head.catalogId, head.revision ) ) === false ) state.revisions.set( revisionKey( head.catalogId, head.revision ), head );
			state.rules = new Map( data.rules.map( ( r ) => [ r.id, r ] ) );
			state.corrupted = data.corrupted;
			state.loaded = true;
			state.available = true;
			emit();
			return state;

		} ).catch( ( error ) => {

			state.loaded = true;
			state.available = false;
			state.error = error;
			loading = null;
			emit();
			return state;

		} );
		return loading;

	}

	function requireAvailable() {

		if ( state.available === false ) throw new TechnicalError( state.error ? state.error.message : 'O catálogo técnico não está disponível neste navegador.' );

	}

	// consulta -------------------------------------------------------------------------------------------------------

	const getPart = ( catalogId ) => state.parts.get( catalogId ) || null;
	const getRevision = ( catalogId, revision ) => state.revisions.get( revisionKey( catalogId, revision ) ) || null;
	const revisionsOf = ( catalogId ) => [ ...state.revisions.values() ].filter( ( r ) => r.catalogId === catalogId ).sort( ( a, b ) => b.revision - a.revision );

	function latestRevision( catalogId ) {

		const head = getPart( catalogId );
		if ( head !== null ) return head.revision;
		const list = revisionsOf( catalogId );
		return list.length > 0 ? list[ 0 ].revision : null;

	}

	function findByCode( code, exceptId = null ) {

		const key = codeKey( code );
		for ( const part of state.parts.values() ) if ( part.catalogId !== exceptId && codeKey( part.code ) === key ) return part;
		return null;

	}

	function list( { query = '', category = '' } = {} ) {

		const q = normalizeQuery( query );
		const words = q === '' ? [] : q.split( /\s+/ );
		return [ ...state.parts.values() ]
			.filter( ( p ) => ( category === '' || p.category === category ) && words.every( ( w ) => searchText( p ).includes( w ) ) )
			.sort( ( a, b ) => a.code.localeCompare( b.code, 'pt-BR', { numeric: true } ) );

	}

	const getRules = () => [ ...state.rules.values() ].sort( ( a, b ) => ( a.familyA + a.familyB ).localeCompare( b.familyA + b.familyB, 'pt-BR' ) );

	// gravação ----------------------------------------------------------------------------------------------------------

	function checkCode( part, exceptId ) {

		const other = findByCode( part.code, exceptId );
		if ( other !== null ) throw new TechnicalError( `O código técnico "${part.code}" já pertence à ficha "${other.name}" (revisão ${other.revision}). Edite essa ficha para criar uma nova revisão ou use outro código.`, [ other.catalogId ] );

	}

	function checkValidation( part, requested ) {

		const problem = validationProblem( part, requested );
		if ( problem !== null ) throw new TechnicalError( problem );

	}

	async function create( input ) {

		await load();
		requireAvailable();
		if ( state.parts.size >= TECHNICAL_LIMITS.parts ) throw new TechnicalError( 'O catálogo técnico atingiu o limite de fichas deste navegador.' );
		const part = sanitizePart( input );
		checkValidation( part, input && input.control ? input.control.validation : 'draft' );
		checkCode( part, null );
		const now = new Date().toISOString();
		part.catalogId = newId( 'part' );
		part.revision = 1;
		part.control = Object.assign( part.control, { createdAt: now, updatedAt: now, changedFields: [], revisionNote: part.control.revisionNote || 'Cadastro inicial' } );
		await storage.commitRevision( part );
		state.parts.set( part.catalogId, part );
		state.revisions.set( revisionKey( part.catalogId, part.revision ), part );
		emit();
		return part;

	}

	// nova revisão; retorna { record, changed, technical } ou { record: atual, changed: [] } quando nada mudou
	async function update( catalogId, input, { revisionNote = '' } = {} ) {

		await load();
		requireAvailable();
		const head = getPart( catalogId );
		if ( head === null ) throw new TechnicalError( 'A ficha não existe mais no catálogo local.' );
		if ( revisionsOf( catalogId ).length >= TECHNICAL_LIMITS.revisions ) throw new TechnicalError( 'Limite de revisões desta ficha atingido.' );
		const next = sanitizePart( Object.assign( {}, input, { catalogId, revision: head.revision + 1 } ) );
		checkValidation( next, input && input.control ? input.control.validation : 'draft' );
		const fields = changedFields( head, next );
		if ( fields.length === 0 ) return { record: head, changed: [], technical: false };
		checkCode( next, catalogId );
		next.catalogId = catalogId;
		next.revision = head.revision + 1;
		next.control = Object.assign( next.control, { createdAt: head.control.createdAt, updatedAt: new Date().toISOString(), changedFields: fields, revisionNote: revisionNote || `Alteração: ${fields.map( ( f ) => FIELD_LABELS[ f ] ).join( ', ' )}` } );
		await storage.commitRevision( next );
		state.parts.set( catalogId, next );
		state.revisions.set( revisionKey( catalogId, next.revision ), next );
		emit();
		return { record: next, changed: fields, technical: isTechnicalChange( fields ) };

	}

	async function duplicate( catalogId, code ) {

		const head = getPart( catalogId );
		if ( head === null ) throw new TechnicalError( 'A ficha não existe mais no catálogo local.' );
		const copy = JSON.parse( JSON.stringify( head ) );
		copy.code = code;
		copy.name = `${head.name} (cópia)`.slice( 0, 120 );
		copy.catalogId = null;
		copy.revision = 0;
		copy.control = { validation: 'draft', revisionNote: `Cópia de ${head.code} rev. ${head.revision}` };
		return create( copy );

	}

	async function remove( catalogId ) {

		await load();
		requireAvailable();
		await storage.removePart( catalogId );
		state.parts.delete( catalogId );
		emit();

	}

	// regras de compatibilidade ---------------------------------------------------------------------------------------

	async function saveRule( input ) {

		await load();
		requireAvailable();
		const previous = input && input.id ? state.rules.get( input.id ) : undefined;
		const rule = sanitizeRule( Object.assign( {}, input, { revision: previous !== undefined ? previous.revision + 1 : 1, updatedAt: new Date().toISOString() } ) );
		if ( previous === undefined && state.rules.size >= TECHNICAL_LIMITS.rules ) throw new TechnicalError( 'Limite de regras de compatibilidade atingido.' );
		await storage.putRule( rule );
		state.rules.set( rule.id, rule );
		emit();
		return rule;

	}

	async function removeRule( id ) {

		await load();
		requireAvailable();
		await storage.removeRule( id );
		state.rules.delete( id );
		emit();

	}

	// importação de registros carregados por conjuntos/pacotes: somente o que falta (nada é sobrescrito)
	async function importRecords( records = [], rules = [] ) {

		await load();
		if ( state.available === false ) return { revisions: 0, heads: 0, rules: 0, skipped: records.length };
		const revisions = [], heads = new Map(), newRules = [];
		let skipped = 0;
		for ( const input of records ) {

			let record;
			try {

				record = sanitizePart( input );

			} catch ( error ) {

				skipped ++;
				continue;

			}

			if ( record.catalogId === null || record.revision < 1 ) {

				skipped ++;
				continue;

			}

			const key = revisionKey( record.catalogId, record.revision );
			if ( state.revisions.has( key ) === false && revisions.some( ( r ) => revisionKey( r.catalogId, r.revision ) === key ) === false ) revisions.push( record );
			const head = getPart( record.catalogId ) || heads.get( record.catalogId );
			const codeOwner = findByCode( record.code, record.catalogId );
			if ( ( head === undefined || head === null || head.revision < record.revision ) && codeOwner === null ) heads.set( record.catalogId, record );

		}

		for ( const input of rules ) {

			try {

				const rule = sanitizeRule( input );
				if ( state.rules.has( rule.id ) === false ) newRules.push( rule );

			} catch ( error ) {

				skipped ++;

			}

		}

		if ( revisions.length === 0 && heads.size === 0 && newRules.length === 0 ) return { revisions: 0, heads: 0, rules: 0, skipped };
		await storage.importBatch( { revisions, heads: [ ...heads.values() ], rules: newRules } );
		for ( const r of revisions ) state.revisions.set( revisionKey( r.catalogId, r.revision ), r );
		for ( const h of heads.values() ) state.parts.set( h.catalogId, h );
		for ( const r of newRules ) state.rules.set( r.id, r );
		emit();
		return { revisions: revisions.length, heads: heads.size, rules: newRules.length, skipped };

	}

	// lote já validado pelo backup (decisões de conflito tomadas pelo usuário)
	async function applyBatch( batch ) {

		await load();
		requireAvailable();
		await storage.importBatch( batch );
		for ( const r of batch.revisions || [] ) state.revisions.set( revisionKey( r.catalogId, r.revision ), r );
		for ( const h of batch.heads || [] ) state.parts.set( h.catalogId, h );
		for ( const r of batch.rules || [] ) state.rules.set( r.id, r );
		emit();

	}

	return {
		state, changed, load, isLoaded: () => state.loaded,
		getPart, getRevision, revisionsOf, latestRevision, findByCode, list, getRules,
		create, update, duplicate, remove, saveRule, removeRule, importRecords, applyBatch
	};

}

export { TechnicalCatalogLibrary };
