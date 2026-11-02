// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Transferência local de registros de conferência (arquivo JSON 'project3ds-logistics-checks' v1, com SHA-256):
// separação, carregamento, recebimento, retorno, status/progresso das etapas, ocorrências e eventos.
// Importação no MESMO plano (planId); base diferente gera aviso. Para cada registro:
//   - igual ao local → ignorado; ausente localmente → novo; diferente do local → CONFLITO (listado antes de
//     incorporar). Conflitos nunca sobrescrevem o local: o usuário pode incorporar só os registros sem conflito ou
//     cancelar. Eventos e ocorrências novos entram por ID (sem duplicar). Trocar arquivos não é sincronização.

import { digestBytes } from './SimpleMode.ShareData.js';
import { RECORD_FIELDS, sanitizeRecord, sanitizeIncident, sanitizeEvent, isId, STAGE_STATUSES } from './SimpleMode.LogisticsData.js';
import { LogisticsError, clone, stamp, addEvent } from './SimpleMode.LogisticsPlan.js';

const TRANSFER_FORMAT = 'project3ds-logistics-checks';
const TRANSFER_VERSION = 1;
const MAX_BYTES = 10 * 1024 * 1024;
const encoder = new TextEncoder();
const hashOf = ( content ) => digestBytes( encoder.encode( JSON.stringify( content ) ) );
const KINDS = [ 'picking', 'loading', 'receiving', 'returns' ];

function payloadOf( plan ) {

	return {
		planId: plan.planId,
		baselineId: plan.baseline !== null ? plan.baseline.id : null,
		picking: plan.picking, loading: plan.loading, receiving: plan.receiving, returns: plan.returns,
		stages: plan.stages.map( ( s ) => ( { id: s.id, status: s.status, installed: s.installed, actualStart: s.actualStart, actualEnd: s.actualEnd } ) ),
		incidents: plan.incidents,
		events: plan.events
	};

}

async function exportChecks( plan, projectTitle = '' ) {

	if ( plan.planId === null ) throw new LogisticsError( 'Não há plano para exportar.' );
	const payload = payloadOf( plan );
	const data = Object.assign( { format: TRANSFER_FORMAT, formatVersion: TRANSFER_VERSION, app: 'Project3DS', exportedAt: new Date().toISOString(), projectTitle }, payload, { integrity: { algorithm: 'SHA-256', hash: await hashOf( payload ) } } );
	const stamp = new Date().toISOString().slice( 0, 16 ).replace( /[:T]/g, '-' );
	return { blob: new Blob( [ JSON.stringify( data ) ], { type: 'application/json' } ), name: `conferencia-${( projectTitle || 'projeto' ).replace( /[^A-Za-z0-9À-ÿ._-]+/g, '_' ).slice( 0, 40 )}-${stamp}.p3ds-checks.json` };

}

const same = ( a, b ) => {

	const strip = ( r ) => ( r ? Object.fromEntries( Object.entries( r ).filter( ( [ k ] ) => k !== 'updatedAt' && k !== 'rev' ) ) : null );
	return JSON.stringify( strip( a ) ) === JSON.stringify( strip( b ) );

};

