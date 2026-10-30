// EV-009 — Sistema de Plantas Baixas, Cotas e Documentação Técnica
//
// Modo "Planta baixa" do Modo Simples: prancha técnica 2D (SVG) gerada da cena, sobre a área de visualização.
//   - atualiza sozinha quando o projeto 3D muda (enquanto aberta); clicar num elemento seleciona o objeto 3D;
//   - ferramenta "Cota": dois cliques, com encaixe em cantos de paredes, aberturas e ambientes;
//   - painel: nível e altura de corte, escala e folha, camadas, ambientes, cotas, identificação e exportação
//     (SVG, PNG e PDF). Toda alteração de configuração é um SetPlanCommand (desfazer/refazer, salva no JSON).

import { UIDiv } from './libs/ui.js';

import { SetPlanCommand } from './commands/SetPlanCommand.js';

import { buildPlanModel, snapPoints } from './SimpleMode.PlanModel.js';
import { buildDrawing, formatLength, formatArea } from './SimpleMode.PlanDrawing.js';
import { toSVG, renderToCanvas, canvasToPNG } from './SimpleMode.PlanRender.js';
import { toPDF } from './SimpleMode.PlanPdf.js';
import { getPlan, sanitizeDimension, newDimensionId, SCALES, PAPERS, PLAN_LIMITS } from './SimpleMode.PlanData.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton, createText } from './SimpleMode.Icons.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';

const SNAP_PX = 10;
const SHOW_KEYS = [ 'furniture', 'rooms', 'wallDims', 'overallDims', 'openingDims', 'scaleBar', 'north' ];

