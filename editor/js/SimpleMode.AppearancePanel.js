// EV-004 — Sistema Inteligente de Materiais, Texturas e Iluminação 3D
// Seção "Aparência" do painel direito: partes, acabamentos, cor, brilho, aspecto metálico, transparência,
// padrão (textura procedural) e escala do padrão. Toda alteração é um SetAppearanceCommand.

import { UIDiv } from './libs/ui.js';

import { SetAppearanceCommand } from './commands/SetAppearanceCommand.js';

import { MATERIAL_CATEGORIES, MATERIALS, CUSTOM_CONTROLS, GLOSS_LEVELS, TEXTURE_SCALE_LIMITS, getMaterialPreset, specFromPreset, seedFromId, sanitizeSpec } from './SimpleMode.MaterialCatalog.js';
import { TEXTURES, isKnownTexture, getTextureThumbnail } from './SimpleMode.Textures.js';
import { getParts, getEditIssue, getCurrentSpec, getPartMeta, captureOriginal, getUVSize } from './SimpleMode.Appearance.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';

// miniatura leve (CSS + canvas 2D pequeno), sem renderizador WebGL
function paintSwatch( element, preset ) {

	element.style.backgroundColor = preset.color;

	const layers = [];

	if ( preset.metalness > 0.5 ) layers.push( 'linear-gradient(135deg, rgba(255,255,255,.65), rgba(255,255,255,0) 45%, rgba(0,0,0,.25))' );
	if ( preset.texture !== null ) layers.push( `url(${ getTextureThumbnail( preset.texture, seedFromId( preset.id ) ) })` );

	element.style.backgroundImage = layers.join( ', ' );
	element.style.backgroundBlendMode = 'multiply';
	element.classList.toggle( 'transparent', preset.opacity < 1 );

}

