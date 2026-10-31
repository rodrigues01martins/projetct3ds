// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// Geração do pacote de visualização a partir do projeto aberto, SEM modificar a cena:
//   1. a cena é serializada (Object3D.toJSON — leitura) e cada geometria é reescrita como BufferGeometry simples
//      (o visualizador só aceita esse tipo: nenhum gerador paramétrico é necessário do outro lado);
//   2. cada objeto recebe, na CÓPIA serializada, apenas o metadado de visualização `userData.share`
//      (unidade selecionável, tipo, rótulo e dimensões) — todo o resto do userData é descartado pela sanitização;
//   3. a sanitização por lista explícita (SimpleMode.ShareData.js) produz o conteúdo final, sobre o qual o hash é
//      calculado; o manifesto informa o que foi incluído e o que ficou de fora.
//
// Unidades selecionáveis (mesmo conceito da EV-003/EV-007): o componente paramétrico ou de "Meus componentes" mais
// alto abaixo da cena; portas e janelas hospedadas (EV-007) são unidades próprias, mesmo sendo filhas da parede;
// objetos soltos diretamente na cena também. Malhas internas nunca são unidades.
//
// Registro local de compartilhamentos (store `meta` da EV-011, chave 'shares'): shareId, projeto, revisão, hash e as
// "impressões" (transformação + dimensões) de cada unidade — usadas na importação da revisão para sinalizar
// componentes alterados depois do compartilhamento. Nenhum dado é gravado na cena.

import * as THREE from 'three';

import { getMeta, getComponentData, isUserComponent } from './SimpleMode.ComponentFactory.js';
import { getDefinition } from './SimpleMode.Components.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';
import { getSavedViews, sanitizeView } from './SimpleMode.SavedViews.js';
import { renderToCanvas } from './SimpleMode.ImageExport.js';
import { sanitizeScene, sanitizeViews, buildPackage, describeReport, EXCLUDED } from './SimpleMode.ShareData.js';
import { newId } from './SimpleMode.ReviewData.js';
import { safeFileName } from './SimpleMode.ProjectData.js';

const SHARES_KEY = 'shares';
const SHARES_KEEP = 100;
const PREVIEW = { width: 640, height: 360, quality: 0.8 };

function isHosted( object ) {

	const meta = getMeta( object );
	return meta !== null && meta.hosted !== null && typeof meta.hosted === 'object';

}

function labelOf( object ) {

	const data = getComponentData( object );
	if ( data !== null ) {

		const definition = getDefinition( data.id );
		return definition !== undefined && definition !== null ? definition.name : 'Componente';

	}

	if ( isUserComponent( object ) ) return 'Componente personalizado';
	if ( object.isMesh ) return 'Objeto';
	return 'Grupo';

}

// dimensões no referencial do próprio objeto (largura × altura × profundidade), com a escala mundial aplicada
const _inverse = new THREE.Matrix4(), _matrix = new THREE.Matrix4(), _box = new THREE.Box3(), _part = new THREE.Box3(), _scale = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3();

function localSize( object ) {

	object.updateWorldMatrix( true, true );
	_inverse.copy( object.matrixWorld ).invert();
	_box.makeEmpty();

	object.traverse( ( child ) => {

		if ( child.isMesh !== true || child.geometry === undefined ) return;
		if ( child.geometry.boundingBox === null ) child.geometry.computeBoundingBox();
		_matrix.multiplyMatrices( _inverse, child.matrixWorld );
		_part.copy( child.geometry.boundingBox ).applyMatrix4( _matrix );
		_box.union( _part );

	} );

	if ( _box.isEmpty() ) return null;
	object.matrixWorld.decompose( _p, _q, _scale );
	const size = _box.getSize( new THREE.Vector3() );
	return [ size.x * Math.abs( _scale.x ), size.y * Math.abs( _scale.y ), size.z * Math.abs( _scale.z ) ].map( ( v ) => Math.round( v * 1e6 ) / 1e6 );

}

