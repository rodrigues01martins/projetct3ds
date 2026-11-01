import { Command } from '../Command.js';

import { preservedLocal, snapshotLocal, applyLocal } from '../SimpleMode.AssemblyData.js';

/**
 * EV-014 — move um objeto para outro pai PRESERVANDO a transformação mundial (adicionar ao conjunto / remover do
 * conjunto). Diferente do MoveObjectCommand original, que só troca o pai. Um passo de Desfazer.
 */
class SetAssemblyMembershipCommand extends Command {

	constructor( editor, object = null, newParent = null, newIndex = undefined, name = 'Alterar conjunto' ) {

		super( editor );

		this.type = 'SetAssemblyMembershipCommand';
		this.name = name;
		this.object = object;
		this.newParent = newParent;
		this.newIndex = newIndex;
		this.oldParent = object !== null ? object.parent : null;
		this.oldIndex = object !== null && object.parent !== null ? object.parent.children.indexOf( object ) : 0;
		this.oldLocal = object !== null ? snapshotLocal( object ) : null;

	}

	execute() {

		this.newParent.updateWorldMatrix( true, false );
		const local = preservedLocal( this.object, this.newParent.matrixWorld );
		if ( local === null ) throw new Error( 'Transformação não preservável (cisalhamento).' );
		this.object.removeFromParent();
		this.object.position.copy( local.position );
		this.object.quaternion.copy( local.quaternion );
		this.object.scale.copy( local.scale );
		const index = this.newIndex === undefined ? this.newParent.children.length : Math.min( this.newIndex, this.newParent.children.length );
		this.newParent.children.splice( index, 0, this.object );
		this.object.parent = this.newParent;
		this.object.updateMatrixWorld( true );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	undo() {

		this.object.removeFromParent();
		applyLocal( this.object, this.oldLocal );
		this.oldParent.children.splice( Math.min( this.oldIndex, this.oldParent.children.length ), 0, this.object );
		this.object.parent = this.oldParent;
		this.object.updateMatrixWorld( true );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuid = this.object.uuid;
		output.newParentUuid = this.newParent.uuid;
		output.newIndex = this.newIndex;
		output.oldParentUuid = this.oldParent.uuid;
		output.oldIndex = this.oldIndex;
		output.oldLocal = this.oldLocal;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.object = this.editor.objectByUuid( json.objectUuid );
		this.newParent = this.editor.objectByUuid( json.newParentUuid ) || this.editor.scene;
		this.newIndex = json.newIndex;
		this.oldParent = this.editor.objectByUuid( json.oldParentUuid ) || this.editor.scene;
		this.oldIndex = json.oldIndex;
		this.oldLocal = json.oldLocal;

	}

}

export { SetAssemblyMembershipCommand };