function SimpleModeAppearancePanel( editor, context, section ) {

	let owner = null;
	let parts = [];
	let partKey = null;

	const body = section.body;

	// partes lógicas (componentes e grupos)

	const partRow = new UIDiv().setClass( 'SimplePartChips' );
	partRow.dom.setAttribute( 'role', 'radiogroup' );
	partRow.dom.setAttribute( 'aria-label', t( 'appearance/part' ) );
	const partLabel = createText( t( 'appearance/part' ), 'SimpleSubLabel' );
	body.add( partLabel, partRow );

	// acabamento atual

	const current = createText( '', 'SimpleAppearanceCurrent' );
	body.add( current );

	// catálogo de acabamentos

	const catalog = new UIDiv().setClass( 'SimpleSwatches' );
	catalog.dom.setAttribute( 'role', 'listbox' );
	catalog.dom.setAttribute( 'aria-label', t( 'appearance/catalog' ) );
	body.add( catalog );

	const swatches = new Map();

	for ( const category of MATERIAL_CATEGORIES ) {

		const title = document.createElement( 'div' );
		title.className = 'SimpleSwatchTitle';
		title.textContent = category.name;
		catalog.dom.appendChild( title );

		const row = document.createElement( 'div' );
		row.className = 'SimpleSwatchRow';

		for ( const preset of MATERIALS.filter( ( item ) => item.category === category.id ) ) {

			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'SimpleSwatch';
			button.setAttribute( 'role', 'option' );
			button.title = t( 'appearance/apply', preset.name );
			button.setAttribute( 'aria-label', t( 'appearance/apply', preset.name ) );
			button.addEventListener( 'click', () => applyPreset( preset.id ) );
			button.addEventListener( 'keydown', ( event ) => event.stopPropagation() );

			const chip = document.createElement( 'span' );
			chip.className = 'SimpleSwatchChip';
			paintSwatch( chip, preset );
			button.appendChild( chip );

			const name = document.createElement( 'span' );
			name.className = 'SimpleSwatchName';
			name.textContent = preset.name;
			button.appendChild( name );

			row.appendChild( button );
			swatches.set( preset.id, button );

		}

		catalog.dom.appendChild( row );

	}

	// ajustes

	const controls = new UIDiv().setClass( 'SimpleAppearanceControls' );
	body.add( controls );

	function createControl( id, label ) {

		const row = document.createElement( 'div' );
		row.className = 'SimpleControlRow';
		row.dataset.control = id;

		const text = document.createElement( 'span' );
		text.className = 'SimpleControlLabel';
		text.textContent = label;
		row.appendChild( text );

		controls.dom.appendChild( row );

		return row;

	}

	function createRange( row, { min, max, step, label, onInput } ) {

		const input = document.createElement( 'input' );
		input.type = 'range';
		input.className = 'SimpleRange';
		input.min = min;
		input.max = max;
		input.step = step;
		input.setAttribute( 'aria-label', label );
		input.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		input.addEventListener( 'input', () => onInput( Number( input.value ) ) );
		row.appendChild( input );

		return input;

	}

	// cor
	const colorRow = createControl( 'color', t( 'appearance/color' ) );
	const colorInput = document.createElement( 'input' );
	colorInput.type = 'color';
	colorInput.className = 'SimpleColorInput';
	colorInput.setAttribute( 'aria-label', t( 'appearance/color' ) );
	colorInput.addEventListener( 'input', () => change( { color: colorInput.value } ) );
	colorRow.appendChild( colorInput );

	// brilho (rugosidade invertida) com atalhos Fosco / Intermediário / Brilhante
	const glossRow = createControl( 'gloss', t( 'appearance/gloss' ) );
	const glossWrapper = document.createElement( 'div' );
	glossWrapper.className = 'SimpleGloss';
	glossRow.appendChild( glossWrapper );

	const glossRange = createRange( glossWrapper, { min: 0, max: 1, step: 0.01, label: t( 'appearance/gloss/title' ), onInput: ( value ) => change( { roughness: round( 1 - value ) } ) } );

	const glossButtons = document.createElement( 'div' );
	glossButtons.className = 'SimpleGlossLevels';
	glossButtons.setAttribute( 'role', 'group' );
	glossButtons.setAttribute( 'aria-label', t( 'appearance/gloss' ) );

	for ( const level of GLOSS_LEVELS ) {

		const button = createSimpleButton( { label: level.name, title: t( 'appearance/gloss/level', level.name ), className: 'SimpleGlossLevel' } );
		button.dom.dataset.level = level.id;
		button.dom.addEventListener( 'click', () => change( { roughness: level.roughness } ) );
		glossButtons.appendChild( button.dom );

	}

	glossWrapper.appendChild( glossButtons );

	// aspecto metálico
	const metalRow = createControl( 'metal', t( 'appearance/metal' ) );
	const metalRange = createRange( metalRow, { min: 0, max: 1, step: 0.01, label: t( 'appearance/metal/title' ), onInput: ( value ) => change( { metalness: round( value ) } ) } );

	// transparência
	const opacityRow = createControl( 'opacity', t( 'appearance/transparency' ) );
	const opacityRange = createRange( opacityRow, { min: 0, max: 0.9, step: 0.01, label: t( 'appearance/transparency/title' ), onInput: ( value ) => change( { opacity: round( 1 - value ) } ) } );

	// padrão (textura procedural) e escala
	const textureRow = createControl( 'texture', t( 'appearance/texture' ) );
	const textureSelect = document.createElement( 'select' );
	textureSelect.className = 'SimpleSelect';
	textureSelect.setAttribute( 'aria-label', t( 'appearance/texture' ) );
	textureSelect.addEventListener( 'keydown', ( event ) => event.stopPropagation() );

	const noneOption = document.createElement( 'option' );
	noneOption.value = '';
	noneOption.textContent = t( 'appearance/texture/none' );
	textureSelect.appendChild( noneOption );

	for ( const texture of TEXTURES ) {

		const option = document.createElement( 'option' );
		option.value = texture.id;
		option.textContent = texture.name;
		textureSelect.appendChild( option );

	}

	textureSelect.addEventListener( 'change', function () {

		const id = textureSelect.value;
		change( { texture: id === '' ? null : { id, scale: 1, seed: seedFromId( id ) } } );

	} );
	textureRow.appendChild( textureSelect );

	const scaleRow = createControl( 'scale', t( 'appearance/textureScale' ) );
	const scaleRange = createRange( scaleRow, { min: Math.log( 0.25 ), max: Math.log( 4 ), step: 0.01, label: t( 'appearance/textureScale/title' ), onInput: ( value ) => {

		const spec = currentSpec();
		if ( spec === null || spec.texture === null ) return;
		change( { texture: Object.assign( {}, spec.texture, { scale: clampScale( Math.exp( value ) ) } ) } );

	} } );
	const scaleValue = createText( '', 'SimpleRangeValue' );
	scaleRow.appendChild( scaleValue.dom );

	const glassNote = createText( t( 'appearance/glass/note' ), 'SimpleSectionHint' );
	body.add( glassNote );

	const status = createText( '', 'SimpleSectionHint SimpleAppearanceStatus' );
	body.add( status );

	const restore = createSimpleButton( {
		label: t( 'appearance/restore' ), title: t( 'appearance/restore/title' ), className: 'SimpleLinkButton',
		onClick: () => execute( null )
	} );
	body.add( restore );

	// lógica ------------------------------------------------------------------------------

	function round( value ) {

		return Math.round( value * 100 ) / 100;

	}

	function clampScale( value ) {

		return Math.round( Math.min( TEXTURE_SCALE_LIMITS.max, Math.max( TEXTURE_SCALE_LIMITS.min, value ) ) * 100 ) / 100;

	}

	function getPart() {

		return parts.find( ( part ) => part.key === partKey ) || null;

	}

	function currentSpec() {

		const part = getPart();
		return part !== null ? getCurrentSpec( owner, part ) : null;

	}

	// monta a nova parte, preservando o material original (necessário para "Restaurar")
	function execute( spec ) {

		const part = getPart();
		if ( part === null ) return;

		let next = null;

		if ( spec !== null ) {

			const clean = sanitizeSpec( spec, isKnownTexture );

			if ( clean === null ) {

				context.notify( t( 'message/appearance/invalid' ), 'warning' );
				return;

			}

			next = clean;

			// malhas e grupos: guarda o material original na primeira aplicação
			if ( isComponentOwner() === false ) {

				const stored = getPartMeta( owner, part.key );
				next.original = stored !== null && stored.original !== undefined ? stored.original : captureOriginal( part.meshes[ 0 ].material );

			}

		} else if ( getPartMeta( owner, part.key ) === null ) {

			context.notify( t( 'message/appearance/alreadyOriginal' ) );
			return;

		}

		const command = new SetAppearanceCommand( editor, owner, part.key, next );
		editor.execute( command );

		if ( command.textureSkipped ) context.notify( t( 'message/appearance/noUV' ), 'warning' );

	}

	function isComponentOwner() {

		const meta = owner.userData.project3ds;
		return meta !== undefined && meta !== null && typeof meta.component === 'object' && meta.component !== null;

	}

	function applyPreset( id ) {

		const spec = specFromPreset( id );
		if ( spec === null ) return;

		execute( spec );

		const name = getMaterialPreset( id ).name;
		context.notify( parts.length > 1 ? t( 'message/appearance/appliedPart', name, getPart().label ) : t( 'message/appearance/applied', name ), 'success' );

	}

	function change( values ) {

		const spec = currentSpec();
		if ( spec === null ) return;

		execute( Object.assign( {}, spec, values ) );

	}

	// interface ------------------------------------------------------------------------------

	function renderParts() {

		partRow.dom.textContent = '';

		const showParts = parts.length > 1;
		partRow.dom.hidden = ! showParts;
		partLabel.dom.hidden = ! showParts;

		if ( showParts === false ) return;

		for ( const part of parts ) {

			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'SimplePartChip';
			button.textContent = part.label;
			button.setAttribute( 'role', 'radio' );
			button.setAttribute( 'aria-checked', part.key === partKey );
			button.classList.toggle( 'active', part.key === partKey );
			button.tabIndex = part.key === partKey ? 0 : - 1;
			button.addEventListener( 'click', () => {

				partKey = part.key;
				renderParts();
				refresh();

			} );
			button.addEventListener( 'keydown', ( event ) => {

				event.stopPropagation();

				if ( event.key === 'ArrowRight' || event.key === 'ArrowLeft' ) {

					const index = parts.indexOf( part );
					const next = parts[ ( index + ( event.key === 'ArrowRight' ? 1 : parts.length - 1 ) ) % parts.length ];
					partKey = next.key;
					renderParts();
					refresh();
					partRow.dom.querySelector( '.active' ).focus();

				}

			} );
			partRow.dom.appendChild( button );

		}

	}

	function refresh() {

		const part = getPart();

		if ( part === null ) return;

		const issue = getEditIssue( part );
		const spec = getCurrentSpec( owner, part );
		const preset = spec.preset !== null ? getMaterialPreset( spec.preset ) : null;
		const allowed = preset !== null ? preset.controls : CUSTOM_CONTROLS;
		const stored = getPartMeta( owner, part.key );

		const editable = issue === null;

		catalog.dom.hidden = ! editable;
		controls.dom.hidden = ! editable;
		restore.dom.hidden = ! editable || stored === null;

		status.dom.hidden = editable;
		if ( editable === false ) status.setTextContent( t( 'appearance/issue/' + issue ) );

		current.setTextContent( t( 'appearance/current', preset !== null ? preset.name : ( stored !== null ? t( 'appearance/custom' ) : t( 'appearance/original' ) ) ) );

		for ( const [ id, button ] of swatches ) {

			const active = spec.preset === id;
			button.classList.toggle( 'active', active );
			button.setAttribute( 'aria-selected', active );

		}

		if ( editable === false ) return;

		// só mostra ajustes compatíveis com o acabamento
		const hasUV = part.meshes.every( ( mesh ) => getUVSize( mesh ) !== null );
		const show = ( id, visible ) => ( controls.dom.querySelector( `[data-control="${ id }"]` ).hidden = ! visible );

		show( 'color', allowed.includes( 'color' ) );
		show( 'gloss', allowed.includes( 'gloss' ) );
		show( 'metal', allowed.includes( 'metal' ) );
		show( 'opacity', allowed.includes( 'opacity' ) );
		show( 'texture', allowed.includes( 'texture' ) && hasUV );
		show( 'scale', allowed.includes( 'texture' ) && hasUV && spec.texture !== null );

		if ( document.activeElement !== colorInput ) colorInput.value = spec.color;
		if ( document.activeElement !== glossRange ) glossRange.value = String( 1 - spec.roughness );
		if ( document.activeElement !== metalRange ) metalRange.value = String( spec.metalness );
		if ( document.activeElement !== opacityRange ) opacityRange.value = String( 1 - spec.opacity );

		textureSelect.value = spec.texture !== null ? spec.texture.id : '';

		if ( spec.texture !== null ) {

			if ( document.activeElement !== scaleRange ) scaleRange.value = String( Math.log( spec.texture.scale ) );
			scaleValue.setTextContent( '×' + spec.texture.scale.toLocaleString( 'pt-BR' ) );

		}

		for ( const button of glossButtons.children ) {

			const level = GLOSS_LEVELS.find( ( item ) => item.id === button.dataset.level );
			button.classList.toggle( 'active', Math.abs( level.roughness - spec.roughness ) < 0.01 );

		}

		glassNote.dom.hidden = spec.opacity >= 1;

	}

	// API --------------------------------------------------------------------------------------

	// retorna false quando o objeto não tem partes com material editável
	function update( object ) {

		if ( object !== owner ) partKey = null;

		owner = object;
		parts = object !== null ? getParts( object ) : [];

		if ( parts.length === 0 ) return false;

		if ( parts.find( ( part ) => part.key === partKey ) === undefined ) partKey = parts[ 0 ].key;

		renderParts();
		refresh();

		return true;

	}

	editor.signals.materialChanged.add( ( object ) => {

		if ( object !== undefined && object === owner ) refresh();

	} );

	return { update, getPartKey: () => partKey };

}

export { SimpleModeAppearancePanel };
