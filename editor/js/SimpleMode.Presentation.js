// EV-008 — Sistema de Visualização, Câmeras e Apresentação de Projetos 3D
//
// "Apresentar projeto": navegação local pela sequência de "Minhas vistas".
//   - ferramenta do controlador único (encerra medir/desenhar/explorar; cliques não selecionam objetos);
//   - painéis de edição ocultos, viewport ampliado, vista limpa (sem grade, alças e seleção);
//   - → / PageDown / espaço: próxima · ← / PageUp: anterior · Esc: sair;
//   - tela cheia só por clique no botão (se negada, continua na janela);
//   - ao sair, a vista de antes da apresentação e a interface de edição voltam como estavam.

import { UIDiv } from './libs/ui.js';

import { getSavedViews } from './SimpleMode.SavedViews.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';

function Presentation( editor, context, interaction, cameras ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const state = { active: false, views: [], index: 0, previous: null, fullscreenByUs: false };

	function go( index ) {

		if ( state.active === false || state.views.length === 0 ) return;

		state.index = ( index + state.views.length ) % state.views.length;
		cameras.transitionTo( state.views[ state.index ] );
		changed.dispatch();

	}

	const next = () => go( state.index + 1 );
	const previous = () => go( state.index - 1 );

	function onKey( event ) {

		if ( event.target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test( event.target.tagName ) ) return;

		let handled = true;

		switch ( event.key ) {

			case 'ArrowRight': case 'PageDown': case ' ': next(); break;
			case 'ArrowLeft': case 'PageUp': previous(); break;
			case 'Home': go( 0 ); break;
			case 'End': go( state.views.length - 1 ); break;
			default: handled = false;

		}

		if ( handled ) {

			event.preventDefault();
			event.stopImmediatePropagation();

		}

	}

	function onFullscreenChange() {

		if ( document.fullscreenElement === null ) state.fullscreenByUs = false;
		changed.dispatch();
		editor.signals.windowResize.dispatch();

	}

	function activate() {

		state.views = getSavedViews( editor.scene );
		state.previous = cameras.captureState();
		state.active = true;
		state.index = 0;

		document.body.classList.add( 'presenting' );
		editor.hideViewportHelpers = true;
		window.addEventListener( 'keydown', onKey, true );
		document.addEventListener( 'fullscreenchange', onFullscreenChange );

		editor.signals.windowResize.dispatch(); // viewport ampliado: renderer e câmera recalculados
		cameras.transitionTo( state.views[ 0 ], { duration: 0 } );
		changed.dispatch();

	}

	function deactivate() {

		if ( state.active === false ) return;

		state.active = false;
		window.removeEventListener( 'keydown', onKey, true );
		document.removeEventListener( 'fullscreenchange', onFullscreenChange );
		if ( state.fullscreenByUs && document.fullscreenElement !== null && document.exitFullscreen !== undefined ) document.exitFullscreen().catch( () => {} );
		state.fullscreenByUs = false;

		document.body.classList.remove( 'presenting' );
		editor.hideViewportHelpers = false;
		editor.signals.windowResize.dispatch();

		cameras.cancelTransition();
		if ( state.previous !== null ) cameras.applyState( state.previous );
		state.previous = null;
		changed.dispatch();

	}

	interaction.register( 'present', { activate, deactivate, onEscape: () => interaction.deactivate() } );

	function start() {

		if ( getSavedViews( editor.scene ).length === 0 ) {

			context.notify( t( 'present/empty' ), 'warning' );
			return false;

		}

		if ( context.planView !== undefined ) context.planView.close(); // EV-009: a apresentação usa a cena 3D
		context.startTool( 'present' );
		return true;

	}

	async function toggleFullscreen() {

		if ( document.fullscreenElement !== null && document.fullscreenElement !== undefined ) {

			await document.exitFullscreen().catch( () => {} );
			return;

		}

		const root = document.documentElement;

		if ( typeof root.requestFullscreen !== 'function' || document.fullscreenEnabled === false ) {

			context.notify( t( 'present/fullscreen/unavailable' ), 'warning' );
			return;

		}

		try {

			await root.requestFullscreen();
			state.fullscreenByUs = true;

		} catch ( error ) {

			context.notify( t( 'present/fullscreen/unavailable' ), 'warning' );

		}

	}

	return { changed, state, start, stop: () => interaction.deactivate(), next, previous, go, toggleFullscreen, isActive: () => state.active };

}

// barra discreta da apresentação ---------------------------------------------------------------------------------

function SimpleModePresentationBar( editor, context ) {

	const presentation = context.presentation;

	const bar = new UIDiv().setClass( 'SimplePresentationBar' );
	bar.dom.setAttribute( 'role', 'toolbar' );
	bar.dom.setAttribute( 'aria-label', t( 'present/title' ) );
	bar.dom.hidden = true;

	bar.add( createSimpleButton( { icon: 'previous', title: t( 'present/previous' ), className: 'SimpleIconButton SimplePresentPrev', onClick: () => presentation.previous() } ) );

	const info = new UIDiv().setClass( 'SimplePresentationInfo' );
	info.dom.setAttribute( 'aria-live', 'polite' );
	const name = createText( '', 'SimplePresentationName' );
	const position = createText( '', 'SimplePresentationPosition' );
	info.add( name, position );
	bar.add( info );

	bar.add( createSimpleButton( { icon: 'next', title: t( 'present/next' ), className: 'SimpleIconButton SimplePresentNext', onClick: () => presentation.next() } ) );

	const fullscreen = createSimpleButton( { icon: 'fullscreen', title: t( 'present/fullscreen' ), className: 'SimpleIconButton SimplePresentFullscreen', onClick: () => presentation.toggleFullscreen() } );
	bar.add( fullscreen );

	bar.add( createSimpleButton( { icon: 'close', label: t( 'present/exit' ), title: t( 'present/exit/title' ), className: 'SimplePresentExit', onClick: () => presentation.stop() } ) );

	function refresh() {

		const state = presentation.state;
		bar.dom.hidden = state.active === false;
		if ( state.active === false || state.views.length === 0 ) return;

		const view = state.views[ state.index ];
		name.setTextContent( view.name );
		position.setTextContent( t( 'present/position', state.index + 1, state.views.length ) );
		fullscreen.dom.title = document.fullscreenElement ? t( 'present/fullscreen/exit' ) : t( 'present/fullscreen' );

	}

	presentation.changed.add( refresh );
	refresh();

	return bar;

}

export { Presentation, SimpleModePresentationBar };
