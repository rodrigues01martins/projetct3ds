// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Cargas (distribuição PLANEJADA — não significa que o transporte ocorreu), lista de carregamento e recebimento.
//   - a mesma peça física não pode estar em duas cargas sem quantidade suficiente ou transferência declarada;
//   - capacidade do veículo é DECLARADA pelo usuário; a comparação só é conclusiva com todos os pesos conhecidos:
//       peso conhecido > capacidade            → alerta de excedente;
//       peso conhecido ≤ capacidade, mas há itens sem peso → "comparação incompleta" (nunca "capacidade suficiente");
//     nada sobre eixos, estabilidade, amarração, centro de gravidade, dimensões internas, trânsito ou licenciamento —
//     nenhum resultado é autorização de transporte;
//   - carregamento é conferido por quantidade (associar kits não marca a carga como carregada);
//   - recebimento: CONVENÇÃO ÚNICA — a quantidade avariada está INCLUÍDA na quantidade recebida.
//       faltante = max(esperado − recebido, 0); excedente = registrado explicitamente; aptos declarados = recebido − avariado.
//     Peça sem avaria registrada não é "tecnicamente aprovada": é apenas recebida sem avaria declarada.

import { newId, sanitizeLoad, cleanText } from './SimpleMode.LogisticsData.js';
import { LogisticsError, clone, stamp, addEvent, lineMap, demandOf, lineLabel, loadContents, loadAllocation, weightOf } from './SimpleMode.LogisticsPlan.js';

const LOAD_STATES = { todo: 'Não iniciado', partial: 'Parcial', done: 'Carregado', divergent: 'Com divergência' };
const RECEIVING_CONVENTION = 'Convenção: a quantidade avariada está incluída na quantidade recebida (aptos declarados = recebidos − avariados).';
const TRANSPORT_LIMITS = 'Não são verificados distribuição por eixo, estabilidade, amarração, centro de gravidade, dimensões internas reais, regras de trânsito, licenciamento, condições da via nem aptidão do veículo. Nenhum resultado constitui autorização de transporte.';

function addLoad( plan, data ) {

	const next = clone( plan );
	const load = sanitizeLoad( Object.assign( { id: newId( 'load' ), code: `Carga ${String( next.loads.length + 1 ).padStart( 2, '0' )}` }, data ) );
	next.loads.push( load );
	addEvent( next, 'load-added', { ref: load.id, to: load.code } );
	return { plan: stamp( next ), load };

}

function updateLoad( plan, id, changes ) {

	const next = clone( plan );
	const index = next.loads.findIndex( ( l ) => l.id === id );
	if ( index === - 1 ) throw new LogisticsError( 'A carga não existe mais no plano.' );
	const before = next.loads[ index ];
	const merged = sanitizeLoad( Object.assign( {}, before, changes, { id, vehicle: Object.assign( {}, before.vehicle, changes.vehicle || {} ) } ) );
	next.loads[ index ] = merged;
	addEvent( next, 'load-edited', { ref: id, from: before.code, to: merged.code } );
	return stamp( next );

}

function removeLoad( plan, id ) {

	const recorded = Object.keys( plan.loading ).some( ( k ) => k.startsWith( id + '|' ) ) || Object.keys( plan.receiving ).some( ( k ) => k.startsWith( id + '|' ) );
	if ( recorded ) throw new LogisticsError( 'A carga já tem carregamento ou recebimento registrado e não pode ser excluída (os registros são preservados).' );
	const next = clone( plan );
	const load = next.loads.find( ( l ) => l.id === id );
	next.loads = next.loads.filter( ( l ) => l.id !== id );
	addEvent( next, 'load-removed', { ref: id, from: load ? load.code : '' } );
	return stamp( next );

}

// verifica a exclusividade física de uma linha após uma alteração proposta
function checkLoadAllocation( plan, lineId ) {

	const line = lineMap( plan ).get( lineId );
	const total = loadAllocation( plan, lineId );
	const demand = demandOf( line );
	if ( total > demand ) throw new LogisticsError( `${lineLabel( line )}: necessário ${demand}; as cargas somariam ${total}. A mesma peça física não pode seguir em duas cargas sem quantidade suficiente — marque como transferência se for o caso.`, [ String( total - demand ) ], 'allocation' );

}

