// EV-004 — Sistema Inteligente de Materiais, Texturas e Iluminação 3D
//
// Aplicação de acabamentos (sem interface). Trabalha com três tipos de "dono" da aparência:
//   - componente paramétrico (EV-003): partes lógicas = chaves de material da definição (top, legs, frame...)
//   - malha simples (básicos, malhas importadas): uma parte 'main'
//   - grupo genérico (importado / Meus componentes): uma parte por material distinto
//
// Registro serializável no dono (mesclado ao userData existente, sem referências a objetos):
//   userData.project3ds.appearance = { version: 1, parts: { <chave>: { ...especificação, original? } } }
//   - 'original' (malhas e grupos genéricos) guarda o material anterior para "Restaurar acabamento original";
//     nos componentes, o original vem da própria definição paramétrica.
//
// Materiais com textura procedural levam material.userData.project3ds.procedural = { id, seed, scale },
// o que permite regenerar a textura (Meus componentes) sem guardar imagens.

import * as THREE from 'three';

import { getDefinition } from './SimpleMode.Components.js';
import { sanitizeSpec } from './SimpleMode.MaterialCatalog.js';
import { createProceduralTexture, getTextureDefinition, isKnownTexture } from './SimpleMode.Textures.js';

const META = 'project3ds';
const APPEARANCE_VERSION = 1;

const EDITABLE_MATERIALS = new Set( [ 'MeshStandardMaterial', 'MeshPhysicalMaterial' ] );
const TEXTURE_KEYS = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'anisotropyMap', 'specularIntensityMap', 'specularColorMap' ];

const _scale = new THREE.Vector3();
const _size = new THREE.Vector3();

// metadados ----------------------------------------------------------------------

function getMeta( object ) {

	const meta = object !== null && object !== undefined ? object.userData[ META ] : undefined;
	return meta !== null && typeof meta === 'object' ? meta : null;

}

function getAppearance( owner ) {

	const meta = getMeta( owner );
	const appearance = meta !== null ? meta.appearance : undefined;

	if ( appearance === null || typeof appearance !== 'object' || appearance.parts === null || typeof appearance.parts !== 'object' ) return null;

	return appearance;

}

function getPartMeta( owner, key ) {

	const appearance = getAppearance( owner );
	const part = appearance !== null ? appearance.parts[ key ] : undefined;

	return part !== undefined && part !== null ? part : null;

}

function setPartMeta( owner, key, partMeta ) {

	const meta = Object.assign( {}, getMeta( owner ) || {} );
	const parts = Object.assign( {}, getAppearance( owner ) !== null ? getAppearance( owner ).parts : {} );

	if ( partMeta === null ) delete parts[ key ];
	else parts[ key ] = JSON.parse( JSON.stringify( partMeta ) );

	if ( Object.keys( parts ).length === 0 ) delete meta.appearance;
	else meta.appearance = { version: APPEARANCE_VERSION, parts };

	owner.userData[ META ] = meta;

}

function getProcedural( material ) {

	const meta = material !== null && material !== undefined && material.userData !== undefined ? material.userData[ META ] : undefined;
	const procedural = meta !== null && typeof meta === 'object' ? meta.procedural : undefined;

	return procedural !== null && typeof procedural === 'object' && isKnownTexture( procedural.id ) ? procedural : null;

}

function setProcedural( material, procedural ) {

	const meta = Object.assign( {}, material.userData[ META ] || {} );

	if ( procedural === null ) delete meta.procedural;
	else meta.procedural = Object.assign( {}, procedural );

	if ( Object.keys( meta ).length === 0 ) delete material.userData[ META ];
	else material.userData[ META ] = meta;

}

// donos e partes -------------------------------------------------------------------

function getComponentInfo( object ) {

	const meta = getMeta( object );
	const data = meta !== null ? meta.component : undefined;

	if ( data === null || typeof data !== 'object' ) return null;

	const definition = getDefinition( data.id );

	return definition !== null && data.parameters !== null && typeof data.parameters === 'object' ? { definition, parameters: data.parameters } : null;

}

