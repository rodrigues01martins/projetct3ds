// EV-009 — Sistema de Plantas Baixas, Cotas e Documentação Técnica
//
// Prancha técnica: converte o modelo da planta (metros, plano X/Z) em uma LISTA DE PRIMITIVAS em milímetros de papel.
// A mesma lista alimenta a tela (SVG), o PNG (canvas) e o PDF (vetorial) — o desenho é idêntico nos três.
//
// Transformação única mundo → papel (PlanTransform): papel = origem + (mundo − centro) × 1000 / escala.
// X do mundo → direita do papel; Z do mundo → para baixo do papel (frente do projeto, +Z, embaixo — como a vista
// superior da EV-008). Unidades físicas (metros) e de papel (mm) nunca se misturam com pixels de tela.
//
// Convenções gráficas: paredes cortadas com contorno grosso e preenchimento cinza claro (contorno da UNIÃO das paredes,
// sem linhas internas nos encontros); elementos projetados (mobiliário) com linhas finas; janelas acima do corte
// tracejadas; cotas com marcas a 45°.

import { SCALES, PAPERS } from './SimpleMode.PlanData.js';

const MARGIN = 10; // mm (moldura)
const PADDING = 5;
const TITLE_HEIGHT = 34;
const DIM_SPACE = 22; // espaço reservado para cotas em volta do desenho (mm de papel)

const STYLE = {
	cut: { stroke: '#000000', width: 0.7, fill: '#cfcfcf' }, // traço desenhado com 2× a espessura visível (a metade interna fica sob o preenchimento)
	projected: { stroke: '#555555', width: 0.18 },
	floor: { stroke: '#8a8a8a', width: 0.13 },
	symbol: { stroke: '#000000', width: 0.25 },
	thin: { stroke: '#000000', width: 0.13 },
	hidden: { stroke: '#555555', width: 0.18, dash: [ 1.5, 1 ] },
	dimension: { stroke: '#222222', width: 0.13 },
	frame: { stroke: '#000000', width: 0.5 },
	cell: { stroke: '#000000', width: 0.25 }
};

// transformação mundo (m) → papel (mm) -----------------------------------------------------------------------------

class PlanTransform {

	constructor( scale, worldCenter, paperCenter ) {

		this.scale = scale; // denominador (1:scale)
		this.worldCenter = worldCenter; // [x, z]
		this.paperCenter = paperCenter; // [x, y]
		this.factor = 1000 / scale; // mm de papel por metro

	}

	toPaper( p ) {

		return [ this.paperCenter[ 0 ] + ( p[ 0 ] - this.worldCenter[ 0 ] ) * this.factor, this.paperCenter[ 1 ] + ( p[ 1 ] - this.worldCenter[ 1 ] ) * this.factor ];

	}

	toWorld( p ) {

		return [ this.worldCenter[ 0 ] + ( p[ 0 ] - this.paperCenter[ 0 ] ) / this.factor, this.worldCenter[ 1 ] + ( p[ 1 ] - this.paperCenter[ 1 ] ) / this.factor ];

	}

}

// formatação --------------------------------------------------------------------------------------------------------

const DIM_FORMAT = { mm: { factor: 1000, digits: 0 }, cm: { factor: 100, digits: 1 }, m: { factor: 1, digits: 2 } };
const formatters = {};

