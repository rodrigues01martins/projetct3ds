import { Command } from '../Command.js';

import { getOpenings, setOpenings, createFixture, getWallParameters, rebuildWall } from '../SimpleMode.Openings.js';
import { getComponentData } from '../SimpleMode.ComponentFactory.js';

/**
 * EV-007 — insere uma porta/janela numa parede: registra a abertura, cria o componente hospedado
 * (filho da parede, pela fábrica da EV-003) e reconstrói a parede com o vão real. Uma única ação de Desfazer.
 *
 * Guarda apenas dados (abertura, tipo, nome, UUID e parâmetros do componente), então pode ser
 * reconstruído a partir do histórico salvo no projeto.
 */
class AddWallOpeningCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [wall=null]
	 * @param {Object|null} [opening=null] { id, type, centerX, bottomY, width, height, fixtureUuid }
	 * @param {string} [fixtureName='']
	 * @constructor
	 */
	constructor( editor, wall = null, opening = null, fixtureName = '' ) {

		super( editor );

		this.type = 'AddWallOpeningCommand';
		this.name = 'Inserir abertura';

		this.wall = wall;
		this.opening = opening !== null ? Object.assign( {}, opening ) : null;
		this.fixtureName = fixtureName;
		this.fixture = null; // instância em memória (preserva materiais e UUID entre desfazer/refazer)
		this.fixtureParameters = null;

		if ( opening !== null ) this.name = ( opening.type === 'door' ? 'Inserir porta: ' : 'Inserir janela: ' ) + fixtureName;

	}

	execute() {

		const editor = this.editor;
		const wall = this.wall;

		if ( this.fixture === null ) {

			this.fixture = createFixture( this.opening.type, this.opening, getWallParameters( wall ).thickness, {
				uuid: this.opening.fixtureUuid,
				name: this.fixtureName,
				parameters: this.fixtureParameters !== null ? this.fixtureParameters : undefined
			} );

		}

		this.fixtureParameters = Object.assign( {}, getComponentData( this.fixture ).parameters );

		setOpenings( wall, getOpenings( wall ).concat( [ this.opening ] ) );
		editor.addObject( this.fixture, wall, wall.children.length );
		rebuildWall( editor, wall );

	}

	undo() {

		const editor = this.editor;

		if ( editor.selected === this.fixture ) editor.deselect();

		editor.removeObject( this.fixture );
		setOpenings( this.wall, getOpenings( this.wall ).filter( ( opening ) => opening.id !== this.opening.id ) );
		rebuildWall( editor, this.wall );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.wallUuid = this.wall.uuid;
		output.opening = this.opening;
		output.fixtureName = this.fixtureName;
		output.fixtureParameters = this.fixtureParameters;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.wall = this.editor.objectByUuid( json.wallUuid );
		this.opening = Object.assign( {}, json.opening );
		this.fixtureName = json.fixtureName;
		this.fixtureParameters = json.fixtureParameters;
		this.fixture = this.editor.objectByUuid( json.opening.fixtureUuid ) || null; // recriado no refazer, se necessário

	}

}

export { AddWallOpeningCommand };
