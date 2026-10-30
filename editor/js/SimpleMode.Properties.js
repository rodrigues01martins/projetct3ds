// EV-001 — Modo Simples de Criação 3D
// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
// D. Painel direito: propriedades do objeto selecionado, sempre alteradas por comandos (desfazer/refazer).
//
// Seções: 1. Informações  2. Dimensões  3. Posição  4. Rotação  5. Escala
//         6. Aparência    7. Alinhamento e distribuição  8. Ações

import * as THREE from 'three';

import { UIDiv, UIInput } from './libs/ui.js';

import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { RemoveObjectCommand } from './commands/RemoveObjectCommand.js';
import { SetValueCommand } from './commands/SetValueCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';

import { clone } from '../../examples/jsm/utils/SkeletonUtils.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';
import { getDimensionInfo, computeScaleForSize } from './SimpleMode.Dimensions.js';
import { SimpleModeComponentProperties } from './SimpleMode.ComponentProperties.js';
import { getComponentState, isUserComponent } from './SimpleMode.ComponentFactory.js';
import { getCategory } from './SimpleMode.Components.js';
import { SimpleModeAppearancePanel } from './SimpleMode.AppearancePanel.js';
import { SimpleModeOpeningProperties } from './SimpleMode.OpeningProperties.js';
import { isHostedFixture, getOpeningOf, relinkClone } from './SimpleMode.Openings.js';

const SECTIONS_KEY = 'interface/simple/sections';
const AXES = [ 'x', 'y', 'z' ];

