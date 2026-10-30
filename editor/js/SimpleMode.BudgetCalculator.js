// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Cálculo do orçamento (sempre reconstruído; nada aqui é guardado):
//   quantidade base   = soma da medição nos componentes de origem × coeficiente (se houver), arredondada às casas
//                       da unidade (m, m², un.: 2 casas; m³: 4 casas)
//   quantidade orçada = quantidade base × (1 + perda / 100), arredondada da mesma forma
//   subtotal          = quantidade orçada (exatamente como exibida) × preço unitário em CENTAVOS inteiros,
//                       arredondado ao centavo (meio para cima) — aritmética inteira (BigInt), sem erro de ponto flutuante
//   adicionais        = % sobre o custo direto precificado (arredondado ao centavo) ou valor fixo em centavos
// Itens sem preço não valem zero: ficam fora do custo direto e tornam o total PARCIAL.

import { sourceRecords } from './SimpleMode.Quantities.js';
import { CATEGORIES, roundTo, decimalsOf, measurementUnit, unitLabel, measurementLabel } from './SimpleMode.QuantityRules.js';
import { parseNumber } from './SimpleMode.Units.js';

const currency = new Intl.NumberFormat( 'pt-BR', { style: 'currency', currency: 'BRL' } );

function formatBRL( cents ) {

	if ( cents === null || cents === undefined ) return 'Preço não informado';
	return currency.format( Number( cents ) / 100 );

}

// "R$ 1.260,50", "1260,5", "32.50" → centavos inteiros; null quando inválido ou negativo
function parseMoney( text ) {

	if ( typeof text === 'number' ) return Number.isFinite( text ) && text >= 0 ? Math.round( Number( text + 'e2' ) ) : null;
	if ( typeof text !== 'string' ) return null;

	const clean = text.replace( /R\$/gi, '' ).trim();
	if ( clean === '' ) return null;

	const value = parseNumber( clean );
	if ( value === null || value < 0 ) return null;

	return Math.round( Number( value + 'e2' ) );

}

const BIG_ROUND = ( numerator, denominator ) => ( numerator * 2n + denominator ) / ( denominator * 2n ); // meio para cima (valores ≥ 0)

// quantidade (já arredondada às casas da unidade) × centavos → centavos
function multiplyCents( quantity, decimals, cents ) {

	const scaled = BigInt( Math.round( Number( quantity + 'e' + decimals ) ) );
	return Number( BIG_ROUND( scaled * BigInt( cents ), 10n ** BigInt( decimals ) ) );

}

function percentOfCents( cents, percent ) {

	const scaledPercent = BigInt( Math.round( Number( percent + 'e4' ) ) ); // até 4 casas no percentual
	return Number( BIG_ROUND( BigInt( cents ) * scaledPercent, 1000000n ) );

}

// descrição legível da origem de um item
function describeSource( item, records ) {

	const source = item.source;
	if ( source.kind === 'manual' ) return 'Quantidade manual (sem vínculo geométrico)';

	const measurement = measurementLabel( source.measurement );

	if ( source.kind === 'object' ) {

		const record = records.find( ( r ) => r.uuid === source.objectUuid );
		return record !== undefined ? `${record.code} ${record.name} — ${measurement}` : `Objeto ausente — ${measurement}`;

	}

	const sample = records.find( ( r ) => r.type === source.componentId && ( source.groupKey === null || r.groupKey === source.groupKey ) );
	const typeName = sample !== undefined ? sample.typeLabel : source.componentId;
	return `Todos: ${typeName}${source.groupKey !== null ? ' (mesmas dimensões)' : ''} — ${measurement}`;

}

