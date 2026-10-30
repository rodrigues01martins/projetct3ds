// EV-008 — Sistema de Visualização, Câmeras e Apresentação de Projetos 3D
//
// "Explorar ambiente": navegação em primeira pessoa como ferramenta do controlador único (SimpleMode.Interaction),
// portanto nunca simultânea com medir, desenhar ou inserir aberturas.
//
//   W/S avançar/recuar · A/D lateral · setas também · mouse olha · Shift = rápido · Esc ou "Sair da exploração".
//   - usa a câmera principal (perspectiva); vistas ortográficas voltam antes à perspectiva equivalente;
//   - EditorControls fica desligado; olhar por arraste sempre funciona; Pointer Lock só após clique do usuário
//     (se o navegador negar, o arraste continua);
//   - velocidade com delta time (independente do FPS); ângulo vertical limitado (±85°), horizonte estável;
//   - ao perder o foco da janela as teclas são soltas (sem deslocamento contínuo);
//   - exploração livre, SEM colisão: uma caixa retangular da parede inteira bloquearia portas reais (EV-007).

import * as THREE from 'three';

import { UIDiv } from './libs/ui.js';

import { getProjectBox } from './SimpleMode.CameraController.js';
import { getComponentData } from './SimpleMode.ComponentFactory.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';

const SETTINGS = { eyeHeight: 1.65, speed: 1.5, fastSpeed: 3, sensitivity: 0.0025, maxPitch: THREE.MathUtils.degToRad( 85 ) };
const MOVE_KEYS = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };

