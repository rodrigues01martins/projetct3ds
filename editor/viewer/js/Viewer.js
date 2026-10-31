// EV-012 — Visualizador Project3DS (somente leitura).
//
// Aplicativo independente do editor: um renderizador Three.js, uma câmera, controles de navegação e a camada de
// revisão. Não instancia o Editor, não acessa Meus projetos nem o estado salvo do editor, não lê parâmetros de URL
// e não carrega nada remoto: o único conteúdo vem do arquivo que o destinatário seleciona (ou arrasta) nesta página.
// Não existem ferramentas de modelagem aqui — mover, redimensionar ou apagar componentes não é possível porque
// esse código simplesmente não está carregado.

import * as THREE from 'three';

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { loadPackageFile } from './ViewerLoader.js';
import { ShareError } from '../../js/SimpleMode.ShareData.js';
import { ViewerControls } from './ViewerControls.js';
import { ViewerSelection } from './ViewerSelection.js';
import { ViewerComments } from './ViewerComments.js';

const UNIT_FACTORS = { m: 1, cm: 100, mm: 1000 };
const UNIT_DECIMALS = { m: 2, cm: 1, mm: 0 };

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function btn( label, onClick, className = '', title = label ) {

	const node = el( 'button', ( 'ViewerButton ' + className ).trim(), label );
	node.type = 'button';
	node.title = title;
	node.addEventListener( 'click', onClick );
	return node;

}

// estrutura da página ----------------------------------------------------------------------------------------------------

const app = el( 'div', 'ViewerApp' );
document.body.appendChild( app );

const topbar = el( 'header', 'ViewerTopbar' );
const brand = el( 'span', 'ViewerBrand', 'Visualizador Project3DS' );
const projectTitle = el( 'span', 'ViewerProjectTitle', '' );
const readonly = el( 'span', 'ViewerBadge', 'Somente leitura' );
readonly.hidden = true;
const fileInput = el( 'input' );
fileInput.type = 'file';
fileInput.accept = '.zip,application/zip';
fileInput.hidden = true;
fileInput.className = 'ViewerFileInput';
const openButton = btn( 'Abrir arquivo', () => fileInput.click(), 'primary ViewerOpen', 'Selecionar um arquivo .p3ds-review.zip' );
const helpButton = btn( 'Instruções', () => toggleHelp( true ), 'ViewerHelpButton' );
topbar.append( brand, projectTitle, readonly, el( 'span', 'ViewerSpacer' ), openButton, helpButton, fileInput );
app.appendChild( topbar );

const main = el( 'main', 'ViewerMain' );
app.appendChild( main );

// tela inicial
const start = el( 'section', 'ViewerStart' );
const drop = el( 'div', 'ViewerDrop' );
drop.tabIndex = 0;
drop.setAttribute( 'role', 'button' );
drop.setAttribute( 'aria-label', 'Selecionar ou arrastar o arquivo compartilhado' );
drop.append(
	el( 'h1', '', 'Visualizador Project3DS' ),
	el( 'p', 'ViewerLead', 'Abra um arquivo de projeto compartilhado para iniciar a visualização.' ),
	btn( 'Selecionar arquivo', ( event ) => {

		event.stopPropagation();
		fileInput.click();

	}, 'primary ViewerSelectFile' ),
	el( 'p', 'ViewerHint', 'ou arraste o arquivo .p3ds-review.zip para esta área' ),
	btn( 'Consultar instruções', ( event ) => {

		event.stopPropagation();
		toggleHelp( true );

	}, 'ViewerLink' )
);
const startError = el( 'p', 'ViewerError' );
startError.hidden = true;
startError.setAttribute( 'role', 'alert' );
drop.appendChild( startError );
start.appendChild( drop );
start.appendChild( el( 'p', 'ViewerPrivacy', 'O arquivo é lido apenas neste navegador: nada é enviado a servidores. Nenhum código contido no arquivo é executado.' ) );
main.appendChild( start );

// palco 3D
const stage = el( 'div', 'ViewerStage' );
stage.hidden = true;
const canvasHost = el( 'div', 'ViewerCanvas' );
const markerLayer = el( 'div', 'ViewerMarkers' );
const toolbar = el( 'div', 'ViewerToolbar' );
toolbar.setAttribute( 'role', 'toolbar' );
toolbar.setAttribute( 'aria-label', 'Navegação' );
stage.append( canvasHost, markerLayer, toolbar );
main.appendChild( stage );