function computeItem( item, records ) {

	const result = { item, records: [], baseRaw: null, measurementUnit: null, quantityBase: null, quantityBudget: null, subtotalCents: null, status: 'ok', messages: [], sourceLabel: describeSource( item, records ) };
	const decimals = decimalsOf( item.unit );

	if ( item.source.kind === 'manual' ) {

		result.baseRaw = item.source.quantity;
		result.measurementUnit = item.unit;

	} else {

		const matches = sourceRecords( records, item.source );
		result.records = matches;
		result.measurementUnit = measurementUnit( item.source.measurement );

		if ( item.source.kind === 'object' && matches.length === 0 ) {

			result.status = 'missingRef';
			result.messages.push( 'Referência ausente: o objeto vinculado não existe mais. Quantidade indisponível (não é mantido valor antigo).' );
			return result;

		}

		const invalid = matches.filter( ( r ) => r.measurements[ item.source.measurement ] === undefined || Number.isFinite( r.measurements[ item.source.measurement ] ) === false );

		if ( invalid.length > 0 ) {

			result.status = 'invalidSource';
			result.messages.push( `Medição "${measurementLabel( item.source.measurement )}" indisponível em ${invalid.map( ( r ) => r.code ).join( ', ' )}.` );
			return result;

		}

		result.baseRaw = matches.reduce( ( sum, r ) => sum + r.measurements[ item.source.measurement ], 0 );
		if ( matches.length === 0 ) result.messages.push( 'Nenhum componente deste tipo no projeto: quantidade zero.' );
		if ( matches.some( ( r ) => r.status === 'estimated' ) ) result.messages.push( 'Origem com medidas estimadas (caixa envolvente).' );

	}

	// unidades: a medição precisa estar na unidade do item, salvo regra de conversão explícita (coeficiente)
	if ( result.measurementUnit !== item.unit && item.coefficient === null ) {

		result.status = 'incompatible';
		result.messages.push( `Unidades incompatíveis: medição em ${unitLabel( result.measurementUnit )} e item em ${unitLabel( item.unit )}. Defina um coeficiente de conversão ou altere a unidade.` );
		return result;

	}

	if ( result.baseRaw < 0 ) {

		result.status = 'invalidSource';
		result.messages.push( 'Quantidade negativa.' );
		return result;

	}

	result.quantityBase = roundTo( result.baseRaw * ( item.coefficient !== null ? item.coefficient : 1 ), decimals );
	result.quantityBudget = roundTo( result.quantityBase * ( 1 + item.wastePercent / 100 ), decimals );

	if ( item.unitPriceCents === null ) {

		result.status = 'noPrice';
		result.messages.push( 'Preço não informado.' );
		return result;

	}

	result.subtotalCents = multiplyCents( result.quantityBudget, decimals, item.unitPriceCents );
	return result;

}

function computeBudget( budget, quantities ) {

	const records = quantities.records;
	const items = budget.items.map( ( item ) => computeItem( item, records ) );

	const valid = items.filter( ( r ) => r.status === 'ok' );
	const directCents = valid.reduce( ( sum, r ) => sum + r.subtotalCents, 0 );

	const adjustments = budget.adjustments.map( ( adjustment ) => ( {
		adjustment,
		baseCents: adjustment.kind === 'percent' ? directCents : null,
		amountCents: adjustment.kind === 'percent' ? percentOfCents( directCents, adjustment.value ) : adjustment.value
	} ) );

	const adjustmentsCents = adjustments.reduce( ( sum, a ) => sum + a.amountCents, 0 );

	const byCategory = {};
	for ( const key of Object.keys( CATEGORIES ) ) byCategory[ key ] = { count: 0, priced: 0, unpriced: 0, problems: 0, subtotalCents: 0 };

	for ( const result of items ) {

		const entry = byCategory[ result.item.category ];
		entry.count ++;
		if ( result.status === 'ok' ) {

			entry.priced ++;
			entry.subtotalCents += result.subtotalCents;

		} else if ( result.status === 'noPrice' ) entry.unpriced ++;
		else entry.problems ++;

	}

	const unpriced = items.filter( ( r ) => r.status === 'noPrice' ).length;
	const problems = items.filter( ( r ) => r.status !== 'ok' && r.status !== 'noPrice' ).length;

	return {
		items,
		adjustments,
		summary: {
			itemCount: items.length,
			pricedCount: valid.length,
			unpricedCount: unpriced,
			problemCount: problems,
			directCents,
			adjustmentsCents,
			totalCents: directCents + adjustmentsCents,
			pricedPercent: items.length > 0 ? valid.length / items.length * 100 : 0,
			partial: unpriced > 0 || problems > 0,
			byCategory
		}
	};

}

// consolidação física por tipo (unidades diferentes nunca se somam entre si)
function quantitySummary( records ) {

	const rows = new Map();

	for ( const record of records ) {

		const key = record.type + ':' + record.primary;
		if ( rows.has( key ) === false ) rows.set( key, { type: record.type, label: record.typeLabel, category: record.category, measurement: record.primary, unit: measurementUnit( record.primary ), count: 0, total: 0, unavailable: 0 } );

		const row = rows.get( key );
		const value = record.measurements[ record.primary ];
		row.count ++;
		if ( Number.isFinite( value ) ) row.total += value;
		else row.unavailable ++;

	}

	return [ ...rows.values() ];

}

export { computeBudget, computeItem, quantitySummary, formatBRL, parseMoney, multiplyCents, percentOfCents, describeSource };
