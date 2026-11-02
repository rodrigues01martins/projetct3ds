// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Exportações operacionais (reaproveitam os geradores da EV-010/EV-015 — nenhum segundo gerador OOXML/PDF):
//   CSV  — lista de separação (UTF-8 com BOM, ";", textos protegidos contra fórmulas, vazios preservados);
//   XLSX — Resumo · Lista de Peças · Etapas · Separação e Kits · Transporte · Conferência · Retorno;
//   PDF  — "Plano de Montagem e Logística — Project3DS" (geral) e relatórios específicos: Lista de Separação, Lista de
//          Carregamento, Conferência de Recebimento, Conferência de Retorno. Nenhum laudo, certificado ou autorização.

import { textCell } from './SimpleMode.BudgetCSV.js';
import { buildWorkbook, XLSX_STYLES as S, xlsxText as text, xlsxNumber as number, xlsxFormula as formula, xlsxEmpty as empty } from './SimpleMode.BudgetXLSX.js';
import { PDFDocument } from './SimpleMode.BudgetPDF.js';
import { toPDFPages } from './SimpleMode.PlanPdf.js';
import { STAGE_TYPES, STAGE_STATUSES, INCIDENT_TYPES, INCIDENT_STATUSES, CLASSIFICATIONS, labelOf, brDate, brDateTime, kg, MANUAL_LABEL } from './SimpleMode.LogisticsData.js';
import { allLines, demandOf, weightText } from './SimpleMode.LogisticsPlan.js';
import { pickState, kitDetails, kitStatus } from './SimpleMode.LogisticsKits.js';
import { loadDetails, receivingState, RECEIVING_CONVENTION, TRANSPORT_LIMITS } from './SimpleMode.LogisticsLoads.js';
import { returnState } from './SimpleMode.LogisticsReturns.js';
import { planSummary } from './SimpleMode.LogisticsSummary.js';

const TITLE = 'Plano de Montagem e Logística — Project3DS';
const FOOTER = 'Documento operacional de planejamento: registros declarados pelo usuário. Não é laudo, certificado nem autorização de transporte.';
const NOTES = [
	'O modelo 3D define quais componentes existem; o planejamento registra intenções; a execução registra declarações do usuário. Peças modeladas não estão necessariamente em estoque e cargas planejadas não foram necessariamente transportadas.',
	'Pesos somam apenas valores informados nas fichas técnicas; peças sem peso nunca são consideradas como zero. Peso embalado é apresentado à parte.',
	RECEIVING_CONVENTION,
	TRANSPORT_LIMITS,
	'Responsável informado é uma identificação declarada, sem verificação de identidade; não equivale a assinatura nem a responsabilidade profissional.'
];

const stageOfKit = ( plan, kit ) => plan.stages.find( ( s ) => s.id === kit.stageId ) || null;
const linesActive = ( plan ) => allLines( plan );

// linhas de separação com etapa/kit de destino (uma linha por kit; o restante aparece sem kit)
function pickingRows( plan ) {

	const rows = [];
	for ( const line of linesActive( plan ) ) {

		const pick = pickState( line, plan.picking[ line.lineId ] );
		const kits = plan.kits.filter( ( k ) => k.items.some( ( i ) => i.manual !== true && i.lineId === line.lineId && i.mode === 'exclusive' ) );
		const notes = [ plan.picking[ line.lineId ] ? plan.picking[ line.lineId ].notes || '' : '', line.retired ? 'Linha fora do modelo atual (registros preservados).' : '', line.linked ? '' : 'Sem ficha técnica.' ].filter( Boolean ).join( ' ' );
		rows.push( { line, pick, kit: kits.map( ( k ) => k.name ).join( ', ' ), stage: kits.map( ( k ) => ( stageOfKit( plan, k ) || {} ).title ).filter( Boolean ).join( ', ' ), notes, location: plan.picking[ line.lineId ] && plan.picking[ line.lineId ].location ? plan.picking[ line.lineId ].location : ( plan.lines[ line.lineId ] || {} ).location || '' } );

	}

	return rows;

}

