// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Kits de montagem e lista de separação.
//   Kit: unidade logística de organização (não é objeto 3D, não duplica componentes). Itens:
//     - linha do plano em modo "exclusivo" (alocação física: soma por linha ≤ demanda) ou "reutilização" (mesma peça
//       física usada de novo numa etapa seguinte: não conta como peça adicional);
//     - item manual de apoio — "Item logístico manual — não representado no modelo 3D" (não vai à cena nem ao orçamento).
//   Separação: Quantidade_pendente = necessária − separada (inteiros ≥ 0). Separar acima da necessidade só com
//   registro explícito de excedente. Separar não significa transportar nem entrada física de estoque: é declaração.

import { newId, sanitizeKit, cleanText, MANUAL_LABEL } from './SimpleMode.LogisticsData.js';
import { LogisticsError, clone, stamp, addEvent, lineMap, demandOf, lineLabel, kitAllocation, weightOf } from './SimpleMode.LogisticsPlan.js';

const PICK_STATES = { pending: 'Pendente', partial: 'Parcial', complete: 'Completa', divergent: 'Com divergência' };

function addKit( plan, data ) {

	const next = clone( plan );
	const kit = sanitizeKit( Object.assign( { id: newId( 'kit' ), items: [] }, data ) );
	next.kits.push( kit );
	addEvent( next, 'kit-added', { ref: kit.id, to: kit.name } );
	return { plan: stamp( next ), kit };

}

function updateKit( plan, id, changes ) {

	const next = clone( plan );
	const index = next.kits.findIndex( ( k ) => k.id === id );
	if ( index === - 1 ) throw new LogisticsError( 'O kit não existe mais no plano.' );
	const before = next.kits[ index ];
	next.kits[ index ] = sanitizeKit( Object.assign( {}, before, changes, { id, items: before.items } ) );
	addEvent( next, 'kit-edited', { ref: id, from: before.name, to: next.kits[ index ].name } );
	return stamp( next );

}

function removeKit( plan, id ) {

	const next = clone( plan );
	const kit = next.kits.find( ( k ) => k.id === id );
	if ( kit === undefined ) throw new LogisticsError( 'O kit não existe mais no plano.' );
	next.kits = next.kits.filter( ( k ) => k.id !== id );
	for ( const load of next.loads ) load.kits = load.kits.filter( ( k ) => k !== id );
	for ( const stage of next.stages ) if ( stage.kitId === id ) stage.kitId = null;
	addEvent( next, 'kit-removed', { ref: id, from: kit.name } );
	return stamp( next );

}

// define a quantidade de uma linha num kit; modo exclusivo não pode exceder a demanda (erro 'allocation' → o painel
// oferece "registrar como reutilização" ou cancelar). quantity 0 remove o item.
function setKitItem( plan, kitId, lineId, quantity, mode = 'exclusive' ) {

	const lines = lineMap( plan );
	const line = lines.get( lineId );
	if ( line === undefined ) throw new LogisticsError( 'A peça não está na base do plano.' );
	if ( Number.isInteger( quantity ) === false || quantity < 0 ) throw new LogisticsError( 'Informe uma quantidade inteira não negativa.' );
	const kit = plan.kits.find( ( k ) => k.id === kitId );
	if ( kit === undefined ) throw new LogisticsError( 'O kit não existe mais no plano.' );
	if ( mode === 'exclusive' ) {

		const others = kitAllocation( plan, lineId, kitId );
		const demand = demandOf( line );
		if ( others + quantity > demand ) throw new LogisticsError( `${lineLabel( line )}: necessário ${demand}; já alocado em outros kits ${others}. Alocar ${quantity} aqui somaria ${others + quantity} — a mesma peça física não pode estar em dois kits ao mesmo tempo.`, [ String( demand - others ) ], 'allocation' );

	}

	const next = clone( plan );
	const target = next.kits.find( ( k ) => k.id === kitId );
	const existing = target.items.find( ( i ) => i.manual !== true && i.lineId === lineId && i.mode === mode );
	const from = existing ? existing.quantity : 0;
	if ( quantity === 0 ) target.items = target.items.filter( ( i ) => i !== existing );
	else if ( existing ) existing.quantity = quantity;
	else target.items.push( { lineId, quantity, mode, notes: '' } );
	addEvent( next, 'kit-allocation', { ref: `${kitId}|${lineId}`, from, to: quantity, note: `${target.name}: ${lineLabel( line )}${mode === 'reuse' ? ' (reutilização sequencial)' : ''}` } );
	return stamp( next );

}

