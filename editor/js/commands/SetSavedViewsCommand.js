import { Command } from '../Command.js';

import { getSavedViews, setSavedViews } from '../SimpleMode.SavedViews.js';

/**
 * EV-008 — altera a lista "Minhas vistas" (salvar, renomear, excluir, reordenar).
 * As vistas são dados do projeto (scene.userData.project3ds.savedViews): a alteração é reversível e entra no
 * histórico. Mover a câmera ou ir até uma vista NÃO passa por aqui (não é edição do projeto).
 */
class SetSavedViewsCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {Array<Object>|null} [views=null] nova lista completa
	 * @param {string} [name]
	 * @constructor
	 */
	constructor( editor, views = null, name = 'Minhas vistas' ) {

		super( editor );

		this.type = 'SetSavedViewsCommand';
		this.name = name;

		this.oldViews = views !== null ? getSavedViews( editor.scene ) : null;
		this.newViews = views !== null ? views.map( ( view ) => Object.assign( {}, view ) ) : null;

	}

	apply( views ) {

		setSavedViews( this.editor.scene, views );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newViews );

	}

	undo() {

		this.apply( this.oldViews );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.oldViews = this.oldViews;
		output.newViews = this.newViews;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.oldViews = json.oldViews;
		this.newViews = json.newViews;

	}

}

export { SetSavedViewsCommand };
