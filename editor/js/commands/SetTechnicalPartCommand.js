import { Command } from '../Command.js';

import { getSnapshot, hasSnapshot, setSnapshot, revisionKey, sanitizePart } from '../SimpleMode.TechnicalCatalogData.js';

/**
 * EV-015 — associa, troca, atualiza a revisão ou remove a ficha técnica de um ou mais componentes (raiz lógica).
 * Grava userData.project3ds.technicalPart (sem tocar component, importedAsset, assembly, connectors, openings ou
 * appearance) e acrescenta ao snapshot do projeto (scene.userData.project3ds.technicalCatalog) as revisões usadas,
 * para que o projeto continue autossuficiente fora deste navegador. Nenhuma geometria, material ou preço é alterado.
 * Um único passo de Desfazer/Refazer; salvo com o projeto (toJSON/fromJSON).
 */
class SetTechnicalPartCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D[]} [objects=[]]
	 * @param {Object|null} [link=null] { version, catalogId, catalogRevision, code } — null remove a associação
	 * @param {Object[]} [records=[]] revisões a preservar no snapshot do projeto
	 * @param {string} [name]
	 */
	constructor( editor, objects = [], link = null, records = [], name = 'Associar ficha técnica' ) {

		super( editor );

		this.type = 'SetTechnicalPartCommand';
		this.name = name;
		this.updatable = false;
		this.objects = objects;
		this.newLink = link !== null ? JSON.parse( JSON.stringify( link ) ) : null;
		this.oldLinks = objects.map( ( object ) => {

			const meta = object.userData.project3ds;
			return meta !== undefined && meta !== null && meta.technicalPart !== undefined ? JSON.parse( JSON.stringify( meta.technicalPart ) ) : null;

		} );
		this.oldSnapshot = editor.scene !== undefined && hasSnapshot( editor.scene ) ? getSnapshot( editor.scene ) : null;
		this.newSnapshot = null;

		if ( editor.scene !== undefined && objects.length > 0 ) {

			const snapshot = getSnapshot( editor.scene );
			for ( const record of records ) {

				const key = revisionKey( record.catalogId, record.revision );
				if ( snapshot.parts[ key ] === undefined ) snapshot.parts[ key ] = sanitizePart( record ); // a revisão já gravada no projeto nunca é substituída

			}

			this.newSnapshot = snapshot;

		}

	}

	setLink( object, link ) {

		const meta = Object.assign( {}, object.userData.project3ds );
		if ( link === null ) delete meta.technicalPart;
		else meta.technicalPart = JSON.parse( JSON.stringify( link ) );
		if ( Object.keys( meta ).length > 0 ) object.userData.project3ds = meta;
		else delete object.userData.project3ds;

	}

	apply( links, snapshot ) {

		this.objects.forEach( ( object, i ) => this.setLink( object, links[ i ] ) );
		if ( snapshot !== undefined ) setSnapshot( this.editor.scene, snapshot );
		for ( const object of this.objects ) this.editor.signals.objectChanged.dispatch( object );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.objects.map( () => this.newLink ), this.newSnapshot !== null ? this.newSnapshot : undefined );

	}

	undo() {

		this.apply( this.oldLinks, this.newSnapshot !== null ? this.oldSnapshot : undefined );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuids = this.objects.map( ( o ) => o.uuid );
		output.newLink = this.newLink;
		output.oldLinks = this.oldLinks;
		output.oldSnapshot = this.oldSnapshot;
		output.newSnapshot = this.newSnapshot;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.objects = json.objectUuids.map( ( uuid ) => this.editor.objectByUuid( uuid ) ).filter( Boolean );
		this.newLink = json.newLink;
		this.oldLinks = json.oldLinks;
		this.oldSnapshot = json.oldSnapshot;
		this.newSnapshot = json.newSnapshot;

	}

}

export { SetTechnicalPartCommand };
