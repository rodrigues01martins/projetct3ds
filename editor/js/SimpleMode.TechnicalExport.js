// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Exportações da lista técnica de peças:
//   CSV  — UTF-8 com BOM, ";" e vírgula decimal (Excel em português); textos protegidos contra fórmulas; peso não
//          informado fica VAZIO (nunca zero);
//   XLSX — Office Open XML real (gerador da EV-010 reutilizado): Lista de Peças · Fichas Técnicas · Conferência ·
//          Resumo; cabeçalhos, filtros, unidades explícitas, números válidos, pendências destacadas, totalizador
//          (fórmula) com aviso de peso parcial;
//   PDF  — A4 paisagem vetorial (primitivas da EV-009/EV-010), título "Relatório Técnico Cadastral — Project3DS".
// Nenhum documento é apresentado como laudo, certificado, aprovação técnica, ART ou RRT, nem leva assinatura.

import { textCell, numberCell } from './SimpleMode.BudgetCSV.js';
import { buildWorkbook, XLSX_STYLES as S, xlsxText as text, xlsxNumber as number, xlsxFormula as formula, xlsxEmpty as empty } from './SimpleMode.BudgetXLSX.js';
import { PDFDocument } from './SimpleMode.BudgetPDF.js';
import { toPDFPages } from './SimpleMode.PlanPdf.js';
import { categoryName, validationName, formatNominal, formatWeight, DISCLAIMER } from './SimpleMode.TechnicalCatalogData.js';
import { weightText } from './SimpleMode.TechnicalBOM.js';

const REPORT_TITLE = 'Relatório Técnico Cadastral — Project3DS';
const FOOTER = 'Relatório técnico cadastral: organização e rastreabilidade de dados declarados. Não é laudo, certificado nem aprovação técnica.';
const LIMITATIONS = [
	'As dimensões geométricas são medidas no modelo 3D; as nominais, os pesos, materiais e fabricantes são informações declaradas nas fichas.',
	'O peso conhecido soma apenas pesos informados. Peças sem peso não são consideradas como zero.',
	'Compatibilidade técnica declarada não comprova estabilidade física nem capacidade de carga; encaixe geométrico não é verificação estrutural.',
	DISCLAIMER
];

const kg = ( v ) => ( v === null || v === undefined ? '' : v.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 } ) + ' kg' );

// dados únicos de fichas usadas na lista
function recordsOf( bom ) {

	const map = new Map();
	for ( const row of bom.rows ) if ( row.record !== null ) map.set( `${row.record.catalogId}@${row.record.revision}`, row.record );
	return [ ...map.values() ].sort( ( a, b ) => a.code.localeCompare( b.code, 'pt-BR', { numeric: true } ) );

}

// CSV ----------------------------------------------------------------------------------------------------------------

function toTechnicalCSV( report ) {

	const { bom } = report;
	const lines = [ [ 'Código', 'Nome', 'Categoria', 'Fabricante', 'Modelo', 'Revisão', 'Unidade', 'Quantidade', 'Peso unitário (kg)', 'Peso total (kg)', 'Dimensões nominais', 'Situação', 'Observações' ].map( textCell ).join( ';' ) ];
	for ( const row of bom.rows ) {

		lines.push( [
			textCell( row.code ), textCell( row.name ), textCell( row.category ), textCell( row.manufacturer ), textCell( row.model ),
			row.revision === null ? '' : String( row.revision ), textCell( 'un' ), String( row.quantity ),
			numberCell( row.unitWeight, 3 ), numberCell( row.totalWeight, 3 ), textCell( row.nominal ), textCell( row.status ),
			textCell( row.notes.concat( row.origins.length > 0 ? [ 'Origem: ' + row.origins.join( '; ' ) ] : [] ).join( ' ' ) )
		].join( ';' ) );

	}

	const s = bom.summary;
	lines.push( '' );
	lines.push( [ textCell( 'Total de peças' ), '', '', '', '', '', textCell( 'un' ), String( s.totalUnits ) ].join( ';' ) );
	lines.push( [ textCell( 'Peças sem ficha técnica' ), '', '', '', '', '', textCell( 'un' ), String( s.unidentified ) ].join( ';' ) );
	lines.push( [ textCell( s.partial ? 'Peso conhecido parcial — existem peças sem peso cadastrado' : 'Peso conhecido' ), '', '', '', '', '', '', '', '', s.hasAnyWeight ? numberCell( s.knownWeight, 3 ) : '' ].join( ';' ) );
	if ( s.hasAnyPackaged ) lines.push( [ textCell( s.packagedPartial ? 'Peso embalado conhecido parcial (transporte; separado do peso das peças)' : 'Peso embalado conhecido (transporte; separado do peso das peças)' ), '', '', '', '', '', '', '', '', numberCell( s.packagedKnown, 3 ) ].join( ';' ) );

	return '﻿' + lines.join( '\r\n' ) + '\r\n';

}

