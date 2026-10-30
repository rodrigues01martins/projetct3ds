// EV-008 — Sistema de Visualização, Câmeras e Apresentação de Projetos 3D
//
// Cálculos de câmera e projeção do Modo Simples: enquadramento, vistas técnicas, estados de vista e transições.
//
// Estratégia de câmeras transitórias:
//   - editor.camera continua sendo a câmera principal PERSPECTIVA (tipo nunca alterado, serializada no JSON);
//   - as vistas técnicas (superior, frontal, posterior, laterais) usam UMA OrthographicCamera própria, fora da cena
//     e de editor.cameras (userData.transientView = true), atribuída a editor.viewportCamera enquanto ativa;
//   - o Viewport usa a câmera exibida para seleção, alças, navegação e auxiliares; Editor.toJSON() grava sempre
//     editor.camera — a perspectiva é mantida sincronizada com a vista ortográfica (mesma direção e área visível);
//   - nada aqui cria objetos na cena nem passa pelo histórico: mover a câmera não é uma edição do projeto.
//
// Convenção de eixos: X = largura, Y = altura, Z = profundidade. A FRENTE do projeto está voltada para +Z
// (de onde a câmera padrão do editor observa): Frontal olha de +Z para −Z, Posterior de −Z para +Z,
// Lateral direita de +X para −X, Lateral esquerda de −X para +X, Superior de +Y para baixo (−Z no alto da tela).

import * as THREE from 'three';

import { isLightingGroup } from './SimpleMode.Lighting.js';

const DEFAULT_DIRECTION = [ 0.9, 0.8, 1.3 ]; // perspectiva: de frente e à direita, levemente de cima
const MARGIN = 1.12; // folga visual do enquadramento
const TRANSITION_MS = 500;

const VIEWS = {
	perspective: { projection: 'perspective', direction: DEFAULT_DIRECTION, up: [ 0, 1, 0 ] },
	top: { projection: 'orthographic', direction: [ 0, 1, 0 ], up: [ 0, 0, - 1 ] },
	front: { projection: 'orthographic', direction: [ 0, 0, 1 ], up: [ 0, 1, 0 ] },
	back: { projection: 'orthographic', direction: [ 0, 0, - 1 ], up: [ 0, 1, 0 ] },
	right: { projection: 'orthographic', direction: [ 1, 0, 0 ], up: [ 0, 1, 0 ] },
	left: { projection: 'orthographic', direction: [ - 1, 0, 0 ], up: [ 0, 1, 0 ] }
};

const EMPTY_BOX = new THREE.Box3( new THREE.Vector3( - 2, 0, - 2 ), new THREE.Vector3( 2, 2.7, 2 ) );

// limites ---------------------------------------------------------------------------------------------

// Caixa dos objetos úteis: ignora o grupo de iluminação do Project3DS, luzes, câmeras e objetos ocultos.
// Grade, alças, prévias, marcadores e auxiliares ficam em editor.sceneHelpers (outra cena) e nunca entram.
function getProjectBox( editor, target = new THREE.Box3() ) {

	target.makeEmpty();

	for ( const object of editor.scene.children ) {

		if ( object.visible === false || isLightingGroup( object ) || object.isLight === true || object.isCamera === true ) continue;
		target.expandByObject( object, true );

	}

	return target;

}

function getObjectBox( object, target = new THREE.Box3() ) {

	target.makeEmpty();
	target.expandByObject( object, true );
	return target;

}

function viewportAspect() {

	const viewport = document.getElementById( 'viewport' );
	return viewport !== null && viewport.offsetHeight > 0 ? viewport.offsetWidth / viewport.offsetHeight : 16 / 9;

}

// cálculos de enquadramento ----------------------------------------------------------------------------------

// Perspectiva: distância para que a esfera envolvente caiba no menor ângulo de visão (vertical ou horizontal)
function perspectiveFrame( box, direction, fov, aspect ) {

	const center = box.getCenter( new THREE.Vector3() );
	const radius = Math.max( 0.05, box.getBoundingSphere( new THREE.Sphere() ).radius );
	const vertical = THREE.MathUtils.degToRad( fov );
	const horizontal = 2 * Math.atan( Math.tan( vertical / 2 ) * aspect );
	const distance = radius / Math.sin( Math.min( vertical, horizontal ) / 2 ) * 1.05;

	const offset = new THREE.Vector3().fromArray( direction ).normalize().multiplyScalar( distance );
	const position = center.clone().add( offset );
	const quaternion = lookQuaternion( position, center, new THREE.Vector3( 0, 1, 0 ) );

	return { projection: 'perspective', position, quaternion, target: center, fov, distance };

}

