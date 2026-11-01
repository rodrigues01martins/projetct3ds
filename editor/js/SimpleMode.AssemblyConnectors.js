// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Pontos de encaixe (conectores): dados auxiliares em coordenadas LOCAIS do objeto
//   { id, name, kind: 'center'|'face'|'edge'|'point', position, normal, up, family, role }
//
// Origem dos conectores, em ordem de prioridade:
//   1. explícitos — cadastrados pelo usuário (userData.project3ds.connectors) ou pelos conjuntos prontos;
//   2. derivados — calculados a partir da caixa local do objeto (centro, faces esquerda/direita/frontal/traseira/
//      superior/inferior e extremidades inicial/final na base). Para componentes paramétricos nativos a caixa É a
//      forma do componente; para modelos importados e conjuntos ela é só uma APROXIMAÇÃO (marcada como tal) — não
//      significa que o objeto tenha pontos físicos de fixação.
//
// Encaixe = alinhamento geométrico: o conector móvel vai para a posição do conector de destino, com normais
// OPOSTAS (faces que se encostam) e "up" alinhados. Sem soldagem, sem operações booleanas, sem física.

import * as THREE from 'three';

import { getComponentData, isImportedModelRoot } from './SimpleMode.ComponentFactory.js';
import { getConnectors, isAssembly, exactDecompose } from './SimpleMode.AssemblyData.js';

const FACE_LABELS = { center: 'Centro', right: 'Face direita', left: 'Face esquerda', front: 'Face frontal', back: 'Face traseira', top: 'Face superior', bottom: 'Face inferior', start: 'Extremidade inicial', end: 'Extremidade final' };

const _inverse = new THREE.Matrix4(), _m = new THREE.Matrix4(), _part = new THREE.Box3();

function localBox( object ) {

	object.updateWorldMatrix( true, true );
	_inverse.copy( object.matrixWorld ).invert();
	const box = new THREE.Box3();
	object.traverse( ( child ) => {

		if ( child.isMesh !== true || child.geometry === undefined ) return;
		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();
		_part.copy( child.geometry.boundingBox ).applyMatrix4( _m.multiplyMatrices( _inverse, child.matrixWorld ) );
		box.union( _part );

	} );
	return box;

}

// conectores derivados da caixa local (aproximados para modelos importados, conjuntos e objetos genéricos)
function derivedConnectors( object ) {

	const box = localBox( object );
	if ( box.isEmpty() ) return [];
	const c = box.getCenter( new THREE.Vector3() );
	const { min, max } = box;
	const exact = getComponentData( object ) !== null && isImportedModelRoot( object ) === false && isAssembly( object ) === false;
	const make = ( id, kind, position, normal, up = [ 0, 1, 0 ] ) => ( { id, name: FACE_LABELS[ id ], kind, position, normal, up, family: 'generic', role: 'neutral', origin: 'derived', approximate: exact === false } );
	return [
		make( 'center', 'center', [ c.x, c.y, c.z ], [ 0, 1, 0 ], [ 0, 0, 1 ] ),
		make( 'right', 'face', [ max.x, c.y, c.z ], [ 1, 0, 0 ] ),
		make( 'left', 'face', [ min.x, c.y, c.z ], [ - 1, 0, 0 ] ),
		make( 'front', 'face', [ c.x, c.y, max.z ], [ 0, 0, 1 ] ),
		make( 'back', 'face', [ c.x, c.y, min.z ], [ 0, 0, - 1 ] ),
		make( 'top', 'face', [ c.x, max.y, c.z ], [ 0, 1, 0 ], [ 0, 0, 1 ] ),
		make( 'bottom', 'face', [ c.x, min.y, c.z ], [ 0, - 1, 0 ], [ 0, 0, 1 ] ),
		make( 'start', 'edge', [ min.x, min.y, c.z ], [ - 1, 0, 0 ] ),
		make( 'end', 'edge', [ max.x, min.y, c.z ], [ 1, 0, 0 ] )
	];

}

function explicitConnectors( object ) {

	return getConnectors( object ).map( ( c ) => Object.assign( {}, c, { origin: 'explicit', approximate: false } ) );

}

// conectores disponíveis: explícitos primeiro; derivados como alternativa
function connectorsOf( object, { includeDerived = true } = {} ) {

	const explicit = explicitConnectors( object );
	return includeDerived ? explicit.concat( derivedConnectors( object ) ) : explicit;

}

// conector no espaço do mundo
function toWorld( object, connector ) {

	object.updateWorldMatrix( true, false );
	const position = new THREE.Vector3().fromArray( connector.position ).applyMatrix4( object.matrixWorld );
	const normalMatrix = new THREE.Matrix3().getNormalMatrix( object.matrixWorld );
	const normal = new THREE.Vector3().fromArray( connector.normal ).applyMatrix3( normalMatrix ).normalize();
	const up = new THREE.Vector3().fromArray( connector.up ).transformDirection( object.matrixWorld );
	up.sub( normal.clone().multiplyScalar( up.dot( normal ) ) );
	if ( up.lengthSq() < 1e-9 ) up.set( Math.abs( normal.y ) > 0.9 ? 0 : 0, Math.abs( normal.y ) > 0.9 ? 0 : 1, Math.abs( normal.y ) > 0.9 ? 1 : 0 );
	up.normalize();
	return { position, normal, up };

}

const isHorizontal = ( n ) => Math.abs( n.y ) < 0.2;
const isVertical = ( n ) => Math.abs( n.y ) > 0.8;

