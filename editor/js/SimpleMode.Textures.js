// EV-004 — Sistema Inteligente de Materiais, Texturas e Iluminação 3D
//
// Texturas procedurais geradas localmente em <canvas> 2D (sem downloads e sem WebGL extra).
// Cada padrão é reproduzível: mesma (id, semente) => mesmos pixels.
// Os padrões são claros/acinzentados: a cor do material tinge a textura (map × color).
//
// tile: tamanho físico (metros) de uma repetição da imagem, usado para manter a densidade real do padrão.

import * as THREE from 'three';

const SIZE = 256; // resolução leve, suficiente para revestimentos repetidos

const TEXTURES = [
	{ id: 'wood-grain', name: 'Veios de madeira', tile: [ 1.2, 0.6 ] },
	{ id: 'concrete', name: 'Concreto', tile: [ 1, 1 ] },
	{ id: 'brick', name: 'Tijolos', tile: [ 0.48, 0.32 ] },
	{ id: 'ceramic-tile', name: 'Revestimento cerâmico', tile: [ 0.6, 0.6 ] },
	{ id: 'fabric', name: 'Tecido', tile: [ 0.06, 0.06 ] },
	{ id: 'marble', name: 'Mármore', tile: [ 1.5, 1.5 ] }
];

const TEXTURE_MAP = new Map( TEXTURES.map( ( texture ) => [ texture.id, texture ] ) );

function getTextureDefinition( id ) {

	return TEXTURE_MAP.get( id ) || null;

}

const isKnownTexture = ( id ) => TEXTURE_MAP.has( id );

