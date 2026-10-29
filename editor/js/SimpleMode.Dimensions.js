// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
//
// Dimensões nos eixos *locais* do objeto: tamanho da geometria (boundingBox) x |escala|.
// A rotação não altera as dimensões. Editar uma dimensão muda apenas a escala (SetScaleCommand);
// os vértices da geometria nunca são modificados.

import * as THREE from 'three';

const EPSILON = 1e-9; // abaixo disso o eixo é considerado sem espessura
const MIN_SCALE = 1e-6; // escala mínima aceita (evita objetos degenerados)

const PRIMITIVE_TYPES = {
	BoxGeometry: 'cube',
	SphereGeometry: 'sphere',
	CylinderGeometry: 'cylinder',
	PlaneGeometry: 'plane'
};

const _inverse = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const _box = new THREE.Box3();

function hasDeformation( object ) {

	if ( object.isSkinnedMesh === true ) return 'deformed';
	if ( object.isInstancedMesh === true || object.isBatchedMesh === true ) return 'instanced';

	const geometry = object.geometry;

	if ( geometry !== undefined && geometry.morphAttributes !== undefined && Object.keys( geometry.morphAttributes ).length > 0 ) return 'deformed';

	if ( Array.isArray( object.animations ) && object.animations.length > 0 ) return 'animated';

	return null;

}

// Caixa da geometria de cada malha descendente, expressa no espaço local de `object` (sem a escala dele)

function computeLocalBox( object, target ) {

	target.makeEmpty();

	object.updateWorldMatrix( true, true );
	_inverse.copy( object.matrixWorld ).invert();

	let issue = null;

	object.traverse( function ( child ) {

		if ( child.geometry === undefined || child.visible === false ) return;
		if ( child.isMesh !== true && child.isLine !== true && child.isPoints !== true ) return;

		issue = issue || hasDeformation( child );

		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();

		_box.copy( child.geometry.boundingBox );
		_matrix.multiplyMatrices( _inverse, child.matrixWorld );
		target.union( _box.applyMatrix4( _matrix ) );

	} );

	return issue;

}

// Informações de dimensão de um objeto.
//
// kind:      'mesh' (geometria própria) | 'group' (conjunto de malhas) | 'none' (luz, câmera, vazio)
// base:      tamanho local sem escala (metros)
// size:      tamanho local com |escala| (metros) — o que é exibido ao usuário
// editable:  pode ser editado com segurança
// uniformOnly: só aceita mudança proporcional (grupos e modelos)
// axisEditable: eixos com espessura (> 0)
// reason:    motivo de bloqueio ('deformed' | 'animated' | 'instanced' | 'empty')

function getDimensionInfo( object ) {

	const info = {
		kind: 'none',
		primitive: null,
		base: new THREE.Vector3(),
		size: new THREE.Vector3(),
		editable: false,
		uniformOnly: false,
		axisEditable: [ false, false, false ],
		reason: null
	};

	if ( object === null || object.isLight === true || object.isCamera === true ) return info;

	if ( object.geometry !== undefined && object.children.length === 0 ) {

		const geometry = object.geometry;

		info.kind = 'mesh';
		info.primitive = PRIMITIVE_TYPES[ geometry.type ] || null;

		if ( geometry.boundingBox === null ) geometry.computeBoundingBox();

		if ( geometry.boundingBox.isEmpty() ) {

			info.reason = 'empty';
			return info;

		}

		geometry.boundingBox.getSize( info.base );
		info.reason = hasDeformation( object );

	} else {

		const localBox = new THREE.Box3();
		info.reason = computeLocalBox( object, localBox );

		if ( localBox.isEmpty() ) {

			info.reason = info.reason || 'empty';
			return info;

		}

		info.kind = 'group';
		info.uniformOnly = true;
		localBox.getSize( info.base );

	}

	info.size.set(
		info.base.x * Math.abs( object.scale.x ),
		info.base.y * Math.abs( object.scale.y ),
		info.base.z * Math.abs( object.scale.z )
	);

	info.axisEditable = [ info.base.x > EPSILON, info.base.y > EPSILON, info.base.z > EPSILON ];
	info.editable = info.reason === null && info.axisEditable.some( Boolean );

	return info;

}

// Nova escala para que o eixo `axis` (0, 1, 2) passe a medir `newSize` metros.
// Retorna null quando a operação não é segura ou o valor é inválido.

function computeScaleForSize( object, info, axis, newSize, keepProportions ) {

	if ( info.editable !== true || info.axisEditable[ axis ] !== true ) return null;
	if ( Number.isFinite( newSize ) === false || newSize <= 0 ) return null;

	const current = info.size.getComponent( axis );
	const scale = object.scale.clone();

	if ( keepProportions || info.uniformOnly ) {

		if ( current <= EPSILON ) return null;

		scale.multiplyScalar( newSize / current );

	} else {

		const sign = Math.sign( object.scale.getComponent( axis ) ) || 1;
		scale.setComponent( axis, sign * newSize / info.base.getComponent( axis ) );

	}

	const valid = [ scale.x, scale.y, scale.z ].every( ( value ) => Number.isFinite( value ) && Math.abs( value ) >= MIN_SCALE );

	return valid ? scale : null;

}

export { getDimensionInfo, computeScaleForSize, PRIMITIVE_TYPES };
