// EV-009 — Sistema de Plantas Baixas, Cotas e Documentação Técnica
//
// Modelo da planta: lê a MESMA cena do 3D (nenhuma geometria paralela) e devolve dados 2D em metros, no plano X/Z
// do mundo (X = horizontal do desenho, Z = vertical do desenho, Y = altura física).
//
//   - nível de referência: um componente "floor" (face superior) ou Y = 0 quando não há piso;
//   - plano de corte: Y = topo do piso + altura de corte (padrão 1,20 m);
//   - paredes ("wall") e painéis ("panel"): seção REAL pela matriz mundial (paredes giradas mantêm o contorno),
//     interrompida pelas aberturas da EV-007 que o plano de corte atravessa;
//   - portas/janelas: registros wall.userData.project3ds.openings (tipo, posição, peitoril, largura, altura);
//   - ambientes: pisos do mesmo nível (área pelo contorno real);
//   - mobiliário e demais objetos entre o piso e o corte: projeção simplificada (envoltória convexa de cada peça).
// Interpretação paramétrica dos componentes conhecidos; nenhuma interseção genérica com todas as malhas.

import * as THREE from 'three';

import { getComponentData, findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { getOpenings } from './SimpleMode.Openings.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';

const DEFAULT_CUT_HEIGHT = 1.2;
const LEVEL_TOLERANCE = 0.02; // pisos com topo a ±2 cm pertencem ao mesmo nível
const MAX_PARTS_PER_OBJECT = 300;

const _v = new THREE.Vector3();
const _up = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _position = new THREE.Vector3();

// geometria 2D ----------------------------------------------------------------------------------------------

function toXZ( object, x, y, z ) {

	_v.set( x, y, z ).applyMatrix4( object.matrixWorld );
	return [ _v.x, _v.z ];

}

function polygonArea( points ) {

	let area = 0;
	for ( let i = 0; i < points.length; i ++ ) {

		const [ x1, z1 ] = points[ i ], [ x2, z2 ] = points[ ( i + 1 ) % points.length ];
		area += x1 * z2 - x2 * z1;

	}

	return Math.abs( area ) / 2;

}

function centroid( points ) {

	return [ points.reduce( ( s, p ) => s + p[ 0 ], 0 ) / points.length, points.reduce( ( s, p ) => s + p[ 1 ], 0 ) / points.length ];

}

// envoltória convexa (cadeia monotônica)
function convexHull( points ) {

	const pts = points.slice().sort( ( a, b ) => a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ] );
	if ( pts.length < 3 ) return pts;

	const cross = ( o, a, b ) => ( a[ 0 ] - o[ 0 ] ) * ( b[ 1 ] - o[ 1 ] ) - ( a[ 1 ] - o[ 1 ] ) * ( b[ 0 ] - o[ 0 ] );
	const lower = [], upper = [];

	for ( const p of pts ) {

		while ( lower.length >= 2 && cross( lower[ lower.length - 2 ], lower[ lower.length - 1 ], p ) <= 1e-12 ) lower.pop();
		lower.push( p );

	}

	for ( let i = pts.length - 1; i >= 0; i -- ) {

		const p = pts[ i ];
		while ( upper.length >= 2 && cross( upper[ upper.length - 2 ], upper[ upper.length - 1 ], p ) <= 1e-12 ) upper.pop();
		upper.push( p );

	}

	upper.pop(); lower.pop();
	return lower.concat( upper );

}

function isUpright( object ) {

	object.matrixWorld.decompose( _position, _quaternion, _scale );
	_up.set( 0, 1, 0 ).applyQuaternion( _quaternion );
	return _up.y > 0.9999;

}

function worldBaseY( object ) {

	return _v.set( 0, 0, 0 ).applyMatrix4( object.matrixWorld ).y;

}

function worldScaleY( object ) {

	object.matrixWorld.decompose( _position, _quaternion, _scale );
	return Math.abs( _scale.y );

}