// Ortográfica: projeta os 8 cantos da caixa nos eixos da tela; altura visível = maior entre altura e largura/proporção
function orthographicFrame( box, direction, up, aspect ) {

	const center = box.getCenter( new THREE.Vector3() );
	const radius = Math.max( 0.05, box.getBoundingSphere( new THREE.Sphere() ).radius );
	const back = new THREE.Vector3().fromArray( direction ).normalize();
	const quaternion = lookQuaternion( center.clone().add( back ), center, new THREE.Vector3().fromArray( up ) );
	const right = new THREE.Vector3( 1, 0, 0 ).applyQuaternion( quaternion );
	const screenUp = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( quaternion );

	let minX = Infinity, maxX = - Infinity, minY = Infinity, maxY = - Infinity;
	const corner = new THREE.Vector3();

	for ( let i = 0; i < 8; i ++ ) {

		corner.set( i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z ).sub( center );
		const x = corner.dot( right ), y = corner.dot( screenUp );
		minX = Math.min( minX, x ); maxX = Math.max( maxX, x );
		minY = Math.min( minY, y ); maxY = Math.max( maxY, y );

	}

	const target = center.clone().addScaledVector( right, ( minX + maxX ) / 2 ).addScaledVector( screenUp, ( minY + maxY ) / 2 );
	const frustumHeight = Math.max( 0.2, Math.max( maxY - minY, ( maxX - minX ) / aspect ) * MARGIN );
	const distance = radius * 3 + 2; // fora do projeto; a escala não depende da distância
	const position = target.clone().addScaledVector( back, distance );

	return { projection: 'orthographic', position, quaternion, target, frustumHeight, zoom: 1, distance, up: up.slice() };

}

function lookQuaternion( eye, target, up ) {

	const matrix = new THREE.Matrix4().lookAt( eye, target, up );
	return new THREE.Quaternion().setFromRotationMatrix( matrix );

}

// controlador ---------------------------------------------------------------------------------------------------

