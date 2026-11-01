// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Dados puros dos conjuntos modulares (sem interface):
//   raiz do conjunto = THREE.Group com userData.project3ds.assembly = { version, id, name, kind: 'modular', category,
//   definitionId } — os componentes continuam objetos independentes dentro do grupo (nenhuma malha é fundida).
//   Conectores personalizados ficam em userData.project3ds.connectors = { version, items: [ CONECTOR ] } do próprio
//   objeto (componente nativo, modelo importado ou conjunto) — dados auxiliares, nunca geometria.
//
// Identificadores distintos e NÃO intercambiáveis:
//   - assembly.id ........ identidade da INSTÂNCIA do conjunto na cena (nova a cada cópia/inserção);
//   - assembly.definitionId  ID da DEFINIÇÃO na biblioteca modular (ou null);
//   - object.uuid ......... UUID de cada componente da instância (novo a cada cópia/inserção).
//
// Transformações: mudar o pai de um objeto exige recalcular sua matriz local a partir da matriz mundial. Quando a
// matriz resultante não é representável por posição + rotação + escala (cisalhamento: escala não uniforme combinada
// com rotação na hierarquia), a operação é BLOQUEADA — nada é decomposto de forma imprecisa em silêncio.

import * as THREE from 'three';

import { getMeta, setMeta, isComponent, isUserComponent, isImportedModelRoot } from './SimpleMode.ComponentFactory.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';
import { getOpenings, setOpenings, newOpeningId } from './SimpleMode.Openings.js';

const ASSEMBLY_VERSION = 1;
const CONNECTOR_VERSION = 1;
const DEFINITION_FORMAT = 'project3ds-modular-assembly';
const DEFINITION_VERSION = 1;

const CATEGORIES = [
	{ id: 'rooms', name: 'Ambientes' },
	{ id: 'stands', name: 'Estandes' },
	{ id: 'modular', name: 'Estruturas modulares' },
	{ id: 'furniture', name: 'Mobiliário' },
	{ id: 'exhibition', name: 'Exposição' },
	{ id: 'events', name: 'Eventos' },
	{ id: 'others', name: 'Outros' }
];

const LIMITS = {
	name: 80,
	keywords: 12,
	connectors: 64,
	connectorName: 40,
	family: 30,
	repeatRows: 20,
	repeatColumns: 20,
	repeatInstances: 200,
	repeatVertices: 2000000, // vértices novos por operação (modelos importados pesados reduzem a quantidade)
	definitionChars: 60 * 1024 * 1024
};

const CONNECTOR_KINDS = [ 'center', 'face', 'edge', 'point' ];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function newId() {

	return THREE.MathUtils.generateUUID();

}

function categoryName( id ) {

	const category = CATEGORIES.find( ( c ) => c.id === id );
	return category !== undefined ? category.name : 'Outros';

}

function cleanText( value, max ) {

	if ( typeof value !== 'string' ) return '';
	let out = '';
	for ( const char of value ) out += char.codePointAt( 0 ) < 32 ? ' ' : char;
	return Array.from( out.replace( /\s+/g, ' ' ).trim() ).slice( 0, max ).join( '' );

}

// conjuntos -------------------------------------------------------------------------------------------------------

function getAssembly( object ) {

	const meta = object !== null && object !== undefined ? getMeta( object ) : null;
	const data = meta !== null ? meta.assembly : undefined;
	return data !== null && typeof data === 'object' && typeof data.id === 'string' ? data : null;

}

function isAssembly( object ) {

	return getAssembly( object ) !== null;

}

function createAssemblyMeta( { name, category = 'others', id = newId(), definitionId = null } ) {

	return {
		version: ASSEMBLY_VERSION,
		id,
		name: cleanText( name, LIMITS.name ) || 'Conjunto',
		kind: 'modular',
		category: CATEGORIES.some( ( c ) => c.id === category ) ? category : 'others',
		definitionId: typeof definitionId === 'string' ? definitionId : null
	};

}

// conjuntos que contêm o objeto, do mais externo ao mais interno (sem incluir o próprio objeto)
function assemblyAncestors( object, scene ) {

	const list = [];
	let current = object !== null && object !== undefined ? object.parent : null;
	while ( current !== null && current !== undefined && current !== scene ) {

		if ( isAssembly( current ) ) list.unshift( current );
		current = current.parent;

	}

	return list;

}

