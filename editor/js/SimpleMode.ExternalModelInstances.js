// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Instâncias independentes de um modelo importado.
//   - UUID, nome, posição, rotação, escala e seleção próprios (cada instância é um grupo novo);
//   - GEOMETRIA compartilhada entre instâncias (somente leitura; nenhuma ferramenta do Modo Simples a altera) —
//     no JSON do projeto ela é gravada uma única vez;
//   - MATERIAIS copiados por instância (um material compartilhado por várias peças continua compartilhado DENTRO da
//     instância): mudar a cor de uma cadeira não muda as outras; texturas são compartilhadas e nunca descartadas
//     ao remover uma instância.
// Metadados no grupo principal: userData.project3ds.importedAsset (sem binários, sem referência circular).

import * as THREE from 'three';

import { setMeta, getMeta } from './SimpleMode.ComponentFactory.js';
import { applyAdjustment, sanitizeSettings } from './SimpleMode.ExternalModelTransforms.js';

const ASSET_VERSION = 1;
const PIVOT_NAME = 'Ajuste de importação';

function isImportedModel( object ) {

	const meta = object !== null && object !== undefined ? getMeta( object ) : null;
	return meta !== null && meta.importedAsset !== null && typeof meta.importedAsset === 'object' && typeof meta.importedAsset.assetId === 'string';

}

function getImportedAsset( object ) {

	return isImportedModel( object ) ? getMeta( object ).importedAsset : null;

}

function findImportedRoot( object, scene ) {

	let current = object, found = null;
	while ( current !== null && current !== undefined && current !== scene ) {

		if ( isImportedModel( current ) ) found = current;
		current = current.parent;

	}

	return found;

}

// cópia do conteúdo do arquivo para uma instância (geometria compartilhada, materiais próprios)
function cloneContent( template ) {

	const content = template.clone( true );
	const copies = new Map();
	content.traverse( ( child ) => {

		if ( child.isMesh !== true ) return;
		const copy = ( material ) => {

			if ( copies.has( material ) === false ) copies.set( material, material.clone() );
			return copies.get( material );

		};

		child.material = Array.isArray( child.material ) ? child.material.map( copy ) : copy( child.material );

	} );
	return content;

}

// metadados serializáveis da instância
function assetMeta( asset, settings, size ) {

	return {
		version: ASSET_VERSION,
		assetId: asset.id,
		sourceFormat: asset.format,
		originalName: asset.originalName,
		sourceUnit: 'm',
		name: asset.name,
		category: asset.category,
		hash: asset.hash || null,
		transforms: { rotationY: settings.rotationY, upright: settings.upright, baseNormalized: settings.base },
		originalDimensions: [ size.x, size.y, size.z ].map( ( v ) => Math.round( v * 1e6 ) / 1e6 )
	};

}

// instância completa: raiz (escala) -> ajuste (orientação/base) -> conteúdo
function createInstance( template, asset, rawSettings ) {

	const settings = sanitizeSettings( rawSettings );
	const root = new THREE.Group();
	root.name = asset.name;
	const pivot = new THREE.Group();
	pivot.name = PIVOT_NAME;
	root.add( pivot );

	const content = cloneContent( template );
	const { size } = applyAdjustment( pivot, content, settings );
	root.scale.fromArray( settings.scale );
	root.updateMatrixWorld( true );

	setMeta( root, { importedAsset: assetMeta( asset, settings, size ) } );
	return root;

}

// estrutura de pré-visualização (usa o próprio objeto carregado, sem cópia)
function attachPreview( holder, template, rawSettings ) {

	const settings = sanitizeSettings( rawSettings );
	let pivot = holder.children.find( ( child ) => child.name === PIVOT_NAME );
	if ( pivot === undefined ) {

		pivot = new THREE.Group();
		pivot.name = PIVOT_NAME;
		holder.add( pivot );

	}

	holder.scale.set( 1, 1, 1 );
	holder.position.set( 0, 0, 0 );
	holder.updateMatrixWorld( true );
	const result = applyAdjustment( pivot, template, settings );
	holder.scale.fromArray( settings.scale );
	holder.updateMatrixWorld( true );
	return result;

}

export { ASSET_VERSION, PIVOT_NAME, isImportedModel, getImportedAsset, findImportedRoot, cloneContent, createInstance, attachPreview };
