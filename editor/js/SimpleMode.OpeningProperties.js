// EV-007 — Ferramentas Arquitetônicas Inteligentes
//
// Seção "Abertura na parede" do painel direito:
//   - porta/janela hospedada: tipo, parede, largura, altura, posição, peitoril e ações;
//   - parede com aberturas: resumo e avisos (vãos sem componente, componentes fora do lugar).
// Toda alteração passa pela validação e por SetWallOpeningCommand / RemoveWallOpeningCommand.

import * as THREE from 'three';

import { UIDiv } from './libs/ui.js';

import { SetWallOpeningCommand } from './commands/SetWallOpeningCommand.js';
import { RemoveWallOpeningCommand } from './commands/RemoveWallOpeningCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';

import { OPENING_TYPES, isWall, isHostedFixture, getOpenings, getOpeningOf, getWallParameters, getOrphanOpenings, findFixture, isFixtureMisplaced } from './SimpleMode.Openings.js';
import { validateOpening, distancesToEnds } from './SimpleMode.OpeningValidation.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';

function SimpleModeOpeningProperties( editor, context, section ) {

	const units = context.units;
	let current = null; // porta/janela ou parede exibida

	const body = section.body;

	// porta/janela hospedada --------------------------------------------------------------------------------

	const hostedBox = new UIDiv().setClass( 'SimpleOpeningHosted' );
	body.add( hostedBox );

	const typeText = createText( '', 'SimpleObjectType' );
	hostedBox.add( typeText );

	const wallButton = createSimpleButton( { icon: 'wall', label: '', title: t( 'opening/selectWall/title' ), className: 'SimpleLinkButton SimpleOpeningWall', onClick: () => {

		if ( current !== null && isHostedFixture( current ) ) editor.select( current.parent );

	} } );
	hostedBox.add( wallButton );

	const grid = new UIDiv().setClass( 'SimpleComponentFields' );
	hostedBox.add( grid );

	function field( key, options = {} ) {

		const row = new UIDiv().setClass( 'SimpleDimensionRow' );
		row.add( createText( t( 'opening/field/' + key ), 'SimpleDimensionLabel' ) );

		const wrapper = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField' );
		const input = new SimpleNumberInput( {
			kind: 'length', units, label: t( 'opening/field/' + key ), min: options.min !== undefined ? options.min : 0, exclusiveMin: options.exclusiveMin === true,
			onCommit: ( value ) => commit( { [ options.target || key ]: value } ),
			onInvalid: () => context.notify( t( 'message/invalidNumber' ), 'warning' )
		} );

		const suffix = createText( '', 'SimpleUnitSuffix' );
		wrapper.add( input, suffix );
		row.add( wrapper );
		grid.add( row );

		return { row, input, suffix };

	}

	const width = field( 'width', { exclusiveMin: true } );
	const height = field( 'height', { exclusiveMin: true } );
	const offset = field( 'centerX', { min: - Infinity, target: 'centerX' } );
	const sill = field( 'sill', { target: 'bottomY' } );
	const fields = [ width, height, offset, sill ];

	const distances = createText( '', 'SimpleSectionHint' );
	hostedBox.add( distances );

	const actions = new UIDiv().setClass( 'SimpleActions SimpleOpeningActions' );
	hostedBox.add( actions );

	actions.add( createSimpleButton( { icon: 'translate', label: t( 'opening/action/reposition' ), title: t( 'opening/action/reposition/title' ), onClick: () => {

		const opening = current !== null ? getOpeningOf( current ) : null;
		if ( opening !== null ) context.startTool( 'reposition', { wall: current.parent, openingId: opening.id, type: opening.type, name: current.name } );

	} } ) );

	actions.add( createSimpleButton( { label: t( 'opening/action/defaults' ), title: t( 'opening/action/defaults/title' ), onClick: () => {

		const opening = current !== null ? getOpeningOf( current ) : null;
		if ( opening === null ) return;

		const defaults = OPENING_TYPES[ opening.type ].defaults;
		commit( { width: defaults.width, height: defaults.height, bottomY: defaults.bottomY } );

	} } ) );

	actions.add( createSimpleButton( { icon: 'delete', label: t( 'opening/action/remove' ), title: t( 'opening/action/remove/title' ), className: 'danger', onClick: () => removeHosted() } ) );

	// aviso: componente fora do lugar (ex.: movido no Modo Avançado)
	const misplaced = new UIDiv().setClass( 'SimpleNotice SimpleScaleNotice' );
	misplaced.add( createText( t( 'opening/misplaced' ), '' ) );

	const misplacedActions = new UIDiv().setClass( 'SimpleConstructionActions' );
	misplacedActions.add( createSimpleButton( { label: t( 'opening/misplaced/restore' ), className: 'SimpleMeasureAction', onClick: restorePlacement } ) );
	misplacedActions.add( createSimpleButton( { label: t( 'opening/misplaced/unlink' ), className: 'SimpleMeasureAction', onClick: () => {

		const opening = getOpeningOf( current );
		if ( opening !== null ) editor.execute( new RemoveWallOpeningCommand( editor, current.parent, opening.id, { unlink: true } ) );
		context.notify( t( 'opening/unlinked' ), 'success' );

	} } ) );
	misplaced.add( misplacedActions );
	hostedBox.add( misplaced );

	// parede com aberturas -------------------------------------------------------------------------------

	const wallBox = new UIDiv().setClass( 'SimpleOpeningWallSummary' );
	body.add( wallBox );

	const summary = createText( '', 'SimpleObjectType' );
	wallBox.add( summary );

	const orphanNotice = new UIDiv().setClass( 'SimpleNotice SimpleScaleNotice' );
	orphanNotice.add( createText( t( 'opening/orphans' ), '' ) );
	orphanNotice.add( createSimpleButton( { label: t( 'opening/orphans/close' ), className: 'SimpleMeasureAction', onClick: () => {

		const orphans = getOrphanOpenings( current );
		if ( orphans.length === 0 ) return;

		const commands = orphans.map( ( opening ) => new RemoveWallOpeningCommand( editor, current, opening.id ) );
		const command = commands.length === 1 ? commands[ 0 ] : new MultiCmdsCommand( editor, commands );
		editor.execute( command );

	} } ) );
	wallBox.add( orphanNotice );

	// ações -------------------------------------------------------------------------------------------------

	function commit( changes ) {

		if ( current === null || isHostedFixture( current ) === false ) return;

		const wall = current.parent;
		const opening = getOpeningOf( current );
		const candidate = Object.assign( {}, opening, changes );

		if ( opening.type === 'door' ) candidate.bottomY = 0;

		const problem = validateOpening( getWallParameters( wall ), getOpenings( wall ), candidate, { ignoreId: opening.id } );

		if ( problem !== null ) {

			context.notify( t( 'opening/problem/' + problem.code ), 'warning' );
			refresh();
			return;

		}

		const delta = {};
		for ( const key of Object.keys( changes ) ) if ( candidate[ key ] !== opening[ key ] ) delta[ key ] = candidate[ key ];
		if ( Object.keys( delta ).length === 0 ) return;

		editor.execute( new SetWallOpeningCommand( editor, wall, opening.id, delta ) );

	}

	function removeHosted() {

		if ( current === null || isHostedFixture( current ) === false ) return;

		const wall = current.parent;
		const opening = getOpeningOf( current );

		editor.execute( new RemoveWallOpeningCommand( editor, wall, opening.id ) );
		editor.select( wall );
		context.notify( t( 'opening/removed' ), 'success' );

	}

	function restorePlacement() {

		const opening = getOpeningOf( current );
		if ( opening === null ) return;

		const fixture = current;
		const command = new MultiCmdsCommand( editor, [
			new SetPositionCommand( editor, fixture, new THREE.Vector3( opening.centerX, opening.bottomY, 0 ) ),
			new SetRotationCommand( editor, fixture, new THREE.Euler( 0, 0, 0 ) ),
			new SetScaleCommand( editor, fixture, new THREE.Vector3( 1, 1, 1 ) )
		] );
		command.name = t( 'opening/misplaced/restore' );
		editor.execute( command );

	}

	// interface -----------------------------------------------------------------------------------------------

	function refresh() {

		if ( current === null ) return;

		const unit = units.getUnit().label;
		for ( const item of fields ) item.suffix.setTextContent( unit );

		if ( isHostedFixture( current ) ) {

			const opening = getOpeningOf( current );
			const wall = current.parent;
			const wallParams = getWallParameters( wall );

			hostedBox.dom.hidden = false;
			wallBox.dom.hidden = true;

			typeText.setTextContent( t( 'opening/type/' + opening.type ) );
			wallButton.dom.querySelector( '.SimpleButtonLabel' ).textContent = t( 'opening/selectWall', wall.name );

			width.input.setValue( opening.width );
			height.input.setValue( opening.height );
			offset.input.setValue( opening.centerX );
			sill.input.setValue( opening.bottomY );
			sill.row.dom.hidden = opening.type !== 'window';

			const d = distancesToEnds( wallParams.width, opening );
			distances.setTextContent( t( 'opening/distances', units.format( d.left ), units.format( d.right ) ) );

			misplaced.dom.hidden = isFixtureMisplaced( current ) === false;

		} else {

			const openings = getOpenings( current );
			const doors = openings.filter( ( opening ) => opening.type === 'door' ).length;
			const windows = openings.length - doors;

			hostedBox.dom.hidden = true;
			wallBox.dom.hidden = false;
			summary.setTextContent( t( 'opening/wallSummary', doors, windows ) );
			orphanNotice.dom.hidden = getOrphanOpenings( current ).length === 0;

		}

	}

	// retorna true quando a seção deve aparecer
	function update( object ) {

		current = null;

		if ( object !== null && isHostedFixture( object ) ) current = object;
		else if ( object !== null && isWall( object ) && getOpenings( object ).length > 0 ) current = object;

		if ( current === null ) return false;

		refresh();
		return true;

	}

	units.changed.add( refresh );

	return { update, removeHosted, findFixture };

}

export { SimpleModeOpeningProperties };
