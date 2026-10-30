// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Relatório PDF vetorial (A4 paisagem) com paginação: identificação, quadro de quantitativos, planilha orçamentária,
// resumo financeiro e notas técnicas. Usa as primitivas e o gravador de PDF da EV-009 (SimpleMode.PlanPdf.js:
// Helvetica WinAnsi, acentos preservados, nada rasterizado); a prancha da planta não é afetada.

import { toPDFPages, encode, textWidth } from './SimpleMode.PlanPdf.js';
import { formatQuantity, unitLabel } from './SimpleMode.QuantityRules.js';
import { formatBRL } from './SimpleMode.BudgetCalculator.js';

const PAGE = { width: 297, height: 210 };
const MARGIN = 12;
const HEADER = 16; // altura do cabeçalho (mm a partir da margem)
const FOOTER = 10;
const ROW = 5.4;
const SIZE = 2.6; // mm (≈ 7,4 pt)

const width = ( value, size = SIZE, bold = false ) => textWidth( encode( value ), size, bold );

function fit( value, max, size = SIZE, bold = false ) {

	let content = String( value === null || value === undefined ? '' : value );
	if ( width( content, size, bold ) <= max ) return content;
	while ( content.length > 1 && width( content + '…', size, bold ) > max ) content = content.slice( 0, - 1 );
	return content + '…';

}

function wrap( value, max, size = SIZE, bold = false ) {

	const lines = [];
	let current = '';

	for ( const word of String( value ).split( /\s+/ ) ) {

		const next = current === '' ? word : current + ' ' + word;
		if ( width( next, size, bold ) <= max ) current = next;
		else {

			if ( current !== '' ) lines.push( current );
			current = width( word, size, bold ) <= max ? word : fit( word, max, size, bold );

		}

	}

	if ( current !== '' ) lines.push( current );
	return lines;

}

// documento com páginas e cursor vertical ------------------------------------------------------------------------

function Document( { projectTitle, date, title } ) {

	const pages = [];
	let page = null;
	let y = 0;

	const bottom = PAGE.height - MARGIN - FOOTER;
	const left = MARGIN, right = PAGE.width - MARGIN;

	function text( x, yy, value, options = {} ) {

		page.primitives.push( Object.assign( { type: 'text', x, y: yy, text: String( value ), size: SIZE, anchor: 'start', angle: 0, weight: 'normal', fill: '#000000' }, options ) );

	}

	function line( x1, y1, x2, y2, stroke = '#000000', w = 0.2 ) {

		page.primitives.push( { type: 'poly', points: [[ x1, y1 ], [ x2, y2 ]], closed: false, stroke, width: w, dash: null, fill: null } );

	}

	function rect( x, yy, w, h, fill ) {

		page.primitives.push( { type: 'poly', points: [[ x, yy ], [ x + w, yy ], [ x + w, yy + h ], [ x, yy + h ]], closed: true, stroke: null, width: 0, dash: null, fill } );

	}

	function newPage() {

		page = { sheet: PAGE, primitives: [] };
		pages.push( page );
		text( left, MARGIN + 5, 'Project3DS — ' + title, { size: 3.6, weight: 'bold' } );
		text( right, MARGIN + 5, fit( projectTitle || 'Projeto sem nome', 120, 3.2 ), { size: 3.2, anchor: 'end' } );
		text( right, MARGIN + 10, 'Emitido em ' + date.toLocaleDateString( 'pt-BR' ), { size: 2.4, anchor: 'end', fill: '#555555' } );
		line( left, MARGIN + HEADER - 3, right, MARGIN + HEADER - 3, '#000000', 0.35 );
		y = MARGIN + HEADER + 2;

	}

	function ensure( height ) {

		if ( page === null || y + height > bottom ) newPage();

	}

	function heading( value ) {

		ensure( 14 );
		y += 3;
		text( left, y + 4, value, { size: 3.6, weight: 'bold' } );
		y += 8;

	}

	function paragraph( value, options = {} ) {

		const size = options.size || SIZE;
		for ( const lineText of wrap( value, right - left - ( options.indent || 0 ), size, options.weight === 'bold' ) ) {

			ensure( size * 1.6 );
			text( left + ( options.indent || 0 ), y + size, lineText, Object.assign( { size }, options ) );
			y += size * 1.55;

		}

	}

	function keyValue( key, value ) {

		ensure( ROW );
		text( left, y + 3.8, key, { weight: 'bold' } );
		text( left + 48, y + 3.8, fit( value, right - left - 48 ) );
		y += ROW;

	}

	// tabela com cabeçalho repetido a cada página; rows: { cells: [], bold, highlight }
	function table( columns, rows ) {

		const total = columns.reduce( ( s, c ) => s + c.width, 0 );
		const scale = ( right - left ) / total;
		const cols = columns.map( ( c ) => Object.assign( {}, c, { width: c.width * scale } ) );

		function header() {

			rect( left, y, right - left, ROW + 0.6, '#d9e2f3' );
			let x = left;
			for ( const c of cols ) {

				const tx = c.align === 'right' ? x + c.width - 1.2 : x + 1.2;
				text( tx, y + 4, fit( c.title, c.width - 2.4, SIZE, true ), { weight: 'bold', anchor: c.align === 'right' ? 'end' : 'start' } );
				x += c.width;

			}

			y += ROW + 0.6;

		}

		ensure( ROW * 3 );
		header();

		rows.forEach( ( row, index ) => {

			if ( y + ROW > bottom ) {

				newPage();
				header();

			}

			if ( row.highlight ) rect( left, y, right - left, ROW, '#fff2cc' );
			else if ( index % 2 === 1 ) rect( left, y, right - left, ROW, '#f5f6f8' );

			let x = left;
			cols.forEach( ( c, i ) => {

				const value = row.cells[ i ];
				const tx = c.align === 'right' ? x + c.width - 1.2 : x + 1.2;
				text( tx, y + 3.8, fit( value, c.width - 2.4, SIZE, row.bold ), { anchor: c.align === 'right' ? 'end' : 'start', weight: row.bold ? 'bold' : 'normal' } );
				x += c.width;

			} );

			y += ROW;

		} );

		line( left, y, right, y, '#999999', 0.15 );
		y += 3;

	}

	function finish() {

		pages.forEach( ( p, index ) => {

			page = p;
			line( left, PAGE.height - MARGIN - FOOTER + 3, right, PAGE.height - MARGIN - FOOTER + 3, '#999999', 0.2 );
			text( left, PAGE.height - MARGIN - 1, 'Estimativa preliminar — não é orçamento executivo nem referência oficial de preços.', { size: 2.3, fill: '#555555' } );
			text( right, PAGE.height - MARGIN - 1, `Página ${index + 1} de ${pages.length}`, { size: 2.3, anchor: 'end', fill: '#555555' } );

		} );

		return pages;

	}

	newPage();

	return { heading, paragraph, keyValue, table, finish, get y() {

		return y;

	} };

}

