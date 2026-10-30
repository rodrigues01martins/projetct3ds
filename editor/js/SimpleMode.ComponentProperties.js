// EV-003 — Biblioteca Inteligente de Componentes 3D
//
// Seções "Dimensões" e "Parâmetros" do painel direito para componentes paramétricos.
// Toda alteração é um SetComponentParametersCommand (regeneração das peças, reversível).
// As medidas exibidas consideram a escala efetiva da instância; com escala diferente de 1 a edição
// paramétrica fica bloqueada até o usuário incorporar a escala (operação explícita, um único Desfazer).

import { UIDiv } from './libs/ui.js';

import { SetComponentParametersCommand } from './commands/SetComponentParametersCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';

import { validateParameters } from './SimpleMode.Components.js';
import { getComponentState } from './SimpleMode.ComponentFactory.js';
import { getPartMeta } from './SimpleMode.Appearance.js';
import { SetWallOpeningCommand } from './commands/SetWallOpeningCommand.js';
import { isWall, isHostedFixture, getOpenings, getOpeningOf, getWallParameters } from './SimpleMode.Openings.js';
import { validateOpening, validateWallChange } from './SimpleMode.OpeningValidation.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

// EV-007: parâmetros de porta/janela hospedada definidos pela parede (profundidade = espessura + 2 cm; peitoril = posição)
const HOSTED_LOCKED = [ 'frameDepth', 'leafThickness', 'depth', 'sill' ];

