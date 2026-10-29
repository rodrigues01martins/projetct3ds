// EV-006 — Ferramentas de Construção e Montagem 3D
//
// Encaixes e superfícies (sem interface):
//   - extremidades reais das paredes paramétricas (pelos parâmetros + matriz mundial, nunca pela caixa alinhada ao mundo);
//   - encaixe na grade (precisão de movimento da EV-002);
//   - modo ortogonal (eixo X ou Z a partir do ponto inicial);
//   - plano de construção (topo de pisos conhecidos ou y = 0);
//   - superfícies horizontais de apoio para posicionar/apoiar objetos.

import * as THREE from 'three';

import { getComponentData, findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { isOwnedLighting } from './SimpleMode.Lighting.js';

const ENDPOINT_TOLERANCE_PX = 12;
const HORIZONTAL = 0.95; // cosseno mínimo entre a normal e +Y para considerar a face horizontal (~18°)

const _normalMatrix = new THREE.Matrix3();
const _plane = new THREE.Plane();

// extremidades -------------------------------------------------------------------------------------------

// Pontos de início e fim da linha de base de cada parede (centro da espessura, y da base), no espaço mundial
function getWallEndpoints( scene ) {

	const points = [];

	scene.traverseVisible( function ( object ) {

		const data = getComponentData( object );
		if ( data === null || data.id !== 'wall' || isOwnedLighting( object, scene ) ) return;

		const width = data.parameters !== null && typeof data.parameters === 'object' ? data.parameters.width : NaN;
		if ( Number.isFinite( width ) === false ) return;

		object.updateWorldMatrix( true, false );

		for ( const sign of [ - 1, 1 ] ) {

			points.push( { point: new THREE.Vector3( sign * width / 2, 0, 0 ).applyMatrix4( object.matrixWorld ), wall: object } );

		}

	} );

	return points;

}

// Encaixa um ponto do plano de construção (y = planeY).
//   options: { anchor: Vector3 | null, ortho: boolean, grid: number | null, toScreen, cursor: Vector2, exclude: Set }
// Regra explícita para o conflito ortogonal × extremidade: com o modo ortogonal ativo, a extremidade próxima é
// PROJETADA sobre o eixo escolhido (a parede termina alinhada a ela), nunca puxando o ponto para fora do eixo.
function snapPoint( raw, planeY, options ) {

	const result = { point: raw.clone(), kind: 'free', axis: null, endpoint: null };
	result.point.y = planeY;

	// 1) modo ortogonal: eixo dominante a partir do ponto inicial
	let axis = null;

	if ( options.ortho && options.anchor !== null ) {

		const dx = Math.abs( raw.x - options.anchor.x );
		const dz = Math.abs( raw.z - options.anchor.z );
		axis = dx >= dz ? 'x' : 'z';
		result.axis = axis;

	}

	// 2) extremidade de parede dentro da tolerância em pixels (comportamento igual em qualquer zoom)
	let best = null;
	let bestDistance = ENDPOINT_TOLERANCE_PX;

	for ( const candidate of getWallEndpoints( options.scene ) ) {

		if ( options.exclude !== undefined && options.exclude.has( candidate.wall ) ) continue;

		const distance = options.toScreen( candidate.point ).distanceTo( options.cursor );

		if ( distance <= bestDistance ) {

			best = candidate;
			bestDistance = distance;

		}

	}

	if ( best !== null ) {

		result.endpoint = best.point.clone();
		result.point.x = best.point.x;
		result.point.z = best.point.z;
		result.kind = 'endpoint';

	} else if ( options.grid !== null ) {

		result.point.x = Math.round( result.point.x / options.grid ) * options.grid;
		result.point.z = Math.round( result.point.z / options.grid ) * options.grid;
		result.kind = 'grid';

	}

	// 3) aplica o eixo ortogonal por último (a extremidade, se houver, fica projetada sobre o eixo)
	if ( axis === 'x' ) result.point.z = options.anchor.z;
	if ( axis === 'z' ) result.point.x = options.anchor.x;

	if ( axis !== null && result.kind === 'endpoint' ) result.kind = 'endpoint-axis';

	return result;

}

// superfícies --------------------------------------------------------------------------------------------

function worldNormal( hit ) {

	if ( hit.face === null || hit.face === undefined ) return null;

	_normalMatrix.getNormalMatrix( hit.object.matrixWorld );
	return hit.face.normal.clone().applyMatrix3( _normalMatrix ).normalize();

}

function collectMeshes( scene, exclude ) {

	const meshes = [];

	scene.traverseVisible( function ( object ) {

		if ( object.isMesh !== true || isOwnedLighting( object, scene ) ) return;
		if ( exclude !== undefined && exclude.has( object ) ) return;

		meshes.push( object );

	} );

	return meshes;

}

// Plano de construção para paredes e pisos: topo de um componente "floor" sob o cursor; senão, y = 0.
// Outras superfícies (mesas, topo de paredes...) são ignoradas de propósito.
function getConstructionPlane( info, scene ) {

	const floors = collectMeshes( scene ).filter( ( mesh ) => {

		const root = findComponentRoot( mesh, scene );
		const data = root !== null ? getComponentData( root ) : null;
		return data !== null && data.id === 'floor';

	} );

	info.raycaster.ray.copy( info.ray );

	for ( const hit of info.raycaster.intersectObjects( floors, false ) ) {

		const normal = worldNormal( hit );

		if ( normal !== null && normal.y >= HORIZONTAL ) {

			// altura exata do topo pelos parâmetros do piso (os vértices são float32; o raio daria 0,10000000149)
			const floor = findComponentRoot( hit.object, scene );
			const thickness = getComponentData( floor ).parameters.thickness;
			const top = new THREE.Vector3( 0, thickness, 0 ).applyMatrix4( floor.matrixWorld ).y;
			const y = Number.isFinite( top ) && Math.abs( top - hit.point.y ) < 1e-3 ? top : hit.point.y;

			return { y, point: hit.point.clone().setY( y ), source: 'floor', floor };

		}

	}

	_plane.set( new THREE.Vector3( 0, 1, 0 ), 0 );
	const point = info.ray.intersectPlane( _plane, new THREE.Vector3() );

	return point !== null ? { y: 0, point, source: 'ground', floor: null } : null;

}

// Ponto do raio sobre um plano horizontal de altura y (segundo ponto do desenho usa o plano do primeiro)
function intersectHorizontal( info, y ) {

	_plane.set( new THREE.Vector3( 0, 1, 0 ), - y );
	return info.ray.intersectPlane( _plane, new THREE.Vector3() );

}

// Superfície de apoio sob o cursor (posicionar/apoiar objetos).
// Retorna { valid, y, point, object } — a primeira face atingida precisa estar voltada para cima;
// sem nenhum objeto, o chão (y = 0) é usado.
function getSupportSurface( info, scene, exclude ) {

	info.raycaster.ray.copy( info.ray );
	const hit = info.raycaster.intersectObjects( collectMeshes( scene, exclude ), false )[ 0 ];

	if ( hit !== undefined ) {

		const normal = worldNormal( hit );
		const valid = normal !== null && normal.y >= HORIZONTAL;
		return { valid, y: hit.point.y, point: hit.point.clone(), object: findComponentRoot( hit.object, scene ) || hit.object, reason: valid ? null : 'vertical' };

	}

	_plane.set( new THREE.Vector3( 0, 1, 0 ), 0 );
	const point = info.ray.intersectPlane( _plane, new THREE.Vector3() );

	if ( point === null ) return { valid: false, reason: 'none' };

	return { valid: true, y: 0, point, object: null, reason: null };

}

// objeto e todos os descendentes (excluídos do raycasting para não se apoiarem em si mesmos)
function descendantsOf( object ) {

	const set = new Set();
	object.traverse( ( child ) => set.add( child ) );
	return set;

}

export { ENDPOINT_TOLERANCE_PX, getWallEndpoints, snapPoint, getConstructionPlane, intersectHorizontal, getSupportSurface, descendantsOf };
