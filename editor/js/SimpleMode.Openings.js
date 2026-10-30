// EV-007 — Ferramentas Arquitetônicas Inteligentes
//
// Modelo de dados e vínculos das aberturas (portas e janelas hospedadas em paredes).
//
// Fonte única de verdade: a PAREDE guarda as aberturas (dados simples, serializáveis):
//   wall.userData.project3ds.openings = [ { id, type: 'door'|'window', centerX, bottomY, width, height, fixtureUuid } ]
//   - centerX: centro do vão ao longo do eixo X local da parede (0 = centro da parede), em metros;
//   - bottomY: base do vão a partir da base da parede (porta = 0; janela = altura do peitoril).
//
// O componente da porta/janela (EV-003) é FILHO da parede (acompanha movimento e rotação) e leva:
//   fixture.userData.project3ds.hosted = { openingId, type }
// Nenhuma referência a objetos Three.js é guardada em userData; o vínculo é parede-pai + identificadores.
//
// Convenções do componente hospedado:
//   - largura/altura do componente = largura/altura do vão;
//   - janela hospedada usa sill = 0 (a geometria começa na base do grupo) e o GRUPO fica em y = bottomY,
//     evitando aplicar o peitoril duas vezes; janelas independentes da biblioteca continuam com sill;
//   - profundidade do batente (porta) e da moldura (janela) = espessura da parede + 2 cm (sobressai 1 cm de cada lado).

import * as THREE from 'three';

import { getDefinition, getDefaultParameters } from './SimpleMode.Components.js';
import { getMeta, setMeta, getComponentData, createComponent, regenerateComponent, editorHooks } from './SimpleMode.ComponentFactory.js';

const OPENING_TYPES = {
	door: { component: 'door', defaults: { width: 0.9, height: 2.1, bottomY: 0 } },
	window: { component: 'window', defaults: { width: 1.2, height: 1, bottomY: 1 } }
};

const FRAME_EXTRA = 0.02;

// leitura e escrita ---------------------------------------------------------------------------------

function isWall( object ) {

	const data = getComponentData( object );
	return data !== null && data.id === 'wall';

}

function getWallParameters( wall ) {

	return getComponentData( wall ).parameters;

}

function getOpenings( wall ) {

	const meta = getMeta( wall );
	const list = meta !== null && Array.isArray( meta.openings ) ? meta.openings : [];
	return list.map( ( opening ) => Object.assign( {}, opening ) );

}

function setOpenings( wall, openings ) {

	const meta = Object.assign( {}, getMeta( wall ) || {} );

	if ( openings.length > 0 ) meta.openings = openings.map( ( opening ) => Object.assign( {}, opening ) );
	else delete meta.openings; // parede volta a ser exatamente a da EV-003

	wall.userData.project3ds = meta;

}

function getHosted( object ) {

	const meta = getMeta( object );
	const hosted = meta !== null ? meta.hosted : undefined;
	return hosted !== null && typeof hosted === 'object' && typeof hosted.openingId === 'string' ? hosted : null;

}

function isHostedFixture( object ) {

	return object !== null && object !== undefined && getHosted( object ) !== null && isWall( object.parent );

}

// porta/janela hospedada mais próxima subindo a hierarquia (prioridade na seleção do Modo Simples)
function findHostedFixture( object, scene ) {

	let current = object;

	while ( current !== null && current !== undefined && current !== scene ) {

		if ( isHostedFixture( current ) ) return current;
		current = current.parent;

	}

	return null;

}

function getOpeningOf( fixture ) {

	if ( isHostedFixture( fixture ) === false ) return null;

	const hosted = getHosted( fixture );
	return getOpenings( fixture.parent ).find( ( opening ) => opening.id === hosted.openingId ) || null;

}

function findFixture( wall, opening ) {

	return wall.children.find( ( child ) => child.uuid === opening.fixtureUuid && getHosted( child ) !== null && getHosted( child ).openingId === opening.id ) || null;

}

// aberturas cujo componente não está mais na parede (ex.: removido no Modo Avançado)
function getOrphanOpenings( wall ) {

	return getOpenings( wall ).filter( ( opening ) => findFixture( wall, opening ) === null );

}

function newOpeningId() {

	return 'opening-' + THREE.MathUtils.generateUUID().slice( 0, 8 );

}

// compatibilidade da parede ---------------------------------------------------------------------------

const _position = new THREE.Vector3(), _quaternion = new THREE.Quaternion(), _scale = new THREE.Vector3(), _up = new THREE.Vector3();

// Paredes suportadas: retas (componente wall), verticais (só rotação em Y) e com escala 1
function checkWallCompatibility( wall ) {

	if ( isWall( wall ) === false ) return 'notWall';

	wall.updateWorldMatrix( true, false );
	wall.matrixWorld.decompose( _position, _quaternion, _scale );

	if ( [ _scale.x, _scale.y, _scale.z ].some( ( value ) => Math.abs( value - 1 ) > 1e-6 ) ) return 'scaled';

	_up.set( 0, 1, 0 ).applyQuaternion( _quaternion );
	if ( _up.y < 0.9999 ) return 'tilted';

	return null;

}

// parâmetros do componente hospedado -----------------------------------------------------------------

