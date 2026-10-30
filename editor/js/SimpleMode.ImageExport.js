// EV-008 — Sistema de Visualização, Câmeras e Apresentação de Projetos 3D
//
// "Exportar imagem": PNG do enquadramento atual (ou de uma vista salva) na resolução escolhida.
//
// Estratégia: usa o MESMO renderizador do viewport (materiais, texturas, sombras, iluminação e ambiente já
// carregados na GPU — sem duplicar a cena como Menubar.Render, que reconstrói tudo a partir do JSON):
//   1. câmera temporária clonada (nunca entra na cena) com a proporção do arquivo; política "conter": a área
//      visível no viewport fica inteira dentro da imagem (sem cortes; sobra espaço no eixo mais longo);
//   2. o canvas é renderizado na resolução do arquivo com pixelRatio 1 — só a cena: grade, alças, seleção,
//      medições e prévias ficam em outra cena (sceneHelpers) e não são desenhadas;
//   3. cópia imediata para um canvas 2D (mesma tarefa, antes de o navegador recompor a página) e restauração
//      do tamanho original; o PNG sai por canvas.toBlob() e é baixado direto, sem janela extra.
// A cena não é modificada. Limites: tamanho máximo de renderbuffer/viewport do dispositivo.

import * as THREE from 'three';

import { UIDiv } from './libs/ui.js';

import { getSavedViews } from './SimpleMode.SavedViews.js';
import { viewportAspect } from './SimpleMode.CameraController.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';

const RESOLUTIONS = [
	{ id: 'hd', width: 1280, height: 720, label: '1280 × 720 — HD' },
	{ id: 'fullhd', width: 1920, height: 1080, label: '1920 × 1080 — Full HD' },
	{ id: 'qhd', width: 2560, height: 1440, label: '2560 × 1440 — QHD' },
	{ id: 'square', width: 1080, height: 1080, label: '1080 × 1080 — Quadrada' }
];
const DEFAULT_RESOLUTION = 'fullhd';
const MAX_SIZE = 8192;

class ExportError extends Error {}

// câmera temporária com a proporção do arquivo, contendo toda a área visível no viewport
function createExportCamera( source, width, height, viewAspect ) {

	const aspect = width / height;
	const exportCamera = source.clone();

	if ( source.isOrthographicCamera ) {

		const visibleHeight = ( source.top - source.bottom ) / source.zoom;
		const visibleWidth = visibleHeight * viewAspect;
		const h = aspect >= viewAspect ? visibleHeight : visibleWidth / aspect;

		exportCamera.left = - h * aspect / 2;
		exportCamera.right = h * aspect / 2;
		exportCamera.top = h / 2;
		exportCamera.bottom = - h / 2;
		exportCamera.zoom = 1;

	} else {

		const fov = THREE.MathUtils.degToRad( source.fov );
		exportCamera.fov = aspect >= viewAspect ? source.fov : THREE.MathUtils.radToDeg( 2 * Math.atan( Math.tan( fov / 2 ) * viewAspect / aspect ) );
		exportCamera.aspect = aspect;

	}

	exportCamera.updateProjectionMatrix();
	exportCamera.updateMatrixWorld( true );

	return exportCamera;

}

// câmera a partir de uma vista salva (dados), sem alterar o viewport
function cameraFromView( view, editor ) {

	let camera;

	if ( view.projection === 'orthographic' ) {

		const aspect = viewportAspect();
		const h = view.frustumHeight;
		camera = new THREE.OrthographicCamera( - h * aspect / 2, h * aspect / 2, h / 2, - h / 2, 0.01, 1e5 );
		camera.zoom = view.zoom;

	} else {

		camera = new THREE.PerspectiveCamera( view.fov, viewportAspect(), Math.max( 0.001, editor.camera.near ), Math.max( 1e4, editor.camera.far ) );

	}

	camera.position.fromArray( view.position );
	camera.quaternion.fromArray( view.quaternion );
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld( true );

	return camera;

}

