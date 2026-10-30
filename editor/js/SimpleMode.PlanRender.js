// EV-009 — Sistema de Plantas Baixas, Cotas e Documentação Técnica
//
// Saídas da prancha a partir da MESMA lista de primitivas (mm de papel):
//   - SVG (tela e arquivo): viewBox em mm, width/height com "mm" → impressão na escala correta;
//   - canvas → PNG na resolução escolhida (dpi);
//   - PDF vetorial (SimpleMode.PlanPdf.js).

const FONT = 'Helvetica, Arial, sans-serif';
const SELECTED = '#0a84ff';

function escapeXML( value ) {

	return String( value ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );

}

const n = ( value ) => Number( value.toFixed( 3 ) ) + 0; // + 0 evita "-0"

// SVG --------------------------------------------------------------------------------------------------------------

function primitiveToSVG( item, interactive ) {

	const data = interactive && item.uuid !== undefined ? ` data-uuid="${item.uuid}"` : '';
	const role = item.role !== undefined ? ` class="p3-${item.role}${item.selected && interactive ? ' selected' : ''}"` : '';
	const id = interactive && item.id !== undefined ? ` data-dimension="${item.id}"` : '';

	if ( item.type === 'text' ) {

		const transform = item.angle !== 0 ? ` transform="rotate(${n( item.angle )} ${n( item.x )} ${n( item.y )})"` : '';
		const anchor = item.anchor !== 'start' ? ` text-anchor="${item.anchor}"` : '';
		const weight = item.weight !== 'normal' ? ` font-weight="${item.weight}"` : '';
		return `<text x="${n( item.x )}" y="${n( item.y )}" font-size="${n( item.size )}"${anchor}${weight} fill="${item.fill}"${transform}${role}${data}${id}>${escapeXML( item.text )}</text>`;

	}

	const points = item.points.map( ( p ) => n( p[ 0 ] ) + ',' + n( p[ 1 ] ) ).join( ' ' );
	const stroke = item.stroke !== null ? ` stroke="${item.selected && interactive ? SELECTED : item.stroke}" stroke-width="${n( item.width )}"` : ' stroke="none"';
	const dash = item.dash !== null ? ` stroke-dasharray="${item.dash.join( ' ' )}"` : '';
	const fill = ` fill="${item.fill !== null ? item.fill : 'none'}"`;
	const tag = item.closed ? 'polygon' : 'polyline';

	return `<${tag} points="${points}"${stroke}${dash}${fill}${role}${data}${id}/>`;

}

function toSVG( drawing, { interactive = false, title = 'Planta baixa' } = {} ) {

	const { width, height } = drawing.sheet;
	const body = drawing.primitives.map( ( item ) => primitiveToSVG( item, interactive ) ).join( '\n' );

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" font-family="${FONT}" stroke-linejoin="miter" stroke-linecap="butt">
<title>${escapeXML( title )}</title>
<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
${body}
</svg>`;

}

// canvas / PNG --------------------------------------------------------------------------------------------------

function renderToCanvas( drawing, dpi = 150 ) {

	const k = dpi / 25.4; // px por mm
	const canvas = document.createElement( 'canvas' );
	canvas.width = Math.round( drawing.sheet.width * k );
	canvas.height = Math.round( drawing.sheet.height * k );

	const ctx = canvas.getContext( '2d' );
	if ( ctx === null ) throw new Error( 'canvas' );

	ctx.fillStyle = '#ffffff';
	ctx.fillRect( 0, 0, canvas.width, canvas.height );
	ctx.scale( k, k );
	ctx.lineJoin = 'miter';
	ctx.lineCap = 'butt';

	for ( const item of drawing.primitives ) {

		if ( item.type === 'text' ) {

			ctx.save();
			ctx.translate( item.x, item.y );
			if ( item.angle !== 0 ) ctx.rotate( item.angle * Math.PI / 180 );
			ctx.font = `${item.weight === 'bold' ? 'bold ' : ''}${item.size}px ${FONT}`;
			ctx.textAlign = item.anchor === 'middle' ? 'center' : ( item.anchor === 'end' ? 'right' : 'left' );
			ctx.textBaseline = 'alphabetic';
			ctx.fillStyle = item.fill;
			ctx.fillText( item.text, 0, 0 );
			ctx.restore();
			continue;

		}

		ctx.beginPath();
		item.points.forEach( ( p, i ) => ( i === 0 ? ctx.moveTo( p[ 0 ], p[ 1 ] ) : ctx.lineTo( p[ 0 ], p[ 1 ] ) ) );
		if ( item.closed ) ctx.closePath();

		if ( item.fill !== null ) {

			ctx.fillStyle = item.fill;
			ctx.fill();

		}

		if ( item.stroke !== null && item.width > 0 ) {

			ctx.strokeStyle = item.stroke;
			ctx.lineWidth = item.width;
			ctx.setLineDash( item.dash !== null ? item.dash : [] );
			ctx.stroke();

		}

	}

	return canvas;

}

function canvasToPNG( canvas ) {

	return new Promise( ( resolve, reject ) => canvas.toBlob( ( blob ) => ( blob !== null ? resolve( blob ) : reject( new Error( 'png' ) ) ), 'image/png' ) );

}

export { toSVG, renderToCanvas, canvasToPNG, escapeXML };