// Partes editáveis de um dono: [{ key, label, meshes }]
function getParts( owner ) {

	const component = getComponentInfo( owner );

	if ( component !== null ) {

		const specs = component.definition.materials( Object.assign( {}, component.parameters ) );

		return Object.keys( specs ).map( ( key ) => ( {
			key,
			label: specs[ key ].label,
			meshes: owner.children.filter( ( child ) => child.isMesh === true && getMeta( child ) !== null && getMeta( child ).material === key )
		} ) ).filter( ( part ) => part.meshes.length > 0 );

	}

	if ( owner.isMesh === true ) return [ { key: 'main', label: owner.name, meshes: [ owner ] } ];

	// grupo genérico: uma parte por material distinto
	const byMaterial = new Map();

	owner.traverse( function ( child ) {

		if ( child.isMesh !== true || Array.isArray( child.material ) ) return;

		const key = 'mat:' + child.material.uuid;
		if ( byMaterial.has( key ) === false ) byMaterial.set( key, { key, label: child.material.name || child.name || 'Material ' + ( byMaterial.size + 1 ), meshes: [] } );
		byMaterial.get( key ).meshes.push( child );

	} );

	return [ ...byMaterial.values() ];

}

// motivo pelo qual a parte não pode ser editada com segurança, ou null
function getEditIssue( part ) {

	for ( const mesh of part.meshes ) {

		if ( Array.isArray( mesh.material ) ) return 'multi';
		if ( EDITABLE_MATERIALS.has( mesh.material.type ) === false ) return 'unsupported';

		const procedural = getProcedural( mesh.material );
		if ( TEXTURE_KEYS.some( ( key ) => mesh.material[ key ] && ! ( key === 'map' && procedural !== null ) ) ) return 'external';

	}

	return null;

}

// especificação atual de uma parte (registro salvo ou leitura do material)
function getCurrentSpec( owner, part ) {

	const stored = getPartMeta( owner, part.key );
	if ( stored !== null ) return Object.assign( {}, stored );

	const material = part.meshes[ 0 ].material;
	const procedural = getProcedural( material );

	return {
		preset: null,
		version: 1,
		color: '#' + material.color.getHexString(),
		roughness: material.roughness !== undefined ? material.roughness : 0.5,
		metalness: material.metalness !== undefined ? material.metalness : 0,
		opacity: material.transparent ? material.opacity : 1,
		texture: procedural !== null ? { id: procedural.id, scale: procedural.scale, seed: procedural.seed } : null
	};

}

function captureOriginal( material ) {

	return {
		color: '#' + material.color.getHexString(),
		roughness: material.roughness,
		metalness: material.metalness,
		opacity: material.opacity,
		transparent: material.transparent
	};

}

// textura: repetição pela medida física ------------------------------------------------

// Medidas (metros) da face principal da malha, na orientação das UVs da geometria.
// Retorna [u, v] ou null quando a geometria não tem UVs utilizáveis.
function getUVSize( mesh ) {

	const geometry = mesh.geometry;

	if ( geometry === undefined || geometry.attributes.uv === undefined ) return null;

	mesh.updateWorldMatrix( true, false );
	mesh.getWorldScale( _scale );
	const sx = Math.abs( _scale.x ), sy = Math.abs( _scale.y ), sz = Math.abs( _scale.z );
	const p = geometry.parameters || {};

	switch ( geometry.type ) {

		case 'PlaneGeometry':
			return [ p.width * sx, p.height * sy ];

		case 'SphereGeometry':
			return [ 2 * Math.PI * p.radius * Math.max( sx, sz ) * ( p.phiLength / ( 2 * Math.PI ) ), Math.PI * p.radius * sy * ( p.thetaLength / Math.PI ) ];

		case 'CylinderGeometry':
			return [ Math.PI * ( p.radiusTop + p.radiusBottom ) * Math.max( sx, sz ) * ( p.thetaLength / ( 2 * Math.PI ) ), p.height * sy ];

	}

	// caixas e geometrias genéricas: face de maior área (perpendicular à menor medida)
	if ( geometry.boundingBox === null ) geometry.computeBoundingBox();
	geometry.boundingBox.getSize( _size );

	const x = _size.x * sx, y = _size.y * sy, z = _size.z * sz;

	if ( z <= x && z <= y ) return [ x, y ]; // frente/verso: u = X, v = Y
	if ( y <= x && y <= z ) return [ x, z ]; // topo/base: u = X, v = Z
	return [ z, y ]; // laterais: u = Z, v = Y

}

