// EV-005 — Galeria de Projetos Prontos e Modelos Iniciais 3D
//
// Validação, preparação em memória e aplicação dos projetos prontos.
//
// Fluxo seguro (applyTemplate):
//   1. valida a definição e constrói TODOS os componentes em memória (createComponent + acabamentos da EV-004);
//      se algo falhar aqui, a cena atual não é tocada;
//   2. guarda uma cópia (editor.toJSON) do projeto aberto, apenas para recuperação;
//   3. limpa o editor (o mesmo "Novo projeto" da EV-001: histórico e salvamento automático recomeçam) e insere a cena;
//   4. se ocorrer erro durante a substituição, limpa de novo e restaura a cópia — a cena nunca fica pela metade.
//
// A cena montada é o estado inicial do novo projeto: os objetos entram sem comandos, então Desfazer
// não volta ao projeto anterior. Meus componentes e arquivos exportados nunca são alterados.

import * as THREE from 'three';

import { getDefinition, getDefaultParameters, validateParameters } from './SimpleMode.Components.js';
import { createComponent } from './SimpleMode.ComponentFactory.js';
import { applyPart, getParts } from './SimpleMode.Appearance.js';
import { getMaterialPreset, specFromPreset } from './SimpleMode.MaterialCatalog.js';
import { getScenario, defaultSettings, createLightingGroup, applySettingsToGroup } from './SimpleMode.Lighting.js';
import { UNITS } from './SimpleMode.Units.js';
import { getProjectBox, perspectiveFrame } from './SimpleMode.CameraController.js';
import { TEMPLATE_LIMITS, getTemplateCategory } from './SimpleMode.ProjectTemplates.js';

const DEFAULT_CAMERA_DIRECTION = [ 0.9, 0.8, 1.3 ]; // de frente e à direita, levemente de cima (isométrica aproximada)

const isVector = ( value, limit ) => Array.isArray( value ) && value.length === 3 && value.every( ( v ) => typeof v === 'number' && Number.isFinite( v ) && Math.abs( v ) <= limit );

// validação ------------------------------------------------------------------------------------------

// Retorna a lista de problemas encontrados (vazia = válido). Não constrói nada.
function validateTemplate( template ) {

	const errors = [];

	if ( template === null || typeof template !== 'object' ) return [ 'Modelo inválido.' ];
	if ( typeof template.id !== 'string' || template.id === '' ) errors.push( 'Identificador ausente.' );
	if ( Number.isInteger( template.version ) === false || template.version < 1 ) errors.push( 'Versão inválida.' );
	if ( typeof template.name !== 'string' || template.name === '' ) errors.push( 'Nome ausente.' );
	if ( getTemplateCategory( template.category ) === null ) errors.push( 'Categoria desconhecida: ' + template.category );
	if ( UNITS[ template.units ] === undefined ) errors.push( 'Unidade desconhecida: ' + template.units );
	if ( getScenario( template.lighting ) === null ) errors.push( 'Cenário de iluminação desconhecido: ' + template.lighting );
	if ( template.camera !== undefined && isVector( template.camera.direction, 100 ) === false ) errors.push( 'Direção da câmera inválida.' );

	const components = template.components;

	if ( Array.isArray( components ) === false || components.length === 0 ) {

		errors.push( 'O modelo não tem componentes.' );
		return errors;

	}

	if ( components.length > TEMPLATE_LIMITS.components ) errors.push( `Componentes demais (${components.length}; limite ${TEMPLATE_LIMITS.components}).` );

	components.forEach( function ( item, index ) {

		const label = `Componente ${index + 1} (${item && item.component})`;
		const definition = item !== null && typeof item === 'object' ? getDefinition( item.component ) : null;

		if ( definition === null ) {

			errors.push( label + ': tipo inexistente na biblioteca.' );
			return;

		}

		if ( item.parameters !== undefined && ( item.parameters === null || typeof item.parameters !== 'object' ) ) errors.push( label + ': parâmetros inválidos.' );

		const unknown = Object.keys( item.parameters || {} ).filter( ( key ) => definition.parameters.some( ( p ) => p.key === key ) === false );
		if ( unknown.length > 0 ) errors.push( label + ': parâmetros desconhecidos (' + unknown.join( ', ' ) + ').' );

		const parameters = Object.assign( getDefaultParameters( definition ), item.parameters || {} );
		const invalid = validateParameters( definition, parameters );
		if ( invalid !== null ) errors.push( label + ': ' + invalid.message + ( invalid.key ? ' (' + invalid.key + ')' : '' ) );

		if ( isVector( item.position, 100 ) === false ) errors.push( label + ': posição inválida.' );
		if ( isVector( item.rotation, 360 ) === false ) errors.push( label + ': rotação inválida.' );

		const parts = Object.keys( definition.materials( parameters ) );

		for ( const [ part, preset ] of Object.entries( item.appearance || {} ) ) {

			if ( parts.includes( part ) === false ) errors.push( label + ': parte inexistente "' + part + '".' );
			if ( getMaterialPreset( preset ) === null ) errors.push( label + ': acabamento inexistente "' + preset + '".' );

		}

	} );

	return errors;

}