function toPickingCSV( plan, projectTitle ) {

	const out = [ [ 'Projeto', 'Etapa', 'Kit', 'Código técnico', 'Revisão', 'Descrição', 'Quantidade necessária', 'Quantidade separada', 'Quantidade pendente', 'Não localizada', 'Excedente registrado', 'Local de separação', 'Situação', 'Observações' ].map( textCell ).join( ';' ) ];
	for ( const r of pickingRows( plan ) ) {

		out.push( [ textCell( projectTitle ), textCell( r.stage ), textCell( r.kit ), textCell( r.line.code ), r.line.catalogRevision === null ? '' : String( r.line.catalogRevision ), textCell( r.line.name ), String( r.pick.demand ), String( r.pick.picked ), String( r.pick.pending ), String( r.pick.notFound ), String( r.pick.surplus ), textCell( r.location ), textCell( r.pick.label + ( r.pick.closed ? ' (concluída)' : '' ) ), textCell( r.notes ) ].join( ';' ) );

	}

	const s = planSummary( plan );
	out.push( '' );
	out.push( [ textCell( 'Total' ), '', '', '', '', '', String( s.needed ), String( s.picked ), String( s.pickPending ) ].join( ';' ) );
	return '﻿' + out.join( '\r\n' ) + '\r\n';

}

// XLSX ---------------------------------------------------------------------------------------------------------------

const header = ( titles ) => titles.map( ( t ) => text( t, S.header ) );
const intCell = ( v ) => number( v, S.integer );
const weightCell = ( v ) => ( v === null ? empty( S.warning ) : number( v, S.qty2 ) );

function summarySheet( plan, meta ) {

	const s = planSummary( plan );
	const rows = [
		[ text( TITLE, S.title ) ],
		[ text( 'Projeto', S.bold ), text( meta.projectTitle || 'Projeto sem nome' ) ],
		[ text( 'Data de emissão', S.bold ), text( meta.date.toLocaleDateString( 'pt-BR' ) ) ],
		[ text( 'Base do plano', S.bold ), text( `revisão ${plan.baseline.revision} — ${brDateTime( plan.baseline.createdAt )} — ${plan.baseline.hash}` ) ],
		[ text( '' ) ],
		header( [ 'Indicador', 'Valor', 'Unidade' ] )
	];
	const add = ( label, value, unit = 'un', warn = false ) => rows.push( [ text( label, warn ? S.warning : S.cell ), typeof value === 'number' ? ( unit === 'kg' ? number( value, S.qty2 ) : intCell( value ) ) : text( value ), text( unit ) ] );
	add( 'Total de peças necessárias', s.needed );
	add( 'Peças com ficha técnica', s.identified );
	add( 'Peças sem ficha técnica', s.unidentified, 'un', s.unidentified > 0 );
	add( 'Peças separadas (declarado)', s.picked );
	add( 'Peças pendentes de separação', s.pickPending, 'un', s.pickPending > 0 );
	add( 'Kits completos', s.kitsComplete );
	add( 'Kits incompletos', s.kitsIncomplete, 'un', s.kitsIncomplete > 0 );
	add( 'Cargas planejadas', s.loadsPlanned );
	add( 'Cargas carregadas (declarado)', s.loadsLoaded );
	add( 'Etapas concluídas', s.stagesDone );
	add( 'Etapas pendentes', s.stagesPending );
	add( 'Itens com divergência / ocorrências abertas', s.divergences, 'un', s.divergences > 0 );
	add( 'Peças devolvidas', s.returned );
	add( 'Peças faltantes no retorno', s.returnMissing, 'un', s.returnMissing > 0 );
	add( s.weight.partial ? 'Peso líquido conhecido (PARCIAL)' : 'Peso líquido conhecido', s.weight.known, 'kg', s.weight.partial );
	add( 'Peças sem peso informado', s.weight.unknown, 'un', s.weight.unknown > 0 );
	add( s.weight.packagedUnknown > 0 ? 'Peso embalado conhecido (PARCIAL)' : 'Peso embalado conhecido', s.weight.packaged, 'kg', s.weight.packagedUnknown > 0 );
	rows.push( [ text( '' ) ] );
	for ( const l of s.loadWeights ) rows.push( [ text( `${l.code}: ${l.capacityText}`, l.state === 'over' || l.state === 'incomplete' ? S.warning : S.cell ) ] );
	rows.push( [ text( '' ) ] );
	for ( const n of NOTES ) rows.push( [ text( n ) ] );
	return { rows, widths: [ 60, 18, 12 ], header: false };

}

