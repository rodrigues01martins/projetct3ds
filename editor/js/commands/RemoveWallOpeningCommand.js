import { Command } from '../Command.js';
import { ObjectLoader } from 'three';

import { getOpenings, setOpenings, findFixture, placeFixture, rebuildWall } from '../SimpleMode.Openings.js';
import { setMeta } from '../SimpleMode.ComponentFactory.js';

/**
 * EV-007 — remove uma abertura: retira a porta/janela, apaga o registro e fecha o vão (parede reconstruída).
 * Com { unlink: true } a porta/janela NÃO é apagada: passa a ser um componente independente na cena,
 * mantendo a posição no mundo (usado quando o vínculo ficou incoerente no Modo Avançado).
 * Uma única ação de Desfazer; as demais aberturas da parede não são tocadas.
 */
class RemoveWallOpeningCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [wall=null]
	 * @param {string|null} [openingId=null]
	 * @param {Object} [options={}] { unlink: boolean }
	 * @constructor
	 */
	constructor( editor, wall = null, openingId = null, options = {} ) {

		super( editor );

		this.type = 'RemoveWallOpeningCommand';
		this.name = options.unlink ? 'Desvincular abertura' : 'Remover abertura';

		this.wall = wall;
		this.unlink = options.unlink === true;
		this.opening = null;
		this.index = - 1;
		this.fixture = null;
		this.fixtureIndex = - 1;
		this.fixtureJSON = null;
		this.worldMatrix = null;

		if ( wall !== null && openingId !== null ) {

			const openings = getOpenings( wall );
			this.index = openings.findIndex( ( opening ) => opening.id === openingId );
			this.opening = openings[ this.index ];
			this.fixture = findFixture( wall, this.opening ); // pode ser null (vão sem componente)

			if ( this.fixture !== null ) {

				this.fixtureIndex = wall.children.indexOf( this.fixture );
				this.fixtureJSON = this.fixture.toJSON();

			}

		}

	}

	execute() {

		const editor = this.editor;
		const wall = this.wall;
		const fixture = this.fixture;

		if ( fixture !== null ) {

			if ( editor.selected === fixture && this.unlink === false ) editor.deselect();

			if ( this.unlink ) {

				// independente: mesma posição no mundo, na raiz da cena, sem metadados de hospedagem
				fixture.updateWorldMatrix( true, false );
				this.worldMatrix = fixture.matrixWorld.clone();
				editor.removeObject( fixture );
				this.worldMatrix.decompose( fixture.position, fixture.quaternion, fixture.scale );
				const meta = Object.assign( {}, fixture.userData.project3ds );
				delete meta.hosted;
				fixture.userData.project3ds = meta;
				editor.addObject( fixture );

			} else {

				editor.removeObject( fixture );

			}

		}

		setOpenings( wall, getOpenings( wall ).filter( ( opening ) => opening.id !== this.opening.id ) );
		rebuildWall( editor, wall );

	}

	undo() {

		const editor = this.editor;
		const wall = this.wall;

		if ( this.fixture === null && this.fixtureJSON !== null ) this.fixture = new ObjectLoader().parse( this.fixtureJSON );

		const openings = getOpenings( wall );
		openings.splice( Math.min( this.index, openings.length ), 0, this.opening );
		setOpenings( wall, openings );

		if ( this.fixture !== null ) {

			if ( this.unlink ) editor.removeObject( this.fixture );

			setMeta( this.fixture, { hosted: { openingId: this.opening.id, type: this.opening.type } } );
			placeFixture( this.fixture, this.opening );
			editor.addObject( this.fixture, wall, Math.min( this.fixtureIndex, wall.children.length ) );

		}

		rebuildWall( editor, wall );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.wallUuid = this.wall.uuid;
		output.unlink = this.unlink;
		output.opening = this.opening;
		output.index = this.index;
		output.fixtureIndex = this.fixtureIndex;
		output.fixtureJSON = this.fixtureJSON;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.wall = this.editor.objectByUuid( json.wallUuid );
		this.unlink = json.unlink === true;
		this.opening = Object.assign( {}, json.opening );
		this.index = json.index;
		this.fixtureIndex = json.fixtureIndex;
		this.fixtureJSON = json.fixtureJSON;
		this.fixture = json.opening.fixtureUuid ? ( this.editor.objectByUuid( json.opening.fixtureUuid ) || null ) : null;

	}

}

export { RemoveWallOpeningCommand };