// preparação em memória -----------------------------------------------------------------------------

// Constrói instâncias independentes (UUIDs, geometrias e materiais próprios). Lança erro se algo falhar.
function prepareTemplate( template ) {

	const errors = validateTemplate( template );

	if ( errors.length > 0 ) throw new Error( 'Modelo inválido: ' + errors[ 0 ] );

	return template.components.map( function ( item ) {

		const definition = getDefinition( item.component );
		const parameters = Object.assign( getDefaultParameters( definition ), item.parameters || {} );

		const object = createComponent( item.component, parameters );
		object.name = item.name || definition.name;
		object.position.fromArray( item.position );
		object.rotation.set( ...item.rotation.map( ( degrees ) => THREE.MathUtils.degToRad( degrees ) ) );
		object.updateMatrixWorld( true );

		// acabamentos pelo mecanismo oficial da EV-004 (registro em userData.project3ds.appearance)
		for ( const [ part, preset ] of Object.entries( item.appearance || {} ) ) {

			if ( getParts( object ).some( ( p ) => p.key === part ) ) applyPart( object, part, specFromPreset( preset ) );

		}

		return object;

	} );

}

// câmera -------------------------------------------------------------------------------------------

// Enquadra os objetos úteis da cena (sem auxiliares nem o grupo de iluminação), mantendo a câmera do editor.
// EV-008: limites e distância vêm do módulo de câmeras (o mesmo cálculo de "Enquadrar projeto").
function frameScene( editor, direction = DEFAULT_CAMERA_DIRECTION ) {

	const box = getProjectBox( editor );

	if ( box.isEmpty() ) return false;

	const camera = editor.camera;
	const frame = perspectiveFrame( box, direction, camera.fov, camera.aspect );

	camera.position.copy( frame.position );
	camera.lookAt( frame.target );
	camera.near = Math.max( 0.001, frame.distance / 1000 );
	camera.far = Math.max( 1e4, frame.distance * 100 );
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld();

	if ( editor.controls !== undefined ) editor.controls.center.copy( frame.target );

	editor.signals.cameraChanged.dispatch( camera );

	return true;

}

// aplicação -----------------------------------------------------------------------------------------

function buildScene( editor, template, objects ) {

	const scene = editor.scene;

	// unidade do projeto (EV-002) e origem do modelo (informativa; os componentes ficam todos na cena)
	scene.userData.project3ds = Object.assign( {}, scene.userData.project3ds, {
		units: template.units,
		template: { id: template.id, version: template.version, name: template.name }
	} );

	scene.name = template.name;

	for ( const object of objects ) editor.addObject( object );

	// iluminação (EV-004): um único grupo do Project3DS, criado após os objetos para ajustar as sombras
	if ( template.lighting !== 'none' ) {

		const group = createLightingGroup();
		applySettingsToGroup( group, defaultSettings( template.lighting ), scene );
		editor.addObject( group );

	}

	editor.signals.sceneGraphChanged.dispatch();

}

// Substitui o projeto aberto pelo modelo. Retorna uma Promise; em caso de erro o projeto anterior é preservado.
async function applyTemplate( editor, template, { onTitle } = {} ) {

	// 1. tudo pronto em memória antes de tocar na cena
	const objects = prepareTemplate( template );

	// 2. cópia do projeto atual, usada somente se a substituição falhar
	const backup = editor.toJSON();
	const backupTitle = editor.config.getKey( 'project/title' );

	try {

		editor.clear(); // mesmo comportamento do "Novo projeto" (histórico limpo, sem Desfazer para o projeto anterior)
		buildScene( editor, template, objects );
		frameScene( editor, template.camera !== undefined ? template.camera.direction : undefined );

		editor.config.setKey( 'project/title', template.name );
		if ( onTitle !== undefined ) onTitle( template.name );

	} catch ( error ) {

		console.error( error );

		// 4. recuperação: nenhuma cena pela metade (o título volta antes da cena, para a interface já exibi-lo)
		editor.clear();
		editor.config.setKey( 'project/title', backupTitle );
		if ( onTitle !== undefined ) onTitle( backupTitle );
		await editor.fromJSON( backup );

		throw new Error( 'Não foi possível abrir o modelo. O projeto anterior foi restaurado.' );

	}

}

// resumo para os cartões da galeria
function summarizeTemplate( template ) {

	return {
		components: template.components.length,
		width: template.area.width,
		depth: template.area.depth
	};

}

export { validateTemplate, prepareTemplate, applyTemplate, frameScene, summarizeTemplate };