// XLSX ----------------------------------------------------------------------------------------------------------------

function partsSheet( report ) {

	const rows = [ [ 'Código', 'Nome', 'Categoria', 'Fabricante', 'Modelo', 'Revisão', 'Unidade', 'Quantidade', 'Peso unitário (kg)', 'Peso total (kg)', 'Dimensões nominais', 'Situação', 'Observações' ].map( ( t ) => text( t, S.header ) ) ];
	for ( const row of report.bom.rows ) {

		const r = rows.length + 1;
		const warn = row.statusKind !== 'ok';
		rows.push( [
			text( row.code ), text( row.name ), text( row.category ), text( row.manufacturer ), text( row.model ),
			row.revision === null ? empty() : number( row.revision, S.integer ), text( 'un' ), number( row.quantity, S.integer ),
			row.unitWeight === null ? empty( S.warning ) : number( row.unitWeight, S.qty2 ),
			row.unitWeight === null ? empty( S.warning ) : formula( `H${r}*I${r}`, row.totalWeight, S.qty2 ),
			text( row.nominal ), text( row.status, warn ? S.warning : S.cell ), text( row.notes.join( ' ' ) )
		] );

	}

	const last = rows.length;
	const s = report.bom.summary;
	rows.push( [ text( '' ), text( 'Total de peças', S.bold ), empty(), empty(), empty(), empty(), text( 'un' ), formula( `SUM(H2:H${last})`, s.totalUnits, S.integer ), empty(), formula( `SUM(J2:J${last})`, s.knownWeight, S.qty2 ), text( s.partial ? 'Peso conhecido PARCIAL — existem peças sem peso cadastrado' : 'Peso conhecido (todas as peças com peso informado)', s.partial ? S.warning : S.bold ) ] );
	return { rows, widths: [ 16, 34, 18, 20, 16, 9, 8, 11, 16, 15, 30, 34, 50 ], filter: `A1:M${last}` };

}

function recordsSheet( report ) {

	const header = [ 'Código', 'Revisão', 'Nome', 'Categoria', 'Fabricante', 'Marca', 'Modelo', 'Código do fabricante', 'Largura (mm)', 'Altura (mm)', 'Profundidade (mm)', 'Comprimento (mm)', 'Espessura (mm)', 'Tolerância (mm)', 'Tolerância (%)', 'Material principal', 'Acabamento', 'Peso unitário (kg)', 'Peso embalado (kg)', 'Fonte do peso', 'Fonte das informações', 'Documento', 'Revisão do documento', 'Data de referência', 'Estado declarado', 'Conectores (família técnica)' ];
	const rows = [ header.map( ( t ) => text( t, S.header ) ) ];
	const mm = ( v ) => ( v === null ? empty() : number( v * 1000, S.qty2 ) );
	for ( const r of recordsOf( report.bom ) ) {

		const d = r.dimensions;
		rows.push( [
			text( r.code ), number( r.revision, S.integer ), text( r.name ), text( categoryName( r.category ) ), text( r.manufacturer.name ), text( r.manufacturer.brand ), text( r.manufacturer.model ), text( r.manufacturer.manufacturerCode ),
			mm( d.width ), mm( d.height ), mm( d.depth ), mm( d.length ), mm( d.thickness ), mm( d.tolerance.absolute ), d.tolerance.relative === null ? empty() : number( d.tolerance.relative, S.qty2 ),
			text( r.material.primary ), text( r.material.finish ),
			r.physical.weight === null ? empty( S.warning ) : number( r.physical.weight, S.qty2 ), r.physical.packagedWeight === null ? empty() : number( r.physical.packagedWeight, S.qty2 ),
			text( r.physical.weightSource ), text( r.references.source ), text( r.references.documentId ), text( r.references.documentRevision ), text( r.references.date ? r.references.date.split( '-' ).reverse().join( '/' ) : '' ),
			text( validationName( r.control.validation ) ), text( r.connectors.map( ( c ) => `${c.name}: ${c.family || 'sem família'}` ).join( '; ' ) )
		] );

	}

	return { rows, widths: [ 16, 9, 30, 18, 20, 14, 14, 16, 12, 12, 14, 14, 12, 13, 12, 18, 16, 15, 15, 22, 26, 18, 14, 14, 26, 40 ], filter: `A1:Z${rows.length}` };

}

