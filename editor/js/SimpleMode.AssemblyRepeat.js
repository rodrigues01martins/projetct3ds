// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Repetição em linha e em matriz. Dois conceitos DIFERENTES, em campos diferentes:
//   - espaçamento livre (gap): distância entre as faces de objetos vizinhos → passo = dimensão + espaçamento;
//   - distância entre centros (pitch): o próprio passo.
// Ex.: cadeira de 0,50 m, espaçamento livre de 0,30 m → passo entre centros de 0,80 m.
// As cópias preservam a orientação do original, recebem UUIDs/IDs/vínculos próprios (duplicação inteligente) e
// entram numa ÚNICA operação de Desfazer. Limites: 20 linhas, 20 colunas, 200 instâncias novas e um teto de
// vértices novos (modelos importados pesados reduzem a quantidade permitida).

import * as THREE from 'three';

import { AddAssemblyInstancesCommand } from './commands/AddAssemblyInstancesCommand.js';
import { ASSEMBLY_LIMITS, totalVertices } from './SimpleMode.AssemblyData.js';
import { duplicate, AssemblyError } from './SimpleMode.AssemblyFactory.js';

const AXES = { x: new THREE.Vector3( 1, 0, 0 ), y: new THREE.Vector3( 0, 1, 0 ), z: new THREE.Vector3( 0, 0, 1 ) };

// dimensão do objeto ao longo de um eixo do pai (caixa no espaço do pai: considera rotação e escala do objeto)
function sizeAlong( object, axis ) {

	const parent = object.parent;
	parent.updateWorldMatrix( true, false );
	object.updateWorldMatrix( true, true );
	const inverse = new THREE.Matrix4().copy( parent.matrixWorld ).invert();
	const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
	object.traverse( ( child ) => {

		if ( child.isMesh !== true || child.geometry === undefined ) return;
		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();
		part.copy( child.geometry.boundingBox ).applyMatrix4( m.multiplyMatrices( inverse, child.matrixWorld ) );
		box.union( part );

	} );
	if ( box.isEmpty() ) return 0;
	const size = box.getSize( new THREE.Vector3() );
	return Math.abs( size.dot( AXES[ axis ] ) );

}

// passo entre centros a partir do modo escolhido
function stepFor( object, axis, mode, value ) {

	if ( Number.isFinite( value ) === false || value < 0 ) throw new AssemblyError( 'O espaçamento precisa ser um número maior ou igual a zero.' );
	const size = sizeAlong( object, axis );
	const step = mode === 'gap' ? size + value : value;
	if ( step <= 1e-6 ) throw new AssemblyError( 'A distância entre centros precisa ser maior que zero (as cópias ficariam sobrepostas).' );
	return { step, size };

}

// quantidade máxima permitida considerando a complexidade do objeto
function maxInstances( object ) {

	const vertices = Math.max( totalVertices( object ), 1 );
	return Math.max( 0, Math.min( ASSEMBLY_LIMITS.repeatInstances, Math.floor( ASSEMBLY_LIMITS.repeatVertices / vertices ) ) );

}

function checkLimits( object, newCount ) {

	if ( newCount < 1 ) throw new AssemblyError( 'Nenhuma cópia nova a criar (verifique a quantidade).' );
	const allowed = maxInstances( object );
	if ( newCount > ASSEMBLY_LIMITS.repeatInstances ) throw new AssemblyError( `Limite de ${ASSEMBLY_LIMITS.repeatInstances} instâncias novas por operação.` );
	if ( newCount > allowed ) throw new AssemblyError( `Este objeto é complexo (${totalVertices( object ).toLocaleString( 'pt-BR' )} vértices): no máximo ${allowed} cópia(s) por operação para não prejudicar o desempenho.` );

}

// deslocamentos (espaço do pai) das cópias novas
function lineOffsets( object, { axis = 'x', sign = 1, count = 2, mode = 'gap', value = 0, includeOriginal = true } ) {

	if ( AXES[ axis ] === undefined ) throw new AssemblyError( 'Direção inválida.' );
	if ( Number.isInteger( count ) === false || count < 1 ) throw new AssemblyError( 'A quantidade precisa ser um número inteiro maior que zero.' );
	const { step, size } = stepFor( object, axis, mode, value );
	const newCount = includeOriginal ? count - 1 : count;
	checkLimits( object, newCount );
	const offsets = [];
	for ( let i = 1; i <= newCount; i ++ ) offsets.push( AXES[ axis ].clone().multiplyScalar( sign * step * i ) );
	return { offsets, step, size, newCount };

}

function matrixOffsets( object, { rows = 2, columns = 2, modeX = 'gap', valueX = 0, modeZ = 'gap', valueZ = 0, angle = 0 } ) {

	if ( Number.isInteger( rows ) === false || Number.isInteger( columns ) === false || rows < 1 || columns < 1 ) throw new AssemblyError( 'Linhas e colunas precisam ser números inteiros maiores que zero.' );
	if ( rows > ASSEMBLY_LIMITS.repeatRows || columns > ASSEMBLY_LIMITS.repeatColumns ) throw new AssemblyError( `Limite de ${ASSEMBLY_LIMITS.repeatRows} linhas × ${ASSEMBLY_LIMITS.repeatColumns} colunas.` );
	const x = stepFor( object, 'x', modeX, valueX );
	const z = stepFor( object, 'z', modeZ, valueZ );
	const newCount = rows * columns - 1;
	checkLimits( object, newCount );
	const rotation = new THREE.Quaternion().setFromAxisAngle( AXES.y, THREE.MathUtils.degToRad( angle ) );
	const offsets = [];
	for ( let r = 0; r < rows; r ++ ) {

		for ( let c = 0; c < columns; c ++ ) {

			if ( r === 0 && c === 0 ) continue; // o original ocupa a primeira posição
			offsets.push( new THREE.Vector3( c * x.step, 0, r * z.step ).applyQuaternion( rotation ) );

		}

	}

	return { offsets, stepX: x.step, stepZ: z.step, newCount };

}

// cria as cópias (não inseridas) com os deslocamentos dados
function buildCopies( object, offsets, baseName ) {

	return offsets.map( ( offset, i ) => {

		const copy = duplicate( object );
		copy.position.copy( object.position ).add( offset );
		copy.name = `${baseName} ${String( i + 2 ).padStart( 2, '0' )}`;
		return copy;

	} );

}

// comando único (linha ou matriz). group: { name, category } para agrupar o resultado (com o original)
function repeatCommand( editor, object, offsets, { group = null, includeOriginal = true, name } ) {

	const copies = buildCopies( object, offsets, object.name || 'Cópia' );
	return new AddAssemblyInstancesCommand( editor, copies, {
		parent: object.parent,
		group,
		original: group !== null && includeOriginal ? object : null,
		name
	} );

}

export { AXES, sizeAlong, stepFor, maxInstances, lineOffsets, matrixOffsets, buildCopies, repeatCommand };
