// EV-001 — Modo Simples de Criação 3D
//
// Interface simplificada montada *sobre* o editor original. Nada é recriado na troca de modo:
// o mesmo Editor, a mesma cena e o mesmo Viewport são reutilizados; apenas a classe
// `mode-simple` / `mode-advanced` do <body> decide quais painéis ficam visíveis (ver css/simple.css).

import { UIDiv, UIPanel } from './libs/ui.js';

import { SimpleModeTopbar } from './SimpleMode.Topbar.js';
import { SimpleModeObjects } from './SimpleMode.Objects.js';
import { SimpleModeTools } from './SimpleMode.Tools.js';
import { SimpleModeProperties } from './SimpleMode.Properties.js';

import { Units } from './SimpleMode.Units.js';
import { Precision } from './SimpleMode.Precision.js';
import { Measure } from './SimpleMode.Measure.js';
import { Alignment } from './SimpleMode.Alignment.js';
import { UserLibrary } from './SimpleMode.UserLibrary.js';
import { findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { isOwnedLighting } from './SimpleMode.Lighting.js';
import { LightingService } from './SimpleMode.LightingPanel.js';
import { SimpleModeTemplateGallery } from './SimpleMode.TemplateGallery.js';
import { Interaction } from './SimpleMode.Interaction.js';
import { ConstructionTools } from './SimpleMode.ConstructionTools.js';
import { OpeningTools } from './SimpleMode.OpeningTools.js';
import { findHostedFixture, isHostedFixture, getOpeningOf } from './SimpleMode.Openings.js';
import { RemoveWallOpeningCommand } from './commands/RemoveWallOpeningCommand.js';
import { CameraController } from './SimpleMode.CameraController.js';
import { Walkthrough } from './SimpleMode.Walkthrough.js';
import { Presentation, SimpleModePresentationBar } from './SimpleMode.Presentation.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';

const MODE_KEY = 'interface/mode';

function SimpleMode( editor ) {

	const signals = editor.signals;
	const config = editor.config;

	const container = new UIDiv();
	container.setId( 'simple-mode' );

	// mensagens curtas e não bloqueantes

	const toasts = new UIDiv().setClass( 'SimpleToasts' );
	toasts.dom.setAttribute( 'role', 'status' );
	toasts.dom.setAttribute( 'aria-live', 'polite' );

	function notify( message, type = 'info' ) {

		const toast = document.createElement( 'div' );
		toast.className = 'SimpleToast ' + type;
		toast.textContent = message;
		toasts.dom.appendChild( toast );

		// mantém no máximo 3 mensagens visíveis
		while ( toasts.dom.children.length > 3 ) toasts.dom.firstChild.remove();

		setTimeout( function () {

			toast.classList.add( 'leaving' );
			setTimeout( () => toast.remove(), 300 );

		}, type === 'error' ? 6000 : 2800 );

	}

	// serviços da EV-002 (unidades, precisão, medição e alinhamento), compartilhados com os painéis

	const units = new Units( editor );
	const precision = new Precision( editor );
	// EV-006: controlador único de interação com o viewport (régua e ferramentas de construção)
	const interaction = new Interaction( editor );
	const measure = new Measure( editor, units, precision.getSnap, interaction );
	const alignment = new Alignment( editor );

	let currentMode = null; // 'simple' | 'advanced'

	// EV-003: componentes salvos pelo usuário (IndexedDB próprio)
	const userLibrary = new UserLibrary();
	userLibrary.load(); // em segundo plano: a aba "Meus" já abre pronta

	// EV-003: no Modo Simples, clicar em qualquer peça de um componente seleciona o componente inteiro.
	// No Modo Avançado a seleção original (peça por peça) continua igual.
	editor.selector.resolveSelection = function ( object ) {

		if ( currentMode !== 'simple' ) return object;

		// EV-004: as luzes do Project3DS são controladas pelo painel Iluminação (não são selecionadas no Modo Simples)
		if ( isOwnedLighting( object, editor.scene ) ) return null;

		// EV-007: porta/janela hospedada tem prioridade (clicar nela seleciona a porta; na parede, a parede)
		const hosted = findHostedFixture( object, editor.scene );
		if ( hosted !== null ) return hosted;

		const root = findComponentRoot( object, editor.scene );
		return root !== null ? root : object;

	};

	// EV-007: no Modo Simples, porta/janela hospedada não recebe alças livres (move só ao longo da parede)
	editor.transformFilter = function ( object ) {

		return currentMode !== 'simple' || isHostedFixture( object ) === false;

	};

	// EV-004: reaplica a iluminação salva no projeto e mantém sombras/auxiliares coerentes
	const lighting = new LightingService( editor, () => currentMode );
	let shadingBeforeSimple = null;

	// contexto compartilhado com os painéis

	const context = { notify, setMode, units, precision, measure, alignment, userLibrary, interaction };

	// EV-006: desenhar parede, criar piso, posicionar componente e apoiar objeto
	context.construction = new ConstructionTools( editor, context, interaction );

	// EV-007: inserir porta, inserir janela e reposicionar abertura
	context.openings = new OpeningTools( editor, context, interaction );

	// EV-008: vistas e câmeras transitórias, exploração em primeira pessoa e apresentação das vistas salvas
	const cameras = new CameraController( editor );
	context.cameras = cameras;
	context.walkthrough = new Walkthrough( editor, context, interaction, cameras );
	context.presentation = new Presentation( editor, context, interaction, cameras );

	// EV-007: Delete/Backspace sobre uma porta/janela hospedada remove a abertura inteira (vão fechado, um Desfazer)
	window.addEventListener( 'keydown', function ( event ) {

		if ( currentMode !== 'simple' ) return;
		if ( event.key !== 'Delete' && event.key !== 'Backspace' ) return;

		const target = event.target;
		if ( target !== null && ( target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test( target.tagName ) ) ) return;

		const object = editor.selected;
		const opening = isHostedFixture( object ) ? getOpeningOf( object ) : null;
		if ( opening === null ) return;

		event.preventDefault();
		event.stopImmediatePropagation();

		const wall = object.parent;
		editor.execute( new RemoveWallOpeningCommand( editor, wall, opening.id ) );
		editor.select( wall );
		notify( t( 'opening/removed' ), 'success' );

	}, true );

	container.add(
		new SimpleModeTopbar( editor, context ),
		new SimpleModeObjects( editor, context ),
		new SimpleModeTools( editor, context ),
		new SimpleModeProperties( editor, context ),
		toasts
	);

	// EV-008: barra discreta do Modo Apresentação (fora dos painéis, que ficam ocultos durante a apresentação)
	container.add( new SimpleModePresentationBar( editor, context ) );

	// EV-005: galeria de projetos prontos (aberta por "Novo" ou pelo convite da cena vazia)
	const gallery = new SimpleModeTemplateGallery( editor, context );
	container.dom.appendChild( gallery.dom );

	// alternância de modo

	function setMode( mode ) {

		if ( mode !== 'simple' && mode !== 'advanced' ) mode = 'simple';
		if ( mode === currentMode ) return;

		currentMode = mode;

		document.body.classList.toggle( 'mode-simple', mode === 'simple' );
		document.body.classList.toggle( 'mode-advanced', mode === 'advanced' );

		// ao entrar no Modo Simples, uma peça selecionada no Avançado passa a selecionar o componente inteiro
		if ( mode === 'simple' && editor.selected !== null ) {

			const hosted = findHostedFixture( editor.selected, editor.scene );
			const root = hosted !== null ? hosted : findComponentRoot( editor.selected, editor.scene );
			if ( root !== null && root !== editor.selected ) editor.select( root );
			else if ( isHostedFixture( editor.selected ) ) signals.objectSelected.dispatch( editor.selected ); // retira as alças livres

		}

		if ( mode === 'advanced' ) {

			// encerra a régua e as ferramentas de construção, removendo prévias e marcadores temporários
			interaction.deactivate();
			measure.deactivate();

			// EV-008: o Modo Avançado usa a câmera principal (perspectiva equivalente à vista técnica atual)
			cameras.toPerspective();

			// a ferramenta "Selecionar" não existe no Modo Avançado: volta para "Mover"
			signals.transformModeChanged.dispatch( 'translate' );

		}

		// encaixe e grade do Modo Simples; no Modo Avançado voltam ao comportamento original
		precision.setEnabled( mode === 'simple' );

		// EV-004: o Modo Simples mostra os materiais reais (sombreamento padrão); o modo anterior volta no Avançado
		if ( mode === 'simple' && editor.viewportShading !== 'default' ) {

			shadingBeforeSimple = editor.viewportShading;
			editor.setViewportShading( 'default' );

		} else if ( mode === 'advanced' && shadingBeforeSimple !== null ) {

			editor.setViewportShading( shadingBeforeSimple );
			shadingBeforeSimple = null;

		}

		if ( mode === 'advanced' && context.lightingPanel !== undefined ) context.lightingPanel.close();
		if ( mode === 'advanced' ) gallery.close( false );

		lighting.updateHelpers();

		if ( config.getKey( MODE_KEY ) !== mode ) config.setKey( MODE_KEY, mode );

		// o viewport muda de tamanho: recalcula renderer e câmera
		signals.windowResize.dispatch();

	}

	function getMode() {

		return currentMode;

	}

	// botão para voltar ao Modo Simples, exibido na barra de menus original

	function createAdvancedToggle() {

		const panel = new UIPanel();
		panel.setClass( 'menu right SimpleModeToggle' );

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'title';
		button.textContent = t( 'advanced/toSimple' );
		button.title = t( 'advanced/toSimple/title' );
		button.addEventListener( 'click', function () {

			setMode( 'simple' );

		} );

		panel.dom.appendChild( button );

		return panel;

	}

	return {
		dom: container.dom,
		setMode,
		getMode,
		createAdvancedToggle,
		notify,
		context,
		initialMode: config.getKey( MODE_KEY ) === 'advanced' ? 'advanced' : 'simple'
	};

}

export { SimpleMode };
