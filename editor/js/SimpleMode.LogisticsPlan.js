// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Orquestração do plano: criação, linhas, eventos e contabilidade das quantidades.
// Todas as operações são FUNÇÕES PURAS: recebem um plano e devolvem um novo plano (o painel grava o resultado com
// SetLogisticsPlanCommand — um passo de histórico por operação lógica).
//
// Três contagens distintas, nunca misturadas:
//   - demanda física      = quantidade da linha na base (unidades reais do modelo, via EV-015);
//   - alocação exclusiva  = itens de kit/carga em modo "exclusivo" (soma por linha ≤ demanda, salvo excedente explícito);
//   - utilização em etapa = unidades citadas por etapas (várias etapas podem usar a mesma peça: reutilização
//                           sequencial, sem acrescentar demanda).

import { newId, sanitizePlan, emptyPlan, LOGISTICS_LIMITS, planSize } from './SimpleMode.LogisticsData.js';
import { createBaseline } from './SimpleMode.LogisticsBaseline.js';

class LogisticsError extends Error {

	constructor( message, details = [], code = 'invalid' ) {

		super( message );
		this.name = 'LogisticsError';
		this.details = details;
		this.code = code;

	}

}

const clone = ( plan ) => JSON.parse( JSON.stringify( plan ) );

function stamp( plan ) {

	plan.updatedAt = new Date().toISOString();
	if ( planSize( plan ) > LOGISTICS_LIMITS.chars ) throw new LogisticsError( 'O plano logístico ficou grande demais para ser guardado no projeto.' );
	return plan;

}

// evento operacional (histórico só de acréscimo)
function addEvent( plan, type, { ref = '', from = null, to = null, note = '', responsible = '' } = {} ) {

	if ( plan.events.length >= LOGISTICS_LIMITS.events ) throw new LogisticsError( 'O histórico operacional atingiu o limite deste projeto; exporte os relatórios antes de continuar.' );
	plan.events.push( { id: newId( 'event' ), at: new Date().toISOString(), type, ref, from, to, responsible: responsible || plan.settings.responsible || '', note } );
	return plan;

}

function createPlan( editor, catalog, project ) {

	const plan = emptyPlan();
	plan.planId = newId( 'plan' );
	plan.projectId = project !== null ? project.id : null;
	plan.createdAt = new Date().toISOString();
	plan.baseline = createBaseline( editor, catalog, { project } );
	addEvent( plan, 'plan-created', { ref: plan.planId, to: `${plan.baseline.summary.totalUnits} peça(s)`, note: 'Plano criado a partir do modelo 3D (lista de peças da EV-015).' } );
	return stamp( sanitizePlan( plan ) );

}

// linhas: base vigente + linhas retiradas que ainda têm registros
function allLines( plan ) {

	const active = plan.baseline !== null ? plan.baseline.items : [];
	return active.concat( plan.retiredLines.map( ( l ) => Object.assign( {}, l, { retired: true } ) ) );

}

function lineMap( plan ) {

	return new Map( allLines( plan ).map( ( l ) => [ l.lineId, l ] ) );

}

const demandOf = ( line ) => ( line === undefined || line === null || line.retired ? 0 : line.quantity );
const lineLabel = ( line ) => ( line ? ( line.code ? `${line.code} — ${line.name}` : line.name ) : 'linha desconhecida' );

// alocação exclusiva de uma linha em kits (opcionalmente ignorando um kit)
function kitAllocation( plan, lineId, exceptKitId = null ) {

	return plan.kits.filter( ( k ) => k.id !== exceptKitId ).reduce( ( s, k ) => s + k.items.filter( ( i ) => i.manual !== true && i.lineId === lineId && i.mode === 'exclusive' ).reduce( ( t, i ) => t + i.quantity, 0 ), 0 );

}