// painel lateral
const side = el( 'aside', 'ViewerSide' );
side.hidden = true;
const tabs = el( 'div', 'ViewerTabs' );
tabs.setAttribute( 'role', 'tablist' );
const infoTab = el( 'button', 'ViewerTab active', 'Informações' );
const commentsTab = el( 'button', 'ViewerTab', 'Comentários' );
for ( const tab of [ infoTab, commentsTab ] ) {

	tab.type = 'button';
	tab.setAttribute( 'role', 'tab' );
	tabs.appendChild( tab );

}

infoTab.dataset.tab = 'info';
commentsTab.dataset.tab = 'comments';
const infoPanel = el( 'div', 'ViewerPanel ViewerInfo' );
const commentsPanel = el( 'div', 'ViewerPanel ViewerCommentsPanel' );
commentsPanel.hidden = true;
side.append( tabs, infoPanel, commentsPanel );
main.appendChild( side );

const toasts = el( 'div', 'ViewerToasts' );
toasts.setAttribute( 'aria-live', 'polite' );
app.appendChild( toasts );

const help = el( 'div', 'ViewerHelp' );
help.hidden = true;
const helpBox = el( 'div', 'ViewerHelpBox' );
helpBox.setAttribute( 'role', 'dialog' );
helpBox.setAttribute( 'aria-modal', 'true' );
helpBox.setAttribute( 'aria-label', 'Instruções' );
helpBox.appendChild( el( 'h2', '', 'Como usar o visualizador' ) );
const helpList = el( 'ul' );
for ( const line of [
	'Abrir: clique em "Abrir arquivo" ou arraste o arquivo .p3ds-review.zip recebido.',
	'Orbitar: arraste com o botão esquerdo. Deslocar: botão direito (ou dois dedos). Ampliar/reduzir: roda do mouse ou pinça.',
	'Enquadrar: use os botões da barra sobre o modelo. Vistas salvas: escolha na lista "Vistas".',
	'Caminhar: ative "Caminhar", use W A S D ou as setas e arraste para olhar; Esc sai do modo.',
	'Consultar: clique num componente para ver nome, tipo e dimensões.',
	'Comentar: com um componente selecionado, use "Comentar componente" (o ponto clicado fica marcado) ou registre um comentário geral.',
	'Devolver: em Comentários, informe seu nome e clique em "Exportar comentários". Envie o arquivo .p3ds-feedback.json ao responsável.',
	'O visualizador é somente leitura: não há como alterar o modelo. O nome informado é uma identificação declarada, não verificada.'
] ) helpList.appendChild( el( 'li', '', line ) );
helpBox.appendChild( helpList );
helpBox.appendChild( btn( 'Fechar', () => toggleHelp( false ), 'primary ViewerHelpClose' ) );
help.appendChild( helpBox );
app.appendChild( help );

function toggleHelp( open ) {

	help.hidden = open === false;
	if ( open ) helpBox.querySelector( '.ViewerHelpClose' ).focus();

}

help.addEventListener( 'mousedown', ( event ) => {

	if ( event.target === help ) toggleHelp( false );

} );
help.addEventListener( 'keydown', ( event ) => {

	if ( event.key === 'Escape' ) toggleHelp( false );

} );

function notify( message, type = 'info' ) {

	const toast = el( 'div', 'ViewerToast ' + type, message );
	toasts.appendChild( toast );
	setTimeout( () => toast.remove(), type === 'error' ? 7000 : 4500 );

}

// renderização -----------------------------------------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: false } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFShadowMap;
canvasHost.appendChild( renderer.domElement );

const scene = new THREE.Scene();
const helpers = new THREE.Scene(); // destaque da seleção: nunca faz parte do modelo
const camera = new THREE.PerspectiveCamera( 50, 1, 0.05, 1000 );
const pmrem = new THREE.PMREMGenerator( renderer );
let environmentTexture = null;

const viewer = { pkg: null, root: null, defaultLights: null, activeView: null, needsRender: true, loading: false };

const controls = new ViewerControls( camera, renderer.domElement, { onChange: () => {

	viewer.needsRender = true;
	if ( viewer.activeView !== null && viewer.applyingView !== true ) viewer.activeView = null;

} } );

