// EV-003 — Biblioteca Inteligente de Componentes 3D
//
// Fábrica de geometrias: transforma as peças declaradas em SimpleMode.Components.js em malhas Three.js.
//
// Estrutura de um componente:
//   THREE.Group  (userData.project3ds.component = { id, version, parameters })   <- objeto único no Modo Simples
//     └─ THREE.Mesh por peça (userData.project3ds.part = 'tampo', material = 'top')
//
// Os metadados são apenas dados serializáveis (nenhuma referência a objetos Three.js) e são
// mesclados ao userData existente, sem sobrescrever outras chaves.

import * as THREE from 'three';

import { getDefinition, getDefaultParameters, migrateParameters, validateParameters } from './SimpleMode.Components.js';

const META_KEY = 'project3ds';

// metadados ------------------------------------------------------------------

function getMeta( object ) {

	const meta = object !== null && object !== undefined ? object.userData[ META_KEY ] : undefined;
	return meta !== null && typeof meta === 'object' ? meta : null;

}

function setMeta( object, values ) {

	object.userData[ META_KEY ] = Object.assign( {}, getMeta( object ) || {}, values );

}

// { id, version, parameters } ou null
function getComponentData( object ) {

	const meta = getMeta( object );
	const data = meta !== null ? meta.component : undefined;

	if ( data === null || typeof data !== 'object' || typeof data.id !== 'string' ) return null;

	return data;

}

function isComponent( object ) {

	return getComponentData( object ) !== null;

}

// raiz de uma instância salva em "Meus componentes" (grupos não paramétricos)
function isUserComponent( object ) {

	const meta = getMeta( object );
	return meta !== null && meta.userComponent !== null && typeof meta.userComponent === 'object';

}

// Ancestral mais alto (abaixo da cena) que representa um componente: é ele que o Modo Simples seleciona
function findComponentRoot( object, scene ) {

	let root = null;
	let current = object;

	while ( current !== null && current !== undefined && current !== scene ) {

		if ( isComponent( current ) || isUserComponent( current ) ) root = current;
		current = current.parent;

	}

	return root;

}

// Estado de edição paramétrica de uma instância:
//   editable: definição conhecida e versão suportada
//   parameters: parâmetros migrados para a versão atual (cópia)
function getComponentState( object ) {

	const data = getComponentData( object );

	if ( data === null ) return null;

	const definition = getDefinition( data.id );

	if ( definition === null ) return { data, definition: null, parameters: null, editable: false, reason: 'unknown' };

	const version = Number.isInteger( data.version ) ? data.version : 1;
	const parameters = migrateParameters( definition, data.parameters, version );

	if ( parameters === null ) return { data, definition, parameters: null, editable: false, reason: 'newer' };

	const invalid = validateParameters( definition, parameters );

	return { data, definition, parameters, editable: invalid === null, reason: invalid === null ? null : 'invalid' };

}

// geração ---------------------------------------------------------------------

function createMaterial( spec ) {

	const material = new THREE.MeshStandardMaterial();
	applyMaterialSpec( material, spec );
	return material;

}

function applyMaterialSpec( material, spec ) {

	material.name = spec.label;
	if ( material.color !== undefined ) material.color.set( spec.color );
	if ( spec.roughness !== undefined && material.roughness !== undefined ) material.roughness = spec.roughness;
	if ( spec.metalness !== undefined && material.metalness !== undefined ) material.metalness = spec.metalness;

	const transparent = spec.transparent === true;
	if ( material.transparent !== transparent ) material.needsUpdate = true;
	material.transparent = transparent;
	material.opacity = transparent ? spec.opacity : 1;
	material.depthWrite = ! transparent;

}

function createGeometry( part ) {

	const [ x, y, z ] = part.size.map( ( value ) => Math.max( value, 1e-4 ) );

	if ( part.shape === 'cylinder' ) return new THREE.CylinderGeometry( x / 2, x / 2, y, 24 );

	return new THREE.BoxGeometry( x, y, z );

}

function applyPartTransform( mesh, part ) {

	mesh.position.fromArray( part.position );
	mesh.rotation.set( 0, 0, 0 );
	mesh.scale.set( 1, 1, 1 );
	mesh.updateMatrix();

}