async function analyzeChecks( file, plan ) {

	if ( file.size > MAX_BYTES ) throw new LogisticsError( 'Arquivo de conferência grande demais (limite de 10 MB).' );
	let data;
	try {

		data = JSON.parse( await file.text() );

	} catch ( error ) {

		throw new LogisticsError( 'O arquivo não é um registro de conferência válido (JSON ilegível).' );

	}

	if ( data === null || typeof data !== 'object' || data.format !== TRANSFER_FORMAT ) throw new LogisticsError( 'O arquivo não é um registro de conferência do Project3DS.' );
	if ( data.formatVersion !== TRANSFER_VERSION ) throw new LogisticsError( 'Versão do arquivo de conferência não suportada.' );
	const payload = { planId: data.planId, baselineId: data.baselineId, picking: data.picking, loading: data.loading, receiving: data.receiving, returns: data.returns, stages: data.stages, incidents: data.incidents, events: data.events };
	if ( data.integrity === null || typeof data.integrity !== 'object' || data.integrity.hash !== await hashOf( payload ) ) throw new LogisticsError( 'Falha na verificação de integridade: o arquivo foi alterado ou está corrompido.' );
	if ( plan.planId === null || data.planId !== plan.planId ) throw new LogisticsError( 'Este arquivo pertence a outro plano logístico. Nada foi importado.' );

	const warnings = [];
	if ( plan.baseline !== null && data.baselineId !== plan.baseline.id ) warnings.push( 'O arquivo foi gerado sobre outra revisão da base do plano: confira os registros antes de incorporar.' );
	const changes = [], conflicts = [];
	for ( const kind of KINDS ) {

		const incoming = data[ kind ] && typeof data[ kind ] === 'object' ? data[ kind ] : {};
		for ( const [ key, raw ] of Object.entries( incoming ) ) {

			const valid = kind === 'picking' || kind === 'returns' ? isId( key ) : /^[a-z]+-[A-Za-z0-9-]{6,80}\|[a-z]+-[A-Za-z0-9-]{6,80}$/.test( key );
			const record = valid ? sanitizeRecord( raw, RECORD_FIELDS[ kind ] ) : null;
			if ( record === null ) continue;
			const local = plan[ kind ][ key ];
			if ( local !== undefined && same( local, record ) ) continue;
			( local === undefined ? changes : conflicts ).push( { kind, key, local: local || null, incoming: record } );

		}

	}

	for ( const raw of Array.isArray( data.stages ) ? data.stages : [] ) {

		const stage = plan.stages.find( ( s ) => s.id === raw.id );
		if ( stage === undefined || STAGE_STATUSES.some( ( s ) => s.id === raw.status ) === false ) continue;
		const incoming = { status: raw.status, installed: Number.isInteger( raw.installed ) && raw.installed >= 0 ? raw.installed : 0 };
		const local = { status: stage.status, installed: stage.installed };
		if ( JSON.stringify( local ) === JSON.stringify( incoming ) ) continue;
		const untouched = stage.status === 'todo' && stage.installed === 0;
		( untouched ? changes : conflicts ).push( { kind: 'stage', key: stage.id, local, incoming: Object.assign( incoming, { actualStart: raw.actualStart || null, actualEnd: raw.actualEnd || null } ), label: stage.title } );

	}

	const incidents = ( Array.isArray( data.incidents ) ? data.incidents : [] ).map( sanitizeIncident ).filter( Boolean );
	for ( const incident of incidents ) {

		const local = plan.incidents.find( ( i ) => i.id === incident.id );
		if ( local === undefined ) changes.push( { kind: 'incident', key: incident.id, local: null, incoming: incident } );
		else if ( JSON.stringify( local ) !== JSON.stringify( incident ) ) conflicts.push( { kind: 'incident', key: incident.id, local, incoming: incident } );

	}

	const knownEvents = new Set( plan.events.map( ( e ) => e.id ) );
	const events = ( Array.isArray( data.events ) ? data.events : [] ).map( sanitizeEvent ).filter( ( e ) => e !== null && knownEvents.has( e.id ) === false );
	return { changes, conflicts, events, warnings, exportedAt: data.exportedAt };

}

// incorpora somente os registros sem conflito (os conflitantes permanecem com o valor local)
function applyChecks( plan, analysis ) {

	const next = clone( plan );
	for ( const change of analysis.changes ) {

		if ( KINDS.includes( change.kind ) ) next[ change.kind ][ change.key ] = change.incoming;
		else if ( change.kind === 'stage' ) Object.assign( next.stages.find( ( s ) => s.id === change.key ), change.incoming );
		else if ( change.kind === 'incident' ) next.incidents.push( change.incoming );

	}

	next.events = next.events.concat( analysis.events ).sort( ( a, b ) => a.at.localeCompare( b.at ) );
	addEvent( next, 'checks-imported', { to: `${analysis.changes.length} registro(s) incorporado(s)`, note: analysis.conflicts.length > 0 ? `${analysis.conflicts.length} conflito(s) mantido(s) com o valor local.` : '' } );
	return stamp( next );

}

export { TRANSFER_FORMAT, exportChecks, analyzeChecks, applyChecks };
