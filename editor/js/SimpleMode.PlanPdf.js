// EV-009 — Sistema de Plantas Baixas, Cotas e Documentação Técnica
//
// Gerador de PDF vetorial mínimo (sem dependências): uma página no tamanho da folha, linhas, polígonos e textos
// da lista de primitivas. Fontes padrão Helvetica / Helvetica-Bold (WinAnsiEncoding, acentos do português);
// larguras pelas métricas da Helvetica para alinhar textos centralizados. Desenho na escala real (1 mm = 72/25,4 pt).

const PT = 72 / 25.4;

// larguras da Helvetica (1/1000 em), caracteres 32–126
const HELVETICA = [
	278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
	556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
	667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
	556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

// caracteres fora do Latin-1 que existem na WinAnsiEncoding
const WIN_ANSI = { '–': 0x96, '—': 0x97, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80 };
const REPLACE = { '−': '-', '→': '->', '←': '<-' };

function encode( value ) {

	const bytes = [];

	for ( const raw of String( value ) ) {

		const char = REPLACE[ raw ] !== undefined ? REPLACE[ raw ] : raw;

		for ( const c of char ) {

			const code = c.codePointAt( 0 );
			if ( WIN_ANSI[ c ] !== undefined ) bytes.push( WIN_ANSI[ c ] );
			else if ( code >= 32 && code <= 255 && ( code < 127 || code >= 160 ) ) bytes.push( code );
			else bytes.push( 63 ); // '?'

		}

	}

	return bytes;

}

function charWidth( byte, bold ) {

	let width;

	if ( byte >= 32 && byte <= 126 ) {

		width = HELVETICA[ byte - 32 ];

	} else {

		// acentuados: largura da letra base
		const base = String.fromCharCode( byte ).normalize( 'NFD' ).charCodeAt( 0 );
		width = base >= 32 && base <= 126 ? HELVETICA[ base - 32 ] : 556;

	}

	return bold ? width * 1.06 : width;

}

function textWidth( bytes, size, bold ) {

	return bytes.reduce( ( sum, byte ) => sum + charWidth( byte, bold ), 0 ) * size / 1000;

}

// string literal do PDF somente em ASCII (bytes altos em octal)
function literal( bytes ) {

	let out = '(';

	for ( const byte of bytes ) {

		if ( byte === 40 || byte === 41 || byte === 92 ) out += '\\' + String.fromCharCode( byte );
		else if ( byte < 32 || byte > 126 ) out += '\\' + byte.toString( 8 ).padStart( 3, '0' );
		else out += String.fromCharCode( byte );

	}

	return out + ')';

}

function color( hex ) {

	const value = parseInt( hex.slice( 1 ), 16 );
	return [ ( value >> 16 ) & 255, ( value >> 8 ) & 255, value & 255 ].map( ( c ) => Number( ( c / 255 ).toFixed( 4 ) ) ).join( ' ' );

}

const f = ( value ) => Number( value.toFixed( 3 ) ) + 0; // + 0 evita "-0"

function contentStream( drawing ) {

	const H = drawing.sheet.height * PT;
	const X = ( x ) => f( x * PT ), Y = ( y ) => f( H - y * PT );
	const ops = [ '1 1 1 rg', `0 0 ${f( drawing.sheet.width * PT )} ${f( H )} re f`, '0 j 0 J' ];

	for ( const item of drawing.primitives ) {

		if ( item.type === 'text' ) {

			const bold = item.weight === 'bold';
			const bytes = encode( item.text );
			const size = item.size * PT;
			const width = textWidth( bytes, size, bold );
			const shift = item.anchor === 'middle' ? - width / 2 : ( item.anchor === 'end' ? - width : 0 );
			const a = - item.angle * Math.PI / 180; // y para cima no PDF
			const cos = Math.cos( a ), sin = Math.sin( a );

			ops.push( `${color( item.fill )} rg`, 'BT', `/${bold ? 'F2' : 'F1'} ${f( size )} Tf`, `${f( cos )} ${f( sin )} ${f( - sin )} ${f( cos )} ${X( item.x )} ${Y( item.y )} Tm`, `${f( shift )} 0 Td`, `${literal( bytes )} Tj`, 'ET' );
			continue;

		}

		const path = item.points.map( ( p, i ) => `${X( p[ 0 ] )} ${Y( p[ 1 ] )} ${i === 0 ? 'm' : 'l'}` ).join( ' ' ) + ( item.closed ? ' h' : '' );
		const doFill = item.fill !== null;
		const doStroke = item.stroke !== null && item.width > 0;

		if ( doFill ) ops.push( `${color( item.fill )} rg` );
		if ( doStroke ) ops.push( `${color( item.stroke )} RG`, `${f( item.width * PT )} w`, item.dash !== null ? `[${item.dash.map( ( d ) => f( d * PT ) ).join( ' ' )}] 0 d` : '[] 0 d' );

		ops.push( path + ' ' + ( doFill && doStroke ? 'B' : ( doFill ? 'f' : 'S' ) ) );

	}

	return ops.join( '\n' );

}

function pdfDate( date ) {

	const p = ( v ) => String( v ).padStart( 2, '0' );
	return `D:${date.getFullYear()}${p( date.getMonth() + 1 )}${p( date.getDate() )}${p( date.getHours() )}${p( date.getMinutes() )}${p( date.getSeconds() )}`;

}

// devolve um Blob application/pdf
function toPDF( drawing, { title = 'Planta baixa', author = '', date = new Date() } = {} ) {

	const width = f( drawing.sheet.width * PT ), height = f( drawing.sheet.height * PT );
	const content = contentStream( drawing );

	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
		`<< /Title ${literal( encode( title ) )} /Author ${literal( encode( author ) )} /Producer (Project3DS) /CreationDate (${pdfDate( date )}) >>`
	];

	let output = '%PDF-1.4\n%Project3DS\n'; // arquivo inteiro em ASCII: comprimento da string = bytes (offsets do xref)
	const offsets = [];

	objects.forEach( ( body, index ) => {

		offsets.push( output.length );
		output += `${index + 1} 0 obj\n${body}\nendobj\n`;

	} );

	const xref = output.length;
	output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map( ( offset ) => String( offset ).padStart( 10, '0' ) + ' 00000 n \n' ).join( '' );
	output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

	return new Blob( [ output ], { type: 'application/pdf' } );

}

export { toPDF, encode, textWidth };
