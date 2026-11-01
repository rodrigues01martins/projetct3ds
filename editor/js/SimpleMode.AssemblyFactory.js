// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Criação, duplicação e (de)serialização de conjuntos.
//
// Duplicação inteligente (componente nativo, modelo importado, conjunto, subconjuntos, paredes com aberturas):
//   - todos os objetos da cópia recebem UUIDs novos; conjuntos recebem IDs de instância novos;
//   - aberturas da EV-007 passam a apontar para as portas/janelas DA CÓPIA (nunca para o original);
//   - materiais copiados por objeto (editar a cópia não altera o original); geometria copiada para componentes
//     nativos (regeneráveis) e COMPARTILHADA para modelos importados (somente leitura, EV-013);
//   - itens de orçamento continuam ligados aos UUIDs originais (a cópia não "herda" preços por UUID).
//
// Definição da biblioteca modular (formato 'project3ds-modular-assembly' v1): o JSON do grupo (geometria,
// parâmetros, materiais, transformações relativas, conectores) com a raiz na origem. Modelos importados que estão
// na biblioteca de modelos (EV-013) entram como REFERÊNCIA (assetId + hash + transformações + ajustes de material),
// sem duplicar o binário; os que não estão são INCORPORADOS. Uma referência ausente impede a inserção (nunca vira
// um cubo no lugar).

import * as THREE from 'three';

import { getMeta, setMeta, isImportedModelRoot, isComponent } from './SimpleMode.ComponentFactory.js';
import { createInstance } from './SimpleMode.ExternalModelInstances.js';
import { sanitizeSettings } from './SimpleMode.ExternalModelTransforms.js';
import {
	DEFINITION_FORMAT, DEFINITION_VERSION, ASSEMBLY_LIMITS, isAssembly, getAssembly, getConnectors, assemblyUnits,
	checkPreservable, reassignIdentities, totalVertices, cleanText
} from './SimpleMode.AssemblyData.js';

class AssemblyError extends Error {

	constructor( message, details = [] ) {

		super( message );
		this.name = 'AssemblyError';
		this.details = details;

	}

}

// validação antes de agrupar: mesmo pai, sem hospedados soltos, transformações preserváveis
function validateGrouping( objects, scene ) {

	if ( objects.length < 2 ) throw new AssemblyError( 'Selecione ou marque dois ou mais componentes para criar um conjunto.' );
	const parent = objects[ 0 ].parent;
	if ( objects.some( ( o ) => o.parent !== parent ) ) throw new AssemblyError( 'Os componentes precisam estar no mesmo nível (todos na cena ou todos no mesmo conjunto).' );
	if ( objects.some( ( o ) => o === scene || o.parent === null ) ) throw new AssemblyError( 'Seleção inválida.' );
	const hosted = objects.filter( ( o ) => getMeta( o ) !== null && getMeta( o ).hosted );
	if ( hosted.length > 0 ) throw new AssemblyError( 'Portas e janelas hospedadas acompanham a parede: inclua a parede no conjunto, não a abertura isolada.' );
	parent.updateWorldMatrix( true, false );
	const problems = checkPreservable( objects, parent.matrixWorld );
	if ( problems.length > 0 ) throw new AssemblyError( 'Não é possível agrupar sem alterar a aparência: a combinação de escala não uniforme e rotação destes objetos gera deformação que não pode ser preservada.', problems );
	return parent;

}

function validateUngroup( group ) {

	group.parent.updateWorldMatrix( true, false );
	const problems = checkPreservable( group.children, group.parent.matrixWorld );
	if ( problems.length > 0 ) throw new AssemblyError( 'Não é possível desagrupar sem alterar a aparência (escala não uniforme combinada com rotação do conjunto).', problems );

}

// cópia independente de um objeto (com identidades e vínculos próprios)
function duplicate( object ) {

	const copy = object.clone( true );

	// materiais próprios (preservando o compartilhamento dentro de cada modelo importado)
	const copies = new Map();
	copy.traverse( ( child ) => {

		if ( child.material === undefined ) return;
		const insideImported = ( () => {

			let current = child;
			while ( current !== null && current !== copy.parent ) {

				if ( isImportedModelRoot( current ) ) return true;
				current = current.parent;

			}

			return false;

		} )();

		const own = ( material ) => {

			if ( insideImported ) {

				if ( copies.has( material ) === false ) copies.set( material, material.clone() );
				return copies.get( material );

			}

			const clone = material.clone();
			if ( clone.map ) clone.map = clone.map.clone(); // EV-004: repetição de textura independente
			return clone;

		};

		child.material = Array.isArray( child.material ) ? child.material.map( own ) : own( child.material );
		if ( child.geometry !== undefined && insideImported === false ) child.geometry = child.geometry.clone();

	} );

	reassignIdentities( copy );
	return copy;

}

// componentes efetivos (para cartões, propriedades e quantitativos de conferência)
function countComponents( group ) {

	return assemblyUnits( group ).length;

}

function boundsOf( object ) {

	object.updateWorldMatrix( true, true );
	const box = new THREE.Box3().setFromObject( object, true );
	return box;

}

