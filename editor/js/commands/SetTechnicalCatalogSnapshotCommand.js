import { Command } from '../Command.js';

import { getSnapshot, hasSnapshot, setSnapshot } from '../SimpleMode.TechnicalCatalogData.js';

/**
 * EV-015 — substitui o snapshot técnico do projeto (scene.userData.project3ds.technicalCatalog): atualização
 * explícita das regras de compatibilidade do projeto para as do catálogo local, inclusão de revisões. Somente dados
 * auxiliares: nenhuma geometria é tocada. Reversível (Desfazer/Refazer) e salvo com o projeto.
 */
class SetTechnicalCatalogSnapshotCommand extends Command {

	constructor( editor, snapshot = null, name = 'Atualizar dados técnicos do projeto' ) {

		super( editor );

		this.type = 'SetTechnicalCatalogSnapshotCommand';
		this.name = name;
		this.updatable = false;
		this.object = editor.scene;
		this.oldSnapshot = editor.scene !== undefined && hasSnapshot( editor.scene ) ? getSnapshot( editor.scene ) : null;
		this.newSnapshot = snapshot !== null ? JSON.parse( JSON.stringify( snapshot ) ) : null;

	}

	apply( snapshot ) {

		setSnapshot( this.editor.scene, snapshot );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() {

		this.apply( this.newSnapshot );

	}

	undo() {

		this.apply( this.oldSnapshot );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.oldSnapshot = this.oldSnapshot;
		output.newSnapshot = this.newSnapshot;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.oldSnapshot = json.oldSnapshot;
		this.newSnapshot = json.newSnapshot;
		this.object = this.editor.scene;

	}

}

export { SetTechnicalCatalogSnapshotCommand };