function updateRepeat( mesh ) {

	const material = mesh.material;

	if ( material === undefined || Array.isArray( material ) || material.map === null || material.map === undefined ) return;

	const procedural = getProcedural( material );
	if ( procedural === null ) return;

	const definition = getTextureDefinition( procedural.id );
	const size = getUVSize( mesh );

	if ( size === null ) return;

	const clamp = ( value ) => Math.min( 500, Math.max( 0.05, value ) );
	material.map.repeat.set(
		clamp( size[ 0 ] / ( definition.tile[ 0 ] * procedural.scale ) ),
		clamp( size[ 1 ] / ( definition.tile[ 1 ] * procedural.scale ) )
	);

}

// recalcula a repetição das texturas procedurais (ex.: após mudar medidas ou escala)
function updateRepeats( object ) {

	object.traverse( function ( child ) {

		if ( child.isMesh === true ) updateRepeat( child );

	} );

}

// aplicação ----------------------------------------------------------------------------

function disposeProceduralMap( material ) {

	if ( material.map !== null && material.map !== undefined && getProcedural( material ) !== null ) {

		material.map.dispose(); // libera a GPU; a imagem compartilhada continua em cache para reutilização
		material.map = null;

	}

	setProcedural( material, null );

}

function setTransparency( material, opacity ) {

	const transparent = opacity < 1;

	if ( material.transparent !== transparent ) material.needsUpdate = true;

	material.transparent = transparent;
	material.opacity = opacity;
	material.depthWrite = ! transparent;

}

// Aplica uma especificação a uma malha (o material é alterado no lugar; a geometria não muda).
// Retorna false quando a textura não é compatível com a geometria (o restante é aplicado).
function applySpecToMesh( mesh, spec ) {

	const material = mesh.material;
	let textureApplied = true;

	material.color.set( spec.color );
	material.roughness = spec.roughness;
	material.metalness = spec.metalness;
	setTransparency( material, spec.opacity );

	const current = getProcedural( material );

	if ( spec.texture !== null && getUVSize( mesh ) !== null ) {

		const same = current !== null && current.id === spec.texture.id && current.seed === spec.texture.seed && material.map;

		if ( same === false ) {

			const hadMap = !! material.map;
			disposeProceduralMap( material );
			material.map = createProceduralTexture( spec.texture.id, spec.texture.seed );
			if ( hadMap === false ) material.needsUpdate = true;

		}

		setProcedural( material, { id: spec.texture.id, seed: spec.texture.seed, scale: spec.texture.scale } );
		updateRepeat( mesh );

	} else {

		textureApplied = spec.texture === null;

		if ( current !== null ) {

			disposeProceduralMap( material );
			material.needsUpdate = true;

		}

	}

	return textureApplied;

}

function restoreOriginal( mesh, original ) {

	const material = mesh.material;

	if ( getProcedural( material ) !== null ) {

		disposeProceduralMap( material );
		material.needsUpdate = true;

	}

	material.color.set( original.color );
	material.roughness = original.roughness;
	material.metalness = original.metalness;
	setTransparency( material, original.transparent ? original.opacity : 1 );

}

