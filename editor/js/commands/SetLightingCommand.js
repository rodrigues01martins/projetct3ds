import { Command } from '../Command.js';

import { applySettingsToGroup, createLightingGroup, findLightingGroup, getSettings } from '../SimpleMode.Lighting.js';

/**
 * EV-004 — altera a iluminação do Project3DS (cenário, intensidade, temperatura, sombras).
 *
 * Cria, ajusta ou remove apenas o grupo de luzes do Project3DS; luzes do usuário nunca são tocadas.
 * Guarda só as configurações (dados simples), então é serializável no histórico.
 */
class SetLightingCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {Object|null} [newSettings=null]
	 * @constructor
	 */
	constructor( editor, newSettings = null ) {

		super( editor );

		this.type = 'SetLightingCommand';
		this.name = 'Alterar iluminação';
		this.updatable = true;

		this.oldSettings = newSettings !== null ? getSettings( editor.scene ) : null;
		this.newSettings = newSettings !== null ? Object.assign( {}, newSettings ) : null;

	}

	apply( settings ) {

		const editor = this.editor;
		const scene = editor.scene;
		let group = findLightingGroup( scene );

		if ( settings.scenario === 'none' ) {

			if ( group !== null ) editor.removeObject( group );
			scene.environmentIntensity = 1;
			editor.signals.sceneGraphChanged.dispatch();
			return;

		}

		if ( group === null ) {

			group = createLightingGroup();
			applySettingsToGroup( group, settings, scene );
			editor.addObject( group );

		} else {

			applySettingsToGroup( group, settings, scene );
			editor.signals.objectChanged.dispatch( group );

		}

	}

	execute() {

		this.apply( this.newSettings );

	}

	undo() {

		this.apply( this.oldSettings );

	}

	update( cmd ) {

		this.newSettings = Object.assign( {}, cmd.newSettings );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.oldSettings = this.oldSettings;
		output.newSettings = this.newSettings;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.oldSettings = json.oldSettings;
		this.newSettings = json.newSettings;

	}

}

export { SetLightingCommand };
