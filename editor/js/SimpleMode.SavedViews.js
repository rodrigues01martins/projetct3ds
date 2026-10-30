// EV-008 — Sistema de Visualização, Câmeras e Apresentação de Projetos 3D
//
// "Minhas vistas": definições de enquadramento guardadas no próprio projeto (dados simples, serializáveis):
//   editor.scene.userData.project3ds.savedViews = [ {
//     id, name, order, version,
//     projection: 'perspective' | 'orthographic',
//     position: [x, y, z], quaternion: [x, y, z, w], target: [x, y, z],
//     fov (perspectiva) | frustumHeight + zoom (ortográfica),
//     preset: id da vista rápida de origem ou null
//   } ]
// Não são objetos Camera: nenhuma câmera é criada na cena e nenhum UUID de câmera é usado para recuperá-las.

import * as THREE from 'three';

const VIEW_VERSION = 1;
const LIMITS = { count: 50, name: 60 };
const PRESETS = [ 'perspective', 'top', 'front', 'back', 'right', 'left' ];

function finiteArray( value, length ) {

	return Array.isArray( value ) && value.length === length && value.every( ( item ) => typeof item === 'number' && Number.isFinite( item ) );

}

function cleanName( value, fallback ) {

	const text = typeof value === 'string' ? value.replace( /\s+/g, ' ' ).trim().slice( 0, LIMITS.name ) : '';
	return text !== '' ? text : fallback;

}

// valida e normaliza uma vista vinda do arquivo (dados inválidos são descartados, nunca aplicados)
function sanitizeView( view, index = 0 ) {

	if ( view === null || typeof view !== 'object' ) return null;
	if ( typeof view.id !== 'string' || view.id === '' || view.id.length > 64 ) return null;
	if ( view.projection !== 'perspective' && view.projection !== 'orthographic' ) return null;
	if ( finiteArray( view.position, 3 ) === false || finiteArray( view.quaternion, 4 ) === false || finiteArray( view.target, 3 ) === false ) return null;

	const quaternion = new THREE.Quaternion().fromArray( view.quaternion );
	if ( quaternion.length() < 1e-6 ) return null;
	quaternion.normalize();

	const clean = {
		id: view.id,
		name: cleanName( view.name, 'Vista ' + ( index + 1 ) ),
		order: index,
		version: VIEW_VERSION,
		projection: view.projection,
		position: view.position.slice(),
		quaternion: quaternion.toArray(),
		target: view.target.slice(),
		preset: PRESETS.includes( view.preset ) ? view.preset : null
	};

	if ( view.projection === 'perspective' ) {

		clean.fov = Number.isFinite( view.fov ) && view.fov >= 5 && view.fov <= 120 ? view.fov : 50;

	} else {

		if ( ! ( Number.isFinite( view.frustumHeight ) && view.frustumHeight > 0 && view.frustumHeight < 1e5 ) ) return null;
		clean.frustumHeight = view.frustumHeight;
		clean.zoom = Number.isFinite( view.zoom ) && view.zoom > 0 ? view.zoom : 1;

	}

	return clean;

}

// vistas do projeto, na ordem de apresentação (cópias)
function getSavedViews( scene ) {

	const meta = scene.userData.project3ds;
	const list = meta !== undefined && meta !== null && Array.isArray( meta.savedViews ) ? meta.savedViews : [];

	return list
		.map( ( view, index ) => ( { view, index } ) )
		.sort( ( a, b ) => ( Number.isFinite( a.view?.order ) ? a.view.order : a.index ) - ( Number.isFinite( b.view?.order ) ? b.view.order : b.index ) )
		.map( ( item, index ) => sanitizeView( item.view, index ) )
		.filter( ( view ) => view !== null )
		.map( ( view, index ) => Object.assign( view, { order: index } ) );

}

// grava a lista preservando os demais metadados do projeto; lista vazia remove a chave
function setSavedViews( scene, views ) {

	const meta = Object.assign( {}, scene.userData.project3ds );

	if ( views.length > 0 ) meta.savedViews = views.map( ( view, index ) => Object.assign( {}, view, { order: index } ) );
	else delete meta.savedViews;

	if ( Object.keys( meta ).length > 0 ) scene.userData.project3ds = meta;
	else delete scene.userData.project3ds;

}

function createView( state, name ) {

	return sanitizeView( {
		id: 'view-' + THREE.MathUtils.generateUUID().slice( 0, 8 ),
		name,
		projection: state.projection,
		position: state.position,
		quaternion: state.quaternion,
		target: state.target,
		fov: state.fov,
		frustumHeight: state.frustumHeight,
		zoom: state.zoom,
		preset: state.preset
	} );

}

function suggestName( views ) {

	let index = views.length + 1;
	while ( views.some( ( view ) => view.name === 'Vista ' + index ) ) index ++;
	return 'Vista ' + index;

}

export { VIEW_VERSION, LIMITS as SAVED_VIEW_LIMITS, sanitizeView, getSavedViews, setSavedViews, createView, suggestName, cleanName };
