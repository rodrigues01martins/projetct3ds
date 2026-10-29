// EV-001 — Modo Simples de Criação 3D
// B. Painel esquerdo: botões para adicionar objetos básicos e lista dos objetos da cena

import * as THREE from 'three';

import { UIDiv } from './libs/ui.js';

import { AddObjectCommand } from './commands/AddObjectCommand.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleModeLibrary, getUniqueName } from './SimpleMode.Library.js';
import { getComponentData, isUserComponent } from './SimpleMode.ComponentFactory.js';
import { getDefinition } from './SimpleMode.Components.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';

// Paleta suave usada para diferenciar os objetos recém-criados
const PALETTE = [ 0x4f8cff, 0xff8a4f, 0x45c48b, 0xf2c94c, 0xb07cff, 0xff6b8b, 0x3cc7d6 ];

// Cada objeto é criado apoiado sobre a grade (y = metade da altura)
const PRIMITIVES = [
	{
		id: 'cube', icon: 'cube',
		create: () => new THREE.BoxGeometry( 1, 1, 1, 1, 1, 1 ),
		y: 0.5
	},
	{
		id: 'sphere', icon: 'sphere',
		create: () => new THREE.SphereGeometry( 0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI ),
		y: 0.5
	},
	{
		id: 'cylinder', icon: 'cylinder',
		create: () => new THREE.CylinderGeometry( 0.5, 0.5, 1, 32, 1, false, 0, Math.PI * 2 ),
		y: 0.5
	},
	{
		id: 'plane', icon: 'plane',
		create: () => new THREE.PlaneGeometry( 2, 2, 1, 1 ),
		y: 0,
		rotationX: - Math.PI / 2,
		doubleSide: true
	}
];