function linesSheet( plan ) {

	const rows = [ header( [ 'Código técnico', 'Descrição', 'Revisão da ficha', 'Categoria', 'Quantidade necessária', 'Peso unitário (kg)', 'Peso conhecido (kg)', 'Peso embalado unit. (kg)', 'Embalagem (L × A × P, mm)', 'Volume da embalagem (m³)', 'Classificação', 'Situação', 'ID da linha', 'Instâncias (UUID)' ] ) ];
	for ( const line of linesActive( plan ) ) {

		const r = rows.length + 1;
		const dims = line.packageDims;
		rows.push( [ text( line.code ), text( line.name ), line.catalogRevision === null ? empty() : intCell( line.catalogRevision ), text( line.category ), intCell( demandOf( line ) ), weightCell( line.unitWeight ), line.unitWeight === null ? empty( S.warning ) : formula( `E${r}*F${r}`, line.unitWeight * demandOf( line ), S.qty2 ), weightCell( line.packagedWeight ), text( dims ? dims.map( ( v ) => Math.round( v * 1000 ) ).join( ' × ' ) : 'Dimensão de embalagem não informada', dims ? S.cell : S.warning ), dims ? number( dims[ 0 ] * dims[ 1 ] * dims[ 2 ], S.qty4 ) : empty(), text( labelOf( CLASSIFICATIONS, ( plan.lines[ line.lineId ] || {} ).classification || 'undefined' ) ), text( line.retired ? 'Fora do modelo atual' : line.linked ? 'Com ficha' : 'Sem ficha técnica', line.linked && ! line.retired ? S.cell : S.warning ), text( line.lineId ), text( line.units.join( ', ' ) ) ] );

	}

	const last = rows.length;
	rows.push( [ text( '' ), text( 'Total', S.bold ), empty(), empty(), formula( `SUM(E2:E${last})`, linesActive( plan ).reduce( ( s, l ) => s + demandOf( l ), 0 ), S.integer ), empty(), formula( `SUM(G2:G${last})`, linesActive( plan ).reduce( ( s, l ) => s + ( l.unitWeight !== null ? l.unitWeight * demandOf( l ) : 0 ), 0 ), S.qty2 ), empty(), empty(), empty(), empty(), text( planSummary( plan ).weight.partial ? 'Peso conhecido PARCIAL — há peças sem peso informado' : '', S.warning ) ] );
	return { rows, widths: [ 16, 32, 10, 18, 12, 14, 14, 14, 24, 14, 14, 20, 24, 50 ], filter: `A1:N${last}` };

}

function stagesSheet( plan ) {

	const rows = [ header( [ 'Nº', 'Etapa', 'Tipo', 'Início previsto', 'Término previsto', 'Início registrado', 'Término registrado', 'Responsável informado', 'Status', 'Depende de', 'Componentes', 'Instalados/desmontados (declarado)', 'Observações' ] ) ];
	for ( const s of plan.stages ) {

		const late = s.status !== 'done' && s.status !== 'cancelled' && s.plannedEnd !== null && s.plannedEnd < new Date().toISOString().slice( 0, 10 );
		rows.push( [ intCell( s.number ), text( s.title ), text( labelOf( STAGE_TYPES, s.type ) ), text( brDate( s.plannedStart ) ), text( brDate( s.plannedEnd ), late ? S.warning : S.cell ), text( brDateTime( s.actualStart ) ), text( brDateTime( s.actualEnd ) ), text( s.responsible ), text( labelOf( STAGE_STATUSES, s.status ) + ( late ? ' (atrasada)' : '' ), s.status === 'done' ? S.cell : S.warning ), text( s.deps.map( ( d ) => ( plan.stages.find( ( x ) => x.id === d ) || {} ).number ).filter( Boolean ).join( ', ' ) ), intCell( s.units.length ), intCell( s.installed ), text( [ s.notes, s.justification ? 'Justificativa: ' + s.justification : '' ].filter( Boolean ).join( ' ' ) ) ] );

	}

	return { rows, widths: [ 6, 30, 14, 13, 13, 16, 16, 20, 18, 12, 12, 16, 40 ], filter: `A1:M${rows.length}` };

}