// conteúdo físico planejado de uma carga por linha (itens avulsos + itens exclusivos dos kits associados)
function loadContents( plan, load ) {

	const lines = new Map();
	const add = ( lineId, quantity, via ) => {

		const entry = lines.get( lineId ) || { lineId, quantity: 0, via: [] };
		entry.quantity += quantity;
		entry.via.push( via );
		lines.set( lineId, entry );

	};

	const manual = [];
	for ( const kitId of load.kits ) {

		const kit = plan.kits.find( ( k ) => k.id === kitId );
		if ( kit === undefined ) continue;
		for ( const item of kit.items ) {

			if ( item.manual ) manual.push( Object.assign( { kitId }, item ) );
			else if ( item.mode === 'exclusive' ) add( item.lineId, item.quantity, kit.name );

		}

	}

	for ( const item of load.items ) add( item.lineId, item.quantity, item.transfer ? 'avulso (transferência)' : 'avulso' );
	return { lines: [ ...lines.values() ], manual };

}

// quantidade física de uma linha somada em todas as cargas (transferências declaradas não somam)
function loadAllocation( plan, lineId, exceptLoadId = null ) {

	let total = 0;
	for ( const load of plan.loads ) {

		if ( load.id === exceptLoadId ) continue;
		for ( const kitId of load.kits ) {

			const kit = plan.kits.find( ( k ) => k.id === kitId );
			if ( kit ) total += kit.items.filter( ( i ) => i.manual !== true && i.lineId === lineId && i.mode === 'exclusive' ).reduce( ( s, i ) => s + i.quantity, 0 );

		}

		total += load.items.filter( ( i ) => i.lineId === lineId && i.transfer !== true ).reduce( ( s, i ) => s + i.quantity, 0 );

	}

	return total;

}

// unidades usadas por mais de uma etapa (reutilização sequencial: não somam demanda)
function stageUsage( plan ) {

	const usage = new Map();
	for ( const stage of plan.stages ) for ( const uuid of stage.units ) usage.set( uuid, ( usage.get( uuid ) || [] ).concat( [ stage.id ] ) );
	return usage;

}

// peso conhecido de uma lista { lineId, quantity } (+ itens manuais com peso); desconhecidos nunca viram zero
function weightOf( plan, entries, manual = [] ) {

	const lines = lineMap( plan );
	let known = 0, packaged = 0, unknown = 0, packagedUnknown = 0, volume = 0, volumeUnknown = 0;
	for ( const entry of entries ) {

		const line = lines.get( entry.lineId );
		if ( line && line.unitWeight !== null ) known += line.unitWeight * entry.quantity;
		else unknown += entry.quantity;
		if ( line && line.packagedWeight !== null ) packaged += line.packagedWeight * entry.quantity;
		else packagedUnknown += entry.quantity;
		if ( line && line.packageDims !== null ) volume += line.packageDims[ 0 ] * line.packageDims[ 1 ] * line.packageDims[ 2 ] * entry.quantity;
		else volumeUnknown += entry.quantity;

	}

	for ( const item of manual ) {

		if ( item.unitWeight !== null ) known += item.unitWeight * item.quantity;
		else unknown += item.quantity;
		packagedUnknown += item.quantity;
		volumeUnknown += item.quantity;

	}

	return { known, unknown, partial: unknown > 0, packaged, packagedUnknown, volume, volumeUnknown };

}

function weightText( w ) {

	const kgText = ( v ) => v.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) + ' kg';
	if ( w.known === 0 && w.unknown > 0 ) return `Peso desconhecido: ${w.unknown} peça(s) sem peso informado.`;
	if ( w.partial ) return `Peso conhecido parcial: ${kgText( w.known )}. Há ${w.unknown} peça(s) sem peso informado.`;
	return `Peso conhecido: ${kgText( w.known )}.`;

}

export { LogisticsError, clone, stamp, addEvent, createPlan, allLines, lineMap, demandOf, lineLabel, kitAllocation, loadContents, loadAllocation, stageUsage, weightOf, weightText };