// "unidades" de um conjunto: componentes, modelos importados, subconjuntos e objetos soltos de primeiro nível
function assemblyUnits( group ) {

	const units = [];
	( function walk( object ) {

		for ( const child of object.children ) {

			if ( isLightingGroup( child ) || child.isLight || child.isCamera ) continue;
			if ( isAssembly( child ) ) {

				walk( child );
				continue;

			}

			if ( isComponent( child ) || isUserComponent( child ) || isImportedModelRoot( child ) || child.isMesh || child.children.length > 0 ) units.push( child );

		}

	} )( group );

	return units;

}

// conectores --------------------------------------------------------------------------------------------------------

const vector = ( value, length = 3 ) => Array.isArray( value ) && value.length === length && value.every( ( n ) => typeof n === 'number' && Number.isFinite( n ) && Math.abs( n ) < 1e5 ) ? value.slice() : null;

function cleanConnector( raw, index = 0 ) {

	if ( raw === null || typeof raw !== 'object' ) return null;
	const position = vector( raw.position );
	const normal = vector( raw.normal );
	if ( position === null || normal === null || Math.hypot( ...normal ) < 1e-6 ) return null;
	const n = new THREE.Vector3().fromArray( normal ).normalize();
	let up = vector( raw.up );
	let u = up !== null ? new THREE.Vector3().fromArray( up ) : new THREE.Vector3( 0, 1, 0 );
	if ( u.lengthSq() < 1e-9 || Math.abs( u.clone().normalize().dot( n ) ) > 0.999 ) u = Math.abs( n.y ) > 0.9 ? new THREE.Vector3( 0, 0, 1 ) : new THREE.Vector3( 0, 1, 0 );
	u.sub( n.clone().multiplyScalar( u.dot( n ) ) ).normalize(); // ortogonal à normal
	up = u.toArray();
	return {
		id: typeof raw.id === 'string' && ID.test( raw.id ) ? raw.id : `c${index + 1}`,
		name: cleanText( raw.name, LIMITS.connectorName ) || `Conector ${index + 1}`,
		kind: CONNECTOR_KINDS.includes( raw.kind ) ? raw.kind : 'face',
		position: position.map( ( v ) => Math.round( v * 1e6 ) / 1e6 ),
		normal: n.toArray().map( ( v ) => Math.round( v * 1e6 ) / 1e6 ),
		up: up.map( ( v ) => Math.round( v * 1e6 ) / 1e6 ),
		family: cleanText( raw.family, LIMITS.family ).toLowerCase() || 'generic',
		role: [ 'neutral', 'male', 'female' ].includes( raw.role ) ? raw.role : 'neutral'
	};

}

function getConnectors( object ) {

	const meta = getMeta( object );
	const data = meta !== null ? meta.connectors : undefined;
	if ( data === null || typeof data !== 'object' || Array.isArray( data.items ) === false ) return [];
	const ids = new Set();
	const list = [];
	data.items.slice( 0, LIMITS.connectors ).forEach( ( raw, index ) => {

		const clean = cleanConnector( raw, index );
		if ( clean !== null && ids.has( clean.id ) === false ) {

			ids.add( clean.id );
			list.push( clean );

		}

	} );
	return list;

}

function connectorsMeta( items ) {

	const clean = [];
	const ids = new Set();
	items.slice( 0, LIMITS.connectors ).forEach( ( raw, index ) => {

		const connector = cleanConnector( raw, index );
		if ( connector === null ) return;
		while ( ids.has( connector.id ) ) connector.id += 'x';
		ids.add( connector.id );
		clean.push( connector );

	} );
	return clean.length > 0 ? { version: CONNECTOR_VERSION, items: clean } : null;

}

// transformações ---------------------------------------------------------------------------------------------------

const _m = new THREE.Matrix4();

// matriz local equivalente sob um novo pai; null quando a transformação não é representável (cisalhamento)
function preservedLocal( object, newParentWorld ) {

	object.updateWorldMatrix( true, false );
	const local = new THREE.Matrix4().copy( newParentWorld ).invert().multiply( object.matrixWorld );
	return exactDecompose( local );

}