function setLoadKits( plan, loadId, kitIds ) {

	const next = clone( plan );
	const load = next.loads.find( ( l ) => l.id === loadId );
	if ( load === undefined ) throw new LogisticsError( 'A carga não existe mais no plano.' );
	const from = load.kits.slice();
	load.kits = [ ...new Set( kitIds.filter( ( id ) => next.kits.some( ( k ) => k.id === id ) ) ) ];
	for ( const kit of next.kits.filter( ( k ) => load.kits.includes( k.id ) ) ) for ( const item of kit.items ) if ( item.manual !== true && item.mode === 'exclusive' ) checkLoadAllocation( next, item.lineId );
	const names = ( ids ) => ids.map( ( id ) => ( next.kits.find( ( k ) => k.id === id ) || { name: id } ).name ).join( ', ' ) || '—';
	addEvent( next, 'load-kits', { ref: loadId, from: names( from ), to: names( load.kits ) } );
	return stamp( next );

}

function setLoadItem( plan, loadId, lineId, quantity, transfer = false ) {

	if ( Number.isInteger( quantity ) === false || quantity < 0 ) throw new LogisticsError( 'Informe uma quantidade inteira não negativa.' );
	const line = lineMap( plan ).get( lineId );
	if ( line === undefined ) throw new LogisticsError( 'A peça não está na base do plano.' );
	const next = clone( plan );
	const load = next.loads.find( ( l ) => l.id === loadId );
	if ( load === undefined ) throw new LogisticsError( 'A carga não existe mais no plano.' );
	const existing = load.items.find( ( i ) => i.lineId === lineId && i.transfer === transfer );
	const from = existing ? existing.quantity : 0;
	if ( quantity === 0 ) load.items = load.items.filter( ( i ) => i !== existing );
	else if ( existing ) existing.quantity = quantity;
	else load.items.push( { lineId, quantity, transfer } );
	if ( transfer === false ) checkLoadAllocation( next, lineId );
	addEvent( next, 'load-item', { ref: `${loadId}|${lineId}`, from, to: quantity, note: `${load.code}: ${lineLabel( line )}${transfer ? ' (transferência)' : ''}` } );
	return stamp( next );

}

// resumo de uma carga: linhas planejadas, pesos conhecidos e comparação com a capacidade declarada
function loadDetails( plan, load ) {

	const { lines, manual } = loadContents( plan, load );
	const map = lineMap( plan );
	const rows = lines.map( ( entry ) => {

		const line = map.get( entry.lineId );
		const record = plan.loading[ `${load.id}|${entry.lineId}` ];
		const loaded = record ? record.loaded : 0;
		const surplus = record ? record.surplus : 0;
		return { lineId: entry.lineId, code: line ? line.code : '', name: line ? line.name : 'peça fora da base', via: entry.via.join( ', ' ), planned: entry.quantity, loaded, surplus, pending: Math.max( entry.quantity - loaded, 0 ), weight: line && line.unitWeight !== null ? line.unitWeight * entry.quantity : null, notes: record ? record.notes || '' : '' };

	} );
	const weight = weightOf( plan, lines, manual );
	const capacity = load.vehicle.capacityKg;
	let capacityState = 'none', capacityText = 'Capacidade do veículo não informada.';
	if ( capacity !== null ) {

		const ratio = weight.known / capacity;
		if ( weight.known > capacity ) {

			capacityState = 'over';
			capacityText = `Alerta: o peso conhecido (${weight.known.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } )} kg) excede a capacidade informada (${capacity.toLocaleString( 'pt-BR' )} kg).`;

		} else if ( weight.partial ) {

			capacityState = 'incomplete';
			capacityText = `A comparação é incompleta: existem itens sem peso cadastrado (${weight.unknown}). Peso conhecido: ${( ratio * 100 ).toLocaleString( 'pt-BR', { maximumFractionDigits: 1 } )}% da capacidade informada.`;

		} else {

			capacityState = 'within';
			capacityText = `Peso informado da carga: ${( ratio * 100 ).toLocaleString( 'pt-BR', { maximumFractionDigits: 1 } )}% da capacidade declarada (comparação apenas por peso).`;

		}

	}

	let state = 'todo';
	const totalPlanned = rows.reduce( ( s, r ) => s + r.planned, 0 );
	const totalLoaded = rows.reduce( ( s, r ) => s + r.loaded, 0 );
	if ( rows.some( ( r ) => r.surplus > 0 ) ) state = 'divergent';
	else if ( totalPlanned > 0 && rows.every( ( r ) => r.loaded >= r.planned ) ) state = 'done';
	else if ( totalLoaded > 0 ) state = 'partial';
	return { rows, manual, weight, capacityState, capacityText, state, stateLabel: LOAD_STATES[ state ], totalPlanned, totalLoaded };

}