// unidades selecionáveis da cena: [ { object, kind, component, label, hosted } ] (leitura apenas)
function collectUnits( scene ) {

	const units = [];

	( function walk( object, insideUnit ) {

		for ( const child of object.children ) {

			if ( isLightingGroup( child ) || child.isLight || child.isCamera ) continue;

			let unit = null;
			const data = getComponentData( child );
			if ( isHosted( child ) && data !== null ) unit = { kind: 'opening', hosted: true };
			else if ( insideUnit === false && ( data !== null || isUserComponent( child ) ) ) unit = { kind: 'component' };
			else if ( insideUnit === false && object === scene && ( child.isMesh || child.isGroup || child.type === 'Object3D' ) ) unit = { kind: 'object' };

			if ( unit !== null ) units.push( Object.assign( unit, { object: child, component: data !== null ? data.id : null, label: labelOf( child ) } ) );
			walk( child, insideUnit || ( unit !== null && unit.kind !== 'opening' ) );

		}

	} )( scene, false );

	return units;

}

// impressão de uma unidade: transformação mundial e dimensões, arredondadas (estável entre salvamentos)
function fingerprint( object ) {

	object.updateWorldMatrix( true, false );
	const values = object.matrixWorld.elements.map( ( v ) => Math.round( v * 1e4 ) / 1e4 ).concat( localSize( object ) || [] );
	let h1 = 0x811c9dc5, h2 = 0x01000193;
	const textValue = values.join( ',' );
	for ( let i = 0; i < textValue.length; i ++ ) {

		const c = textValue.charCodeAt( i );
		h1 = Math.imul( h1 ^ c, 16777619 ) >>> 0;
		h2 = Math.imul( h2 ^ ( c + 7 ), 2246822519 ) >>> 0;

	}

	return h1.toString( 16 ).padStart( 8, '0' ) + h2.toString( 16 ).padStart( 8, '0' );

}

function unitFingerprints( scene ) {

	const map = {};
	for ( const unit of collectUnits( scene ) ) map[ unit.object.uuid ] = fingerprint( unit.object );
	return map;

}

// geometria serializada como BufferGeometry simples (atributos desintercalados, sem morphs), mantendo o UUID
function plainGeometryJSON( geometry ) {

	const plain = new THREE.BufferGeometry();
	for ( const name of Object.keys( geometry.attributes ) ) {

		const attribute = geometry.attributes[ name ];
		plain.setAttribute( name, attribute.isInterleavedBufferAttribute ? attribute.clone() : attribute );

	}

	if ( geometry.index !== null ) plain.setIndex( geometry.index );
	for ( const group of geometry.groups ) plain.addGroup( group.start, group.count, group.materialIndex );
	if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
	if ( geometry.boundingSphere !== null ) plain.boundingSphere = geometry.boundingSphere.clone();
	plain.uuid = geometry.uuid;

	const json = plain.toJSON();
	delete json.metadata;
	return json;

}

function displaySettings( editor ) {

	const config = editor.config;
	const meta = editor.scene.userData.project3ds;
	return {
		units: meta && [ 'm', 'cm', 'mm' ].includes( meta.units ) ? meta.units : 'm',
		toneMapping: Number( config.getKey( 'project/renderer/toneMapping' ) ) || 0,
		exposure: Number( config.getKey( 'project/renderer/toneMappingExposure' ) ) || 1,
		shadows: config.getKey( 'project/renderer/shadows' ) !== false,
		environment: typeof editor.environmentType === 'string' ? editor.environmentType : 'Default'
	};

}

function capturePreview( editor ) {

	try {

		if ( editor.viewportRenderer === undefined || editor.scene.children.length === 0 ) return null;
		const canvas = renderToCanvas( editor, editor.viewportCamera, PREVIEW.width, PREVIEW.height );
		const url = canvas.toDataURL( 'image/jpeg', PREVIEW.quality );
		canvas.width = 0;
		canvas.height = 0;
		if ( url.startsWith( 'data:image/jpeg;base64,' ) === false ) return null;
		const binary = atob( url.slice( 23 ) );
		const bytes = new Uint8Array( binary.length );
		for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );
		return bytes;

	} catch ( error ) {

		return null; // a capa é opcional

	}

}