function addManualItem( plan, kitId, { name, quantity, unitWeight = null, notes = '' } ) {

	const label = cleanText( name, 120 );
	if ( label === '' ) throw new LogisticsError( 'Informe a descrição do item manual.' );
	if ( Number.isInteger( quantity ) === false || quantity <= 0 ) throw new LogisticsError( 'Informe uma quantidade inteira positiva.' );
	if ( unitWeight !== null && ( Number.isFinite( unitWeight ) === false || unitWeight <= 0 ) ) throw new LogisticsError( 'Peso unitário inválido (deixe vazio se não for conhecido).' );
	const next = clone( plan );
	const kit = next.kits.find( ( k ) => k.id === kitId );
	if ( kit === undefined ) throw new LogisticsError( 'O kit não existe mais no plano.' );
	const item = { id: newId( 'manual' ), manual: true, name: label, quantity, unitWeight, notes: cleanText( notes, 300 ) };
	kit.items.push( item );
	addEvent( next, 'kit-manual-item', { ref: `${kitId}|${item.id}`, to: `${quantity} × ${label}`, note: MANUAL_LABEL } );
	return stamp( next );

}

function removeManualItem( plan, kitId, itemId ) {

	const next = clone( plan );
	const kit = next.kits.find( ( k ) => k.id === kitId );
	if ( kit === undefined ) throw new LogisticsError( 'O kit não existe mais no plano.' );
	const item = kit.items.find( ( i ) => i.id === itemId );
	kit.items = kit.items.filter( ( i ) => i.id !== itemId );
	addEvent( next, 'kit-manual-removed', { ref: `${kitId}|${itemId}`, from: item ? item.name : '' } );
	return stamp( next );

}

// composição de um kit com pesos conhecidos
function kitDetails( plan, kit ) {

	const lines = lineMap( plan );
	const rows = kit.items.map( ( item ) => {

		if ( item.manual ) return { manual: true, id: item.id, code: '', name: item.name, quantity: item.quantity, unitWeight: item.unitWeight, weight: item.unitWeight !== null ? item.unitWeight * item.quantity : null, status: MANUAL_LABEL, notes: item.notes };
		const line = lines.get( item.lineId );
		const unitWeight = line ? line.unitWeight : null;
		return { manual: false, lineId: item.lineId, mode: item.mode, code: line ? line.code : '', name: line ? line.name : 'peça fora da base', quantity: item.quantity, unitWeight, weight: unitWeight !== null ? unitWeight * item.quantity : null, status: line === undefined ? 'Fora da base' : line.retired ? 'Fora do modelo atual' : line.linked ? ( item.mode === 'reuse' ? 'Reutilização sequencial' : 'Com ficha' ) : 'Sem ficha técnica', notes: item.notes || '' };

	} );
	const weight = weightOf( plan, kit.items.filter( ( i ) => i.manual !== true && i.mode === 'exclusive' ), kit.items.filter( ( i ) => i.manual ) );
	return { rows, weight };

}

// kit completo: todas as linhas exclusivas com separação suficiente para a soma alocada nos kits
function kitStatus( plan, kit ) {

	const exclusive = kit.items.filter( ( i ) => i.manual !== true && i.mode === 'exclusive' );
	if ( exclusive.length === 0 && kit.items.length === 0 ) return { complete: false, label: 'Vazio' };
	const missing = exclusive.filter( ( i ) => ( plan.picking[ i.lineId ] ? plan.picking[ i.lineId ].picked : 0 ) < kitAllocation( plan, i.lineId ) );
	return missing.length === 0 ? { complete: true, label: 'Completo (separação declarada)' } : { complete: false, label: `Incompleto: ${missing.length} peça(s) sem separação suficiente` };

}

