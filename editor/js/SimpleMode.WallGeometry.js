// EV-007 — Ferramentas Arquitetônicas Inteligentes
//
// Gerador determinístico de paredes retas com vãos retangulares (sem CSG externa).
//
// Estratégia: DECOMPOSIÇÃO RETANGULAR com eliminação de faces internas.
//   1. As bordas da parede e de todos os vãos definem uma grade (coordenadas X e Y) na face da parede.
//   2. Cada célula da grade é "cheia" ou "vazia" (dentro de um vão).
//   3. Para cada célula cheia emitimos a face frontal e a traseira; uma face lateral (topo, base,
//      extremidades, ombreiras, verga, peitoril) só é emitida quando a célula vizinha está vazia ou
//      fora da parede — não existem faces internas entre células.
//   Como a grade é global, células vizinhas compartilham exatamente os mesmos vértices nas arestas:
//   não há frestas, T-junctions nem faces coplanares sobrepostas (sem z-fighting).
//   Um vão de porta que toca a base não gera triangulação degenerada: apenas as células desse vão
//   ficam vazias e a base não recebe face ali.
//
// Espaço local: X ao longo da parede (centro em 0), Y vertical, Z na espessura (centro em 0).
// A geometria é centrada em Y (de −altura/2 a +altura/2), como a BoxGeometry original da EV-003.
//
// UVs: normalizadas pelas medidas totais da parede (u = x/largura, v = y/altura), iguais às da BoxGeometry.
// Assim a repetição física das texturas da EV-004 (repetição = medida / tamanho do padrão) continua
// coerente; faces laterais usam a mesma densidade (espessura também dividida por largura/altura).

import * as THREE from 'three';

const EPS = 1e-9;

function uniqueSorted( values ) {

	const sorted = values.slice().sort( ( a, b ) => a - b );
	const result = [];

	for ( const value of sorted ) {

		if ( result.length === 0 || Math.abs( value - result[ result.length - 1 ] ) > EPS ) result.push( value );

	}

	return result;

}

// openings: [{ centerX, bottomY, width, height }] em metros, no espaço local da parede (base em y = 0)
function buildWallGeometry( width, height, thickness, openings ) {

	const halfW = width / 2, halfT = thickness / 2, halfH = height / 2;

	// retângulos dos vãos, limitados à parede
	const rects = openings.map( ( o ) => ( {
		x0: Math.max( - halfW, o.centerX - o.width / 2 ),
		x1: Math.min( halfW, o.centerX + o.width / 2 ),
		y0: Math.max( 0, o.bottomY ),
		y1: Math.min( height, o.bottomY + o.height )
	} ) ).filter( ( r ) => r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS );

	const xs = uniqueSorted( [ - halfW, halfW, ...rects.flatMap( ( r ) => [ r.x0, r.x1 ] ) ] );
	const ys = uniqueSorted( [ 0, height, ...rects.flatMap( ( r ) => [ r.y0, r.y1 ] ) ] );

	const columns = xs.length - 1, rows = ys.length - 1;
	const solid = [];

	for ( let i = 0; i < columns; i ++ ) {

		solid[ i ] = [];

		for ( let j = 0; j < rows; j ++ ) {

			const cx = ( xs[ i ] + xs[ i + 1 ] ) / 2, cy = ( ys[ j ] + ys[ j + 1 ] ) / 2;
			solid[ i ][ j ] = rects.every( ( r ) => ! ( cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1 ) );

		}

	}

	const isSolid = ( i, j ) => i >= 0 && i < columns && j >= 0 && j < rows && solid[ i ][ j ];

	const positions = [], normals = [], uvs = [];

	// quadrilátero (a, b, c, d) em ordem anti-horária vista pelo lado da normal
	function quad( a, b, c, d, normal, uvOf ) {

		for ( const p of [ a, b, c, a, c, d ] ) {

			positions.push( p[ 0 ], p[ 1 ] - halfH, p[ 2 ] );
			normals.push( normal[ 0 ], normal[ 1 ], normal[ 2 ] );
			const uv = uvOf( p );
			uvs.push( uv[ 0 ], uv[ 1 ] );

		}

	}

	const uFront = ( p ) => [ ( p[ 0 ] + halfW ) / width, p[ 1 ] / height ];
	const uBack = ( p ) => [ ( halfW - p[ 0 ] ) / width, p[ 1 ] / height ];
	const uSide = ( p ) => [ ( p[ 2 ] + halfT ) / width, p[ 1 ] / height ];
	const uFlat = ( p ) => [ ( p[ 0 ] + halfW ) / width, ( p[ 2 ] + halfT ) / height ];

	for ( let i = 0; i < columns; i ++ ) {

		for ( let j = 0; j < rows; j ++ ) {

			if ( solid[ i ][ j ] === false ) continue;

			const x0 = xs[ i ], x1 = xs[ i + 1 ], y0 = ys[ j ], y1 = ys[ j + 1 ];

			// frente (+Z) e verso (−Z)
			quad( [ x0, y0, halfT ], [ x1, y0, halfT ], [ x1, y1, halfT ], [ x0, y1, halfT ], [ 0, 0, 1 ], uFront );
			quad( [ x1, y0, - halfT ], [ x0, y0, - halfT ], [ x0, y1, - halfT ], [ x1, y1, - halfT ], [ 0, 0, - 1 ], uBack );

			// laterais: só onde a vizinha está vazia ou fora da parede
			if ( isSolid( i - 1, j ) === false ) quad( [ x0, y0, - halfT ], [ x0, y0, halfT ], [ x0, y1, halfT ], [ x0, y1, - halfT ], [ - 1, 0, 0 ], uSide );
			if ( isSolid( i + 1, j ) === false ) quad( [ x1, y0, halfT ], [ x1, y0, - halfT ], [ x1, y1, - halfT ], [ x1, y1, halfT ], [ 1, 0, 0 ], uSide );
			if ( isSolid( i, j - 1 ) === false ) quad( [ x0, y0, - halfT ], [ x1, y0, - halfT ], [ x1, y0, halfT ], [ x0, y0, halfT ], [ 0, - 1, 0 ], uFlat );
			if ( isSolid( i, j + 1 ) === false ) quad( [ x0, y1, halfT ], [ x1, y1, halfT ], [ x1, y1, - halfT ], [ x0, y1, - halfT ], [ 0, 1, 0 ], uFlat );

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	geometry.name = 'Parede com aberturas';

	return geometry;

}

export { buildWallGeometry };