const selection = new ViewerSelection( {
	camera,
	domElement: renderer.domElement,
	getRoot: () => viewer.root,
	helpers,
	isEnabled: () => controls.isWalking() === false,
	onSelect: () => {

		viewer.needsRender = true;
		renderInfo();
		comments.render();

	}
} );

const comments = new ViewerComments( {
	panel: commentsPanel,
	markerLayer,
	camera,
	controls,
	selection,
	getRoot: () => viewer.root,
	describeUnit,
	getActiveView: () => viewer.activeView,
	notify,
	onCountChange: ( count ) => {

		commentsTab.textContent = count > 0 ? `Comentários (${count})` : 'Comentários';

	}
} );

function resize() {

	const width = Math.max( canvasHost.clientWidth, 1 ), height = Math.max( canvasHost.clientHeight, 1 );
	renderer.setSize( width, height, false );
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	viewer.needsRender = true;

}

new ResizeObserver( resize ).observe( canvasHost );

function frame() {

	requestAnimationFrame( frame );
	if ( viewer.root === null ) return;
	selection.update();
	comments.updateMarkers();
	if ( viewer.needsRender === false && controls.isWalking() === false ) return;
	viewer.needsRender = false;
	renderer.autoClear = true;
	renderer.render( scene, camera );
	renderer.autoClear = false;
	renderer.render( helpers, camera );

}

requestAnimationFrame( frame );

// informações ------------------------------------------------------------------------------------------------------------

function formatLength( meters ) {

	const unit = viewer.pkg !== null ? viewer.pkg.manifest.display.units : 'm';
	const value = meters * UNIT_FACTORS[ unit ];
	return `${value.toLocaleString( 'pt-BR', { maximumFractionDigits: UNIT_DECIMALS[ unit ], minimumFractionDigits: 0 } )} ${unit}`;

}

function describeUnit( object ) {

	const share = object.userData.share || {};
	return {
		name: object.name || '',
		label: share.label || ( share.kind === 'opening' ? 'Abertura' : 'Componente' ),
		dims: share.dims || null,
		hosted: share.hosted === true
	};

}

function renderInfo() {

	infoPanel.textContent = '';
	const pkg = viewer.pkg;
	if ( pkg === null ) return;

	const object = selection.getSelected();
	const selectionBox = el( 'section', 'ViewerSection ViewerSelectionInfo' );
	selectionBox.appendChild( el( 'h2', '', 'Componente selecionado' ) );

	if ( object === null ) {

		selectionBox.appendChild( el( 'p', 'ViewerHint', 'Clique num componente do modelo para consultar suas informações.' ) );

	} else {

		const info = describeUnit( object );
		const list = el( 'dl', 'ViewerFacts' );
		const add = ( label, value ) => list.append( el( 'dt', '', label ), el( 'dd', '', value ) );
		add( 'Nome', info.name || '(nome não compartilhado)' );
		add( 'Tipo', info.label + ( info.hosted ? ' (hospedada em parede)' : '' ) );
		if ( info.dims !== null ) {

			add( 'Largura', formatLength( info.dims[ 0 ] ) );
			add( 'Altura', formatLength( info.dims[ 1 ] ) );
			add( 'Profundidade', formatLength( info.dims[ 2 ] ) );

		} else if ( pkg.manifest.contents.dimensions === false ) {

			add( 'Dimensões', 'não compartilhadas' );

		}

		selectionBox.appendChild( list );
		const row = el( 'div', 'ViewerRow' );
		row.append(
			btn( 'Adicionar comentário', () => {

				showTab( 'comments' );
				comments.startComment( 'object' );

			}, 'primary ViewerAddComment' ),
			btn( 'Enquadrar', () => controls.frameObject( object ), 'ViewerFrameSelected' ),
			btn( 'Limpar seleção', () => selection.select( null ), 'ViewerClearSelection' )
		);
		selectionBox.appendChild( row );

	}

	infoPanel.appendChild( selectionBox );

	const manifest = pkg.manifest;
	const project = el( 'section', 'ViewerSection' );
	project.appendChild( el( 'h2', '', 'Projeto compartilhado' ) );
	if ( pkg.previewURL !== null ) {

		const img = el( 'img', 'ViewerPreview' );
		img.alt = 'Imagem de capa do projeto';
		img.src = pkg.previewURL;
		project.appendChild( img );

	}

	const facts = el( 'dl', 'ViewerFacts' );
	const add = ( label, value ) => {

		if ( value ) facts.append( el( 'dt', '', label ), el( 'dd', '', value ) );

	};

	add( 'Projeto', manifest.title );
	add( 'Versão', manifest.source.versionLabel || ( manifest.source.revision !== null ? `Revisão ${manifest.source.revision}` : '' ) );
	add( 'Compartilhado em', manifest.createdAt ? new Date( manifest.createdAt ).toLocaleString( 'pt-BR' ) : '' );
	add( 'Descrição', manifest.description );
	add( 'Componentes', String( pkg.stats.units ) );
	add( 'Vistas salvas', String( pkg.views.length ) );
	add( 'Integridade', manifest.contentHash.startsWith( 'sha256:' ) ? 'conferida (SHA-256)' : 'conferida (verificação simplificada)' );
	project.appendChild( facts );

	const included = el( 'p', 'ViewerHint', 'Conteúdo: ' + [
		'geometria',
		manifest.contents.materials ? 'materiais' : null,
		manifest.contents.lighting ? 'iluminação' : null,
		manifest.contents.views ? 'vistas' : null,
		manifest.contents.names ? 'nomes' : null,
		manifest.contents.dimensions ? 'dimensões' : null
	].filter( Boolean ).join( ', ' ) + '.' );
	project.appendChild( included );

	if ( pkg.removed.length > 0 ) {

		const notes = el( 'div', 'ViewerBanner ViewerLimitations' );
		notes.appendChild( el( 'strong', '', 'Limitações desta visualização' ) );
		const list = el( 'ul' );
		for ( const item of pkg.removed ) list.appendChild( el( 'li', '', item ) );
		notes.appendChild( list );
		project.appendChild( notes );

	}

	project.appendChild( el( 'p', 'ViewerHint', 'O hash confere a integridade do conteúdo recebido, mas não comprova a autoria do arquivo.' ) );
	infoPanel.appendChild( project );

}

