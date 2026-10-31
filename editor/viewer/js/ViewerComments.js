// EV-012 — Visualizador Project3DS: comentários do revisor.
//
// Comentário geral (projeto inteiro) ou vinculado a um componente — com o PONTO clicado guardado em coordenadas
// locais do componente (e a posição mundial de referência), além do enquadramento e da vista usados. Respostas com
// identificador próprio. Marcadores numerados em HTML sobre o canvas (não fazem parte da cena, não interceptam a
// navegação). Todo texto é exibido com textContent: marcação HTML digitada aparece como texto, nunca é executada.

import * as THREE from 'three';

import { cleanText, cleanComment, newId, REVIEW_LIMITS } from '../../js/SimpleMode.ReviewData.js';
import { readDraft, writeDraft, clearDraft, exportFeedback } from './ViewerFeedback.js';

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function btn( label, onClick, className = '' ) {

	const node = el( 'button', ( 'ViewerButton ' + className ).trim(), label );
	node.type = 'button';
	node.addEventListener( 'click', onClick );
	return node;

}

function formatDate( iso ) {

	const time = Date.parse( iso );
	return Number.isFinite( time ) ? new Date( time ).toLocaleString( 'pt-BR', { dateStyle: 'short', timeStyle: 'short' } ) : '';

}