function pickingSheet( plan ) {

	const rows = [ header( [ 'Kit / Separação', 'Código técnico', 'Descrição', 'Modo', 'Quantidade', 'Necessária', 'Separada', 'Pendente', 'Peso conhecido (kg)', 'Situação', 'Observações' ] ) ];
	for ( const r of pickingRows( plan ) ) rows.push( [ text( 'Separação' ), text( r.line.code ), text( r.line.name ), text( '' ), empty(), intCell( r.pick.demand ), intCell( r.pick.picked ), intCell( r.pick.pending ), r.line.unitWeight === null ? empty( S.warning ) : number( r.line.unitWeight * r.pick.demand, S.qty2 ), text( r.pick.label, r.pick.state === 'complete' ? S.cell : S.warning ), text( r.notes ) ] );
	for ( const kit of plan.kits ) {

		const d = kitDetails( plan, kit );
		const st = kitStatus( plan, kit );
		for ( const row of d.rows ) rows.push( [ text( kit.name ), text( row.code ), text( row.name ), text( row.manual ? 'Item manual' : row.mode === 'reuse' ? 'Reutilização' : 'Exclusivo' ), intCell( row.quantity ), empty(), empty(), empty(), row.weight === null ? empty( S.warning ) : number( row.weight, S.qty2 ), text( row.manual ? MANUAL_LABEL : st.label ), text( row.notes ) ] );
		rows.push( [ text( `${kit.name} — total`, S.bold ), empty(), text( weightText( d.weight ), d.weight.partial ? S.warning : S.cell ), empty(), empty(), empty(), empty(), empty(), number( d.weight.known, S.qty2 ), text( st.label ) ] );

	}

	return { rows, widths: [ 22, 16, 34, 14, 11, 11, 11, 11, 16, 30, 40 ], filter: `A1:K${rows.length}` };

}

function transportSheet( plan ) {

	const rows = [ header( [ 'Carga', 'Data prevista', 'Origem', 'Destino', 'Veículo', 'Kit / origem', 'Código técnico', 'Descrição', 'Planejada', 'Carregada', 'Pendente', 'Peso conhecido (kg)', 'Situação', 'Capacidade / observações' ] ) ];
	for ( const load of plan.loads ) {

		const d = loadDetails( plan, load );
		for ( const row of d.rows ) rows.push( [ text( load.code ), text( brDate( load.date ) ), text( load.origin ), text( load.destination ), text( load.vehicle.name ), text( row.via ), text( row.code ), text( row.name ), intCell( row.planned ), intCell( row.loaded ), intCell( row.pending ), row.weight === null ? empty( S.warning ) : number( row.weight, S.qty2 ), text( d.stateLabel, d.state === 'done' ? S.cell : S.warning ), text( row.notes ) ] );
		for ( const m of d.manual ) rows.push( [ text( load.code ), empty(), empty(), empty(), empty(), text( 'Item manual' ), text( '' ), text( m.name ), intCell( m.quantity ), empty(), empty(), m.unitWeight === null ? empty( S.warning ) : number( m.unitWeight * m.quantity, S.qty2 ), text( MANUAL_LABEL ), empty() ] );
		rows.push( [ text( `${load.code} — total`, S.bold ), empty(), empty(), empty(), empty(), empty(), empty(), text( weightText( d.weight ), d.weight.partial ? S.warning : S.cell ), intCell( d.totalPlanned ), intCell( d.totalLoaded ), intCell( d.totalPlanned - Math.min( d.totalLoaded, d.totalPlanned ) ), number( d.weight.known, S.qty2 ), text( d.stateLabel ), text( d.capacityText, d.capacityState === 'over' || d.capacityState === 'incomplete' ? S.warning : S.cell ) ] );

	}

	rows.push( [ text( '' ) ], [ text( TRANSPORT_LIMITS ) ] );
	return { rows, widths: [ 12, 12, 18, 18, 16, 20, 16, 30, 11, 11, 11, 16, 16, 60 ], filter: `A1:N${Math.max( 1, rows.length - 2 )}` };

}

