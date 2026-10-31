// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// Revisões no editor do proprietário. Toda alteração passa por SetProjectReviewsCommand (Desfazer/Refazer) e é salva
// pela EV-011 junto com o projeto. Importar uma revisão NUNCA altera dimensões, materiais ou posições: os comentários
// só apontam para componentes (pelo UUID). Localizar um comentário seleciona/enquadra o componente sem gerar passo
// no histórico.
//
// Correspondência na importação:
//   - projeto: o ID de origem do arquivo precisa ser o do projeto aberto (outro projeto: informado, nada importado);
//   - compartilhamento: procurado no registro local (EV-011, store meta); o hash revisado é comparado com o hash
//     registrado no momento do compartilhamento (correspondência de conteúdo — datas não são usadas como critério);
//   - versão: revisão de origem x revisão atual e as impressões de cada componente (transformação + dimensões);
//   - componentes: somente pelo UUID. UUID ausente = "não localizado"; impressão diferente = "possivelmente
//     desatualizado". Nenhum comentário é associado a outro componente (nem por nome parecido).

import * as THREE from 'three';

import { SetProjectReviewsCommand } from './commands/SetProjectReviewsCommand.js';
import { getReviews, parseFeedback, mergeFeedback, cleanText, newId, countByStatus, STATUSES, STATUS_LABELS, REVIEW_LIMITS } from './SimpleMode.ReviewData.js';
import { findShare, collectUnits, fingerprint, labelOf } from './SimpleMode.ShareExport.js';

const OWNER_NAME_KEY = 'review/ownerName';

