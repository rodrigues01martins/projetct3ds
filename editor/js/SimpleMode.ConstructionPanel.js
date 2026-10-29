// EV-006 — Ferramentas de Construção e Montagem 3D
// Painel compacto de opções da ferramenta de construção ativa (aparece abaixo da barra de opções).

import { UIDiv } from './libs/ui.js';

import { getDefinition } from './SimpleMode.Components.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';

function limits( componentId, key ) {

	const parameter = getDefinition( componentId ).parameters.find( ( item ) => item.key === key );
	return [ parameter.min, parameter.max ];

}

function SimpleModeConstructionPanel( editor, context, container ) {

	const construction = context.construction;
	const interaction = context.interaction;
	const units = context.units;

	const panel = new UIDiv().setClass( 'SimpleMeasureStatus SimpleConstructionPanel' );
	panel.dom.setAttribute( 'role', 'group' );
	panel.dom.hidden = true;
	container.add( panel );
	container.dom.appendChild( construction.label );

	const title = createText( '', 'SimpleConstructionTitle' );
	panel.add( title );

	const fields = new UIDiv().setClass( 'SimpleConstructionFields' );
	panel.add( fields );

	// campos numéricos na unidade do projeto (EV-002); validam pelos limites do componente
	function lengthField( key, component, parameter, labelKey ) {

		const wrapper = document.createElement( 'label' );
		wrapper.className = 'SimpleConstructionField';

		const text = document.createElement( 'span' );
		text.textContent = t( labelKey );
		wrapper.appendChild( text );

		const field = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField' );
		const [ min, max ] = limits( component, parameter );

		const input = new SimpleNumberInput( {
			kind: 'length', units, label: t( labelKey ), min, exclusiveMin: false,
			onCommit: ( value ) => {

				if ( value > max ) {

					context.notify( t( 'component/range', t( labelKey ), units.format( min ), units.format( max ) ), 'warning' );
					input.value = construction.settings[ key ];
					input.render( true ); // o campo continua em foco: força exibir de novo o valor válido
					return;

				}

				construction.setSetting( key, value );

			},
			onInvalid: () => context.notify( t( 'component/range', t( labelKey ), units.format( min ), units.format( max ) ), 'warning' )
		} );

		const suffix = createText( '', 'SimpleUnitSuffix' );
		field.add( input, suffix );
		wrapper.appendChild( field.dom );

		return { wrapper, input, suffix, key };

	}

	const wallHeight = lengthField( 'wallHeight', 'wall', 'height', 'construction/wall/height' );
	const wallThickness = lengthField( 'wallThickness', 'wall', 'thickness', 'construction/wall/thickness' );
	const floorThickness = lengthField( 'floorThickness', 'floor', 'thickness', 'construction/floor/thickness' );
	const lengthFields = [ wallHeight, wallThickness, floorThickness ];

	const orthoRow = document.createElement( 'label' );
	orthoRow.className = 'SimpleCheckboxRow SimpleConstructionToggle';
	orthoRow.title = t( 'construction/ortho/title' );

	const ortho = document.createElement( 'input' );
	ortho.type = 'checkbox';
	ortho.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
	ortho.addEventListener( 'change', () => construction.setSetting( 'ortho', ortho.checked ) );
	orthoRow.appendChild( ortho );

	const orthoText = document.createElement( 'span' );
	orthoText.textContent = t( 'construction/ortho' );
	orthoRow.appendChild( orthoText );

	for ( const element of [ wallHeight.wrapper, wallThickness.wrapper, floorThickness.wrapper, orthoRow ] ) fields.dom.appendChild( element );

	const readout = createText( '', 'SimpleConstructionReadout' );
	readout.dom.setAttribute( 'aria-live', 'polite' );
	panel.add( readout );

	const hint = createText( '', 'SimpleSectionHint SimpleConstructionHint' );
	panel.add( hint );

	const actions = new UIDiv().setClass( 'SimpleConstructionActions' );
	panel.add( actions );

	const finish = createSimpleButton( { label: t( 'construction/wall/finish' ), title: t( 'construction/wall/finish/title' ), className: 'SimpleMeasureAction', onClick: () => construction.finishWall() } );
	const rotate = createSimpleButton( { label: t( 'construction/place/rotate' ), title: t( 'construction/place/rotate/title' ), className: 'SimpleMeasureAction', onClick: () => construction.rotatePlacement() } );
	const exit = createSimpleButton( { icon: 'close', title: t( 'construction/exit' ), className: 'SimpleIconButton', onClick: () => interaction.deactivate() } );
	actions.add( finish, rotate, exit );

	function show( element, visible ) {

		( element.dom || element ).hidden = ! visible;

	}

	function refresh() {

		const state = construction.state;
		const tool = state.tool;

		panel.dom.hidden = tool === null;
		if ( tool === null ) return;

		panel.dom.dataset.tool = tool;
		title.setTextContent( t( 'construction/title/' + tool, state.label ) );

		show( wallHeight.wrapper, tool === 'wall' );
		show( wallThickness.wrapper, tool === 'wall' );
		show( floorThickness.wrapper, tool === 'floor' );
		show( orthoRow, tool === 'wall' );
		show( finish, tool === 'wall' && state.phase === 'end' );
		show( rotate, tool === 'place' );
		show( fields, tool === 'wall' || tool === 'floor' );

		for ( const field of lengthFields ) {

			field.input.setValue( construction.settings[ field.key ] );
			field.suffix.setTextContent( units.getUnit().label );

		}

		ortho.checked = construction.settings.ortho;

		// leitura em tempo real
		let text = '';

		if ( tool === 'wall' && state.length !== null ) text = t( 'construction/wall/readout', units.format( state.length ), units.format( construction.settings.wallHeight ), units.format( construction.settings.wallThickness ) );
		if ( tool === 'floor' && state.width !== null ) text = t( 'construction/floor/readout', units.format( state.width ), units.format( state.depth ), ( state.width * state.depth ).toLocaleString( 'pt-BR', { maximumFractionDigits: 2 } ) );
		if ( ( tool === 'place' || tool === 'rest' ) && state.snap ) text = state.snap;

		readout.setTextContent( text );
		readout.dom.classList.toggle( 'invalid', state.valid === false );

		const snap = context.precision.getSnapOption();
		hint.setTextContent( t( 'construction/hint/' + tool + ( state.phase === 'end' ? '/end' : '' ), snap.label ) );

	}

	construction.changed.add( refresh );
	interaction.changed.add( refresh );
	units.changed.add( refresh );
	context.precision.changed.add( refresh );
	refresh();

	return panel;

}

export { SimpleModeConstructionPanel };