function setLoaded( plan, loadId, lineId, { loaded, surplus = 0, notes = null, responsible = '' } ) {

	const load = plan.loads.find( ( l ) => l.id === loadId );
	if ( load === undefined ) throw new LogisticsError( 'A carga não existe mais no plano.' );
	const entry = loadContents( plan, load ).lines.find( ( l ) => l.lineId === lineId );
	const planned = entry ? entry.quantity : 0;
	if ( Number.isInteger( loaded ) === false || loaded < 0 || Number.isInteger( surplus ) === false || surplus < 0 ) throw new LogisticsError( 'Use números inteiros não negativos.' );
	if ( loaded > planned ) throw new LogisticsError( `Planejado ${planned}; informado ${loaded}. Registre o excedente de ${loaded - planned} explicitamente.`, [ String( loaded - planned ) ], 'surplus' );
	const next = clone( plan );
	const key = `${loadId}|${lineId}`;
	const before = next.loading[ key ] || { loaded: 0, surplus: 0, rev: 0 };
	next.loading[ key ] = Object.assign( {}, before, { loaded, surplus, notes: notes !== null ? cleanText( notes, 600 ) : ( before.notes || '' ), updatedAt: new Date().toISOString(), responsible: responsible || before.responsible || '', rev: ( before.rev || 0 ) + 1 } );
	addEvent( next, 'loading', { ref: key, from: `${before.loaded}${before.surplus ? ` + excedente ${before.surplus}` : ''}`, to: `${loaded}${surplus ? ` + excedente ${surplus}` : ''}`, responsible, note: load.code } );
	return stamp( next );

}

// recebimento ------------------------------------------------------------------------------------------------------

function receivingState( expected, record ) {

	const received = record ? record.received : 0;
	const damaged = record ? record.damaged : 0;
	const surplus = record ? record.surplus : 0;
	const missing = Math.max( expected - received, 0 );
	const fit = Math.max( received - damaged, 0 );
	return { expected, received, damaged, surplus, missing, fit, registered: record !== undefined && record !== null };

}

function setReceived( plan, loadId, lineId, { received, damaged = 0, surplus = 0, notes = null, responsible = '' } ) {

	const load = plan.loads.find( ( l ) => l.id === loadId );
	if ( load === undefined ) throw new LogisticsError( 'A carga não existe mais no plano.' );
	const entry = loadContents( plan, load ).lines.find( ( l ) => l.lineId === lineId );
	const expected = entry ? entry.quantity : 0;
	for ( const v of [ received, damaged, surplus ] ) if ( Number.isInteger( v ) === false || v < 0 ) throw new LogisticsError( 'Use números inteiros não negativos.' );
	if ( damaged > received ) throw new LogisticsError( 'A quantidade avariada está incluída na recebida: não pode ser maior que a recebida.' );
	if ( received > expected + surplus ) throw new LogisticsError( `Esperado ${expected}; recebido ${received}. Registre o excedente de ${received - expected} explicitamente.`, [ String( received - expected ) ], 'surplus' );
	const next = clone( plan );
	const key = `${loadId}|${lineId}`;
	const before = next.receiving[ key ] || { received: 0, damaged: 0, surplus: 0, rev: 0 };
	next.receiving[ key ] = Object.assign( {}, before, { received, damaged, surplus, notes: notes !== null ? cleanText( notes, 600 ) : ( before.notes || '' ), updatedAt: new Date().toISOString(), responsible: responsible || before.responsible || '', rev: ( before.rev || 0 ) + 1 } );
	const line = lineMap( plan ).get( lineId );
	addEvent( next, 'receiving', { ref: key, from: `${before.received} recebida(s), ${before.damaged} avariada(s)`, to: `${received} recebida(s), ${damaged} avariada(s)${surplus ? `, excedente ${surplus}` : ''}`, responsible, note: `${load.code}: ${lineLabel( line )}` } );
	return stamp( next );

}

export { LOAD_STATES, RECEIVING_CONVENTION, TRANSPORT_LIMITS, addLoad, updateLoad, removeLoad, setLoadKits, setLoadItem, loadDetails, setLoaded, receivingState, setReceived };
