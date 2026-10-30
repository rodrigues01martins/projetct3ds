// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Dados do relatório (fonte única para a interface, CSV, XLSX e PDF): quantitativos, planilha orçamentária,
// resumo por categoria, adicionais, total e notas técnicas — tudo recalculado da cena e do orçamento salvo.

import { buildQuantities, dimsText } from './SimpleMode.Quantities.js';
import { computeBudget, quantitySummary } from './SimpleMode.BudgetCalculator.js';
import { getBudget } from './SimpleMode.BudgetData.js';
import { CATEGORIES, MEASUREMENTS, TYPES, measurementUnit, measurementLabel } from './SimpleMode.QuantityRules.js';

// medições exibidas no quadro de quantitativos de cada tipo (as dimensões lineares vão na coluna "Dimensões")
const REPORT_MEASUREMENTS = {
	wall: [ 'netArea', 'grossArea', 'openingsArea', 'netAreaTwoFaces', 'grossVolume', 'netVolume' ],
	floor: [ 'area', 'perimeter', 'volume' ],
	panel: [ 'count', 'areaOneFace', 'volume' ],
	platform: [ 'count', 'topArea', 'volume' ],
	door: [ 'count', 'openingArea' ],
	window: [ 'count', 'openingArea' ]
};

const STATUS_LABELS = {
	ok: 'OK',
	estimated: 'Estimado',
	warning: 'Atenção',
	invalid: 'Inválido',
	noPrice: 'Preço não informado',
	missingRef: 'Referência ausente',
	incompatible: 'Unidades incompatíveis',
	invalidSource: 'Medição indisponível'
};

function statusLabel( status ) {

	return STATUS_LABELS[ status ] || status;

}

function buildReportData( scene, { projectTitle = '', date = new Date() } = {} ) {

	const budget = getBudget( scene );
	const quantities = buildQuantities( scene );
	const computed = computeBudget( budget, quantities );

	const quantityRows = [];

	for ( const record of quantities.records ) {

		const keys = REPORT_MEASUREMENTS[ record.type ] || [ 'count' ];

		keys.forEach( ( key, index ) => {

			const value = record.measurements[ key ];
			quantityRows.push( {
				code: record.code,
				name: record.name,
				category: CATEGORIES[ record.category ],
				type: record.typeLabel,
				dims: dimsText( record ),
				measurement: measurementLabel( key ),
				unit: measurementUnit( key ),
				quantity: Number.isFinite( value ) ? value : null,
				origin: ( MEASUREMENTS[ key ] || {} ).formula || '',
				status: statusLabel( record.status ),
				notes: [ record.host !== null ? 'Hospedada em ' + record.host.name : '', ...record.notes ].filter( Boolean ).join( ' ' ),
				primary: index === 0,
				uuid: record.uuid
			} );

		} );

	}

	const budgetRows = computed.items.map( ( result ) => ( {
		id: result.item.id,
		code: result.item.code,
		category: CATEGORIES[ result.item.category ],
		description: result.item.description,
		unit: result.item.unit,
		quantityBase: result.quantityBase,
		wastePercent: result.item.wastePercent,
		coefficient: result.item.coefficient,
		quantityBudget: result.quantityBudget,
		unitPriceCents: result.item.unitPriceCents,
		subtotalCents: result.subtotalCents,
		status: result.status,
		statusLabel: statusLabel( result.status ),
		messages: result.messages,
		source: result.sourceLabel,
		priceSource: result.item.priceSource,
		priceDate: result.item.priceDate,
		priceCode: result.item.priceCode,
		notes: result.item.notes
	} ) );

	const categoryRows = Object.keys( CATEGORIES ).map( ( key ) => Object.assign( { key, label: CATEGORIES[ key ] }, computed.summary.byCategory[ key ] ) ).filter( ( row ) => row.count > 0 );

	// notas técnicas: critérios usados de fato, limitações e pendências
	const usedTypes = new Set( quantities.records.map( ( r ) => r.type ) );
	const criteria = [];
	if ( usedTypes.has( 'wall' ) ) criteria.push( 'Paredes: área bruta = comprimento × altura; área dos vãos = soma(largura × altura) dos registros de abertura (EV-007), cada vão uma vez; área líquida = bruta − vãos; duas faces = 2 × líquida (sem ombreiras, vergas, peitoris, acabamentos e encontros entre paredes); volume líquido = área líquida × espessura (não é quantitativo executivo de alvenaria).' );
	if ( usedTypes.has( 'floor' ) ) criteria.push( 'Pisos: área = largura × profundidade; volume = área × espessura (geometria; não define revestimento, caixas ou rendimento).' );
	if ( usedTypes.has( 'door' ) || usedTypes.has( 'window' ) ) criteria.push( 'Portas e janelas: contadas por unidade; hospedadas identificadas pelo vínculo com a parede, sem contagem duplicada.' );
	if ( [ 'table', 'chair', 'shelf', 'panel', 'platform' ].some( ( t ) => usedTypes.has( t ) ) ) criteria.push( 'Mobiliário, painéis e plataformas: uma unidade por componente (as peças internas não são contadas separadamente).' );
	if ( usedTypes.has( 'custom' ) || usedTypes.has( 'generic' ) ) criteria.push( 'Componentes personalizados e objetos sem parâmetros: contados por unidade; dimensões da caixa envolvente apenas como estimativa.' );
	criteria.push( 'Escala efetiva dos objetos aplicada às medidas. Quantidade orçada = base × coeficiente (quando informado) × (1 + perda/100), arredondada a 2 casas (m³: 4); subtotal = quantidade orçada × preço unitário, arredondado ao centavo.' );

	const unpriced = budgetRows.filter( ( r ) => r.status === 'noPrice' ).map( ( r ) => `${r.code} — ${r.description}` );
	const problems = budgetRows.filter( ( r ) => r.status !== 'ok' && r.status !== 'noPrice' ).map( ( r ) => `${r.code} — ${r.description}: ${r.messages.join( ' ' )}` );

	return {
		projectTitle,
		date,
		budget,
		quantities,
		computed,
		quantityRows,
		quantitySummary: quantitySummary( quantities.records ).map( ( row ) => Object.assign( row, { categoryLabel: CATEGORIES[ row.category ], typeInfo: TYPES[ row.type ] } ) ),
		budgetRows,
		categoryRows,
		summary: computed.summary,
		adjustments: computed.adjustments,
		notes: {
			criteria,
			limitations: [
				'Estimativa preliminar gerada a partir do modelo 3D: não é orçamento executivo, não substitui levantamento técnico e não considera tributos, encargos, frete ou produtividade.',
				'Preços informados pelo usuário; nenhum valor é consultado automaticamente nem representa referência oficial (SINAPI, SICRO ou outras), salvo indicação da fonte pelo usuário.',
				'Não há conversão automática em blocos, cimento, areia, tinta, caixas de revestimento ou outros insumos sem composição definida pelo usuário.'
			],
			unpriced,
			problems,
			issues: quantities.issues.map( ( issue ) => issue.message )
		}
	};

}

export { buildReportData, statusLabel, STATUS_LABELS, REPORT_MEASUREMENTS };
