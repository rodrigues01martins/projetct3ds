// EV-008 — Sistema de Visualização, Câmeras e Apresentação de Projetos 3D
//
// Interface de visualização do Modo Simples:
//   - seletor "Vistas" na barra de opções (após Encaixe, Grade e Luz) (Perspectiva, Superior, Frontal, Posterior, Direita, Esquerda; teclas 1–6);
//   - controles junto ao viewport: Explorar, Enquadrar projeto, Enquadrar seleção e Minhas vistas;
//   - painel "Minhas vistas": salvar, ir, renomear, reordenar, excluir e apresentar.
// Ir até uma vista só move a câmera; salvar/renomear/reordenar/excluir alteram o projeto (SetSavedViewsCommand).

import { UIDiv } from './libs/ui.js';

import { SetSavedViewsCommand } from './commands/SetSavedViewsCommand.js';

import { getSavedViews, createView, suggestName, cleanName, SAVED_VIEW_LIMITS } from './SimpleMode.SavedViews.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

const VIEW_ORDER = [ 'perspective', 'top', 'front', 'back', 'right', 'left' ];

function SimpleModeViewPanel( editor, context, optionsBar, container ) {

	const cameras = context.cameras;
	const interaction = context.interaction;

	// seletor "Vistas" ------------------------------------------------------------------------------------------

	const field = document.createElement( 'label' );
	field.className = 'SimpleOption SimpleViewSelect';
	field.title = t( 'views/title' );
	field.appendChild( createIcon( 'views' ) );
	field.appendChild( Object.assign( document.createElement( 'span' ), { className: 'SimpleOptionLabel', textContent: t( 'views/label' ) } ) );

	const select = document.createElement( 'select' );
	select.className = 'SimpleSelect';
	select.setAttribute( 'aria-label', t( 'views/title' ) );

	const custom = Object.assign( document.createElement( 'option' ), { value: '', textContent: t( 'views/custom' ), disabled: true } );
	select.appendChild( custom );

	VIEW_ORDER.forEach( ( id, index ) => {

		select.appendChild( Object.assign( document.createElement( 'option' ), { value: id, textContent: t( 'views/' + id ) + ' (' + ( index + 1 ) + ')', title: t( 'views/' + id + '/title' ) } ) );

	} );

	select.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
	select.addEventListener( 'change', () => selectView( select.value ) );
	field.appendChild( select );
	optionsBar.dom.appendChild( field ); // depois de Encaixe, Grade e Luz

	function selectView( id ) {

		if ( interaction.isActive( 'explore' ) || interaction.isActive( 'present' ) ) interaction.deactivate();
		cameras.setView( id );

	}

	// teclas 1–6 (indicadas no seletor); ignoradas ao digitar ou com uma ferramenta de exploração/apresentação ativa
	document.addEventListener( 'keydown', ( event ) => {

		if ( document.body.classList.contains( 'mode-simple' ) === false ) return;
		if ( event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ) return;
		if ( event.target !== null && ( event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test( event.target.tagName ) ) ) return;
		if ( interaction.isActive( 'explore' ) || interaction.isActive( 'present' ) ) return;

		const index = [ '1', '2', '3', '4', '5', '6' ].indexOf( event.key );
		if ( index === - 1 ) return;

		event.preventDefault();
		selectView( VIEW_ORDER[ index ] );

	} );

	// controles junto ao viewport -------------------------------------------------------------------------------

	const controls = new UIDiv().setClass( 'SimpleViewControls' );
	controls.dom.setAttribute( 'role', 'toolbar' );
	controls.dom.setAttribute( 'aria-label', t( 'views/controls' ) );
	controls.dom.setAttribute( 'aria-orientation', 'vertical' );
	container.add( controls );

	const exploreButton = createSimpleButton( { icon: 'walk', title: t( 'explore/button/title' ), className: 'SimpleViewControl', onClick: () => {

		if ( interaction.isActive( 'explore' ) ) context.walkthrough.exit( false );
		else context.startTool( 'explore' );

	} } );
	exploreButton.dom.dataset.control = 'explore';
	exploreButton.dom.setAttribute( 'aria-pressed', 'false' );

	const frameAll = createSimpleButton( { icon: 'frameAll', title: t( 'views/frameProject/title' ), className: 'SimpleViewControl', onClick: () => {

		if ( cameras.frameProject() === false ) context.notify( t( 'views/frameProject/empty' ) );

	} } );
	frameAll.dom.dataset.control = 'frameProject';

	const frameSelected = createSimpleButton( { icon: 'frameSelection', title: t( 'views/frameSelection/title' ), className: 'SimpleViewControl', onClick: () => {

		if ( editor.selected === null || editor.selected === editor.scene ) return context.notify( t( 'message/nothingSelected' ) );
		cameras.frameSelection( editor.selected );

	} } );
	frameSelected.dom.dataset.control = 'frameSelection';

	const savedButton = createSimpleButton( { icon: 'camera', title: t( 'saved/open/title' ), className: 'SimpleViewControl', onClick: () => ( panel.dom.hidden ? openPanel() : closePanel() ) } );
	savedButton.dom.dataset.control = 'savedViews';
	savedButton.dom.setAttribute( 'aria-haspopup', 'dialog' );
	savedButton.dom.setAttribute( 'aria-expanded', 'false' );
	savedButton.dom.setAttribute( 'aria-controls', 'simple-saved-views' );

	controls.add( exploreButton, frameAll, frameSelected, savedButton );

	// painel "Minhas vistas" --------------------------------------------------------------------------------------

	const panel = new UIDiv().setClass( 'SimpleLighting SimpleSavedViews' );
	panel.dom.id = 'simple-saved-views';
	panel.dom.setAttribute( 'role', 'dialog' );
	panel.dom.setAttribute( 'aria-label', t( 'saved/title' ) );
	panel.dom.hidden = true;
	container.add( panel );

	const header = new UIDiv().setClass( 'SimpleHelpHeader' );
	header.add( createText( t( 'saved/title' ), 'SimpleHelpTitle' ) );
	header.add( createSimpleButton( { icon: 'close', title: t( 'saved/close' ), className: 'SimpleIconButton', onClick: closePanel } ) );
	panel.add( header );

	const saveForm = document.createElement( 'form' );
	saveForm.className = 'SimpleSavedViewForm';
	saveForm.noValidate = true;

	const nameInput = Object.assign( document.createElement( 'input' ), { className: 'SimpleTextInput', maxLength: SAVED_VIEW_LIMITS.name, placeholder: t( 'saved/name/placeholder' ) } );
	nameInput.setAttribute( 'aria-label', t( 'saved/name' ) );
	nameInput.addEventListener( 'keydown', ( event ) => {

		event.stopPropagation();
		if ( event.key === 'Escape' ) closePanel();

	} );
	saveForm.appendChild( nameInput );

	const saveButton = createSimpleButton( { icon: 'bookmark', label: t( 'saved/save' ), title: t( 'saved/save/title' ), className: 'active SimpleSaveView' } );
	saveButton.dom.type = 'submit';
	saveForm.appendChild( saveButton.dom );
	saveForm.addEventListener( 'submit', ( event ) => {

		event.preventDefault();
		saveCurrent( nameInput.value );

	} );
	panel.dom.appendChild( saveForm );

	const list = document.createElement( 'ol' );
	list.className = 'SimpleSavedViewList';
	list.setAttribute( 'aria-label', t( 'saved/list' ) );
	panel.dom.appendChild( list );

	const empty = createText( t( 'saved/empty' ), 'SimpleSectionHint SimpleSavedViewEmpty' );
	panel.add( empty );

	const footer = new UIDiv().setClass( 'SimpleActions SimpleSavedViewFooter' );
	footer.add( createSimpleButton( { icon: 'present', label: t( 'present/start' ), title: t( 'present/start/title' ), onClick: () => {

		closePanel();
		context.presentation.start();

	} } ) );
	panel.add( footer );

	let renaming = null; // id em edição de nome

	function commit( views, name ) {

		editor.execute( new SetSavedViewsCommand( editor, views, name ) );

	}

	function saveCurrent( rawName ) {

		const views = getSavedViews( editor.scene );

		if ( views.length >= SAVED_VIEW_LIMITS.count ) {

			context.notify( t( 'saved/limit', SAVED_VIEW_LIMITS.count ), 'warning' );
			return null;

		}

		if ( interaction.isActive( 'explore' ) === false ) cameras.cancelTransition();

		const view = createView( cameras.captureState(), cleanName( rawName, suggestName( views ) ) );
		if ( view === null ) {

			context.notify( t( 'saved/invalid' ), 'error' );
			return null;

		}

		commit( views.concat( view ), t( 'saved/command/save' ) );
		nameInput.value = '';
		context.notify( t( 'saved/saved', view.name ), 'success' );
		return view;

	}

	function goTo( id ) {

		const view = getSavedViews( editor.scene ).find( ( item ) => item.id === id );
		if ( view === undefined ) return;

		if ( interaction.isActive( 'explore' ) ) context.walkthrough.exit( true ); // a vista escolhida substitui a anterior
		cameras.transitionTo( view );

	}

	function rename( id, name ) {

		const views = getSavedViews( editor.scene );
		const view = views.find( ( item ) => item.id === id );
		renaming = null;

		if ( view === undefined ) return render();

		const clean = cleanName( name, view.name );
		if ( clean === view.name ) return render();

		view.name = clean;
		commit( views, t( 'saved/command/rename' ) );

	}

	function move( id, delta ) {

		const views = getSavedViews( editor.scene );
		const index = views.findIndex( ( item ) => item.id === id );
		const target = index + delta;
		if ( index === - 1 || target < 0 || target >= views.length ) return;

		[ views[ index ], views[ target ] ] = [ views[ target ], views[ index ] ];
		commit( views, t( 'saved/command/reorder' ) );
		requestAnimationFrame( () => {

			const button = list.querySelector( `[data-view="${id}"] [data-action="${delta < 0 ? 'up' : 'down'}"]` );
			if ( button !== null && button.disabled === false ) button.focus();

		} );

	}

	function remove( id ) {

		const views = getSavedViews( editor.scene );
		const view = views.find( ( item ) => item.id === id );
		if ( view === undefined ) return;

		commit( views.filter( ( item ) => item.id !== id ), t( 'saved/command/delete' ) );
		context.notify( t( 'saved/deleted', view.name ) );

	}

	function actionButton( icon, title, action, disabled = false ) {

		const button = createSimpleButton( { icon, title, className: 'SimpleIconButton' } ).dom;
		button.dataset.action = action;
		button.disabled = disabled;
		return button;

	}

	function render() {

		const views = getSavedViews( editor.scene );
		list.textContent = '';
		empty.dom.hidden = views.length > 0;
		footer.dom.hidden = views.length === 0;

		views.forEach( ( view, index ) => {

			const item = document.createElement( 'li' );
			item.className = 'SimpleSavedView';
			item.dataset.view = view.id;

			const number = Object.assign( document.createElement( 'span' ), { className: 'SimpleSavedViewNumber', textContent: String( index + 1 ) } );
			item.appendChild( number );

			if ( renaming === view.id ) {

				const input = Object.assign( document.createElement( 'input' ), { className: 'SimpleTextInput SimpleSavedViewRename', value: view.name, maxLength: SAVED_VIEW_LIMITS.name } );
				input.setAttribute( 'aria-label', t( 'saved/rename/title', view.name ) );
				let done = false;
				input.addEventListener( 'keydown', ( event ) => {

					event.stopPropagation();
					if ( event.key === 'Enter' ) {

						done = true;
						rename( view.id, input.value );

					} else if ( event.key === 'Escape' ) {

						done = true;
						renaming = null;
						render();

					}

				} );
				input.addEventListener( 'blur', () => {

					if ( done === false ) rename( view.id, input.value );

				} );
				item.appendChild( input );
				requestAnimationFrame( () => {

					input.focus();
					input.select();

				} );

			} else {

				const go = document.createElement( 'button' );
				go.type = 'button';
				go.className = 'SimpleSavedViewGo';
				go.title = t( 'saved/go/title', view.name );
				go.appendChild( createIcon( view.projection === 'orthographic' ? 'views' : 'camera' ) );
				go.appendChild( Object.assign( document.createElement( 'span' ), { className: 'SimpleSavedViewName', textContent: view.name } ) );
				go.addEventListener( 'click', () => goTo( view.id ) );
				item.appendChild( go );

			}

			const actions = document.createElement( 'span' );
			actions.className = 'SimpleSavedViewActions';

			const editButton = actionButton( 'edit', t( 'saved/rename/title', view.name ), 'rename' );
			editButton.addEventListener( 'click', () => {

				renaming = view.id;
				render();

			} );

			const up = actionButton( 'up', t( 'saved/up/title', view.name ), 'up', index === 0 );
			up.addEventListener( 'click', () => move( view.id, - 1 ) );

			const down = actionButton( 'down', t( 'saved/down/title', view.name ), 'down', index === views.length - 1 );
			down.addEventListener( 'click', () => move( view.id, 1 ) );

			const del = actionButton( 'delete', t( 'saved/delete/title', view.name ), 'delete' );
			del.addEventListener( 'click', () => remove( view.id ) );

			actions.append( editButton, up, down, del );
			item.appendChild( actions );
			list.appendChild( item );

		} );

	}

	function openPanel() {

		if ( context.lightingPanel !== undefined ) context.lightingPanel.close();
		render();
		panel.dom.hidden = false;
		savedButton.dom.setAttribute( 'aria-expanded', 'true' );
		savedButton.dom.classList.add( 'active' );
		nameInput.placeholder = suggestName( getSavedViews( editor.scene ) );
		nameInput.focus();

	}

	function closePanel() {

		if ( panel.dom.hidden ) return;
		panel.dom.hidden = true;
		renaming = null;
		savedButton.dom.setAttribute( 'aria-expanded', 'false' );
		savedButton.dom.classList.remove( 'active' );

	}

	// estado visual ------------------------------------------------------------------------------------------------

	function updateViewState() {

		const active = cameras.getActiveView();
		select.value = active !== null ? active : '';
		custom.hidden = active !== null;
		field.classList.toggle( 'orthographic', cameras.isOrthographic() );

	}

	function updateExplore() {

		const exploring = interaction.isActive( 'explore' );
		exploreButton.dom.classList.toggle( 'active', exploring );
		exploreButton.dom.setAttribute( 'aria-pressed', exploring );

	}

	function updateSelection() {

		const has = editor.selected !== null && editor.selected !== editor.scene;
		frameSelected.dom.classList.toggle( 'disabled', has === false );
		frameSelected.dom.setAttribute( 'aria-disabled', has === false );

	}

	cameras.changed.add( updateViewState );
	interaction.changed.add( updateExplore );
	editor.signals.objectSelected.add( updateSelection );
	editor.signals.sceneGraphChanged.add( () => {

		if ( panel.dom.hidden === false && renaming === null ) render();

	} );
	editor.signals.historyChanged.add( () => {

		if ( panel.dom.hidden === false && renaming === null ) render();

	} );
	editor.signals.editorCleared.add( () => {

		closePanel();
		updateViewState();

	} );

	updateViewState();
	updateExplore();
	updateSelection();

	return { openPanel, closePanel, saveCurrent, goTo, render, selectView };

}

export { SimpleModeViewPanel, VIEW_ORDER };
