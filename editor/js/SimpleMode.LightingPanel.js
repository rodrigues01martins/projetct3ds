// EV-004 — Sistema Inteligente de Materiais, Texturas e Iluminação 3D
// Painel "Iluminação" (acesso discreto na área de visualização) e sincronização das luzes do Project3DS.

import { UIDiv } from './libs/ui.js';

import { SetLightingCommand } from './commands/SetLightingCommand.js';

import { SCENARIOS, LIGHTING_LIMITS, getScenario, defaultSettings, getSettings, sanitizeSettings, findLightingGroup, isOwnedLighting, applySettingsToGroup, fitShadowCamera, countUserLights } from './SimpleMode.Lighting.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

// serviço: reaplica as configurações salvas (ao abrir/recarregar projetos) e mantém sombras e auxiliares coerentes

function LightingService( editor, getMode ) {

	const scene = editor.scene;
	let refitTimer = null;

	function ownedLights() {

		const group = findLightingGroup( scene );
		return group !== null ? group.children.filter( ( child ) => child.isLight === true ) : [];

	}

	// no Modo Simples as luzes do Project3DS não mostram auxiliares (linhas e alvos clicáveis);
	// no Modo Avançado elas aparecem e podem ser editadas como qualquer luz
	function updateHelpers() {

		for ( const light of ownedLights() ) {

			if ( getMode() === 'simple' ) editor.removeHelper( light );
			else if ( editor.helpers[ light.id ] === undefined ) editor.addHelper( light );

		}

	}

	function sync() {

		const group = findLightingGroup( scene );
		const before = scene.environmentIntensity;

		if ( group !== null ) {

			const settings = sanitizeSettings( group.userData.project3ds.lighting ) || defaultSettings( 'studio' );
			applySettingsToGroup( group, settings, scene );

		} else {

			scene.environmentIntensity = 1;

		}

		updateHelpers();

		if ( scene.environmentIntensity !== before ) editor.signals.sceneHelpersChanged.dispatch();

	}

	function scheduleRefit() {

		clearTimeout( refitTimer );
		refitTimer = setTimeout( function () {

			const group = findLightingGroup( scene );

			if ( group !== null ) {

				fitShadowCamera( group, scene );
				editor.signals.sceneHelpersChanged.dispatch();

			}

		}, 60 );

	}

	editor.signals.sceneGraphChanged.add( sync );
	editor.signals.editorCleared.add( sync );
	editor.signals.objectChanged.add( ( object ) => {

		if ( isOwnedLighting( object, scene ) === false ) scheduleRefit();

	} );
	editor.signals.objectRemoved.add( scheduleRefit );

	return { sync, updateHelpers };

}

// painel ----------------------------------------------------------------------------------------

