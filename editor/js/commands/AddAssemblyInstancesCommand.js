import * as THREE from 'three';

import { Command } from '../Command.js';

import { setMeta } from '../SimpleMode.ComponentFactory.js';
import { createAssemblyMeta, preservedLocal, snapshotLocal, applyLocal } from '../SimpleMode.AssemblyData.js';

/**
 * EV-014 — insere várias instâncias numa única operação (repetição em linha, matriz, conjunto da biblioteca).
 * Opcionalmente agrupa o resultado num conjunto novo, que pode incluir o objeto original (movido preservando a
 * transformação mundial). Um único Desfazer remove todas as instâncias criadas e restaura o original.
 */
class AddAssemblyInstancesCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D[]} [objects=[]] novas instâncias (transformações no espaço de `parent`)
	 * @param {Object} [options] { parent, group: { name, category } | null, original: Object3D | null, name }
	 */
	constructor( editor, objects = [], options = {} ) {

		super( editor );

		this.type = 'AddAssemblyInstancesCommand';
		this.name = options.name || `Inserir ${objects.length} instância(s)`;
		this.objects = objects.slice();
		this.parent = options.parent || editor.scene;
		this.original = options.original || null;
		this.originalState = this.original !== null ? { parent: this.original.parent, index: this.original.parent.children.indexOf( this.original ), local: snapshotLocal( this.original ) } : null;
		this.group = null;

		if ( options.group ) {

			const group = new THREE.Group();
			const meta = createAssemblyMeta( options.group );
			group.name = meta.name;
			setMeta( group, { assembly: meta } );
			if ( options.group.uuid ) group.uuid = options.group.uuid;
			this.group = group;

		}

	}

	execute() {

		const target = this.group !== null ? this.group : this.parent;

		if ( this.group !== null ) {

			const index = this.original !== null && this.original.parent === this.parent ? this.parent.children.indexOf( this.original ) : this.parent.children.length;
			this.parent.children.splice( index, 0, this.group );
			this.group.parent = this.parent;
			this.group.updateMatrixWorld( true );

			if ( this.original !== null ) {

				const local = preservedLocal( this.original, this.group.matrixWorld );
				if ( local === null ) throw new Error( 'Transformação não preservável (cisalhamento).' );
				this.original.removeFromParent();
				this.original.position.copy( local.position );
				this.original.quaternion.copy( local.quaternion );
				this.original.scale.copy( local.scale );
				this.group.add( this.original );

			}

		}

		for ( const object of this.objects ) this.editor.addObject( object, target, target.children.length );
		target.updateMatrixWorld( true );

		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.select( this.group !== null ? this.group : ( this.objects[ this.objects.length - 1 ] || null ) );

	}

	undo() {

		for ( const object of this.objects ) this.editor.removeObject( object );

		if ( this.original !== null ) {

			const state = this.originalState;
			this.original.removeFromParent();
			applyLocal( this.original, state.local );
			state.parent.children.splice( Math.min( state.index, state.parent.children.length ), 0, this.original );
			this.original.parent = state.parent;

		}

		if ( this.group !== null ) this.group.removeFromParent();

		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.select( this.original );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.parentUuid = this.parent.uuid;
		output.objects = this.objects.map( ( object ) => object.toJSON() );
		output.group = this.group !== null ? { uuid: this.group.uuid, name: this.group.name, userData: JSON.parse( JSON.stringify( this.group.userData ) ) } : null;
		output.originalUuid = this.original !== null ? this.original.uuid : null;
		output.originalState = this.originalState !== null ? { parentUuid: this.originalState.parent.uuid, index: this.originalState.index, local: this.originalState.local } : null;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.parent = this.editor.objectByUuid( json.parentUuid ) || this.editor.scene;
		const loader = new THREE.ObjectLoader();
		this.objects = json.objects.map( ( data ) => this.editor.objectByUuid( data.object.uuid ) || loader.parse( data ) );
		if ( json.group !== null ) {

			const group = this.editor.objectByUuid( json.group.uuid ) || new THREE.Group();
			group.uuid = json.group.uuid;
			group.name = json.group.name;
			group.userData = json.group.userData;
			this.group = group;

		}

		this.original = json.originalUuid !== null ? this.editor.objectByUuid( json.originalUuid ) || null : null;
		this.originalState = json.originalState !== null && this.original !== null ? { parent: this.editor.objectByUuid( json.originalState.parentUuid ) || this.editor.scene, index: json.originalState.index, local: json.originalState.local } : null;

	}

}

export { AddAssemblyInstancesCommand };