function showTab( name ) {

	infoTab.classList.toggle( 'active', name === 'info' );
	commentsTab.classList.toggle( 'active', name === 'comments' );
	infoTab.setAttribute( 'aria-selected', name === 'info' ? 'true' : 'false' );
	commentsTab.setAttribute( 'aria-selected', name === 'comments' ? 'true' : 'false' );
	infoPanel.hidden = name !== 'info';
	commentsPanel.hidden = name !== 'comments';

}

infoTab.addEventListener( 'click', () => showTab( 'info' ) );
commentsTab.addEventListener( 'click', () => showTab( 'comments' ) );

// barra de navegação -----------------------------------------------------------------------------------------------------

const viewSelect = el( 'select', 'ViewerSelect ViewerViews' );
viewSelect.setAttribute( 'aria-label', 'Vistas salvas' );
const walkButton = btn( 'Caminhar', () => controls.setWalking( controls.isWalking() === false ), 'ViewerWalk', 'Exploração em primeira pessoa (W A S D / setas; Esc sai)' );
toolbar.append(
	btn( 'Enquadrar projeto', () => controls.frameAll(), 'ViewerFrameAll' ),
	btn( 'Enquadrar seleção', () => {

		const object = selection.getSelected();
		if ( object === null ) notify( 'Selecione um componente para enquadrá-lo.' );
		else controls.frameObject( object );

	}, 'ViewerFrameSelection' ),
	btn( 'Vista inicial', () => controls.resetInitial(), 'ViewerReset' ),
	viewSelect,
	walkButton
);

controls.onWalkChange( ( walking ) => {

	walkButton.classList.toggle( 'active', walking );
	walkButton.textContent = walking ? 'Sair do modo caminhar' : 'Caminhar';
	if ( walking ) notify( 'Modo caminhar: W A S D ou setas para andar, arraste para olhar, Esc para sair.' );

} );

viewSelect.addEventListener( 'change', () => {

	const view = viewer.pkg !== null ? viewer.pkg.views.find( ( v ) => v.id === viewSelect.value ) : undefined;
	if ( view === undefined ) return;
	viewer.applyingView = true;
	controls.applyView( view );
	setTimeout( () => {

		viewer.applyingView = false;
		viewer.activeView = view;

	}, 500 );

} );

function fillViews( views ) {

	viewSelect.textContent = '';
	const placeholder = el( 'option', '', views.length > 0 ? `Vistas (${views.length})` : 'Sem vistas salvas' );
	placeholder.value = '';
	viewSelect.appendChild( placeholder );
	for ( const view of views ) {

		const option = el( 'option', '', view.name );
		option.value = view.id;
		viewSelect.appendChild( option );

	}

	viewSelect.disabled = views.length === 0;

}