function formatNumber( value, digits, minimum = 0 ) {

	const key = digits + ':' + minimum;
	if ( formatters[ key ] === undefined ) formatters[ key ] = new Intl.NumberFormat( 'pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: minimum, useGrouping: false } );
	return formatters[ key ].format( value );

}

// medida de cota na unidade do projeto (sem o símbolo; a unidade vai no carimbo)
function formatLength( meters, unit ) {

	const format = DIM_FORMAT[ unit ] || DIM_FORMAT.cm;
	return formatNumber( Math.round( meters * format.factor * 10 ** format.digits ) / 10 ** format.digits + 0, format.digits );

}

function formatArea( squareMeters ) {

	return formatNumber( squareMeters, 2, 2 ) + ' m²';

}

function formatDate( date ) {

	return date.toLocaleDateString( 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' } );

}

// primitivas ----------------------------------------------------------------------------------------------------

function poly( points, style, options = {} ) {

	return Object.assign( { type: 'poly', points, closed: false, stroke: style.stroke, width: style.width, dash: style.dash || null, fill: null }, options );

}

function text( x, y, value, size, options = {} ) {

	return Object.assign( { type: 'text', x, y, text: String( value ), size, anchor: 'start', angle: 0, weight: 'normal', fill: '#000000' }, options );

}

const sub = ( a, b ) => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] ];
const add = ( a, b ) => [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ] ];
const mul = ( a, k ) => [ a[ 0 ] * k, a[ 1 ] * k ];
const len = ( a ) => Math.hypot( a[ 0 ], a[ 1 ] );
const norm = ( a ) => {

	const l = len( a ) || 1;
	return [ a[ 0 ] / l, a[ 1 ] / l ];

};

function arcPoints( center, radius, from, to, steps = 24 ) {

	const out = [];
	for ( let i = 0; i <= steps; i ++ ) {

		const t = from + ( to - from ) * i / steps;
		out.push( [ center[ 0 ] + Math.cos( t ) * radius, center[ 1 ] + Math.sin( t ) * radius ] );

	}

	return out;

}

// cota entre dois pontos do papel, deslocada `offset` mm na direção `side` (vetor unitário perpendicular)
function dimension( p1, p2, offset, side, label, out, options = {} ) {

	const dir = norm( sub( p2, p1 ) );
	let n = side !== undefined ? side : [ - dir[ 1 ], dir[ 0 ] ];
	if ( offset < 0 ) {

		n = mul( n, - 1 );
		offset = - offset;

	}

	const a = add( p1, mul( n, offset ) ), b = add( p2, mul( n, offset ) );
	const style = STYLE.dimension;
	const role = options.role || 'dimension';

	if ( offset > 1.2 ) {

		out.push( poly( [ add( p1, mul( n, 1 ) ), add( a, mul( n, 1.5 ) ) ], style, { role } ) );
		out.push( poly( [ add( p2, mul( n, 1 ) ), add( b, mul( n, 1.5 ) ) ], style, { role } ) );

	}

	out.push( poly( [ add( a, mul( dir, - 1.5 ) ), add( b, mul( dir, 1.5 ) ) ], style, { role, id: options.id } ) );

	// marcas a 45°
	const tick = norm( add( dir, n ) );
	for ( const p of [ a, b ] ) out.push( poly( [ add( p, mul( tick, - 1.2 ) ), add( p, mul( tick, 1.2 ) ) ], { stroke: style.stroke, width: 0.25 }, { role } ) );

	// texto legível: ângulo em [−90°, 90°) — cotas verticais sempre lidas de baixo para cima
	let angle = Math.atan2( dir[ 1 ], dir[ 0 ] ) * 180 / Math.PI;
	if ( angle >= 90 - 1e-9 ) angle -= 180;
	if ( angle < - 90 - 1e-9 ) angle += 180;

	const rad = angle * Math.PI / 180;
	const up = [ Math.sin( rad ), - Math.cos( rad ) ]; // "acima" do texto no papel
	const mid = mul( add( a, b ), 0.5 );
	const position = add( mid, mul( up, 1 ) );

	out.push( text( position[ 0 ], position[ 1 ], label, 2.2, { anchor: 'middle', angle, role, id: options.id } ) );

}

// escala -------------------------------------------------------------------------------------------------------------

function paperSize( plan ) {

	const [ w, h ] = PAPERS[ plan.paper ] || PAPERS.A4;
	return plan.orientation === 'portrait' ? { width: h, height: w } : { width: w, height: h };

}

function drawingArea( sheet ) {

	const x = MARGIN + PADDING, y = MARGIN + PADDING;
	return { x, y, width: sheet.width - 2 * ( MARGIN + PADDING ), height: sheet.height - 2 * ( MARGIN + PADDING ) - TITLE_HEIGHT - 3 };

}

