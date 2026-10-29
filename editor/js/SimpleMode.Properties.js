// EV-001 — Modo Simples de Criação 3D
// D. Painel direito: propriedades do objeto selecionado, sempre alteradas por comandos (desfazer/refazer)

import * as THREE from 'three';

import { UIDiv, UIInput, UINumber, UIColor } from './libs/ui.js';

import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { RemoveObjectCommand } from './commands/RemoveObjectCommand.js';
import { SetValueCommand } from './commands/SetValueCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { SetMaterialColorCommand } from './commands/SetMaterialColorCommand.js';

import { clone } from '../../examples/jsm/utils/SkeletonUtils.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

function SimpleModeProperties( editor, context ) {

	const signals = editor.signals;

	const container = new UIDiv();
	container.setId( 'simple-right' );
	container.setClass( 'SimplePanel' );
	container.dom.setAttribute( 'aria-label', t( 'properties/title' ) );

	const header = createText( t( 'properties/title' ), 'SimpleSectionTitle SimplePanelTitle' );
	container.add( header );

	// estado vazio

	const empty = new UIDiv().setClass( 'SimpleEmptyState' );
	empty.dom.appendChild( createIcon( 'select' ) );
	empty.add( createText( t( 'properties/empty/title' ), 'SimpleEmptyTitle' ) );
	empty.add( createText( t( 'properties/empty/text' ), 'SimpleEmptyText' ) );
	container.add( empty );

	// formulário

	const form = new UIDiv().setClass( 'SimpleProperties' );
	container.add( form );

	// nome

	const nameSection = createSection( t( 'properties/name' ) );

	const objectName = new UIInput().setClass( 'SimpleTextInput' );
	objectName.dom.setAttribute( 'aria-label', t( 'properties/name' ) );
	objectName.dom.maxLength = 80;
	objectName.dom.addEventListener( 'change', function () {

		const object = editor.selected;
		const value = objectName.getValue().trim();

		if ( object === null ) return;

		if ( value === '' || value === object.name ) {

			objectName.setValue( object.name );
			return;

		}

		editor.execute( new SetValueCommand( editor, object, 'name', value ) );

	} );
	objectName.dom.addEventListener( 'keydown', function ( event ) {

		if ( event.key === 'Enter' ) objectName.dom.blur();

	} );
	nameSection.add( objectName );

	// transformações

	const position = createVectorRow( t( 'properties/position' ), { precision: 2, step: 0.1, nudge: 0.1 }, updatePosition );
	const rotation = createVectorRow( t( 'properties/rotation' ), { precision: 1, step: 10, nudge: 1, unit: '°' }, updateRotation );
	const scale = createVectorRow( t( 'properties/scale' ), { precision: 2, step: 0.1, nudge: 0.01, min: 0.01 }, updateScale );

	// cor

	const colorSection = createSection( t( 'properties/color' ) );

	const colorRow = new UIDiv().setClass( 'SimpleColorRow' );
	colorSection.add( colorRow );

	const objectColor = new UIColor().setClass( 'SimpleColorInput' );
	objectColor.dom.setAttribute( 'aria-label', t( 'properties/color' ) );
	objectColor.dom.style.width = '';
	objectColor.dom.style.height = '';

	const colorValue = createText( '', 'SimpleColorValue' );

	// 'input' atualiza ao vivo; o comando é "atualizável", então o arraste gera um único passo no histórico
	objectColor.dom.addEventListener( 'input', updateColor );

	colorRow.add( objectColor, colorValue );

	const colorUnavailable = createText( t( 'properties/color/unavailable' ), 'SimpleSectionHint' );
	colorSection.add( colorUnavailable );

	// ações

	const actionsSection = createSection( t( 'properties/actions' ) );
	const actions = new UIDiv().setClass( 'SimpleActions' );
	actionsSection.add( actions );

	actions.add( createSimpleButton( {
		icon: 'duplicate', label: t( 'properties/duplicate' ), title: t( 'properties/duplicate/title' ),
		onClick: duplicateObject
	} ) );

	actions.add( createSimpleButton( {
		icon: 'delete', label: t( 'properties/delete' ), title: t( 'properties/delete/title' ),
		className: 'danger',
		onClick: deleteObject
	} ) );

	// helpers de construção

	function createSection( title ) {

		const section = new UIDiv().setClass( 'SimpleSection' );
		section.add( createText( title, 'SimpleFieldLabel' ) );
		form.add( section );

		return section;

	}

	function createVectorRow( title, options, onChange ) {

		const section = createSection( title );
		const row = new UIDiv().setClass( 'SimpleVectorRow' );
		section.add( row );

		const fields = [];

		for ( const axis of [ 'x', 'y', 'z' ] ) {

			const field = new UIDiv().setClass( 'SimpleAxisField axis-' + axis );

			const label = createText( t( 'properties/axis/' + axis ), 'SimpleAxisLabel' );

			const number = new UINumber().setPrecision( options.precision ).setStep( options.step ).setNudge( options.nudge );
			if ( options.unit !== undefined ) number.setUnit( options.unit );
			if ( options.min !== undefined ) number.setRange( options.min, Infinity );
			number.setClass( 'SimpleNumber' );
			number.dom.style.width = '';
			number.dom.title = t( 'properties/axis/title', title, axis.toUpperCase() );
			number.dom.setAttribute( 'aria-label', t( 'properties/axis/title', title, axis.toUpperCase() ) );
			number.onChange( onChange );

			field.add( label, number );
			row.add( field );
			fields.push( number );

		}

		return { section, fields };

	}

	// comandos

	function getEditableObject() {

		const object = editor.selected;

		if ( object === null || object === editor.scene || object.parent === null ) return null;

		return object;

	}

	function updatePosition() {

		const object = getEditableObject();
		if ( object === null ) return;

		const [ x, y, z ] = position.fields;
		const value = new THREE.Vector3( x.getValue(), y.getValue(), z.getValue() );

		if ( object.position.distanceTo( value ) >= 0.001 ) {

			editor.execute( new SetPositionCommand( editor, object, value ) );

		}

	}

	function updateRotation() {

		const object = getEditableObject();
		if ( object === null ) return;

		const [ x, y, z ] = rotation.fields;
		const value = new THREE.Euler(
			x.getValue() * THREE.MathUtils.DEG2RAD,
			y.getValue() * THREE.MathUtils.DEG2RAD,
			z.getValue() * THREE.MathUtils.DEG2RAD,
			object.rotation.order
		);

		if ( new THREE.Vector3().setFromEuler( object.rotation ).distanceTo( new THREE.Vector3().setFromEuler( value ) ) >= 0.001 ) {

			editor.execute( new SetRotationCommand( editor, object, value ) );

		}

	}

	function updateScale() {

		const object = getEditableObject();
		if ( object === null ) return;

		const [ x, y, z ] = scale.fields;
		const value = new THREE.Vector3( x.getValue(), y.getValue(), z.getValue() );

		if ( object.scale.distanceTo( value ) >= 0.001 ) {

			editor.execute( new SetScaleCommand( editor, object, value ) );

		}

	}

	function getColorMaterial( object ) {

		const material = object.material;

		if ( material === undefined || Array.isArray( material ) ) return null;
		if ( material.color === undefined || material.color.isColor !== true ) return null;

		return material;

	}

	function updateColor() {

		const object = getEditableObject();
		if ( object === null ) return;

		const material = getColorMaterial( object );
		if ( material === null ) return;

		const hex = objectColor.getHexValue();

		if ( material.color.getHex() !== hex ) {

			editor.execute( new SetMaterialColorCommand( editor, object, 'color', hex ) );

		}

		colorValue.setTextContent( objectColor.getValue().toUpperCase() );

	}

	function duplicateObject() {

		const object = getEditableObject();

		if ( object === null ) {

			context.notify( t( 'message/nothingSelected' ) );
			return;

		}

		const copy = clone( object );

		// materiais próprios: mudar a cor da cópia não deve alterar o original
		copy.traverse( function ( child ) {

			if ( child.material === undefined ) return;

			child.material = Array.isArray( child.material ) ?
				child.material.map( ( material ) => material.clone() ) :
				child.material.clone();

		} );

		copy.name = object.name !== '' ? object.name + ' ' + t( 'properties/copySuffix' ) : '';

		if ( object.parent !== editor.scene ) {

			// AddObjectCommand insere na raiz da cena; preserva a posição visual de objetos aninhados
			object.matrixWorld.decompose( copy.position, copy.quaternion, copy.scale );

		}

		copy.position.x += 1.2; // desloca a cópia para que ela fique visível ao lado do original

		editor.execute( new AddObjectCommand( editor, copy ) );

		context.notify( t( 'message/duplicated' ), 'success' );

	}

	function deleteObject() {

		const object = getEditableObject();

		if ( object === null ) {

			context.notify( t( 'message/nothingSelected' ) );
			return;

		}

		editor.execute( new RemoveObjectCommand( editor, object ) );

		context.notify( t( 'message/deleted' ) );

	}

	// sincronização com o objeto 3D

	function updateUI() {

		const object = getEditableObject();

		const hasObject = object !== null;

		empty.dom.hidden = hasObject;
		form.dom.hidden = ! hasObject;

		if ( hasObject === false ) return;

		if ( document.activeElement !== objectName.dom ) objectName.setValue( object.name );

		position.fields[ 0 ].setValue( object.position.x );
		position.fields[ 1 ].setValue( object.position.y );
		position.fields[ 2 ].setValue( object.position.z );

		rotation.fields[ 0 ].setValue( object.rotation.x * THREE.MathUtils.RAD2DEG );
		rotation.fields[ 1 ].setValue( object.rotation.y * THREE.MathUtils.RAD2DEG );
		rotation.fields[ 2 ].setValue( object.rotation.z * THREE.MathUtils.RAD2DEG );

		scale.fields[ 0 ].setValue( object.scale.x );
		scale.fields[ 1 ].setValue( object.scale.y );
		scale.fields[ 2 ].setValue( object.scale.z );

		// luzes não usam rotação/escala de forma significativa
		rotation.section.setDisplay( object.isLight ? 'none' : '' );
		scale.section.setDisplay( object.isLight ? 'none' : '' );

		updateColorUI( object );

	}

	function updateColorUI( object ) {

		const material = getColorMaterial( object );
		const available = material !== null;

		if ( available ) {

			objectColor.setHexValue( material.color.getHex() );
			colorValue.setTextContent( objectColor.getValue().toUpperCase() );

		}

		colorRow.setDisplay( available ? '' : 'none' );
		colorUnavailable.setDisplay( available ? 'none' : '' );

	}

	signals.objectSelected.add( updateUI );

	signals.objectChanged.add( function ( object ) {

		if ( object === editor.selected ) updateUI();

	} );

	signals.refreshSidebarObject3D.add( function ( object ) {

		if ( object === editor.selected ) updateUI();

	} );

	signals.materialChanged.add( function ( object ) {

		if ( object !== undefined && object === editor.selected ) updateColorUI( object );

	} );

	signals.editorCleared.add( updateUI );

	updateUI();

	return container;

}

export { SimpleModeProperties };