function checkSize( renderer, width, height ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 16 || height < 16 || width > MAX_SIZE || height > MAX_SIZE ) {

		throw new ExportError( t( 'export/error/size' ) );

	}

	const gl = renderer.getContext();
	const maxRenderbuffer = gl.getParameter( gl.MAX_RENDERBUFFER_SIZE );
	const maxViewport = gl.getParameter( gl.MAX_VIEWPORT_DIMS );

	if ( width > maxRenderbuffer || height > maxRenderbuffer || width > maxViewport[ 0 ] || height > maxViewport[ 1 ] ) {

		throw new ExportError( t( 'export/error/device', Math.min( maxRenderbuffer, maxViewport[ 0 ] ) ) );

	}

}

// renderiza e devolve um canvas 2D com a imagem (síncrono: o canvas do viewport volta ao tamanho original antes de retornar)
function renderToCanvas( editor, camera, width, height ) {

	const renderer = editor.viewportRenderer;
	if ( renderer === undefined || renderer === null ) throw new ExportError( t( 'export/error/renderer' ) );

	checkSize( renderer, width, height );

	const exportCamera = createExportCamera( camera, width, height, viewportAspect() );
	const pixelRatio = renderer.getPixelRatio();
	const size = renderer.getSize( new THREE.Vector2() );
	const output = document.createElement( 'canvas' );
	output.width = width;
	output.height = height;

	try {

		renderer.setPixelRatio( 1 );
		renderer.setSize( width, height, false ); // sem alterar o CSS: nada muda na tela
		renderer.setViewport( 0, 0, width, height );
		renderer.render( editor.scene, exportCamera );

		const context = output.getContext( '2d' );
		if ( context === null ) throw new ExportError( t( 'export/error/memory' ) );
		context.drawImage( renderer.domElement, 0, 0, width, height );

	} finally {

		renderer.setPixelRatio( pixelRatio );
		renderer.setSize( size.x, size.y, false );
		editor.signals.cameraChanged.dispatch( editor.viewportCamera ); // redesenha o viewport normalmente

	}

	return output;

}

function canvasToBlob( canvas ) {

	return new Promise( ( resolve, reject ) => {

		canvas.toBlob( ( blob ) => ( blob !== null ? resolve( blob ) : reject( new ExportError( t( 'export/error/memory' ) ) ) ), 'image/png' );

	} );

}