function checkSheet( plan ) {

	const rows = [ header( [ 'Carga', 'Código técnico', 'Descrição', 'Esperada', 'Recebida', 'Faltante', 'Excedente', 'Avariada (incluída na recebida)', 'Recebida sem avaria declarada', 'Data do registro', 'Responsável informado', 'Observações' ] ) ];
	for ( const load of plan.loads ) for ( const row of loadDetails( plan, load ).rows ) {

		const rec = plan.receiving[ `${load.id}|${row.lineId}` ];
		const st = receivingState( row.planned, rec );
		rows.push( [ text( load.code ), text( row.code ), text( row.name ), intCell( st.expected ), st.registered ? intCell( st.received ) : empty( S.warning ), st.registered ? intCell( st.missing ) : empty(), st.registered ? intCell( st.surplus ) : empty(), st.registered ? intCell( st.damaged ) : empty(), st.registered ? intCell( st.fit ) : empty(), text( rec ? brDateTime( rec.updatedAt ) : 'Não registrado', rec ? S.cell : S.warning ), text( rec ? rec.responsible : '' ), text( rec ? rec.notes : '' ) ] );

	}

	rows.push( [ text( '' ) ], [ text( RECEIVING_CONVENTION ) ], [ text( '' ) ], header( [ 'Ocorrência', 'Tipo', 'Data', 'Peça', 'Quantidade', 'Status', 'Descrição', 'Histórico' ] ) );
	for ( const i of plan.incidents ) rows.push( [ text( i.id.slice( 0, 17 ) ), text( labelOf( INCIDENT_TYPES, i.type ) ), text( brDateTime( i.date ) ), text( i.lineId || '' ), intCell( i.quantity ), text( labelOf( INCIDENT_STATUSES, i.status ), i.status === 'resolved' || i.status === 'dismissed' ? S.cell : S.warning ), text( i.description ), text( i.history.map( ( h ) => `${brDateTime( h.at )} ${labelOf( INCIDENT_STATUSES, h.status )}${h.note ? ': ' + h.note : ''}` ).join( ' | ' ) ) ] );
	return { rows, widths: [ 14, 16, 30, 11, 11, 11, 11, 16, 16, 18, 20, 40 ] };

}

function returnSheet( plan ) {

	const rows = [ header( [ 'Código técnico', 'Descrição', 'Classificação', 'Prevista para retorno', 'Devolvida', 'Avariada (incluída na devolvida)', 'Descartada', 'Faltante', 'Situação', 'Observações' ] ) ];
	for ( const line of linesActive( plan ) ) {

		const r = returnState( plan, line );
		const rec = plan.returns[ line.lineId ];
		rows.push( [ text( line.code ), text( line.name ), text( labelOf( CLASSIFICATIONS, r.classification ) ), intCell( r.expected ), intCell( r.returned ), intCell( r.damaged ), intCell( r.discarded ), intCell( r.missing ), text( r.label, r.state === 'complete' || r.state === 'none' ? S.cell : S.warning ), text( rec ? rec.notes : '' ) ] );

	}

	const last = rows.length;
	const totals = linesActive( plan ).map( ( line ) => returnState( plan, line ) ).reduce( ( t, r ) => [ t[ 0 ] + r.expected, t[ 1 ] + r.returned, t[ 2 ] + r.damaged, t[ 3 ] + r.discarded, t[ 4 ] + r.missing ], [ 0, 0, 0, 0, 0 ] );
	rows.push( [ text( 'Total', S.bold ), empty(), empty(), ...[ 'D', 'E', 'F', 'G', 'H' ].map( ( c, i ) => formula( `SUM(${c}2:${c}${last})`, totals[ i ], S.integer ) ) ] );
	return { rows, widths: [ 16, 32, 16, 14, 12, 16, 12, 12, 18, 40 ], filter: `A1:J${last}` };

}

function toLogisticsXLSX( plan, meta ) {

	return buildWorkbook( [[ 'Resumo', summarySheet( plan, meta ) ], [ 'Lista de Peças', linesSheet( plan ) ], [ 'Etapas', stagesSheet( plan ) ], [ 'Separação e Kits', pickingSheet( plan ) ], [ 'Transporte', transportSheet( plan ) ], [ 'Conferência', checkSheet( plan ) ], [ 'Retorno', returnSheet( plan ) ]], `${TITLE} — ${meta.projectTitle || 'Projeto'}` );

}

// PDF -----------------------------------------------------------------------------------------------------------------

const REPORTS = {
	general: 'Plano Geral',
	picking: 'Lista de Separação',
	loading: 'Lista de Carregamento',
	receiving: 'Conferência de Recebimento',
	returns: 'Conferência de Retorno'
};