// leitura da cena -------------------------------------------------------------------------------------------------

// percorre a cena separando paredes, painéis, pisos e demais objetos (sem luzes, câmeras e o grupo de iluminação)
function collect( scene ) {

	const walls = [], panels = [], floors = [], others = [];

	function visit( object, owner ) {

		if ( object.visible === false || isLightingGroup( object ) || object.isLight === true || object.isCamera === true ) return;

		const data = getComponentData( object );
		const id = data !== null ? data.id : null;

		if ( id === 'wall' ) return walls.push( object );
		if ( id === 'floor' ) return floors.push( object );
		if ( id === 'panel' ) return panels.push( object );
		// portas/janelas hospedadas são filhas das paredes (que retornam acima): viram símbolos, não mobiliário

		if ( object.isMesh === true ) others.push( { mesh: object, owner: owner || object } );

		for ( const child of object.children ) visit( child, owner || ( object !== scene ? object : null ) );

	}

	for ( const child of scene.children ) visit( child, null );

	return { walls, panels, floors, others };

}

// pisos compatíveis (verticais, sem inclinação), com topo e contorno real
function describeFloors( floors ) {

	return floors.filter( isUpright ).map( ( floor ) => {

		const p = getComponentData( floor ).parameters;
		const top = worldBaseY( floor ) + p.thickness * worldScaleY( floor );
		const outline = [[ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ]].map( ( [ sx, sz ] ) => toXZ( floor, sx * p.width / 2, p.thickness, sz * p.depth / 2 ) );

		return { uuid: floor.uuid, name: floor.name || 'Piso', top, outline, area: polygonArea( outline ) };

	} ).sort( ( a, b ) => a.top - b.top || b.area - a.area );

}

// níveis disponíveis para o seletor: cada piso compatível (o usuário escolhe um por vez)
function getLevels( scene ) {

	scene.updateMatrixWorld( true );
	return describeFloors( collect( scene ).floors );

}

// Referência: piso escolhido (uuid salvo) → piso mais baixo → Y = 0 (sem piso)
function resolveLevel( floors, floorUuid ) {

	const chosen = floors.find( ( floor ) => floor.uuid === floorUuid );
	if ( chosen !== undefined ) return { floor: chosen, referenceY: chosen.top, source: 'floor' };
	if ( floors.length > 0 ) return { floor: floors[ 0 ], referenceY: floors[ 0 ].top, source: floorUuid ? 'fallback' : 'auto' };
	return { floor: null, referenceY: 0, source: 'none' };

}

