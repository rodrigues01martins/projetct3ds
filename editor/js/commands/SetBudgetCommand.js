import { Command } from '../Command.js';

import { getBudget, hasBudget, setBudget } from '../SimpleMode.BudgetData.js';

/**
 * EV-010 — altera o orçamento (itens, preços, perdas, coeficientes, adicionais, notas).
 * Dados do projeto em scene.userData.project3ds.budget: reversível e salvo no histórico.
 * Uma edição confirmada = um passo; confirmações seguidas no mesmo campo (attributeName) em até 0,5 s se fundem.
 * Recálculos de quantidades NÃO passam por aqui (são derivados da geometria a cada leitura).
 */
class SetBudgetCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {Object|null} [budget=null] novo orçamento completo
	 * @param {string} [name]
	 * @param {string} [attributeName] campo alterado (agrupa ajustes seguidos)
	 * @constructor
	 */
	constructor( editor, budget = null, name = 'Orçamento', attributeName = '' ) {

		super( editor );

		this.type = 'SetBudgetCommand';
		this.name = name;
		this.updatable = attributeName !== '';
		this.object = editor.scene;
		this.attributeName = attributeName;

		this.oldBudget = budget !== null ? ( hasBudget( editor.scene ) ? getBudget( editor.scene ) : null ) : null;
		this.newBudget = budget !== null ? JSON.parse( JSON.stringify( budget ) ) : null;

	}

	apply( budget ) {

		setBudget( this.editor.scene, budget );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newBudget );

	}

	undo() {

		this.apply( this.oldBudget );

	}

	update( command ) {

		this.newBudget = JSON.parse( JSON.stringify( command.newBudget ) );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.oldBudget = this.oldBudget;
		output.newBudget = this.newBudget;
		output.attributeName = this.attributeName;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.oldBudget = json.oldBudget;
		this.newBudget = json.newBudget;
		this.attributeName = json.attributeName || '';
		this.updatable = this.attributeName !== '';
		this.object = this.editor.scene;

	}

}

export { SetBudgetCommand };