// gerador pseudoaleatório determinístico (mulberry32)
function random( seed ) {

	let state = seed >>> 0;

	return function () {

		state = ( state + 0x6D2B79F5 ) >>> 0;
		let t = state;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// ruído de valor periódico (repete a cada `period` células): a imagem não mostra emendas ao repetir
function createNoise( rand, period ) {

	const values = new Float32Array( period * period ).map( () => rand() );
	const smooth = ( t ) => t * t * ( 3 - 2 * t );

	return function ( x, y ) {

		const xi = Math.floor( x ), yi = Math.floor( y );
		const xf = smooth( x - xi ), yf = smooth( y - yi );
		const at = ( i, j ) => values[ ( ( j % period + period ) % period ) * period + ( ( i % period + period ) % period ) ];

		const a = at( xi, yi ), b = at( xi + 1, yi ), c = at( xi, yi + 1 ), d = at( xi + 1, yi + 1 );
		return a + ( b - a ) * xf + ( c - a ) * yf + ( a - b - c + d ) * xf * yf;

	};

}

// soma de oitavas; as frequências são potências de 2, então a repetição periódica do ruído é preservada
function fbm( noise, x, y, octaves ) {

	let value = 0, amplitude = 0.5, frequency = 1, total = 0;

	for ( let i = 0; i < octaves; i ++ ) {

		value += noise( x * frequency, y * frequency ) * amplitude;
		total += amplitude;
		amplitude *= 0.5;
		frequency *= 2;

	}

	return value / total;

}

function fillPixels( context, shade ) {

	const image = context.createImageData( SIZE, SIZE );

	for ( let y = 0; y < SIZE; y ++ ) {

		for ( let x = 0; x < SIZE; x ++ ) {

			const [ r, g, b ] = shade( x, y );
			const i = ( y * SIZE + x ) * 4;
			image.data[ i ] = r;
			image.data[ i + 1 ] = g;
			image.data[ i + 2 ] = b;
			image.data[ i + 3 ] = 255;

		}

	}

	context.putImageData( image, 0, 0 );

}

const gray = ( value ) => {

	const v = Math.max( 0, Math.min( 255, Math.round( value * 255 ) ) );
	return [ v, v, v ];

};

const GENERATORS = {

	'wood-grain': ( context, rand ) => {

		const noise = createNoise( rand, 8 );
		fillPixels( context, ( x, y ) => {

			const u = x / SIZE * 8, v = y / SIZE * 8;
			const warp = fbm( noise, u * 0.5, v * 2, 3 ) * 6;
			const rings = Math.sin( ( v * 2.2 + warp ) * Math.PI );
			const fiber = noise( u * 4, v * 16 ) * 0.08;
			return gray( 0.82 + rings * 0.08 - fiber );

		} );

	},

	concrete: ( context, rand ) => {

		const noise = createNoise( rand, 16 );
		fillPixels( context, ( x, y ) => {

			const u = x / SIZE * 16, v = y / SIZE * 16;
			const base = fbm( noise, u, v, 4 );
			const speck = rand() < 0.012 ? - 0.18 : 0;
			return gray( 0.78 + base * 0.2 + speck );

		} );

	},

	brick: ( context, rand ) => {

		// 4 fiadas de 2 tijolos (24 × 8 cm), com juntas de argamassa mais claras
		const rows = 4, cols = 2, mortar = 6;
		const shades = Array.from( { length: rows * ( cols + 1 ) }, () => 0.62 + rand() * 0.18 );
		const noise = createNoise( rand, 32 );

		fillPixels( context, ( x, y ) => {

			const rowHeight = SIZE / rows, colWidth = SIZE / cols;
			const row = Math.floor( y / rowHeight );
			const offset = row % 2 === 0 ? 0 : colWidth / 2;
			const xx = ( x + offset ) % SIZE;
			const col = Math.floor( xx / colWidth );
			const inMortar = y % rowHeight < mortar || xx % colWidth < mortar;
			const grain = noise( x / 8, y / 8 ) * 0.08;

			return gray( inMortar ? 0.95 - grain * 0.5 : shades[ row * ( cols + 1 ) + col ] + grain );

		} );

	},

	'ceramic-tile': ( context, rand ) => {

		// 2 × 2 placas com rejunte
		const grout = 5;
		const shades = [ 0, 1, 2, 3 ].map( () => 0.93 + rand() * 0.05 );
		const noise = createNoise( rand, 16 );

		fillPixels( context, ( x, y ) => {

			const half = SIZE / 2;
			const inGrout = x % half < grout || y % half < grout;
			const tile = ( y < half ? 0 : 2 ) + ( x < half ? 0 : 1 );
			return gray( inGrout ? 0.7 : shades[ tile ] + noise( x / 16, y / 16 ) * 0.03 );

		} );

	},

	fabric: ( context, rand ) => {

		// trama simples: fios horizontais e verticais alternados
		const noise = createNoise( rand, 32 );
		fillPixels( context, ( x, y ) => {

			const cell = 16;
			const cx = Math.floor( x / cell ), cy = Math.floor( y / cell );
			const horizontal = ( cx + cy ) % 2 === 0;
			const t = horizontal ? ( y % cell ) / cell : ( x % cell ) / cell;
			const thread = Math.sin( t * Math.PI );
			return gray( 0.7 + thread * 0.22 + noise( x / 4, y / 4 ) * 0.06 );

		} );

	},

	marble: ( context, rand ) => {

		const noise = createNoise( rand, 8 );
		fillPixels( context, ( x, y ) => {

			const u = x / SIZE * 8, v = y / SIZE * 8;
			const turbulence = fbm( noise, u, v, 5 ) * 5;
			const vein = Math.abs( Math.sin( ( u + v ) * Math.PI / 4 + turbulence ) );
			return gray( 0.86 + Math.pow( vein, 0.25 ) * 0.14 - ( 1 - vein ) * 0.04 );

		} );

	}

};

// cache: uma textura-base (com a imagem) por (id, semente); cada material recebe um clone que
// compartilha a mesma imagem/Source na GPU, mas tem repetição própria (sem afetar outras instâncias)
const baseTextures = new Map();

function getBaseTexture( id, seed ) {

	const key = id + ':' + seed;

	if ( baseTextures.has( key ) === false ) {

		const canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = SIZE;
		GENERATORS[ id ]( canvas.getContext( '2d' ), random( seed ) );

		const texture = new THREE.CanvasTexture( canvas );
		texture.name = getTextureDefinition( id ).name;
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
		texture.anisotropy = 4;

		baseTextures.set( key, texture );

	}

	return baseTextures.get( key );

}

function createProceduralTexture( id, seed ) {

	if ( isKnownTexture( id ) === false ) return null;

	const texture = getBaseTexture( id, seed ).clone();
	texture.needsUpdate = true;

	return texture;

}

// miniatura para a interface (data URL de um canvas pequeno, gerada uma vez)
const thumbnails = new Map();

function getTextureThumbnail( id, seed ) {

	const key = id + ':' + seed;

	if ( thumbnails.has( key ) === false ) {

		const source = getBaseTexture( id, seed ).image;
		const canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = 48;
		canvas.getContext( '2d' ).drawImage( source, 0, 0, 128, 128, 0, 0, 48, 48 );
		thumbnails.set( key, canvas.toDataURL() );

	}

	return thumbnails.get( key );

}

export { TEXTURES, getTextureDefinition, isKnownTexture, createProceduralTexture, getTextureThumbnail };