function ReviewManager( editor, context ) {

	const signals = editor.signals;

	const findObject = ( uuid ) => typeof uuid === 'string' ? editor.scene.getObjectByProperty( 'uuid', uuid ) : undefined;

	function comments() {

		return getReviews( editor.scene ).comments;

	}

	function commit( mutate, name ) {

		const reviews = getReviews( editor.scene );
		if ( mutate( reviews ) === false ) return false;
		editor.execute( new SetProjectReviewsCommand( editor, reviews, name ) );
		return true;

	}

	function ownerName() {

		return cleanText( editor.config.getKey( OWNER_NAME_KEY ) || '', REVIEW_LIMITS.name ) || 'Responsável';

	}

	function setOwnerName( name ) {

		editor.config.setKey( OWNER_NAME_KEY, cleanText( name, REVIEW_LIMITS.name ) );

	}

	function setStatus( id, status ) {

		if ( STATUSES.includes( status ) === false ) return false;
		return commit( ( reviews ) => {

			const comment = reviews.comments.find( ( c ) => c.id === id );
			if ( comment === undefined || comment.status === status ) return false;
			comment.status = status;

		}, `Revisão: ${STATUS_LABELS[ status ].toLowerCase()}` );

	}

	function addReply( id, textValue ) {

		const textClean = cleanText( textValue, REVIEW_LIMITS.text, { multiline: true } );
		if ( textClean === '' ) return false;
		return commit( ( reviews ) => {

			const comment = reviews.comments.find( ( c ) => c.id === id );
			if ( comment === undefined || comment.replies.length >= REVIEW_LIMITS.replies ) return false;
			comment.replies.push( { id: newId(), author: ownerName(), text: textClean, createdAt: new Date().toISOString(), own: true } );

		}, 'Revisão: responder' );

	}

	// somente respostas do proprietário (registradas neste editor) podem ser editadas
	function editReply( commentId, replyId, textValue ) {

		const textClean = cleanText( textValue, REVIEW_LIMITS.text, { multiline: true } );
		if ( textClean === '' ) return false;
		return commit( ( reviews ) => {

			const comment = reviews.comments.find( ( c ) => c.id === commentId );
			const reply = comment && comment.replies.find( ( r ) => r.id === replyId );
			if ( reply === undefined || reply.own !== true || reply.text === textClean ) return false;
			reply.text = textClean;
			reply.editedAt = new Date().toISOString();

		}, 'Revisão: editar resposta' );

	}

	function deleteComment( id ) {

		return commit( ( reviews ) => {

			const index = reviews.comments.findIndex( ( c ) => c.id === id );
			if ( index === - 1 ) return false;
			reviews.comments.splice( index, 1 );

		}, 'Revisão: excluir comentário' );

	}

	// situação do vínculo de um comentário no projeto atual: 'project' | 'found' | 'missing'
	function anchorState( comment ) {

		if ( comment.anchor.kind === 'project' ) return 'project';
		return findObject( comment.anchor.objectUuid ) !== undefined ? 'found' : 'missing';

	}

	// posição mundial do marcador: ponto local acompanha o componente (se ele foi movido, o marcador vai junto)
	function anchorPosition( comment, target = new THREE.Vector3() ) {

		if ( comment.anchor.kind === 'project' ) return null;
		const object = findObject( comment.anchor.objectUuid );
		if ( object === undefined ) return null;
		object.updateWorldMatrix( true, false );

		if ( comment.anchor.kind === 'object-point' && comment.anchor.localPosition ) return object.localToWorld( target.fromArray( comment.anchor.localPosition ) );

		const box = new THREE.Box3().setFromObject( object );
		if ( box.isEmpty() ) return object.getWorldPosition( target );
		box.getCenter( target );
		target.y = box.max.y;
		return target;

	}

	// localizar: seleciona e enquadra (sem histórico); restaura o enquadramento do revisor quando pedido
	function locate( comment, { useCamera = false } = {} ) {

		const object = comment.anchor.kind !== 'project' ? findObject( comment.anchor.objectUuid ) : undefined;
		if ( object !== undefined ) editor.select( object );

		if ( useCamera && comment.camera !== null && context.cameras !== undefined ) {

			context.cameras.transitionTo( Object.assign( { preset: null }, comment.camera ) );

		} else if ( object !== undefined && context.cameras !== undefined ) {

			context.cameras.frameSelection( object );

		}

		return object !== undefined;

	}

	// importação ---------------------------------------------------------------------------------------------------------

	async function analyze( file ) {

		if ( file.size > REVIEW_LIMITS.fileBytes ) throw new Error( 'Arquivo de revisão grande demais (limite de 5 MB).' );
		const { feedback, problems } = parseFeedback( await file.text() );

		const projects = context.projects;
		const active = projects !== undefined ? projects.getActive() : null;
		const analysis = { feedback, problems: problems.slice(), warnings: [], items: [], blocked: null, share: null, otherProject: null };

		if ( active === null ) {

			analysis.blocked = 'Abra o projeto revisado (em Meus projetos) antes de importar a revisão.';

		} else if ( feedback.source.projectId !== active.id ) {

			const other = projects.state.available ? await projects.storage.getProject( feedback.source.projectId ) : undefined;
			analysis.otherProject = other !== undefined && other.deletedAt === null ? { id: other.id, name: other.name } : null;
			analysis.blocked = analysis.otherProject !== null
				? `Esta revisão pertence ao projeto "${analysis.otherProject.name}", não ao projeto aberto. Abra-o para importar.`
				: 'Esta revisão pertence a outro projeto, que não está em Meus projetos neste navegador. Nada foi importado.';

		}

		if ( analysis.blocked !== null ) return analysis;

		const share = projects.state.available ? await findShare( projects.storage, feedback.shareId ) : null;
		analysis.share = share;

		const units = new Map( collectUnits( editor.scene ).map( ( unit ) => [ unit.object.uuid, unit ] ) );

		if ( share === null ) {

			analysis.warnings.push( 'O compartilhamento de origem não está registrado neste navegador: a correspondência foi verificada apenas pelo projeto e pelos identificadores dos componentes.' );

		} else {

			if ( share.projectId !== active.id ) {

				analysis.blocked = 'O compartilhamento de origem pertence a outro projeto. Nada foi importado.';
				return analysis;

			}

			if ( feedback.snapshotHash !== share.contentHash ) analysis.warnings.push( 'O hash do conteúdo revisado não confere com o compartilhamento registrado: o arquivo pode ter sido montado a partir de outro pacote.' );

			const changed = Object.keys( share.fingerprints || {} ).some( ( uuid ) => units.has( uuid ) === false || fingerprint( units.get( uuid ).object ) !== share.fingerprints[ uuid ] ) || [ ...units.keys() ].some( ( uuid ) => share.fingerprints[ uuid ] === undefined );
			analysis.versionChanged = changed;
			if ( changed ) analysis.warnings.push( `O projeto foi alterado depois do compartilhamento (revisão ${share.revision ?? '?'} compartilhada; revisão atual ${active.revision}). Verifique os comentários marcados como possivelmente desatualizados.` );

		}

		if ( share === null && feedback.source.revision !== null && feedback.source.revision !== active.revision ) {

			analysis.warnings.push( `A revisão foi feita sobre a revisão ${feedback.source.revision} do projeto; a revisão atual é ${active.revision}.` );

		}

		const anchors = new Map();
		for ( const comment of feedback.comments ) {

			let state = 'project';
			if ( comment.anchor.kind !== 'project' ) {

				const object = findObject( comment.anchor.objectUuid );
				if ( object === undefined ) state = 'missing';
				else if ( share !== null && share.fingerprints && share.fingerprints[ comment.anchor.objectUuid ] !== undefined && fingerprint( object ) !== share.fingerprints[ comment.anchor.objectUuid ] ) state = 'stale';
				else state = 'found';
				anchors.set( comment.anchor.objectUuid, state );

			}

			analysis.items.push( { comment, state, label: comment.anchor.kind !== 'project' && state !== 'missing' ? labelOf( findObject( comment.anchor.objectUuid ) ) : comment.anchor.objectLabel } );

		}

		const preview = mergeFeedback( getReviews( editor.scene ), feedback, { anchors } );
		analysis.anchors = anchors;
		analysis.summary = preview.summary;
		return analysis;

	}

	function importAnalysis( analysis ) {

		if ( analysis.blocked !== null ) return null;
		const { reviews, summary } = mergeFeedback( getReviews( editor.scene ), analysis.feedback, { anchors: analysis.anchors } );
		if ( summary.changed ) editor.execute( new SetProjectReviewsCommand( editor, reviews, 'Importar revisão' ) );
		return summary;

	}

	return {
		comments,
		counts: () => countByStatus( comments() ),
		setStatus,
		addReply,
		editReply,
		deleteComment,
		anchorState,
		anchorPosition,
		locate,
		analyze,
		importAnalysis,
		ownerName,
		setOwnerName,
		findObject,
		signals
	};

}

export { ReviewManager };
