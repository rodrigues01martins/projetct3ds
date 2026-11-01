// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Representação temporária das operações de montagem (encaixe, repetição, conectores): contornos de caixa, pontos,
// setas de orientação e um rótulo. Tudo fica em editor.sceneHelpers — desenhado pelo viewport, nunca salvo no
// projeto, nunca atingido pelo raycasting de seleção — e nada altera os objetos permanentes. Para modelos pesados
// (EV-013) a prévia é só a caixa: nenhuma geometria importada é copiada ou reconstruída continuamente.

import * as THREE from 'three';

import { localBox } from './SimpleMode.AssemblyConnectors.js';

const COLORS = { valid: 0x2f9e66, invalid: 0xe5484d, source: 0xffb020, target: 0x0a84ff, connector: 0x8a4fff };

function AssemblyPreview( editor, interaction ) {

	const root = new THREE.Group();
	root.name = 'Prévia de montagem';
	const unitBox = new THREE.EdgesGeometry( new THREE.BoxGeometry( 1, 1, 1 ) );
	const boxMaterials = {
		valid: new THREE.LineBasicMaterial( { color: COLORS.valid, depthTest: false, transparent: true } ),
		invalid: new THREE.LineBasicMaterial( { color: COLORS.invalid, depthTest: false, transparent: true } )
	};
	const fill = new THREE.MeshBasicMaterial( { color: COLORS.valid, transparent: true, opacity: 0.14, depthWrite: false } );
	const sphere = new THREE.SphereGeometry( 1, 12, 8 );
	const pointMaterials = {
		source: new THREE.MeshBasicMaterial( { color: COLORS.source, depthTest: false } ),
		target: new THREE.MeshBasicMaterial( { color: COLORS.target, depthTest: false } ),
		connector: new THREE.MeshBasicMaterial( { color: COLORS.connector, depthTest: false } )
	};

	const label = document.createElement( 'div' );
	label.className = 'SimpleAssemblyLabel';
	label.hidden = true;
	interaction.viewport.appendChild( label );
	let labelAnchor = null;

	function attach() {

		if ( root.parent === null ) editor.sceneHelpers.add( root );

	}

	function clear() {

		for ( const child of root.children.slice() ) {

			root.remove( child );
			if ( child.isArrowHelper ) child.dispose();

		}

		label.hidden = true;
		labelAnchor = null;
		render();

	}

	function render() {

		editor.signals.sceneHelpersChanged.dispatch();

	}

	// contorno da caixa local de um objeto sob uma matriz mundial (posição prevista)
	function addBox( object, matrix, valid = true, withFill = false, box = null ) {

		attach();
		const local = box !== null ? box : localBox( object );
		if ( local.isEmpty() ) return null;
		const size = local.getSize( new THREE.Vector3() ).max( new THREE.Vector3( 1e-3, 1e-3, 1e-3 ) );
		const center = local.getCenter( new THREE.Vector3() );
		const placement = new THREE.Matrix4().multiplyMatrices( matrix, new THREE.Matrix4().compose( center, new THREE.Quaternion(), size ) );
		const lines = new THREE.LineSegments( unitBox, valid ? boxMaterials.valid : boxMaterials.invalid );
		lines.matrixAutoUpdate = false;
		lines.matrix.copy( placement );
		lines.renderOrder = 20;
		root.add( lines );
		if ( withFill ) {

			const mesh = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), fill );
			mesh.matrixAutoUpdate = false;
			mesh.matrix.copy( placement );
			mesh.raycast = () => {};

			root.add( mesh );

		}

		return lines;

	}

	function addPoint( position, kind = 'target', radius = null ) {

		attach();
		const camera = editor.viewportCamera;
		const r = radius !== null ? radius : Math.max( camera.position.distanceTo( position ) * 0.008, 0.01 );
		const mesh = new THREE.Mesh( sphere, pointMaterials[ kind ] );
		mesh.position.copy( position );
		mesh.scale.setScalar( r );
		mesh.renderOrder = 21;
		mesh.raycast = () => {};

		root.add( mesh );
		return mesh;

	}

	function addArrow( origin, direction, length, color = COLORS.target ) {

		attach();
		const arrow = new THREE.ArrowHelper( direction.clone().normalize(), origin, length, color, length * 0.3, length * 0.18 );
		arrow.traverse( ( child ) => {

			if ( child.material ) child.material.depthTest = false;
			child.renderOrder = 22;
			child.raycast = () => {};

		} );
		root.add( arrow );
		return arrow;

	}

	function setLabel( text, anchor, valid = true ) {

		label.textContent = text;
		label.classList.toggle( 'invalid', valid === false );
		labelAnchor = anchor !== null ? anchor.clone() : null;
		updateLabel();

	}

	function updateLabel() {

		if ( labelAnchor === null ) {

			label.hidden = true;
			return;

		}

		const projected = labelAnchor.clone().project( editor.viewportCamera );
		label.hidden = projected.z < - 1 || projected.z > 1;
		const screen = interaction.toScreen( labelAnchor );
		label.style.transform = `translate(${screen.x.toFixed( 1 )}px, ${( screen.y - 14 ).toFixed( 1 )}px) translate(-50%, -100%)`;

	}

	editor.signals.cameraChanged.add( updateLabel );

	return { root, clear, render, addBox, addPoint, addArrow, setLabel, COLORS };

}

export { AssemblyPreview };