function Walkthrough( editor, context, interaction, cameras ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const camera = editor.camera;
	const viewport = interaction.viewport;

	const pressed = new Set();
	const state = { active: false, keep: false, previous: null, near: null, yaw: 0, pitch: 0, fast: false, frame: 0, last: 0, drag: null, locked: false, lockFailed: false };

	// posição inicial ------------------------------------------------------------------------------------------

	// altura da superfície de apoio: topo do piso (componente "floor") sob o ponto; senão, y = 0
	function supportHeight( x, z, top ) {

		const floors = [];
		editor.scene.traverseVisible( ( object ) => {

			if ( object.isMesh === true && object.parent !== null ) {

				const data = getComponentData( object.parent );
				if ( data !== null && data.id === 'floor' ) floors.push( object );

			}

		} );

		const raycaster = new THREE.Raycaster( new THREE.Vector3( x, top + 1, z ), new THREE.Vector3( 0, - 1, 0 ) );
		const hit = raycaster.intersectObjects( floors, false )[ 0 ];
		return hit !== undefined ? hit.point.y : 0;

	}

	// dentro do projeto: mantém a posição horizontal da câmera; fora dele, entra pela frente (+Z) olhando o centro
	function startPose() {

		const box = getProjectBox( editor );
		const position = camera.position.clone();
		let look;

		if ( box.isEmpty() ) {

			position.set( 0, 0, 3 );
			look = new THREE.Vector3( 0, 0, 0 );

		} else {

			const center = box.getCenter( new THREE.Vector3() );
			const inside = position.x > box.min.x && position.x < box.max.x && position.z > box.min.z && position.z < box.max.z;

			if ( inside === false ) position.set( center.x, 0, center.z + ( box.max.z - center.z ) * 0.75 );
			look = center;
			position.y = supportHeight( position.x, position.z, box.max.y );

		}

		position.y += SETTINGS.eyeHeight;

		const direction = look.clone().sub( position ).setY( 0 );
		const yaw = direction.lengthSq() > 1e-8 ? Math.atan2( - direction.x, - direction.z ) : 0;

		return { position, yaw };

	}

	// ciclo ------------------------------------------------------------------------------------------------------

	const _forward = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3();

	function applyLook() {

		camera.rotation.set( state.pitch, state.yaw, 0, 'YXZ' );
		camera.updateMatrixWorld();

	}

	function tick( now ) {

		if ( state.active === false ) return;

		const dt = Math.min( 0.5, Math.max( 0, ( now - state.last ) / 1000 ) ); // delta time (limite evita saltos após pausas longas)
		state.last = now;

		_move.set( 0, 0, 0 );
		_forward.set( - Math.sin( state.yaw ), 0, - Math.cos( state.yaw ) ); // horizontal: olhar para cima não faz voar
		_right.set( Math.cos( state.yaw ), 0, - Math.sin( state.yaw ) );

		if ( pressed.has( 'forward' ) ) _move.add( _forward );
		if ( pressed.has( 'back' ) ) _move.sub( _forward );
		if ( pressed.has( 'right' ) ) _move.add( _right );
		if ( pressed.has( 'left' ) ) _move.sub( _right );

		if ( _move.lengthSq() > 0 && dt > 0 ) {

			_move.normalize().multiplyScalar( ( state.fast ? SETTINGS.fastSpeed : SETTINGS.speed ) * dt );
			camera.position.add( _move );
			editor.controls.center.add( _move );
			camera.updateMatrixWorld();
			editor.signals.cameraChanged.dispatch( camera );

		}

		state.frame = requestAnimationFrame( tick );

	}

	function look( dx, dy ) {

		state.yaw -= dx * SETTINGS.sensitivity;
		state.pitch = THREE.MathUtils.clamp( state.pitch - dy * SETTINGS.sensitivity, - SETTINGS.maxPitch, SETTINGS.maxPitch );
		applyLook();
		updateCenter();
		editor.signals.cameraChanged.dispatch( camera );

	}

	// centro de navegação 2 m à frente: ao sair mantendo a vista, a órbita gira em torno do que se está olhando
	function updateCenter() {

		editor.controls.center.copy( camera.position ).add( new THREE.Vector3( 0, 0, - 2 ).applyQuaternion( camera.quaternion ) );

	}

	// eventos (registrados só durante a exploração) ------------------------------------------------------------

	function onKeyDown( event ) {

		if ( isTyping( event ) ) return;

		const move = MOVE_KEYS[ event.code ];
		if ( event.key === 'Shift' ) state.fast = true;

		if ( move !== undefined ) {

			pressed.add( move );
			event.preventDefault();
			event.stopImmediatePropagation(); // W/E/R e setas não acionam atalhos do editor durante a exploração

		}

	}

	function onKeyUp( event ) {

		const move = MOVE_KEYS[ event.code ];
		if ( event.key === 'Shift' ) state.fast = false;
		if ( move !== undefined ) {

			pressed.delete( move );
			event.stopImmediatePropagation();

		}

	}

	function releaseKeys() {

		pressed.clear();
		state.fast = false;
		state.drag = null;

	}

	function onVisibility() {

		if ( document.hidden ) releaseKeys();

	}

	function onPointerDown( event ) {

		if ( event.target.tagName !== 'CANVAS' ) return;

		event.stopPropagation(); // sem órbita/seleção durante a exploração
		state.drag = { x: event.clientX, y: event.clientY, moved: 0 };

	}

	function onPointerMove( event ) {

		if ( state.locked ) {

			look( event.movementX || 0, event.movementY || 0 );
			return;

		}

		if ( state.drag === null || ( event.buttons & 1 ) === 0 ) return;

		const dx = event.clientX - state.drag.x, dy = event.clientY - state.drag.y;
		state.drag.x = event.clientX; state.drag.y = event.clientY;
		state.drag.moved += Math.abs( dx ) + Math.abs( dy );
		look( dx, dy );

	}

	function onPointerUp( event ) {

		const drag = state.drag;
		state.drag = null;

		// clique simples (sem arrastar) no canvas: captura do ponteiro, ação explícita do usuário
		if ( drag !== null && drag.moved < 4 && state.locked === false && state.lockFailed === false && event.target.tagName === 'CANVAS' ) requestLock();

	}

	function requestLock() {

		const canvas = viewport.querySelector( 'canvas' );
		if ( canvas === null || typeof canvas.requestPointerLock !== 'function' ) {

			state.lockFailed = true;
			return;

		}

		try {

			const result = canvas.requestPointerLock();
			if ( result !== undefined && typeof result.catch === 'function' ) result.catch( onLockError );

		} catch ( error ) {

			onLockError();

		}

	}

	function onLockChange() {

		const element = lockElement();
		state.locked = element !== null && viewport.contains( element );
		changed.dispatch();

	}

	function onLockError() {

		state.lockFailed = true; // o arraste continua disponível
		state.locked = false;
		changed.dispatch();

	}

	// Pointer Lock é opcional: sem suporte (ex.: iOS Safari) o valor é null e o olhar por arraste continua
	function lockElement() {

		return document.pointerLockElement || null; // eslint-disable-line compat/compat

	}

	function isTyping( event ) {

		const target = event.target;
		return target !== null && ( target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test( target.tagName ) );

	}

	function addListeners() {

		window.addEventListener( 'keydown', onKeyDown, true );
		window.addEventListener( 'keyup', onKeyUp, true );
		window.addEventListener( 'blur', releaseKeys );
		document.addEventListener( 'visibilitychange', onVisibility );
		document.addEventListener( 'pointerlockchange', onLockChange );
		document.addEventListener( 'pointerlockerror', onLockError );
		viewport.addEventListener( 'pointerdown', onPointerDown, true );
		document.addEventListener( 'pointermove', onPointerMove );
		document.addEventListener( 'pointerup', onPointerUp );

	}

	function removeListeners() {

		window.removeEventListener( 'keydown', onKeyDown, true );
		window.removeEventListener( 'keyup', onKeyUp, true );
		window.removeEventListener( 'blur', releaseKeys );
		document.removeEventListener( 'visibilitychange', onVisibility );
		document.removeEventListener( 'pointerlockchange', onLockChange );
		document.removeEventListener( 'pointerlockerror', onLockError );
		viewport.removeEventListener( 'pointerdown', onPointerDown, true );
		document.removeEventListener( 'pointermove', onPointerMove );
		document.removeEventListener( 'pointerup', onPointerUp );

	}

	// ativação -----------------------------------------------------------------------------------------------------

	function activate() {

		// 1. vista anterior guardada (inclusive ortográfica) e volta à perspectiva
		state.previous = cameras.captureState();
		cameras.toPerspective();

		// 2-3. posição inicial na altura dos olhos
		const pose = startPose();
		camera.position.copy( pose.position );
		state.yaw = pose.yaw;
		state.pitch = 0;
		state.near = camera.near;
		camera.near = 0.05;
		camera.far = Math.max( camera.far, 1e4 );
		camera.updateProjectionMatrix();
		applyLook();
		updateCenter();

		// 4. controles de primeira pessoa
		editor.controls.enabled = false;
		state.active = true;
		state.keep = false;
		state.lockFailed = false;
		releaseKeys();
		addListeners();
		state.last = performance.now();
		state.frame = requestAnimationFrame( tick );

		viewport.classList.add( 'exploring' );
		editor.signals.cameraChanged.dispatch( camera );
		changed.dispatch();

	}

	function deactivate() {

		if ( state.active === false ) return;

		state.active = false;
		cancelAnimationFrame( state.frame );
		removeListeners();
		releaseKeys();
		if ( lockElement() !== null && document.exitPointerLock !== undefined ) document.exitPointerLock();
		state.locked = false;

		viewport.classList.remove( 'exploring' );
		editor.controls.enabled = true;
		camera.near = state.near !== null ? state.near : camera.near;
		camera.updateProjectionMatrix();

		// volta ao enquadramento anterior, salvo se o usuário escolheu manter a vista atual
		if ( state.keep === false && state.previous !== null ) cameras.applyState( state.previous );
		else editor.signals.cameraChanged.dispatch( camera );

		state.previous = null;
		changed.dispatch();

	}

	interaction.register( 'explore', {
		activate,
		deactivate,
		onEscape: () => interaction.deactivate()
	} );

	function exit( keep = false ) {

		state.keep = keep;
		interaction.deactivate();

	}

	return { SETTINGS, changed, state, exit, isActive: () => state.active };

}

