// EV-007 — Ferramentas Arquitetônicas Inteligentes
//
// Ferramentas do controlador único (SimpleMode.Interaction):
//   'door'       — Inserir porta
//   'window'     — Inserir janela
//   'reposition' — Reposicionar uma abertura existente ao longo da sua parede
//
// O ponto do cursor é convertido para o espaço LOCAL da parede (matriz mundial inversa): a posição ao
// longo do eixo X local vale para paredes giradas, sem usar caixas alinhadas ao mundo.
// A prévia é leve (contorno + silhueta translúcida em editor.sceneHelpers, sem raycasting); a geometria
// real da parede só é reconstruída ao confirmar, pelos comandos de abertura.

import * as THREE from 'three';

import { UIDiv } from './libs/ui.js';

import { AddWallOpeningCommand } from './commands/AddWallOpeningCommand.js';
import { SetWallOpeningCommand } from './commands/SetWallOpeningCommand.js';

import { getDefinition } from './SimpleMode.Components.js';
import { getMeta } from './SimpleMode.ComponentFactory.js';
import { isWall, getWallParameters, getOpenings, checkWallCompatibility, newOpeningId, findFixture } from './SimpleMode.Openings.js';
import { validateOpening, distancesToEnds } from './SimpleMode.OpeningValidation.js';
import { getUniqueName } from './SimpleMode.Library.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';

const COLORS = { valid: 0x0a84ff, invalid: 0xe5484d };
const CENTER_TOLERANCE_PX = 12;