// "Ajustar à folha": maior escala padronizada (menor denominador) em que o desenho e as cotas cabem
function chooseScale( bounds, area, show ) {

	const reserve = show.wallDims || show.overallDims ? DIM_SPACE * 2 : 8;
	const w = Math.max( 0.1, bounds.maxX - bounds.minX ), h = Math.max( 0.1, bounds.maxZ - bounds.minZ );

	for ( const scale of SCALES ) {

		if ( w * 1000 / scale <= area.width - reserve && h * 1000 / scale <= area.height - reserve ) return scale;

	}

	return SCALES[ SCALES.length - 1 ];

}

// prancha -------------------------------------------------------------------------------------------------------------

function buildDrawing( model, plan, { unit = 'cm', projectTitle = '', date = new Date(), selected = null } = {} ) {

	const sheet = paperSize( plan );
	const area = drawingArea( sheet );
	const bounds = model.bounds || { minX: - 2, minZ: - 2, maxX: 2, maxZ: 2 };
	const scale = plan.scale === 'auto' ? chooseScale( bounds, area, plan.show ) : plan.scale;
	const transform = new PlanTransform( scale, [ ( bounds.minX + bounds.maxX ) / 2, ( bounds.minZ + bounds.maxZ ) / 2 ], [ area.x + area.width / 2, area.y + area.height / 2 ] );
	const P = ( p ) => transform.toPaper( p );
	const out = [];
	const warnings = [];

	const drawn = { minX: transform.toPaper( [ bounds.minX, 0 ] )[ 0 ], maxX: transform.toPaper( [ bounds.maxX, 0 ] )[ 0 ], minY: transform.toPaper( [ 0, bounds.minZ ] )[ 1 ], maxY: transform.toPaper( [ 0, bounds.maxZ ] )[ 1 ] };
	if ( drawn.minX < area.x || drawn.maxX > area.x + area.width || drawn.minY < area.y || drawn.maxY > area.y + area.height ) warnings.push( 'overflow' );
	if ( model.level.source === 'none' ) warnings.push( 'noFloor' );
	if ( model.level.source === 'fallback' ) warnings.push( 'floorMissing' );
	if ( model.walls.length === 0 ) warnings.push( 'noWalls' );
	if ( model.incompatible > 0 ) warnings.push( 'incompatible' );

	const mark = ( uuid ) => ( selected !== null && uuid === selected ? { selected: true } : {} );

	// 1. ambientes (contorno dos pisos do nível)
	if ( plan.show.rooms ) {

		for ( const room of model.rooms ) out.push( poly( room.outline.map( P ), STYLE.floor, Object.assign( { closed: true, uuid: room.uuid, role: 'room' }, mark( room.uuid ) ) ) );

	}

	// 2. mobiliário e objetos projetados
	if ( plan.show.furniture ) {

		for ( const item of model.furniture ) {

			for ( const hull of item.parts ) out.push( poly( hull.map( P ), STYLE.projected, Object.assign( { closed: true, uuid: item.uuid, role: 'furniture' }, mark( item.uuid ) ) ) );

		}

	}

	// 3. paredes abaixo do corte (muretas): projetadas
	for ( const wall of model.walls.filter( ( w ) => w.state === 'below' ) ) out.push( poly( wall.outline.map( P ), STYLE.projected, Object.assign( { closed: true, uuid: wall.uuid, role: 'wall-projected' }, mark( wall.uuid ) ) ) );

	// 4. paredes cortadas: traço duplo sob o preenchimento → só o contorno externo da união aparece
	const cutWalls = model.walls.filter( ( w ) => w.state === 'cut' );
	const sections = [];
	cutWalls.forEach( ( wall ) => wall.sections.forEach( ( section ) => sections.push( { wall, points: section.map( P ) } ) ) );

	for ( const { wall, points } of sections ) out.push( poly( points, { stroke: STYLE.cut.stroke, width: STYLE.cut.width * 2 }, Object.assign( { closed: true, role: 'wall-outline', uuid: wall.uuid }, mark( wall.uuid ) ) ) );
	for ( const { wall, points } of sections ) out.push( poly( points, { stroke: null, width: 0 }, { closed: true, fill: STYLE.cut.fill, role: 'wall', uuid: wall.uuid } ) );

	// 5. portas e janelas (registros da EV-007)
	for ( const wall of model.walls ) {

		for ( const opening of wall.openings ) {

			const front = opening.frontDir;
			const along = norm( sub( opening.b, opening.a ) );

			if ( opening.type === 'door' && opening.cut ) {

				// folha aberta a 90° para a frente da parede, dobradiça no lado esquerdo (como o componente 3D)
				const leaf = Math.max( 0.2, opening.width - 2 * opening.frameWidth );
				const hingeWorld = add( opening.aFront, mul( along, opening.frameWidth ) );
				const hinge = P( hingeWorld );
				const open = P( add( hingeWorld, mul( front, leaf ) ) );
				const radius = leaf * transform.factor;
				const startAngle = Math.atan2( open[ 1 ] - hinge[ 1 ], open[ 0 ] - hinge[ 0 ] );
				const closed = P( add( hingeWorld, mul( along, leaf ) ) );
				let endAngle = Math.atan2( closed[ 1 ] - hinge[ 1 ], closed[ 0 ] - hinge[ 0 ] );
				while ( endAngle - startAngle > Math.PI ) endAngle -= 2 * Math.PI;
				while ( startAngle - endAngle > Math.PI ) endAngle += 2 * Math.PI;

				out.push( poly( [ hinge, open ], STYLE.symbol, { role: 'door', uuid: opening.uuid } ) );
				out.push( poly( arcPoints( hinge, radius, startAngle, endAngle ), STYLE.thin, { role: 'door-swing', uuid: opening.uuid } ) );

			} else if ( opening.type === 'window' && opening.cut ) {

				// peitoril nas duas faces + vidro (linha dupla no eixo)
				const offset = mul( front, wall.thickness / 8 );
				out.push( poly( [ P( opening.aFront ), P( opening.bFront ) ], STYLE.thin, { role: 'window', uuid: opening.uuid } ) );
				out.push( poly( [ P( opening.aBack ), P( opening.bBack ) ], STYLE.thin, { role: 'window', uuid: opening.uuid } ) );
				out.push( poly( [ P( add( opening.a, offset ) ), P( add( opening.b, offset ) ) ], STYLE.symbol, { role: 'window-glass', uuid: opening.uuid } ) );
				out.push( poly( [ P( sub( opening.a, offset ) ), P( sub( opening.b, offset ) ) ], STYLE.symbol, { role: 'window-glass', uuid: opening.uuid } ) );

			} else if ( opening.above ) {

				// abertura acima do plano de corte (janela alta): tracejada
				out.push( poly( [ opening.aFront, opening.bFront, opening.bBack, opening.aBack ].map( P ), STYLE.hidden, { closed: true, role: 'opening-above', uuid: opening.uuid } ) );

			}

		}

	}

	// 6. cotas
	const center = [ ( drawn.minX + drawn.maxX ) / 2, ( drawn.minY + drawn.maxY ) / 2 ];

	for ( const wall of cutWalls.filter( ( w ) => w.kind === 'wall' ) ) {

		const s = P( wall.start ), e = P( wall.end );
		const dir = norm( sub( e, s ) );
		let n = [ - dir[ 1 ], dir[ 0 ] ];
		if ( n[ 0 ] * ( ( s[ 0 ] + e[ 0 ] ) / 2 - center[ 0 ] ) + n[ 1 ] * ( ( s[ 1 ] + e[ 1 ] ) / 2 - center[ 1 ] ) < 0 ) n = mul( n, - 1 ); // lado de fora do desenho
		const half = wall.thickness / 2 * transform.factor;

		if ( plan.show.wallDims ) {

			const face = [ add( s, mul( n, half ) ), add( e, mul( n, half ) ) ];
			dimension( face[ 0 ], face[ 1 ], 7, n, formatLength( wall.width, unit ), out, { role: 'dimension-wall' } );

		}

		if ( plan.show.openingDims ) {

			for ( const opening of wall.openings.filter( ( o ) => o.cut ) ) {

				const a = add( P( opening.a ), mul( n, - half ) ), b = add( P( opening.b ), mul( n, - half ) );
				dimension( a, b, 4, mul( n, - 1 ), formatLength( opening.width, unit ), out, { role: 'dimension-opening' } );

			}

		}

	}

	if ( plan.show.overallDims && model.bounds !== null ) {

		const top = drawn.minY, left = drawn.minX;
		dimension( [ drawn.minX, top ], [ drawn.maxX, top ], 16, [ 0, - 1 ], formatLength( bounds.maxX - bounds.minX, unit ), out, { role: 'dimension-overall' } );
		dimension( [ left, drawn.minY ], [ left, drawn.maxY ], 16, [ - 1, 0 ], formatLength( bounds.maxZ - bounds.minZ, unit ), out, { role: 'dimension-overall' } );

	}

	for ( const item of plan.dimensions ) {

		const a = P( item.a ), b = P( item.b );
		const length = Math.hypot( item.b[ 0 ] - item.a[ 0 ], item.b[ 1 ] - item.a[ 1 ] );
		dimension( a, b, item.offset * transform.factor, undefined, formatLength( length, unit ), out, { role: 'dimension-user', id: item.id } );

	}

	// 7. ambientes: nome e área
	if ( plan.show.rooms ) {

		for ( const room of model.rooms ) {

			const c = P( room.center );
			out.push( text( c[ 0 ], c[ 1 ] - 0.8, room.name, 3, { anchor: 'middle', weight: 'bold', role: 'room-name', uuid: room.uuid } ) );
			out.push( text( c[ 0 ], c[ 1 ] + 3.2, formatArea( room.area ), 2.4, { anchor: 'middle', role: 'room-area', uuid: room.uuid } ) );

		}

	}

	// 8. orientação e escala gráfica
	if ( plan.show.north ) {

		const nx = area.x + area.width - 9, ny = area.y + 10;
		out.push( poly( arcPoints( [ nx, ny ], 5, 0, Math.PI * 2, 32 ), STYLE.thin, { closed: true, role: 'north' } ) );
		out.push( poly( [[ nx, ny - 5 ], [ nx + 2.2, ny + 3 ], [ nx, ny + 1.6 ], [ nx - 2.2, ny + 3 ]], { stroke: '#000000', width: 0.18 }, { closed: true, fill: '#000000', role: 'north' } ) );
		out.push( text( nx, ny - 6.5, 'N', 2.8, { anchor: 'middle', weight: 'bold', role: 'north' } ) );

	}

	if ( plan.show.scaleBar ) {

		const steps = [ 1, 2, 5, 10, 20, 50 ];
		const total = steps.find( ( m ) => m * transform.factor >= 30 ) || 50; // pelo menos ~30 mm de barra
		const segments = total <= 2 ? total * 2 : 4;
		const unitLength = total / segments * transform.factor;
		const x0 = area.x + 2, y0 = area.y + area.height - 6;

		for ( let i = 0; i < segments; i ++ ) out.push( poly( [[ x0 + i * unitLength, y0 ], [ x0 + ( i + 1 ) * unitLength, y0 ], [ x0 + ( i + 1 ) * unitLength, y0 + 1.6 ], [ x0 + i * unitLength, y0 + 1.6 ]], { stroke: '#000000', width: 0.18 }, { closed: true, fill: i % 2 === 0 ? '#000000' : '#ffffff', role: 'scale-bar' } ) );
		out.push( text( x0, y0 - 1.2, '0', 2, { anchor: 'middle', role: 'scale-bar' } ) );
		out.push( text( x0 + segments * unitLength, y0 - 1.2, formatNumber( total, 2 ) + ' m', 2, { anchor: 'middle', role: 'scale-bar' } ) );
		out.push( text( x0 + segments * unitLength + 6, y0 + 1.6, '1:' + scale, 2, { role: 'scale-bar' } ) );

	}

	// 9. moldura e carimbo
	out.push( poly( [[ MARGIN, MARGIN ], [ sheet.width - MARGIN, MARGIN ], [ sheet.width - MARGIN, sheet.height - MARGIN ], [ MARGIN, sheet.height - MARGIN ]], STYLE.frame, { closed: true, role: 'frame' } ) );
	titleBlock( out, sheet, model, plan, { unit, projectTitle, date, scale } );

	return { sheet, area, scale, transform, primitives: out, warnings, unit };

}