function checkSheet( report ) {

	const rows = [ [ 'Tipo', 'Descrição', 'Componentes' ].map( ( t ) => text( t, S.header ) ) ];
	const findings = report.validation ? report.validation.findings : [];
	for ( const f of findings ) rows.push( [ text( f.label, f.severity === 'info' ? S.cell : S.warning ), text( f.message ), text( f.objects.map( ( o ) => o.name || 'componente' ).join( ', ' ) ) ] );
	if ( findings.length === 0 ) rows.push( [ text( 'Informação' ), text( 'Nenhuma pendência cadastral ou dimensional encontrada.' ), text( '' ) ] );
	rows.push( [ text( '' ) ] );
	rows.push( [ text( 'Aviso', S.bold ), text( report.validation ? report.validation.notice : '' ) ] );
	return { rows, widths: [ 26, 100, 50 ], filter: `A1:C${findings.length + 1}` };

}

function summarySheet( report ) {

	const s = report.bom.summary;
	const v = report.validation ? report.validation.summary : null;
	const rows = [
		[ text( REPORT_TITLE, S.title ) ],
		[ text( 'Projeto', S.bold ), text( report.projectTitle || 'Projeto sem nome' ) ],
		[ text( 'Escopo', S.bold ), text( report.bom.scope ) ],
		[ text( 'Data de emissão', S.bold ), text( report.date.toLocaleDateString( 'pt-BR' ) ) ],
		[ text( '' ) ],
		[ text( 'Indicador', S.header ), text( 'Valor', S.header ), text( 'Unidade', S.header ) ],
		[ text( 'Total de peças' ), number( s.totalUnits, S.integer ), text( 'un' ) ],
		[ text( 'Peças com ficha técnica' ), number( s.identified, S.integer ), text( 'un' ) ],
		[ text( 'Peças sem ficha técnica' ), number( s.unidentified, S.integer ), text( 'un' ) ],
		[ text( 'Códigos distintos' ), number( s.distinctCodes, S.integer ), text( 'un' ) ],
		[ text( s.partial ? 'Peso conhecido (PARCIAL)' : 'Peso conhecido', s.partial ? S.warning : S.cell ), s.hasAnyWeight ? number( s.knownWeight, S.qty2 ) : empty( S.warning ), text( 'kg' ) ],
		[ text( 'Peças sem peso informado' ), number( s.unknownWeightUnits, S.integer ), text( 'un' ) ],
		[ text( 'Divergências dimensionais (peças)' ), number( s.divergent, S.integer ), text( 'un' ) ]
	];
	if ( s.hasAnyPackaged ) rows.push( [ text( s.packagedPartial ? 'Peso embalado conhecido (PARCIAL, transporte)' : 'Peso embalado conhecido (transporte)' ), number( s.packagedKnown, S.qty2 ), text( 'kg' ) ] );
	if ( v !== null ) {

		rows.push( [ text( 'Pendências cadastrais' ), number( v.pending, S.integer ), text( 'ocorrências' ) ] );
		rows.push( [ text( 'Incompatibilidades declaradas' ), number( v.incompatible, S.integer ), text( 'ocorrências' ) ] );
		rows.push( [ text( 'Informações insuficientes' ), number( v.insufficient, S.integer ), text( 'ocorrências' ) ] );

	}

	rows.push( [ text( '' ) ] );
	rows.push( [ text( weightText( s ), s.partial ? S.warning : S.cell ) ] );
	rows.push( [ text( '' ) ] );
	for ( const note of LIMITATIONS ) rows.push( [ text( note ) ] );
	return { rows, widths: [ 70, 16, 14 ], header: false };

}

function toTechnicalXLSX( report ) {

	return buildWorkbook( [[ 'Lista de Peças', partsSheet( report ) ], [ 'Fichas Técnicas', recordsSheet( report ) ], [ 'Conferência', checkSheet( report ) ], [ 'Resumo', summarySheet( report ) ]], REPORT_TITLE + ' — ' + ( report.projectTitle || 'Projeto' ) );

}

// PDF -----------------------------------------------------------------------------------------------------------------

