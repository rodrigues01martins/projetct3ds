// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Pré-visualização em cena TEMPORÁRIA própria (a cena do projeto não é tocada e nada entra no histórico).
// Um único WebGLRenderer é criado na primeira abertura e reaproveitado nas seguintes (o canvas é movido para a
// janela da vez); ao fechar, a cena temporária é esvaziada e as listas de renderização liberadas. Os recursos do
// MODELO são descartados por quem o carregou (o painel), que sabe se eles passaram a ser usados no projeto.

import * as THREE from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stats = { renderersCreated: 0, opens: 0 };
let shared = null; // { renderer, environment }

function getShared() {

	if ( shared !== null ) return shared;
	const renderer = new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } );
	renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, 2 ) );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;
	renderer.domElement.className = 'SimpleModelPreviewCanvas';
	const pmrem = new THREE.PMREMGenerator( renderer );
	const environment = pmrem.fromScene( new RoomEnvironment(), 0.04 ).texture;
	pmrem.dispose();
	stats.renderersCreated ++;
	shared = { renderer, environment };
	return shared;

}

function ExternalModelPreview( host ) {

	const { renderer, environment } = getShared();
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0xe9ebef );
	scene.environment = environment;
	scene.environmentIntensity = 0.8;

	const hemisphere = new THREE.HemisphereLight( 0xffffff, 0x9aa0aa, 1.2 );
	const sun = new THREE.DirectionalLight( 0xffffff, 1.5 );
	sun.position.set( 3, 6, 4 );
	scene.add( hemisphere, sun );

	const grid = new THREE.GridHelper( 10, 20, 0x9aa0aa, 0xc8ccd3 );
	grid.material.transparent = true;
	grid.material.opacity = 0.7;
	scene.add( grid );

	const holder = new THREE.Group(); // recebe a estrutura do modelo (raiz de pré-visualização)
	scene.add( holder );

	const camera = new THREE.PerspectiveCamera( 40, 1, 0.01, 1000 );
	host.appendChild( renderer.domElement );
	const controls = new OrbitControls( camera, renderer.domElement );
	controls.enableDamping = false;
	controls.addEventListener( 'change', () => request() );

	let frame = 0, open = true;
	stats.opens ++;

	function request() {

		if ( open === false || frame !== 0 ) return;
		frame = requestAnimationFrame( () => {

			frame = 0;
			render();

		} );

	}

	function render() {

		if ( open === false ) return;
		renderer.render( scene, camera );

	}

	function resize() {

		const width = Math.max( host.clientWidth, 1 ), height = Math.max( host.clientHeight, 1 );
		renderer.setSize( width, height, false );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		request();

	}

	const observer = new ResizeObserver( resize );
	observer.observe( host );

	function frameModel() {

		holder.updateMatrixWorld( true );
		const box = new THREE.Box3().setFromObject( holder, true );
		if ( box.isEmpty() ) return;
		const size = box.getSize( new THREE.Vector3() );
		const center = box.getCenter( new THREE.Vector3() );
		const radius = Math.max( size.length() / 2, 0.05 );
		const distance = radius / Math.sin( THREE.MathUtils.degToRad( camera.fov ) / 2 ) * 1.1;
		const direction = new THREE.Vector3( 1, 0.7, 1.3 ).normalize();
		camera.near = Math.max( distance / 1000, 0.001 );
		camera.far = distance * 100;
		camera.position.copy( center ).addScaledVector( direction, distance );
		controls.target.copy( center );
		camera.updateProjectionMatrix();
		controls.update();
		const gridSize = Math.max( 1, Math.ceil( Math.max( size.x, size.z ) * 2 ) );
		grid.scale.setScalar( gridSize / 10 );
		grid.position.set( center.x, box.min.y - 1e-4, center.z );
		request();

	}

	function zoom( factor ) {

		const offset = camera.position.clone().sub( controls.target ).multiplyScalar( factor );
		camera.position.copy( controls.target ).add( offset );
		controls.update();
		request();

	}

	function rotate( degrees ) {

		const offset = camera.position.clone().sub( controls.target ).applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), THREE.MathUtils.degToRad( degrees ) );
		camera.position.copy( controls.target ).add( offset );
		controls.update();
		request();

	}

	// imagem de capa para a biblioteca (JPEG pequeno)
	function thumbnail( width = 240, height = 180 ) {

		const previousSize = renderer.getSize( new THREE.Vector2() );
		const previousAspect = camera.aspect;
		renderer.setSize( width, height, false );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		grid.visible = false;
		renderer.render( scene, camera );
		const url = renderer.domElement.toDataURL( 'image/jpeg', 0.78 );
		grid.visible = state.grid;
		renderer.setSize( previousSize.x, previousSize.y, false );
		camera.aspect = previousAspect;
		camera.updateProjectionMatrix();
		request();
		return url.startsWith( 'data:image/jpeg' ) ? url : null;

	}

	const state = { grid: true };

	function setGrid( visible ) {

		state.grid = visible;
		grid.visible = visible;
		request();

	}

	// fecha: tira o modelo da cena temporária (sem descartá-lo) e libera o que é desta janela
	function close() {

		if ( open === false ) return;
		open = false;
		cancelAnimationFrame( frame );
		frame = 0;
		observer.disconnect();
		controls.dispose();
		holder.clear();
		scene.clear();
		grid.geometry.dispose();
		grid.material.dispose();
		renderer.renderLists.dispose();
		if ( renderer.domElement.parentNode === host ) host.removeChild( renderer.domElement );

	}

	resize();

	return { holder, scene, camera, controls, frameModel, zoom, rotate, request, setGrid, thumbnail, close, isOpen: () => open };

}

// diagnóstico: um renderer, memória ocupada (para conferir que fechar a janela não acumula recursos)
function previewStats() {

	return {
		renderersCreated: stats.renderersCreated,
		opens: stats.opens,
		memory: shared !== null ? Object.assign( {}, shared.renderer.info.memory ) : null
	};

}

export { ExternalModelPreview, previewStats };