// painel discreto com orientações e saída ----------------------------------------------------------------------

function SimpleModeWalkthroughPanel( editor, context, container ) {

	const walkthrough = context.walkthrough;

	const panel = new UIDiv().setClass( 'SimpleMeasureStatus SimpleConstructionPanel SimpleWalkPanel' );
	panel.dom.setAttribute( 'role', 'group' );
	panel.dom.setAttribute( 'aria-label', t( 'explore/title' ) );
	panel.dom.hidden = true;
	container.add( panel );

	panel.add( createText( t( 'explore/title' ), 'SimpleConstructionTitle' ) );

	const keys = new UIDiv().setClass( 'SimpleWalkKeys' );
	for ( const [ key, text ] of [[ 'W A S D', t( 'explore/keys/move' ) ], [ t( 'explore/keys/mouse' ), t( 'explore/keys/look' ) ], [ 'Shift', t( 'explore/keys/fast' ) ], [ 'Esc', t( 'explore/keys/exit' ) ]] ) {

		const item = document.createElement( 'span' );
		const kbd = document.createElement( 'kbd' );
		kbd.textContent = key;
		item.append( kbd, ' ' + text );
		keys.dom.appendChild( item );

	}

	panel.add( keys );

	const hint = createText( '', 'SimpleSectionHint SimpleConstructionHint' );
	panel.add( hint );

	const actions = new UIDiv().setClass( 'SimpleConstructionActions' );
	actions.add( createSimpleButton( { label: t( 'explore/keep' ), title: t( 'explore/keep/title' ), className: 'SimpleMeasureAction', onClick: () => walkthrough.exit( true ) } ) );
	actions.add( createSimpleButton( { icon: 'close', label: t( 'explore/exit' ), title: t( 'explore/exit/title' ), className: 'SimpleMeasureAction SimpleWalkExit', onClick: () => walkthrough.exit( false ) } ) );
	panel.add( actions );

	function refresh() {

		const state = walkthrough.state;
		panel.dom.hidden = state.active === false;
		if ( state.active === false ) return;

		hint.setTextContent( state.locked ? t( 'explore/hint/locked' ) : ( state.lockFailed ? t( 'explore/hint/drag' ) : t( 'explore/hint/start' ) ) );

	}

	walkthrough.changed.add( refresh );
	refresh();

	return panel;

}

export { Walkthrough, SimpleModeWalkthroughPanel, SETTINGS as WALK_SETTINGS };
