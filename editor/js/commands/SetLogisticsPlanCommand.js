import { Command } from '../Command.js';

import { getPlan, hasPlan, setPlan, newId } from '../SimpleMode.LogisticsData.js';

/**
 * EV-016 — altera o plano logístico do projeto (scene.userData.project3ds.logistics): etapas, kits, alocações,
 * cargas, conferências, ocorrências, base do plano. Uma operação lógica = um passo de Desfazer/Refazer.
 * Nenhuma geometria, material, orçamento ou ficha técnica é tocada.
 *
 * Relação com o histórico operacional: os EVENTOS do plano nunca são apagados por Desfazer/Refazer. Desfazer
 * restaura os dados anteriores, mas mantém todos os eventos já registrados e acrescenta um evento "desfeito";
 * Refazer acrescenta um evento "refeito". O histórico operacional é, portanto, só de acréscimo.
 */
class SetLogisticsPlanCommand extends Command {

	constructor( editor, plan = null, name = 'Planejamento logístico' ) {

		super( editor );

		this.type = 'SetLogisticsPlanCommand';
		this.name = name;
		this.updatable = false;
		this.object = editor.scene;
		this.oldPlan = editor.scene !== undefined && hasPlan( editor.scene ) ? getPlan( editor.scene ) : null;
		this.newPlan = plan !== null ? JSON.parse( JSON.stringify( plan ) ) : null;
		this.executed = false;

	}

	// eventos atuais + marcador (Desfazer/Refazer não removem eventos)
	withEvents( plan, kind ) {

		if ( plan === null ) return null;
		const current = hasPlan( this.editor.scene ) ? getPlan( this.editor.scene ).events : [];
		const merged = new Map( plan.events.map( ( e ) => [ e.id, e ] ) );
		for ( const e of current ) if ( merged.has( e.id ) === false ) merged.set( e.id, e );
		const events = [ ...merged.values() ].sort( ( a, b ) => a.at.localeCompare( b.at ) );
		if ( kind !== null ) events.push( { id: newId( 'event' ), at: new Date().toISOString(), type: kind, ref: '', from: null, to: this.name, responsible: '', note: kind === 'undo' ? `Desfeito: ${this.name}` : `Refeito: ${this.name}` } );
		return Object.assign( {}, plan, { events } );

	}

	apply( plan ) {

		setPlan( this.editor.scene, plan );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.withEvents( this.newPlan, this.executed ? 'redo' : null ) );
		this.executed = true;

	}

	undo() {

		// sem plano anterior: o plano sai do projeto (criação desfeita); os eventos ficam no comando para o Refazer
		this.apply( this.oldPlan === null ? null : this.withEvents( this.oldPlan, 'undo' ) );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.oldPlan = this.oldPlan;
		output.newPlan = this.newPlan;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.oldPlan = json.oldPlan;
		this.newPlan = json.newPlan;
		this.object = this.editor.scene;
		this.executed = true;

	}

}

export { SetLogisticsPlanCommand };