// prepara o snapshot (nada é gravado nem baixado aqui). options: { materials, lighting, views, names, dimensions }
function prepareShare( editor, { project, title, description = '', versionLabel = '', options } ) {

	const scene = editor.scene;
	const raw = scene.toJSON(); // serialização: não altera a cena

	const liveGeometries = new Map();
	const liveObjects = new Map();
	scene.traverse( ( object ) => {

		liveObjects.set( object.uuid, object );
		if ( object.geometry !== undefined && object.geometry.isBufferGeometry ) liveGeometries.set( object.geometry.uuid, object.geometry );

	} );

	raw.geometries = ( raw.geometries || [] ).map( ( json ) => {

		const live = liveGeometries.get( json.uuid );
		return live !== undefined ? plainGeometryJSON( live ) : json;

	} );

	const units = new Map( collectUnits( scene ).map( ( unit ) => [ unit.object.uuid, unit ] ) );

	( function annotate( node ) {

		const unit = units.get( node.uuid );
		const live = liveObjects.get( node.uuid );
		let share = null;

		if ( unit !== undefined ) {

			share = { unit: true, kind: unit.kind, label: unit.label };
			if ( unit.component !== null ) share.component = unit.component;
			if ( unit.hosted ) share.hosted = true;
			const dims = localSize( unit.object );
			if ( dims !== null ) share.dims = dims;

		} else if ( live !== undefined && isLightingGroup( live ) ) {

			share = { kind: 'lighting' };

		}

		node.userData = share !== null ? { share } : {};
		for ( const child of node.children || [] ) annotate( child );

	} )( raw.object );

	const { scene: shared, report, stats } = sanitizeScene( raw, options );
	const sceneText = JSON.stringify( shared );

	const views = options.views ? sanitizeViews( { views: getSavedViews( scene ) }, sanitizeView, report ) : [];
	const viewsText = JSON.stringify( { views } );

	const manifest = {
		shareId: newId(),
		source: { projectId: project !== null ? project.id : null, revision: project !== null ? project.revision : null, versionLabel },
		title,
		description,
		createdAt: new Date().toISOString(),
		app: 'Project3DS',
		contents: Object.assign( { geometry: true }, options ),
		excluded: EXCLUDED.slice(),
		display: displaySettings( editor ),
		stats: Object.assign( {}, stats, { views: views.length } )
	};

	return {
		manifest,
		sceneText,
		viewsText,
		preview: capturePreview( editor ),
		report,
		removed: describeReport( report ),
		stats: manifest.stats,
		fingerprints: unitFingerprints( scene ),
		bytes: sceneText.length + viewsText.length
	};

}

async function exportShare( prepared ) {

	const { bytes, manifest } = await buildPackage( prepared );
	return { blob: new Blob( [ bytes ], { type: 'application/zip' } ), manifest, size: bytes.length, fileName: safeFileName( manifest.title, '.p3ds-review.zip' ) };

}

async function registerShare( storage, manifest, fingerprints ) {

	const list = ( await storage.getMeta( SHARES_KEY ) ) || [];
	const entry = {
		shareId: manifest.shareId,
		projectId: manifest.source.projectId,
		revision: manifest.source.revision,
		versionLabel: manifest.source.versionLabel,
		contentHash: manifest.contentHash,
		createdAt: manifest.createdAt,
		title: manifest.title,
		contents: manifest.contents,
		fingerprints
	};

	const next = list.filter( ( item ) => item && item.shareId !== entry.shareId ).concat( entry ).slice( - SHARES_KEEP );
	await storage.setMeta( SHARES_KEY, next );
	return entry;

}

async function findShare( storage, shareId ) {

	const list = ( await storage.getMeta( SHARES_KEY ) ) || [];
	return list.find( ( item ) => item && item.shareId === shareId ) || null;

}

async function listShares( storage, projectId ) {

	const list = ( await storage.getMeta( SHARES_KEY ) ) || [];
	return list.filter( ( item ) => item && item.projectId === projectId );

}

export { prepareShare, exportShare, registerShare, findShare, listShares, collectUnits, unitFingerprints, fingerprint, localSize, labelOf };
