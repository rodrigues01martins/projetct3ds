// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// CSV da planilha orçamentária para o Excel em português: UTF-8 com BOM, separador ";", vírgula decimal, CRLF.
// Textos iniciados por = + - @ (ou tabulação/retorno) recebem apóstrofo para não virarem fórmulas; números
// legítimos são escritos como números (sem apóstrofo). Itens sem preço ficam com o preço VAZIO, não zero.

import { unitLabel, decimalsOf } from './SimpleMode.QuantityRules.js';
import { formatBRL } from './SimpleMode.BudgetCalculator.js';

const SEPARATOR = ';';

function textCell( value ) {

	let text = value === null || value === undefined ? '' : String( value );
	if ( /^[=+\-@\t\r]/.test( text ) ) text = '\'' + text; // proteção contra fórmulas
	if ( /[";\r\n]/.test( text ) || /^\s|\s$/.test( text ) ) text = '"' + text.replace( /"/g, '""' ) + '"';
	return text;

}

function numberCell( value, decimals ) {

	if ( value === null || value === undefined || Number.isFinite( value ) === false ) return '';
	return value.toFixed( decimals ).replace( '.', ',' );

}

function centsCell( cents ) {

	if ( cents === null || cents === undefined ) return '';
	const negative = cents < 0;
	const abs = Math.abs( cents );
	return ( negative ? '-' : '' ) + Math.floor( abs / 100 ) + ',' + String( abs % 100 ).padStart( 2, '0' );

}

function line( cells ) {

	return cells.join( SEPARATOR );

}

function toCSV( report ) {

	const lines = [];

	lines.push( line( [ 'Código', 'Categoria', 'Descrição', 'Unidade', 'Quantidade base', 'Perda (%)', 'Quantidade orçada', 'Preço unitário (R$)', 'Subtotal (R$)', 'Situação', 'Origem da quantidade', 'Fonte do preço', 'Data da referência', 'Código de referência', 'Observações' ].map( textCell ) ) );

	for ( const row of report.budgetRows ) {

		const decimals = decimalsOf( row.unit );
		lines.push( line( [
			textCell( row.code ), textCell( row.category ), textCell( row.description ), textCell( unitLabel( row.unit ) ),
			numberCell( row.quantityBase, decimals ), numberCell( row.wastePercent, 2 ), numberCell( row.quantityBudget, decimals ),
			centsCell( row.unitPriceCents ), centsCell( row.subtotalCents ),
			textCell( row.statusLabel ), textCell( row.source ), textCell( row.priceSource ), textCell( row.priceDate || '' ), textCell( row.priceCode ), textCell( [ row.notes, ...row.messages.filter( ( m ) => m !== 'Preço não informado.' ) ].filter( Boolean ).join( ' ' ) )
		] ) );

	}

	const summary = report.summary;
	lines.push( '' );
	lines.push( line( [ textCell( 'Custo direto (itens precificados)' ), '', '', '', '', '', '', '', centsCell( summary.directCents ) ] ) );
	for ( const adjustment of report.adjustments ) {

		const label = adjustment.adjustment.kind === 'percent' ? `${adjustment.adjustment.label} (${String( adjustment.adjustment.value ).replace( '.', ',' )}% sobre ${formatBRL( adjustment.baseCents )})` : adjustment.adjustment.label;
		lines.push( line( [ textCell( label ), '', '', '', '', '', '', '', centsCell( adjustment.amountCents ) ] ) );

	}

	lines.push( line( [ textCell( summary.partial ? 'Total parcial — existem itens sem preço informado' : 'Total estimado' ), '', '', '', '', '', '', '', centsCell( summary.totalCents ) ] ) );

	return '﻿' + lines.join( '\r\n' ) + '\r\n';

}

export { toCSV, textCell, numberCell, centsCell };