// limites no referencial do próprio objeto (sem a transformação dele): dimensões do conjunto "em si"
function localBounds( object ) {

	object.updateWorldMatrix( true, true );
	const inverse = new THREE.Matrix4().copy( object.matrixWorld ).invert();
	const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
	object.traverse( ( child ) => {

		if ( child.isMesh !== true || child.geometry === undefined ) return;
		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();
		part.copy( child.geometry.boundingBox ).applyMatrix4( m.multiplyMatrices( inverse, child.matrixWorld ) );
		box.union( part );

	} );
	return box;

}

// definição da biblioteca -------------------------------------------------------------------------------------------

function materialOverrides( root ) {

	const list = [];
	root.traverse( ( child ) => {

		if ( child.isMesh !== true ) return;
		list.push( [].concat( child.material ).map( ( m ) => ( {
			color: m.color ? m.color.getHex() : null,
			roughness: typeof m.roughness === 'number' ? m.roughness : null,
			metalness: typeof m.metalness === 'number' ? m.metalness : null,
			opacity: typeof m.opacity === 'number' ? m.opacity : null,
			transparent: m.transparent === true
		} ) ) );

	} );
	return list;

}

function applyMaterialOverrides( root, overrides ) {

	if ( Array.isArray( overrides ) === false ) return;
	let index = 0;
	root.traverse( ( child ) => {

		if ( child.isMesh !== true ) return;
		const entry = overrides[ index ++ ];
		if ( Array.isArray( entry ) === false ) return;
		[].concat( child.material ).forEach( ( m, slot ) => {

			const o = entry[ slot ];
			if ( o === undefined || o === null ) return;
			if ( m.color && Number.isInteger( o.color ) ) m.color.setHex( o.color );
			if ( typeof o.roughness === 'number' && typeof m.roughness === 'number' ) m.roughness = o.roughness;
			if ( typeof o.metalness === 'number' && typeof m.metalness === 'number' ) m.metalness = o.metalness;
			if ( typeof o.opacity === 'number' ) m.opacity = o.opacity;
			m.transparent = o.transparent === true || m.transparent;

		} );

	} );

}

// serializa um conjunto da cena como definição (o conjunto da cena não é alterado)
function serializeAssembly( group, { id, name, category, keywords = [], modelLibrary = null } ) {

	if ( isAssembly( group ) === false ) throw new AssemblyError( 'Selecione um conjunto modular.' );
	const copy = group.clone( true ); // cópia rasa de recursos: a geometria/materiais do original não são alterados
	copy.position.set( 0, 0, 0 );
	copy.quaternion.identity();
	copy.scale.set( 1, 1, 1 );

	const dependencies = [];
	const pairs = [];
	( function collect( a, b ) {

		pairs.push( [ a, b ] );
		for ( let i = 0; i < a.children.length; i ++ ) collect( a.children[ i ], b.children[ i ] );

	} )( group, copy );

	for ( const [ original, clone ] of pairs ) {

		if ( isImportedModelRoot( original ) === false ) continue;
		const asset = getMeta( original ).importedAsset;
		const record = modelLibrary !== null && modelLibrary.isLoaded() ? ( modelLibrary.getRecord( asset.assetId ) || modelLibrary.getRecords().find( ( r ) => asset.hash && r.hash === asset.hash ) || null ) : null;
		const entry = { assetId: asset.assetId, name: asset.name || asset.originalName || 'Modelo', originalName: asset.originalName || '', hash: asset.hash || null, kind: record !== null ? 'reference' : 'embedded' };
		if ( dependencies.some( ( d ) => d.assetId === entry.assetId ) === false ) dependencies.push( entry );
		if ( record === null ) continue;

		// referência: o conteúdo do arquivo sai da definição (o binário fica só na biblioteca de modelos)
		setMeta( clone, { assetReference: { assetId: record.id, hash: record.hash || null, materials: materialOverrides( original ) } } );
		for ( const child of clone.children.slice() ) clone.remove( child );

	}

	const json = copy.toJSON();
	const text = JSON.stringify( json );
	if ( text.length > ASSEMBLY_LIMITS.definitionChars ) throw new AssemblyError( 'O conjunto é grande demais para a biblioteca modular.' );

	const box = localBounds( group );
	const size = box.isEmpty() ? new THREE.Vector3() : box.getSize( new THREE.Vector3() );
	const units = assemblyUnits( group );

	return {
		definition: {
			format: DEFINITION_FORMAT,
			formatVersion: DEFINITION_VERSION,
			id,
			name: cleanText( name, ASSEMBLY_LIMITS.name ) || group.name || 'Conjunto',
			category,
			keywords,
			units: 'm',
			components: units.map( ( unit ) => ( { uuid: unit.uuid, name: unit.name, type: isImportedModelRoot( unit ) ? 'imported' : ( isComponent( unit ) ? getMeta( unit ).component.id : ( isAssembly( unit ) ? 'assembly' : 'object' ) ) } ) ),
			connectors: getConnectors( group ),
			dependencies,
			root: json
		},
		size: [ size.x, size.y, size.z ],
		componentCount: units.length,
		vertices: totalVertices( group )
	};

}