function ViewerComments( { panel, markerLayer, camera, controls, selection, getRoot, describeUnit, getActiveView, notify, onCountChange } ) {

	const state = { manifest: null, reviewId: null, reviewer: '', comments: [], form: null, replying: null, markers: true, activeId: null, exportedAt: null };
	const _v = new THREE.Vector3();

	function findObject( uuid ) {

		const root = getRoot();
		return root !== null ? root.getObjectByProperty( 'uuid', uuid ) : undefined;

	}

	function persist() {

		if ( state.manifest === null ) return;
		writeDraft( state.manifest, { reviewId: state.reviewId, reviewer: state.reviewer, comments: state.comments, exportedAt: state.exportedAt } );
		onCountChange( state.comments.length );

	}

	function setPackage( manifest ) {

		state.manifest = manifest;
		state.reviewId = newId();
		state.comments = [];
		state.form = null;
		state.replying = null;
		state.activeId = null;
		state.exportedAt = null;

		const draft = readDraft( manifest );
		state.pendingDraft = draft !== null && draft.comments.length > 0 ? draft : null;
		if ( draft !== null && draft.reviewer !== '' ) state.reviewer = draft.reviewer;
		render();
		onCountChange( 0 );

	}

	function restoreDraft() {

		const draft = state.pendingDraft;
		if ( draft === null ) return;
		state.reviewId = draft.reviewId;
		state.reviewer = draft.reviewer || state.reviewer;
		state.comments = draft.comments;
		state.exportedAt = draft.exportedAt;
		state.pendingDraft = null;
		persist();
		render();
		notify( `${state.comments.length} comentário(s) recuperado(s) do rascunho local.` );

	}

	function discardDraft() {

		state.pendingDraft = null;
		clearDraft( state.manifest );
		render();

	}

	// formulário ---------------------------------------------------------------------------------------------------------

	function startComment( kind ) {

		if ( state.comments.length >= REVIEW_LIMITS.comments ) {

			notify( `Limite de ${REVIEW_LIMITS.comments} comentários atingido.`, 'error' );
			return;

		}

		const object = kind === 'object' ? selection.getSelected() : null;
		if ( kind === 'object' && object === null ) {

			notify( 'Selecione um componente no modelo para comentar sobre ele.' );
			return;

		}

		const point = kind === 'object' ? selection.getPoint() : null;
		state.form = { kind: object === null ? 'project' : 'object', object, point: point !== null ? point.clone() : null };
		render();
		const textarea = panel.querySelector( '.ViewerCommentText' );
		if ( textarea ) textarea.focus();

	}

	function submitComment( textValue ) {

		const textClean = cleanText( textValue, REVIEW_LIMITS.text, { multiline: true } );
		if ( textClean === '' ) {

			notify( 'Escreva o comentário antes de registrar.', 'error' );
			return false;

		}

		const form = state.form;
		let anchor = { kind: 'project' };
		if ( form.kind === 'object' && form.object !== null ) {

			const info = describeUnit( form.object );
			anchor = { kind: 'object', objectUuid: form.object.uuid, objectName: info.name, objectLabel: info.label };
			if ( form.point !== null ) {

				form.object.updateWorldMatrix( true, false );
				anchor.kind = 'object-point';
				anchor.localPosition = form.object.worldToLocal( form.point.clone() ).toArray().map( ( v ) => Math.round( v * 1e5 ) / 1e5 );
				anchor.worldPosition = form.point.toArray().map( ( v ) => Math.round( v * 1e5 ) / 1e5 );

			}

		}

		const view = getActiveView();
		const comment = cleanComment( {
			id: newId(),
			author: state.reviewer || 'Revisor',
			text: textClean,
			createdAt: new Date().toISOString(),
			anchor,
			camera: controls.cameraState(),
			viewName: view !== null ? view.name : '',
			replies: []
		} );

		state.comments.push( comment );
		state.exportedAt = null;
		state.form = null;
		state.activeId = comment.id;
		persist();
		render();
		notify( 'Comentário registrado. Lembre-se de exportar a revisão ao terminar.' );
		return true;

	}

	function submitReply( commentId, textValue ) {

		const textClean = cleanText( textValue, REVIEW_LIMITS.text, { multiline: true } );
		const comment = state.comments.find( ( c ) => c.id === commentId );
		if ( comment === undefined || textClean === '' ) {

			notify( 'Escreva a resposta antes de registrar.', 'error' );
			return;

		}

		if ( comment.replies.length >= REVIEW_LIMITS.replies ) return notify( 'Limite de respostas atingido.', 'error' );
		comment.replies.push( { id: newId(), author: state.reviewer || 'Revisor', text: textClean, createdAt: new Date().toISOString() } );
		state.replying = null;
		state.exportedAt = null;
		persist();
		render();

	}

	function removeComment( id ) {

		if ( window.confirm( 'Excluir este comentário da sua revisão?' ) === false ) return;
		state.comments = state.comments.filter( ( c ) => c.id !== id );
		if ( state.activeId === id ) state.activeId = null;
		state.exportedAt = null;
		persist();
		render();

	}

	function goTo( comment ) {

		state.activeId = comment.id;
		const object = comment.anchor.kind !== 'project' ? findObject( comment.anchor.objectUuid ) : undefined;
		if ( object !== undefined ) selection.select( object, null );
		if ( comment.camera !== null ) controls.animateTo( { position: comment.camera.position, target: comment.camera.target, fov: comment.camera.fov } );
		else if ( object !== undefined ) controls.frameObject( object );
		render();
		const item = panel.querySelector( `.ViewerComment[data-comment="${comment.id}"]` );
		if ( item ) item.scrollIntoView( { block: 'nearest' } );

	}

	function exportReview() {

		if ( state.comments.length === 0 ) {

			notify( 'Registre ao menos um comentário antes de exportar.', 'error' );
			return null;

		}

		if ( state.reviewer === '' ) {

			notify( 'Informe seu nome de identificação antes de exportar.', 'error' );
			const input = panel.querySelector( '.ViewerReviewerName' );
			if ( input ) input.focus();
			return null;

		}

		const result = exportFeedback( state.manifest, { reviewId: state.reviewId, reviewer: state.reviewer, comments: state.comments } );
		state.exportedAt = Date.now();
		persist();
		render();
		notify( `Arquivo "${result.name}" exportado. Envie-o ao responsável pelo projeto.` );
		return result;

	}

	// interface ----------------------------------------------------------------------------------------------------------

	function anchorText( comment ) {

		if ( comment.anchor.kind === 'project' ) return 'Projeto inteiro';
		return [ comment.anchor.objectLabel, comment.anchor.objectName ].filter( Boolean ).join( ' — ' ) || 'Componente';

	}

	function render() {

		panel.textContent = '';
		if ( state.manifest === null ) return;

		const identity = el( 'label', 'ViewerField' );
		identity.appendChild( el( 'span', '', 'Seu nome (identificação declarada)' ) );
		const name = el( 'input', 'ViewerInput ViewerReviewerName' );
		name.maxLength = REVIEW_LIMITS.name;
		name.value = state.reviewer;
		name.placeholder = 'Ex.: Ana — arquitetura';
		name.addEventListener( 'change', () => {

			state.reviewer = cleanText( name.value, REVIEW_LIMITS.name );
			name.value = state.reviewer;
			persist();

		} );
		identity.appendChild( name );
		panel.appendChild( identity );

		if ( state.pendingDraft ) {

			const banner = el( 'div', 'ViewerBanner ViewerDraftBanner' );
			banner.appendChild( el( 'p', '', `Há um rascunho local com ${state.pendingDraft.comments.length} comentário(s) deste pacote.` ) );
			banner.append( btn( 'Recuperar rascunho', () => restoreDraft(), 'primary ViewerDraftRestore' ), btn( 'Descartar', () => discardDraft(), 'ViewerDraftDiscard' ) );
			panel.appendChild( banner );

		}

		const actions = el( 'div', 'ViewerRow' );
		const selected = selection.getSelected();
		actions.append(
			btn( 'Comentário geral', () => startComment( 'project' ), 'ViewerCommentGeneral' ),
			btn( selected !== null ? 'Comentar componente' : 'Comentar componente (selecione no modelo)', () => startComment( 'object' ), 'ViewerCommentObject' + ( selected === null ? ' muted' : '' ) )
		);
		panel.appendChild( actions );

		if ( state.form !== null ) panel.appendChild( renderForm() );

		const toolbar = el( 'div', 'ViewerRow' );
		const markerToggle = el( 'label', 'ViewerCheck' );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.className = 'ViewerMarkersToggle';
		box.checked = state.markers;
		box.addEventListener( 'change', () => {

			state.markers = box.checked;
			renderMarkers();

		} );
		markerToggle.append( box, el( 'span', '', 'Mostrar marcadores' ) );
		toolbar.append( markerToggle, btn( `Exportar comentários (${state.comments.length})`, () => exportReview(), 'primary ViewerExport' ) );
		panel.appendChild( toolbar );

		panel.appendChild( el( 'p', 'ViewerHint', state.exportedAt !== null ? `Última exportação: ${new Date( state.exportedAt ).toLocaleString( 'pt-BR' )}. Os comentários também ficam num rascunho deste navegador; exporte novamente se fizer alterações.` : 'Os comentários ficam num rascunho deste navegador até você exportar. Exporte antes de limpar os dados do navegador. Não há envio automático: envie o arquivo exportado ao responsável.' ) );

		const list = el( 'div', 'ViewerComments' );
		if ( state.comments.length === 0 ) list.appendChild( el( 'p', 'ViewerHint', 'Nenhum comentário ainda. Selecione um componente no modelo ou registre um comentário geral.' ) );
		state.comments.forEach( ( comment, index ) => list.appendChild( renderComment( comment, index + 1 ) ) );
		panel.appendChild( list );

		renderMarkers();

	}

	function renderForm() {

		const form = el( 'div', 'ViewerCommentForm' );
		const target = state.form.kind === 'object' ? describeUnit( state.form.object ) : null;
		form.appendChild( el( 'strong', '', target !== null ? `Comentário sobre: ${[ target.label, target.name ].filter( Boolean ).join( ' — ' )}` : 'Comentário geral (projeto inteiro)' ) );
		if ( target !== null && state.form.point !== null ) form.appendChild( el( 'span', 'ViewerHint', 'O ponto clicado no componente será marcado no modelo.' ) );
		const textarea = el( 'textarea', 'ViewerInput ViewerCommentText' );
		textarea.rows = 4;
		textarea.maxLength = REVIEW_LIMITS.text;
		textarea.placeholder = 'Escreva sua observação';
		const counter = el( 'span', 'ViewerHint', `0 / ${REVIEW_LIMITS.text}` );
		textarea.addEventListener( 'input', () => {

			counter.textContent = `${textarea.value.length} / ${REVIEW_LIMITS.text}`;

		} );
		const row = el( 'div', 'ViewerRow' );
		row.append( btn( 'Cancelar', () => {

			state.form = null;
			render();

		}, 'ViewerCommentCancel' ), btn( 'Registrar comentário', () => submitComment( textarea.value ), 'primary ViewerCommentSubmit' ) );
		form.append( textarea, counter, row );
		return form;

	}

	function renderComment( comment, number ) {

		const item = el( 'article', 'ViewerComment' + ( state.activeId === comment.id ? ' active' : '' ) );
		item.dataset.comment = comment.id;
		const head = el( 'div', 'ViewerCommentHead' );
		head.append( el( 'span', 'ViewerCommentNumber', String( number ) ), el( 'span', 'ViewerCommentMeta', `${comment.author} · ${formatDate( comment.createdAt )}` ) );
		item.appendChild( head );
		const anchor = el( 'div', 'ViewerCommentAnchor', anchorText( comment ) );
		if ( comment.viewName ) anchor.appendChild( el( 'span', 'ViewerHint', ` · vista: ${comment.viewName}` ) );
		item.appendChild( anchor );
		item.appendChild( el( 'p', 'ViewerCommentBody', comment.text ) );

		for ( const reply of comment.replies ) {

			const node = el( 'div', 'ViewerReply' );
			node.dataset.reply = reply.id;
			node.append( el( 'span', 'ViewerCommentMeta', `${reply.author} · ${formatDate( reply.createdAt )}` ), el( 'p', 'ViewerCommentBody', reply.text ) );
			item.appendChild( node );

		}

		const row = el( 'div', 'ViewerRow' );
		row.append(
			btn( 'Ir até', () => goTo( comment ), 'ViewerCommentGo' ),
			btn( 'Responder', () => {

				state.replying = comment.id;
				render();
				const textarea = panel.querySelector( '.ViewerReplyText' );
				if ( textarea ) textarea.focus();

			}, 'ViewerCommentReply' ),
			btn( 'Excluir', () => removeComment( comment.id ), 'danger ViewerCommentDelete' )
		);
		item.appendChild( row );

		if ( state.replying === comment.id ) {

			const form = el( 'div', 'ViewerCommentForm' );
			const textarea = el( 'textarea', 'ViewerInput ViewerReplyText' );
			textarea.rows = 2;
			textarea.maxLength = REVIEW_LIMITS.text;
			textarea.placeholder = 'Sua resposta';
			const actions = el( 'div', 'ViewerRow' );
			actions.append( btn( 'Cancelar', () => {

				state.replying = null;
				render();

			} ), btn( 'Registrar resposta', () => submitReply( comment.id, textarea.value ), 'primary ViewerReplySubmit' ) );
			form.append( textarea, actions );
			item.appendChild( form );

		}

		return item;

	}

	// marcadores ---------------------------------------------------------------------------------------------------------

	function anchorPosition( comment, target ) {

		if ( comment.anchor.kind === 'project' ) return null;
		const object = findObject( comment.anchor.objectUuid );
		if ( object === undefined ) return null;
		object.updateWorldMatrix( true, false );
		if ( comment.anchor.kind === 'object-point' && comment.anchor.localPosition ) return object.localToWorld( target.fromArray( comment.anchor.localPosition ) );
		const box = new THREE.Box3().setFromObject( object );
		box.getCenter( target );
		target.y = box.max.y;
		return target;

	}

	function renderMarkers() {

		markerLayer.textContent = '';
		markerLayer.hidden = state.markers === false;
		if ( state.markers === false ) return;

		state.comments.forEach( ( comment, index ) => {

			if ( comment.anchor.kind === 'project' ) return;
			const marker = el( 'button', 'ViewerMarker' + ( state.activeId === comment.id ? ' active' : '' ), String( index + 1 ) );
			marker.type = 'button';
			marker.dataset.comment = comment.id;
			marker.title = `Comentário ${index + 1} — ${anchorText( comment )}`;
			marker.setAttribute( 'aria-label', marker.title );
			marker.addEventListener( 'pointerdown', ( event ) => event.stopPropagation() );
			marker.addEventListener( 'click', ( event ) => {

				event.stopPropagation();
				goTo( comment );

			} );
			markerLayer.appendChild( marker );

		} );

		updateMarkers();

	}

	function updateMarkers() {

		if ( state.markers === false || markerLayer.childElementCount === 0 ) return;
		const width = markerLayer.clientWidth, height = markerLayer.clientHeight;
		camera.updateMatrixWorld();

		for ( const marker of markerLayer.children ) {

			const comment = state.comments.find( ( c ) => c.id === marker.dataset.comment );
			const position = comment !== undefined ? anchorPosition( comment, _v ) : null;
			if ( position === null ) {

				marker.hidden = true;
				continue;

			}

			position.project( camera );
			marker.hidden = position.z > 1 || position.z < - 1;
			if ( marker.hidden ) continue;
			marker.style.transform = `translate(${( ( position.x + 1 ) / 2 * width ).toFixed( 1 )}px, ${( ( 1 - position.y ) / 2 * height ).toFixed( 1 )}px) translate(-50%, -100%)`;

		}

	}

	return {
		setPackage,
		render,
		updateMarkers,
		startComment,
		exportReview,
		count: () => state.comments.length,
		hasUnexported: () => state.comments.length > 0 && state.exportedAt === null
	};

}

export { ViewerComments };
