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
