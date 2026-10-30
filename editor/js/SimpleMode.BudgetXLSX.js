// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Planilha Excel (.xlsx, Office Open XML / SpreadsheetML) gerada no navegador, sem dependências novas:
// os XMLs do pacote são montados aqui e compactados com o fflate já presente em examples/jsm/libs.
//   Abas: Quantitativos · Orçamento · Resumo
//   - cabeçalho em negrito, congelado, com filtro automático e larguras definidas;
//   - formatos: R$ #.##0,00, quantidades com 2/4 casas, perda em %;
//   - "Quantidade orçada" e "Subtotal" são FÓRMULAS (ROUND) com o valor calculado já gravado (cache), recalculáveis
//     por qualquer aplicativo; itens sem preço ficam com preço vazio e destacados.
// Textos em células inlineStr (sem tabela de strings compartilhadas, recurso opcional do formato).

import { zipSync, strToU8 } from '../../examples/jsm/libs/fflate.module.js';

import { unitLabel, decimalsOf } from './SimpleMode.QuantityRules.js';
import { formatBRL } from './SimpleMode.BudgetCalculator.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// estilos (índices de cellXfs)
const S = { text: 0, header: 1, cell: 2, qty2: 3, qty4: 4, money: 5, percent: 6, warning: 7, moneyWarning: 8, bold: 9, moneyBold: 10, title: 11, integer: 12 };

// caracteres de controle não são permitidos em XML 1.0 (exceto tabulação e quebras de linha)
function escapeXML( value ) {

	return Array.from( String( value ), ( c ) => ( c.charCodeAt( 0 ) < 32 && c !== '\t' && c !== '\n' && c !== '\r' ? '' : c ) ).join( '' ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );

}

function columnName( index ) {

	let name = '';
	let n = index + 1;
	while ( n > 0 ) {

		const m = ( n - 1 ) % 26;
		name = String.fromCharCode( 65 + m ) + name;
		n = Math.floor( ( n - 1 ) / 26 );

	}

	return name;

}

// células ------------------------------------------------------------------------------------------------------

const text = ( value, style = S.cell ) => ( { kind: 'text', value: value === null || value === undefined ? '' : String( value ), style } );
const number = ( value, style = S.qty2 ) => ( value === null || value === undefined || Number.isFinite( value ) === false ? { kind: 'empty', style } : { kind: 'number', value, style } );
const formula = ( expression, cached, style ) => ( { kind: 'formula', expression, cached, style } );
const empty = ( style = S.cell ) => ( { kind: 'empty', style } );

function cellXML( cell, ref ) {

	switch ( cell.kind ) {

		case 'text': return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${escapeXML( cell.value )}</t></is></c>`;
		case 'number': return `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>`;
		case 'formula':
			if ( typeof cell.cached === 'number' ) return `<c r="${ref}" s="${cell.style}"><f>${escapeXML( cell.expression )}</f><v>${cell.cached}</v></c>`;
			return `<c r="${ref}" s="${cell.style}" t="str"><f>${escapeXML( cell.expression )}</f><v>${escapeXML( cell.cached || '' )}</v></c>`;
		default: return `<c r="${ref}" s="${cell.style}"/>`;

	}

}

function sheetXML( { rows, widths, header = true, filter = null } ) {

	const lastColumn = columnName( Math.max( ...rows.map( ( r ) => r.length ) ) - 1 );
	const body = rows.map( ( row, r ) => `<row r="${r + 1}">${row.map( ( cell, c ) => cellXML( cell, columnName( c ) + ( r + 1 ) ) ).join( '' )}</row>` ).join( '' );
	const pane = header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '';
	const cols = widths.map( ( width, i ) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>` ).join( '' );

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${NS_R}"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${body}</sheetData>${filter !== null ? `<autoFilter ref="${filter}"/>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;

}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0.0000"/><numFmt numFmtId="167" formatCode="0.00&quot;%&quot;"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const money = ( cents, style = S.money ) => number( cents === null || cents === undefined ? null : cents / 100, style );
const qtyStyle = ( unit ) => ( decimalsOf( unit ) === 4 ? S.qty4 : S.qty2 );