function SimpleModeObjects( editor, context ) {

	const signals = editor.signals;

	const container = new UIDiv();
	container.setId( 'simple-left' );
	container.setClass( 'SimplePanel' );
	container.dom.setAttribute( 'aria-label', t( 'objects/title' ) );

	// adicionar

	const addSection = new UIDiv().setClass( 'SimpleSection' );
	container.add( addSection );

	addSection.add( createText( t( 'objects/title' ), 'SimpleSectionTitle' ) );

	// EV-003: os básicos ficam na primeira aba da biblioteca
	const basics = new UIDiv().setClass( 'SimpleBasics' );
	basics.add( createText( t( 'objects/hint' ), 'SimpleSectionHint' ) );

	const grid = new UIDiv().setClass( 'SimpleAddGrid' );
	basics.add( grid );

	addSection.add( new SimpleModeLibrary( editor, context, basics ) );

	let colorIndex = 0;

	for ( const primitive of PRIMITIVES ) {

		const label = t( 'objects/' + primitive.id );

		grid.add( createSimpleButton( {
			icon: primitive.icon,
			label: label,
			title: t( 'objects/add/title', label.toLowerCase() ),
			className: 'SimpleAddButton',
			onClick: function () {

				addPrimitive( primitive, label );

			}
		} ) );

	}

	function addPrimitive( primitive, label ) {

		const material = new THREE.MeshStandardMaterial( { color: PALETTE[ colorIndex ++ % PALETTE.length ] } );
		if ( primitive.doubleSide === true ) material.side = THREE.DoubleSide;

		const mesh = new THREE.Mesh( primitive.create(), material );
		mesh.name = getUniqueName( editor, label );

		mesh.position.copy( getFreePosition( primitive.y ) );
		mesh.castShadow = true; // EV-004: participa das sombras dos cenários de iluminação
		mesh.receiveShadow = true;
		if ( primitive.rotationX !== undefined ) mesh.rotation.x = primitive.rotationX;

		// AddObjectCommand já seleciona o objeto e registra no histórico (desfazer/refazer)
		editor.execute( new AddObjectCommand( editor, mesh ) );

		context.notify( t( 'message/added', mesh.name ), 'success' );

	}

	// Procura uma posição livre próxima do centro para que o novo objeto não fique escondido dentro de outro

	function getFreePosition( y ) {

		const occupied = editor.scene.children.filter( ( object ) => isLightingGroup( object ) === false ).map( ( object ) => object.position );
		const candidate = new THREE.Vector3();

		for ( let ring = 0; ring < 10; ring ++ ) {

			for ( let i = - ring; i <= ring; i ++ ) {

				for ( let j = - ring; j <= ring; j ++ ) {

					if ( Math.max( Math.abs( i ), Math.abs( j ) ) !== ring ) continue;

					candidate.set( i * 1.5, y, j * 1.5 );

					const isFree = occupied.every( ( position ) => Math.hypot( position.x - candidate.x, position.z - candidate.z ) > 1 );

					if ( isFree ) return candidate;

				}

			}

		}

		return candidate.set( 0, y, 0 );

	}

	// lista de objetos

	const listSection = new UIDiv().setClass( 'SimpleSection SimpleListSection' );
	container.add( listSection );

	listSection.add( createText( t( 'objects/list/title' ), 'SimpleSectionTitle' ) );
	listSection.add( createText( t( 'objects/list/hint' ), 'SimpleSectionHint' ) );

	const list = new UIDiv().setClass( 'SimpleObjectList' );
	list.dom.setAttribute( 'role', 'list' );
	list.dom.setAttribute( 'aria-label', t( 'objects/list/title' ) );
	listSection.add( list );

	// EV-002: marcação complementar para alinhar/distribuir (não altera editor.selected)
	const alignment = context.alignment;

	const items = new Map(); // objeto -> { row, item, mark }

	function getIconFor( object ) {

		const component = getComponentData( object );

		if ( component !== null ) {

			const definition = getDefinition( component.id );
			return definition !== null ? definition.icon : 'bookmark';

		}

		if ( isUserComponent( object ) ) return 'bookmark';

		if ( object.isMesh && object.geometry ) {

			switch ( object.geometry.type ) {

				case 'BoxGeometry': return 'cube';
				case 'SphereGeometry': return 'sphere';
				case 'CylinderGeometry': return 'cylinder';
				case 'PlaneGeometry': return 'plane';

			}

		}

		return 'cube';

	}

	function refreshList() {

		list.dom.textContent = '';
		items.clear();

		// EV-004: o grupo de luzes do Project3DS é controlado pelo painel Iluminação, não pela lista
		const objects = editor.scene.children.filter( ( object ) => isLightingGroup( object ) === false );

		if ( objects.length === 0 ) {

			list.add( createText( t( 'objects/list/empty' ), 'SimpleEmpty' ) );
			return;

		}

		for ( const object of objects ) {

			const name = object.name || t( 'objects/unnamed' );

			const row = document.createElement( 'div' );
			row.className = 'SimpleObjectRow';
			row.setAttribute( 'role', 'listitem' );

			const mark = document.createElement( 'input' );
			mark.type = 'checkbox';
			mark.className = 'SimpleMark';
			mark.title = t( 'objects/list/mark/title', name );
			mark.setAttribute( 'aria-label', t( 'objects/list/mark/title', name ) );
			mark.disabled = alignment.isSupported( object ) === false;
			mark.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
			mark.addEventListener( 'change', function () {

				alignment.toggle( object );

			} );
			row.appendChild( mark );

			const item = document.createElement( 'button' );
			item.type = 'button';
			item.className = 'SimpleObjectItem';
			item.title = t( 'objects/list/item/title', name );
			item.appendChild( createIcon( getIconFor( object ) ) );

			const label = document.createElement( 'span' );
			label.className = 'SimpleObjectItemLabel';
			label.textContent = name;
			item.appendChild( label );

			item.addEventListener( 'click', function () {

				editor.select( object );

			} );

			item.addEventListener( 'dblclick', function () {

				editor.focus( object );

			} );

			const badge = document.createElement( 'span' );
			badge.className = 'SimpleReferenceBadge';
			badge.textContent = t( 'objects/list/reference' );
			badge.title = t( 'objects/list/reference/title' );

			row.appendChild( item );
			row.appendChild( badge );

			list.dom.appendChild( row );
			items.set( object, { row, item, mark, badge } );

		}

		updateSelection();

	}

	function updateSelection() {

		const hasMarks = alignment.getParticipants().others.length > 0;

		for ( const [ object, { row, item, mark, badge } ] of items ) {

			const selected = object === editor.selected;
			const marked = alignment.isMarked( object );

			item.classList.toggle( 'active', selected );
			item.setAttribute( 'aria-pressed', selected );

			mark.checked = marked;
			row.classList.toggle( 'marked', marked );

			// o objeto selecionado é a referência das operações de alinhamento
			badge.hidden = ! ( selected && hasMarks );

		}

	}

	signals.sceneGraphChanged.add( refreshList );
	signals.objectSelected.add( updateSelection );
	alignment.changed.add( updateSelection );

	signals.objectChanged.add( function ( object ) {

		// o nome pode ter mudado (SetValueCommand não dispara sceneGraphChanged)
		const entry = items.get( object );

		if ( entry !== undefined ) {

			const name = object.name || t( 'objects/unnamed' );
			entry.item.querySelector( '.SimpleObjectItemLabel' ).textContent = name;
			entry.item.title = t( 'objects/list/item/title', name );
			entry.mark.title = t( 'objects/list/mark/title', name );
			entry.mark.setAttribute( 'aria-label', t( 'objects/list/mark/title', name ) );

		}

	} );

	refreshList();

	return container;

}

export { SimpleModeObjects };
