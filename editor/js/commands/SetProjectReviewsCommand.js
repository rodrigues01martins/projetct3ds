import { Command } from '../Command.js';

import { getReviews, hasReviews, setReviews } from '../SimpleMode.ReviewData.js';

/**
 * EV-012 — altera as revisões do projeto (comentários importados, situação, respostas, exclusões).
 * Dados em scene.userData.project3ds.reviews: reversíveis (Desfazer/Refazer) e salvos com o projeto pela EV-011.
 * Navegar até um comentário ou mover a câmera NUNCA passa por aqui (não cria passo no histórico).
 * Nenhuma geometria é tocada: a observação não modifica componentes.
 */
class SetProjectReviewsCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {Object|null} [reviews=null] novo conjunto completo de revisões
	 * @param {string} [name]
	 * @constructor
	 */
	constructor( editor, reviews = null, name = 'Revisões do projeto' ) {

		super( editor );

		this.type = 'SetProjectReviewsCommand';
		this.name = name;
		this.updatable = false;
		this.object = editor.scene;

		this.oldReviews = reviews !== null ? ( hasReviews( editor.scene ) ? getReviews( editor.scene ) : null ) : null;
		this.newReviews = reviews !== null ? JSON.parse( JSON.stringify( reviews ) ) : null;

	}

	apply( reviews ) {

		setReviews( this.editor.scene, reviews );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newReviews );

	}

	undo() {

		this.apply( this.oldReviews );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.oldReviews = this.oldReviews;
		output.newReviews = this.newReviews;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.oldReviews = json.oldReviews;
		this.newReviews = json.newReviews;
		this.object = this.editor.scene;

	}

}

export { SetProjectReviewsCommand };