// relatório ---------------------------------------------------------------------------------------------------------

function buildReportPages( report ) {

	const doc = Document( { projectTitle: report.projectTitle, date: report.date, title: 'Quantitativos e orçamento estimado' } );
	const s = report.summary;

	// identificação
	doc.heading( '1. Identificação' );
	doc.keyValue( 'Projeto', report.projectTitle || 'Projeto sem nome' );
	doc.keyValue( 'Data de emissão', report.date.toLocaleDateString( 'pt-BR' ) );
	doc.keyValue( 'Referência de preços', report.budget.referenceDate ? report.budget.referenceDate.split( '-' ).reverse().join( '/' ) : 'Não informada' );
	doc.keyValue( 'Moeda', 'Real brasileiro (BRL)' );
	doc.keyValue( 'Situação', s.partial ? 'Total parcial — existem itens sem preço informado ou com pendência' : 'Todos os itens precificados' );
	if ( report.budget.notes ) doc.paragraph( 'Observações: ' + report.budget.notes );

	// quantitativos
	doc.heading( '2. Quadro de quantitativos' );
	if ( report.quantityRows.length === 0 ) doc.paragraph( 'Nenhum componente mensurável no projeto.' );
	else doc.table( [
		{ title: 'Código', width: 16 }, { title: 'Componente', width: 42 }, { title: 'Categoria', width: 22 }, { title: 'Dimensões', width: 46 },
		{ title: 'Medição', width: 56 }, { title: 'Unid.', width: 12 }, { title: 'Quantidade', width: 22, align: 'right' }, { title: 'Situação', width: 20 }
	], report.quantityRows.map( ( row ) => ( {
		cells: [ row.primary ? row.code : '', row.primary ? row.name : '', row.primary ? row.category : '', row.primary ? row.dims : '', row.measurement, unitLabel( row.unit ), formatQuantity( row.quantity, row.unit ), row.primary ? row.status : '' ],
		highlight: row.primary && row.status !== 'OK'
	} ) ) );

	// orçamento
	doc.heading( '3. Planilha orçamentária' );
	if ( report.budgetRows.length === 0 ) doc.paragraph( 'Nenhum item orçamentário cadastrado.' );
	else {

		doc.table( [
			{ title: 'Cód.', width: 11 }, { title: 'Categoria', width: 22 }, { title: 'Descrição', width: 60 }, { title: 'Unid.', width: 10 },
			{ title: 'Qtd. base', width: 18, align: 'right' }, { title: 'Perda', width: 13, align: 'right' }, { title: 'Qtd. orçada', width: 19, align: 'right' },
			{ title: 'Preço unit.', width: 25, align: 'right' }, { title: 'Subtotal', width: 26, align: 'right' }, { title: 'Situação', width: 30 }
		], report.budgetRows.map( ( row ) => ( {
			cells: [ row.code, row.category, row.description, unitLabel( row.unit ), formatQuantity( row.quantityBase, row.unit ), row.wastePercent.toLocaleString( 'pt-BR', { maximumFractionDigits: 2 } ) + '%', formatQuantity( row.quantityBudget, row.unit ), row.unitPriceCents === null ? 'Preço não informado' : formatBRL( row.unitPriceCents ), row.subtotalCents === null ? '—' : formatBRL( row.subtotalCents ), row.statusLabel ],
			highlight: row.status !== 'ok'
		} ) ).concat( [ { cells: [ '', '', 'Custo direto (itens precificados)', '', '', '', '', '', formatBRL( s.directCents ), '' ], bold: true } ] ) );

	}

	// resumo financeiro
	doc.heading( '4. Resumo financeiro' );
	doc.table( [ { title: 'Categoria', width: 60 }, { title: 'Itens', width: 16, align: 'right' }, { title: 'Precificados', width: 22, align: 'right' }, { title: 'Sem preço', width: 20, align: 'right' }, { title: 'Pendências', width: 20, align: 'right' }, { title: 'Subtotal', width: 32, align: 'right' } ],
		report.categoryRows.map( ( row ) => ( { cells: [ row.label, String( row.count ), String( row.priced ), String( row.unpriced ), String( row.problems ), formatBRL( row.subtotalCents ) ] } ) )
			.concat( [ { cells: [ 'Custo direto estimado', String( s.itemCount ), String( s.pricedCount ), String( s.unpricedCount ), String( s.problemCount ), formatBRL( s.directCents ) ], bold: true } ] )
			.concat( report.adjustments.map( ( a ) => ( { cells: [ a.adjustment.kind === 'percent' ? `${a.adjustment.label} — ${a.adjustment.value.toLocaleString( 'pt-BR' )}% sobre ${formatBRL( a.baseCents )}` : `${a.adjustment.label} — valor fixo`, '', '', '', '', formatBRL( a.amountCents ) ] } ) ) )
			.concat( [ { cells: [ s.partial ? 'Total parcial — existem itens sem preço informado' : 'Total estimado', '', '', '', '', formatBRL( s.totalCents ) ], bold: true, highlight: s.partial } ] ) );
	doc.paragraph( `Itens precificados: ${s.pricedCount} de ${s.itemCount} (${s.pricedPercent.toLocaleString( 'pt-BR', { maximumFractionDigits: 1 } )}%). Os adicionais são calculados sobre o custo direto dos itens precificados; não representam BDI, impostos ou encargos.` );

	// notas técnicas
	doc.heading( '5. Notas técnicas' );
	doc.paragraph( 'Critérios de medição', { weight: 'bold' } );
	for ( const note of report.notes.criteria ) doc.paragraph( '• ' + note, { indent: 2 } );
	doc.paragraph( 'Limitações', { weight: 'bold' } );
	for ( const note of report.notes.limitations ) doc.paragraph( '• ' + note, { indent: 2 } );
	if ( report.notes.unpriced.length > 0 ) {

		doc.paragraph( 'Itens sem preço informado', { weight: 'bold' } );
		for ( const note of report.notes.unpriced ) doc.paragraph( '• ' + note, { indent: 2 } );

	}

	if ( report.notes.problems.length > 0 || report.notes.issues.length > 0 ) {

		doc.paragraph( 'Referências inválidas e inconsistências', { weight: 'bold' } );
		for ( const note of report.notes.problems.concat( report.notes.issues ) ) doc.paragraph( '• ' + note, { indent: 2 } );

	}

	return doc.finish();

}

function toReportPDF( report ) {

	return toPDFPages( buildReportPages( report ), { title: ( report.projectTitle || 'Projeto' ) + ' — Quantitativos e orçamento', author: 'Project3DS', date: report.date } );

}

export { toReportPDF, buildReportPages };