function titleBlock( out, sheet, model, plan, { unit, projectTitle, date, scale } ) {

	const width = Math.min( 190, sheet.width - 2 * MARGIN );
	const x = sheet.width - MARGIN - width, y = sheet.height - MARGIN - TITLE_HEIGHT;
	const rect = ( x0, y0, w, h ) => poly( [[ x0, y0 ], [ x0 + w, y0 ], [ x0 + w, y0 + h ], [ x0, y0 + h ]], STYLE.cell, { closed: true, role: 'title' } );
	const label = ( x0, y0, value ) => text( x0 + 1.5, y0 + 3, value, 1.7, { fill: '#555555', role: 'title' } );
	const value = ( x0, y0, content, size = 2.8, weight = 'normal' ) => text( x0 + 1.5, y0 + 8, content, size, { weight, role: 'title' } );

	out.push( poly( [[ x, y ], [ x + width, y ], [ x + width, y + TITLE_HEIGHT ], [ x, y + TITLE_HEIGHT ]], STYLE.frame, { closed: true, fill: '#ffffff', role: 'title' } ) );

	const level = model.level.source === 'none' ? 'Sem piso — referência Y = 0' : `${model.level.floorName} (topo ${formatNumber( model.level.referenceY, 2, 2 )} m)`;
	const rowH = 11;
	const half = width * 0.62;

	out.push( rect( x, y, half, rowH ), label( x, y, 'PROJETO' ), value( x, y, ellipsis( projectTitle || 'Projeto sem nome', 54 ), 3.2, 'bold' ) );
	out.push( rect( x + half, y, width - half, rowH ), label( x + half, y, 'DESENHO' ), value( x + half, y, ellipsis( plan.title, 30 ), 2.8, 'bold' ) );
	out.push( rect( x, y + rowH, half, rowH ), label( x, y + rowH, 'NÍVEL E CORTE' ), value( x, y + rowH, ellipsis( `${level} · corte a ${formatNumber( model.cutHeight, 2, 2 )} m`, 64 ), 2.3 ) );

	const cells = [[ 'ESCALA', '1:' + scale ], [ 'DATA', formatDate( date ) ], [ 'FOLHA', plan.sheet ]];
	const cellW = ( width - half ) / cells.length;
	cells.forEach( ( [ title, content ], i ) => out.push( rect( x + half + i * cellW, y + rowH, cellW, rowH ), label( x + half + i * cellW, y + rowH, title ), value( x + half + i * cellW, y + rowH, content, 2.6, 'bold' ) ) );

	const rowY = y + 2 * rowH;
	const lastH = TITLE_HEIGHT - 2 * rowH;
	out.push( rect( x, rowY, half, lastH ), label( x, rowY, 'OBSERVAÇÕES' ) );
	out.push( text( x + 1.5, rowY + 7.5, ellipsis( plan.notes || `Cotas em ${unit}; áreas em m². Gerado a partir do modelo 3D — conferir no local.`, 78 ), 1.9, { role: 'title' } ) );
	out.push( rect( x + half, rowY, width - half, lastH ), label( x + half, rowY, 'RESPONSÁVEL' ), text( x + half + 1.5, rowY + 8, ellipsis( plan.author || '—', 30 ), 2.6, { role: 'title' } ) );
	out.push( text( x + width - 1.5, y - 1.5, 'Project3DS', 1.8, { anchor: 'end', fill: '#777777', role: 'title' } ) );

}

function ellipsis( value, max ) {

	const content = String( value );
	return content.length > max ? content.slice( 0, max - 1 ) + '…' : content;

}

export { STYLE, PlanTransform, buildDrawing, chooseScale, paperSize, drawingArea, formatLength, formatArea };
