import { Command } from '../Command.js';

import { applyPart, getPartMeta } from '../SimpleMode.Appearance.js';

/**
 * EV-004 — aplica, ajusta ou remove o acabamento de uma parte lógica (ex.: "Tampo" da mesa, "main" de um cubo).
 *
 * Afeta todas as malhas da parte, somente na instância indicada, como uma única ação de Desfazer.
 * Guarda apenas dados (especificações antigas e novas), então é serializável no histórico do projeto.
 * A geometria nunca é alterada.
 */
class SetAppearanceCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [object=null] dono da aparência (componente, malha ou grupo)
	 * @param {string} [partKey='']
	 * @param {Object|null} [newPart=null] especificação (null = restaurar acabamento original)
	 * @constructor
	 */
	constructor( editor, object = null, partKey = '', newPart = null ) {

		super( editor );

		this.type = 'SetAppearanceCommand';
		this.name = 'Alterar acabamento';
		this.updatable = true;

		this.object = object;
		this.attributeName = partKey; // ajustes seguidos na mesma parte viram um único passo (History)
		this.partKey = partKey;
		this.oldPart = object !== null ? getPartMeta( object, partKey ) : null;
		this.newPart = newPart !== null ? JSON.parse( JSON.stringify( newPart ) ) : null;
		this.textureSkipped = false;

		if ( object !== null ) this.name = ( newPart === null ? 'Restaurar acabamento: ' : 'Alterar acabamento: ' ) + object.name;

	}

	apply( part ) {

		const result = applyPart( this.object, this.partKey, part, this.editor );
		this.textureSkipped = result.textureSkipped;

		this.editor.signals.materialChanged.dispatch( this.object );

	}

	execute() {

		this.apply( this.newPart );

	}

	undo() {

		this.apply( this.oldPart );

	}

	update( cmd ) {

		this.newPart = cmd.newPart !== null ? JSON.parse( JSON.stringify( cmd.newPart ) ) : null;

	}

	toJSON() {

		const output = super.toJSON( this );

		output.objectUuid = this.object.uuid;
		output.partKey = this.partKey;
		output.oldPart = this.oldPart;
		output.newPart = this.newPart;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.object = this.editor.objectByUuid( json.objectUuid );
		this.partKey = json.partKey;
		this.attributeName = json.partKey;
		this.oldPart = json.oldPart;
		this.newPart = json.newPart;

	}

}

export { SetAppearanceCommand };