// regras de compatibilidade (no espaço do mundo, antes de qualquer giro)
function compatible( moving, target, movingWorld, targetWorld ) {

	if ( moving.origin === 'explicit' && target.origin === 'explicit' ) {

		if ( moving.family !== target.family && moving.family !== 'generic' && target.family !== 'generic' ) return false;
		if ( moving.role !== 'neutral' && moving.role === target.role ) return false; // macho com macho não encaixa
		return moving.kind === target.kind || moving.kind === 'point' || target.kind === 'point';

	}

	if ( moving.kind === 'center' || target.kind === 'center' ) return false;
	if ( moving.kind !== target.kind ) return false; // face com face, extremidade com extremidade
	if ( isVertical( targetWorld.normal ) ) return isVertical( movingWorld.normal ) && movingWorld.normal.dot( targetWorld.normal ) < - 0.8; // superior ↔ inferior
	return isHorizontal( targetWorld.normal ) && isHorizontal( movingWorld.normal ); // faces/extremidades verticais (giro em Y permitido)

}

// rotação que leva o conector móvel a ficar oposto ao de destino (normais opostas, "up" alinhados)
function alignmentRotation( movingWorld, targetWorld ) {

	const desiredNormal = targetWorld.normal.clone().negate();
	const q1 = new THREE.Quaternion().setFromUnitVectors( movingWorld.normal, desiredNormal );
	const up = movingWorld.up.clone().applyQuaternion( q1 );
	const targetUp = targetWorld.up.clone();
	// projeta os dois "up" no plano da face e gira em torno da normal para alinhá-los
	up.sub( desiredNormal.clone().multiplyScalar( up.dot( desiredNormal ) ) ).normalize();
	targetUp.sub( desiredNormal.clone().multiplyScalar( targetUp.dot( desiredNormal ) ) ).normalize();
	let angle = 0;
	if ( up.lengthSq() > 0.5 && targetUp.lengthSq() > 0.5 ) {

		angle = Math.atan2( new THREE.Vector3().crossVectors( up, targetUp ).dot( desiredNormal ), up.dot( targetUp ) );

	}

	const q2 = new THREE.Quaternion().setFromAxisAngle( desiredNormal, angle );
	return q2.multiply( q1 );

}

// transformação mundial resultante do encaixe (null quando incompatível ou não representável)
function snapTransform( movingObject, movingConnector, targetObject, targetConnector ) {

	const mw = toWorld( movingObject, movingConnector );
	const tw = toWorld( targetObject, targetConnector );
	if ( compatible( movingConnector, targetConnector, mw, tw ) === false ) return null;
	const rotation = alignmentRotation( mw, tw );
	movingObject.updateWorldMatrix( true, false );
	const matrix = new THREE.Matrix4()
		.makeTranslation( tw.position.x, tw.position.y, tw.position.z )
		.multiply( new THREE.Matrix4().makeRotationFromQuaternion( rotation ) )
		.multiply( new THREE.Matrix4().makeTranslation( - mw.position.x, - mw.position.y, - mw.position.z ) )
		.multiply( movingObject.matrixWorld );
	const world = exactDecompose( matrix );
	if ( world === null ) return null;
	const angle = 2 * Math.acos( Math.min( 1, Math.abs( rotation.w ) ) );
	return { matrix, world, rotation, angle, distance: mw.position.distanceTo( tw.position ), from: mw, to: tw };

}

// melhor par de conectores para um ponto apontado no destino
function bestSnap( movingObject, targetObject, hitPoint ) {

	const targetExplicit = explicitConnectors( targetObject );
	const targets = targetExplicit.length > 0 ? targetExplicit : derivedConnectors( targetObject );
	if ( targets.length === 0 ) return null;

	// conector de destino: o mais próximo do ponto apontado (excluindo o centro)
	const ranked = targets.filter( ( c ) => c.kind !== 'center' || c.origin === 'explicit' ).map( ( c ) => ( { c, d: toWorld( targetObject, c ).position.distanceTo( hitPoint ) } ) ).sort( ( a, b ) => a.d - b.d );

	const movingExplicit = explicitConnectors( movingObject );
	const movingDerived = derivedConnectors( movingObject );

	for ( const { c: target } of ranked.slice( 0, 3 ) ) {

		for ( const pool of [ movingExplicit, movingDerived ] ) {

			let best = null;
			for ( const moving of pool ) {

				const result = snapTransform( movingObject, moving, targetObject, target );
				if ( result === null ) continue;
				if ( best === null || result.angle < best.angle - 1e-6 ) best = Object.assign( result, { moving, target } );

			}

			if ( best !== null ) return best;

		}

	}

	return null;

}

// melhor conector do móvel para um conector de destino ESCOLHIDO (assistente de montagem)
function snapToConnector( movingObject, targetObject, targetConnector ) {

	const pools = [ explicitConnectors( movingObject ), derivedConnectors( movingObject ) ];
	for ( const pool of pools ) {

		let best = null;
		for ( const moving of pool ) {

			const result = snapTransform( movingObject, moving, targetObject, targetConnector );
			if ( result === null ) continue;
			if ( best === null || result.angle < best.angle - 1e-6 ) best = Object.assign( result, { moving, target: targetConnector } );

		}

		if ( best !== null ) return best;

	}

	return null;

}

export { snapToConnector, FACE_LABELS, localBox, derivedConnectors, explicitConnectors, connectorsOf, toWorld, compatible, alignmentRotation, snapTransform, bestSnap };
