// EV-005 — Galeria de Projetos Prontos e Modelos Iniciais 3D
// Diálogo "Projetos prontos": filtros por categoria, busca, cartões com miniatura e "Usar este modelo".
// Navegar pela galeria nunca altera a cena; a substituição só acontece após a confirmação.

import { UIDiv } from './libs/ui.js';

import { TEMPLATES, TEMPLATE_CATEGORIES, getTemplateCategory } from './SimpleMode.ProjectTemplates.js';
import { applyTemplate, summarizeTemplate } from './SimpleMode.TemplateFactory.js';
import { createPreviewSVG } from './SimpleMode.TemplatePreview.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

const normalize = ( text ) => text.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase();

function SimpleModeTemplateGallery( editor, context ) {

	let category = 'all';
	let selectedId = null;
	let returnFocus = null;
	let busy = false;

	// estrutura do diálogo ---------------------------------------------------------------------------

	const overlay = new UIDiv().setClass( 'SimpleOverlay' );
	overlay.dom.hidden = true;

	const dialog = new UIDiv().setClass( 'SimpleDialog SimpleGallery' );
	dialog.dom.id = 'simple-gallery';
	dialog.dom.setAttribute( 'role', 'dialog' );
	dialog.dom.setAttribute( 'aria-modal', 'true' );
	dialog.dom.setAttribute( 'aria-labelledby', 'simple-gallery-title' );
	overlay.add( dialog );

	const header = new UIDiv().setClass( 'SimpleDialogHeader' );
	const title = createText( t( 'gallery/title' ), 'SimpleDialogTitle' );
	title.dom.id = 'simple-gallery-title';
	header.add( title );
	header.add( createText( t( 'gallery/subtitle' ), 'SimpleSectionHint' ) );
	header.add( createSimpleButton( { icon: 'close', title: t( 'gallery/close' ), className: 'SimpleIconButton SimpleDialogClose', onClick: close } ) );
	dialog.add( header );

	// filtros e busca

	const toolbar = new UIDiv().setClass( 'SimpleGalleryToolbar' );
	dialog.add( toolbar );

	const filters = document.createElement( 'div' );
	filters.className = 'SimpleGalleryFilters';
	filters.setAttribute( 'role', 'radiogroup' );
	filters.setAttribute( 'aria-label', t( 'gallery/category' ) );
	toolbar.dom.appendChild( filters );

	const filterButtons = new Map();

	for ( const item of [ { id: 'all', name: t( 'gallery/category/all' ) }, ...TEMPLATE_CATEGORIES ] ) {

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'SimplePartChip';
		button.textContent = item.name;
		button.setAttribute( 'role', 'radio' );
		button.addEventListener( 'click', () => {

			category = item.id;
			render();

		} );
		filters.appendChild( button );
		filterButtons.set( item.id, button );

	}

	const searchRow = document.createElement( 'label' );
	searchRow.className = 'SimpleSearch';
	searchRow.appendChild( createIcon( 'search' ) );

	const search = document.createElement( 'input' );
	search.type = 'search';
	search.className = 'SimpleSearchInput';
	search.placeholder = t( 'gallery/search' );
	search.setAttribute( 'aria-label', t( 'gallery/search' ) );
	search.addEventListener( 'input', render );
	searchRow.appendChild( search );
	toolbar.dom.appendChild( searchRow );

	// cartões

	const grid = document.createElement( 'div' );
	grid.className = 'SimpleGalleryGrid';
	grid.setAttribute( 'role', 'list' );
	grid.setAttribute( 'aria-label', t( 'gallery/title' ) );
	dialog.dom.appendChild( grid );

	const cards = new Map();

	for ( const template of TEMPLATES ) {

		const summary = summarizeTemplate( template );
		const categoryName = getTemplateCategory( template.category ).name;

		const card = document.createElement( 'article' );
		card.className = 'SimpleTemplateCard';
		card.setAttribute( 'role', 'listitem' );
		card.tabIndex = - 1;
		card.dataset.template = template.id;
		card.setAttribute( 'aria-label', template.name + ' — ' + categoryName );

		const preview = document.createElement( 'div' );
		preview.className = 'SimpleTemplatePreview';
		preview.innerHTML = createPreviewSVG( template, t( 'gallery/preview', template.name ) ); // SVG gerado localmente, textos escapados
		card.appendChild( preview );

		const body = document.createElement( 'div' );
		body.className = 'SimpleTemplateBody';

		const categoryLabel = document.createElement( 'span' );
		categoryLabel.className = 'SimpleTemplateCategory';
		categoryLabel.textContent = categoryName;
		body.appendChild( categoryLabel );

		const name = document.createElement( 'h3' );
		name.className = 'SimpleTemplateName';
		name.textContent = template.name;
		body.appendChild( name );

		const description = document.createElement( 'p' );
		description.className = 'SimpleTemplateDescription';
		description.textContent = template.description;
		body.appendChild( description );

		const facts = document.createElement( 'p' );
		facts.className = 'SimpleTemplateFacts';
		facts.textContent = t( 'gallery/facts', format( summary.width ), format( summary.depth ), summary.components );
		body.appendChild( facts );

		const use = createSimpleButton( { label: t( 'gallery/use' ), title: t( 'gallery/use/title', template.name ), className: 'SimpleTemplateUse active' } );
		use.dom.addEventListener( 'click', ( event ) => {

			event.stopPropagation();
			useTemplate( template );

		} );
		body.appendChild( use.dom );

		card.appendChild( body );

		card.addEventListener( 'click', () => select( template.id ) );
		card.addEventListener( 'focus', () => select( template.id, false ) );

		grid.appendChild( card );
		cards.set( template.id, card );

	}

	const empty = createText( '', 'SimpleEmpty' );
	dialog.add( empty );

	// rodapé: proteção do projeto atual

	const footer = new UIDiv().setClass( 'SimpleGalleryFooter' );
	dialog.add( footer );

	const replaceNotice = createText( t( 'gallery/replace/notice' ), 'SimpleSectionHint' );
	footer.add( replaceNotice );

	const backupRow = document.createElement( 'label' );
	backupRow.className = 'SimpleCheckboxRow';

	const backup = document.createElement( 'input' );
	backup.type = 'checkbox';
	backupRow.appendChild( backup );

	const backupText = document.createElement( 'span' );
	backupText.textContent = t( 'gallery/replace/backup' );
	backupRow.appendChild( backupText );
	footer.dom.appendChild( backupRow );

	// comportamento ------------------------------------------------------------------------------------

	function format( meters ) {

		return meters.toLocaleString( 'pt-BR' ) + ' m';

	}

	function visibleTemplates() {

		const query = normalize( search.value.trim() );

		return TEMPLATES.filter( ( template ) => ( category === 'all' || template.category === category ) &&
			( query === '' || normalize( template.name + ' ' + getTemplateCategory( template.category ).name ).includes( query ) ) );

	}

	function render() {

		const visible = visibleTemplates();
		const ids = new Set( visible.map( ( template ) => template.id ) );

		for ( const [ id, button ] of filterButtons ) {

			const active = id === category;
			button.classList.toggle( 'active', active );
			button.setAttribute( 'aria-checked', active );

		}

		for ( const [ id, card ] of cards ) card.hidden = ! ids.has( id );

		empty.dom.hidden = visible.length > 0;
		empty.setTextContent( t( 'gallery/noResults', search.value.trim() ) );

		if ( ids.has( selectedId ) === false ) selectedId = visible.length > 0 ? visible[ 0 ].id : null;
		updateSelection();

	}

	function updateSelection() {

		for ( const [ id, card ] of cards ) {

			const selected = id === selectedId;
			card.classList.toggle( 'selected', selected );
			card.setAttribute( 'aria-current', selected ? 'true' : 'false' );
			card.tabIndex = selected ? 0 : - 1;

		}

	}

	function select( id, focus = true ) {

		selectedId = id;
		updateSelection();
		if ( focus ) cards.get( id ).focus();

	}

	function hasContent() {

		return editor.scene.children.some( ( object ) => isLightingGroup( object ) === false );

	}

	// navegação pelo teclado: setas entre cartões, Enter usa o modelo, Esc fecha, Tab circula no diálogo
	dialog.dom.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation(); // não aciona atalhos do editor

		if ( event.key === 'Escape' ) {

			event.preventDefault();
			close();
			return;

		}

		if ( event.key === 'Tab' ) {

			const focusable = [ ...dialog.dom.querySelectorAll( 'button, input, [tabindex="0"]' ) ].filter( ( el ) => el.offsetParent !== null && el.disabled !== true );
			const first = focusable[ 0 ], last = focusable[ focusable.length - 1 ];

			if ( event.shiftKey && document.activeElement === first ) {

				event.preventDefault();
				last.focus();

			} else if ( ! event.shiftKey && document.activeElement === last ) {

				event.preventDefault();
				first.focus();

			}

			return;

		}

		const card = event.target.closest( '.SimpleTemplateCard' );
		if ( card === null || event.target !== card ) return;

		const visible = visibleTemplates().map( ( template ) => template.id );
		const index = visible.indexOf( card.dataset.template );
		const columns = Math.max( 1, Math.round( grid.clientWidth / card.offsetWidth ) );
		const moves = { ArrowRight: 1, ArrowLeft: - 1, ArrowDown: columns, ArrowUp: - columns };

		if ( moves[ event.key ] !== undefined ) {

			event.preventDefault();
			const next = visible[ Math.min( visible.length - 1, Math.max( 0, index + moves[ event.key ] ) ) ];
			select( next );

		} else if ( event.key === 'Enter' ) {

			event.preventDefault();
			useTemplate( TEMPLATES.find( ( template ) => template.id === card.dataset.template ) );

		}

	} );

	overlay.dom.addEventListener( 'mousedown', ( event ) => {

		if ( event.target === overlay.dom ) close();

	} );

	async function useTemplate( template ) {

		if ( busy ) return;

		const replacing = hasContent();

		if ( replacing && confirm( t( 'confirm/template', template.name ) ) === false ) return;

		busy = true;
		dialog.dom.setAttribute( 'aria-busy', 'true' );

		try {

			// cópia de segurança opcional do projeto atual, pelo mesmo "Salvar" da barra superior
			if ( replacing && backup.checked && context.saveProject !== undefined ) context.saveProject();

			await applyTemplate( editor, template, { onTitle: context.setProjectTitle } );

			close( false );
			context.notify( t( 'message/template/opened', template.name ), 'success' );

		} catch ( error ) {

			context.notify( error.message || t( 'message/template/error' ), 'error' );

		} finally {

			busy = false;
			dialog.dom.removeAttribute( 'aria-busy' );

		}

	}

	function open() {

		const replacing = hasContent();

		replaceNotice.dom.hidden = ! replacing;
		backupRow.hidden = ! replacing;
		backup.checked = replacing; // há um projeto aberto: sugere guardar uma cópia antes de substituí-lo

		returnFocus = document.activeElement;
		overlay.dom.hidden = false;
		render();

		const target = selectedId !== null ? cards.get( selectedId ) : search;
		target.focus();

	}

	function close( restoreFocus = true ) {

		if ( overlay.dom.hidden ) return;

		overlay.dom.hidden = true;
		if ( restoreFocus && returnFocus !== null && typeof returnFocus.focus === 'function' ) returnFocus.focus();

	}

	context.openTemplates = open;

	return { dom: overlay.dom, open, close, isOpen: () => overlay.dom.hidden === false };

}

export { SimpleModeTemplateGallery };
