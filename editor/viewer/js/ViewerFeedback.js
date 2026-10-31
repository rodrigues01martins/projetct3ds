// EV-012 — Visualizador Project3DS: arquivo de revisão e rascunho local.
//
// Exporta "<projeto>.p3ds-feedback.json" (somente comentários, respostas, referências por UUID e enquadramentos —
// o modelo 3D não é repetido) e mantém um rascunho dos comentários no navegador do destinatário. O rascunho é uma
// conveniência: não substitui a exportação (limpar os dados do navegador o apaga).

import { buildFeedback, sanitizeReviews, cleanText, newId, REVIEW_LIMITS } from '../../js/SimpleMode.ReviewData.js';
import { safeFileName } from '../../js/SimpleMode.ProjectData.js';

const DRAFT_PREFIX = 'project3ds-review-draft:';

function draftKey( manifest ) {

	return DRAFT_PREFIX + manifest.shareId;

}

function readDraft( manifest ) {

	try {

		const raw = localStorage.getItem( draftKey( manifest ) );
		if ( raw === null || raw.length > REVIEW_LIMITS.fileBytes ) return null;
		const data = JSON.parse( raw );
		if ( data === null || typeof data !== 'object' || data.contentHash !== manifest.contentHash ) return null;
		// mesmo tratamento de entrada não confiável dos arquivos (o armazenamento local pode ter sido alterado)
		const comments = sanitizeReviews( { comments: data.comments } ).comments.map( ( comment ) => {

			delete comment.status;
			return comment;

		} );
		return {
			reviewId: typeof data.reviewId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test( data.reviewId ) ? data.reviewId : newId(),
			reviewer: cleanText( data.reviewer, REVIEW_LIMITS.name ),
			comments,
			savedAt: Number.isFinite( data.savedAt ) ? data.savedAt : null,
			exportedAt: Number.isFinite( data.exportedAt ) ? data.exportedAt : null
		};

	} catch ( error ) {

		return null;

	}

}

function writeDraft( manifest, { reviewId, reviewer, comments, exportedAt = null } ) {

	try {

		localStorage.setItem( draftKey( manifest ), JSON.stringify( { contentHash: manifest.contentHash, reviewId, reviewer, comments, savedAt: Date.now(), exportedAt } ) );
		return true;

	} catch ( error ) {

		return false; // sem armazenamento local (modo privado, cota): a exportação continua disponível

	}

}

function clearDraft( manifest ) {

	try {

		localStorage.removeItem( draftKey( manifest ) );

	} catch ( error ) { /* nada a fazer */ }

}

function exportFeedback( manifest, { reviewId, reviewer, comments } ) {

	const feedback = buildFeedback( {
		reviewId,
		shareId: manifest.shareId,
		snapshotHash: manifest.contentHash,
		source: { projectId: manifest.source.projectId, revision: manifest.source.revision },
		projectTitle: manifest.title,
		reviewer,
		comments
	} );

	const blob = new Blob( [ JSON.stringify( feedback, null, 1 ) ], { type: 'application/json' } );
	const name = safeFileName( manifest.title, '.p3ds-feedback.json' );
	const link = document.createElement( 'a' );
	link.href = URL.createObjectURL( blob );
	link.download = name;
	document.body.appendChild( link );
	link.click();
	link.remove();
	setTimeout( () => URL.revokeObjectURL( link.href ), 4000 );
	return { feedback, name };

}

export { readDraft, writeDraft, clearDraft, exportFeedback };
