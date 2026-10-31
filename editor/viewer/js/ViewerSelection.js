// EV-012 — Visualizador Project3DS: seleção somente para consulta.
//
// Um clique (sem arrastar) escolhe a UNIDADE mais próxima do ponto atingido: o componente paramétrico como conjunto
// (EV-003), a porta/janela hospedada como componente próprio (EV-007) e objetos soltos. Malhas internas nunca são
// selecionadas isoladamente. O destaque é um contorno desenhado numa cena auxiliar — o modelo não é alterado.

import * as THREE from 'three';

const CLICK_TOLERANCE = 5;

function unitOf( object ) {

	let current = object;
	while ( current !== null && current !== undefined ) {

		const share = current.userData && current.userData.share;
		if ( share && share.unit === true ) return current;
		current = current.parent;

	}

	return null;

}

function ViewerSelection( { camera, domElement, getRoot, helpers, isEnabled, onSelect } ) {

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	let down = null;
	let selected = null;
	let point = null;
	let outline = null;

	function pick( clientX, clientY ) {

		const root = getRoot();
		if ( root === null ) return null;
		const rect = domElement.getBoundingClientRect();
		pointer.set( ( ( clientX - rect.left ) / rect.width ) * 2 - 1, - ( ( clientY - rect.top ) / rect.height ) * 2 + 1 );
		raycaster.setFromCamera( pointer, camera );

		const hits = raycaster.intersectObject( root, true ).filter( ( hit ) => hit.object.isMesh && hit.object.visible && isVisible( hit.object ) );
		for ( const hit of hits ) {

			const unit = unitOf( hit.object );
			if ( unit !== null ) return { object: unit, point: hit.point.clone() };

		}

		return hits.length > 0 ? { object: null, point: hits[ 0 ].point.clone() } : null;

	}

	function isVisible( object ) {

		let current = object;
		while ( current !== null ) {

			if ( current.visible === false ) return false;
			current = current.parent;

		}

		return true;

	}

	function select( object, hitPoint = null ) {

		selected = object;
		point = object !== null ? hitPoint : null;
		if ( outline !== null ) {

			helpers.remove( outline );
			outline.geometry.dispose();
			outline.material.dispose();
			outline = null;

		}

		if ( object !== null ) {

			outline = new THREE.BoxHelper( object, 0xffb020 );
			outline.material.depthTest = false;
			outline.material.transparent = true;
			outline.renderOrder = 10;
			helpers.add( outline );

		}

		onSelect( selected, point );

	}

	domElement.addEventListener( 'pointerdown', ( event ) => {

		down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;

	} );

	domElement.addEventListener( 'pointerup', ( event ) => {

		if ( down === null || isEnabled() === false ) return;
		const moved = Math.hypot( event.clientX - down.x, event.clientY - down.y ) > CLICK_TOLERANCE;
		down = null;
		if ( moved ) return;
		const result = pick( event.clientX, event.clientY );
		select( result !== null ? result.object : null, result !== null && result.object !== null ? result.point : null );

	} );

	return {
		select,
		pick,
		getSelected: () => selected,
		getPoint: () => point,
		update: () => {

			if ( outline !== null ) outline.update();

		}
	};

}

export { ViewerSelection, unitOf };