function SimpleModeLightingPanel( editor, context, optionsBar, container ) {

	const config = editor.config;

	// botão na barra de opções (ao lado de Encaixe e Grade)

	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'SimpleOption SimpleLightingButton';
	button.title = t( 'lighting/open/title' );
	button.setAttribute( 'aria-haspopup', 'dialog' );
	button.setAttribute( 'aria-expanded', 'false' );
	button.setAttribute( 'aria-controls', 'simple-lighting' );
	button.appendChild( createIcon( 'light' ) );

	const buttonText = document.createElement( 'span' );
	buttonText.className = 'SimpleOptionLabel';
	button.appendChild( buttonText );

	optionsBar.dom.appendChild( button );

	// painel suspenso (não modal: a cena continua utilizável)

	const panel = new UIDiv().setClass( 'SimpleLighting' );
	panel.dom.id = 'simple-lighting';
	panel.dom.setAttribute( 'role', 'dialog' );
	panel.dom.setAttribute( 'aria-label', t( 'lighting/title' ) );
	panel.dom.hidden = true;
	container.add( panel );

	const header = new UIDiv().setClass( 'SimpleHelpHeader' );
	header.add( createText( t( 'lighting/title' ), 'SimpleHelpTitle' ) );
	header.add( createSimpleButton( { icon: 'close', title: t( 'lighting/close' ), className: 'SimpleIconButton', onClick: close } ) );
	panel.add( header );

	const scenarioGroup = document.createElement( 'div' );
	scenarioGroup.className = 'SimpleScenarios';
	scenarioGroup.setAttribute( 'role', 'radiogroup' );
	scenarioGroup.setAttribute( 'aria-label', t( 'lighting/scenario' ) );
	panel.dom.appendChild( scenarioGroup );

	const scenarioButtons = new Map();

	for ( const scenario of SCENARIOS ) {

		const item = document.createElement( 'button' );
		item.type = 'button';
		item.className = 'SimpleScenario';
		item.setAttribute( 'role', 'radio' );
		item.dataset.scenario = scenario.id;

		const name = document.createElement( 'strong' );
		name.textContent = scenario.name;
		item.appendChild( name );

		const description = document.createElement( 'span' );
		description.textContent = scenario.description;
		item.appendChild( description );

		item.addEventListener( 'click', () => selectScenario( scenario.id ) );
		item.addEventListener( 'keydown', ( event ) => {

			if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {

				event.preventDefault();
				const index = SCENARIOS.indexOf( scenario );
				const next = SCENARIOS[ ( index + ( event.key === 'ArrowDown' ? 1 : SCENARIOS.length - 1 ) ) % SCENARIOS.length ];
				selectScenario( next.id );
				scenarioButtons.get( next.id ).focus();

			}

		} );

		scenarioGroup.appendChild( item );
		scenarioButtons.set( scenario.id, item );

	}

	const controls = new UIDiv().setClass( 'SimpleAppearanceControls SimpleLightingControls' );
	panel.add( controls );

	function createRow( label ) {

		const row = document.createElement( 'div' );
		row.className = 'SimpleControlRow';

		const text = document.createElement( 'span' );
		text.className = 'SimpleControlLabel';
		text.textContent = label;
		row.appendChild( text );

		controls.dom.appendChild( row );
		return row;

	}

	function createRange( row, min, max, step, label, onInput ) {

		const wrapper = document.createElement( 'div' );
		wrapper.className = 'SimpleRangeWithValue';

		const input = document.createElement( 'input' );
		input.type = 'range';
		input.className = 'SimpleRange';
		input.min = min;
		input.max = max;
		input.step = step;
		input.setAttribute( 'aria-label', label );
		input.addEventListener( 'input', () => onInput( Number( input.value ) ) );
		wrapper.appendChild( input );

		const value = document.createElement( 'span' );
		value.className = 'SimpleRangeValue';
		wrapper.appendChild( value );

		row.appendChild( wrapper );

		return { input, value };

	}

	const intensity = createRange( createRow( t( 'lighting/intensity' ) ), LIGHTING_LIMITS.intensity[ 0 ], LIGHTING_LIMITS.intensity[ 1 ], 0.05, t( 'lighting/intensity' ), ( value ) => change( { intensity: value } ) );
	const temperature = createRange( createRow( t( 'lighting/temperature' ) ), LIGHTING_LIMITS.temperature[ 0 ], LIGHTING_LIMITS.temperature[ 1 ], 100, t( 'lighting/temperature/title' ), ( value ) => change( { temperature: value } ) );
	temperature.input.classList.add( 'SimpleTemperature' );

	const shadowsRow = createRow( t( 'lighting/shadows' ) );
	const shadowsToggle = document.createElement( 'input' );
	shadowsToggle.type = 'checkbox';
	shadowsToggle.className = 'SimpleToggle';
	shadowsToggle.setAttribute( 'aria-label', t( 'lighting/shadows' ) );
	shadowsToggle.addEventListener( 'change', () => change( { shadows: shadowsToggle.checked } ) );
	shadowsRow.appendChild( shadowsToggle );

	const qualityRow = createRow( t( 'lighting/quality' ) );
	const qualitySelect = document.createElement( 'select' );
	qualitySelect.className = 'SimpleSelect';
	qualitySelect.setAttribute( 'aria-label', t( 'lighting/quality' ) );

	for ( const [ value, label ] of [[ 'low', t( 'lighting/quality/low' ) ], [ 'high', t( 'lighting/quality/high' ) ]] ) {

		const option = document.createElement( 'option' );
		option.value = value;
		option.textContent = label;
		qualitySelect.appendChild( option );

	}

	qualitySelect.addEventListener( 'change', () => change( { shadowQuality: qualitySelect.value } ) );
	qualityRow.appendChild( qualitySelect );

	const notices = new UIDiv();
	panel.add( notices );

	// impede que teclas nos controles acionem atalhos do editor; Esc fecha o painel
	panel.dom.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation();

		if ( event.key === 'Escape' ) {

			close();
			button.focus();

		}

	} );

	// ações ---------------------------------------------------------------------------------------

	function execute( settings ) {

		const clean = sanitizeSettings( settings );
		if ( clean === null ) return;

		editor.execute( new SetLightingCommand( editor, clean ) );

	}

	function selectScenario( id ) {

		const current = getSettings( editor.scene );
		if ( current.scenario === id ) return;

		const settings = defaultSettings( id );
		settings.shadowQuality = current.shadowQuality;

		execute( settings );
		context.notify( t( 'message/lighting/changed', getScenario( id ).name ), 'success' );

	}

	function change( values ) {

		const current = getSettings( editor.scene );
		if ( current.scenario === 'none' ) return;

		execute( Object.assign( {}, current, values ) );

	}

	// interface -------------------------------------------------------------------------------------

	function refresh() {

		const settings = getSettings( editor.scene );
		const active = settings.scenario !== 'none';

		buttonText.textContent = t( 'lighting/button', getScenario( settings.scenario ).name );

		for ( const [ id, item ] of scenarioButtons ) {

			const selected = id === settings.scenario;
			item.classList.toggle( 'active', selected );
			item.setAttribute( 'aria-checked', selected );
			item.tabIndex = selected ? 0 : - 1;

		}

		controls.dom.classList.toggle( 'disabled', ! active );

		for ( const input of [ intensity.input, temperature.input, shadowsToggle, qualitySelect ] ) input.disabled = ! active;

		if ( document.activeElement !== intensity.input ) intensity.input.value = String( settings.intensity );
		if ( document.activeElement !== temperature.input ) temperature.input.value = String( settings.temperature );

		intensity.value.textContent = Math.round( settings.intensity * 100 ) + '%';
		temperature.value.textContent = settings.temperature + ' K';
		shadowsToggle.checked = settings.shadows;
		qualitySelect.value = settings.shadowQuality;
		qualitySelect.disabled = ! active || ! settings.shadows;

		// avisos
		notices.dom.textContent = '';

		const addNotice = ( text ) => notices.dom.appendChild( createText( text, 'SimpleNotice' ).dom );

		if ( active === false ) addNotice( t( 'lighting/notice/none' ) );

		const userLights = countUserLights( editor.scene );
		if ( userLights > 0 ) addNotice( t( 'lighting/notice/userLights', userLights ) );

		if ( active && settings.shadows && config.getKey( 'project/renderer/shadows' ) === false ) addNotice( t( 'lighting/notice/rendererShadows' ) );

	}

	function position() {

		const area = container.dom.getBoundingClientRect();
		const anchor = button.getBoundingClientRect();
		const width = Math.min( 320, area.width - 24 );
		const left = Math.min( Math.max( 12, anchor.left - area.left + anchor.width / 2 - width / 2 ), area.width - width - 12 );

		panel.dom.style.width = width + 'px';
		panel.dom.style.left = left + 'px';
		panel.dom.style.top = ( anchor.bottom - area.top + 8 ) + 'px';
		panel.dom.style.maxHeight = ( area.height - ( anchor.bottom - area.top ) - 20 ) + 'px';

	}

	function open() {

		refresh();
		panel.dom.hidden = false;
		button.setAttribute( 'aria-expanded', 'true' );
		button.classList.add( 'active' );
		position();

		const selected = scenarioGroup.querySelector( '.active' );
		if ( selected !== null ) selected.focus();

	}

	function close() {

		panel.dom.hidden = true;
		button.setAttribute( 'aria-expanded', 'false' );
		button.classList.remove( 'active' );

	}

	button.addEventListener( 'click', () => ( panel.dom.hidden ? open() : close() ) );

	editor.signals.sceneGraphChanged.add( refresh );
	editor.signals.objectChanged.add( ( object ) => {

		if ( isOwnedLighting( object, editor.scene ) ) refresh();

	} );
	editor.signals.editorCleared.add( refresh );
	editor.signals.windowResize.add( () => {

		if ( panel.dom.hidden === false ) position();

	} );

	refresh();

	return { open, close, isOpen: () => panel.dom.hidden === false };

}

export { LightingService, SimpleModeLightingPanel };
