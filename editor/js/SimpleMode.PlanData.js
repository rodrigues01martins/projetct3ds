// EV-009 — Sistema de Plantas Baixas, Cotas e Documentação Técnica
//
// Configuração da planta guardada no projeto (dados simples, serializáveis):
//   editor.scene.userData.project3ds.plan = {
//     version, floorUuid, cutHeight, scale ('auto' | denominador), paper ('A4' | 'A3'), orientation,
//     show: { furniture, rooms, wallDims, overallDims, openingDims, scaleBar, north },
//     title, author, notes, sheet,
//     dimensions: [ { id, a: [x, z], b: [x, z], offset } ],   // cotas do usuário, em metros (mundo)
//     rooms: { [uuid do piso]: nome do ambiente }
//   }
// Alterações passam por SetPlanCommand (reversíveis, no histórico); abrir/fechar a planta e navegar nela não.

import * as THREE from 'three';

const PLAN_VERSION = 1;
const SCALES = [ 20, 25, 50, 75, 100, 125, 200, 250, 500 ];
const PAPERS = { A4: [ 297, 210 ], A3: [ 420, 297 ] }; // mm, paisagem
const LIMITS = { cutHeight: [ 0.1, 5 ], text: 80, notes: 240, dimensions: 200, offset: 20 };

const DEFAULT_SHOW = { furniture: true, rooms: true, wallDims: true, overallDims: true, openingDims: false, scaleBar: true, north: true };

function defaultPlan() {

	return {
		version: PLAN_VERSION,
		floorUuid: null,
		cutHeight: 1.2,
		scale: 'auto',
		paper: 'A4',
		orientation: 'landscape',
		show: Object.assign( {}, DEFAULT_SHOW ),
		title: 'Planta baixa',
		author: '',
		notes: '',
		sheet: '01',
		dimensions: [],
		rooms: {}
	};

}

const finite = ( value ) => typeof value === 'number' && Number.isFinite( value );
const point = ( value ) => Array.isArray( value ) && value.length === 2 && value.every( finite );
const text = ( value, max, fallback = '' ) => ( typeof value === 'string' ? value.replace( /\s+/g, ' ' ).trim().slice( 0, max ) : fallback );

function sanitizeDimension( dimension ) {

	if ( dimension === null || typeof dimension !== 'object' || point( dimension.a ) === false || point( dimension.b ) === false ) return null;
	if ( Math.hypot( dimension.b[ 0 ] - dimension.a[ 0 ], dimension.b[ 1 ] - dimension.a[ 1 ] ) < 1e-4 ) return null;

	return {
		id: typeof dimension.id === 'string' && dimension.id !== '' ? dimension.id.slice( 0, 40 ) : newDimensionId(),
		a: dimension.a.slice(),
		b: dimension.b.slice(),
		offset: finite( dimension.offset ) ? THREE.MathUtils.clamp( dimension.offset, - LIMITS.offset, LIMITS.offset ) : 0
	};

}

// dados do arquivo validados; o que for inválido volta ao padrão (nunca impede abrir o projeto)
function sanitizePlan( value ) {

	const plan = defaultPlan();
	if ( value === null || typeof value !== 'object' ) return plan;

	if ( typeof value.floorUuid === 'string' ) plan.floorUuid = value.floorUuid;
	if ( finite( value.cutHeight ) ) plan.cutHeight = THREE.MathUtils.clamp( value.cutHeight, ...LIMITS.cutHeight );
	if ( value.scale === 'auto' || SCALES.includes( value.scale ) ) plan.scale = value.scale;
	if ( PAPERS[ value.paper ] !== undefined ) plan.paper = value.paper;
	if ( value.orientation === 'portrait' || value.orientation === 'landscape' ) plan.orientation = value.orientation;

	if ( value.show !== null && typeof value.show === 'object' ) {

		for ( const key of Object.keys( DEFAULT_SHOW ) ) if ( typeof value.show[ key ] === 'boolean' ) plan.show[ key ] = value.show[ key ];

	}

	plan.title = text( value.title, LIMITS.text, plan.title ) || plan.title;
	plan.author = text( value.author, LIMITS.text );
	plan.notes = text( value.notes, LIMITS.notes );
	plan.sheet = text( value.sheet, 8, plan.sheet ) || plan.sheet;

	if ( Array.isArray( value.dimensions ) ) plan.dimensions = value.dimensions.slice( 0, LIMITS.dimensions ).map( sanitizeDimension ).filter( ( d ) => d !== null );

	if ( value.rooms !== null && typeof value.rooms === 'object' ) {

		for ( const [ uuid, name ] of Object.entries( value.rooms ) ) {

			const clean = text( name, 40 );
			if ( clean !== '' && uuid.length <= 64 ) plan.rooms[ uuid ] = clean;

		}

	}

	return plan;

}

function getPlan( scene ) {

	const meta = scene.userData.project3ds;
	return sanitizePlan( meta !== undefined && meta !== null ? meta.plan : null );

}

function hasPlan( scene ) {

	const meta = scene.userData.project3ds;
	return meta !== undefined && meta !== null && meta.plan !== undefined;

}

// grava preservando os demais metadados do projeto; null remove a configuração
function setPlan( scene, plan ) {

	const meta = Object.assign( {}, scene.userData.project3ds );

	if ( plan !== null ) meta.plan = JSON.parse( JSON.stringify( plan ) );
	else delete meta.plan;

	if ( Object.keys( meta ).length > 0 ) scene.userData.project3ds = meta;
	else delete scene.userData.project3ds;

}

function newDimensionId() {

	return 'dim-' + THREE.MathUtils.generateUUID().slice( 0, 8 );

}

export { PLAN_VERSION, SCALES, PAPERS, LIMITS as PLAN_LIMITS, defaultPlan, sanitizePlan, sanitizeDimension, getPlan, hasPlan, setPlan, newDimensionId };