// abas -------------------------------------------------------------------------------------------------------------

function quantitiesSheet( report ) {

	const rows = [ [ 'Código', 'Componente', 'Categoria', 'Tipo', 'Dimensões', 'Medição', 'Unidade', 'Quantidade', 'Origem da medição', 'Situação', 'Observações' ].map( ( t ) => text( t, S.header ) ) ];

	for ( const row of report.quantityRows ) {

		const warn = row.status !== 'OK';
		rows.push( [ text( row.code ), text( row.name ), text( row.category ), text( row.type ), text( row.dims ), text( row.measurement ), text( unitLabel( row.unit ) ), number( row.quantity, qtyStyle( row.unit ) ), text( row.origin ), text( row.status, warn ? S.warning : S.cell ), text( row.notes ) ] );

	}

	return { rows, widths: [ 10, 26, 14, 20, 28, 30, 8, 13, 46, 14, 50 ], filter: `A1:K${rows.length}` };

}

function budgetSheet( report ) {

	const rows = [ [ 'Código', 'Categoria', 'Descrição', 'Unidade', 'Quantidade', 'Perda', 'Quantidade orçada', 'Preço unitário', 'Subtotal', 'Situação', 'Origem da quantidade', 'Fonte do preço', 'Data da referência', 'Observações' ].map( ( t ) => text( t, S.header ) ) ];

	report.budgetRows.forEach( ( row ) => {

		const r = rows.length + 1;
		const decimals = decimalsOf( row.unit );
		const usable = row.quantityBase !== null;
		const noPrice = row.unitPriceCents === null;
		const warn = row.status !== 'ok';

		rows.push( [
			text( row.code ), text( row.category ), text( row.description ), text( unitLabel( row.unit ) ),
			number( row.quantityBase, qtyStyle( row.unit ) ),
			number( row.wastePercent, S.percent ),
			usable ? formula( `ROUND(E${r}*(1+F${r}/100),${decimals})`, row.quantityBudget, qtyStyle( row.unit ) ) : empty(),
			noPrice ? empty( S.moneyWarning ) : money( row.unitPriceCents ),
			usable && noPrice === false ? formula( `IF(OR(E${r}="",H${r}=""),"",ROUND(G${r}*H${r},2))`, row.subtotalCents / 100, S.money ) : empty( S.moneyWarning ),
			text( row.statusLabel, warn ? S.warning : S.cell ),
			text( row.source ), text( row.priceSource ), text( row.priceDate || '' ), text( [ row.notes, ...row.messages.filter( ( m ) => m !== 'Preço não informado.' ) ].filter( Boolean ).join( ' ' ) )
		] );

	} );

	const last = rows.length;
	rows.push( [ text( '' ), text( '' ), text( 'Custo direto (itens precificados)', S.bold ), empty(), empty(), empty(), empty(), empty(), formula( `SUM(I2:I${last})`, report.summary.directCents / 100, S.moneyBold ), text( report.summary.partial ? 'Total parcial — existem itens sem preço informado' : '', report.summary.partial ? S.warning : S.cell ) ] );

	return { rows, widths: [ 9, 14, 40, 8, 12, 9, 15, 15, 16, 22, 44, 22, 14, 44 ], filter: `A1:N${last}` };

}

