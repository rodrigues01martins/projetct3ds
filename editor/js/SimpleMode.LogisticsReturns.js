// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Retorno de materiais e registro de ocorrências.
//   Retorno: classificação INFORMADA pelo usuário (retornável, consumível, descartável, não definido — nunca inferida
//   do material visual). Previsto para retorno = quantidade da linha quando retornável ou não definida; consumíveis e
//   descartáveis não são presumidos como devolvidos (registros de descarte/consumo são preservados).
//   Mesma convenção do recebimento: avariadas estão INCLUÍDAS nas devolvidas. Faltante = previsto − devolvido − descartado.
//   Ocorrências: nunca apagadas automaticamente; cada mudança de status entra no histórico da ocorrência e no histórico
//   operacional do plano.

import { newId, sanitizeIncident, cleanText, CLASSIFICATIONS, INCIDENT_STATUSES, INCIDENT_TYPES, labelOf } from './SimpleMode.LogisticsData.js';
import { LogisticsError, clone, stamp, addEvent, lineMap, demandOf, lineLabel } from './SimpleMode.LogisticsPlan.js';

const RETURN_STATES = { pending: 'Pendente', partial: 'Parcial', complete: 'Completo', divergent: 'Com divergência', none: 'Sem retorno previsto' };

function classificationOf( plan, lineId ) {

	return plan.lines[ lineId ] ? plan.lines[ lineId ].classification : 'undefined';

}

function setClassification( plan, lineId, classification ) {

	if ( CLASSIFICATIONS.some( ( c ) => c.id === classification ) === false ) throw new LogisticsError( 'Classificação inválida.' );
	const line = lineMap( plan ).get( lineId );
	if ( line === undefined ) throw new LogisticsError( 'A peça não está na base do plano.' );
	const next = clone( plan );
	const before = classificationOf( next, lineId );
	next.lines[ lineId ] = Object.assign( { location: '', notes: '' }, next.lines[ lineId ], { classification } );
	addEvent( next, 'classification', { ref: lineId, from: labelOf( CLASSIFICATIONS, before ), to: labelOf( CLASSIFICATIONS, classification ), note: lineLabel( line ) } );
	return stamp( next );

}

function returnState( plan, line ) {

	const classification = classificationOf( plan, line.lineId );
	const expected = classification === 'returnable' || classification === 'undefined' ? demandOf( line ) : 0;
	const record = plan.returns[ line.lineId ];
	const returned = record ? record.returned : 0, damaged = record ? record.damaged : 0, discarded = record ? record.discarded : 0;
	const missing = Math.max( expected - returned - discarded, 0 );
	let state = 'pending';
	if ( expected === 0 && returned === 0 ) state = 'none';
	else if ( returned + discarded > expected || damaged > 0 ) state = 'divergent';
	else if ( missing === 0 && expected > 0 ) state = 'complete';
	else if ( returned + discarded > 0 ) state = 'partial';
	return { classification, expected, returned, damaged, discarded, missing, state, label: RETURN_STATES[ state ] };

}

function setReturn( plan, lineId, { returned, damaged = 0, discarded = 0, notes = null, responsible = '' } ) {

	const line = lineMap( plan ).get( lineId );
	if ( line === undefined ) throw new LogisticsError( 'A peça não está na base do plano.' );
	for ( const v of [ returned, damaged, discarded ] ) if ( Number.isInteger( v ) === false || v < 0 ) throw new LogisticsError( 'Use números inteiros não negativos.' );
	if ( damaged > returned ) throw new LogisticsError( 'A quantidade avariada está incluída na devolvida: não pode ser maior que a devolvida.' );
	if ( returned + discarded > demandOf( line ) ) throw new LogisticsError( `Devolvidas + descartadas (${returned + discarded}) excedem a quantidade do plano (${demandOf( line )}). Registre uma ocorrência de excedente.` );
	const next = clone( plan );
	const before = next.returns[ lineId ] || { returned: 0, damaged: 0, discarded: 0, rev: 0 };
	next.returns[ lineId ] = Object.assign( {}, before, { returned, damaged, discarded, notes: notes !== null ? cleanText( notes, 600 ) : ( before.notes || '' ), updatedAt: new Date().toISOString(), responsible: responsible || before.responsible || '', rev: ( before.rev || 0 ) + 1 } );
	addEvent( next, 'return', { ref: lineId, from: `${before.returned} devolvida(s), ${before.damaged} avariada(s), ${before.discarded} descartada(s)`, to: `${returned} devolvida(s), ${damaged} avariada(s), ${discarded} descartada(s)`, responsible, note: lineLabel( line ) } );
	return stamp( next );

}

// ocorrências -------------------------------------------------------------------------------------------------------

function addIncident( plan, data ) {

	if ( INCIDENT_TYPES.some( ( t ) => t.id === data.type ) === false ) throw new LogisticsError( 'Tipo de ocorrência inválido.' );
	if ( cleanText( data.description || '', 1000 ) === '' ) throw new LogisticsError( 'Descreva a ocorrência.' );
	const next = clone( plan );
	const now = new Date().toISOString();
	const incident = sanitizeIncident( Object.assign( { id: newId( 'incident' ), date: now, status: 'open' }, data, { history: [ { at: now, status: 'open', note: 'Ocorrência registrada', responsible: data.responsible || '' } ] } ) );
	next.incidents.push( incident );
	addEvent( next, 'incident-added', { ref: incident.id, to: labelOf( INCIDENT_TYPES, incident.type ), responsible: incident.responsible, note: incident.description.slice( 0, 200 ) } );
	return { plan: stamp( next ), incident };

}

function setIncidentStatus( plan, id, status, { note = '', responsible = '' } = {} ) {

	if ( INCIDENT_STATUSES.some( ( s ) => s.id === status ) === false ) throw new LogisticsError( 'Status inválido.' );
	const next = clone( plan );
	const incident = next.incidents.find( ( i ) => i.id === id );
	if ( incident === undefined ) throw new LogisticsError( 'A ocorrência não existe no plano.' );
	const from = incident.status;
	incident.status = status;
	incident.history.push( { at: new Date().toISOString(), status, note: cleanText( note, 300 ), responsible: cleanText( responsible, 80 ) } );
	addEvent( next, 'incident-status', { ref: id, from: labelOf( INCIDENT_STATUSES, from ), to: labelOf( INCIDENT_STATUSES, status ), responsible, note } );
	return stamp( next );

}

export { RETURN_STATES, classificationOf, setClassification, returnState, setReturn, addIncident, setIncidentStatus };
