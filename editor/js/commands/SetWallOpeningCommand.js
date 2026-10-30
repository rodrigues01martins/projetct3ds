import { Command } from '../Command.js';

import { getOpenings, setOpenings, rebuildWall } from '../SimpleMode.Openings.js';

/**
 * EV-007 — altera uma abertura (largura, altura, posição ao longo da parede, peitoril).
 * Vão, componente hospedado e parede são atualizados juntos (a porta/janela nunca fica separada do vão):
 * o registro muda e rebuildWall() regenera a parede e sincroniza o componente (medidas e posição).
 * Ajustes seguidos na mesma abertura viram um único passo de histórico.
 */
class SetWallOpeningCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [wall=null]
	 * @param {string|null} [openingId=null]
	 * @param {Object|null} [changes=null] { centerX?, bottomY?, width?, height? }
	 * @constructor
	 */
	constructor( editor, wall = null, openingId = null, changes = null ) {

		super( editor );

		this.type = 'SetWallOpeningCommand';
		this.name = 'Alterar abertura';
		this.updatable = true;

		this.object = wall; // History funde ajustes seguidos do mesmo objeto + atributo
		this.wall = wall;
		this.openingId = openingId;
		this.attributeName = openingId;
		this.oldOpening = null;
		this.newOpening = null;

		if ( wall !== null && openingId !== null && changes !== null ) {

			const opening = getOpenings( wall ).find( ( item ) => item.id === openingId );
			this.oldOpening = Object.assign( {}, opening );
			this.newOpening = Object.assign( {}, opening, changes );

		}

	}

	apply( opening ) {

		setOpenings( this.wall, getOpenings( this.wall ).map( ( item ) => ( item.id === opening.id ? Object.assign( {}, opening ) : item ) ) );
		rebuildWall( this.editor, this.wall );

	}

	execute() {

		this.apply( this.newOpening );

	}

	undo() {

		this.apply( this.oldOpening );

	}

	update( cmd ) {

		this.newOpening = Object.assign( {}, cmd.newOpening );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.wallUuid = this.wall.uuid;
		output.openingId = this.openingId;
		output.oldOpening = this.oldOpening;
		output.newOpening = this.newOpening;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.wall = this.editor.objectByUuid( json.wallUuid );
		this.object = this.wall;
		this.openingId = json.openingId;
		this.attributeName = json.openingId;
		this.oldOpening = Object.assign( {}, json.oldOpening );
		this.newOpening = Object.assign( {}, json.newOpening );

	}

}

export { SetWallOpeningCommand };