function SimpleModeComponentProperties( editor, context, dimensionSection, parameterSection ) {

	const units = context.units;

	let current = null; // { object, state } exibidos
	let builtFor = null; // id do componente para o qual os campos foram montados

	const dimensionBody = new UIDiv().setClass( 'SimpleComponentFields' );
	dimensionSection.body.add( dimensionBody );

	const scaleNotice = new UIDiv().setClass( 'SimpleNotice SimpleScaleNotice' );
	const scaleText = createText( '', '' );
	scaleNotice.add( scaleText );
	scaleNotice.add( createSimpleButton( {
		label: t( 'component/scale/apply' ), title: t( 'component/scale/apply/title' ), className: 'SimpleMeasureAction',
		onClick: applyScale
	} ) );
	dimensionSection.body.add( scaleNotice );

	const statusText = createText( '', 'SimpleSectionHint' );
	dimensionSection.body.add( statusText );

	const parameterBody = new UIDiv().setClass( 'SimpleComponentFields' );
	parameterSection.body.add( parameterBody );

	let fields = []; // { parameter, input, row }

	function isScaled( object ) {

		return object.scale.x !== 1 || object.scale.y !== 1 || object.scale.z !== 1;

	}

	// monta os campos de acordo com a definição (só quando o tipo de componente muda)

	function build( definition ) {

		dimensionBody.dom.textContent = '';
		parameterBody.dom.textContent = '';
		fields = [];

		for ( const parameter of definition.parameters ) {

			const target = parameter.dimension !== undefined ? dimensionBody : parameterBody;
			const row = new UIDiv().setClass( 'SimpleDimensionRow' );

			const label = createText( parameter.label, 'SimpleDimensionLabel' );
			row.add( label );

			let input;

			if ( parameter.type === 'color' ) {

				input = document.createElement( 'input' );
				input.type = 'color';
				input.className = 'SimpleColorInput';
				input.setAttribute( 'aria-label', parameter.label );
				input.addEventListener( 'input', () => commit( parameter, input.value ) );

				const wrapper = new UIDiv().setClass( 'SimpleColorRow' );
				wrapper.dom.appendChild( input );
				row.add( wrapper );

			} else {

				const field = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField' + ( parameter.dimension !== undefined ? ' axis-' + parameter.dimension : '' ) );

				if ( parameter.dimension !== undefined ) field.add( createText( parameter.dimension.toUpperCase(), 'SimpleAxisLabel' ) );

				input = new SimpleNumberInput( {
					kind: parameter.type === 'length' ? 'length' : 'factor',
					units,
					label: parameter.label,
					onCommit: ( value ) => commit( parameter, value ),
					onInvalid: () => context.notify( t( 'message/invalidNumber' ), 'warning' )
				} );
				field.add( input );

				if ( parameter.type === 'length' ) field.add( createText( '', 'SimpleUnitSuffix' ) );

				row.add( field );

			}

			if ( parameter.hint !== undefined ) row.dom.title = parameter.hint;

			target.add( row );
			fields.push( { parameter, input, row } );

		}

		builtFor = definition.id;

	}

	function describeRange( parameter ) {

		if ( parameter.type === 'length' ) return t( 'component/range', parameter.label, units.format( parameter.min ), units.format( parameter.max ) );

		return t( 'component/range', parameter.label, parameter.min, parameter.max );

	}

	function commit( parameter, value ) {

		if ( current === null || current.state.editable !== true ) return;

		const { object, state } = current;

		if ( parameter.dimension !== undefined && isScaled( object ) ) {

			context.notify( t( 'component/scale/blocked' ), 'warning' );
			refresh();
			return;

		}

		const parameters = Object.assign( {}, state.parameters, { [ parameter.key ]: value } );

		if ( parameters[ parameter.key ] === state.parameters[ parameter.key ] ) return;

		// EV-007: largura/altura de porta/janela hospedada mudam o vão inteiro (abertura + componente + parede)
		if ( isHostedFixture( object ) ) {

			if ( HOSTED_LOCKED.includes( parameter.key ) ) {

				context.notify( t( 'opening/lockedParameter' ), 'warning' );
				refresh();
				return;

			}

			const opening = getOpeningOf( object );

			if ( opening !== null && ( parameter.key === 'width' || parameter.key === 'height' ) ) {

				const candidate = Object.assign( {}, opening, { [ parameter.key ]: value } );
				const problem = validateOpening( getWallParameters( object.parent ), getOpenings( object.parent ), candidate, { ignoreId: opening.id } );

				if ( problem !== null ) {

					context.notify( t( 'opening/problem/' + problem.code ), 'warning' );
					refresh();
					return;

				}

				editor.execute( new SetWallOpeningCommand( editor, object.parent, opening.id, { [ parameter.key ]: value } ) );
				return;

			}

		}

		// EV-007: parede com aberturas não pode ficar menor que seus vãos (validado antes de alterar)
		if ( isWall( object ) && wallChangeBlocked( object, parameters ) ) {

			refresh();
			return;

		}

		const invalid = validateParameters( state.definition, parameters );

		if ( invalid !== null ) {

			const target = state.definition.parameters.find( ( item ) => item.key === invalid.key );
			context.notify( invalid.range === true && target !== undefined ? describeRange( target ) : invalid.message, 'warning' );
			refresh();
			return;

		}

		editor.execute( new SetComponentParametersCommand( editor, object, parameters ) );

	}

	// Incorpora a escala às medidas: parâmetros de dimensão passam a valer o tamanho efetivo
	// e a escala volta a 1 — uma única ação de Desfazer (MultiCmdsCommand)

	function applyScale() {

		if ( current === null || current.state.editable !== true ) return;

		const { object, state } = current;
		const parameters = Object.assign( {}, state.parameters );

		for ( const parameter of state.definition.parameters ) {

			if ( parameter.dimension === undefined ) continue;

			const factor = Math.abs( object.scale.getComponent( AXIS_INDEX[ parameter.dimension ] ) );
			parameters[ parameter.key ] = Number( ( parameters[ parameter.key ] * factor ).toPrecision( 15 ) );

		}

		const invalid = validateParameters( state.definition, parameters );

		if ( invalid !== null ) {

			const target = state.definition.parameters.find( ( item ) => item.key === invalid.key );
			context.notify( t( 'component/scale/invalid' ) + ' ' + ( invalid.range === true && target !== undefined ? describeRange( target ) : invalid.message ), 'warning' );
			return;

		}

		if ( isWall( object ) && wallChangeBlocked( object, parameters ) ) return;

		const command = new MultiCmdsCommand( editor, [
			new SetComponentParametersCommand( editor, object, parameters ),
			new SetScaleCommand( editor, object, object.scale.clone().set( 1, 1, 1 ) )
		] );
		command.name = t( 'component/scale/apply' );
		editor.execute( command );

		context.notify( t( 'message/component/scaleApplied' ), 'success' );

	}

	function wallChangeBlocked( wall, parameters ) {

		const openings = getOpenings( wall );
		if ( openings.length === 0 ) return false;

		const problem = validateWallChange( parameters, openings );
		if ( problem === null ) return false;

		context.notify( t( 'opening/wallBlocked', t( 'opening/problem/' + problem.code ) ), 'warning' );
		return true;

	}

	// atualiza os valores exibidos

	function refresh() {

		if ( current === null ) return;

		const { object, state } = current;
		const scaled = isScaled( object );
		const unit = units.getUnit();
		const hosted = isHostedFixture( object );

		for ( const { parameter, input, row } of fields ) {

			const value = state.parameters[ parameter.key ];

			if ( parameter.type === 'color' ) {

				// EV-004: um acabamento aplicado à parte tem prioridade sobre a cor do parâmetro
				const override = parameter.material !== undefined && getPartMeta( object, parameter.material ) !== null;

				input.value = value;
				input.disabled = state.editable !== true || override;
				row.dom.classList.toggle( 'disabled', override );
				row.dom.title = override ? t( 'component/color/override' ) : ( parameter.hint || '' );
				continue;

			}

			// medida física efetiva = parâmetro × |escala| no eixo correspondente
			const factor = parameter.dimension !== undefined ? Math.abs( object.scale.getComponent( AXIS_INDEX[ parameter.dimension ] ) ) : 1;

			input.setValue( value * factor );
			const locked = hosted && HOSTED_LOCKED.includes( parameter.key );
			input.setDisabled( state.editable !== true || ( parameter.dimension !== undefined && scaled ) || locked );
			row.dom.classList.toggle( 'disabled', locked );
			row.dom.title = locked ? t( 'opening/lockedParameter' ) : ( parameter.hint || '' );

			const suffix = row.dom.querySelector( '.SimpleUnitSuffix' );
			if ( suffix !== null ) suffix.textContent = unit.label;

		}

		scaleNotice.dom.hidden = ! ( scaled && state.editable === true );

		if ( scaled ) {

			const factors = [ object.scale.x, object.scale.y, object.scale.z ].map( ( value ) => Number( Math.abs( value ).toFixed( 3 ) ).toLocaleString( 'pt-BR' ) );
			scaleText.setTextContent( t( 'component/scale/notice', factors.join( ' × ' ) ) );

		}

		statusText.dom.hidden = state.editable === true;
		if ( state.editable !== true ) statusText.setTextContent( t( 'component/readonly/' + state.reason ) );

	}

	// retorna true quando o objeto é um componente paramétrico (seções exibidas)

	function update( object ) {

		const state = object !== null ? getComponentState( object ) : null;

		if ( state === null || state.definition === null || state.parameters === null ) {

			current = state !== null ? { object, state } : null;

			dimensionSection.details.hidden = true;
			parameterSection.details.hidden = true;

			return false;

		}

		if ( builtFor !== state.definition.id ) build( state.definition );

		current = { object, state };

		dimensionSection.details.hidden = false;
		parameterSection.details.hidden = fields.every( ( field ) => field.parameter.dimension !== undefined );

		refresh();

		return true;

	}

	units.changed.add( refresh );

	editor.signals.materialChanged.add( ( object ) => {

		if ( current !== null && object === current.object ) refresh();

	} );

	return { update, getState: () => ( current !== null ? current.state : null ) };

}

export { SimpleModeComponentProperties };
