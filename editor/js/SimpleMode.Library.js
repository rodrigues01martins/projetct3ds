// EV-003 — Biblioteca Inteligente de Componentes 3D
// Painel esquerdo: abas Básicos | Biblioteca | Meus componentes, com busca e cartões compactos.

import * as THREE from 'three';

import { UIDiv } from './libs/ui.js';

import { AddObjectCommand } from './commands/AddObjectCommand.js';

import { CATEGORIES, COMPONENTS, getDefaultParameters, getParameterSize } from './SimpleMode.Components.js';
import { createComponent, getComponentData, findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { findHostedFixture } from './SimpleMode.Openings.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

const TAB_KEY = 'interface/simple/libraryTab';

// EV-006: componentes com base física bem definida (a janela começa no peitoril, então não é apoiada automaticamente)
const PLACEABLE = new Set( [ 'wall', 'floor', 'panel', 'door', 'table', 'chair', 'shelf', 'platform' ] );
const TABS = [ 'basics', 'catalog', 'mine' ];

// utilitários compartilhados -------------------------------------------------------

function getUniqueName( editor, base ) {

	const names = new Set();
	editor.scene.traverse( ( object ) => names.add( object.name ) );

	if ( names.has( base ) === false ) return base;

	let index = 2;
	while ( names.has( base + ' ' + index ) ) index ++;

	return base + ' ' + index;

}

// Procura, perto do centro, um lugar onde a "pegada" (X/Z) do novo objeto não se sobreponha a outros.
// Posições alinhadas à precisão de movimento (EV-002). Se não houver espaço livre, usa o centro.

function findFreeSpot( editor, size, snap ) {

	const margin = 0.2;
	const boxes = editor.scene.children
		.filter( ( object ) => isLightingGroup( object ) === false && object.isLight !== true )
		.map( ( object ) => new THREE.Box3().setFromObject( object, true ) )
		.filter( ( box ) => box.isEmpty() === false );

	const halfX = size.x / 2 + margin;
	const halfZ = size.z / 2 + margin;
	const step = Math.max( size.x, size.z, 0.5 ) + margin * 2;
	const grid = snap || 0.1;
	const align = ( value ) => Math.round( value / grid ) * grid;

	const isFree = ( x, z ) => boxes.every( ( box ) =>
		x + halfX <= box.min.x || x - halfX >= box.max.x || z + halfZ <= box.min.z || z - halfZ >= box.max.z );

	for ( let ring = 0; ring < 8; ring ++ ) {

		for ( let i = - ring; i <= ring; i ++ ) {

			for ( let j = - ring; j <= ring; j ++ ) {

				if ( Math.max( Math.abs( i ), Math.abs( j ) ) !== ring ) continue;

				const x = align( i * step );
				const z = align( j * step );

				if ( isFree( x, z ) ) return new THREE.Vector3( x, 0, z );

			}

		}

	}

	return new THREE.Vector3();

}

function normalize( text ) {

	return text.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase();

}

// painel ------------------------------------------------------------------------------

function SimpleModeLibrary( editor, context, basicsContent ) {

	const config = editor.config;
	const units = context.units;
	const userLibrary = context.userLibrary;

	const container = new UIDiv().setClass( 'SimpleLibrary' );

	// abas

	const tabBar = new UIDiv().setClass( 'SimpleTabs' );
	tabBar.dom.setAttribute( 'role', 'tablist' );
	tabBar.dom.setAttribute( 'aria-label', t( 'library/tabs' ) );
	container.add( tabBar );

	const tabButtons = {};
	const panels = {};

	for ( const tab of TABS ) {

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'SimpleTab';
		button.id = 'simple-tab-' + tab;
		button.setAttribute( 'role', 'tab' );
		button.setAttribute( 'aria-controls', 'simple-panel-' + tab );
		button.textContent = t( 'library/tab/' + tab );
		button.title = t( 'library/tab/' + tab + '/title' );
		button.addEventListener( 'click', () => selectTab( tab ) );
		button.addEventListener( 'keydown', function ( event ) {

			event.stopPropagation();

			if ( event.key === 'ArrowRight' || event.key === 'ArrowLeft' ) {

				const next = TABS[ ( TABS.indexOf( tab ) + ( event.key === 'ArrowRight' ? 1 : TABS.length - 1 ) ) % TABS.length ];
				selectTab( next );
				tabButtons[ next ].focus();

			}

		} );

		tabBar.dom.appendChild( button );
		tabButtons[ tab ] = button;

	}

	// busca (Biblioteca e Meus componentes)

	const searchRow = new UIDiv().setClass( 'SimpleSearch' );
	searchRow.dom.appendChild( createIcon( 'search' ) );

	const search = document.createElement( 'input' );
	search.type = 'search';
	search.className = 'SimpleSearchInput';
	search.placeholder = t( 'library/search' );
	search.setAttribute( 'aria-label', t( 'library/search/title' ) );
	search.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
	search.addEventListener( 'input', () => {

		renderCatalog();
		renderMine();

	} );
	searchRow.dom.appendChild( search );
	container.add( searchRow );

	for ( const tab of TABS ) {

		const panel = new UIDiv().setClass( 'SimpleTabPanel' );
		panel.dom.id = 'simple-panel-' + tab;
		panel.dom.setAttribute( 'role', 'tabpanel' );
		panel.dom.setAttribute( 'aria-labelledby', 'simple-tab-' + tab );
		container.add( panel );
		panels[ tab ] = panel;

	}

	panels.basics.add( basicsContent );

	function selectTab( tab ) {

		for ( const id of TABS ) {

			const active = id === tab;
			tabButtons[ id ].classList.toggle( 'active', active );
			tabButtons[ id ].setAttribute( 'aria-selected', active );
			tabButtons[ id ].tabIndex = active ? 0 : - 1;
			panels[ id ].dom.hidden = ! active;

		}

		searchRow.dom.hidden = tab === 'basics';
		container.dom.dataset.tab = tab;

		if ( config.getKey( TAB_KEY ) !== tab ) config.setKey( TAB_KEY, tab );

		if ( tab === 'mine' && userLibrary.isLoaded() === false ) userLibrary.load();

	}

	function matches( ...texts ) {

		const query = normalize( search.value.trim() );
		return query === '' || texts.some( ( text ) => normalize( text ).includes( query ) );

	}

	function formatSize( size ) {

		const unit = units.getUnit();
		return [ size.x, size.y, size.z ].map( ( value ) => units.formatInput( value ) ).join( ' × ' ) + ' ' + unit.label;

	}

	// inserção

	function insert( object, label ) {

		object.name = getUniqueName( editor, object.name );

		const size = new THREE.Box3().setFromObject( object, true ).getSize( new THREE.Vector3() );
		object.position.copy( findFreeSpot( editor, size, context.precision.getSnap() ) );

		// AddObjectCommand seleciona o objeto e registra a inserção no histórico
		editor.execute( new AddObjectCommand( editor, object ) );

		context.notify( t( 'message/added', label || object.name ), 'success' );

	}

	// Biblioteca ---------------------------------------------------------------------------

	const catalogCards = new Map(); // id do componente -> botão

	function renderCatalog() {

		const panel = panels.catalog.dom;
		panel.textContent = '';
		catalogCards.clear();

		let found = 0;

		for ( const category of CATEGORIES ) {

			const items = COMPONENTS.filter( ( definition ) => definition.category === category.id && matches( definition.name, category.name ) );

			if ( items.length === 0 ) continue;

			const group = document.createElement( 'div' );
			group.className = 'SimpleCardGroup';
			group.setAttribute( 'role', 'group' );
			group.setAttribute( 'aria-label', category.name );

			const title = document.createElement( 'div' );
			title.className = 'SimpleCardGroupTitle';
			title.textContent = category.name;
			group.appendChild( title );

			for ( const definition of items ) {

				const size = getParameterSize( definition, getDefaultParameters( definition ) );
				const card = createCard( definition.icon, definition.name, formatSize( size ),
					t( 'library/insert/title', definition.name, category.name, formatSize( size ) ) );

				card.dataset.component = definition.id;
				card.addEventListener( 'click', () => insert( createComponent( definition.id ), definition.name ) );

				// EV-006: "Posicionar na cena" — prévia sobre superfícies; a inserção rápida (clique no cartão) continua
				const row = document.createElement( 'div' );
				row.className = 'SimpleCardRow';
				row.appendChild( card );

				if ( PLACEABLE.has( definition.id ) ) {

					row.appendChild( createPlaceButton( definition.name, () => createComponent( definition.id ) ) );

				}

				group.appendChild( row );
				catalogCards.set( definition.id, card );
				found ++;

			}

			panel.appendChild( group );

		}

		if ( found === 0 ) panel.appendChild( createText( t( 'library/noResults', search.value.trim() ), 'SimpleEmpty' ).dom );

		highlightSelected();

	}

	// botão secundário "Posicionar na cena" (ferramenta 'place' do controlador de interação)
	function createPlaceButton( name, create ) {

		const button = createSimpleButton( {
			icon: 'place', title: t( 'library/place/title', name ), className: 'SimpleIconButton SimplePlaceButton',
			onClick: function () {

				let probe;

				try {

					probe = create(); // valida antes de abrir a prévia (registros danificados não chegam à cena)

				} catch ( error ) {

					context.notify( error.message || t( 'message/library/insertError' ), 'error' );
					return;

				}

				let first = probe;
				context.startTool( 'place', { name, create: () => {

					// a primeira prévia reaproveita a instância já validada; as próximas criam novas
					const instance = first !== null ? first : create();
					first = null;
					return instance;

				} } );

			}
		} );

		button.dom.dataset.place = name;
		return button.dom;

	}

	function createCard( icon, name, detail, title ) {

		const card = document.createElement( 'button' );
		card.type = 'button';
		card.className = 'SimpleCard';
		card.title = title;
		card.setAttribute( 'aria-label', title );

		card.appendChild( createIcon( icon ) );

		const text = document.createElement( 'span' );
		text.className = 'SimpleCardText';

		const nameElement = document.createElement( 'span' );
		nameElement.className = 'SimpleCardName';
		nameElement.textContent = name;
		text.appendChild( nameElement );

		const detailElement = document.createElement( 'span' );
		detailElement.className = 'SimpleCardDetail';
		detailElement.textContent = detail;
		text.appendChild( detailElement );

		card.appendChild( text );

		return card;

	}

	// realça o cartão do tipo de componente selecionado na cena
	function highlightSelected() {

		const hosted = findHostedFixture( editor.selected, editor.scene ); // EV-007: porta/janela dentro da parede
		const root = editor.selected !== null ? ( hosted !== null ? hosted : findComponentRoot( editor.selected, editor.scene ) ) : null;
		const data = root !== null ? getComponentData( root ) : null;

		for ( const [ id, card ] of catalogCards ) card.classList.toggle( 'current', data !== null && data.id === id );

	}

	// Meus componentes -------------------------------------------------------------------------

	let renaming = null; // id em edição de nome

	function renderMine() {

		const panel = panels.mine.dom;
		panel.textContent = '';

		const notice = createText( t( 'library/mine/notice' ), 'SimpleNotice' );
		panel.appendChild( notice.dom );

		if ( userLibrary.getError() !== null ) {

			panel.appendChild( createText( userLibrary.getError(), 'SimpleEmpty SimpleError' ).dom );
			return;

		}

		if ( userLibrary.isLoaded() === false ) {

			panel.appendChild( createText( t( 'library/mine/loading' ), 'SimpleEmpty' ).dom );
			return;

		}

		const records = userLibrary.getAll();

		if ( records.length === 0 ) {

			panel.appendChild( createText( t( 'library/mine/empty' ), 'SimpleEmpty' ).dom );
			return;

		}

		const filtered = records.filter( ( record ) => matches( record.name, record.category ) );

		if ( filtered.length === 0 ) {

			panel.appendChild( createText( t( 'library/noResults', search.value.trim() ), 'SimpleEmpty' ).dom );
			return;

		}

		const byCategory = new Map();
		for ( const record of filtered ) {

			if ( byCategory.has( record.category ) === false ) byCategory.set( record.category, [] );
			byCategory.get( record.category ).push( record );

		}

		for ( const [ category, items ] of byCategory ) {

			const group = document.createElement( 'div' );
			group.className = 'SimpleCardGroup';
			group.setAttribute( 'role', 'group' );
			group.setAttribute( 'aria-label', category );

			const title = document.createElement( 'div' );
			title.className = 'SimpleCardGroupTitle';
			title.textContent = category;
			group.appendChild( title );

			for ( const record of items ) group.appendChild( createMineRow( record ) );

			panel.appendChild( group );

		}

	}

	function createMineRow( record ) {

		const row = document.createElement( 'div' );
		row.className = 'SimpleCardRow';

		const icon = record.kind === 'parametric' ? ( COMPONENTS.find( ( c ) => c.id === record.componentId ) || { icon: 'bookmark' } ).icon : 'bookmark';

		if ( renaming === record.id ) {

			const input = document.createElement( 'input' );
			input.className = 'SimpleRenameInput';
			input.value = record.name;
			input.maxLength = userLibrary.LIMITS.name;
			input.setAttribute( 'aria-label', t( 'library/mine/rename/title', record.name ) );

			let done = false;

			const finish = async ( save ) => {

				if ( done ) return;
				done = true;
				renaming = null;

				if ( save && input.value.trim() !== '' && input.value.trim() !== record.name ) {

					try {

						await userLibrary.rename( record.id, input.value );
						context.notify( t( 'message/library/renamed' ), 'success' );

					} catch ( error ) {

						context.notify( error.message, 'error' );

					}

				}

				renderMine();

			};

			input.addEventListener( 'keydown', ( event ) => {

				event.stopPropagation();
				if ( event.key === 'Enter' ) finish( true );
				if ( event.key === 'Escape' ) finish( false );

			} );
			input.addEventListener( 'blur', () => finish( true ) );

			row.appendChild( createIcon( icon ) );
			row.appendChild( input );
			setTimeout( () => input.select(), 0 );

			return row;

		}

		const size = { x: record.dimensions.x, y: record.dimensions.y, z: record.dimensions.z };
		const card = createCard( icon, record.name, formatSize( size ), t( 'library/mine/insert/title', record.name, formatSize( size ) ) );
		card.addEventListener( 'click', function () {

			try {

				insert( userLibrary.instantiate( record ), record.name );

			} catch ( error ) {

				console.error( error );
				context.notify( error.message || t( 'message/library/insertError' ), 'error' );

			}

		} );
		row.appendChild( card );

		const actions = document.createElement( 'span' );
		actions.className = 'SimpleCardActions';

		// EV-006: posicionar um componente salvo (a validação do registro acontece antes de abrir a prévia)
		actions.appendChild( createPlaceButton( record.name, () => userLibrary.instantiate( record ) ) );

		actions.appendChild( createSimpleButton( {
			icon: 'edit', title: t( 'library/mine/rename/title', record.name ), className: 'SimpleIconButton',
			onClick: () => {

				renaming = record.id;
				renderMine();

			}
		} ).dom );

		actions.appendChild( createSimpleButton( {
			icon: 'delete', title: t( 'library/mine/delete/title', record.name ), className: 'SimpleIconButton danger',
			onClick: async () => {

				if ( confirm( t( 'confirm/library/delete', record.name ) ) === false ) return;

				try {

					await userLibrary.remove( record.id );
					context.notify( t( 'message/library/deleted', record.name ) );

				} catch ( error ) {

					context.notify( error.message, 'error' );

				}

			}
		} ).dom );

		row.appendChild( actions );

		return row;

	}

	// eventos

	userLibrary.changed.add( renderMine );

	units.changed.add( () => {

		renderCatalog();
		renderMine();

	} );

	editor.signals.objectSelected.add( highlightSelected );

	// após salvar um componente, mostra a aba "Meus componentes"
	context.showMyComponents = () => selectTab( 'mine' );

	renderCatalog();
	renderMine();

	const initialTab = config.getKey( TAB_KEY );
	selectTab( TABS.includes( initialTab ) ? initialTab : 'basics' );

	return container;

}

export { SimpleModeLibrary, getUniqueName, findFreeSpot };