function SimpleModeProperties( editor, context ) {

	const signals = editor.signals;
	const config = editor.config;
	const units = context.units;
	const alignment = context.alignment;

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

	// seções recolhíveis (<details>), com estado aberto/fechado lembrado entre sessões

	const sectionState = Object.assign( {}, config.getKey( SECTIONS_KEY ) );

	function createSection( id, title, openByDefault = true ) {

		const details = document.createElement( 'details' );
		details.className = 'SimpleSection SimpleCollapsible';
		details.dataset.section = id;
		details.open = sectionState[ id ] !== undefined ? sectionState[ id ] : openByDefault;

		const summary = document.createElement( 'summary' );
		summary.className = 'SimpleFieldLabel';

		const summaryText = document.createElement( 'span' );
		summaryText.textContent = title;
		summary.appendChild( summaryText );

		details.appendChild( summary );

		details.addEventListener( 'toggle', function () {

			sectionState[ id ] = details.open;
			config.setKey( SECTIONS_KEY, Object.assign( {}, sectionState ) );

		} );

		form.dom.appendChild( details );

		const body = new UIDiv().setClass( 'SimpleSectionBody' );
		details.appendChild( body.dom );

		return { details, summaryText, body, setTitle: ( text ) => ( summaryText.textContent = text ) };

	}

	function invalidNumber() {

		context.notify( t( 'message/invalidNumber' ), 'warning' );

	}

	// 1. Informações do objeto ----------------------------------------------

	const infoSection = createSection( 'info', t( 'properties/section/info' ) );

	infoSection.body.add( createText( t( 'properties/name' ), 'SimpleSubLabel' ) );

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
	infoSection.body.add( objectName );

	const objectType = createText( '', 'SimpleObjectType' );
	infoSection.body.add( objectType );

	const objectCategory = createText( '', 'SimpleObjectType' );
	infoSection.body.add( objectCategory );

	// 2. Dimensões -----------------------------------------------------------

	const dimSection = createSection( 'dimensions', t( 'properties/section/dimensions' ) );

	const dimGrid = new UIDiv().setClass( 'SimpleDimensionGrid' );
	dimSection.body.add( dimGrid );

	const dimensionFields = AXES.map( function ( axis, index ) {

		const row = new UIDiv().setClass( 'SimpleDimensionRow axis-' + axis );

		const label = createText( '', 'SimpleDimensionLabel' );

		const field = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField axis-' + axis );
		field.add( createText( axis.toUpperCase(), 'SimpleAxisLabel' ) );

		const input = new SimpleNumberInput( {
			kind: 'length', units, min: 0, exclusiveMin: true,
			onCommit: ( value ) => updateDimension( index, value ),
			onInvalid: () => context.notify( t( 'message/invalidDimension' ), 'warning' )
		} );
		field.add( input );

		const unit = createText( '', 'SimpleUnitSuffix' );
		field.add( unit );

		row.add( label, field );
		dimGrid.add( row );

		return { row, label, input, unit };

	} );

	const proportionRow = document.createElement( 'label' );
	proportionRow.className = 'SimpleCheckboxRow';

	const keepProportions = document.createElement( 'input' );
	keepProportions.type = 'checkbox';
	keepProportions.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
	proportionRow.appendChild( keepProportions );
	proportionRow.appendChild( createIcon( 'lock' ) );

	const proportionText = document.createElement( 'span' );
	proportionText.textContent = t( 'dimensions/keepProportions' );
	proportionRow.appendChild( proportionText );
	proportionRow.title = t( 'dimensions/keepProportions/title' );

	dimSection.body.dom.appendChild( proportionRow );

	const dimHint = createText( '', 'SimpleSectionHint SimpleDimensionHint' );
	dimSection.body.add( dimHint );

	let proportionObject = null; // objeto para o qual o padrão de "manter proporções" já foi definido

	// EV-003: dimensões e parâmetros próprios dos componentes paramétricos (substituem a seção genérica)

	const componentDimSection = createSection( 'componentDimensions', t( 'properties/section/dimensions' ) );
	const componentParamSection = createSection( 'componentParameters', t( 'properties/section/parameters' ) );
	const componentProperties = new SimpleModeComponentProperties( editor, context, componentDimSection, componentParamSection );

	// EV-007: abertura na parede (porta/janela hospedada) ou resumo das aberturas da parede
	const openingSection = createSection( 'opening', t( 'properties/section/opening' ) );
	const openingProperties = new SimpleModeOpeningProperties( editor, context, openingSection );

	// 3. Posição, 4. Rotação, 5. Escala ------------------------------------

	const positionSection = createSection( 'position', t( 'properties/position' ) );
	const position = createVectorRow( positionSection, { kind: 'length', label: t( 'properties/position' ) }, updatePosition );

	const rotationSection = createSection( 'rotation', t( 'properties/rotation' ) );
	const rotation = createVectorRow( rotationSection, { kind: 'angle', label: t( 'properties/rotation' ), suffix: '°' }, updateRotation );

	const scaleSection = createSection( 'scale', t( 'properties/scale' ), false );
	const scale = createVectorRow( scaleSection, { kind: 'factor', label: t( 'properties/scale' ), min: 0, exclusiveMin: true }, updateScale );
	scaleSection.body.add( createText( t( 'properties/scale/hint' ), 'SimpleSectionHint' ) );

	function createVectorRow( section, options, onChange ) {

		const row = new UIDiv().setClass( 'SimpleVectorRow' );
		section.body.add( row );

		const fields = AXES.map( function ( axis ) {

			const field = new UIDiv().setClass( 'SimpleAxisField axis-' + axis );
			field.add( createText( t( 'properties/axis/' + axis ), 'SimpleAxisLabel' ) );

			const input = new SimpleNumberInput( {
				kind: options.kind,
				units,
				label: t( 'properties/axis/title', options.label, axis.toUpperCase() ),
				min: options.min,
				exclusiveMin: options.exclusiveMin,
				onCommit: onChange,
				onInvalid: invalidNumber
			} );
			field.add( input );

			if ( options.suffix !== undefined ) field.add( createText( options.suffix, 'SimpleUnitSuffix' ) );

			row.add( field );

			return input;

		} );

		return { section, fields };

	}

	// 6. Aparência -------------------------------------------------------------

	// EV-004: acabamentos (materiais, texturas procedurais e partes lógicas dos componentes)
	const colorSection = createSection( 'appearance', t( 'properties/section/appearance' ) );
	const appearancePanel = new SimpleModeAppearancePanel( editor, context, colorSection );

	// 7. Alinhamento e distribuição -------------------------------------------

	const alignSection = createSection( 'alignment', t( 'properties/section/alignment' ), false );

	const alignSummary = createText( '', 'SimpleAlignSummary' );
	alignSection.body.add( alignSummary );

	const alignTable = new UIDiv().setClass( 'SimpleAlignTable' );
	alignSection.body.add( alignTable );

	const alignButtons = [];
	const distributeButtons = [];

	for ( const axis of AXES ) {

		const row = new UIDiv().setClass( 'SimpleAlignRow axis-' + axis );
		row.add( createText( axis.toUpperCase(), 'SimpleAxisLabel' ) );

		for ( const mode of [ 'start', 'center', 'end' ] ) {

			const button = createSimpleButton( {
				icon: { start: 'alignStart', center: 'alignCenter', end: 'alignEnd' }[ mode ],
				label: t( 'align/' + mode ),
				title: t( 'align/' + mode + '/title', axis.toUpperCase() ),
				className: 'SimpleAlignButton',
				onClick: () => runAlignment( () => alignment.align( axis, mode ) )
			} );

			alignButtons.push( button );
			row.add( button );

		}

		const distribute = createSimpleButton( {
			icon: 'distribute',
			label: t( 'align/distribute' ),
			title: t( 'align/distribute/title', axis.toUpperCase() ),
			className: 'SimpleAlignButton',
			onClick: () => runAlignment( () => alignment.distribute( axis ) )
		} );

		distributeButtons.push( distribute );
		row.add( distribute );

		alignTable.add( row );

	}

	alignSection.body.add( createText( t( 'align/hint' ), 'SimpleSectionHint' ) );

	const clearMarks = createSimpleButton( {
		label: t( 'align/clearMarks' ), title: t( 'align/clearMarks/title' ), className: 'SimpleLinkButton',
		onClick: () => alignment.clear()
	} );
	alignSection.body.add( clearMarks );

	function runAlignment( operation ) {

		const result = operation();

		if ( typeof result === 'string' ) {

			context.notify( t( 'message/align/' + result ), 'warning' );

		} else if ( result === 0 ) {

			context.notify( t( 'message/align/nothing' ) );

		} else {

			context.notify( t( 'message/align/done', result ), 'success' );

		}

	}

	function updateAlignmentUI() {

		const { reference, others, selectedIsNested } = alignment.getParticipants();

		const canAlign = reference !== null && others.length > 0;
		const canDistribute = ( reference !== null ? 1 : 0 ) + others.length >= 3;

		for ( const button of alignButtons ) setButtonEnabled( button, canAlign );
		for ( const button of distributeButtons ) setButtonEnabled( button, canDistribute );

		clearMarks.dom.hidden = others.length === 0;

		const summary = alignSummary.dom;
		summary.textContent = '';

		if ( selectedIsNested ) {

			summary.textContent = t( 'align/nested' );

		} else if ( reference === null ) {

			summary.textContent = t( 'align/noReference' );

		} else {

			const refLine = document.createElement( 'div' );
			refLine.append( t( 'align/reference' ) + ' ' );
			const refName = document.createElement( 'strong' );
			refName.textContent = reference.name || t( 'objects/unnamed' );
			refLine.append( refName );
			summary.appendChild( refLine );

			const othersLine = document.createElement( 'div' );
			othersLine.textContent = others.length > 0 ?
				t( 'align/included', others.map( ( object ) => object.name || t( 'objects/unnamed' ) ).join( ', ' ) ) :
				t( 'align/markHint' );
			summary.appendChild( othersLine );

		}

		// mostra o número de objetos envolvidos no título da seção
		alignSection.setTitle( t( 'properties/section/alignment' ) + ( others.length > 0 ? ' (' + ( others.length + ( reference !== null ? 1 : 0 ) ) + ')' : '' ) );

		if ( others.length > 0 && alignSection.details.open === false && alignSection.autoOpened !== true ) {

			// abre a seção na primeira marcação, para mostrar onde estão as ações
			alignSection.details.open = true;
			alignSection.autoOpened = true;

		}

	}

	function setButtonEnabled( button, enabled ) {

		button.dom.disabled = ! enabled;
		button.dom.classList.toggle( 'disabled', ! enabled );

	}

	alignment.changed.add( updateAlignmentUI );

	// 8. Ações -----------------------------------------------------------------

	const actionsSection = createSection( 'actions', t( 'properties/actions' ) );
	const actions = new UIDiv().setClass( 'SimpleActions' );
	actionsSection.body.add( actions );

	actions.add( createSimpleButton( {
		icon: 'duplicate', label: t( 'properties/duplicate' ), title: t( 'properties/duplicate/title' ),
		onClick: duplicateObject
	} ) );

	actions.add( createSimpleButton( {
		icon: 'delete', label: t( 'properties/delete' ), title: t( 'properties/delete/title' ),
		className: 'danger',
		onClick: deleteObject
	} ) );

	// EV-003: salvar em "Meus componentes" (formulário em linha, sem janela modal)

	const userLibrary = context.userLibrary;

	// EV-006: apoiar o objeto selecionado em uma superfície horizontal (prévia + SetPositionCommand)
	const restButton = createSimpleButton( {
		icon: 'rest', label: t( 'construction/rest/action' ), title: t( 'construction/rest/action/title' ),
		className: 'SimpleRestButton',
		onClick: function () {

			const object = getEditableObject();
			const problem = context.construction.canRest( object );

			if ( problem !== null ) {

				context.notify( problem, 'warning' );
				return;

			}

			context.startTool( 'rest', { object } );

		}
	} );
	actionsSection.body.add( restButton );

	const saveButton = createSimpleButton( {
		icon: 'bookmark', label: t( 'library/save' ), title: t( 'library/save/title' ),
		className: 'SimpleSaveComponent',
		onClick: openSaveForm
	} );
	actionsSection.body.add( saveButton );

	const saveForm = document.createElement( 'form' );
	saveForm.className = 'SimpleSaveForm';
	saveForm.hidden = true;
	saveForm.setAttribute( 'aria-label', t( 'library/save' ) );
	saveForm.noValidate = true;

	const saveName = document.createElement( 'input' );
	saveName.className = 'SimpleTextInput';
	saveName.maxLength = userLibrary.LIMITS.name;
	saveName.placeholder = t( 'library/save/name' );
	saveName.setAttribute( 'aria-label', t( 'library/save/name' ) );

	const saveCategory = document.createElement( 'input' );
	saveCategory.className = 'SimpleTextInput';
	saveCategory.maxLength = userLibrary.LIMITS.category;
	saveCategory.placeholder = t( 'library/save/category' );
	saveCategory.setAttribute( 'aria-label', t( 'library/save/category' ) );
	saveCategory.setAttribute( 'list', 'simple-category-list' );

	const categoryList = document.createElement( 'datalist' );
	categoryList.id = 'simple-category-list';

	for ( const input of [ saveName, saveCategory ] ) {

		input.addEventListener( 'keydown', function ( event ) {

			event.stopPropagation();
			if ( event.key === 'Escape' ) closeSaveForm();

		} );

	}

	const saveLabels = [[ 'library/save/name', saveName ], [ 'library/save/category', saveCategory ]];

	for ( const [ key, input ] of saveLabels ) {

		const label = document.createElement( 'label' );
		label.className = 'SimpleSubLabel';
		label.textContent = t( key );
		label.appendChild( input );
		saveForm.appendChild( label );

	}

	saveForm.appendChild( categoryList );

	const saveFormActions = document.createElement( 'div' );
	saveFormActions.className = 'SimpleActions';

	const saveConfirm = createSimpleButton( { icon: 'bookmark', label: t( 'library/save/confirm' ), className: 'active' } );
	saveConfirm.dom.type = 'submit';
	saveFormActions.appendChild( saveConfirm.dom );
	saveFormActions.appendChild( createSimpleButton( { label: t( 'library/save/cancel' ), onClick: closeSaveForm } ).dom );
	saveForm.appendChild( saveFormActions );

	const saveHint = createText( t( 'library/mine/notice' ), 'SimpleSectionHint' );
	saveForm.appendChild( saveHint.dom );

	actionsSection.body.dom.appendChild( saveForm );

	saveForm.addEventListener( 'submit', async function ( event ) {

		event.preventDefault();

		const object = getEditableObject();
		if ( object === null ) return;

		saveConfirm.dom.disabled = true;

		try {

			const record = await userLibrary.save( object, saveName.value, saveCategory.value );
			closeSaveForm();
			context.notify( t( 'message/library/saved', record.name ), 'success' );
			if ( context.showMyComponents !== undefined ) context.showMyComponents();

		} catch ( error ) {

			console.error( error );
			context.notify( error.message || t( 'message/library/saveError' ), 'error' );

		} finally {

			saveConfirm.dom.disabled = false;

		}

	} );

	function openSaveForm() {

		const object = getEditableObject();
		const problem = userLibrary.canSave( object, editor.scene );

		if ( problem !== null ) {

			context.notify( problem, 'warning' );
			return;

		}

		categoryList.textContent = '';

		for ( const category of userLibrary.getCategories() ) {

			const option = document.createElement( 'option' );
			option.value = category;
			categoryList.appendChild( option );

		}

		saveName.value = object.name;
		saveCategory.value = '';
		saveForm.hidden = false;
		saveButton.dom.hidden = true;
		saveName.focus();
		saveName.select();

	}

	function closeSaveForm() {

		saveForm.hidden = true;
		saveButton.dom.hidden = false;

	}

	editor.signals.objectSelected.add( closeSaveForm );

	// comandos -------------------------------------------------------------------

	function getEditableObject() {

		const object = editor.selected;

		if ( object === null || object === editor.scene || object.parent === null ) return null;

		return object;

	}

	function getVector( fields ) {

		return new THREE.Vector3( fields[ 0 ].value, fields[ 1 ].value, fields[ 2 ].value );

	}

	// valores digitados são aplicados exatamente, sem o encaixe das alças
	function updatePosition() {

		const object = getEditableObject();
		if ( object === null ) return;

		const value = getVector( position.fields );

		if ( object.position.equals( value ) === false ) {

			editor.execute( new SetPositionCommand( editor, object, value ) );

		}

	}

	function updateRotation() {

		const object = getEditableObject();
		if ( object === null ) return;

		const [ x, y, z ] = rotation.fields;
		const value = new THREE.Euler(
			x.value * THREE.MathUtils.DEG2RAD,
			y.value * THREE.MathUtils.DEG2RAD,
			z.value * THREE.MathUtils.DEG2RAD,
			object.rotation.order
		);

		if ( object.rotation.equals( value ) === false ) {

			editor.execute( new SetRotationCommand( editor, object, value ) );

		}

	}

	function updateScale() {

		const object = getEditableObject();
		if ( object === null ) return;

		const value = getVector( scale.fields );

		if ( object.scale.equals( value ) === false ) {

			editor.execute( new SetScaleCommand( editor, object, value ) );

		}

	}

	function updateDimension( axis, meters ) {

		const object = getEditableObject();
		if ( object === null ) return;

		// recalcula a partir do objeto (fonte de verdade), nunca do texto exibido
		const info = getDimensionInfo( object );
		const newScale = computeScaleForSize( object, info, axis, meters, keepProportions.checked );

		if ( newScale === null ) {

			context.notify( t( 'message/invalidDimension' ), 'warning' );
			updateDimensionUI( object );
			return;

		}

		if ( object.scale.equals( newScale ) === false ) {

			editor.execute( new SetScaleCommand( editor, object, newScale ) );

		}

	}

	function duplicateObject() {

		const object = getEditableObject();

		if ( object === null ) {

			context.notify( t( 'message/nothingSelected' ) );
			return;

		}

		// EV-007: porta/janela hospedada pertence a um vão; uma nova abertura é inserida pela ferramenta
		if ( isHostedFixture( object ) ) {

			context.notify( t( 'opening/noDuplicate' ), 'warning' );
			return;

		}

		const copy = clone( object );

		// EV-007: aberturas da cópia ganham identificadores próprios e apontam para as próprias portas/janelas
		relinkClone( object, copy );

		// materiais próprios: mudar a cor da cópia não deve alterar o original
		copy.traverse( function ( child ) {

			if ( child.material === undefined ) return;

			child.material = Array.isArray( child.material ) ?
				child.material.map( ( material ) => material.clone() ) :
				child.material.clone();

			// geometria própria: regenerar um componente copiado não afeta o original (EV-003)
			if ( child.geometry !== undefined ) child.geometry = child.geometry.clone();

			// EV-004: texturas com repetição própria (a imagem continua compartilhada na GPU)
			for ( const material of Array.isArray( child.material ) ? child.material : [ child.material ] ) {

				if ( material.map ) material.map = material.map.clone();

			}

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

		// EV-007: remover a porta/janela fecha o vão (abertura inteira, um único Desfazer)
		if ( isHostedFixture( object ) && getOpeningOf( object ) !== null ) {

			openingProperties.removeHosted();
			return;

		}

		editor.execute( new RemoveObjectCommand( editor, object ) );

		context.notify( t( 'message/deleted' ) );

	}

	// sincronização com o objeto 3D ---------------------------------------------

	const TYPE_NAMES = {
		cube: 'objects/cube', sphere: 'objects/sphere', cylinder: 'objects/cylinder', plane: 'objects/plane'
	};

	function getTypeName( object, info ) {

		const component = getComponentState( object );

		if ( component !== null ) {

			if ( component.definition === null ) return t( 'type/component/unknown' );
			return component.definition.name + ( component.reason === 'newer' ? ' ' + t( 'type/component/newer' ) : '' );

		}

		if ( isUserComponent( object ) ) return t( 'type/userComponent' );
		if ( info.primitive !== null ) return t( TYPE_NAMES[ info.primitive ] );
		if ( object.isLight ) return t( 'type/light' );
		if ( object.isCamera ) return t( 'type/camera' );
		if ( info.kind === 'group' ) return object.isGroup ? t( 'type/group' ) : t( 'type/model' );
		if ( info.kind === 'mesh' ) return t( 'type/model' );

		return t( 'type/other' );

	}

	function updateUI() {

		const object = getEditableObject();

		const hasObject = object !== null;

		empty.dom.hidden = hasObject;
		form.dom.hidden = ! hasObject;

		updateAlignmentUI();

		if ( hasObject === false ) return;

		if ( document.activeElement !== objectName.dom ) objectName.setValue( object.name );

		AXES.forEach( function ( axis, index ) {

			position.fields[ index ].setValue( object.position[ axis ] );
			rotation.fields[ index ].setValue( object.rotation[ axis ] * THREE.MathUtils.RAD2DEG );
			scale.fields[ index ].setValue( object.scale[ axis ] );

		} );

		// luzes não usam rotação/escala de forma significativa
		// EV-007: porta/janela hospedada é posicionada pela abertura (seção "Abertura na parede")
		const hosted = isHostedFixture( object );
		positionSection.details.hidden = hosted;
		rotation.section.details.hidden = object.isLight === true || hosted;
		scale.section.details.hidden = object.isLight === true || hosted;
		restButton.dom.hidden = hosted;

		openingSection.details.hidden = openingProperties.update( object ) === false;
		openingSection.setTitle( t( hosted ? 'properties/section/opening' : 'properties/section/openings' ) );

		updateDimensionUI( object );

		// componente paramétrico: campos próprios no lugar da seção genérica de dimensões
		const isParametric = componentProperties.update( object );
		if ( isParametric ) dimSection.details.hidden = true;

		// EV-004: aparência para básicos, componentes e grupos/malhas com material
		colorSection.details.hidden = appearancePanel.update( object ) === false;

		updateCategory( object );

	}

	function updateCategory( object ) {

		const component = getComponentState( object );
		let text = '';

		if ( component !== null && component.definition !== null ) {

			const category = getCategory( component.definition.category );
			text = t( 'properties/category', category !== null ? category.name : '' );

		} else if ( isUserComponent( object ) ) {

			text = t( 'properties/category', t( 'library/tab/mine' ) );

		}

		objectCategory.setTextContent( text );
		objectCategory.dom.hidden = text === '';

	}

	function updateDimensionUI( object ) {

		const info = getDimensionInfo( object );

		objectType.setTextContent( getTypeName( object, info ) );

		dimSection.details.hidden = info.kind === 'none';

		if ( info.kind === 'none' ) return;

		// padrão de "manter proporções": esferas, grupos e modelos; cubos, cilindros e planos editam eixos livres
		if ( proportionObject !== object ) {

			proportionObject = object;
			keepProportions.checked = info.primitive === 'sphere' || info.uniformOnly;

		}

		if ( info.uniformOnly ) keepProportions.checked = true;
		keepProportions.disabled = info.uniformOnly || info.editable === false;

		const labels = info.primitive === 'plane' ?
			[ 'dimensions/width', 'dimensions/length', 'dimensions/thickness' ] :
			[ 'dimensions/width', 'dimensions/height', 'dimensions/depth' ];

		dimensionFields.forEach( function ( field, index ) {

			field.label.setTextContent( t( labels[ index ] ) );
			field.unit.setTextContent( units.getUnit().label );
			field.input.setValue( info.size.getComponent( index ) );

			const editable = info.editable && info.axisEditable[ index ];
			const noThickness = info.axisEditable[ index ] === false;

			field.input.setDisabled( editable === false, noThickness ? t( 'dimensions/none' ) : undefined );
			field.input.dom.setAttribute( 'aria-label', t( labels[ index ] ) + ' (' + units.getUnit().name.toLowerCase() + ')' );
			field.input.dom.title = noThickness ? t( 'dimensions/noThickness' ) : t( labels[ index ] );
			field.row.dom.classList.toggle( 'disabled', editable === false );

		} );

		let hint = '';

		if ( info.reason === 'deformed' || info.reason === 'instanced' ) hint = t( 'dimensions/hint/deformed' );
		else if ( info.reason === 'animated' ) hint = t( 'dimensions/hint/animated' );
		else if ( info.primitive === 'plane' ) hint = t( 'dimensions/hint/plane' );
		else if ( info.kind === 'group' ) hint = t( 'dimensions/hint/group' );
		else if ( info.primitive === null ) hint = t( 'dimensions/hint/imported' );
		else if ( info.primitive === 'sphere' ) hint = t( 'dimensions/hint/sphere' );

		dimHint.setTextContent( hint );
		dimHint.dom.hidden = hint === '';

	}

	function updateUnitLabels() {

		const unit = units.getUnit();
		positionSection.setTitle( t( 'properties/position' ) + ' (' + unit.label + ')' );
		dimSection.setTitle( t( 'properties/section/dimensions' ) + ' (' + unit.label + ')' );
		componentDimSection.setTitle( t( 'properties/section/dimensions' ) + ' (' + unit.label + ')' );

		if ( getEditableObject() !== null ) updateUI();

	}

	signals.objectSelected.add( updateUI );

	signals.objectChanged.add( function ( object ) {

		if ( object === editor.selected ) updateUI();

	} );

	signals.refreshSidebarObject3D.add( function ( object ) {

		if ( object === editor.selected ) updateUI();

	} );

	signals.geometryChanged.add( function ( object ) {

		if ( object === editor.selected ) updateUI();

	} );

	signals.sceneGraphChanged.add( updateAlignmentUI );
	signals.editorCleared.add( updateUI );
	units.changed.add( updateUnitLabels );

	updateUnitLabels();
	updateUI();

	return container;

}

export { SimpleModeProperties };