function summarySheet( report ) {

	const s = report.summary;
	const rows = [
		[ text( 'Quantitativos e orçamento estimado', S.title ) ],
		[ text( 'Projeto', S.bold ), text( report.projectTitle || 'Projeto sem nome' ) ],
		[ text( 'Data de emissão', S.bold ), text( report.date.toLocaleDateString( 'pt-BR' ) ) ],
		[ text( 'Referência de preços', S.bold ), text( report.budget.referenceDate ? report.budget.referenceDate.split( '-' ).reverse().join( '/' ) : 'Não informada' ) ],
		[ text( 'Moeda', S.bold ), text( 'Real brasileiro (BRL)' ) ],
		[ text( '' ) ],
		[ 'Categoria', 'Itens', 'Precificados', 'Sem preço', 'Com pendência', 'Subtotal' ].map( ( t ) => text( t, S.header ) )
	];

	for ( const row of report.categoryRows ) rows.push( [ text( row.label ), number( row.count, S.integer ), number( row.priced, S.integer ), number( row.unpriced, S.integer ), number( row.problems, S.integer ), money( row.subtotalCents ) ] );

	rows.push( [ text( 'Custo direto estimado', S.bold ), number( s.itemCount, S.integer ), number( s.pricedCount, S.integer ), number( s.unpricedCount, S.integer ), number( s.problemCount, S.integer ), money( s.directCents, S.moneyBold ) ] );

	for ( const adjustment of report.adjustments ) {

		const a = adjustment.adjustment;
		rows.push( [ text( a.kind === 'percent' ? `${a.label} — ${String( a.value ).replace( '.', ',' )}% sobre o custo direto (${formatBRL( adjustment.baseCents )})` : `${a.label} — valor fixo` ), empty(), empty(), empty(), empty(), money( adjustment.amountCents ) ] );

	}

	rows.push( [ text( s.partial ? 'Total parcial — existem itens sem preço informado' : 'Total estimado', s.partial ? S.warning : S.bold ), empty(), empty(), empty(), empty(), money( s.totalCents, s.partial ? S.moneyWarning : S.moneyBold ) ] );
	rows.push( [ text( `Itens precificados: ${s.pricedCount} de ${s.itemCount} (${s.pricedPercent.toLocaleString( 'pt-BR', { maximumFractionDigits: 1 } )}%)` ) ] );
	rows.push( [ text( '' ) ] );
	rows.push( [ text( 'Avisos', S.bold ) ] );

	const warnings = [ ...report.notes.unpriced.map( ( t ) => 'Sem preço: ' + t ), ...report.notes.problems, ...report.notes.issues ];
	for ( const warning of warnings.length > 0 ? warnings : [ 'Nenhum aviso.' ] ) rows.push( [ text( warning, warnings.length > 0 ? S.warning : S.cell ) ] );

	rows.push( [ text( '' ) ] );
	for ( const note of report.notes.limitations ) rows.push( [ text( note ) ] );

	return { rows, widths: [ 64, 10, 13, 11, 15, 18 ], header: false };

}

// pacote ---------------------------------------------------------------------------------------------------------

function toXLSX( report ) {

	const sheets = [[ 'Quantitativos', quantitiesSheet( report ) ], [ 'Orçamento', budgetSheet( report ) ], [ 'Resumo', summarySheet( report ) ]];
	const now = new Date().toISOString().replace( /\.\d+Z$/, 'Z' );

	const files = {
		'[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map( ( s, i ) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` ).join( '' )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
		'_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
		'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXML( ( report.projectTitle || 'Projeto' ) + ' — Quantitativos e orçamento' )}</dc:title><dc:creator>Project3DS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
		'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Project3DS</Application></Properties>`,
		'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews><sheets>${sheets.map( ( [ name ], i ) => `<sheet name="${escapeXML( name )}" sheetId="${i + 1}" r:id="rId${i + 1}"/>` ).join( '' )}</sheets><definedNames>${sheets.map( ( [ name, sheet ], i ) => ( sheet.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapeXML( name )}'!$${sheet.filter.replace( /(\d+)/g, '$$$1' ).replace( ':', ':$' )}</definedName>` : '' ) ).join( '' )}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
		'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map( ( s, i ) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>` ).join( '' )}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
		'xl/styles.xml': STYLES
	};

	sheets.forEach( ( [ , sheet ], i ) => ( files[ `xl/worksheets/sheet${i + 1}.xml` ] = sheetXML( sheet ) ) );

	const zipped = zipSync( Object.fromEntries( Object.entries( files ).map( ( [ path, content ] ) => [ path, strToU8( content ) ] ) ), { level: 6 } );
	return new Blob( [ zipped ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } );

}

export { toXLSX, columnName, escapeXML as escapeXLSX };
