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

	// contexto compartilhado com os painéis

	const context = { notify, setMode };

	container.add(
		new SimpleModeTopbar( editor, context ),
		new SimpleModeObjects( editor, context ),
		new SimpleModeTools( editor, context ),
		new SimpleModeProperties( editor, context ),
		toasts
	);

	// alternância de modo

	let currentMode = null;

	function setMode( mode ) {

		if ( mode !== 'simple' && mode !== 'advanced' ) mode = 'simple';
		if ( mode === currentMode ) return;

		currentMode = mode;

		document.body.classList.toggle( 'mode-simple', mode === 'simple' );
		document.body.classList.toggle( 'mode-advanced', mode === 'advanced' );

		// a ferramenta "Selecionar" não existe no Modo Avançado: volta para "Mover"
		if ( mode === 'advanced' ) signals.transformModeChanged.dispatch( 'translate' );

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
		initialMode: config.getKey( MODE_KEY ) === 'advanced' ? 'advanced' : 'simple'
	};

}

export { SimpleMode };