function OpeningTools( editor, context, interaction ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const units = context.units;

	const settings = {
		door: { width: 0.9, height: 2.1 },
		window: { width: 1.2, height: 1, sill: 1 }
	};

	const state = { tool: null, type: null, wall: null, candidate: null, valid: false, problem: null, distances: null, snap: '', label: '', openingId: null };

	// prévia ------------------------------------------------------------------------------------------------

	const preview = new THREE.Group();
	preview.name = 'Prévia de abertura (temporária)';
	preview.matrixAutoUpdate = false; // segue a matriz mundial da parede

	const material = new THREE.MeshBasicMaterial( { color: COLORS.valid, transparent: true, opacity: 0.3, depthWrite: false } );
	const silhouette = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), material );
	silhouette.renderOrder = 998;
	silhouette.raycast = () => {};

	const outline = new THREE.LineSegments( new THREE.EdgesGeometry( new THREE.BoxGeometry( 1, 1, 1 ) ), new THREE.LineBasicMaterial( { color: COLORS.valid, depthTest: false, transparent: true } ) );
	outline.renderOrder = 999;
	outline.raycast = () => {};

	preview.add( silhouette, outline );

	const label = document.createElement( 'div' );
	label.className = 'SimpleMeasureLabel SimpleConstructionLabel';
	label.hidden = true;
	let labelAnchor = null;

	function hidePreview() {

		if ( preview.parent !== null ) preview.parent.remove( preview );
		label.hidden = true;
		labelAnchor = null;
		editor.signals.sceneHelpersChanged.dispatch();

	}

	function updateLabel() {

		if ( labelAnchor === null ) {

			label.hidden = true;
			return;

		}

		const projected = labelAnchor.clone().project( editor.viewportCamera );
		label.hidden = projected.z < - 1 || projected.z > 1;
		const screen = interaction.toScreen( labelAnchor );
		label.style.left = screen.x + 'px';
		label.style.top = screen.y + 'px';

	}

	editor.signals.sceneRendered.add( () => {

		if ( state.tool !== null ) updateLabel();

	} );

	units.changed.add( () => {

		if ( state.tool !== null ) interaction.refresh();

	} );

	// paredes sob o cursor --------------------------------------------------------------------------------

	const raycaster = new THREE.Raycaster();
	const _plane = new THREE.Plane();
	const _normal = new THREE.Vector3();
	const _origin = new THREE.Vector3();

	function wallMeshes() {

		const meshes = [];

		editor.scene.traverseVisible( ( object ) => {

			const meta = getMeta( object );
			if ( object.isMesh === true && meta !== null && meta.part === 'parede' && isWall( object.parent ) ) meshes.push( object );

		} );

		return meshes;

	}

	function pickWall( info ) {

		raycaster.ray.copy( info.ray );
		const hit = raycaster.intersectObjects( wallMeshes(), false )[ 0 ];
		return hit !== undefined ? { wall: hit.object.parent, point: hit.point } : null;

	}

	// ponto do raio sobre o plano central da parede (para reposicionar mesmo com o cursor sobre a porta/janela)
	function onWallPlane( info, wall ) {

		wall.updateWorldMatrix( true, false );
		_normal.set( 0, 0, 1 ).transformDirection( wall.matrixWorld );
		_origin.setFromMatrixPosition( wall.matrixWorld );
		_plane.setFromNormalAndCoplanarPoint( _normal, _origin );
		return info.ray.intersectPlane( _plane, new THREE.Vector3() );

	}

	function buildCandidate( type, wall, worldPoint ) {

		const wallParams = getWallParameters( wall );
		const local = wall.worldToLocal( worldPoint.clone() );
		const size = state.tool === 'reposition' ? null : settings[ type ];

		let candidate;

		if ( state.tool === 'reposition' ) {

			const current = getOpenings( wall ).find( ( opening ) => opening.id === state.openingId );
			candidate = Object.assign( {}, current, { centerX: local.x } );

		} else {

			candidate = { type, width: size.width, height: size.height, bottomY: type === 'door' ? 0 : size.sill, centerX: local.x };

		}

		// encaixe: distância da extremidade esquerda até o vão em passos da precisão da EV-002
		const grid = context.precision.getSnap();
		let snap = t( 'construction/snap/free' );

		if ( grid !== null ) {

			const left = candidate.centerX - candidate.width / 2 + wallParams.width / 2;
			candidate.centerX = Math.round( left / grid ) * grid - wallParams.width / 2 + candidate.width / 2;
			snap = t( 'construction/snap/grid' );

		}

		// centralização: perto do centro da parede (em pixels), o vão fica exatamente no meio
		const mid = candidate.bottomY + candidate.height / 2;
		const center = interaction.toScreen( new THREE.Vector3( 0, mid, 0 ).applyMatrix4( wall.matrixWorld ) );
		const here = interaction.toScreen( new THREE.Vector3( local.x, mid, 0 ).applyMatrix4( wall.matrixWorld ) );

		if ( center.distanceTo( here ) <= CENTER_TOLERANCE_PX ) {

			candidate.centerX = 0;
			snap = t( 'opening/snap/center' );

		}

		candidate.centerX = Math.round( candidate.centerX * 1e6 ) / 1e6 + 0;

		return { candidate, wallParams, snap };

	}

	function update( info ) {

		let target = null;

		if ( state.tool === 'reposition' ) {

			const point = onWallPlane( info, state.wall );
			if ( point !== null ) target = { wall: state.wall, point };

		} else {

			target = pickWall( info );

		}

		if ( target === null ) {

			state.wall = state.tool === 'reposition' ? state.wall : null;
			state.candidate = null;
			state.valid = false;
			state.problem = state.tool === 'reposition' ? null : 'noWall';
			hidePreview();
			changed.dispatch();
			return;

		}

		const wall = target.wall;
		const compatibility = checkWallCompatibility( wall );
		const { candidate, wallParams, snap } = buildCandidate( state.type, wall, target.point );

		const problem = compatibility !== null ? { code: compatibility } : validateOpening( wallParams, getOpenings( wall ), candidate, { ignoreId: state.openingId } );

		state.wall = wall;
		state.candidate = candidate;
		state.valid = problem === null;
		state.problem = problem !== null ? problem.code : null;
		state.distances = distancesToEnds( wallParams.width, candidate );
		state.snap = snap;

		// prévia no espaço da parede
		if ( preview.parent === null ) editor.sceneHelpers.add( preview );

		wall.updateWorldMatrix( true, false );
		preview.matrix.copy( wall.matrixWorld );
		preview.matrixWorldNeedsUpdate = true;

		for ( const object of [ silhouette, outline ] ) {

			object.position.set( candidate.centerX, candidate.bottomY + candidate.height / 2, 0 );
			object.scale.set( candidate.width, candidate.height, wallParams.thickness + 0.04 );
			object.updateMatrix();

		}

		material.color.setHex( state.valid ? COLORS.valid : COLORS.invalid );
		outline.material.color.setHex( state.valid ? COLORS.valid : COLORS.invalid );

		labelAnchor = new THREE.Vector3( candidate.centerX, candidate.bottomY + candidate.height, 0 ).applyMatrix4( wall.matrixWorld );
		label.textContent = t( 'opening/label', units.format( Math.max( 0, state.distances.left ) ), units.format( candidate.width ), units.format( candidate.height ), units.format( Math.max( 0, state.distances.right ) ) );
		updateLabel();

		editor.signals.sceneHelpersChanged.dispatch();
		changed.dispatch();

	}

	function confirm() {

		if ( state.valid === false || state.candidate === null ) {

			context.notify( state.problem !== null ? t( 'opening/problem/' + state.problem ) : t( 'opening/problem/noWall' ), 'warning' );
			return;

		}

		const wall = state.wall;

		if ( state.tool === 'reposition' ) {

			editor.execute( new SetWallOpeningCommand( editor, wall, state.openingId, { centerX: state.candidate.centerX } ) );
			const opening = getOpenings( wall ).find( ( item ) => item.id === state.openingId );
			const fixture = findFixture( wall, opening );
			interaction.deactivate();
			if ( fixture !== null ) editor.select( fixture );
			context.notify( t( 'opening/repositioned' ), 'success' );
			return;

		}

		const opening = Object.assign( {}, state.candidate, { id: newOpeningId(), fixtureUuid: THREE.MathUtils.generateUUID() } );
		const name = getUniqueName( editor, getDefinition( state.type ).name );

		editor.execute( new AddWallOpeningCommand( editor, wall, opening, name ) );

		const fixture = findFixture( wall, opening );
		if ( fixture !== null ) editor.select( fixture );

		context.notify( t( 'opening/created/' + state.type, name ), 'success' );
		interaction.refresh(); // a ferramenta continua ativa para inserir outra abertura

	}

	function makeTool( id ) {

		return {

			activate( options = {} ) {

				state.tool = id;
				state.type = id === 'reposition' ? options.type : id;
				state.openingId = id === 'reposition' ? options.openingId : null;
				state.wall = id === 'reposition' ? options.wall : null;
				state.label = options.name || '';
				state.candidate = null;
				state.valid = false;
				state.problem = null;
				changed.dispatch();

			},

			deactivate() {

				state.tool = null;
				state.wall = null;
				state.candidate = null;
				hidePreview();
				changed.dispatch();

			},

			onMove: update,
			onClick( info ) {

				update( info );
				confirm();

			}

		};

	}

	interaction.register( 'door', makeTool( 'door' ) );
	interaction.register( 'window', makeTool( 'window' ) );
	interaction.register( 'reposition', makeTool( 'reposition' ) );

	// a parede (ou a abertura em reposicionamento) saiu da cena: encerra a ferramenta
	editor.signals.objectRemoved.add( ( object ) => {

		if ( state.tool === 'reposition' && ( object === state.wall || state.wall === null || state.wall.parent === null ) ) interaction.deactivate();

	} );

	function setSetting( type, key, value ) {

		settings[ type ][ key ] = value;
		interaction.refresh();
		changed.dispatch();

	}

	return { changed, state, settings, label, setSetting };

}