// abertura de arquivos ---------------------------------------------------------------------------------------------------

function disposeCurrent() {

	if ( viewer.root === null ) return;
	selection.select( null );
	scene.remove( viewer.root );
	viewer.root.traverse( ( object ) => {

		if ( object.geometry ) object.geometry.dispose();
		for ( const material of [].concat( object.material || [] ) ) {

			for ( const value of Object.values( material ) ) if ( value && value.isTexture ) value.dispose();
			material.dispose();

		}

	} );
	if ( viewer.pkg !== null && viewer.pkg.previewURL !== null ) URL.revokeObjectURL( viewer.pkg.previewURL );
	viewer.root = null;
	viewer.pkg = null;

}

function applyDisplay( pkg, root ) {

	const display = pkg.manifest.display;
	renderer.toneMapping = display.toneMapping;
	renderer.toneMappingExposure = display.exposure;
	renderer.shadowMap.enabled = display.shadows;

	scene.background = root.background !== null && root.background !== undefined ? root.background : new THREE.Color( 0xaaaaaa );
	scene.fog = root.fog || null;
	root.background = null;
	root.fog = null;

	if ( environmentTexture !== null ) {

		environmentTexture.dispose();
		environmentTexture = null;

	}

	if ( display.environment !== 'None' ) {

		environmentTexture = pmrem.fromScene( new RoomEnvironment(), 0.04 ).texture;
		scene.environment = environmentTexture;
		scene.environmentIntensity = display.environment === 'Room' ? 1 : 0.35;

	} else {

		scene.environment = null;

	}

	let lights = 0;
	root.traverse( ( object ) => {

		if ( object.isLight ) lights ++;

	} );

	if ( viewer.defaultLights !== null ) scene.remove( viewer.defaultLights );
	viewer.defaultLights = null;
	if ( lights === 0 ) {

		// sem iluminação no pacote: iluminação neutra do próprio visualizador (não pertence ao modelo)
		const group = new THREE.Group();
		group.add( new THREE.HemisphereLight( 0xffffff, 0x8d8d8d, 1.6 ) );
		const sun = new THREE.DirectionalLight( 0xffffff, 1.6 );
		sun.position.set( 5, 10, 7 );
		group.add( sun );
		scene.add( group );
		viewer.defaultLights = group;

	}

}

async function openFile( file ) {

	if ( viewer.loading || file === undefined ) return;
	if ( comments.hasUnexported() && window.confirm( 'Há comentários ainda não exportados. Eles continuam no rascunho deste navegador para o pacote atual. Abrir outro arquivo?' ) === false ) return;

	viewer.loading = true;
	startError.hidden = true;
	openButton.disabled = true;

	try {

		const pkg = await loadPackageFile( file );
		disposeCurrent();
		viewer.pkg = pkg;
		viewer.root = pkg.root;
		applyDisplay( pkg, pkg.root );
		scene.add( pkg.root );
		pkg.root.updateMatrixWorld( true );

		start.hidden = true;
		stage.hidden = false;
		side.hidden = false;
		readonly.hidden = false;
		projectTitle.textContent = pkg.manifest.title;
		document.title = `${pkg.manifest.title} — Visualizador Project3DS`;
		resize();

		const box = new THREE.Box3().setFromObject( pkg.root );
		controls.setBounds( box );
		const firstView = pkg.views[ 0 ];
		if ( firstView !== undefined ) controls.applyView( firstView, 0 );
		else controls.frameAll( 0 );
		controls.saveInitial();
		viewer.activeView = null;
		fillViews( pkg.views );
		renderInfo();
		comments.setPackage( pkg.manifest );
		showTab( 'info' );
		viewer.needsRender = true;
		for ( const toast of toasts.querySelectorAll( '.ViewerToast.error' ) ) toast.remove();
		notify( `Projeto "${pkg.manifest.title}" aberto (integridade conferida).` );

	} catch ( error ) {

		// recusas esperadas (arquivo inválido, adulterado, grande demais) são avisos; o resto é erro inesperado
		if ( error instanceof ShareError ) console.warn( 'Pacote recusado:', error.message );
		else console.error( error );
		const message = error instanceof ShareError ? error.message : 'Não foi possível abrir o arquivo.';
		if ( viewer.root === null ) {

			startError.textContent = message;
			startError.hidden = false;

		}

		notify( message, 'error' );

	} finally {

		viewer.loading = false;
		openButton.disabled = false;

	}

}

