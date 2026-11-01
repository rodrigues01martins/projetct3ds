// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Unidades, escala, orientação e base — sem alterar a geometria de origem.
//
// Convenção: 1 unidade Three.js = 1 metro; o glTF também usa metros. A unidade do projeto (EV-002) muda só a
// APRESENTAÇÃO: nenhuma conversão automática é feita. Um modelo exportado com escala errada é corrigido por escala
// explícita escolhida pelo usuário.
//
// Estrutura de uma instância (a hierarquia original do arquivo fica intacta):
//   raiz (Group, selecionável; escala do usuário; posição/rotação na cena; userData.project3ds.importedAsset)
//     └─ "Ajuste de importação" (Group: rotação de orientação + deslocamento da base)
//          └─ conteúdo do arquivo (hierarquia, transformações internas e materiais preservados)
// As correções ficam registradas em importedAsset.transforms e no grupo de ajuste; a raiz começa sem rotação,
// então reinserir um modelo salvo não aplica a orientação duas vezes.

import * as THREE from 'three';

const ROTATIONS_Y = [ 0, 90, 180, 270 ];
const UPRIGHT = {
	none: { label: 'Original', euler: [ 0, 0, 0 ] },
	'x-90': { label: 'Deitado para trás (Z para cima → Y para cima)', euler: [ - 90, 0, 0 ] },
	'x+90': { label: 'Deitado para a frente', euler: [ 90, 0, 0 ] },
	'z-90': { label: 'Deitado de lado (direita)', euler: [ 0, 0, - 90 ] },
	'z+90': { label: 'Deitado de lado (esquerda)', euler: [ 0, 0, 90 ] },
	'x180': { label: 'De cabeça para baixo', euler: [ 180, 0, 0 ] }
};

const SCALE_LIMITS = { min: 1e-4, max: 1e4 };
const DIMENSION_LIMITS = { min: 0.001, max: 1000 };

function defaultSettings() {

	return { rotationY: 0, upright: 'none', base: true, scale: [ 1, 1, 1 ], uniform: true };

}

function sanitizeSettings( value ) {

	const settings = defaultSettings();
	if ( value === null || typeof value !== 'object' ) return settings;
	if ( ROTATIONS_Y.includes( value.rotationY ) ) settings.rotationY = value.rotationY;
	if ( UPRIGHT[ value.upright ] !== undefined ) settings.upright = value.upright;
	if ( typeof value.base === 'boolean' ) settings.base = value.base;
	if ( typeof value.uniform === 'boolean' ) settings.uniform = value.uniform;
	if ( Array.isArray( value.scale ) && value.scale.length === 3 && value.scale.every( ( s ) => Number.isFinite( s ) && s >= SCALE_LIMITS.min && s <= SCALE_LIMITS.max ) ) settings.scale = value.scale.slice();
	if ( settings.uniform ) settings.scale = [ settings.scale[ 0 ], settings.scale[ 0 ], settings.scale[ 0 ] ];
	return settings;

}

function orientationEuler( settings ) {

	const upright = UPRIGHT[ settings.upright ].euler;
	// primeiro a correção vertical, depois o giro em Y (ordem XZY aplicada como quaternions explícitos)
	const q = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), THREE.MathUtils.degToRad( settings.rotationY ) );
	const v = new THREE.Quaternion().setFromEuler( new THREE.Euler( ...upright.map( THREE.MathUtils.degToRad ), 'XYZ' ) );
	return q.multiply( v );

}

// monta (ou atualiza) o grupo de ajuste sobre um conteúdo: orientação + base. Devolve as dimensões SEM escala.
function applyAdjustment( pivot, content, settings ) {

	if ( content.parent !== pivot ) pivot.add( content );
	pivot.quaternion.copy( orientationEuler( settings ) );
	pivot.position.set( 0, 0, 0 );
	pivot.updateMatrixWorld( true );

	// caixa no referencial do pai do grupo de ajuste (sem a escala da raiz)
	const parentInverse = new THREE.Matrix4();
	if ( pivot.parent !== null ) parentInverse.copy( pivot.parent.matrixWorld ).invert();
	const box = new THREE.Box3();
	const part = new THREE.Box3();
	content.traverse( ( child ) => {

		if ( child.isMesh !== true ) return;
		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();
		part.copy( child.geometry.boundingBox ).applyMatrix4( new THREE.Matrix4().multiplyMatrices( parentInverse, child.matrixWorld ) );
		box.union( part );

	} );

	const offset = new THREE.Vector3();
	if ( settings.base && box.isEmpty() === false ) {

		const center = box.getCenter( new THREE.Vector3() );
		offset.set( - center.x, - box.min.y, - center.z ); // base em Y = 0 e centro da base na origem da raiz

	}

	pivot.position.copy( offset );
	pivot.updateMatrixWorld( true );
	const size = box.isEmpty() ? new THREE.Vector3() : box.getSize( new THREE.Vector3() );
	return { size, offset, minY: box.isEmpty() ? 0 : box.min.y + offset.y };

}

// dimensões finais a partir das dimensões sem escala
function scaledSize( size, settings ) {

	return new THREE.Vector3( size.x * settings.scale[ 0 ], size.y * settings.scale[ 1 ], size.z * settings.scale[ 2 ] );

}

// nova escala ao editar uma dimensão (axis 0..2). Proporcional quando settings.uniform. Devolve null se inválida.
function scaleForDimension( size, settings, axis, value ) {

	if ( Number.isFinite( value ) === false || value < DIMENSION_LIMITS.min || value > DIMENSION_LIMITS.max ) return null;
	const base = size.getComponent( axis );
	if ( base <= 0 ) return null;
	const factor = value / base;
	if ( factor < SCALE_LIMITS.min || factor > SCALE_LIMITS.max ) return null;
	if ( settings.uniform ) {

		const result = [ factor, factor, factor ];
		const dims = [ size.x * factor, size.y * factor, size.z * factor ];
		return dims.every( ( d ) => d === 0 || ( d >= DIMENSION_LIMITS.min * 0.999 && d <= DIMENSION_LIMITS.max ) ) ? result : null;

	}

	const result = settings.scale.slice();
	result[ axis ] = factor;
	return result;

}

function scaleForFactor( size, factor ) {

	if ( Number.isFinite( factor ) === false || factor < SCALE_LIMITS.min || factor > SCALE_LIMITS.max ) return null;
	const dims = [ size.x * factor, size.y * factor, size.z * factor ];
	if ( dims.some( ( d ) => d > DIMENSION_LIMITS.max ) || Math.max( ...dims ) < DIMENSION_LIMITS.min ) return null;
	return [ factor, factor, factor ];

}

export { ROTATIONS_Y, UPRIGHT, SCALE_LIMITS, DIMENSION_LIMITS, defaultSettings, sanitizeSettings, orientationEuler, applyAdjustment, scaledSize, scaleForDimension, scaleForFactor };
