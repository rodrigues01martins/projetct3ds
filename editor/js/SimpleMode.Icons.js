// EV-001 — Modo Simples de Criação 3D
// Ícones SVG embutidos (sem dependências externas) e utilitário para criar botões acessíveis

import { UIElement, UISpan } from './libs/ui.js';

const ICON_ATTRIBUTES = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

const ICON_PATHS = {

	new: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>',
	open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h13l3-9H7l-3 9"/>',
	save: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
	redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',

	cube: '<path d="M12 2.5 3.5 7v10L12 21.5 20.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7"/><path d="M12 11.5v10"/>',
	sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><path d="M12 3a13 13 0 0 1 0 18"/>',
	cylinder: '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13"/>',
	plane: '<path d="M2.5 16 8 8h13.5L16 16z"/>',

	select: '<path d="M5 3.5 18.5 12 12 13.5 9 20z"/>',
	translate: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
	rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3.5V8h-4.5"/>',
	scale: '<path d="M14 4h6v6"/><path d="M20 4l-7 7"/><rect x="4" y="12" width="8" height="8" rx="1"/>',
	focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="3"/>',

	duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
	delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',

	measure: '<path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
	snap: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/>',
	grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
	lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	alignStart: '<path d="M4 3v18"/><rect x="7" y="6" width="10" height="4" rx="1"/><rect x="7" y="14" width="6" height="4" rx="1"/>',
	alignCenter: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
	alignEnd: '<path d="M20 3v18"/><rect x="7" y="6" width="10" height="4" rx="1"/><rect x="11" y="14" width="6" height="4" rx="1"/>',
	distribute: '<path d="M3 4v16M21 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>',

	// componentes (EV-003)
	wall: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>',
	floor: '<path d="M2.5 15 7 9h14.5L17 15z"/><path d="M2.5 15v2.5h14.5V15M17 17.5l4.5-6V9"/>',
	panel: '<rect x="6" y="3" width="12" height="16" rx="1"/><path d="M8 21v-2M16 21v-2"/>',
	door: '<path d="M5 21V3h14v18"/><path d="M8 21V6h8v15"/><circle cx="14" cy="13.5" r=".9"/><path d="M3 21h18"/>',
	window: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
	table: '<path d="M3 8h18v2.5H3z"/><path d="M5 10.5V20M19 10.5V20M8 10.5V16M16 10.5V16"/>',
	chair: '<path d="M7 3v18M7 12h10v9M7 12V3h9v9"/><path d="M7 12h10"/>',
	shelf: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 8h14M5 13h14M5 18h14"/>',
	platform: '<path d="M3 11 8 7h13l-5 4z"/><path d="M3 11v5h13v-5M16 16l5-4V7"/>',
	search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
	bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',

	templates: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 14v6M14 17h6"/>',
	light: '<circle cx="12" cy="11" r="4.5"/><path d="M9.5 18h5M10.5 21h3M12 2v1.5M4.2 4.2l1.1 1.1M19.8 4.2l-1.1 1.1M2 11h1.5M20.5 11H22"/>',

	help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.5h.01"/>',
	close: '<path d="M6 6l12 12M18 6 6 18"/>'

};

function createIcon( name ) {

	const span = document.createElement( 'span' );
	span.className = 'SimpleIcon';
	span.innerHTML = `<svg ${ ICON_ATTRIBUTES }>${ ICON_PATHS[ name ] || '' }</svg>`;

	return span;

}

// Texto simples sem estilos inline (UIText força `display: inline-block`, o que impede o layout via CSS)

function createText( text, className ) {

	return new UISpan().setClass( className ).setTextContent( text );

}

// Cria um <button> com ícone, rótulo visível (opcional) e descrição acessível.

function createSimpleButton( { icon, label, title, className = '', onClick } ) {

	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = ( 'SimpleButton ' + className ).trim();

	if ( title !== undefined ) button.title = title;
	button.setAttribute( 'aria-label', title !== undefined ? title : label );

	if ( icon !== undefined ) button.appendChild( createIcon( icon ) );

	if ( label !== undefined ) {

		const text = document.createElement( 'span' );
		text.className = 'SimpleButtonLabel';
		text.textContent = label;
		button.appendChild( text );

	}

	if ( onClick !== undefined ) button.addEventListener( 'click', onClick );

	return new UIElement( button );

}

export { createIcon, createSimpleButton, createText };