function validateDefinition( definition ) {

	if ( definition === null || typeof definition !== 'object' || definition.format !== DEFINITION_FORMAT ) throw new AssemblyError( 'A definição não é um conjunto modular do Project3DS.' );
	if ( definition.formatVersion !== DEFINITION_VERSION ) throw new AssemblyError( `Versão de conjunto não suportada (${String( definition.formatVersion ).slice( 0, 10 )}).` );
	if ( definition.root === null || typeof definition.root !== 'object' || definition.root.object === undefined ) throw new AssemblyError( 'A definição do conjunto está incompleta.' );
	if ( Array.isArray( definition.dependencies ) === false ) throw new AssemblyError( 'A definição do conjunto não lista suas dependências.' );
	return definition;

}

// dependências de modelos importados que não estão disponíveis na biblioteca de modelos
function missingDependencies( definition, modelLibrary ) {

	return definition.dependencies.filter( ( d ) => d.kind === 'reference' && ( modelLibrary === null || ( modelLibrary.getRecord( d.assetId ) === null && ( d.hash === null || modelLibrary.getRecords().some( ( r ) => r.hash === d.hash ) === false ) ) ) );

}

// cria uma instância NOVA de uma definição (UUIDs, IDs e vínculos próprios). Falha (sem inserir nada) se faltar
// qualquer dependência.
async function instantiateDefinition( definition, { modelLibrary } ) {

	validateDefinition( definition );
	if ( modelLibrary !== null && modelLibrary.isLoaded() === false ) await modelLibrary.load();
	const missing = missingDependencies( definition, modelLibrary );
	if ( missing.length > 0 ) throw new AssemblyError( `Modelos externos ausentes na biblioteca de modelos: ${missing.map( ( d ) => `"${d.name}" (${d.originalName || d.assetId})` ).join( ', ' )}. Importe-os (ou importe o pacote .p3ds-assembly.zip deste conjunto) antes de inserir.`, missing.map( ( d ) => d.name ) );

	const manager = new THREE.LoadingManager();
	manager.setURLModifier( ( url ) => url.startsWith( 'data:' ) ? url : 'data:image/png;base64,' );
	const root = await new THREE.ObjectLoader( manager ).parseAsync( definition.root );
	if ( isAssembly( root ) === false ) throw new AssemblyError( 'A definição não contém um conjunto válido.' );

	// referências a modelos importados: reconstruídas a partir da biblioteca de modelos (EV-013)
	const placeholders = [];
	root.traverse( ( object ) => {

		const meta = getMeta( object );
		if ( meta !== null && meta.assetReference ) placeholders.push( object );

	} );

	for ( const holder of placeholders ) {

		const meta = getMeta( holder );
		const ref = meta.assetReference;
		const record = modelLibrary.getRecord( ref.assetId ) || modelLibrary.getRecords().find( ( r ) => ref.hash && r.hash === ref.hash );
		const template = await modelLibrary.loadTemplate( record );
		const transforms = meta.importedAsset.transforms || {};
		const instance = createInstance( template, modelLibrary.assetOf( record ), sanitizeSettings( { rotationY: transforms.rotationY, upright: transforms.upright, base: transforms.baseNormalized, scale: [ 1, 1, 1 ] } ) );
		instance.name = holder.name;
		instance.position.copy( holder.position );
		instance.quaternion.copy( holder.quaternion );
		instance.scale.copy( holder.scale );
		applyMaterialOverrides( instance, ref.materials );
		const extra = Object.assign( {}, meta );
		delete extra.assetReference;
		extra.importedAsset = Object.assign( {}, getMeta( instance ).importedAsset, { name: meta.importedAsset.name } );
		instance.userData.project3ds = extra; // conectores e demais metadados do objeto preservados
		const parent = holder.parent;
		const index = parent.children.indexOf( holder );
		parent.children.splice( index, 1, instance );
		instance.parent = parent;
		holder.parent = null;

	}

	reassignIdentities( root, { definitionId: definition.id } );
	setMeta( root, { assembly: Object.assign( {}, getAssembly( root ), { name: definition.name, category: definition.category } ) } );
	root.name = definition.name;

	// origem no centro da base (posição livre definida por quem insere)
	root.updateMatrixWorld( true );
	const box = new THREE.Box3().setFromObject( root, true );
	if ( box.isEmpty() === false ) {

		const offset = new THREE.Vector3( - ( box.min.x + box.max.x ) / 2, - box.min.y, - ( box.min.z + box.max.z ) / 2 );
		for ( const child of root.children ) child.position.add( offset );

	}

	root.position.set( 0, 0, 0 );
	root.updateMatrixWorld( true );
	return root;

}

export { AssemblyError, localBounds, validateGrouping, validateUngroup, duplicate, countComponents, boundsOf, serializeAssembly, validateDefinition, missingDependencies, instantiateDefinition, materialOverrides };
