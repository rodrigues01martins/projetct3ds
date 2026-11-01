import * as THREE from 'three';

import { Command } from '../Command.js';

import { setMeta } from '../SimpleMode.ComponentFactory.js';
import { createAssemblyMeta, preservedLocal, snapshotLocal, applyLocal } from '../SimpleMode.AssemblyData.js';

/**
 * EV-014 — cria um conjunto modular: um THREE.Group novo recebe os objetos, cada um com a matriz local recalculada a
 * partir da matriz MUNDIAL (posição, rotação e escala visuais idênticas; UUIDs, materiais e vínculos intactos).
 * A troca de pai e o ajuste das transformações acontecem juntos (um único passo de Desfazer). O chamador deve
 * conferir antes (checkPreservable) que nenhuma transformação gera cisalhamento.
 */
class CreateAssemblyCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D[]} [objects=[]] objetos com o mesmo pai
	 * @param {Object} [options] { name, category, uuid, id }
	 * @constructor
	 */
	constructor( editor, objects = [], options = {} ) {

		super( editor );

		this.type = 'CreateAssemblyCommand';
		this.name = 'Criar conjunto';

		this.objects = objects.slice();
		this.options = Object.assign( {}, options );
		this.group = null;
		this.records = [];
		this.parent = null;
		this.index = 0;

		if ( this.objects.length > 0 ) this.prepare();

	}

	prepare() {

		const parent = this.objects[ 0 ].parent;
		this.parent = parent;
		// ordem original preservada (posição de cada objeto no pai)
		this.objects.sort( ( a, b ) => parent.children.indexOf( a ) - parent.children.indexOf( b ) );
		this.index = parent.children.indexOf( this.objects[ 0 ] );
		this.records = this.objects.map( ( object ) => ( { object, index: parent.children.indexOf( object ), local: snapshotLocal( object ) } ) );

		const group = new THREE.Group();
		if ( this.options.uuid ) group.uuid = this.options.uuid;
		const meta = createAssemblyMeta( this.options );
		group.name = meta.name;
		setMeta( group, { assembly: meta } );

		// origem do conjunto: centro da base dos componentes (no espaço do pai)
		const box = new THREE.Box3();
		for ( const object of this.objects ) box.union( new THREE.Box3().setFromObject( object, true ) );
		if ( box.isEmpty() === false ) {

			const base = new THREE.Vector3( ( box.min.x + box.max.x ) / 2, box.min.y, ( box.min.z + box.max.z ) / 2 );
			parent.updateWorldMatrix( true, false );
			group.position.copy( parent.worldToLocal( base ) );

		}

		this.group = group;
		this.name = 'Criar conjunto: ' + meta.name;

	}

	execute() {

		const group = this.group;
		const parent = this.parent;

		parent.children.splice( Math.min( this.index, parent.children.length ), 0, group );
		group.parent = parent;
		group.updateMatrixWorld( true );

		for ( const { object } of this.records ) {

			const local = preservedLocal( object, group.matrixWorld );
			if ( local === null ) throw new Error( 'Transformação não preservável (cisalhamento).' );
			object.removeFromParent();
			object.position.copy( local.position );
			object.quaternion.copy( local.quaternion );
			object.scale.copy( local.scale );
			group.add( object );
			object.updateMatrixWorld( true );

		}

		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.select( group );

	}

	undo() {

		const parent = this.parent;
		this.editor.deselect(); // o grupo sai da cena: os controles de transformação não podem ficar presos a ele

		for ( const { object } of this.records ) object.removeFromParent();
		this.group.removeFromParent();

		// volta aos índices e transformações originais (ordem crescente de índice)
		for ( const { object, index, local } of this.records ) {

			parent.children.splice( Math.min( index, parent.children.length ), 0, object );
			object.parent = parent;
			applyLocal( object, local );
			object.updateMatrixWorld( true );

		}

		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.select( this.objects[ 0 ] || null );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.parentUuid = this.parent.uuid;
		output.index = this.index;
		output.records = this.records.map( ( r ) => ( { uuid: r.object.uuid, index: r.index, local: r.local } ) );
		output.group = { uuid: this.group.uuid, name: this.group.name, position: this.group.position.toArray(), userData: JSON.parse( JSON.stringify( this.group.userData ) ) };
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.parent = this.editor.objectByUuid( json.parentUuid ) || this.editor.scene;
		this.index = json.index;
		this.records = json.records.map( ( r ) => ( { object: this.editor.objectByUuid( r.uuid ), index: r.index, local: r.local } ) ).filter( ( r ) => r.object !== undefined );
		this.objects = this.records.map( ( r ) => r.object );
		const group = new THREE.Group();
		group.uuid = json.group.uuid;
		group.name = json.group.name;
		group.position.fromArray( json.group.position );
		group.userData = json.group.userData;
		this.group = group;

	}

}

export { CreateAssemblyCommand };