// separação --------------------------------------------------------------------------------------------------------

function pickState( line, record ) {

	const demand = demandOf( line );
	const picked = record ? record.picked : 0;
	const notFound = record ? record.notFound : 0;
	const surplus = record ? record.surplus : 0;
	const pending = Math.max( demand - picked, 0 );
	let state = 'pending';
	if ( notFound > 0 || surplus > 0 || ( line && line.retired && picked > 0 ) ) state = 'divergent';
	else if ( picked > 0 && picked >= demand ) state = 'complete';
	else if ( picked > 0 ) state = 'partial';
	return { demand, picked, notFound, surplus, pending, state, label: PICK_STATES[ state ], closed: record ? record.closed === true : false };

}

// registra separação; picked > demanda exige surplus explícito (erro 'surplus' → o painel oferece registrar excedente)
function setPicking( plan, lineId, { picked, notFound = null, surplus = null, location = null, notes = null, responsible = '' } ) {

	const line = lineMap( plan ).get( lineId );
	if ( line === undefined ) throw new LogisticsError( 'A peça não está na base do plano.' );
	for ( const [ label, v ] of [[ 'Quantidade separada', picked ], [ 'Não localizada', notFound ], [ 'Excedente', surplus ]] ) if ( v !== null && v !== undefined && ( Number.isInteger( v ) === false || v < 0 ) ) throw new LogisticsError( `${label}: use um número inteiro não negativo.` );
	const demand = demandOf( line );
	if ( picked > demand ) throw new LogisticsError( `${lineLabel( line )}: necessário ${demand}; informado ${picked}. O excedente de ${picked - demand} precisa ser registrado explicitamente.`, [ String( picked - demand ) ], 'surplus' );
	const next = clone( plan );
	const before = next.picking[ lineId ] || { picked: 0, notFound: 0, surplus: 0, rev: 0 };
	const record = Object.assign( {}, before, { picked } );
	if ( notFound !== null && notFound !== undefined ) record.notFound = notFound;
	if ( surplus !== null && surplus !== undefined ) record.surplus = surplus;
	if ( location !== null ) record.location = cleanText( location, 120 );
	if ( notes !== null ) record.notes = cleanText( notes, 600 );
	record.updatedAt = new Date().toISOString();
	record.responsible = responsible || record.responsible || '';
	record.rev = ( before.rev || 0 ) + 1;
	if ( record.closed && record.picked < demand ) delete record.closed;
	next.picking[ lineId ] = record;
	addEvent( next, 'picking', { ref: lineId, from: `${before.picked} separada(s)${before.notFound ? `, ${before.notFound} não localizada(s)` : ''}${before.surplus ? `, excedente ${before.surplus}` : ''}`, to: `${record.picked} separada(s)${record.notFound ? `, ${record.notFound} não localizada(s)` : ''}${record.surplus ? `, excedente ${record.surplus}` : ''}`, responsible, note: lineLabel( line ) } );
	return stamp( next );

}

function closePicking( plan, lineId, closed, responsible = '' ) {

	const line = lineMap( plan ).get( lineId );
	const state = pickState( line, plan.picking[ lineId ] );
	if ( closed && state.state !== 'complete' ) throw new LogisticsError( `Só é possível concluir a separação de ${lineLabel( line )} com a quantidade completa e sem divergência (${state.label.toLowerCase()}).` );
	const next = clone( plan );
	const record = Object.assign( { picked: 0, notFound: 0, surplus: 0, rev: 0 }, next.picking[ lineId ] );
	if ( closed ) record.closed = true;
	else delete record.closed;
	record.updatedAt = new Date().toISOString();
	record.rev = ( record.rev || 0 ) + 1;
	next.picking[ lineId ] = record;
	addEvent( next, closed ? 'picking-closed' : 'picking-reopened', { ref: lineId, responsible, note: lineLabel( line ) } );
	return stamp( next );

}

export { PICK_STATES, addKit, updateKit, removeKit, setKitItem, addManualItem, removeManualItem, kitDetails, kitStatus, pickState, setPicking, closePicking };