function exactDecompose( matrix ) {

	const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
	matrix.decompose( position, quaternion, scale );
	if ( [ scale.x, scale.y, scale.z ].some( ( v ) => Number.isFinite( v ) === false || Math.abs( v ) < 1e-9 ) ) return null;
	_m.compose( position, quaternion, scale );
	let max = 0, error = 0;
	for ( let i = 0; i < 16; i ++ ) {

		max = Math.max( max, Math.abs( matrix.elements[ i ] ) );
		error = Math.max( error, Math.abs( matrix.elements[ i ] - _m.elements[ i ] ) );

	}

	return error <= 1e-6 * Math.max( 1, max ) ? { position, quaternion, scale } : null;

}

// confere se todos os objetos podem mudar para o novo pai sem alterar a aparência
function checkPreservable( objects, newParentWorld ) {

	const problems = [];
	for ( const object of objects ) if ( preservedLocal( object, newParentWorld ) === null ) problems.push( object.name || 'objeto' );
	return problems;

}

// instantâneo da transformação local (para desfazer com fidelidade)
function snapshotLocal( object ) {

	return { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray() };

}

function applyLocal( object, local ) {

	object.position.fromArray( local.position );
	object.quaternion.fromArray( local.quaternion );
	object.scale.fromArray( local.scale );
	object.updateMatrix();

}

// identidades de uma cópia/inserção ---------------------------------------------------------------------------------

// novos UUIDs para todos os objetos da subárvore, novos IDs de conjunto e de abertura, vínculos parede → porta/janela
// apontando para os objetos DA CÓPIA. Devolve o mapa uuid antigo -> objeto novo.
// source: objeto de origem quando root é um clone (Object3D.clone() já troca os UUIDs, então o vínculo
// abertura → porta é refeito pela travessia paralela, como em relinkClone da EV-007)
function reassignIdentities( root, { definitionId, source = null } = {} ) {

	const map = new Map();
	const originals = [];
	if ( source !== null ) source.traverse( ( object ) => originals.push( object.uuid ) );
	let index = 0;
	root.traverse( ( object ) => {

		const old = source !== null && originals[ index ] !== undefined ? originals[ index ] : object.uuid;
		index ++;
		object.uuid = THREE.MathUtils.generateUUID();
		map.set( old, object );

	} );

	root.traverse( ( object ) => {

		const assembly = getAssembly( object );
		if ( assembly !== null ) setMeta( object, { assembly: Object.assign( {}, assembly, { id: newId() }, definitionId !== undefined && object === root ? { definitionId } : {} ) } );

		const openings = getOpenings( object );
		if ( openings.length === 0 ) return;
		const relinked = openings.map( ( opening ) => {

			const fixture = map.get( opening.fixtureUuid );
			const id = newOpeningId();
			if ( fixture !== undefined ) setMeta( fixture, { hosted: Object.assign( {}, getMeta( fixture ).hosted, { openingId: id } ) } );
			return Object.assign( {}, opening, { id, fixtureUuid: fixture !== undefined ? fixture.uuid : null } );

		} ).filter( ( opening ) => opening.fixtureUuid !== null );
		setOpenings( object, relinked );

	} );

	return map;

}

// complexidade (vértices) de uma subárvore — protege repetições e cópias de modelos pesados
function vertexCount( object ) {

	let count = 0;
	const seen = new Set();
	object.traverse( ( child ) => {

		if ( child.isMesh && child.geometry && child.geometry.attributes.position && seen.has( child.geometry ) === false ) {

			seen.add( child.geometry );
			count += child.geometry.attributes.position.count;

		}

	} );
	return count;

}

function totalVertices( object ) {

	let count = 0;
	object.traverse( ( child ) => {

		if ( child.isMesh && child.geometry && child.geometry.attributes.position ) count += child.geometry.attributes.position.count;

	} );
	return count;

}

export {
	ASSEMBLY_VERSION,
	DEFINITION_FORMAT,
	DEFINITION_VERSION,
	CATEGORIES as ASSEMBLY_CATEGORIES,
	LIMITS as ASSEMBLY_LIMITS,
	CONNECTOR_KINDS,
	newId,
	cleanText,
	categoryName,
	getAssembly,
	isAssembly,
	createAssemblyMeta,
	assemblyAncestors,
	assemblyUnits,
	cleanConnector,
	getConnectors,
	connectorsMeta,
	preservedLocal,
	exactDecompose,
	checkPreservable,
	snapshotLocal,
	applyLocal,
	reassignIdentities,
	vertexCount,
	totalVertices
};