function safeFileName( name ) {

	const safe = String( name || '' ).trim().replace( /\.png$/i, '' ).normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[\\/:*?"<>|]+/g, '' ).replace( /\s+/g, '-' ).slice( 0, 80 );
	return ( safe !== '' ? safe : 'imagem' ) + '.png';

}

// exporta e baixa o PNG; devolve { fileName, width, height, blob }
async function exportImage( editor, { camera, width, height, fileName } ) {

	const canvas = renderToCanvas( editor, camera, width, height );

	try {

		const blob = await canvasToBlob( canvas );
		const name = safeFileName( fileName );
		editor.utils.save( blob, name );
		return { fileName: name, width, height, blob };

	} finally {

		canvas.width = 0; // libera a memória do canvas temporário
		canvas.height = 0;

	}

}

// janela simples (não modal) da barra superior -------------------------------------------------------------------

function SimpleModeImageExport( editor, context, anchor ) {

	const panel = new UIDiv().setClass( 'SimpleLighting SimpleExportPanel' );
	panel.dom.id = 'simple-export';
	panel.dom.setAttribute( 'role', 'dialog' );
	panel.dom.setAttribute( 'aria-label', t( 'export/title' ) );
	panel.dom.hidden = true;
	anchor.closest( '#simple-topbar' ).appendChild( panel.dom ); // dentro do Modo Simples (estilos e ocultação)

	const header = new UIDiv().setClass( 'SimpleHelpHeader' );
	header.add( createText( t( 'export/title' ), 'SimpleHelpTitle' ) );
	header.add( createSimpleButton( { icon: 'close', title: t( 'export/close' ), className: 'SimpleIconButton', onClick: close } ) );
	panel.add( header );

	function field( labelText, control ) {

		const label = document.createElement( 'label' );
		label.className = 'SimpleSubLabel SimpleExportField';
		label.textContent = labelText;
		label.appendChild( control );
		control.addEventListener( 'keydown', ( event ) => {

			event.stopPropagation(); // sem atalhos do editor enquanto digita
			if ( event.key === 'Escape' ) close();

		} );
		panel.dom.appendChild( label );
		return control;

	}

	const viewSelect = field( t( 'export/framing' ), Object.assign( document.createElement( 'select' ), { className: 'SimpleSelect' } ) );

	const resolutionSelect = field( t( 'export/resolution' ), Object.assign( document.createElement( 'select' ), { className: 'SimpleSelect' } ) );
	for ( const resolution of RESOLUTIONS ) resolutionSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: resolution.id, textContent: resolution.label } ) );
	resolutionSelect.value = DEFAULT_RESOLUTION;

	const nameInput = field( t( 'export/fileName' ), Object.assign( document.createElement( 'input' ), { className: 'SimpleTextInput', maxLength: 80 } ) );

	const status = createText( t( 'export/hint' ), 'SimpleSectionHint SimpleExportStatus' );
	status.dom.setAttribute( 'aria-live', 'polite' );
	panel.add( status );

	const actions = new UIDiv().setClass( 'SimpleActions' );
	const generate = createSimpleButton( { icon: 'image', label: t( 'export/generate' ), title: t( 'export/generate/title' ), className: 'active SimpleExportGenerate', onClick: run } );
	actions.add( generate );
	actions.add( createSimpleButton( { label: t( 'export/cancel' ), onClick: close } ) );
	panel.add( actions );

	let busy = false;

	function open() {

		viewSelect.textContent = '';
		viewSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: '', textContent: t( 'export/framing/current' ) } ) );
		for ( const view of getSavedViews( editor.scene ) ) viewSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: view.id, textContent: view.name } ) );

		nameInput.value = editor.config.getKey( 'project/title' ) || t( 'export/defaultName' );
		status.setTextContent( t( 'export/hint' ) );
		status.dom.classList.remove( 'invalid' );

		const rect = anchor.getBoundingClientRect();
		panel.dom.style.top = ( rect.bottom + 6 ) + 'px';
		panel.dom.style.left = Math.max( 8, Math.min( rect.left, window.innerWidth - 328 ) ) + 'px';
		panel.dom.hidden = false;
		anchor.setAttribute( 'aria-expanded', 'true' );
		resolutionSelect.focus();

	}

	function close() {

		if ( panel.dom.hidden ) return;
		panel.dom.hidden = true;
		anchor.setAttribute( 'aria-expanded', 'false' );

	}

	async function run() {

		if ( busy ) return;

		const resolution = RESOLUTIONS.find( ( item ) => item.id === resolutionSelect.value ) || RESOLUTIONS[ 1 ];
		const view = getSavedViews( editor.scene ).find( ( item ) => item.id === viewSelect.value );
		const camera = view !== undefined ? cameraFromView( view, editor ) : editor.viewportCamera;

		busy = true;
		generate.dom.disabled = true;
		status.setTextContent( t( 'export/working' ) );

		try {

			const result = await exportImage( editor, { camera, width: resolution.width, height: resolution.height, fileName: nameInput.value } );
			status.setTextContent( t( 'export/done', result.fileName, result.width, result.height ) );
			status.dom.classList.remove( 'invalid' );
			context.notify( t( 'export/done', result.fileName, result.width, result.height ), 'success' );

		} catch ( error ) {

			console.error( error );
			const message = error instanceof ExportError ? error.message : t( 'export/error/generic' );
			status.setTextContent( message );
			status.dom.classList.add( 'invalid' );
			context.notify( message, 'error' );

		} finally {

			busy = false;
			generate.dom.disabled = false;

		}

	}

	document.addEventListener( 'mousedown', ( event ) => {

		if ( panel.dom.hidden === false && panel.dom.contains( event.target ) === false && anchor.contains( event.target ) === false ) close();

	} );

	editor.signals.editorCleared.add( close );

	return { open, close, toggle: () => ( panel.dom.hidden ? open() : close() ), isOpen: () => panel.dom.hidden === false };

}

export { RESOLUTIONS, ExportError, createExportCamera, cameraFromView, renderToCanvas, exportImage, safeFileName, SimpleModeImageExport };