function buildTechnicalPages( report ) {

	const doc = PDFDocument( { projectTitle: report.projectTitle, date: report.date, title: REPORT_TITLE, header: '', footer: FOOTER } );
	const s = report.bom.summary;
	const v = report.validation ? report.validation.summary : null;

	doc.heading( '1. Identificação' );
	doc.keyValue( 'Projeto', report.projectTitle || 'Projeto sem nome' );
	doc.keyValue( 'Escopo', report.bom.scope );
	doc.keyValue( 'Data de emissão', report.date.toLocaleDateString( 'pt-BR' ) );

	doc.heading( '2. Resumo da montagem' );
	doc.keyValue( 'Total de peças', `${s.totalUnits} un` );
	doc.keyValue( 'Com ficha técnica', `${s.identified} un · ${s.distinctCodes} código(s) distinto(s)` );
	doc.keyValue( 'Sem ficha técnica', `${s.unidentified} un` );
	if ( v !== null ) doc.keyValue( 'Conferência', `${v.pending} pendência(s) · ${v.divergent} divergência(s) dimensional(is) · ${v.incompatible} incompatibilidade(s) declarada(s) · ${v.insufficient} informação(ões) insuficiente(s)` );

	doc.heading( '3. Relação de peças e quantidades' );
	if ( report.bom.rows.length === 0 ) doc.paragraph( 'Nenhuma peça encontrada.' );
	else doc.table( [
		{ title: 'Código', width: 22 }, { title: 'Nome', width: 50 }, { title: 'Categoria', width: 24 }, { title: 'Fabricante', width: 26 },
		{ title: 'Rev.', width: 9, align: 'right' }, { title: 'Qtd. (un)', width: 14, align: 'right' }, { title: 'Peso unit.', width: 20, align: 'right' },
		{ title: 'Peso total', width: 22, align: 'right' }, { title: 'Dimensões nominais', width: 40 }, { title: 'Situação', width: 46 }
	], report.bom.rows.map( ( row ) => ( {
		cells: [ row.code || '—', row.name, row.category, row.manufacturer || 'Não informado', row.revision === null ? '' : String( row.revision ), String( row.quantity ), row.unitWeight === null ? 'Não informado' : kg( row.unitWeight ), row.totalWeight === null ? '—' : kg( row.totalWeight ), row.nominal, row.status ],
		highlight: row.statusKind !== 'ok'
	} ) ).concat( [ { cells: [ '', 'Total', '', '', '', String( s.totalUnits ), '', s.hasAnyWeight ? kg( s.knownWeight ) : '—', '', s.partial ? 'Peso conhecido parcial' : '' ], bold: true, highlight: s.partial } ] ) );

	doc.heading( '4. Pesos conhecidos' );
	doc.paragraph( weightText( s ) );
	if ( s.hasAnyPackaged ) doc.paragraph( `Peso embalado conhecido (transporte, separado do peso das peças): ${kg( s.packagedKnown )}${s.packagedPartial ? ' — parcial' : ''}.` );

	doc.heading( '5. Fichas técnicas resumidas' );
	const records = recordsOf( report.bom );
	if ( records.length === 0 ) doc.paragraph( 'Nenhuma ficha técnica associada.' );
	for ( const r of records ) {

		doc.paragraph( `${r.code} — ${r.name} (revisão ${r.revision})`, { weight: 'bold' } );
		const d = r.dimensions;
		doc.paragraph( `Categoria: ${categoryName( r.category )} · Fabricante: ${r.manufacturer.name || 'Não informado'}${r.manufacturer.model ? ' · Modelo: ' + r.manufacturer.model : ''} · Estado declarado: ${validationName( r.control.validation )}`, { indent: 2 } );
		doc.paragraph( `Dimensões nominais: largura ${formatNominal( d.width, d.unit )}, altura ${formatNominal( d.height, d.unit )}, profundidade ${formatNominal( d.depth, d.unit )}${d.tolerance.absolute !== null ? `, tolerância ±${formatNominal( d.tolerance.absolute, d.unit )}` : ''}${d.tolerance.relative !== null ? `, tolerância ±${d.tolerance.relative.toLocaleString( 'pt-BR' )}%` : ''} · Material: ${r.material.primary || 'Não informado'} · Peso unitário: ${formatWeight( r.physical.weight )}`, { indent: 2 } );
		if ( r.references.source || r.references.documentId ) doc.paragraph( `Referência: ${[ r.references.source, r.references.documentId, r.references.documentRevision ? 'rev. ' + r.references.documentRevision : '', r.references.date ? r.references.date.split( '-' ).reverse().join( '/' ) : '' ].filter( Boolean ).join( ' · ' )}`, { indent: 2 } );

	}

	doc.heading( '6. Pendências' );
	const findings = report.validation ? report.validation.findings : [];
	if ( findings.length === 0 ) doc.paragraph( 'Nenhuma pendência cadastral ou dimensional encontrada nesta conferência.' );
	else doc.table( [ { title: 'Tipo', width: 40 }, { title: 'Descrição', width: 230 } ], findings.map( ( f ) => ( { cells: [ f.label, f.message ], highlight: f.severity !== 'info' } ) ) );

	doc.heading( '7. Observações e limitações' );
	if ( report.validation ) doc.paragraph( report.validation.notice );
	for ( const note of LIMITATIONS ) doc.paragraph( '• ' + note, { indent: 2 } );

	return doc.finish();

}

function toTechnicalPDF( report ) {

	return toPDFPages( buildTechnicalPages( report ), { title: REPORT_TITLE + ' — ' + ( report.projectTitle || 'Projeto' ), author: 'Project3DS', date: report.date } );

}

export { REPORT_TITLE, toTechnicalCSV, toTechnicalXLSX, toTechnicalPDF, buildTechnicalPages, recordsOf };