function createPartMesh( part, material ) {

	const mesh = new THREE.Mesh( createGeometry( part ), material );
	mesh.name = part.label;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	setMeta( mesh, { part: part.id, material: part.material } );
	applyPartTransform( mesh, part );

	return mesh;

}

// Cria uma nova instância independente (geometrias e materiais próprios)
function createComponent( id, overrides = {} ) {

	const definition = getDefinition( id );

	if ( definition === null ) throw new Error( 'Componente desconhecido: ' + id );

	const parameters = Object.assign( getDefaultParameters( definition ), overrides );
	const invalid = validateParameters( definition, parameters );

	if ( invalid !== null ) throw new Error( invalid.message );

	const group = new THREE.Group();
	group.name = definition.name;

	setMeta( group, { component: { id: definition.id, version: definition.version, parameters: Object.assign( {}, parameters ) } } );

	const materialSpecs = definition.materials( parameters );
	const materials = {};

	for ( const key in materialSpecs ) materials[ key ] = createMaterial( materialSpecs[ key ] );

	for ( const part of definition.parts( parameters ) ) group.add( createPartMesh( part, materials[ part.material ] ) );

	return group;

}

// Regenera as peças de uma instância existente a partir de novos parâmetros, preservando:
// o próprio grupo (UUID, nome, posição, rotação, escala, seleção), as malhas e materiais das peças que
// continuam existindo (UUIDs e ajustes feitos no Modo Avançado; apenas cor/opacidade vêm dos parâmetros).
// Peças que deixam de existir são removidas e novas peças são criadas (ex.: quantidade de prateleiras).
//
// hooks (fornecidos pelo comando, para manter os registros do Editor consistentes):
//   addPart( mesh, group, index ), removePart( mesh ), replaceGeometry( mesh, newGeometry )

function regenerateComponent( group, definition, parameters, hooks ) {

	const parts = definition.parts( parameters );
	const materialSpecs = definition.materials( parameters );

	// peças atuais indexadas pelo identificador estável
	const existing = new Map();

	for ( const child of [ ...group.children ] ) {

		const meta = getMeta( child );
		if ( meta !== null && typeof meta.part === 'string' && child.isMesh === true ) existing.set( meta.part, child );

	}

	// materiais atuais por chave (reaproveitados para manter personalizações)
	const materials = {};

	for ( const child of existing.values() ) {

		const key = getMeta( child ).material;
		if ( materials[ key ] === undefined && child.material !== undefined && Array.isArray( child.material ) === false ) materials[ key ] = child.material;

	}

	for ( const key in materialSpecs ) {

		if ( materials[ key ] === undefined ) materials[ key ] = createMaterial( materialSpecs[ key ] );
		else applyMaterialSpec( materials[ key ], materialSpecs[ key ] );

	}

	const keep = new Set();

	parts.forEach( function ( part, index ) {

		const mesh = existing.get( part.id );

		if ( mesh !== undefined ) {

			hooks.replaceGeometry( mesh, createGeometry( part ) );
			applyPartTransform( mesh, part );

			// a peça pode ter tido o material trocado (ex.: cópia): mantém o material próprio, atualizando a cor
			if ( mesh.material !== materials[ part.material ] && mesh.material !== undefined && Array.isArray( mesh.material ) === false ) {

				applyMaterialSpec( mesh.material, materialSpecs[ part.material ] );

			}

			keep.add( mesh );

		} else {

			const created = createPartMesh( part, materials[ part.material ] );
			hooks.addPart( created, group, Math.min( index, group.children.length ) );
			keep.add( created );

		}

	} );

	for ( const mesh of existing.values() ) {

		if ( keep.has( mesh ) === false ) hooks.removePart( mesh );

	}

	setMeta( group, { component: { id: definition.id, version: definition.version, parameters: Object.assign( {}, parameters ) } } );

}

export {
	META_KEY,
	getMeta,
	setMeta,
	getComponentData,
	getComponentState,
	isComponent,
	isUserComponent,
	findComponentRoot,
	createComponent,
	regenerateComponent
};