function SimpleModePlanView( editor, context, container ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const units = context.units;

	const state = { open: false, tool: 'select', drawing: null, model: null, view: { x: 0, y: 0, zoom: 1 }, pending: null, frame: 0, fitted: false };

	// estrutura -------------------------------------------------------------------------------------------------

	const root = new UIDiv().setClass( 'SimplePlan' );
	root.dom.id = 'simple-plan';
	root.dom.setAttribute( 'role', 'region' );
	root.dom.setAttribute( 'aria-label', t( 'plan/title' ) );
	root.dom.hidden = true;
	container.add( root );

	const viewer = document.createElement( 'div' );
	viewer.className = 'SimplePlanViewer';
	root.dom.appendChild( viewer );

	const sheetBox = document.createElement( 'div' );
	sheetBox.className = 'SimplePlanSheet';
	viewer.appendChild( sheetBox );

	const toolbar = document.createElement( 'div' );
	toolbar.className = 'SimplePlanToolbar';
	toolbar.setAttribute( 'role', 'toolbar' );
	toolbar.setAttribute( 'aria-label', t( 'plan/tools' ) );
	viewer.appendChild( toolbar );

	const toolButtons = {};

	for ( const [ id, icon ] of [[ 'select', 'select' ], [ 'dimension', 'measure' ]] ) {

		const button = createSimpleButton( { icon, label: t( 'plan/tool/' + id ), title: t( 'plan/tool/' + id + '/title' ), className: 'SimplePlanTool', onClick: () => setTool( id ) } ).dom;
		button.dataset.tool = id;
		toolbar.appendChild( button );
		toolButtons[ id ] = button;

	}

	toolbar.appendChild( createSimpleButton( { icon: 'frameAll', title: t( 'plan/fit' ), className: 'SimplePlanTool SimplePlanFit', onClick: () => fit() } ).dom );

	const zoomLabel = createText( '100%', 'SimplePlanZoom' );
	toolbar.appendChild( zoomLabel.dom );

	const status = createText( '', 'SimplePlanStatus' );
	status.dom.setAttribute( 'aria-live', 'polite' );
	viewer.appendChild( status.dom );

	// painel de configurações -------------------------------------------------------------------------------------

	const side = document.createElement( 'div' );
	side.className = 'SimplePlanSide';
	root.dom.appendChild( side );

	const header = new UIDiv().setClass( 'SimpleHelpHeader SimplePlanHeader' );
	header.add( createText( t( 'plan/title' ), 'SimpleHelpTitle' ) );
	header.add( createSimpleButton( { icon: 'close', label: t( 'plan/close' ), title: t( 'plan/close/title' ), className: 'SimplePlanClose', onClick: () => close() } ) );
	side.appendChild( header.dom );

	const warnings = document.createElement( 'div' );
	warnings.className = 'SimpleNotice SimplePlanWarnings';
	warnings.setAttribute( 'role', 'status' );
	side.appendChild( warnings );

	function section( key ) {

		const box = document.createElement( 'section' );
		box.className = 'SimplePlanSection';
		box.dataset.section = key;
		box.appendChild( Object.assign( document.createElement( 'h3' ), { className: 'SimplePlanSectionTitle', textContent: t( 'plan/section/' + key ) } ) );
		side.appendChild( box );
		return box;

	}

	function labeled( parent, labelText, control ) {

		const label = document.createElement( 'label' );
		label.className = 'SimplePlanField';
		label.appendChild( Object.assign( document.createElement( 'span' ), { textContent: labelText } ) );
		label.appendChild( control );
		parent.appendChild( label );
		return control;

	}

	function select( parent, labelText, onChange ) {

		const control = labeled( parent, labelText, Object.assign( document.createElement( 'select' ), { className: 'SimpleSelect' } ) );
		control.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		control.addEventListener( 'change', () => onChange( control.value ) );
		return control;

	}

	function textInput( parent, labelText, key, max ) {

		const control = labeled( parent, labelText, Object.assign( document.createElement( 'input' ), { className: 'SimpleTextInput', maxLength: max } ) );
		control.dataset.field = key;
		control.addEventListener( 'keydown', ( event ) => {

			event.stopPropagation();
			if ( event.key === 'Enter' ) control.blur();

		} );
		control.addEventListener( 'change', () => update( { [ key ]: control.value.trim() }, t( 'plan/command/identification' ), key ) );
		return control;

	}

	// nível e corte
	const levelBox = section( 'level' );
	const levelSelect = select( levelBox, t( 'plan/level' ), ( value ) => update( { floorUuid: value === '' ? null : value }, t( 'plan/command/level' ) ) );

	const cutField = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField SimplePlanNumber' );
	const cutInput = new SimpleNumberInput( {
		kind: 'length', units, label: t( 'plan/cut' ), min: PLAN_LIMITS.cutHeight[ 0 ],
		onCommit: ( value ) => {

			if ( value > PLAN_LIMITS.cutHeight[ 1 ] ) {

				context.notify( t( 'plan/cut/range', units.format( PLAN_LIMITS.cutHeight[ 0 ] ), units.format( PLAN_LIMITS.cutHeight[ 1 ] ) ), 'warning' );
				refreshPanel();
				return;

			}

			update( { cutHeight: value }, t( 'plan/command/cut' ), 'cutHeight' );

		},
		onInvalid: () => context.notify( t( 'plan/cut/range', units.format( PLAN_LIMITS.cutHeight[ 0 ] ), units.format( PLAN_LIMITS.cutHeight[ 1 ] ) ), 'warning' )
	} );
	const cutSuffix = createText( '', 'SimpleUnitSuffix' );
	cutField.add( cutInput, cutSuffix );
	labeled( levelBox, t( 'plan/cut' ), cutField.dom );
	const levelHint = createText( '', 'SimpleSectionHint SimplePlanHint' );
	levelBox.appendChild( levelHint.dom );

	// prancha
	const sheetSection = section( 'sheet' );
	const scaleSelect = select( sheetSection, t( 'plan/scale' ), ( value ) => update( { scale: value === 'auto' ? 'auto' : Number( value ) }, t( 'plan/command/scale' ) ) );
	const paperSelect = select( sheetSection, t( 'plan/paper' ), ( value ) => update( { paper: value }, t( 'plan/command/sheet' ) ) );
	for ( const paper of Object.keys( PAPERS ) ) paperSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: paper, textContent: paper } ) );
	const orientationSelect = select( sheetSection, t( 'plan/orientation' ), ( value ) => update( { orientation: value }, t( 'plan/command/sheet' ) ) );
	for ( const value of [ 'landscape', 'portrait' ] ) orientationSelect.appendChild( Object.assign( document.createElement( 'option' ), { value, textContent: t( 'plan/orientation/' + value ) } ) );

	// camadas
	const showSection = section( 'show' );
	const showBoxes = {};

	for ( const key of SHOW_KEYS ) {

		const row = document.createElement( 'label' );
		row.className = 'SimpleCheckboxRow SimplePlanCheck';
		const box = Object.assign( document.createElement( 'input' ), { type: 'checkbox' } );
		box.dataset.show = key;
		box.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		box.addEventListener( 'change', () => {

			const plan = getPlan( editor.scene );
			update( { show: Object.assign( {}, plan.show, { [ key ]: box.checked } ) }, t( 'plan/command/show' ) );

		} );
		row.append( box, Object.assign( document.createElement( 'span' ), { textContent: t( 'plan/show/' + key ) } ) );
		showSection.appendChild( row );
		showBoxes[ key ] = box;

	}

	// ambientes
	const roomSection = section( 'rooms' );
	const roomList = document.createElement( 'div' );
	roomList.className = 'SimplePlanList';
	roomSection.appendChild( roomList );
	const roomTotal = createText( '', 'SimpleSectionHint SimplePlanHint' );
	roomSection.appendChild( roomTotal.dom );

	// cotas do usuário
	const dimSection = section( 'dimensions' );
	const dimList = document.createElement( 'div' );
	dimList.className = 'SimplePlanList';
	dimSection.appendChild( dimList );
	dimSection.appendChild( createText( t( 'plan/dimensions/hint' ), 'SimpleSectionHint SimplePlanHint' ).dom );

	// identificação
	const idSection = section( 'identification' );
	const titleInput = textInput( idSection, t( 'plan/field/title' ), 'title', PLAN_LIMITS.text );
	const authorInput = textInput( idSection, t( 'plan/field/author' ), 'author', PLAN_LIMITS.text );
	const sheetInput = textInput( idSection, t( 'plan/field/sheet' ), 'sheet', 8 );
	const notesInput = textInput( idSection, t( 'plan/field/notes' ), 'notes', PLAN_LIMITS.notes );

	// exportação
	const exportSection = section( 'export' );
	const dpiSelect = labeled( exportSection, t( 'plan/export/dpi' ), Object.assign( document.createElement( 'select' ), { className: 'SimpleSelect' } ) );
	for ( const dpi of [ 150, 300 ] ) dpiSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: String( dpi ), textContent: dpi + ' dpi' } ) );
	dpiSelect.addEventListener( 'keydown', ( event ) => event.stopPropagation() );

	const exportActions = document.createElement( 'div' );
	exportActions.className = 'SimpleActions SimplePlanExport';
	for ( const format of [ 'svg', 'png', 'pdf' ] ) {

		const button = createSimpleButton( { icon: 'image', label: format.toUpperCase(), title: t( 'plan/export/' + format ), onClick: () => exportAs( format ) } ).dom;
		button.dataset.format = format;
		exportActions.appendChild( button );

	}

	exportSection.appendChild( exportActions );
	exportSection.appendChild( createText( t( 'plan/export/hint' ), 'SimpleSectionHint SimplePlanHint' ).dom );

	// dados e comandos ------------------------------------------------------------------------------------------------

	function update( changes, name, attributeName = '' ) {

		const plan = Object.assign( getPlan( editor.scene ), changes );
		editor.execute( new SetPlanCommand( editor, plan, name, attributeName ) );

	}

	function build( selected = editor.selected ) {

		const plan = getPlan( editor.scene );
		const model = buildPlanModel( editor.scene, { floorUuid: plan.floorUuid, cutHeight: plan.cutHeight, rooms: plan.rooms } );
		const drawing = buildDrawing( model, plan, {
			unit: units.getUnit().id,
			projectTitle: editor.config.getKey( 'project/title' ) || '',
			selected: selected !== null && selected !== undefined ? ( selectionRoot( selected ) || selected ).uuid : null
		} );

		return { plan, model, drawing };

	}

	function selectionRoot( object ) {

		// porta/janela hospedada ou componente: o objeto que aparece na planta
		let current = object;
		while ( current !== null && current !== undefined && current !== editor.scene ) {

			if ( state.model !== null && ( state.model.walls.some( ( w ) => w.uuid === current.uuid ) || state.model.furniture.some( ( f ) => f.uuid === current.uuid ) || state.model.rooms.some( ( r ) => r.uuid === current.uuid ) ) ) return current;
			current = current.parent;

		}

		return null;

	}

	// renderização -----------------------------------------------------------------------------------------------------

	let svg = null;
	let preview = null;

	function render() {

		state.frame = 0;
		if ( state.open === false ) return;

		const { model, drawing } = build();
		state.model = model;
		state.drawing = drawing;

		sheetBox.innerHTML = toSVG( drawing, { interactive: true, title: getPlan( editor.scene ).title } ).replace( /^<\?xml[^>]*>\s*/, '' );
		svg = sheetBox.querySelector( 'svg' );
		svg.removeAttribute( 'width' );
		svg.removeAttribute( 'height' );
		svg.setAttribute( 'preserveAspectRatio', 'none' );
		preview = document.createElementNS( 'http://www.w3.org/2000/svg', 'g' );
		preview.setAttribute( 'class', 'p3-preview' );
		svg.appendChild( preview );

		sheetBox.style.aspectRatio = drawing.sheet.width + ' / ' + drawing.sheet.height;
		if ( state.fitted === false ) fit();
		else applyView();

		refreshPanel();
		drawPreview();
		changed.dispatch();

	}

	function schedule() {

		if ( state.open && state.frame === 0 ) state.frame = requestAnimationFrame( render );

	}

	// painel ------------------------------------------------------------------------------------------------------------

	function refreshPanel() {

		const plan = getPlan( editor.scene );
		const model = state.model;
		if ( model === null ) return;

		// níveis
		levelSelect.textContent = '';
		if ( model.levels.length === 0 ) levelSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: '', textContent: t( 'plan/level/none' ) } ) );
		for ( const floor of model.levels ) levelSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: floor.uuid, textContent: `${floor.name} · ${t( 'plan/level/top' )} ${units.format( floor.top )}` } ) );
		levelSelect.value = model.level.floorUuid || '';
		levelSelect.disabled = model.levels.length === 0;

		if ( document.activeElement !== cutInput.dom ) cutInput.setValue( plan.cutHeight );
		cutSuffix.setTextContent( units.getUnit().label );
		levelHint.setTextContent( model.level.source === 'none' ? t( 'plan/level/hint/none' ) : t( 'plan/level/hint', units.format( model.cutY ) ) );

		// escala e folha
		scaleSelect.textContent = '';
		scaleSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: 'auto', textContent: t( 'plan/scale/auto', state.drawing.scale ) } ) );
		for ( const scale of SCALES ) scaleSelect.appendChild( Object.assign( document.createElement( 'option' ), { value: String( scale ), textContent: '1:' + scale } ) );
		scaleSelect.value = String( plan.scale );
		paperSelect.value = plan.paper;
		orientationSelect.value = plan.orientation;

		for ( const key of SHOW_KEYS ) showBoxes[ key ].checked = plan.show[ key ];

		// ambientes
		roomList.textContent = '';
		if ( model.rooms.length === 0 ) roomList.appendChild( createText( t( 'plan/rooms/empty' ), 'SimpleSectionHint' ).dom );

		for ( const room of model.rooms ) {

			const row = document.createElement( 'div' );
			row.className = 'SimplePlanRow';
			row.dataset.room = room.uuid;
			const input = Object.assign( document.createElement( 'input' ), { className: 'SimpleTextInput', value: room.name, maxLength: 40 } );
			input.setAttribute( 'aria-label', t( 'plan/rooms/name' ) );
			input.addEventListener( 'keydown', ( event ) => {

				event.stopPropagation();
				if ( event.key === 'Enter' ) input.blur();

			} );
			input.addEventListener( 'change', () => {

				const current = getPlan( editor.scene );
				const rooms = Object.assign( {}, current.rooms );
				const value = input.value.trim();
				if ( value === '' ) delete rooms[ room.uuid ];
				else rooms[ room.uuid ] = value.slice( 0, 40 );
				update( { rooms }, t( 'plan/command/room' ) );

			} );
			row.append( input, Object.assign( document.createElement( 'span' ), { className: 'SimplePlanArea', textContent: formatArea( room.area ) } ) );
			roomList.appendChild( row );

		}

		roomTotal.setTextContent( model.rooms.length > 0 ? t( 'plan/rooms/total', formatArea( model.rooms.reduce( ( sum, room ) => sum + room.area, 0 ) ) ) : '' );

		// cotas
		dimList.textContent = '';
		if ( plan.dimensions.length === 0 ) dimList.appendChild( createText( t( 'plan/dimensions/empty' ), 'SimpleSectionHint' ).dom );

		plan.dimensions.forEach( ( dim, index ) => {

			const row = document.createElement( 'div' );
			row.className = 'SimplePlanRow';
			row.dataset.dimension = dim.id;
			const length = Math.hypot( dim.b[ 0 ] - dim.a[ 0 ], dim.b[ 1 ] - dim.a[ 1 ] );
			row.appendChild( Object.assign( document.createElement( 'span' ), { className: 'SimplePlanDimLabel', textContent: `${index + 1}. ${units.format( length )}` } ) );

			const offsetField = new UIDiv().setClass( 'SimpleAxisField SimpleUnitField SimplePlanOffset' );
			const offset = new SimpleNumberInput( {
				kind: 'length', units, label: t( 'plan/dimensions/offset' ), min: - PLAN_LIMITS.offset,
				onCommit: ( value ) => {

					const current = getPlan( editor.scene );
					update( { dimensions: current.dimensions.map( ( d ) => ( d.id === dim.id ? Object.assign( {}, d, { offset: Math.min( PLAN_LIMITS.offset, value ) } ) : d ) ) }, t( 'plan/command/dimension' ), 'offset-' + dim.id );

				},
				onInvalid: () => context.notify( t( 'message/invalidNumber' ), 'warning' )
			} );
			offset.setValue( dim.offset );
			offset.dom.title = t( 'plan/dimensions/offset' );
			offsetField.add( offset, createText( units.getUnit().label, 'SimpleUnitSuffix' ) );
			row.appendChild( offsetField.dom );

			const remove = createSimpleButton( { icon: 'delete', title: t( 'plan/dimensions/delete' ), className: 'SimpleIconButton' } ).dom;
			remove.addEventListener( 'click', () => {

				const current = getPlan( editor.scene );
				update( { dimensions: current.dimensions.filter( ( d ) => d.id !== dim.id ) }, t( 'plan/command/dimensionDelete' ) );

			} );
			row.appendChild( remove );
			dimList.appendChild( row );

		} );

		// identificação (sem sobrescrever o que está sendo digitado)
		for ( const [ input, key ] of [[ titleInput, 'title' ], [ authorInput, 'author' ], [ sheetInput, 'sheet' ], [ notesInput, 'notes' ]] ) {

			if ( document.activeElement !== input ) input.value = plan[ key ];

		}

		// avisos
		const messages = state.drawing.warnings.map( ( code ) => t( 'plan/warning/' + code ) );
		warnings.textContent = messages.join( ' ' );
		warnings.hidden = messages.length === 0;

	}

	// navegação na prancha (zoom e arraste) --------------------------------------------------------------------------

	function baseSize() {

		const rect = viewer.getBoundingClientRect();
		const sheet = state.drawing !== null ? state.drawing.sheet : { width: 297, height: 210 };
		const scale = Math.min( ( rect.width - 32 ) / sheet.width, ( rect.height - 72 ) / sheet.height );
		return { width: sheet.width * Math.max( 0.1, scale ), height: sheet.height * Math.max( 0.1, scale ), rect };

	}

	function fit() {

		const base = baseSize();
		state.view = { x: ( base.rect.width - base.width ) / 2, y: Math.max( 52, ( base.rect.height - base.height ) / 2 ), zoom: 1 };
		state.fitted = true;
		applyView();

	}

	function applyView() {

		const base = baseSize();
		sheetBox.style.width = base.width + 'px';
		sheetBox.style.height = base.height + 'px';
		sheetBox.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`;
		zoomLabel.setTextContent( Math.round( state.view.zoom * 100 ) + '%' );

	}

	viewer.addEventListener( 'wheel', ( event ) => {

		if ( state.open === false ) return;
		event.preventDefault();

		const rect = viewer.getBoundingClientRect();
		const factor = Math.pow( 1.0015, - event.deltaY );
		const zoom = Math.min( 20, Math.max( 0.2, state.view.zoom * factor ) );
		const k = zoom / state.view.zoom;
		const mx = event.clientX - rect.left, my = event.clientY - rect.top;

		state.view.x = mx - ( mx - state.view.x ) * k;
		state.view.y = my - ( my - state.view.y ) * k;
		state.view.zoom = zoom;
		applyView();

	}, { passive: false } );

	// coordenadas: tela → mm de papel → metros do mundo
	function paperPoint( event ) {

		if ( svg === null ) return null;
		const rect = svg.getBoundingClientRect();
		if ( rect.width === 0 ) return null;
		const sheet = state.drawing.sheet;
		return [ ( event.clientX - rect.left ) / rect.width * sheet.width, ( event.clientY - rect.top ) / rect.height * sheet.height ];

	}

	function mmPerPixel() {

		const rect = svg.getBoundingClientRect();
		return state.drawing.sheet.width / rect.width;

	}

	// encaixe nos pontos do modelo; sem encaixe, arredonda a 1 cm
	function snap( paper ) {

		const transform = state.drawing.transform;
		const tolerance = SNAP_PX * mmPerPixel();
		let best = null, bestDistance = tolerance;

		for ( const point of snapPoints( state.model ) ) {

			const p = transform.toPaper( point );
			const distance = Math.hypot( p[ 0 ] - paper[ 0 ], p[ 1 ] - paper[ 1 ] );
			if ( distance <= bestDistance ) {

				best = point;
				bestDistance = distance;

			}

		}

		if ( best !== null ) return { world: best.slice(), snapped: true };
		const world = transform.toWorld( paper ).map( ( v ) => Math.round( v * 100 ) / 100 );
		return { world, snapped: false };

	}

	let drag = null;
	let hover = null;

	viewer.addEventListener( 'pointerdown', ( event ) => {

		if ( state.open === false || event.target.closest( '.SimplePlanToolbar' ) !== null ) return;
		drag = { x: event.clientX, y: event.clientY, vx: state.view.x, vy: state.view.y, moved: 0, button: event.button };
		viewer.setPointerCapture( event.pointerId );

	} );

	viewer.addEventListener( 'pointermove', ( event ) => {

		if ( drag !== null ) {

			const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
			drag.moved = Math.max( drag.moved, Math.hypot( dx, dy ) );

			if ( drag.moved > 4 && ( state.tool === 'select' || drag.button !== 0 ) ) {

				state.view.x = drag.vx + dx;
				state.view.y = drag.vy + dy;
				applyView();
				viewer.classList.add( 'panning' );

			}

		}

		if ( state.tool === 'dimension' && state.drawing !== null ) {

			const paper = paperPoint( event );
			hover = paper !== null ? snap( paper ) : null;
			drawPreview();

		}

	} );

	viewer.addEventListener( 'pointerup', ( event ) => {

		const click = drag !== null && drag.moved <= 4 && drag.button === 0;
		drag = null;
		viewer.classList.remove( 'panning' );
		if ( click === false || state.drawing === null ) return;

		if ( state.tool === 'select' ) {

			// com a captura do ponteiro o alvo do evento é o visualizador: o elemento clicado vem da posição
			const hit = document.elementFromPoint( event.clientX, event.clientY );
			const target = hit !== null ? hit.closest( '[data-uuid]' ) : null;
			const object = target !== null ? editor.objectByUuid( target.dataset.uuid ) : undefined;
			if ( object !== undefined ) editor.select( object );
			else editor.deselect();
			return;

		}

		const paper = paperPoint( event );
		if ( paper === null ) return;
		const point = snap( paper );

		if ( state.pending === null ) {

			state.pending = point.world;
			drawPreview();
			return;

		}

		const dimension = sanitizeDimension( { id: newDimensionId(), a: state.pending, b: point.world, offset: 0 } );
		state.pending = null;

		if ( dimension === null ) {

			context.notify( t( 'plan/dimensions/tooShort' ), 'warning' );
			drawPreview();
			return;

		}

		const plan = getPlan( editor.scene );
		if ( plan.dimensions.length >= PLAN_LIMITS.dimensions ) return context.notify( t( 'plan/dimensions/limit', PLAN_LIMITS.dimensions ), 'warning' );

		update( { dimensions: plan.dimensions.concat( dimension ) }, t( 'plan/command/dimensionAdd' ) );
		context.notify( t( 'plan/dimensions/added', units.format( Math.hypot( dimension.b[ 0 ] - dimension.a[ 0 ], dimension.b[ 1 ] - dimension.a[ 1 ] ) ) ), 'success' );

	} );

	// prévia da cota (marcador de encaixe + linha até o cursor)
	function drawPreview() {

		if ( preview === null ) return;
		preview.textContent = '';
		if ( state.tool !== 'dimension' || state.drawing === null ) return;

		const transform = state.drawing.transform;
		const ns = 'http://www.w3.org/2000/svg';
		const r = 1.6 * mmPerPixel() * 4;

		if ( hover !== null ) {

			const p = transform.toPaper( hover.world );
			const marker = document.createElementNS( ns, 'circle' );
			marker.setAttribute( 'cx', p[ 0 ] ); marker.setAttribute( 'cy', p[ 1 ] ); marker.setAttribute( 'r', r );
			marker.setAttribute( 'class', hover.snapped ? 'p3-snap snapped' : 'p3-snap' );
			preview.appendChild( marker );

		}

		if ( state.pending !== null ) {

			const a = transform.toPaper( state.pending );
			const b = hover !== null ? transform.toPaper( hover.world ) : a;
			const line = document.createElementNS( ns, 'line' );
			line.setAttribute( 'x1', a[ 0 ] ); line.setAttribute( 'y1', a[ 1 ] ); line.setAttribute( 'x2', b[ 0 ] ); line.setAttribute( 'y2', b[ 1 ] );
			line.setAttribute( 'class', 'p3-preview-line' );
			preview.appendChild( line );

			if ( hover !== null ) {

				const label = document.createElementNS( ns, 'text' );
				label.setAttribute( 'x', ( a[ 0 ] + b[ 0 ] ) / 2 ); label.setAttribute( 'y', ( a[ 1 ] + b[ 1 ] ) / 2 - 1.5 );
				label.setAttribute( 'text-anchor', 'middle' ); label.setAttribute( 'font-size', '2.6' ); label.setAttribute( 'class', 'p3-preview-label' );
				label.textContent = formatLength( Math.hypot( hover.world[ 0 ] - state.pending[ 0 ], hover.world[ 1 ] - state.pending[ 1 ] ), units.getUnit().id ) + ' ' + units.getUnit().label;
				preview.appendChild( label );

			}

		}

		status.setTextContent( state.pending === null ? t( 'plan/status/dimension/first' ) : t( 'plan/status/dimension/second' ) );

	}

	function setTool( id ) {

		state.tool = id;
		state.pending = null;
		hover = null;
		for ( const [ key, button ] of Object.entries( toolButtons ) ) {

			button.classList.toggle( 'active', key === id );
			button.setAttribute( 'aria-pressed', key === id );

		}

		viewer.classList.toggle( 'dimensioning', id === 'dimension' );
		status.setTextContent( id === 'dimension' ? t( 'plan/status/dimension/first' ) : t( 'plan/status/select' ) );
		drawPreview();

	}

	// exportação ------------------------------------------------------------------------------------------------------------

	function fileBase() {

		const title = ( editor.config.getKey( 'project/title' ) || 'projeto' ).trim().normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[\\/:*?"<>|]+/g, '' ).replace( /\s+/g, '-' ) || 'projeto';
		return title + '-planta';

	}

	async function exportAs( format ) {

		try {

			const { plan, drawing } = build( null ); // arquivos nunca levam o destaque da seleção
			let blob;

			if ( format === 'svg' ) blob = new Blob( [ toSVG( drawing, { title: plan.title } ) ], { type: 'image/svg+xml' } );
			else if ( format === 'png' ) {

				const canvas = renderToCanvas( drawing, Number( dpiSelect.value ) );
				blob = await canvasToPNG( canvas );
				canvas.width = 0; canvas.height = 0;

			} else blob = toPDF( drawing, { title: `${editor.config.getKey( 'project/title' ) || ''} — ${plan.title}`, author: plan.author } );

			const name = fileBase() + '.' + format;
			editor.utils.save( blob, name );
			context.notify( t( 'plan/export/done', name ), 'success' );
			return { name, blob, drawing };

		} catch ( error ) {

			console.error( error );
			context.notify( t( 'plan/export/error' ), 'error' );
			return null;

		}

	}

	// abrir e fechar ------------------------------------------------------------------------------------------------------

	function open() {

		if ( state.open ) return;

		context.interaction.deactivate(); // nenhuma ferramenta do viewport fica ativa por trás da prancha
		if ( context.lightingPanel !== undefined ) context.lightingPanel.close();

		state.open = true;
		state.fitted = false;
		root.dom.hidden = false;
		document.body.classList.add( 'plan-open' );
		setTool( 'select' );
		render();

	}

	function close() {

		if ( state.open === false ) return;

		state.open = false;
		cancelAnimationFrame( state.frame );
		state.frame = 0;
		root.dom.hidden = true;
		document.body.classList.remove( 'plan-open' );
		sheetBox.textContent = '';
		svg = null;
		preview = null;
		changed.dispatch();

	}

	// atualização automática quando o projeto muda (só com a planta aberta)
	for ( const signal of [ 'sceneGraphChanged', 'objectChanged', 'geometryChanged', 'historyChanged', 'objectSelected' ] ) editor.signals[ signal ].add( schedule );
	units.changed.add( schedule );
	editor.signals.editorCleared.add( () => {

		state.fitted = false;
		schedule();

	} );
	window.addEventListener( 'resize', () => ( state.open ? fit() : null ) ); // a área muda: a prancha volta a caber inteira

	document.addEventListener( 'keydown', ( event ) => {

		if ( state.open === false || event.target.closest?.( 'input, textarea, select' ) ) return;

		if ( event.key === 'Escape' ) {

			event.preventDefault();
			if ( state.tool === 'dimension' && state.pending !== null ) {

				state.pending = null;
				drawPreview();

			} else if ( state.tool === 'dimension' ) setTool( 'select' );
			else close();

		}

	} );

	return { changed, state, open, close, toggle: () => ( state.open ? close() : open() ), isOpen: () => state.open, exportAs, setTool, fit, build, render };

}

export { SimpleModePlanView };
