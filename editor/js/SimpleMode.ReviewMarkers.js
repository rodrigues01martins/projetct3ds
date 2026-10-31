// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// Marcadores numerados dos comentários sobre o viewport do editor. São elementos HTML sobrepostos (projetados a cada
// quadro a partir da posição do componente), NUNCA objetos da cena: não entram no JSON, não alteram a geometria, não
// participam da seleção nem do Desfazer. Só os próprios botões recebem cliques (pointer-events), então a navegação
// do viewport continua livre. O marcador de um ponto local acompanha o componente quando ele é movido.

import * as THREE from 'three';

function SimpleModeReviewMarkers( editor, reviews, { onSelect } ) {

	const viewport = document.getElementById( 'viewport' );
	const layer = document.createElement( 'div' );
	layer.className = 'SimpleReviewMarkers';
	layer.hidden = true;
	viewport.appendChild( layer );

	const state = { visible: false, activeId: null, frame: 0, numbers: new Map() };
	const _position = new THREE.Vector3();

	function rebuild() {

		layer.textContent = '';
		if ( state.visible === false ) return;

		const comments = reviews.comments();
		state.numbers = new Map( comments.map( ( comment, index ) => [ comment.id, index + 1 ] ) );

		for ( const comment of comments ) {

			if ( comment.anchor.kind === 'project' || reviews.anchorState( comment ) !== 'found' ) continue;
			const marker = document.createElement( 'button' );
			marker.type = 'button';
			marker.className = 'SimpleReviewMarker';
			marker.dataset.comment = comment.id;
			marker.dataset.status = comment.status;
			marker.textContent = String( state.numbers.get( comment.id ) );
			marker.title = `Comentário ${state.numbers.get( comment.id )} — ${comment.author}`;
			marker.setAttribute( 'aria-label', marker.title );
			if ( comment.id === state.activeId ) marker.classList.add( 'active' );
			marker.addEventListener( 'pointerdown', ( event ) => event.stopPropagation() );
			marker.addEventListener( 'click', ( event ) => {

				event.stopPropagation();
				onSelect( comment.id );

			} );
			layer.appendChild( marker );

		}

		update();

	}

	function update() {

		if ( state.visible === false ) return;
		const camera = editor.viewportCamera;
		const width = viewport.clientWidth, height = viewport.clientHeight;
		camera.updateMatrixWorld();

		for ( const marker of layer.children ) {

			const comment = reviews.comments().find( ( c ) => c.id === marker.dataset.comment );
			const position = comment !== undefined ? reviews.anchorPosition( comment, _position ) : null;
			if ( position === null ) {

				marker.hidden = true;
				continue;

			}

			position.project( camera );
			const behind = position.z > 1 || position.z < - 1;
			marker.hidden = behind;
			if ( behind ) continue;
			marker.style.transform = `translate(${( ( position.x + 1 ) / 2 * width ).toFixed( 1 )}px, ${( ( 1 - position.y ) / 2 * height ).toFixed( 1 )}px) translate(-50%, -100%)`;

		}

	}

	function loop() {

		update();
		state.frame = state.visible ? requestAnimationFrame( loop ) : 0;

	}

	function setVisible( visible ) {

		state.visible = visible;
		layer.hidden = visible === false;
		cancelAnimationFrame( state.frame );
		state.frame = 0;
		rebuild();
		if ( visible ) state.frame = requestAnimationFrame( loop );

	}

	function setActive( id ) {

		state.activeId = id;
		for ( const marker of layer.children ) marker.classList.toggle( 'active', marker.dataset.comment === id );

	}

	editor.signals.sceneGraphChanged.add( () => {

		if ( state.visible ) rebuild();

	} );

	return { setVisible, setActive, rebuild, isVisible: () => state.visible, numberOf: ( id ) => state.numbers.get( id ) };

}

export { SimpleModeReviewMarkers };