function hostedParameters( type, opening, wallThickness, current ) {

	const definition = getDefinition( OPENING_TYPES[ type ].component );
	const parameters = Object.assign( getDefaultParameters( definition ), current || {}, { width: opening.width, height: opening.height } );
	const depth = Math.round( Math.min( 0.5, Math.max( 0.02, wallThickness + FRAME_EXTRA ) ) * 1e6 ) / 1e6; // sem ruído de ponto flutuante

	if ( type === 'door' ) {

		parameters.frameDepth = depth;
		parameters.leafThickness = Math.min( parameters.leafThickness, depth );

	} else {

		parameters.depth = depth;
		parameters.sill = 0; // o peitoril é a posição do grupo (opening.bottomY), não um deslocamento interno

	}

	return parameters;

}

function placeFixture( fixture, opening ) {

	fixture.position.set( opening.centerX, opening.bottomY, 0 );
	fixture.rotation.set( 0, 0, 0 );
	fixture.scale.set( 1, 1, 1 );
	fixture.updateMatrixWorld( true );

}

// transformação diferente da esperada (ex.: movida livremente no Modo Avançado)
function isFixtureMisplaced( fixture ) {

	const opening = getOpeningOf( fixture );
	if ( opening === null ) return false;

	const expected = new THREE.Vector3( opening.centerX, opening.bottomY, 0 );
	return fixture.position.distanceTo( expected ) > 1e-6 ||
		Math.abs( fixture.rotation.x ) + Math.abs( fixture.rotation.y ) + Math.abs( fixture.rotation.z ) > 1e-6 ||
		fixture.scale.distanceTo( new THREE.Vector3( 1, 1, 1 ) ) > 1e-6;

}

// Cria o componente (porta/janela) de uma abertura pela fábrica da EV-003 — fora da cena
function createFixture( type, opening, wallThickness, { uuid, name, parameters } = {} ) {

	const fixture = createComponent( OPENING_TYPES[ type ].component, hostedParameters( type, opening, wallThickness, parameters ) );

	if ( uuid !== undefined ) fixture.uuid = uuid;
	if ( name !== undefined ) fixture.name = name;

	setMeta( fixture, { hosted: { openingId: opening.id, type } } );
	placeFixture( fixture, opening );

	return fixture;

}

// sincronização -----------------------------------------------------------------------------------------

function sameParameters( a, b ) {

	return Object.keys( b ).every( ( key ) => a[ key ] === b[ key ] );

}

// Mantém cada componente hospedado coerente com sua abertura e com a espessura da parede
function syncHostedFixtures( editor, wall ) {

	if ( isWall( wall ) === false ) return;

	const thickness = getWallParameters( wall ).thickness;

	for ( const opening of getOpenings( wall ) ) {

		const fixture = findFixture( wall, opening );
		if ( fixture === null ) continue;

		const data = getComponentData( fixture );
		const definition = data !== null ? getDefinition( data.id ) : null;
		if ( definition === null ) continue;

		const parameters = hostedParameters( opening.type, opening, thickness, data.parameters );

		if ( sameParameters( data.parameters, parameters ) === false ) regenerateComponent( fixture, definition, parameters, editorHooks( editor ) );

		placeFixture( fixture, opening );

	}

}

// Reconstrói a geometria da parede a partir dos parâmetros e aberturas atuais (comandos de abertura)
function rebuildWall( editor, wall ) {

	const data = getComponentData( wall );
	regenerateComponent( wall, getDefinition( 'wall' ), Object.assign( {}, data.parameters ), editorHooks( editor ) );
	syncHostedFixtures( editor, wall );
	wall.updateMatrixWorld( true );

	if ( editor.selected === wall ) editor.signals.geometryChanged.dispatch( wall );
	editor.signals.objectChanged.dispatch( wall );
	if ( editor.selected !== null && editor.selected.parent === wall ) editor.signals.objectChanged.dispatch( editor.selected ); // porta/janela selecionada
	editor.signals.sceneGraphChanged.dispatch();

}

// Duplicação: a cópia ganha identificadores próprios e os vínculos passam a apontar para os próprios filhos.
// original e copy têm a mesma estrutura (SkeletonUtils.clone / Object3D.clone).
function relinkClone( original, copy ) {

	const sources = [], targets = [];
	original.traverse( ( object ) => sources.push( object ) );
	copy.traverse( ( object ) => targets.push( object ) );

	const map = new Map( sources.map( ( object, index ) => [ object.uuid, targets[ index ] ] ) );

	copy.traverse( function ( wall ) {

		if ( isWall( wall ) === false ) return;

		const openings = getOpenings( wall );
		if ( openings.length === 0 ) return;

		const relinked = openings.map( ( opening ) => {

			const fixture = map.get( opening.fixtureUuid );
			const id = newOpeningId();

			if ( fixture !== undefined ) setMeta( fixture, { hosted: { openingId: id, type: opening.type } } );

			return Object.assign( {}, opening, { id, fixtureUuid: fixture !== undefined ? fixture.uuid : null } );

		} );

		setOpenings( wall, relinked.filter( ( opening ) => opening.fixtureUuid !== null ) );

	} );

}

function containsOpenings( object ) {

	let found = false;
	object.traverse( ( child ) => {

		if ( isWall( child ) && getOpenings( child ).length > 0 ) found = true;

	} );
	return found;

}

export {
	OPENING_TYPES,
	isWall,
	getWallParameters,
	getOpenings,
	setOpenings,
	getHosted,
	isHostedFixture,
	findHostedFixture,
	getOpeningOf,
	findFixture,
	getOrphanOpenings,
	newOpeningId,
	checkWallCompatibility,
	hostedParameters,
	placeFixture,
	isFixtureMisplaced,
	createFixture,
	syncHostedFixtures,
	rebuildWall,
	relinkClone,
	containsOpenings
};