// painel compacto da ferramenta (mesmo visual do painel de construção da EV-006) ---------------------------

const FIELD_LIMITS = {
	door: { width: [ 'door', 'width' ], height: [ 'door', 'height' ] },
	window: { width: [ 'window', 'width' ], height: [ 'window', 'height' ], sill: [ 'window', 'sill' ] }
};

function SimpleModeOpeningPanel( editor, context, container ) {

	const openings = context.openings;
	const interaction = context.interaction;
	const units = context.units;

	const panel = new UIDiv().setClass( 'SimpleMeasureStatus SimpleConstructionPanel SimpleOpeningPanel' );
	panel.dom.setAttribute( 'role', 'group' );
	panel.dom.hidden = true;
	container.add( panel );
	container.dom.appendChild( openings.label );

	const title = createText( '', 'SimpleConstructionTitle' );
	panel.add( title );

	const fields = new UIDiv().setClass( 'SimpleConstructionFields' );
	panel.add( fields );

	const inputs = [];

	for ( const type of [ 'door', 'window' ] ) {

		for ( const key of Object.keys( FIELD_LIMITS[ type ] ) ) {

			const [ component, parameterKey ] = FIELD_LIMITS[ type ][ key ];
			const parameter = getDefinition( component ).parameters.find( ( item ) => item.key === parameterKey );
			const min = key === 'sill' ? 0.1 : parameter.min;
			const max = parameter.max;
			const text = t( 'opening/field/' + key );

			const wrapper = document.createElement( 'label' );
			wrapper.className = 'SimpleConstructionField';
			wrapper.appendChild( Object.assign( document.createElement( 'span' ), { textContent: text } ) );

			const field = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField' );
			const input = new SimpleNumberInput( {
				kind: 'length', units, label: text, min,
				onCommit: ( value ) => {

					if ( value > max ) {

						context.notify( t( 'component/range', text, units.format( min ), units.format( max ) ), 'warning' );
						input.value = openings.settings[ type ][ key ];
						input.render( true );
						return;

					}

					openings.setSetting( type, key, value );

				},
				onInvalid: () => context.notify( t( 'component/range', text, units.format( min ), units.format( max ) ), 'warning' )
			} );

			const suffix = createText( '', 'SimpleUnitSuffix' );
			field.add( input, suffix );
			wrapper.appendChild( field.dom );
			fields.dom.appendChild( wrapper );
			inputs.push( { type, key, wrapper, input, suffix } );

		}

	}

	const readout = createText( '', 'SimpleConstructionReadout' );
	panel.add( readout );

	const hint = createText( '', 'SimpleSectionHint SimpleConstructionHint' );
	panel.add( hint );

	const actions = new UIDiv().setClass( 'SimpleConstructionActions' );
	actions.add( createSimpleButton( { icon: 'close', title: t( 'construction/exit' ), className: 'SimpleIconButton', onClick: () => interaction.deactivate() } ) );
	panel.add( actions );

	function refresh() {

		const state = openings.state;
		panel.dom.hidden = state.tool === null;
		if ( state.tool === null ) return;

		const repositioning = state.tool === 'reposition';
		title.setTextContent( repositioning ? t( 'opening/title/reposition', state.label ) : t( 'opening/title/' + state.tool ) );

		for ( const item of inputs ) {

			item.wrapper.hidden = repositioning || item.type !== state.tool;
			item.input.setValue( openings.settings[ item.type ][ item.key ] );
			item.suffix.setTextContent( units.getUnit().label );

		}

		fields.dom.hidden = repositioning;

		if ( state.candidate !== null ) {

			readout.setTextContent( state.valid ?
				t( 'opening/readout', units.format( Math.max( 0, state.distances.left ) ), units.format( Math.max( 0, state.distances.right ) ), state.snap ) :
				t( 'opening/problem/' + state.problem ) );

		} else {

			readout.setTextContent( state.problem === 'noWall' ? t( 'opening/problem/noWall' ) : '' );

		}

		readout.dom.classList.toggle( 'invalid', state.candidate !== null && state.valid === false );
		hint.setTextContent( t( repositioning ? 'opening/hint/reposition' : 'opening/hint/insert' ) );

	}

	openings.changed.add( refresh );
	interaction.changed.add( refresh );
	units.changed.add( refresh );
	refresh();

	return panel;

}

export { OpeningTools, SimpleModeOpeningPanel };