function buildLogisticsPages( plan, meta, kind = 'general' ) {

	const doc = PDFDocument( { projectTitle: meta.projectTitle, date: meta.date, title: kind === 'general' ? TITLE : `${REPORTS[ kind ]} — Project3DS`, header: '', footer: FOOTER } );
	const s = planSummary( plan );
	let n = 0;
	const h = ( t ) => doc.heading( `${++ n}. ${t}` );

	h( 'Identificação do projeto' );
	doc.keyValue( 'Projeto', meta.projectTitle || 'Projeto sem nome' );
	doc.keyValue( 'Data de emissão', meta.date.toLocaleDateString( 'pt-BR' ) );
	doc.keyValue( 'Relatório', REPORTS[ kind ] );
	doc.keyValue( 'Base do plano', `revisão ${plan.baseline.revision} — ${brDateTime( plan.baseline.createdAt )}` );

	const pickTable = () => doc.table( [ { title: 'Código', width: 22 }, { title: 'Descrição', width: 50 }, { title: 'Rev.', width: 9, align: 'right' }, { title: 'Kit', width: 30 }, { title: 'Necess. (un)', width: 18, align: 'right' }, { title: 'Separ. (un)', width: 18, align: 'right' }, { title: 'Pend. (un)', width: 18, align: 'right' }, { title: 'Local', width: 24 }, { title: 'Situação', width: 28 }, { title: 'Observações', width: 50 } ], pickingRows( plan ).map( ( r ) => ( { cells: [ r.line.code || '—', r.line.name, r.line.catalogRevision === null ? '' : String( r.line.catalogRevision ), r.kit, String( r.pick.demand ), String( r.pick.picked ), String( r.pick.pending ), r.location, r.pick.label, r.notes ], highlight: r.pick.state !== 'complete' } ) ).concat( [ { cells: [ '', 'Total', '', '', String( s.needed ), String( s.picked ), String( s.pickPending ), '', '', '' ], bold: true } ] ) );

	if ( kind === 'general' ) {

		h( 'Informações do planejamento' );
		doc.keyValue( 'Criado em', brDateTime( plan.createdAt ) );
		doc.keyValue( 'Atualizado em', brDateTime( plan.updatedAt ) );
		doc.keyValue( 'Etapas', `${plan.stages.length} (${s.stagesDone} concluída(s), ${s.stagesPending} pendente(s))` );
		doc.keyValue( 'Kits e cargas', `${plan.kits.length} kit(s) · ${plan.loads.length} carga(s)` );
		h( 'Resumo de peças' );
		doc.keyValue( 'Peças necessárias', `${s.needed} un (${s.identified} com ficha, ${s.unidentified} sem ficha)` );
		doc.keyValue( 'Separadas (declarado)', `${s.picked} un — pendentes ${s.pickPending} un` );
		h( 'Resumo de pesos conhecidos' );
		doc.paragraph( `Peso líquido: ${weightText( s.weight )}` );
		doc.paragraph( `Peso embalado conhecido: ${kg( s.weight.packaged )}${s.weight.packagedUnknown > 0 ? ` (parcial — ${s.weight.packagedUnknown} peça(s) sem peso embalado)` : ''}.` );
		for ( const l of s.loadWeights ) doc.paragraph( `${l.code}: ${l.capacityText}`, { indent: 2 } );
		h( 'Etapas e cronograma' );
		if ( plan.stages.length === 0 ) doc.paragraph( 'Nenhuma etapa cadastrada.' );
		else doc.table( [ { title: 'Nº', width: 8 }, { title: 'Etapa', width: 60 }, { title: 'Tipo', width: 24 }, { title: 'Previsto', width: 34 }, { title: 'Registrado', width: 40 }, { title: 'Responsável', width: 30 }, { title: 'Status', width: 26 }, { title: 'Depende de', width: 20 }, { title: 'Comp.', width: 14, align: 'right' } ], plan.stages.map( ( st ) => ( { cells: [ String( st.number ), st.title, labelOf( STAGE_TYPES, st.type ), [ brDate( st.plannedStart ), brDate( st.plannedEnd ) ].filter( Boolean ).join( ' a ' ) || 'Sem data', [ brDateTime( st.actualStart ), brDateTime( st.actualEnd ) ].filter( Boolean ).join( ' a ' ), st.responsible, labelOf( STAGE_STATUSES, st.status ), st.deps.map( ( d ) => ( plan.stages.find( ( x ) => x.id === d ) || {} ).number ).filter( Boolean ).join( ', ' ), String( st.units.length ) ], highlight: st.status !== 'done' } ) ) );

	}

	if ( kind === 'general' || kind === 'picking' ) {

		h( 'Lista de separação' );
		pickTable();

	}

	if ( kind === 'general' || kind === 'picking' ) {

		h( 'Kits' );
		if ( plan.kits.length === 0 ) doc.paragraph( 'Nenhum kit cadastrado.' );
		for ( const kit of plan.kits ) {

			const d = kitDetails( plan, kit );
			doc.paragraph( `${kit.name}${kit.packageId ? ` (embalagem ${kit.packageId})` : ''} — ${kitStatus( plan, kit ).label}. ${weightText( d.weight )}`, { weight: 'bold' } );
			if ( d.rows.length > 0 ) doc.table( [ { title: 'Código', width: 24 }, { title: 'Descrição', width: 70 }, { title: 'Qtd. (un)', width: 16, align: 'right' }, { title: 'Peso unit.', width: 24, align: 'right' }, { title: 'Peso item', width: 24, align: 'right' }, { title: 'Situação', width: 60 } ], d.rows.map( ( r ) => ( { cells: [ r.code || '—', r.name, String( r.quantity ), r.unitWeight === null ? 'Não informado' : kg( r.unitWeight ), r.weight === null ? '—' : kg( r.weight ), r.status ], highlight: r.weight === null } ) ) );

		}

	}

	if ( kind === 'general' || kind === 'loading' ) {

		h( kind === 'general' ? 'Cargas planejadas' : 'Lista de carregamento' );
		if ( plan.loads.length === 0 ) doc.paragraph( 'Nenhuma carga cadastrada.' );
		for ( const load of plan.loads ) {

			const d = loadDetails( plan, load );
			doc.paragraph( `${load.code} — ${brDate( load.date ) || 'sem data'} — ${load.origin || 'origem não informada'} → ${load.destination || 'destino não informado'} — ${load.vehicle.name || 'veículo não informado'} — ${d.stateLabel}`, { weight: 'bold' } );
			doc.paragraph( `${weightText( d.weight )} ${d.capacityText}`, { indent: 2 } );
			if ( d.rows.length > 0 ) doc.table( [ { title: 'Kit / origem', width: 40 }, { title: 'Código', width: 24 }, { title: 'Descrição', width: 60 }, { title: 'Planej. (un)', width: 20, align: 'right' }, { title: 'Carreg. (un)', width: 20, align: 'right' }, { title: 'Pend. (un)', width: 20, align: 'right' }, { title: 'Peso conhecido', width: 28, align: 'right' }, { title: 'Observações', width: 50 } ], d.rows.map( ( r ) => ( { cells: [ r.via, r.code || '—', r.name, String( r.planned ), String( r.loaded ), String( r.pending ), r.weight === null ? 'Não informado' : kg( r.weight ), r.notes ], highlight: r.pending > 0 } ) ) );

		}

		doc.paragraph( TRANSPORT_LIMITS, { size: 2.3 } );

	}

	if ( kind === 'general' || kind === 'receiving' ) {

		h( 'Conferências de recebimento' );
		doc.paragraph( RECEIVING_CONVENTION );
		const rows = [];
		for ( const load of plan.loads ) for ( const row of loadDetails( plan, load ).rows ) {

			const rec = plan.receiving[ `${load.id}|${row.lineId}` ];
			const st = receivingState( row.planned, rec );
			rows.push( { cells: [ load.code, row.code || '—', row.name, String( st.expected ), st.registered ? String( st.received ) : 'Não registrado', st.registered ? String( st.missing ) : '', st.registered ? String( st.damaged ) : '', st.registered ? String( st.fit ) : '', rec ? brDateTime( rec.updatedAt ) : '', rec ? rec.responsible : '' ], highlight: st.registered === false || st.missing > 0 || st.damaged > 0 } );

		}

		if ( rows.length === 0 ) doc.paragraph( 'Nenhuma carga com itens para conferir.' );
		else doc.table( [ { title: 'Carga', width: 22 }, { title: 'Código', width: 24 }, { title: 'Descrição', width: 50 }, { title: 'Esper.', width: 14, align: 'right' }, { title: 'Receb.', width: 22, align: 'right' }, { title: 'Falta', width: 14, align: 'right' }, { title: 'Avar.', width: 14, align: 'right' }, { title: 'Sem avaria', width: 18, align: 'right' }, { title: 'Registro', width: 30 }, { title: 'Responsável', width: 30 } ], rows );

	}

	if ( kind === 'general' ) {

		h( 'Ocorrências' );
		if ( plan.incidents.length === 0 ) doc.paragraph( 'Nenhuma ocorrência registrada.' );
		else doc.table( [ { title: 'Tipo', width: 34 }, { title: 'Data', width: 30 }, { title: 'Qtd.', width: 12, align: 'right' }, { title: 'Status', width: 24 }, { title: 'Descrição', width: 120 }, { title: 'Alterações', width: 20, align: 'right' } ], plan.incidents.map( ( i ) => ( { cells: [ labelOf( INCIDENT_TYPES, i.type ), brDateTime( i.date ), String( i.quantity ), labelOf( INCIDENT_STATUSES, i.status ), i.description, String( i.history.length ) ], highlight: i.status === 'open' || i.status === 'review' } ) ) );

	}

	if ( kind === 'general' || kind === 'returns' ) {

		h( kind === 'general' ? 'Desmontagem e retorno' : 'Conferência de retorno' );
		const dis = plan.stages.filter( ( st ) => st.type === 'disassembly' || st.type === 'return' );
		if ( kind === 'general' ) doc.paragraph( dis.length === 0 ? 'Nenhuma etapa de desmontagem ou retorno cadastrada.' : `Etapas: ${dis.map( ( st ) => `${st.number}. ${st.title} (${labelOf( STAGE_STATUSES, st.status )})` ).join( '; ' )}.` );
		doc.table( [ { title: 'Código', width: 24 }, { title: 'Descrição', width: 56 }, { title: 'Classificação', width: 28 }, { title: 'Prev. (un)', width: 18, align: 'right' }, { title: 'Devolv. (un)', width: 20, align: 'right' }, { title: 'Avar.', width: 14, align: 'right' }, { title: 'Descart.', width: 16, align: 'right' }, { title: 'Falta', width: 14, align: 'right' }, { title: 'Situação', width: 30 } ], linesActive( plan ).map( ( line ) => {

			const r = returnState( plan, line );
			return { cells: [ line.code || '—', line.name, labelOf( CLASSIFICATIONS, r.classification ), String( r.expected ), String( r.returned ), String( r.damaged ), String( r.discarded ), String( r.missing ), r.label ], highlight: r.missing > 0 && r.returned + r.discarded > 0 };

		} ) );

	}

	h( 'Pendências e observações' );
	const pendencies = [];
	if ( s.pickPending > 0 ) pendencies.push( `${s.pickPending} peça(s) pendente(s) de separação.` );
	if ( s.kitsIncomplete > 0 ) pendencies.push( `${s.kitsIncomplete} kit(s) incompleto(s).` );
	if ( s.weight.partial ) pendencies.push( `${s.weight.unknown} peça(s) sem peso informado.` );
	if ( s.divergences > 0 ) pendencies.push( `${s.divergences} item(ns) com divergência ou ocorrência aberta.` );
	if ( s.returnMissing > 0 ) pendencies.push( `${s.returnMissing} peça(s) faltante(s) no retorno.` );
	for ( const p of pendencies.length > 0 ? pendencies : [ 'Nenhuma pendência registrada nos indicadores do plano.' ] ) doc.paragraph( '• ' + p, { indent: 2 } );
	for ( const note of NOTES ) doc.paragraph( '• ' + note, { indent: 2, size: 2.3 } );
	return doc.finish();

}

function toLogisticsPDF( plan, meta, kind = 'general' ) {

	return toPDFPages( buildLogisticsPages( plan, meta, kind ), { title: `${kind === 'general' ? TITLE : REPORTS[ kind ]} — ${meta.projectTitle || 'Projeto'}`, author: 'Project3DS', date: meta.date } );

}

export { TITLE as LOGISTICS_TITLE, REPORTS as LOGISTICS_REPORTS, toPickingCSV, toLogisticsXLSX, toLogisticsPDF, buildLogisticsPages, pickingRows };
