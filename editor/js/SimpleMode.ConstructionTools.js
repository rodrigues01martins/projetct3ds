// EV-006 — Ferramentas de Construção e Montagem 3D
//
// Ferramentas registradas no controlador único (SimpleMode.Interaction):
//   'wall'  — Desenhar parede (dois cliques, modo contínuo A → B → C)
//   'floor' — Criar piso (dois cantos)
//   'place' — Posicionar componente sobre superfície horizontal
//   'rest'  — Apoiar objeto existente em superfície
//
// Regras gerais:
//   - prévias ficam em editor.sceneHelpers (desenhadas pelo viewport, nunca salvas) e reutilizam geometrias;
//   - nenhuma atualização de prévia passa pelo histórico; só a confirmação gera comando
//     (AddObjectCommand para criar, SetPositionCommand para apoiar);
//   - paredes e pisos são os componentes paramétricos 'wall' e 'floor' da EV-003 (mesma fábrica da biblioteca).

import * as THREE from 'three';

import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';

import { getDefinition } from './SimpleMode.Components.js';
import { createComponent } from './SimpleMode.ComponentFactory.js';
import { getUniqueName } from './SimpleMode.Library.js';
import { snapPoint, getConstructionPlane, intersectHorizontal, getSupportSurface, descendantsOf } from './SimpleMode.Snapping.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';

const COLORS = { valid: 0x0a84ff, invalid: 0xe5484d, marker: 0xff9f0a };

function limitsOf( componentId, key ) {

	const parameter = getDefinition( componentId ).parameters.find( ( item ) => item.key === key );
	return { min: parameter.min, max: parameter.max };

}

// Ângulo de rotação em Y que alinha o eixo X local à direção (dx, dz).
// Em Three.js, girar +θ em torno de Y leva (1, 0, 0) para (cos θ, 0, −sin θ); logo θ = atan2(−dz, dx).
function angleForDirection( dx, dz ) {

	return Math.atan2( - dz, dx );

}

