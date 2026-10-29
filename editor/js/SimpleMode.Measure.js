// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
//
// Régua de medição 3D. Os elementos visuais ficam em `editor.sceneHelpers` (desenhados pelo viewport,
// mas nunca serializados no projeto) e o rótulo é um elemento HTML reposicionado a cada render.
// Enquanto a régua está ativa, os cliques no viewport não selecionam nem transformam objetos.

import * as THREE from 'three';

const DRAG_THRESHOLD = 4; // px: acima disso o gesto é navegação (girar/deslocar a vista), não um clique

function Measure( editor, units, getSnap ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef
	const editorSignals = editor.signals;

	const changed = new Signal();

	const viewport = document.getElementById( 'viewport' );

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const groundPlane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 );

	let active = false;
	let points = []; // 0, 1 ou 2 pontos (THREE.Vector3)
	let down = null;

	// visual temporário

	const group = new THREE.Group();
	group.name = 'Medição (temporária)';

	const lineGeometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3(), new THREE.Vector3() ] );
	const line = new THREE.Line( lineGeometry, new THREE.LineBasicMaterial( { color: 0xff9f0a, depthTest: false, transparent: true } ) );
	line.renderOrder = 999;
	line.frustumCulled = false;
	group.add( line );

	const pointsGeometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3(), new THREE.Vector3() ] );
	const markers = new THREE.Points( pointsGeometry, new THREE.PointsMaterial( { color: 0xff9f0a, size: 9, sizeAttenuation: false, depthTest: false, transparent: true } ) );
	markers.renderOrder = 1000;
	markers.frustumCulled = false;
	group.add( markers );

	group.visible = false;

	// rótulo HTML posicionado sobre o viewport

	const label = document.createElement( 'div' );
	label.className = 'SimpleMeasureLabel';
	label.hidden = true;
	label.setAttribute( 'aria-live', 'polite' );

	// estado

	function getDistance() {

		return points.length === 2 ? points[ 0 ].distanceTo( points[ 1 ] ) : null;

	}

	function updateVisual() {

		const hasPoints = points.length > 0;

		if ( hasPoints ) {

			const a = points[ 0 ];
			const b = points[ 1 ] || points[ 0 ];

			lineGeometry.setFromPoints( [ a, b ] );
			pointsGeometry.setFromPoints( points.length === 2 ? [ a, b ] : [ a ] );
			line.visible = points.length === 2;

		}

		group.visible = hasPoints;

		if ( hasPoints && group.parent === null ) editor.sceneHelpers.add( group );
		if ( hasPoints === false && group.parent !== null ) group.parent.remove( group );

		updateLabel();
		editorSignals.sceneHelpersChanged.dispatch();
		changed.dispatch();

	}

	function updateLabel() {

		const distance = getDistance();

		if ( distance === null || viewport === null ) {

			label.hidden = true;
			return;

		}

		label.textContent = units.format( distance );

		// projeta o ponto médio na tela (acompanha a câmera a cada render)
		const middle = points[ 0 ].clone().add( points[ 1 ] ).multiplyScalar( 0.5 ).project( editor.viewportCamera );
		const visible = middle.z > - 1 && middle.z < 1;

		label.hidden = ! visible;
		label.style.left = ( ( middle.x + 1 ) / 2 * viewport.clientWidth ) + 'px';
		label.style.top = ( ( 1 - middle.y ) / 2 * viewport.clientHeight ) + 'px';

	}

	editorSignals.sceneRendered.add( function () {

		if ( points.length === 2 ) updateLabel();

	} );

	units.changed.add( updateLabel );

	// interação

	function getPoint( event ) {

		const rect = viewport.getBoundingClientRect();

		pointer.set(
			( ( event.clientX - rect.left ) / rect.width ) * 2 - 1,
			- ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1
		);

		raycaster.setFromCamera( pointer, editor.viewportCamera );

		// 1) superfícies de objetos visíveis da cena
		const objects = [];
		editor.scene.traverseVisible( ( child ) => {

			if ( child.isMesh === true ) objects.push( child );

		} );

		const hit = raycaster.intersectObjects( objects, false )[ 0 ];

		if ( hit !== undefined ) return { point: hit.point.clone(), surface: true };

		// 2) plano de referência (chão, y = 0), com encaixe na precisão de movimento escolhida
		const point = raycaster.ray.intersectPlane( groundPlane, new THREE.Vector3() );

		if ( point === null ) return null;

		const snap = getSnap();

		if ( snap !== null ) {

			point.x = Math.round( point.x / snap ) * snap;
			point.z = Math.round( point.z / snap ) * snap;

		}

		return { point, surface: false };

	}

	// captura: impede que o viewport trate o clique como seleção (mousedown/touchstart/dblclick)
	// pointerdown continua livre para que seja possível girar a vista durante a medição

	function block( event ) {

		if ( active === false ) return;

		event.stopPropagation();

	}

	function onPointerDown( event ) {

		if ( active === false || event.button !== 0 || event.isPrimary === false ) return;

		down = { x: event.clientX, y: event.clientY };

	}

	function onPointerUp( event ) {

		if ( active === false || down === null || event.isPrimary === false ) return;

		const moved = Math.hypot( event.clientX - down.x, event.clientY - down.y );
		down = null;

		if ( moved > DRAG_THRESHOLD ) return;
		if ( event.target.tagName !== 'CANVAS' ) return;

		const result = getPoint( event );

		if ( result === null ) return;

		if ( points.length === 2 ) points = [];

		points.push( result.point );
		updateVisual();

	}

	if ( viewport !== null ) {

		viewport.addEventListener( 'mousedown', block, true );
		viewport.addEventListener( 'touchstart', block, true );
		viewport.addEventListener( 'dblclick', block, true );
		viewport.addEventListener( 'pointerdown', onPointerDown, true );
		viewport.addEventListener( 'pointerup', onPointerUp, true );

	}

	document.addEventListener( 'keydown', function ( event ) {

		if ( active && event.key === 'Escape' ) {

			event.preventDefault();
			deactivate();

		}

	} );

	// API

	function activate() {

		if ( active ) return;

		active = true;
		viewport.classList.add( 'measuring' );
		changed.dispatch();

	}

	function deactivate() {

		if ( active === false && points.length === 0 ) return;

		active = false;
		down = null;
		viewport.classList.remove( 'measuring' );
		clear();

	}

	function clear() {

		points = [];
		updateVisual();

	}

	// projeto novo ou reaberto: encerra a ferramenta e remove os elementos temporários
	editorSignals.editorCleared.add( deactivate );

	return {
		changed,
		label,
		activate,
		deactivate,
		clear,
		isActive: () => active,
		getPointCount: () => points.length,
		getDistance,
		getPoints: () => points.map( ( point ) => point.clone() )
	};

}

export { Measure };