// seção de uma parede/painel no plano de corte: retângulos (trechos sólidos) e aberturas atravessadas
function describeWall( object, kind, cutY ) {

	const p = getComponentData( object ).parameters;
	const base = worldBaseY( object );
	const height = p.height * worldScaleY( object );
	const top = base + height;
	const width = p.width, thickness = p.thickness;
	const localCut = ( cutY - base ) / worldScaleY( object ); // altura do corte no espaço local da parede

	const state = cutY < base - 1e-9 ? 'above' : ( cutY > top + 1e-9 ? 'below' : 'cut' );
	const openings = kind === 'wall' ? getOpenings( object ) : [];

	// trechos sólidos ao longo do eixo local X (aberturas cortadas interrompem a parede)
	const gaps = state === 'cut' ? openings
		.filter( ( o ) => localCut >= o.bottomY - 1e-9 && localCut <= o.bottomY + o.height + 1e-9 )
		.map( ( o ) => [ Math.max( - width / 2, o.centerX - o.width / 2 ), Math.min( width / 2, o.centerX + o.width / 2 ) ] )
		.sort( ( a, b ) => a[ 0 ] - b[ 0 ] ) : [];

	const segments = [];
	let start = - width / 2;

	for ( const [ g0, g1 ] of gaps ) {

		if ( g0 > start + 1e-9 ) segments.push( [ start, g0 ] );
		start = Math.max( start, g1 );

	}

	if ( width / 2 > start + 1e-9 ) segments.push( [ start, width / 2 ] );

	const quad = ( x0, x1 ) => [ toXZ( object, x0, 0, - thickness / 2 ), toXZ( object, x1, 0, - thickness / 2 ), toXZ( object, x1, 0, thickness / 2 ), toXZ( object, x0, 0, thickness / 2 ) ];

	return {
		uuid: object.uuid,
		name: object.name,
		kind,
		state,
		base,
		height,
		width,
		thickness,
		outline: quad( - width / 2, width / 2 ),
		sections: segments.map( ( [ x0, x1 ] ) => quad( x0, x1 ) ),
		// eixo e normal no plano (para cotas e símbolos)
		start: toXZ( object, - width / 2, 0, 0 ),
		end: toXZ( object, width / 2, 0, 0 ),
		openings: openings.map( ( o ) => {

			const cut = state === 'cut' && localCut >= o.bottomY - 1e-9 && localCut <= o.bottomY + o.height + 1e-9;
			const x0 = o.centerX - o.width / 2, x1 = o.centerX + o.width / 2;
			const fixture = object.children.find( ( c ) => c.uuid === o.fixtureUuid );
			const fixtureData = fixture !== undefined ? getComponentData( fixture ) : null;

			return {
				id: o.id,
				type: o.type,
				uuid: fixture !== undefined ? fixture.uuid : object.uuid,
				cut,
				above: localCut < o.bottomY,
				width: o.width,
				height: o.height,
				bottomY: o.bottomY,
				// pontos no plano: extremidades no eixo e nas faces
				a: toXZ( object, x0, 0, 0 ),
				b: toXZ( object, x1, 0, 0 ),
				aFront: toXZ( object, x0, 0, thickness / 2 ),
				bFront: toXZ( object, x1, 0, thickness / 2 ),
				aBack: toXZ( object, x0, 0, - thickness / 2 ),
				bBack: toXZ( object, x1, 0, - thickness / 2 ),
				frontDir: ( () => {

					const a = toXZ( object, 0, 0, 0 ), b = toXZ( object, 0, 0, 1 );
					const len = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) || 1;
					return [ ( b[ 0 ] - a[ 0 ] ) / len, ( b[ 1 ] - a[ 1 ] ) / len ];

				} )(),
				frameWidth: fixtureData !== null && fixtureData.parameters.frameWidth !== undefined ? fixtureData.parameters.frameWidth : 0.05
			};

		} )
	};

}

// projeção simplificada de uma peça: envoltória dos 8 cantos da caixa local transformados
function partHull( mesh ) {

	const geometry = mesh.geometry;
	if ( geometry === undefined || geometry.attributes === undefined || geometry.attributes.position === undefined ) return null;
	if ( geometry.boundingBox === null ) geometry.computeBoundingBox();

	const box = geometry.boundingBox;
	const points = [];
	let minY = Infinity, maxY = - Infinity;

	for ( let i = 0; i < 8; i ++ ) {

		_v.set( i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z ).applyMatrix4( mesh.matrixWorld );
		points.push( [ _v.x, _v.z ] );
		minY = Math.min( minY, _v.y ); maxY = Math.max( maxY, _v.y );

	}

	return { hull: convexHull( points ), minY, maxY };

}

