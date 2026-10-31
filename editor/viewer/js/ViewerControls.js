// EV-012 — Visualizador Project3DS: navegação (somente câmera; nada aqui altera o modelo).
//
// Órbita, zoom e deslocamento (OrbitControls: mouse, roda e toque), enquadrar o projeto, enquadrar o componente
// selecionado, voltar ao enquadramento inicial, vistas salvas do pacote (transição suave) e exploração em primeira
// pessoa (teclado W A S D / setas para andar, arrastar para olhar, Esc para sair), na altura dos olhos.

import * as THREE from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 1.6; // m/s
const TRANSITION_MS = 450;

function ViewerControls( camera, domElement, { onChange } ) {

	const orbit = new OrbitControls( camera, domElement );
	orbit.enableDamping = false;
	orbit.screenSpacePanning = true;
	orbit.addEventListener( 'change', () => onChange() );

	const state = { box: new THREE.Box3(), initial: null, animation: 0, walking: false, keys: new Set(), last: 0, look: null, floor: 0, onWalkChange: null };

	function setBounds( box ) {

		state.box.copy( box );
		state.floor = box.isEmpty() ? 0 : box.min.y;
		const size = box.isEmpty() ? 10 : box.getSize( new THREE.Vector3() ).length();
		camera.near = Math.max( size / 2000, 0.01 );
		camera.far = Math.max( size * 20, 200 );
		camera.updateProjectionMatrix();
		orbit.maxDistance = Math.max( size * 6, 50 );

	}

	function frameFor( box, direction = new THREE.Vector3( 1, 0.75, 1.2 ).normalize() ) {

		const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter( new THREE.Vector3() );
		const radius = box.isEmpty() ? 2 : Math.max( box.getSize( new THREE.Vector3() ).length() / 2, 0.25 );
		const fov = THREE.MathUtils.degToRad( camera.fov );
		const distance = radius / Math.sin( Math.min( fov, fov * camera.aspect ) / 2 ) * 1.05;
		return { position: center.clone().addScaledVector( direction, distance ), target: center, fov: camera.fov };

	}

	function animateTo( { position, target, fov }, duration = TRANSITION_MS ) {

		cancelAnimationFrame( state.animation );
		if ( state.walking ) setWalking( false );
		const from = { position: camera.position.clone(), target: orbit.target.clone(), fov: camera.fov };
		const to = { position: new THREE.Vector3().fromArray( position.toArray ? position.toArray() : position ), target: new THREE.Vector3().fromArray( target.toArray ? target.toArray() : target ), fov: fov || camera.fov };
		const start = performance.now();

		const step = ( now ) => {

			const t = duration <= 0 ? 1 : Math.min( ( now - start ) / duration, 1 );
			const k = t * t * ( 3 - 2 * t );
			camera.position.lerpVectors( from.position, to.position, k );
			orbit.target.lerpVectors( from.target, to.target, k );
			camera.fov = from.fov + ( to.fov - from.fov ) * k;
			camera.updateProjectionMatrix();
			orbit.update();
			onChange();
			if ( t < 1 ) state.animation = requestAnimationFrame( step );

		};

		if ( duration <= 0 ) step( start + 1 );
		else state.animation = requestAnimationFrame( step );

	}

	function frameAll( duration ) {

		animateTo( frameFor( state.box ), duration );

	}

	function frameObject( object, duration ) {

		const box = new THREE.Box3().setFromObject( object );
		const direction = camera.position.clone().sub( orbit.target ).normalize();
		animateTo( frameFor( box, direction.lengthSq() > 0 ? direction : undefined ), duration );

	}

	function saveInitial() {

		state.initial = { position: camera.position.clone(), target: orbit.target.clone(), fov: camera.fov };

	}

	function resetInitial() {

		if ( state.initial !== null ) animateTo( state.initial );

	}

	// vista salva (EV-008). Vistas ortográficas são reproduzidas em perspectiva com o mesmo enquadramento aproximado
	function applyView( view, duration ) {

		const position = new THREE.Vector3().fromArray( view.position );
		const target = new THREE.Vector3().fromArray( view.target );
		let fov = view.fov || camera.fov;

		if ( view.projection === 'orthographic' ) {

			fov = 30;
			const height = view.frustumHeight / ( view.zoom || 1 );
			const distance = height / ( 2 * Math.tan( THREE.MathUtils.degToRad( fov ) / 2 ) );
			const direction = position.clone().sub( target ).normalize();
			position.copy( target ).addScaledVector( direction.lengthSq() > 0 ? direction : new THREE.Vector3( 0, 1, 0 ), distance );

		}

		animateTo( { position, target, fov }, duration );

	}

	function cameraState() {

		return {
			projection: 'perspective',
			position: camera.position.toArray(),
			quaternion: camera.quaternion.toArray(),
			target: orbit.target.toArray(),
			fov: camera.fov
		};

	}

	// primeira pessoa ----------------------------------------------------------------------------------------------------

	function setWalking( walking ) {

		if ( state.walking === walking ) return;
		state.walking = walking;
		orbit.enabled = walking === false;
		state.keys.clear();

		if ( walking ) {

			const direction = orbit.target.clone().sub( camera.position ).setY( 0 );
			if ( direction.lengthSq() < 1e-6 ) direction.set( 0, 0, - 1 );
			direction.normalize();
			const center = state.box.isEmpty() ? new THREE.Vector3() : state.box.getCenter( new THREE.Vector3() );
			camera.position.set( center.x - direction.x * 1.5, state.floor + EYE_HEIGHT, center.z - direction.z * 1.5 );
			const yaw = Math.atan2( - direction.x, - direction.z );
			state.look = { yaw, pitch: 0 };
			applyLook();
			state.last = performance.now();
			requestAnimationFrame( walkStep );

		} else {

			const forward = new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
			orbit.target.copy( camera.position ).addScaledVector( forward, 2 );
			orbit.update();

		}

		onChange();
		if ( state.onWalkChange ) state.onWalkChange( walking );

	}

	function applyLook() {

		camera.quaternion.setFromEuler( new THREE.Euler( state.look.pitch, state.look.yaw, 0, 'YXZ' ) );

	}

	function walkStep( now ) {

		if ( state.walking === false ) return;
		const dt = Math.min( ( now - state.last ) / 1000, 0.5 );
		state.last = now;

		const forward = new THREE.Vector3( - Math.sin( state.look.yaw ), 0, - Math.cos( state.look.yaw ) );
		const right = new THREE.Vector3( - forward.z, 0, forward.x );
		const move = new THREE.Vector3();
		if ( state.keys.has( 'KeyW' ) || state.keys.has( 'ArrowUp' ) ) move.add( forward );
		if ( state.keys.has( 'KeyS' ) || state.keys.has( 'ArrowDown' ) ) move.sub( forward );
		if ( state.keys.has( 'KeyD' ) || state.keys.has( 'ArrowRight' ) ) move.add( right );
		if ( state.keys.has( 'KeyA' ) || state.keys.has( 'ArrowLeft' ) ) move.sub( right );

		if ( move.lengthSq() > 0 ) {

			camera.position.addScaledVector( move.normalize(), WALK_SPEED * dt );
			onChange();

		}

		requestAnimationFrame( walkStep );

	}

	let drag = null;
	domElement.addEventListener( 'pointerdown', ( event ) => {

		if ( state.walking ) drag = { x: event.clientX, y: event.clientY };

	} );
	window.addEventListener( 'pointermove', ( event ) => {

		if ( state.walking === false || drag === null ) return;
		state.look.yaw -= ( event.clientX - drag.x ) * 0.004;
		state.look.pitch = THREE.MathUtils.clamp( state.look.pitch - ( event.clientY - drag.y ) * 0.004, - 1.3, 1.3 );
		drag = { x: event.clientX, y: event.clientY };
		applyLook();
		onChange();

	} );
	window.addEventListener( 'pointerup', () => {

		drag = null;

	} );

	window.addEventListener( 'keydown', ( event ) => {

		if ( state.walking === false || event.target.closest( 'input, textarea, select' ) ) return;
		if ( event.code === 'Escape' ) {

			setWalking( false );
			return;

		}

		if ( [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' ].includes( event.code ) ) {

			event.preventDefault();
			state.keys.add( event.code );

		}

	} );
	window.addEventListener( 'keyup', ( event ) => state.keys.delete( event.code ) );
	window.addEventListener( 'blur', () => state.keys.clear() );

	return {
		orbit,
		setBounds,
		frameAll,
		frameObject,
		saveInitial,
		resetInitial,
		applyView,
		animateTo,
		cameraState,
		setWalking,
		isWalking: () => state.walking,
		onWalkChange: ( fn ) => {

			state.onWalkChange = fn;

		}
	};

}

export { ViewerControls };
