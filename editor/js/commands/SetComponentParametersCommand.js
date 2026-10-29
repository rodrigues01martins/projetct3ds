import { Command } from '../Command.js';

import { getDefinition } from '../SimpleMode.Components.js';
import { regenerateComponent } from '../SimpleMode.ComponentFactory.js';

/**
 * EV-003 — altera os parâmetros de um componente paramétrico (ex.: largura da mesa) e regenera suas peças.
 *
 * A regeneração é determinística a partir dos parâmetros, então o comando guarda apenas os parâmetros
 * antigos e novos (dados simples). O grupo do componente é preservado (UUID, nome, transformação,
 * seleção); as peças existentes também, recebendo novas geometrias.
 */
class SetComponentParametersCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [object=null] grupo do componente
	 * @param {Object|null} [newParameters=null]
	 * @param {Object|null} [oldParameters=null] padrão: os parâmetros atuais do objeto
	 * @constructor
	 */
	constructor( editor, object = null, newParameters = null, oldParameters = null ) {

		super( editor );

		this.type = 'SetComponentParametersCommand';
		this.name = 'Alterar componente';
		this.updatable = true;

		this.object = object;
		this.componentId = null;
		this.oldParameters = null;
		this.newParameters = null;

		if ( object !== null && newParameters !== null ) {

			const data = object.userData.project3ds.component;

			this.componentId = data.id;
			this.oldParameters = Object.assign( {}, oldParameters !== null ? oldParameters : data.parameters );
			this.newParameters = Object.assign( {}, newParameters );
			this.name = 'Alterar componente: ' + object.name;

		}

	}

	apply( parameters ) {

		const editor = this.editor;
		const definition = getDefinition( this.componentId );

		regenerateComponent( this.object, definition, parameters, {

			editor,

			addPart( mesh, group, index ) {

				editor.addObject( mesh, group, index );

			},

			removePart( mesh ) {

				editor.removeObject( mesh );
				mesh.geometry.dispose();

			},

			replaceGeometry( mesh, geometry ) {

				const old = mesh.geometry;
				mesh.geometry = geometry;
				editor.addGeometry( geometry );

				// descarta a geometria antiga só se nenhum outro objeto da cena a utiliza
				let shared = false;
				editor.scene.traverse( ( child ) => {

					if ( child !== mesh && child.geometry === old ) shared = true;

				} );

				if ( shared === false ) {

					delete editor.geometries[ old.uuid ];
					old.dispose();

				}

			}

		} );

		this.object.updateMatrixWorld( true );

		// o Viewport ajusta a caixa de seleção ao objeto recebido: só quando é o selecionado
		if ( editor.selected === this.object ) editor.signals.geometryChanged.dispatch( this.object );
		editor.signals.objectChanged.dispatch( this.object );
		editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newParameters );

	}

	undo() {

		this.apply( this.oldParameters );

	}

	update( cmd ) {

		this.newParameters = Object.assign( {}, cmd.newParameters );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.objectUuid = this.object.uuid;
		output.componentId = this.componentId;
		output.oldParameters = this.oldParameters;
		output.newParameters = this.newParameters;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.object = this.editor.objectByUuid( json.objectUuid );
		this.componentId = json.componentId;
		this.oldParameters = Object.assign( {}, json.oldParameters );
		this.newParameters = Object.assign( {}, json.newParameters );

	}

}

export { SetComponentParametersCommand };