fileInput.addEventListener( 'change', () => {

	const file = fileInput.files[ 0 ];
	fileInput.value = '';
	openFile( file );

} );

drop.addEventListener( 'click', () => fileInput.click() );
drop.addEventListener( 'keydown', ( event ) => {

	if ( event.key === 'Enter' || event.key === ' ' ) {

		event.preventDefault();
		fileInput.click();

	}

} );

for ( const target of [ drop, stage ] ) {

	target.addEventListener( 'dragover', ( event ) => {

		event.preventDefault();
		drop.classList.add( 'dragging' );

	} );
	target.addEventListener( 'dragleave', () => drop.classList.remove( 'dragging' ) );
	target.addEventListener( 'drop', ( event ) => {

		event.preventDefault();
		drop.classList.remove( 'dragging' );
		const file = event.dataTransfer && event.dataTransfer.files[ 0 ];
		if ( file ) openFile( file );

	} );

}

window.addEventListener( 'dragover', ( event ) => event.preventDefault() );
window.addEventListener( 'drop', ( event ) => event.preventDefault() );

window.addEventListener( 'beforeunload', ( event ) => {

	if ( comments.hasUnexported() ) {

		event.preventDefault();
		event.returnValue = '';

	}

} );

// diagnóstico para testes automatizados (somente leitura: expõe consultas, nenhuma operação de edição)
window.project3dsViewer = Object.freeze( {
	isLoaded: () => viewer.root !== null,
	getManifest: () => viewer.pkg !== null ? JSON.parse( JSON.stringify( viewer.pkg.manifest ) ) : null,
	getStats: () => viewer.pkg !== null ? Object.assign( {}, viewer.pkg.stats ) : null,
	getViews: () => viewer.pkg !== null ? viewer.pkg.views.map( ( v ) => v.name ) : [],
	getRemoved: () => viewer.pkg !== null ? viewer.pkg.removed.slice() : [],
	getSelected: () => {

		const object = selection.getSelected();
		return object !== null ? Object.assign( { uuid: object.uuid }, describeUnit( object ) ) : null;

	},
	cameraState: () => controls.cameraState(),
	projectToScreen: ( uuid, where = 'top' ) => {

		const object = viewer.root !== null ? viewer.root.getObjectByProperty( 'uuid', uuid ) : undefined;
		if ( object === undefined ) return null;
		// centro da face superior (ponto visível na maioria dos enquadramentos)
		const box = new THREE.Box3().setFromObject( object );
		const center = box.getCenter( new THREE.Vector3() );
		if ( where === 'top' ) center.y = box.max.y - Math.min( 0.02, ( box.max.y - box.min.y ) / 4 );
		center.project( camera );
		const rect = renderer.domElement.getBoundingClientRect();
		return { x: rect.left + ( center.x + 1 ) / 2 * rect.width, y: rect.top + ( 1 - center.y ) / 2 * rect.height };

	},
	findByName: ( name ) => {

		let found = null;
		if ( viewer.root !== null ) viewer.root.traverse( ( o ) => {

			if ( found === null && o.name === name ) found = o.uuid;

		} );
		return found;

	},
	// amostra de cores de uma renderização (conferência de que a cena aparece; não altera nada)
	sampleColors: () => {

		if ( viewer.root === null ) return 0;
		const target = new THREE.WebGLRenderTarget( 64, 64 );
		renderer.setRenderTarget( target );
		renderer.render( scene, camera );
		const pixels = new Uint8Array( 64 * 64 * 4 );
		renderer.readRenderTargetPixels( target, 0, 0, 64, 64, pixels );
		renderer.setRenderTarget( null );
		target.dispose();
		viewer.needsRender = true;
		const colors = new Set();
		for ( let i = 0; i < pixels.length; i += 4 ) colors.add( ( pixels[ i ] >> 4 ) + ',' + ( pixels[ i + 1 ] >> 4 ) + ',' + ( pixels[ i + 2 ] >> 4 ) );
		return colors.size;

	},
	snapshot: () => viewer.root !== null ? JSON.stringify( viewer.root.children.map( ( o ) => [ o.uuid, o.matrixWorld.elements.map( ( v ) => Math.round( v * 1e6 ) ) ] ) ) : null
} );