function describeOthers( others, referenceY, cutY, scene ) {

	const byOwner = new Map();

	for ( const { mesh, owner } of others ) {

		const root = findComponentRoot( mesh, scene ) || owner;
		if ( byOwner.has( root ) === false ) byOwner.set( root, [] );
		byOwner.get( root ).push( mesh );

	}

	const items = [];

	for ( const [ root, meshes ] of byOwner ) {

		const parts = [];
		const list = meshes.length > MAX_PARTS_PER_OBJECT ? [ root ] : meshes;

		for ( const mesh of list ) {

			let part;

			if ( mesh === root && meshes.length > MAX_PARTS_PER_OBJECT ) {

				const box = new THREE.Box3().setFromObject( root, false );
				part = { hull: [[ box.min.x, box.min.z ], [ box.max.x, box.min.z ], [ box.max.x, box.max.z ], [ box.min.x, box.max.z ]], minY: box.min.y, maxY: box.max.y };

			} else {

				part = partHull( mesh );

			}

			// só o que está entre o piso de referência e o plano de corte (outros níveis e luminárias altas ficam de fora)
			if ( part === null || part.hull.length < 3 || part.maxY <= referenceY + 1e-3 || part.minY >= cutY ) continue;
			parts.push( part.hull );

		}

		if ( parts.length === 0 ) continue;

		const data = getComponentData( root );
		items.push( { uuid: root.uuid, name: root.name, component: data !== null ? data.id : null, parts } );

	}

	return items;

}

// Modelo completo da planta (metros, plano X/Z do mundo)
function buildPlanModel( scene, { floorUuid = null, cutHeight = DEFAULT_CUT_HEIGHT, rooms = {} } = {} ) {

	scene.updateMatrixWorld( true );

	const found = collect( scene );
	const floors = describeFloors( found.floors );
	const level = resolveLevel( floors, floorUuid );
	const cutY = level.referenceY + cutHeight;

	const describe = ( list, kind ) => list.filter( isUpright ).map( ( object ) => describeWall( object, kind, cutY ) );
	const walls = describe( found.walls, 'wall' ).concat( describe( found.panels, 'panel' ) )
		.filter( ( wall ) => wall.state !== 'above' && wall.base + wall.height > level.referenceY + 1e-3 && wall.base < cutY ); // do nível escolhido

	const levelFloors = level.floor !== null ? floors.filter( ( floor ) => Math.abs( floor.top - level.referenceY ) <= LEVEL_TOLERANCE ) : [];
	const roomList = levelFloors.map( ( floor ) => ( {
		uuid: floor.uuid,
		name: rooms[ floor.uuid ] !== undefined && rooms[ floor.uuid ] !== '' ? rooms[ floor.uuid ] : floor.name,
		area: floor.area,
		outline: floor.outline,
		center: centroid( floor.outline )
	} ) );

	const furniture = describeOthers( found.others, level.referenceY, cutY, scene );

	// limites do desenho (metros)
	const bounds = new THREE.Box2();
	const add = ( p ) => bounds.expandByPoint( new THREE.Vector2( p[ 0 ], p[ 1 ] ) );
	walls.forEach( ( w ) => w.outline.forEach( add ) );
	roomList.forEach( ( r ) => r.outline.forEach( add ) );
	furniture.forEach( ( f ) => f.parts.forEach( ( hull ) => hull.forEach( add ) ) );

	return {
		level: { source: level.source, floorUuid: level.floor !== null ? level.floor.uuid : null, floorName: level.floor !== null ? level.floor.name : null, referenceY: level.referenceY },
		cutHeight,
		cutY,
		levels: floors,
		walls,
		rooms: roomList,
		furniture,
		bounds: bounds.isEmpty() ? null : { minX: bounds.min.x, minZ: bounds.min.y, maxX: bounds.max.x, maxZ: bounds.max.y },
		incompatible: found.walls.concat( found.panels, found.floors ).filter( ( o ) => isUpright( o ) === false ).length
	};

}

// pontos de encaixe para cotas (cantos das seções, bordas das aberturas e cantos dos ambientes)
function snapPoints( model ) {

	const points = [];
	for ( const wall of model.walls ) {

		for ( const section of ( wall.state === 'cut' ? wall.sections : [ wall.outline ] ) ) points.push( ...section );
		points.push( wall.start, wall.end );

	}

	for ( const room of model.rooms ) points.push( ...room.outline );
	return points;

}

export { DEFAULT_CUT_HEIGHT, LEVEL_TOLERANCE, buildPlanModel, getLevels, snapPoints, polygonArea, convexHull };
