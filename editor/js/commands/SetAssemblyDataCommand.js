import { Command } from '../Command.js';

import { getMeta } from '../SimpleMode.ComponentFactory.js';

/**
 * EV-014 — altera um bloco de metadados de montagem de um objeto (userData.project3ds.connectors ou .assembly):
 * conectores personalizados, nome/categoria do conjunto. Dados auxiliares: nenhuma geometria é tocada.
 * value === null remove o bloco. Reversível (Desfazer/Refazer) e salvo com o projeto.
 */
class SetAssemblyDataCommand extends Command {

	constructor( editor, object = null, key = 'connectors', value = null, name = 'Alterar conectores' ) {

		super( editor );

		this.type = 'SetAssemblyDataCommand';
		this.name = name;
		this.object = object;
		this.key = key;
		const meta = object !== null ? getMeta( object ) : null;
		this.oldValue = meta !== null && meta[ key ] !== undefined ? JSON.parse( JSON.stringify( meta[ key ] ) ) : null;
		this.newValue = value !== null ? JSON.parse( JSON.stringify( value ) ) : null;

	}

	apply( value ) {

		const meta = Object.assign( {}, this.object.userData.project3ds );
		if ( value === null ) delete meta[ this.key ];
		else meta[ this.key ] = JSON.parse( JSON.stringify( value ) );
		if ( Object.keys( meta ).length > 0 ) this.object.userData.project3ds = meta;
		else delete this.object.userData.project3ds;
		this.editor.signals.objectChanged.dispatch( this.object );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newValue );

	}

	undo() {

		this.apply( this.oldValue );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuid = this.object.uuid;
		output.key = this.key;
		output.oldValue = this.oldValue;
		output.newValue = this.newValue;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.object = this.editor.objectByUuid( json.objectUuid );
		this.key = json.key;
		this.oldValue = json.oldValue;
		this.newValue = json.newValue;

	}

}

export { SetAssemblyDataCommand };