function CameraController( editor ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const camera = editor.camera;

	const ortho = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0.01, 1000 );
	ortho.name = 'Vista técnica (temporária)';
	ortho.userData.transientView = true;
	ortho.userData.frustumHeight = 10;

	let activeView = null; // id em VIEWS quando a câmera está numa vista rápida
	let animation = null; // { frame, ... }

	const isOrthographic = () => editor.viewportCamera === ortho;

	function notifyCamera( object ) {

		object.updateMatrixWorld();
		editor.signals.cameraChanged.dispatch( object );

	}

	// troca de projeção --------------------------------------------------------------------------------

	function useOrthographic() {

		editor.controls.enableRotate = false;

		if ( editor.viewportCamera !== ortho ) {

			editor.viewportCamera = ortho;
			editor.signals.viewportCameraChanged.dispatch(); // o Viewport religa seleção, alças e navegação

		}

	}

	function usePerspective() {

		editor.controls.enableRotate = true;

		if ( editor.viewportCamera === ortho ) {

			editor.viewportCamera = camera;
			editor.signals.viewportCameraChanged.dispatch();

		}

	}

	// área visível da ortográfica convertida em distância da perspectiva (mesma direção e mesmo centro)
	function equivalentDistance( visibleHeight ) {

		return visibleHeight / 2 / Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 );

	}

	function syncPerspectiveFromOrtho() {

		const center = editor.controls.center;
		const distance = equivalentDistance( ( ortho.top - ortho.bottom ) / ortho.zoom );
		const back = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( ortho.quaternion );

		camera.quaternion.copy( ortho.quaternion );
		camera.position.copy( center ).addScaledVector( back, distance );
		camera.far = Math.max( camera.far, distance * 100 );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();

	}

	// mantém editor.camera coerente com a vista ortográfica (o JSON salvo reabre na mesma direção)
	editor.signals.cameraChanged.add( ( object ) => {

		if ( object === ortho && isOrthographic() ) syncPerspectiveFromOrtho();

	} );

	// estados de vista ------------------------------------------------------------------------------------------

	function captureState() {

		const source = isOrthographic() ? ortho : camera;
		const state = {
			projection: isOrthographic() ? 'orthographic' : 'perspective',
			position: source.position.toArray(),
			quaternion: source.quaternion.toArray(),
			target: editor.controls.center.toArray(),
			preset: activeView
		};

		if ( isOrthographic() ) {

			state.frustumHeight = ortho.userData.frustumHeight;
			state.zoom = ortho.zoom;

		} else {

			state.fov = camera.fov;

		}

		return state;

	}

	function applyOrthographic( frame ) {

		ortho.position.fromArray( toArray( frame.position ) );
		ortho.quaternion.fromArray( toArray( frame.quaternion ) );
		ortho.zoom = frame.zoom || 1;
		ortho.userData.frustumHeight = frame.frustumHeight;

		const target = new THREE.Vector3().fromArray( toArray( frame.target ) );
		const distance = ortho.position.distanceTo( target );
		ortho.near = 0.01;
		ortho.far = Math.max( 100, distance * 4 + frame.frustumHeight * 4 );

		const aspect = viewportAspect();
		ortho.left = - frame.frustumHeight * aspect / 2;
		ortho.right = frame.frustumHeight * aspect / 2;
		ortho.top = frame.frustumHeight / 2;
		ortho.bottom = - frame.frustumHeight / 2;
		ortho.updateProjectionMatrix();

		editor.controls.center.copy( target );
		useOrthographic();
		syncPerspectiveFromOrtho();
		notifyCamera( ortho );

	}

	function applyPerspective( frame ) {

		camera.position.fromArray( toArray( frame.position ) );
		camera.quaternion.fromArray( toArray( frame.quaternion ) );
		if ( Number.isFinite( frame.fov ) ) camera.fov = frame.fov;

		const target = new THREE.Vector3().fromArray( toArray( frame.target ) );
		const distance = Math.max( 0.01, camera.position.distanceTo( target ) );
		camera.near = Math.max( 0.001, Math.min( 0.05, distance / 1000 ) );
		camera.far = Math.max( 1e4, distance * 100 );
		camera.updateProjectionMatrix();

		editor.controls.center.copy( target );
		usePerspective();
		notifyCamera( camera );

	}

	function applyState( state ) {

		cancelTransition();
		if ( state.projection === 'orthographic' ) applyOrthographic( state );
		else applyPerspective( state );
		activeView = state.preset !== undefined && VIEWS[ state.preset ] !== undefined ? state.preset : null;
		changed.dispatch();

	}

	// vistas rápidas e enquadramento ----------------------------------------------------------------------------

	function frameFor( viewId, box ) {

		const view = VIEWS[ viewId ];
		return view.projection === 'orthographic' ?
			orthographicFrame( box, view.direction, view.up, viewportAspect() ) :
			perspectiveFrame( box, view.direction, camera.fov, viewportAspect() );

	}

	function setView( viewId ) {

		if ( VIEWS[ viewId ] === undefined ) return false;

		const box = getProjectBox( editor );
		const frame = frameFor( viewId, box.isEmpty() ? EMPTY_BOX : box );

		applyState( Object.assign( frame, { preset: viewId } ) );
		return true;

	}

	// direção atual da câmera (do centro para a câmera) — usada para enquadrar sem girar a vista
	function currentDirection() {

		const source = isOrthographic() ? ortho : camera;
		return new THREE.Vector3( 0, 0, 1 ).applyQuaternion( source.quaternion ).toArray();

	}

	function frameBox( box ) {

		if ( box.isEmpty() ) return false;

		cancelTransition();

		if ( isOrthographic() ) {

			const up = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( ortho.quaternion ).toArray();
			applyOrthographic( orthographicFrame( box, currentDirection(), up, viewportAspect() ) );

		} else {

			applyPerspective( perspectiveFrame( box, currentDirection(), camera.fov, viewportAspect() ) );

		}

		changed.dispatch();
		return true;

	}

	function frameProject() {

		return frameBox( getProjectBox( editor ) );

	}

	function frameSelection( object ) {

		if ( object === null || object === undefined || object === editor.scene ) return false;
		return frameBox( getObjectBox( object ) );

	}

	// volta à perspectiva equivalente (mesma direção e área visível) sem animação
	function toPerspective() {

		cancelTransition();
		if ( isOrthographic() === false ) return;

		syncPerspectiveFromOrtho();
		usePerspective();
		activeView = activeView === null || VIEWS[ activeView ].projection === 'orthographic' ? null : activeView;
		notifyCamera( camera );
		changed.dispatch();

	}

	// transições ----------------------------------------------------------------------------------------------

	function cancelTransition() {

		if ( animation === null ) return;

		cancelAnimationFrame( animation.frame );
		animation = null;
		changed.dispatch();

	}

	// Anima até um estado salvo (~0,5 s, requestAnimationFrame). Projeções nunca são interpoladas entre si:
	//   perspectiva → ortográfica: a perspectiva anima até a pose equivalente e só então troca de projeção;
	//   ortográfica → perspectiva: troca imediata para a perspectiva equivalente e anima a partir dela.
	function transitionTo( state, { duration = TRANSITION_MS, onComplete } = {} ) {

		cancelTransition();

		const reduced = window.matchMedia !== undefined && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

		if ( duration <= 0 || reduced ) {

			applyState( state );
			if ( onComplete ) onComplete();
			return;

		}

		const targetCenter = new THREE.Vector3().fromArray( toArray( state.target ) );
		const targetQuaternion = new THREE.Quaternion().fromArray( toArray( state.quaternion ) );
		let from, to;

		if ( state.projection === 'orthographic' && isOrthographic() ) {

			from = { position: ortho.position.clone(), quaternion: ortho.quaternion.clone(), center: editor.controls.center.clone(), size: ( ortho.top - ortho.bottom ) / ortho.zoom };
			to = { position: new THREE.Vector3().fromArray( toArray( state.position ) ), quaternion: targetQuaternion, center: targetCenter, size: state.frustumHeight / ( state.zoom || 1 ) };

		} else {

			if ( isOrthographic() ) toPerspective();

			let targetPosition = new THREE.Vector3().fromArray( toArray( state.position ) );

			if ( state.projection === 'orthographic' ) {

				const back = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( targetQuaternion );
				targetPosition = targetCenter.clone().addScaledVector( back, equivalentDistance( state.frustumHeight / ( state.zoom || 1 ) ) );

			}

			from = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), center: editor.controls.center.clone(), size: camera.fov };
			to = { position: targetPosition, quaternion: targetQuaternion, center: targetCenter, size: state.projection === 'perspective' && Number.isFinite( state.fov ) ? state.fov : camera.fov };

		}

		const object = isOrthographic() ? ortho : camera;
		const start = performance.now();
		animation = { frame: 0 };

		function step( now ) {

			const raw = Math.min( 1, ( now - start ) / duration );
			const k = raw * raw * ( 3 - 2 * raw ); // suavização (smoothstep)

			object.position.lerpVectors( from.position, to.position, k );
			object.quaternion.slerpQuaternions( from.quaternion, to.quaternion, k );
			editor.controls.center.lerpVectors( from.center, to.center, k );

			const size = from.size + ( to.size - from.size ) * k;

			if ( object === ortho ) {

				ortho.zoom = ortho.userData.frustumHeight / size;

			} else {

				camera.fov = size;

			}

			object.updateProjectionMatrix();
			notifyCamera( object );

			if ( raw < 1 ) {

				animation.frame = requestAnimationFrame( step );
				return;

			}

			animation = null;
			applyState( state ); // estado final exato (inclui a troca para ortográfica, quando for o caso)
			if ( onComplete ) onComplete();

		}

		animation.frame = requestAnimationFrame( step );
		changed.dispatch();

	}

	// interação do usuário interrompe a transição (a câmera fica onde está, em estado válido)
	const viewport = document.getElementById( 'viewport' );

	if ( viewport !== null ) {

		viewport.addEventListener( 'pointerdown', cancelTransition, true );
		viewport.addEventListener( 'wheel', cancelTransition, { capture: true, passive: true } );

	}

	// navegar manualmente na perspectiva desfaz o destaque da vista rápida (a não ser na própria Perspectiva)
	editor.signals.cameraChanged.add( ( object ) => {

		if ( animation === null && object === camera && isOrthographic() === false && activeView !== null && activeView !== 'perspective' ) {

			activeView = null;
			changed.dispatch();

		}

	} );

	// projeto novo/aberto: sem transição pendente e de volta à câmera principal (já reiniciada pelo editor)
	editor.signals.editorCleared.add( () => {

		cancelTransition();
		usePerspective();
		activeView = null;
		changed.dispatch();

	} );

	return {
		VIEWS,
		changed,
		ortho,
		setView,
		frameProject,
		frameSelection,
		captureState,
		applyState,
		transitionTo,
		cancelTransition,
		toPerspective,
		isOrthographic,
		isAnimating: () => animation !== null,
		getActiveView: () => activeView
	};

}

function toArray( value ) {

	return Array.isArray( value ) ? value : value.toArray();

}

export { CameraController, VIEWS, DEFAULT_DIRECTION, getProjectBox, getObjectBox, perspectiveFrame, orthographicFrame, viewportAspect };