function ConstructionTools( editor, context, interaction ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const scene = editor.scene;
	const units = context.units;

	const settings = {
		wallHeight: 2.7,
		wallThickness: 0.15,
		floorThickness: 0.1,
		ortho: false
	};

	// estado exibido no painel da ferramenta
	const state = { tool: null, phase: 'idle', length: null, width: null, depth: null, snap: null, axis: null, valid: true, label: '', position: null, rotation: 0, target: null };

	// prévias (reutilizadas) -----------------------------------------------------------------------------------

	const previewRoot = new THREE.Group();
	previewRoot.name = 'Prévia de construção (temporária)';

	const previewMaterial = new THREE.MeshBasicMaterial( { color: COLORS.valid, transparent: true, opacity: 0.35, depthWrite: false } );
	const box = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), previewMaterial );
	box.renderOrder = 998;
	previewRoot.add( box );

	const outline = new THREE.LineSegments( new THREE.EdgesGeometry( new THREE.BoxGeometry( 1, 1, 1 ) ), new THREE.LineBasicMaterial( { color: COLORS.valid, depthTest: false, transparent: true } ) );
	outline.renderOrder = 999;
	previewRoot.add( outline );

	const markerGeometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3(), new THREE.Vector3() ] );
	const markers = new THREE.Points( markerGeometry, new THREE.PointsMaterial( { color: COLORS.marker, size: 10, sizeAttenuation: false, depthTest: false, transparent: true } ) );
	markers.renderOrder = 1000;
	markers.frustumCulled = false;
	previewRoot.add( markers );

	const axisLine = new THREE.Line( new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3(), new THREE.Vector3() ] ), new THREE.LineDashedMaterial( { color: COLORS.marker, dashSize: 0.15, gapSize: 0.1, depthTest: false, transparent: true } ) );
	axisLine.renderOrder = 1000;
	axisLine.frustumCulled = false;
	previewRoot.add( axisLine );

	let objectPreview = null; // prévia translúcida de um componente (posicionar)

	// rótulo HTML (medida em tempo real), reposicionado a cada render — acompanha a câmera
	const label = document.createElement( 'div' );
	label.className = 'SimpleMeasureLabel SimpleConstructionLabel';
	label.hidden = true;
	let labelAnchor = null;

	function showPreview() {

		if ( previewRoot.parent === null ) editor.sceneHelpers.add( previewRoot );

	}

	function hidePreview() {

		if ( previewRoot.parent !== null ) previewRoot.parent.remove( previewRoot );

		box.visible = outline.visible = markers.visible = axisLine.visible = false;
		label.hidden = true;
		labelAnchor = null;

		if ( objectPreview !== null ) {

			previewRoot.remove( objectPreview );
			objectPreview.traverse( ( child ) => {

				if ( child.isMesh ) child.geometry.dispose();

			} );
			objectPreview = null;

		}

		editor.signals.sceneHelpersChanged.dispatch();

	}

	function setValid( valid ) {

		state.valid = valid;
		previewMaterial.color.setHex( valid ? COLORS.valid : COLORS.invalid );
		outline.material.color.setHex( valid ? COLORS.valid : COLORS.invalid );

	}

	function setMarkers( points ) {

		markerGeometry.setFromPoints( points.length > 0 ? points : [ new THREE.Vector3() ] );
		markers.visible = points.length > 0;

	}

	function setLabel( text, anchor ) {

		label.textContent = text;
		labelAnchor = anchor;
		updateLabel();

	}

	function updateLabel() {

		if ( labelAnchor === null || state.tool === null ) {

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

		if ( state.tool !== null ) {

			interaction.refresh();
			changed.dispatch();

		}

	} );

	function render() {

		editor.signals.sceneHelpersChanged.dispatch();
		changed.dispatch();

	}

	function snapOptions( info, anchor, ortho, exclude ) {

		return {
			scene,
			anchor,
			ortho,
			grid: context.precision.getSnap(),
			toScreen: interaction.toScreen,
			cursor: info.screen,
			exclude
		};

	}

	function snapLegend( snap ) {

		if ( snap === null ) return '';
		return t( 'construction/snap/' + snap.kind ) + ( snap.axis !== null ? ' · ' + t( 'construction/axis/' + snap.axis ) : '' );

	}

	function insert( object, message ) {

		object.name = getUniqueName( editor, object.name );
		editor.execute( new AddObjectCommand( editor, object ) );
		context.notify( message, 'success' );

	}

	// ===================================================================== PAREDE

	const wall = { start: null, planeY: 0, last: null, end: null };

	function wallMove( info ) {

		const plane = wall.start === null ? getConstructionPlane( info, scene ) : { y: wall.planeY, point: intersectHorizontal( info, wall.planeY ) };

		if ( plane === null || plane.point === null ) return;

		const ortho = settings.ortho || info.shiftKey;
		const snap = snapPoint( plane.point, plane.y, snapOptions( info, wall.start, ortho && wall.start !== null ) );

		// começar numa extremidade existente: a nova parede usa a mesma altura de base (ex.: parede sobre um piso)
		if ( wall.start === null && snap.endpoint !== null ) snap.point.y = snap.endpoint.y;

		wall.end = snap.point;
		state.snap = snapLegend( snap );
		state.axis = snap.axis;

		showPreview();

		if ( wall.start === null ) {

			// antes do primeiro clique: só o cursor encaixado
			box.visible = outline.visible = axisLine.visible = false;
			setMarkers( [ snap.point ] );
			state.length = null;
			state.phase = 'start';
			setLabel( state.snap, snap.point.clone().setY( plane.y + 0.05 ) );
			render();
			return;

		}

		const dx = snap.point.x - wall.start.x;
		const dz = snap.point.z - wall.start.z;
		const length = Math.hypot( dx, dz );
		const limits = limitsOf( 'wall', 'width' );

		state.length = length;
		state.phase = 'end';
		setValid( length >= limits.min && length <= limits.max );

		const height = settings.wallHeight;
		const thickness = settings.wallThickness;

		box.visible = outline.visible = length > 1e-6;
		box.position.set( ( wall.start.x + snap.point.x ) / 2, wall.planeY + height / 2, ( wall.start.z + snap.point.z ) / 2 );
		box.rotation.set( 0, angleForDirection( dx, dz ), 0 );
		box.scale.set( Math.max( length, 1e-4 ), height, thickness );
		outline.position.copy( box.position );
		outline.rotation.copy( box.rotation );
		outline.scale.copy( box.scale );

		setMarkers( [ wall.start, snap.point ] );

		// eixo ortogonal ativo: linha tracejada ao longo do eixo travado
		axisLine.visible = snap.axis !== null;

		if ( snap.axis !== null ) {

			const far = 50;
			const a = wall.start.clone(), b = wall.start.clone();
			a[ snap.axis ] -= far;
			b[ snap.axis ] += far;
			axisLine.geometry.setFromPoints( [ a, b ] );
			axisLine.computeLineDistances();

		}

		setLabel( units.format( length ) + ( state.snap !== '' ? ' · ' + state.snap : '' ), box.position.clone().setY( wall.planeY + height ) );
		render();

	}

	function wallClick( info ) {

		wallMove( info );

		if ( wall.end === null ) return;

		if ( wall.start === null ) {

			wall.start = wall.end.clone();
			wall.planeY = wall.end.y;
			wallMove( info );
			return;

		}

		const dx = wall.end.x - wall.start.x;
		const dz = wall.end.z - wall.start.z;
		const length = Math.hypot( dx, dz );
		const limits = limitsOf( 'wall', 'width' );

		if ( Number.isFinite( length ) === false || length < limits.min || length > limits.max ) {

			context.notify( t( 'construction/wall/invalidLength', units.format( limits.min ), units.format( limits.max ) ), 'warning' );
			return;

		}

		let object;

		try {

			object = createComponent( 'wall', { width: length, height: settings.wallHeight, thickness: settings.wallThickness } );

		} catch ( error ) {

			context.notify( error.message, 'warning' );
			return;

		}

		// ponto médio, base no plano de construção, eixo X local ao longo de A → B
		object.position.set( ( wall.start.x + wall.end.x ) / 2, wall.planeY, ( wall.start.z + wall.end.z ) / 2 );
		object.rotation.set( 0, angleForDirection( dx, dz ), 0 );

		insert( object, t( 'construction/wall/created', units.format( length ) ) );

		// modo contínuo: o próximo segmento começa na extremidade final
		wall.last = object;
		wall.start = wall.end.clone();
		wallMove( info );

	}

	function wallFinish() {

		wall.start = null;
		wall.last = null;
		state.length = null;
		state.phase = 'start';
		box.visible = outline.visible = axisLine.visible = false;
		interaction.refresh();
		render();

	}

	// desfazer a última parede durante o desenho contínuo: a sequência termina (sem referência obsoleta)
	editor.signals.objectRemoved.add( ( object ) => {

		if ( state.tool === 'wall' && object === wall.last ) wallFinish();

	} );

	interaction.register( 'wall', {

		activate() {

			state.tool = 'wall';
			state.phase = 'start';
			wall.start = wall.last = wall.end = null;
			setValid( true );
			render();

		},

		deactivate() {

			state.tool = null;
			wall.start = wall.last = wall.end = null;
			hidePreview();
			changed.dispatch();

		},

		onMove: wallMove,
		onClick: wallClick,

		// Esc: 1º cancela o segmento em andamento; 2º encerra a ferramenta
		onEscape() {

			if ( wall.start !== null ) wallFinish();
			else interaction.deactivate();

		}

	} );

	// ===================================================================== PISO

	const floor = { start: null, planeY: 0, end: null };

	function floorRect() {

		const minX = Math.min( floor.start.x, floor.end.x ), maxX = Math.max( floor.start.x, floor.end.x );
		const minZ = Math.min( floor.start.z, floor.end.z ), maxZ = Math.max( floor.start.z, floor.end.z );
		return { width: maxX - minX, depth: maxZ - minZ, cx: ( minX + maxX ) / 2, cz: ( minZ + maxZ ) / 2 };

	}

	function floorMove( info ) {

		const plane = floor.start === null ? getConstructionPlane( info, scene ) : { y: floor.planeY, point: intersectHorizontal( info, floor.planeY ) };

		if ( plane === null || plane.point === null ) return;

		const snap = snapPoint( plane.point, plane.y, snapOptions( info, null, false ) );
		floor.end = snap.point;
		state.snap = snapLegend( snap );

		showPreview();
		axisLine.visible = false;

		if ( floor.start === null ) {

			box.visible = outline.visible = false;
			setMarkers( [ snap.point ] );
			state.phase = 'start';
			state.width = state.depth = null;
			setLabel( state.snap, snap.point.clone().setY( plane.y + 0.05 ) );
			render();
			return;

		}

		const rect = floorRect();
		const width = limitsOf( 'floor', 'width' ), depth = limitsOf( 'floor', 'depth' );
		const thickness = settings.floorThickness;

		state.phase = 'end';
		state.width = rect.width;
		state.depth = rect.depth;
		setValid( rect.width >= width.min && rect.width <= width.max && rect.depth >= depth.min && rect.depth <= depth.max );

		box.visible = outline.visible = rect.width > 1e-6 && rect.depth > 1e-6;
		box.position.set( rect.cx, floor.planeY + thickness / 2, rect.cz );
		box.rotation.set( 0, 0, 0 );
		box.scale.set( Math.max( rect.width, 1e-4 ), thickness, Math.max( rect.depth, 1e-4 ) );
		outline.position.copy( box.position );
		outline.rotation.copy( box.rotation );
		outline.scale.copy( box.scale );

		setMarkers( [ floor.start, snap.point ] );
		setLabel( t( 'construction/floor/size', units.format( rect.width ), units.format( rect.depth ), formatArea( rect.width * rect.depth ) ), box.position.clone().setY( floor.planeY + thickness ) );
		render();

	}

	function formatArea( area ) {

		return area.toLocaleString( 'pt-BR', { maximumFractionDigits: 2 } ) + ' m²';

	}

	function floorClick( info ) {

		floorMove( info );

		if ( floor.end === null ) return;

		if ( floor.start === null ) {

			floor.start = floor.end.clone();
			floor.planeY = floor.end.y;
			floorMove( info );
			return;

		}

		const rect = floorRect();
		const width = limitsOf( 'floor', 'width' ), depth = limitsOf( 'floor', 'depth' );

		if ( [ rect.width, rect.depth ].every( Number.isFinite ) === false || rect.width < width.min || rect.depth < depth.min || rect.width > width.max || rect.depth > depth.max ) {

			context.notify( t( 'construction/floor/invalidSize', units.format( width.min ), units.format( width.max ) ), 'warning' );
			return;

		}

		let object;

		try {

			object = createComponent( 'floor', { width: rect.width, depth: rect.depth, thickness: settings.floorThickness } );

		} catch ( error ) {

			context.notify( error.message, 'warning' );
			return;

		}

		// origem do piso no centro da base (convenção da EV-003)
		object.position.set( rect.cx, floor.planeY, rect.cz );

		insert( object, t( 'construction/floor/created', units.format( rect.width ), units.format( rect.depth ) ) );

		floor.start = null;
		floorMove( info );

	}

	interaction.register( 'floor', {

		activate() {

			state.tool = 'floor';
			state.phase = 'start';
			floor.start = floor.end = null;
			setValid( true );
			render();

		},

		deactivate() {

			state.tool = null;
			floor.start = floor.end = null;
			hidePreview();
			changed.dispatch();

		},

		onMove: floorMove,
		onClick: floorClick,

		onEscape() {

			if ( floor.start !== null ) {

				floor.start = null;
				box.visible = outline.visible = false;
				interaction.refresh();
				render();

			} else {

				interaction.deactivate();

			}

		}

	} );

	// ===================================================================== POSICIONAR COMPONENTE

	const place = { create: null, name: '', instance: null, base: new THREE.Box3(), rotation: 0, position: null };

	function measurePlacement() {

		// caixa no espaço do próprio objeto já girado (sem posição): base e centro reais, sem supor pivô na base
		const instance = place.instance;
		instance.position.set( 0, 0, 0 );
		instance.rotation.set( 0, place.rotation, 0 );
		instance.updateMatrixWorld( true );
		place.base.setFromObject( instance, true );

	}

	function buildObjectPreview() {

		if ( objectPreview !== null ) {

			previewRoot.remove( objectPreview );
			objectPreview = null;

		}

		// mesma forma, material único translúcido (sem texturas na prévia)
		objectPreview = place.instance.clone( true );
		objectPreview.traverse( ( child ) => {

			if ( child.isMesh ) {

				child.geometry = child.geometry.clone();
				child.material = previewMaterial;
				child.castShadow = child.receiveShadow = false;
				child.raycast = () => {};

			}

		} );

		previewRoot.add( objectPreview );

	}

	function placeMove( info ) {

		const surface = getSupportSurface( info, scene );

		if ( surface.reason === 'none' ) return;

		showPreview();
		box.visible = axisLine.visible = false;

		const grid = context.precision.getSnap();
		const target = surface.point.clone();

		if ( grid !== null ) {

			target.x = Math.round( target.x / grid ) * grid;
			target.z = Math.round( target.z / grid ) * grid;

		}

		const center = place.base.getCenter( new THREE.Vector3() );

		// apoio pela face inferior da caixa mundial: o objeto nunca atravessa a superfície
		place.position = new THREE.Vector3( target.x - center.x, surface.y - place.base.min.y, target.z - center.z );

		objectPreview.position.copy( place.position );
		objectPreview.rotation.set( 0, place.rotation, 0 );

		outline.visible = true;
		const size = place.base.getSize( new THREE.Vector3() );
		outline.position.set( target.x, surface.y + size.y / 2, target.z );
		outline.rotation.set( 0, 0, 0 );
		outline.scale.copy( size ).max( new THREE.Vector3( 1e-3, 1e-3, 1e-3 ) );

		setValid( surface.valid );
		setMarkers( [ target.clone().setY( surface.y ) ] );

		state.position = place.position.clone();
		state.snap = surface.valid ? t( surface.object === null ? 'construction/surface/ground' : 'construction/surface/object', surface.object !== null ? surface.object.name : '' ) : t( 'construction/surface/invalid' );
		setLabel( state.snap, target.clone().setY( surface.y + size.y ) );
		render();

	}

	function placeClick( info ) {

		placeMove( info );

		if ( state.valid === false || place.position === null ) {

			context.notify( t( 'construction/surface/invalid/message' ), 'warning' );
			return;

		}

		const object = place.instance;
		object.position.copy( place.position );
		object.rotation.set( 0, place.rotation, 0 );
		object.name = place.name;
		place.instance = null; // a instância inserida não é mais reutilizada

		insert( object, t( 'message/added', object.name ) );
		interaction.deactivate();

	}

	interaction.register( 'place', {

		// options: { name, create: () => Object3D (nova instância independente) }
		activate( options ) {

			state.tool = 'place';
			state.phase = 'idle';
			state.label = options.name;
			place.create = options.create;
			place.name = options.name;
			place.rotation = 0;
			place.position = null;
			place.instance = options.create();

			measurePlacement();

			if ( place.base.isEmpty() ) {

				context.notify( t( 'construction/place/unsupported' ), 'warning' );
				setTimeout( () => interaction.deactivate(), 0 );
				return;

			}

			buildObjectPreview();
			setValid( true );
			render();

		},

		deactivate() {

			state.tool = null;
			place.instance = null;
			place.create = null;
			hidePreview();
			changed.dispatch();

		},

		onMove: placeMove,
		onClick: placeClick

	} );

	function rotatePlacement() {

		if ( state.tool !== 'place' ) return;

		place.rotation = ( place.rotation + Math.PI / 2 ) % ( Math.PI * 2 );
		state.rotation = place.rotation;
		measurePlacement();
		interaction.refresh();
		changed.dispatch();

	}

	// ===================================================================== APOIAR OBJETO EXISTENTE

	const rest = { object: null, exclude: null, box: new THREE.Box3(), delta: null };

	function restMove( info ) {

		const surface = getSupportSurface( info, scene, rest.exclude );

		if ( surface.reason === 'none' ) return;

		showPreview();
		box.visible = axisLine.visible = false;

		rest.object.updateWorldMatrix( true, true );
		rest.box.setFromObject( rest.object, true );

		const center = rest.box.getCenter( new THREE.Vector3() );
		const size = rest.box.getSize( new THREE.Vector3() );
		const grid = context.precision.getSnap();
		const target = surface.point.clone();

		if ( grid !== null ) {

			target.x = Math.round( target.x / grid ) * grid;
			target.z = Math.round( target.z / grid ) * grid;

		}

		// só translação (rotação e escala preservadas): centro em X/Z no ponto e base na superfície
		rest.delta = new THREE.Vector3( target.x - center.x, surface.y - rest.box.min.y, target.z - center.z );

		outline.visible = true;
		outline.position.set( target.x, surface.y + size.y / 2, target.z );
		outline.rotation.set( 0, 0, 0 );
		outline.scale.copy( size ).max( new THREE.Vector3( 1e-3, 1e-3, 1e-3 ) );

		setValid( surface.valid );
		setMarkers( [ target.clone().setY( surface.y ) ] );

		state.snap = surface.valid ? t( surface.object === null ? 'construction/surface/ground' : 'construction/surface/object', surface.object !== null ? surface.object.name : '' ) : t( 'construction/surface/invalid' );
		setLabel( state.snap, target.clone().setY( surface.y + size.y ) );
		render();

	}

	function restClick( info ) {

		restMove( info );

		if ( state.valid === false || rest.delta === null ) {

			context.notify( t( 'construction/surface/invalid/message' ), 'warning' );
			return;

		}

		const object = rest.object;
		const position = object.position.clone().add( rest.delta );

		if ( object.position.distanceTo( position ) > 1e-9 ) editor.execute( new SetPositionCommand( editor, object, position ) );

		context.notify( t( 'construction/rest/done', object.name ), 'success' );
		interaction.deactivate();

	}

	interaction.register( 'rest', {

		// options: { object }
		activate( options ) {

			const object = options.object;

			state.tool = 'rest';
			state.phase = 'idle';
			state.target = object;
			state.label = object.name;
			rest.object = object;
			rest.exclude = descendantsOf( object ); // o objeto nunca é superfície de apoio de si mesmo
			rest.delta = null;
			setValid( true );
			render();

		},

		deactivate() {

			state.tool = null;
			state.target = null;
			rest.object = null;
			rest.exclude = null;
			hidePreview();
			changed.dispatch();

		},

		onMove: restMove,
		onClick: restClick

	} );

	// o alvo foi excluído (ou o projeto trocado): encerra a ferramenta
	editor.signals.objectRemoved.add( ( object ) => {

		if ( state.tool === 'rest' && rest.exclude !== null && rest.exclude.has( object ) ) interaction.deactivate();

	} );

	// ===================================================================== API para a interface

	function setSetting( key, value ) {

		settings[ key ] = value;
		interaction.refresh();
		changed.dispatch();

	}

	function canRest( object ) {

		if ( object === null || object === scene || object.parent === null ) return t( 'message/nothingSelected' );
		if ( object.parent !== scene ) return t( 'construction/rest/nested' );
		if ( object.isLight === true || object.isCamera === true ) return t( 'construction/rest/unsupported' );

		const bounds = new THREE.Box3().setFromObject( object, true );
		if ( bounds.isEmpty() ) return t( 'construction/rest/unsupported' );

		return null;

	}

	return {
		changed,
		label,
		settings,
		state,
		setSetting,
		finishWall: wallFinish,
		rotatePlacement,
		canRest,
		angleForDirection
	};

}

export { ConstructionTools, angleForDirection };
