// EV-006 — Ferramentas de Construção e Montagem 3D
//
// Controlador ÚNICO de interação com o viewport no Modo Simples: medir, desenhar parede, criar piso,
// posicionar componente e apoiar objeto. Antes da EV-006 a régua tinha listeners próprios; agora todas as
// ferramentas interativas passam por aqui, então só uma pode estar ativa e nenhuma disputa os mesmos cliques.
//
// Captura de eventos (fase de captura no #viewport):
//   - mousedown / touchstart / dblclick: bloqueados enquanto uma ferramenta está ativa (o Viewport não
//     seleciona objetos nem foca a câmera);
//   - pointerdown continua livre: arrastar com o mouse continua girando/deslocando a vista;
//   - pointerup vira "clique" da ferramenta somente se o ponteiro andou menos que DRAG_THRESHOLD px;
//   - pointermove (sem botão pressionado) atualiza as prévias; Shift é repassado (modo ortogonal);
//   - Esc é entregue à ferramenta ativa (que decide cancelar o passo atual ou encerrar).

import * as THREE from 'three';

const DRAG_THRESHOLD = 4; // px

function Interaction( editor ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const viewport = document.getElementById( 'viewport' );

	const tools = new Map(); // id -> { activate( options ), deactivate(), onMove( info ), onClick( info ), onEscape(), onModifier( info ) }
	let activeId = null;
	let down = null;
	let lastInfo = null;

	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();

	// registro e ativação ------------------------------------------------------------------------------

	function register( id, tool ) {

		tools.set( id, tool );

	}

	function activate( id, options ) {

		if ( tools.has( id ) === false ) return;

		if ( activeId !== null ) deactivate();

		activeId = id;
		down = null;
		viewport.classList.add( 'tool-active', 'tool-' + id );

		tools.get( id ).activate( options );
		changed.dispatch( id );

	}

	function deactivate() {

		if ( activeId === null ) return;

		const id = activeId;
		activeId = null;
		down = null;
		viewport.classList.remove( 'tool-active', 'tool-' + id );

		tools.get( id ).deactivate();
		changed.dispatch( null );

	}

	// conversão tela -> mundo ------------------------------------------------------------------------------

	function makeInfo( event ) {

		const rect = viewport.getBoundingClientRect();

		ndc.set(
			( ( event.clientX - rect.left ) / rect.width ) * 2 - 1,
			- ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1
		);

		raycaster.setFromCamera( ndc, editor.viewportCamera );

		return {
			clientX: event.clientX,
			clientY: event.clientY,
			screen: new THREE.Vector2( event.clientX - rect.left, event.clientY - rect.top ),
			ray: raycaster.ray.clone(),
			raycaster,
			shiftKey: event.shiftKey === true
		};

	}

	// posição em pixels (relativa ao viewport) de um ponto do mundo
	function toScreen( point ) {

		const projected = point.clone().project( editor.viewportCamera );

		return new THREE.Vector2(
			( projected.x + 1 ) / 2 * viewport.clientWidth,
			( 1 - projected.y ) / 2 * viewport.clientHeight
		);

	}

	// eventos ----------------------------------------------------------------------------------------------------

	function block( event ) {

		if ( activeId !== null ) event.stopPropagation();

	}

	function onPointerDown( event ) {

		if ( activeId === null || event.button !== 0 || event.isPrimary === false ) return;

		down = { x: event.clientX, y: event.clientY };

	}

	function onPointerMove( event ) {

		if ( activeId === null || event.isPrimary === false ) return;
		if ( event.buttons !== 0 && event.pointerType === 'mouse' ) return; // arrastando a câmera: não mexe na prévia
		if ( event.target.tagName !== 'CANVAS' ) return;

		lastInfo = makeInfo( event );
		const tool = tools.get( activeId );
		if ( tool.onMove !== undefined ) tool.onMove( lastInfo );

	}

	function onPointerUp( event ) {

		if ( activeId === null || down === null || event.isPrimary === false ) return;

		const moved = Math.hypot( event.clientX - down.x, event.clientY - down.y );
		down = null;

		// arraste (girar/deslocar a vista) nunca cria nada; só cliques no próprio canvas contam
		if ( moved > DRAG_THRESHOLD || event.target.tagName !== 'CANVAS' ) return;

		lastInfo = makeInfo( event );
		const tool = tools.get( activeId );

		if ( tool.onMove !== undefined ) tool.onMove( lastInfo ); // toque não tem "hover": atualiza antes do clique
		if ( tool.onClick !== undefined ) tool.onClick( lastInfo );

	}

	function onKey( event ) {

		if ( activeId === null ) return;

		if ( event.type === 'keydown' && event.key === 'Escape' ) {

			event.preventDefault();
			const tool = tools.get( activeId );
			if ( tool.onEscape !== undefined ) tool.onEscape();
			else deactivate();
			return;

		}

		// Shift pressionado/solto muda o modo ortogonal sem precisar mover o mouse
		if ( event.key === 'Shift' && lastInfo !== null ) {

			lastInfo.shiftKey = event.type === 'keydown';
			const tool = tools.get( activeId );
			if ( tool.onMove !== undefined ) tool.onMove( lastInfo );

		}

	}

	if ( viewport !== null ) {

		viewport.addEventListener( 'mousedown', block, true );
		viewport.addEventListener( 'touchstart', block, true );
		viewport.addEventListener( 'dblclick', block, true );
		viewport.addEventListener( 'pointerdown', onPointerDown, true );
		viewport.addEventListener( 'pointermove', onPointerMove, true );
		viewport.addEventListener( 'pointerup', onPointerUp, true );

	}

	document.addEventListener( 'keydown', onKey );
	document.addEventListener( 'keyup', onKey );

	// projeto novo, modelo pronto ou projeto aberto: nenhuma ferramenta temporária sobrevive à troca de cena
	editor.signals.editorCleared.add( deactivate );

	return {
		DRAG_THRESHOLD,
		changed,
		viewport,
		register,
		activate,
		deactivate,
		toScreen,
		getActive: () => activeId,
		isActive: ( id ) => ( id === undefined ? activeId !== null : activeId === id ),
		refresh: () => {

			if ( activeId !== null && lastInfo !== null && tools.get( activeId ).onMove !== undefined ) tools.get( activeId ).onMove( lastInfo );

		}
	};

}

export { Interaction };
