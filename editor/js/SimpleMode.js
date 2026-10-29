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
	const measure = new Measure( editor, units, precision.getSnap );
	const alignment = new Alignment( editor );

	let currentMode = null; // 'simple' | 'advanced'

	// EV-003: componentes salvos pelo usuário (IndexedDB próprio)
	const userLibrary = new UserLibrary();
	userLibrary.load(); // em segundo plano: a aba "Meus" já abre pronta

	// EV-003: no Modo Simples, clicar em qualquer peça de um componente seleciona o componente inteiro.
	// No Modo Avançado a seleção original (peça por peça) continua igual.
	editor.selector.resolveSelection = function ( object ) {

		if ( currentMode !== 'simple' ) return object;

		const root = findComponentRoot( object, editor.scene );
		return root !== null ? root : object;

	};

	// contexto compartilhado com os painéis

	const context = { notify, setMode, units, precision, measure, alignment, userLibrary };

	container.add(
		new SimpleModeTopbar( editor, context ),
		new SimpleModeObjects( editor, context ),
		new SimpleModeTools( editor, context ),
		new SimpleModeProperties( editor, context ),
		toasts
	);

	// alternância de modo

	function setMode( mode ) {

		if ( mode !== 'simple' && mode !== 'advanced' ) mode = 'simple';
		if ( mode === currentMode ) return;

		currentMode = mode;

		document.body.classList.toggle( 'mode-simple', mode === 'simple' );
		document.body.classList.toggle( 'mode-advanced', mode === 'advanced' );

		// ao entrar no Modo Simples, uma peça selecionada no Avançado passa a selecionar o componente inteiro
		if ( mode === 'simple' && editor.selected !== null ) {

			const root = findComponentRoot( editor.selected, editor.scene );
			if ( root !== null && root !== editor.selected ) editor.select( root );

		}

		if ( mode === 'advanced' ) {

			// encerra a régua e remove seus elementos temporários
			measure.deactivate();

			// a ferramenta "Selecionar" não existe no Modo Avançado: volta para "Mover"
			signals.transformModeChanged.dispatch( 'translate' );

		}

		// encaixe e grade do Modo Simples; no Modo Avançado voltam ao comportamento original
		precision.setEnabled( mode === 'simple' );

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
