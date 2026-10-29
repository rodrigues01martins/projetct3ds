// EV-001 — Modo Simples de Criação 3D
// C. Área central: ferramentas de manipulação sobre a visualização 3D e ajuda contextual discreta

import { UIDiv } from './libs/ui.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';

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

	// destaca a ferramenta ativa, inclusive quando alterada por atalho (W/E/R) ou pelo Modo Avançado

	function setActiveTool( mode ) {

		for ( const tool of TOOLS ) {

			const active = tool === mode;
			buttons[ tool ].dom.classList.toggle( 'active', active );
			buttons[ tool ].dom.setAttribute( 'aria-pressed', active );

		}

	}

	signals.transformModeChanged.add( setActiveTool );
	setActiveTool( 'translate' );

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
