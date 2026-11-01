import { Command } from '../Command.js';

import { preservedLocal, snapshotLocal, applyLocal } from '../SimpleMode.AssemblyData.js';

/**
 * EV-014 — desagrupa um conjunto: os componentes voltam ao pai do conjunto (na posição dele, mesma ordem), com a
 * matriz local recalculada a partir da MUNDIAL. UUIDs, materiais, parâmetros e vínculos de portas/janelas intactos.
 * Um único passo de Desfazer. O chamador confere antes que nada gera cisalhamento.
 */
class UngroupAssemblyCommand extends Command {

	constructor( editor, group = null ) {

		super( editor );

		this.type = 'UngroupAssemblyCommand';
		this.name = 'Desagrupar' + ( group !== null && group.name ? ': ' + group.name : '' );
		this.group = group;
		this.parent = group !== null ? group.parent : null;
		this.index = group !== null && group.parent !== null ? group.parent.children.indexOf( group ) : 0;
		this.records = group !== null ? group.children.map( ( object ) => ( { object, local: snapshotLocal( object ) } ) ) : [];

	}

	execute() {

		const parent = this.parent;
		this.parent.updateWorldMatrix( true, false );
		this.group.updateMatrixWorld( true );
		const locals = this.records.map( ( { object } ) => preservedLocal( object, parent.matrixWorld ) );
		if ( locals.some( ( l ) => l === null ) ) throw new Error( 'Transformação não preservável (cisalhamento).' );

		this.records.forEach( ( { object }, i ) => {

			object.removeFromParent();
			object.position.copy( locals[ i ].position );
			object.quaternion.copy( locals[ i ].quaternion );
			object.scale.copy( locals[ i ].scale );

		} );

		const at = parent.children.indexOf( this.group );
		this.group.removeFromParent();
		this.records.forEach( ( { object }, i ) => {

			parent.children.splice( Math.min( at + i, parent.children.length ), 0, object );
			object.parent = parent;
			object.updateMatrixWorld( true );

		} );

		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.select( this.records.length > 0 ? this.records[ 0 ].object : null );

	}

	undo() {

		const parent = this.parent;
		for ( const { object } of this.records ) object.removeFromParent();
		parent.children.splice( Math.min( this.index, parent.children.length ), 0, this.group );
		this.group.parent = parent;
		for ( const { object, local } of this.records ) {

			applyLocal( object, local );
			this.group.add( object );

		}

		this.group.updateMatrixWorld( true );
		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.select( this.group );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.groupUuid = this.group.uuid;
		output.parentUuid = this.parent.uuid;
		output.index = this.index;
		output.records = this.records.map( ( r ) => ( { uuid: r.object.uuid, local: r.local } ) );
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.group = this.editor.objectByUuid( json.groupUuid );
		this.parent = this.editor.objectByUuid( json.parentUuid ) || this.editor.scene;
		this.index = json.index;
		this.records = json.records.map( ( r ) => ( { object: this.editor.objectByUuid( r.uuid ), local: r.local } ) ).filter( ( r ) => r.object !== undefined );

	}

}

export { UngroupAssemblyCommand };
