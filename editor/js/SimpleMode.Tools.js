// EV-001 — Modo Simples de Criação 3D
// C. Área central: ferramentas de manipulação sobre a visualização 3D e ajuda contextual discreta

import { UIDiv } from './libs/ui.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleModeLightingPanel } from './SimpleMode.LightingPanel.js';

const TOOLS = [ 'select', 'translate', 'rotate', 'scale' ];

function SimpleModeTools( editor, context ) {

	const signals = editor.signals;

	// camada posicionada sobre o viewport; não captura cliques fora dos controles

	const container = new UIDiv();
	container.setId( 'simple-center' );

	// barra de ferramentas

	const toolbar = new UIDiv().setClass( 'SimpleTools' );
	toolbar.dom.setAttribute( 'role', 'toolbar' );
	toolbar.dom.setAttribute( 'aria-label', t( 'tools/label' ) );
	container.add( toolbar );

	const buttons = {};

	for ( const tool of TOOLS ) {

		const button = createSimpleButton( {
			icon: tool,
			label: t( 'tools/' + tool ),
			title: t( 'tools/' + tool + '/title' ),
			className: 'SimpleTool',
			onClick: function () {

				signals.transformModeChanged.dispatch( tool );

			}
		} );

		button.dom.setAttribute( 'aria-pressed', 'false' );

		buttons[ tool ] = button;
		toolbar.add( button );

	}

	toolbar.add( new UIDiv().setClass( 'SimpleToolSeparator' ) );

	const focus = createSimpleButton( {
		icon: 'focus',
		label: t( 'tools/focus' ),
		title: t( 'tools/focus/title' ),
		className: 'SimpleTool',
		onClick: function () {

			if ( editor.selected === null || editor.selected === editor.scene ) {

				context.notify( t( 'message/nothingSelected' ) );
				return;

			}

			editor.focus( editor.selected );

		}
	} );
	toolbar.add( focus );

	// EV-002: régua de medição

	const measure = context.measure;
	const units = context.units;

	const measureButton = createSimpleButton( {
		icon: 'measure',
		label: t( 'tools/measure' ),
		title: t( 'tools/measure/title' ),
		className: 'SimpleTool',
		onClick: function () {

			if ( measure.isActive() ) {

				measure.deactivate();

			} else {

				startMeasuring();

			}

		}
	} );
	measureButton.dom.setAttribute( 'aria-pressed', 'false' );
	toolbar.add( measureButton );

	let currentMode = 'translate';
	let modeBeforeMeasure = 'translate';
	let internalChange = false;
	let wasMeasuring = false;

	function dispatchMode( mode ) {

		internalChange = true;
		signals.transformModeChanged.dispatch( mode );
		internalChange = false;

	}

	function startMeasuring() {

		modeBeforeMeasure = currentMode;
		measure.activate();
		dispatchMode( 'select' ); // esconde as alças: a medição não move nem seleciona objetos

	}

	// destaca a ferramenta ativa, inclusive quando alterada por atalho (W/E/R) ou pelo Modo Avançado

	function setActiveTool( mode ) {

		currentMode = mode;

		// trocar de ferramenta encerra a medição
		if ( internalChange === false && measure.isActive() ) measure.deactivate();

		updateToolButtons();

	}

	function updateToolButtons() {

		const measuring = measure.isActive();

		for ( const tool of TOOLS ) {

			const active = measuring === false && tool === currentMode;
			buttons[ tool ].dom.classList.toggle( 'active', active );
			buttons[ tool ].dom.setAttribute( 'aria-pressed', active );

		}

		measureButton.dom.classList.toggle( 'active', measuring );
		measureButton.dom.setAttribute( 'aria-pressed', measuring );

	}

	signals.transformModeChanged.add( setActiveTool );
	setActiveTool( 'translate' );

	// opções de precisão (encaixe) e grade

	const precision = context.precision;

	const options = new UIDiv().setClass( 'SimpleViewOptions' );
	container.add( options );

	const snapSelect = createSelect( t( 'precision/snap' ), t( 'precision/snap/title' ), 'snap',
		precision.SNAP_OPTIONS.map( ( option ) => ( { value: option.id, label: option.label } ) ),
		( value ) => precision.setSnap( value ) );

	const gridSelect = createSelect( t( 'precision/grid' ), t( 'precision/grid/title' ), 'grid',
		precision.GRID_OPTIONS.map( ( option ) => ( { value: option.id, label: option.label, title: option.description } ) ),
		( value ) => precision.setGrid( value ) );

	function createSelect( labelText, title, icon, items, onChange ) {

		const field = document.createElement( 'label' );
		field.className = 'SimpleOption';
		field.title = title;

		field.appendChild( createIcon( icon ) );

		const text = document.createElement( 'span' );
		text.className = 'SimpleOptionLabel';
		text.textContent = labelText;
		field.appendChild( text );

		const select = document.createElement( 'select' );
		select.className = 'SimpleSelect';
		select.setAttribute( 'aria-label', title );

		for ( const item of items ) {

			const option = document.createElement( 'option' );
			option.value = item.value;
			option.textContent = item.label;
			if ( item.title !== undefined ) option.title = item.title;
			select.appendChild( option );

		}

		select.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		select.addEventListener( 'change', () => onChange( select.value ) );

		field.appendChild( select );
		options.dom.appendChild( field );

		return select;

	}

	// EV-004: iluminação (acesso discreto ao lado de Encaixe e Grade)
	context.lightingPanel = new SimpleModeLightingPanel( editor, context, options, container );

	function updatePrecision() {

		snapSelect.value = precision.getSnapOption().id;
		gridSelect.value = precision.getGridOption().id;

	}

	precision.changed.add( updatePrecision );
	updatePrecision();

	// status da medição (instruções, resultado e "Limpar")

	const measureStatus = new UIDiv().setClass( 'SimpleMeasureStatus' );
	measureStatus.dom.setAttribute( 'role', 'status' );
	measureStatus.dom.setAttribute( 'aria-live', 'polite' );
	container.add( measureStatus );

	const measureText = createText( '', 'SimpleMeasureText' );
	measureStatus.add( measureText );

	const measureClear = createSimpleButton( {
		label: t( 'measure/clear' ), title: t( 'measure/clear/title' ), className: 'SimpleMeasureAction',
		onClick: () => measure.clear()
	} );
	measureStatus.add( measureClear );

	const measureExit = createSimpleButton( {
		icon: 'close', title: t( 'measure/exit' ), className: 'SimpleIconButton',
		onClick: () => measure.deactivate()
	} );
	measureStatus.add( measureExit );

	container.dom.appendChild( measure.label );

	function updateMeasureStatus() {

		const measuring = measure.isActive();

		// ao sair da medição (Esc, botão ou novo projeto), volta para a ferramenta anterior
		if ( wasMeasuring && measuring === false && currentMode === 'select' && modeBeforeMeasure !== 'select' ) {

			dispatchMode( modeBeforeMeasure );

		}

		wasMeasuring = measuring;

		measureStatus.dom.hidden = ! measuring;
		updateToolButtons();

		if ( measuring === false ) return;

		const count = measure.getPointCount();
		const distance = measure.getDistance();

		if ( count === 2 ) {

			measureText.dom.innerHTML = '';
			measureText.dom.append( t( 'measure/result' ) + ' ' );

			const value = document.createElement( 'strong' );
			value.textContent = units.format( distance );
			measureText.dom.append( value );

		} else {

			measureText.setTextContent( t( count === 0 ? 'measure/first' : 'measure/second' ) );

		}

		measureClear.dom.hidden = count === 0;

	}

	measure.changed.add( updateMeasureStatus );
	units.changed.add( updateMeasureStatus );
	updateMeasureStatus();

	function updateFocusState() {

		const hasSelection = editor.selected !== null && editor.selected !== editor.scene;
		focus.dom.classList.toggle( 'disabled', hasSelection === false );
		focus.dom.setAttribute( 'aria-disabled', hasSelection === false );

	}

	signals.objectSelected.add( updateFocusState );
	updateFocusState();

	// dica quando a cena está vazia

	const emptyHint = new UIDiv().setClass( 'SimpleSceneHint' );
	emptyHint.add( createText( t( 'tools/emptyHint' ), '' ) );
	container.add( emptyHint );

	function updateEmptyHint() {

		emptyHint.dom.hidden = editor.scene.children.length > 0;

	}

	signals.sceneGraphChanged.add( updateEmptyHint );
	signals.editorCleared.add( updateEmptyHint );
	updateEmptyHint();

	// ajuda contextual (recolhível, aberta por padrão apenas no primeiro uso)

	const helpKey = 'interface/simple/helpVisible';

	const help = new UIDiv().setClass( 'SimpleHelp' );
	help.dom.id = 'simple-help';
	help.dom.setAttribute( 'role', 'note' );
	container.add( help );

	const helpHeader = new UIDiv().setClass( 'SimpleHelpHeader' );
	helpHeader.add( createText( t( 'help/title' ), 'SimpleHelpTitle' ) );
	helpHeader.add( createSimpleButton( {
		icon: 'close',
		title: t( 'help/close' ),
		className: 'SimpleIconButton',
		onClick: function () {

			setHelpVisible( false );

		}
	} ) );
	help.add( helpHeader );

	const helpList = document.createElement( 'ul' );

	for ( const key of [ 'help/select', 'help/transform', 'help/orbit', 'help/pan', 'help/zoom', 'help/focus' ] ) {

		const li = document.createElement( 'li' );
		li.innerHTML = t( key ); // textos fixos e controlados pelo próprio código
		helpList.appendChild( li );

	}

	help.dom.appendChild( helpList );

	const helpButton = createSimpleButton( {
		icon: 'help',
		label: t( 'help/button' ),
		title: t( 'help/button/title' ),
		className: 'SimpleHelpButton',
		onClick: function () {

			setHelpVisible( help.dom.hidden );

		}
	} );
	helpButton.dom.setAttribute( 'aria-controls', 'simple-help' );
	container.add( helpButton );

	function setHelpVisible( visible ) {

		help.dom.hidden = ! visible;
		helpButton.dom.setAttribute( 'aria-expanded', visible );

		if ( editor.config.getKey( helpKey ) !== visible ) editor.config.setKey( helpKey, visible );

	}

	// em telas pequenas as dicas começam fechadas para não cobrir a cena
	const initialHelp = editor.config.getKey( helpKey );
	setHelpVisible( initialHelp === undefined ? window.innerWidth > 760 : initialHelp );

	return container;

}

export { SimpleModeTools };
