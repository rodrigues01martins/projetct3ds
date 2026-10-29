// EV-001 — Modo Simples de Criação 3D
// A. Barra superior: nome do projeto, novo/abrir/salvar, desfazer/refazer e alternância de modo

import { UIDiv, UIInput } from './libs/ui.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

function SimpleModeTopbar( editor, context ) {

	const signals = editor.signals;
	const config = editor.config;

	const container = new UIDiv();
	container.setId( 'simple-topbar' );
	container.dom.setAttribute( 'role', 'toolbar' );
	container.dom.setAttribute( 'aria-label', 'Barra do projeto' );

	// marca + nome do projeto

	const brand = createText( 'project3ds', 'SimpleBrand' );
	container.add( brand );

	const projectName = new UIInput( config.getKey( 'project/title' ) );
	projectName.setClass( 'SimpleProjectName' );
	projectName.dom.placeholder = t( 'topbar/projectName/placeholder' );
	projectName.dom.title = t( 'topbar/projectName' );
	projectName.dom.setAttribute( 'aria-label', t( 'topbar/projectName' ) );
	projectName.dom.maxLength = 80;
	projectName.dom.addEventListener( 'change', function () {

		config.setKey( 'project/title', projectName.getValue().trim() );

	} );
	projectName.dom.addEventListener( 'keydown', function ( event ) {

		if ( event.key === 'Enter' ) projectName.dom.blur();

	} );
	container.add( projectName );

	// o título é limpo pelo editor quando a cena é reiniciada (Sidebar.Project.App)

	signals.editorCleared.add( function () {

		projectName.setValue( config.getKey( 'project/title' ) );

	} );

	// EV-005: projetos abertos por outros fluxos (modelos prontos, recuperação) atualizam o nome exibido
	signals.sceneGraphChanged.add( function () {

		if ( document.activeElement !== projectName.dom ) projectName.setValue( config.getKey( 'project/title' ) || '' );

	} );

	// arquivo

	const fileGroup = new UIDiv().setClass( 'SimpleGroup' );
	container.add( fileGroup );

	// EV-005: "Novo" oferece projeto em branco (comportamento original) ou um projeto pronto
	const newButton = createSimpleButton( {
		icon: 'new', label: t( 'topbar/new' ), title: t( 'topbar/new/title' ),
		onClick: () => ( newMenu.hidden ? openNewMenu() : closeNewMenu() )
	} );
	newButton.dom.setAttribute( 'aria-haspopup', 'menu' );
	newButton.dom.setAttribute( 'aria-expanded', 'false' );
	fileGroup.add( newButton );

	const newMenu = document.createElement( 'div' );
	newMenu.className = 'SimpleMenu';
	newMenu.setAttribute( 'role', 'menu' );
	newMenu.setAttribute( 'aria-label', t( 'topbar/new' ) );
	newMenu.hidden = true;

	for ( const [ key, icon, action ] of [[ 'blank', 'new', newProject ], [ 'template', 'templates', () => context.openTemplates() ]] ) {

		const item = document.createElement( 'button' );
		item.type = 'button';
		item.className = 'SimpleMenuItem';
		item.setAttribute( 'role', 'menuitem' );
		item.tabIndex = - 1;
		item.appendChild( createIcon( icon ) );

		const text = document.createElement( 'span' );
		const strong = document.createElement( 'strong' );
		strong.textContent = t( 'topbar/new/' + key );
		const hint = document.createElement( 'small' );
		hint.textContent = t( 'topbar/new/' + key + '/hint' );
		text.append( strong, hint );
		item.appendChild( text );

		item.addEventListener( 'click', () => {

			closeNewMenu( false );
			action();

		} );
		newMenu.appendChild( item );

	}

	newMenu.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation();
		const items = [ ...newMenu.querySelectorAll( '.SimpleMenuItem' ) ];
		const index = items.indexOf( document.activeElement );

		if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {

			event.preventDefault();
			items[ ( index + ( event.key === 'ArrowDown' ? 1 : items.length - 1 ) ) % items.length ].focus();

		} else if ( event.key === 'Escape' || event.key === 'Tab' ) {

			event.preventDefault();
			closeNewMenu();

		}

	} );

	document.body.appendChild( newMenu );

	function openNewMenu() {

		const rect = newButton.dom.getBoundingClientRect();
		newMenu.style.left = Math.max( 8, Math.min( rect.left, window.innerWidth - 288 ) ) + 'px';
		newMenu.style.top = ( rect.bottom + 6 ) + 'px';
		newMenu.hidden = false;
		newButton.dom.setAttribute( 'aria-expanded', 'true' );
		newMenu.querySelector( '.SimpleMenuItem' ).focus();

	}

	function closeNewMenu( restoreFocus = true ) {

		if ( newMenu.hidden ) return;

		newMenu.hidden = true;
		newButton.dom.setAttribute( 'aria-expanded', 'false' );
		if ( restoreFocus ) newButton.dom.focus();

	}

	document.addEventListener( 'mousedown', ( event ) => {

		if ( newMenu.hidden === false && newMenu.contains( event.target ) === false && newButton.dom.contains( event.target ) === false ) closeNewMenu( false );

	} );

	fileGroup.add( createSimpleButton( {
		icon: 'open', label: t( 'topbar/open' ), title: t( 'topbar/open/title' ),
		onClick: function () {

			if ( editor.scene.children.length > 0 && confirm( t( 'confirm/open' ) ) === false ) return;

			openInput.click();

		}
	} ) );

	fileGroup.add( createSimpleButton( {
		icon: 'save', label: t( 'topbar/save' ), title: t( 'topbar/save/title' ),
		onClick: saveProject
	} ) );

	// histórico

	const historyGroup = new UIDiv().setClass( 'SimpleGroup' );
	container.add( historyGroup );

	const undo = createSimpleButton( {
		icon: 'undo', label: t( 'topbar/undo' ), title: t( 'topbar/undo/title' ),
		onClick: function () {

			if ( editor.history.undos.length === 0 ) return context.notify( t( 'message/nothingToUndo' ) );
			if ( editor.history.historyDisabled ) return context.notify( t( 'message/historyLocked' ), 'warning' );

			editor.undo();

		}
	} );
	historyGroup.add( undo );

	const redo = createSimpleButton( {
		icon: 'redo', label: t( 'topbar/redo' ), title: t( 'topbar/redo/title' ),
		onClick: function () {

			if ( editor.history.redos.length === 0 ) return context.notify( t( 'message/nothingToRedo' ) );
			if ( editor.history.historyDisabled ) return context.notify( t( 'message/historyLocked' ), 'warning' );

			editor.redo();

		}
	} );
	historyGroup.add( redo );

	function updateHistoryButtons() {

		undo.dom.classList.toggle( 'disabled', editor.history.undos.length === 0 );
		redo.dom.classList.toggle( 'disabled', editor.history.redos.length === 0 );
		undo.dom.setAttribute( 'aria-disabled', editor.history.undos.length === 0 );
		redo.dom.setAttribute( 'aria-disabled', editor.history.redos.length === 0 );

	}

	signals.historyChanged.add( updateHistoryButtons );
	updateHistoryButtons();

	// espaço flexível

	container.add( new UIDiv().setClass( 'SimpleSpacer' ) );

	// unidade de medida do projeto (EV-002): muda só a representação dos números

	const units = context.units;

	const unitField = document.createElement( 'label' );
	unitField.className = 'SimpleUnitField';
	unitField.title = t( 'topbar/unit/title' );

	const unitLabel = document.createElement( 'span' );
	unitLabel.className = 'SimpleUnitLabel';
	unitLabel.textContent = t( 'topbar/unit' );
	unitField.appendChild( unitLabel );

	const unitSelect = document.createElement( 'select' );
	unitSelect.className = 'SimpleSelect';
	unitSelect.setAttribute( 'aria-label', t( 'topbar/unit/title' ) );

	for ( const unit of Object.values( units.UNITS ) ) {

		const option = document.createElement( 'option' );
		option.value = unit.id;
		option.textContent = unit.label;
		option.title = unit.name;
		unitSelect.appendChild( option );

	}

	unitSelect.value = units.getUnit().id;
	unitSelect.addEventListener( 'keydown', ( event ) => event.stopPropagation() ); // não aciona atalhos
	unitSelect.addEventListener( 'change', function () {

		units.setUnit( unitSelect.value );
		context.notify( t( 'message/unitChanged', units.getUnit().name.toLowerCase() ) );

	} );
	unitField.appendChild( unitSelect );

	units.changed.add( function () {

		unitSelect.value = units.getUnit().id;

	} );

	container.dom.appendChild( unitField );

	// indicador de salvamento automático

	const savingStatus = createText( t( 'topbar/saving' ), 'SimpleSaving' );
	savingStatus.dom.setAttribute( 'aria-live', 'polite' );
	container.add( savingStatus );

	signals.savingStarted.add( function () {

		savingStatus.dom.classList.add( 'active' );

	} );

	signals.savingFinished.add( function () {

		setTimeout( function () {

			savingStatus.dom.classList.remove( 'active' );

		}, 1200 );

	} );

	// alternância de modo (segmentado)

	const modeSwitch = new UIDiv().setClass( 'SimpleModeSwitch' );
	modeSwitch.dom.setAttribute( 'role', 'group' );
	modeSwitch.dom.title = t( 'topbar/mode/title' );
	modeSwitch.dom.setAttribute( 'aria-label', t( 'topbar/mode/title' ) );

	const simpleOption = createSimpleButton( { label: t( 'topbar/mode/simple' ), title: t( 'topbar/mode/simple' ), className: 'active' } );
	simpleOption.dom.setAttribute( 'aria-pressed', 'true' );

	const advancedOption = createSimpleButton( {
		label: t( 'topbar/mode/advanced' ), title: t( 'topbar/mode/title' ),
		onClick: function () {

			context.setMode( 'advanced' );

		}
	} );
	advancedOption.dom.setAttribute( 'aria-pressed', 'false' );

	modeSwitch.add( simpleOption, advancedOption );
	container.add( modeSwitch );

	// ações de arquivo

	function newProject() {

		if ( editor.scene.children.length > 0 && confirm( t( 'confirm/new' ) ) === false ) return;

		editor.clear();
		context.notify( t( 'message/newProject' ), 'success' );

	}

	function getFileName() {

		const title = config.getKey( 'project/title' ) || '';
		// sem acentos e caracteres proibidos: nomes de arquivo aceitos por todos os navegadores e sistemas
		const safe = title.trim().normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).replace( /[\\/:*?"<>|]+/g, '' ).replace( /\s+/g, '-' );

		return ( safe !== '' ? safe : 'projeto' ) + '.json';

	}

	function saveProject() {

		try {

			const json = editor.toJSON();

			// guarda o nome do projeto junto ao arquivo (campo ignorado pelo carregador original)
			json.project.title = config.getKey( 'project/title' ) || '';

			const fileName = getFileName();
			const blob = new Blob( [ JSON.stringify( json ) ], { type: 'application/json' } );
			editor.utils.save( blob, fileName );

			context.notify( t( 'message/saved', fileName ), 'success' );

		} catch ( error ) {

			console.error( error );
			context.notify( t( 'message/saveError' ), 'error' );

		}

	}

	// EV-005: usados pela galeria de projetos prontos (cópia de segurança e nome do projeto)
	context.saveProject = saveProject;
	context.setProjectTitle = ( title ) => projectName.setValue( title || '' );

	const openForm = document.createElement( 'form' );
	openForm.style.display = 'none';
	document.body.appendChild( openForm );

	const openInput = document.createElement( 'input' );
	openInput.type = 'file';
	openInput.accept = '.json,application/json';
	openInput.addEventListener( 'change', async function () {

		const file = openInput.files[ 0 ];

		if ( file === undefined ) return;

		let json;

		try {

			json = JSON.parse( await file.text() );

		} catch ( error ) {

			json = null;

		}

		openForm.reset();

		// valida antes de limpar a cena para não perder o trabalho atual por causa de um arquivo inválido

		if ( json === null || typeof json !== 'object' || json.scene === undefined || json.camera === undefined ) {

			context.notify( t( 'message/openError' ), 'error' );
			return;

		}

		const title = ( json.project && typeof json.project.title === 'string' && json.project.title !== '' ) ?
			json.project.title : file.name.replace( /\.json$/i, '' );

		async function onEditorCleared() {

			editor.signals.editorCleared.remove( onEditorCleared );

			try {

				await editor.fromJSON( json );

				config.setKey( 'project/title', title );
				projectName.setValue( title );

				context.notify( t( 'message/opened', title ), 'success' );

			} catch ( error ) {

				console.error( error );
				context.notify( t( 'message/openError' ), 'error' );

			}

		}

		editor.signals.editorCleared.add( onEditorCleared );
		editor.clear();

	} );
	openForm.appendChild( openInput );

	return container;

}

export { SimpleModeTopbar };
