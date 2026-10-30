import { Command } from '../Command.js';

import { getPlan, hasPlan, setPlan } from '../SimpleMode.PlanData.js';

/**
 * EV-009 — altera a configuração da planta baixa (nível, corte, escala, folha, carimbo, cotas do usuário, ambientes).
 * Dados do projeto em scene.userData.project3ds.plan: reversível e salvo no histórico.
 * Ajustes seguidos no mesmo campo (ex.: digitar a altura de corte) viram um único passo.
 */
class SetPlanCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {Object|null} [plan=null] nova configuração completa
	 * @param {string} [name]
	 * @param {string} [attributeName] campo alterado (agrupa ajustes seguidos)
	 * @constructor
	 */
	constructor( editor, plan = null, name = 'Planta baixa', attributeName = '' ) {

		super( editor );

		this.type = 'SetPlanCommand';
		this.name = name;
		this.updatable = attributeName !== '';
		this.object = editor.scene;
		this.attributeName = attributeName;

		this.oldPlan = plan !== null ? ( hasPlan( editor.scene ) ? getPlan( editor.scene ) : null ) : null;
		this.newPlan = plan !== null ? JSON.parse( JSON.stringify( plan ) ) : null;

	}

	apply( plan ) {

		setPlan( this.editor.scene, plan );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newPlan );

	}

	undo() {

		this.apply( this.oldPlan );

	}

	update( command ) {

		this.newPlan = JSON.parse( JSON.stringify( command.newPlan ) );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.oldPlan = this.oldPlan;
		output.newPlan = this.newPlan;
		output.attributeName = this.attributeName;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.oldPlan = json.oldPlan;
		this.newPlan = json.newPlan;
		this.attributeName = json.attributeName || '';
		this.updatable = this.attributeName !== '';
		this.object = this.editor.scene;

	}

}

export { SetPlanCommand };