// componentes: cada peça com acabamento recebe material próprio (a repetição da textura depende da peça)
function ensureOwnMaterial( mesh, owner, editor ) {

	let shared = false;

	owner.traverse( ( child ) => {

		if ( child !== mesh && child.material === mesh.material ) shared = true;

	} );

	if ( shared === false ) return;

	const old = mesh.material;
	const material = old.clone();

	if ( material.map ) material.map = material.map.clone(); // repetição independente

	mesh.material = material;

	if ( editor !== undefined ) {

		editor.removeMaterial( old );
		editor.addMaterial( material );

	}

}

// Aplica (ou remove, com partMeta = null) o acabamento de uma parte. Usado pelo SetAppearanceCommand.
// Retorna { textureSkipped } para que a interface possa avisar.
function applyPart( owner, key, partMeta, editor ) {

	const part = getParts( owner ).find( ( item ) => item.key === key );
	const result = { textureSkipped: false };

	if ( part === undefined ) return result;

	const component = getComponentInfo( owner );

	if ( partMeta === null ) {

		if ( component !== null ) {

			// componente: volta à especificação da definição (cores dos parâmetros)
			const spec = component.definition.materials( Object.assign( {}, component.parameters ) )[ key ];

			for ( const mesh of part.meshes ) {

				applySpecToMesh( mesh, { color: spec.color, roughness: spec.roughness !== undefined ? spec.roughness : 1, metalness: spec.metalness !== undefined ? spec.metalness : 0, opacity: spec.transparent ? spec.opacity : 1, texture: null } );

			}

		} else {

			const stored = getPartMeta( owner, key );

			if ( stored !== null && stored.original !== undefined ) {

				for ( const mesh of part.meshes ) restoreOriginal( mesh, stored.original );

			}

		}

		setPartMeta( owner, key, null );

		return result;

	}

	for ( const mesh of part.meshes ) {

		if ( component !== null ) ensureOwnMaterial( mesh, owner, editor );
		if ( applySpecToMesh( mesh, partMeta ) === false ) result.textureSkipped = true;

	}

	setPartMeta( owner, key, partMeta );

	return result;

}

// Reaplica os acabamentos registrados de um componente (após a regeneração paramétrica da EV-003)
function reapplyComponentAppearance( owner, editor ) {

	const appearance = getAppearance( owner );

	if ( appearance !== null ) {

		for ( const key of Object.keys( appearance.parts ) ) {

			const spec = sanitizeSpec( appearance.parts[ key ], isKnownTexture );
			if ( spec === null ) continue;

			const part = getParts( owner ).find( ( item ) => item.key === key );
			if ( part === undefined ) continue;

			for ( const mesh of part.meshes ) {

				ensureOwnMaterial( mesh, owner, editor );
				applySpecToMesh( mesh, spec );

			}

		}

	}

	updateRepeats( owner );

}

// Recria texturas procedurais a partir do registro do material (usado ao inserir de "Meus componentes")
function rebuildProceduralMaps( object ) {

	object.traverse( function ( child ) {

		if ( child.isMesh !== true || Array.isArray( child.material ) ) return;

		const procedural = getProcedural( child.material );

		if ( procedural !== null && ! child.material.map ) {

			child.material.map = createProceduralTexture( procedural.id, procedural.seed );
			child.material.needsUpdate = true;
			updateRepeat( child );

		}

	} );

}

// Remove as texturas procedurais de uma cópia (antes de guardar em "Meus componentes": só a definição é salva)
function stripProceduralMaps( object ) {

	object.traverse( function ( child ) {

		if ( child.isMesh === true && Array.isArray( child.material ) === false && getProcedural( child.material ) !== null ) child.material.map = null;

	} );

}

export {
	TEXTURE_KEYS,
	getAppearance,
	getPartMeta,
	getProcedural,
	getParts,
	getEditIssue,
	getCurrentSpec,
	captureOriginal,
	getUVSize,
	updateRepeats,
	applyPart,
	reapplyComponentAppearance,
	rebuildProceduralMaps,
	stripProceduralMaps
};
