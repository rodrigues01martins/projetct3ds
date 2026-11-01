// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Janela "Importar modelo 3D" / "Pré-visualizar modelo": leitura com indicador e cancelamento, pré-visualização,
// informações (arquivo, formato, tamanho, malhas, vértices, triângulos, materiais, texturas, dimensões), ajustes
// (dimensões com "Manter proporções", escala uniforme, orientação, base), categoria, nome, licença e avisos.
// Selecionar um arquivo NUNCA insere nada: inserir e salvar são ações explícitas, e ambas exigem a verificação de
// preservação (o modelo precisa sobreviver ao ciclo salvar/reabrir do projeto — regra fundamental da EV-013).

import * as THREE from 'three';

import { ExternalModelPreview } from './SimpleMode.ExternalModelPreview.js';
import { loadExternalModel, cancelActiveImport, verifyRoundTrip, CancelledError } from './SimpleMode.ExternalModelLoader.js';
import { attachPreview, createInstance } from './SimpleMode.ExternalModelInstances.js';
import { UPRIGHT, defaultSettings, sanitizeSettings, scaledSize, scaleForDimension, scaleForFactor } from './SimpleMode.ExternalModelTransforms.js';
import { MODEL_CATEGORIES, MODEL_RECORD_LIMITS, cleanModelText, cleanKeywords, cleanLicense } from './SimpleMode.ExternalModelStorage.js';
import { ModelError } from './SimpleMode.ExternalModelValidation.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';
import { formatBytes } from './SimpleMode.ProjectData.js';
import { createSimpleButton } from './SimpleMode.Icons.js';
import { newId } from './SimpleMode.ReviewData.js';

const PROJECT_SIZE_WARNING = 25 * 1024 * 1024;

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function button( label, onClick, { icon, className = '', title } = {} ) {

	return createSimpleButton( { icon, label, title: title || label, className, onClick } ).dom;

}

function SimpleModeExternalModelPanel( editor, context, library, root ) {

	const units = context.units;
	const dialog = context.dialog;

	const overlay = el( 'div', 'SimpleModelOverlay' );
	overlay.id = 'simple-model-import';
	overlay.hidden = true;
	const panel = el( 'div', 'SimpleModelPanel' );
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-modal', 'true' );
	panel.setAttribute( 'aria-labelledby', 'simple-model-title' );
	overlay.appendChild( panel );
	root.appendChild( overlay );

	const state = {
		open: false, mode: 'import', phase: 'idle', loaded: null, record: null, template: null, adopted: false,
		settings: defaultSettings(), size: null, verification: null, preview: null, busy: false,
		form: { name: '', category: 'furniture', keywords: '', license: cleanLicense( {} ) }, error: null, token: 0
	};

	// estrutura ------------------------------------------------------------------------------------------------------

	function header( title ) {

		const head = el( 'div', 'SimpleModelHeader' );
		const h = el( 'h2', 'SimpleModelTitle', title );
		h.id = 'simple-model-title';
		head.append( h, button( 'Fechar', () => close(), { icon: 'close', className: 'SimpleModelClose' } ) );
		return head;

	}

	function renderLoading( name ) {

		panel.textContent = '';
		panel.appendChild( header( 'Importar modelo 3D' ) );
		const body = el( 'div', 'SimpleModelStatus' );
		body.setAttribute( 'role', 'status' );
		body.append( el( 'span', 'SimpleModelSpinner' ), el( 'p', '', `Lendo "${name}" localmente e verificando o conteúdo…` ) );
		panel.appendChild( body );
		const actions = el( 'div', 'SimpleModelActions' );
		actions.appendChild( button( 'Cancelar', () => close(), { className: 'SimpleModelCancel' } ) );
		panel.appendChild( actions );

	}

	function renderError( error ) {

		panel.textContent = '';
		panel.appendChild( header( 'Importar modelo 3D' ) );
		const body = el( 'div', 'SimpleModelStatus error' );
		body.setAttribute( 'role', 'alert' );
		body.appendChild( el( 'p', 'SimpleModelErrorText', error.message ) );
		if ( Array.isArray( error.details ) && error.details.length > 0 ) {

			const list = el( 'ul', 'SimpleModelErrorList' );
			for ( const item of error.details ) list.appendChild( el( 'li', '', item ) );
			body.appendChild( list );

		}

		body.appendChild( el( 'p', 'SimpleModelHint', 'Nada foi adicionado ao projeto.' ) );
		panel.appendChild( body );
		const actions = el( 'div', 'SimpleModelActions' );
		actions.append( button( 'Escolher outro arquivo', () => {

			close();
			context.importExternalModel();

		}, { icon: 'open', className: 'SimpleModelRetry' } ), button( 'Fechar', () => close(), { className: 'active SimpleModelCancel' } ) );
		panel.appendChild( actions );

	}

	function renderMain() {

		panel.textContent = '';
		const isRecord = state.mode === 'record';
		panel.appendChild( header( isRecord ? 'Modelo da biblioteca' : 'Pré-visualizar modelo' ) );

		const body = el( 'div', 'SimpleModelBody' );
		panel.appendChild( body );

		// pré-visualização
		const left = el( 'div', 'SimpleModelPreviewColumn' );
		const host = el( 'div', 'SimpleModelPreviewHost' );
		host.setAttribute( 'aria-label', 'Pré-visualização 3D (arraste para girar, role para ampliar)' );
		left.appendChild( host );
		const tools = el( 'div', 'SimpleModelPreviewTools' );
		tools.append(
			createSimpleButton( { icon: 'previous', title: 'Girar a vista à esquerda', className: 'SimpleIconButton SimpleModelOrbit', onClick: () => state.preview.rotate( - 30 ) } ).dom,
			createSimpleButton( { icon: 'next', title: 'Girar a vista à direita', className: 'SimpleIconButton SimpleModelOrbit', onClick: () => state.preview.rotate( 30 ) } ).dom,
			button( 'Ampliar', () => state.preview.zoom( 0.8 ), { className: 'SimpleModelZoomIn', title: 'Ampliar' } ),
			button( 'Reduzir', () => state.preview.zoom( 1.25 ), { className: 'SimpleModelZoomOut', title: 'Reduzir' } ),
			button( 'Enquadrar', () => state.preview.frameModel(), { icon: 'frameAll', className: 'SimpleModelFrame', title: 'Restaurar enquadramento' } )
		);
		const gridRow = el( 'label', 'SimpleCheckboxRow' );
		const gridBox = el( 'input' );
		gridBox.type = 'checkbox';
		gridBox.checked = true;
		gridBox.className = 'SimpleModelGrid';
		gridBox.addEventListener( 'change', () => state.preview.setGrid( gridBox.checked ) );
		gridRow.append( gridBox, el( 'span', '', 'Grade' ) );
		tools.appendChild( gridRow );
		left.appendChild( tools );
		left.appendChild( renderInfo() );
		body.appendChild( left );

		// ajustes
		const right = el( 'div', 'SimpleModelSettings' );
		right.appendChild( renderIdentity() );
		right.appendChild( renderDimensions() );
		right.appendChild( renderOrientation() );
		right.appendChild( renderLicense() );
		right.appendChild( renderWarnings() );
		body.appendChild( right );

		const actions = el( 'div', 'SimpleModelActions' );
		const ready = state.verification !== null && state.verification.ok;
		if ( isRecord ) {

			actions.append(
				button( 'Excluir da biblioteca', () => removeRecord(), { icon: 'delete', className: 'danger SimpleModelDelete' } ),
				button( 'Exportar original', () => exportOriginal(), { icon: 'save', className: 'SimpleModelExport' } ),
				button( 'Salvar alterações', () => saveRecord(), { icon: 'bookmark', className: 'SimpleModelSave' } )
			);

		} else {

			actions.append(
				button( 'Cancelar', () => close(), { className: 'SimpleModelCancel' } ),
				button( 'Salvar na biblioteca', () => saveToLibrary(), { icon: 'bookmark', className: 'SimpleModelSave' } )
			);

		}

		actions.append(
			button( 'Posicionar na cena', () => place(), { icon: 'place', className: 'SimpleModelPlace' } ),
			button( 'Inserir no projeto', () => insert(), { icon: 'add', className: 'active SimpleModelInsert' } )
		);
		for ( const node of actions.querySelectorAll( '.SimpleModelSave, .SimpleModelPlace, .SimpleModelInsert' ) ) node.disabled = ready === false || state.busy;
		panel.appendChild( actions );

		state.preview = new ExternalModelPreview( host );
		attachPreview( state.preview.holder, state.template, state.settings );
		state.preview.frameModel();

	}

	function renderInfo() {

		const box = el( 'dl', 'SimpleModelInfo' );
		const add = ( label, value, key ) => {

			const dt = el( 'dt', '', label ), dd = el( 'dd', '', value );
			if ( key ) dd.dataset.info = key;
			box.append( dt, dd );

		};

		const info = state.loaded !== null ? state.loaded.info : { fileName: state.record.originalName, format: state.record.format, size: state.record.size, auxNames: state.record.auxNames || [] };
		const stats = state.loaded !== null ? state.loaded.stats : state.record.stats;
		add( 'Arquivo', info.fileName + ( info.auxNames.length > 0 ? ` (+ ${info.auxNames.length} auxiliar(es))` : '' ), 'file' );
		add( 'Formato', info.format.toUpperCase(), 'format' );
		add( 'Tamanho', formatBytes( info.size ), 'size' );
		add( 'Malhas', String( stats.meshes ), 'meshes' );
		add( 'Vértices', stats.vertices.toLocaleString( 'pt-BR' ), 'vertices' );
		add( 'Triângulos', Math.round( stats.triangles ).toLocaleString( 'pt-BR' ), 'triangles' );
		add( 'Materiais', String( stats.materials ), 'materials' );
		add( 'Texturas', String( stats.textures ), 'textures' );
		const size = scaledSize( state.size, state.settings );
		add( 'Dimensões', `${units.format( size.x )} × ${units.format( size.y )} × ${units.format( size.z )} (L × A × P)`, 'dimensions' );
		if ( state.loaded !== null && state.loaded.info.copyright !== '' ) add( 'Declarado no arquivo', state.loaded.info.copyright, 'copyright' );
		return box;

	}

	function renderIdentity() {

		const section = el( 'fieldset', 'SimpleModelSection' );
		section.appendChild( el( 'legend', '', 'Identificação' ) );
		const name = el( 'input', 'SimpleInput SimpleModelName' );
		name.maxLength = MODEL_RECORD_LIMITS.name;
		name.value = state.form.name;
		name.addEventListener( 'input', () => {

			state.form.name = name.value;

		} );
		const category = el( 'select', 'SimpleSelect SimpleModelCategory' );
		for ( const option of MODEL_CATEGORIES ) {

			const node = el( 'option', '', option.name );
			node.value = option.id;
			category.appendChild( node );

		}

		category.value = state.form.category;
		category.addEventListener( 'change', () => {

			state.form.category = category.value;

		} );
		const keywords = el( 'input', 'SimpleInput SimpleModelKeywords' );
		keywords.placeholder = 'Ex.: escritório, giratória';
		keywords.value = state.form.keywords;
		keywords.addEventListener( 'input', () => {

			state.form.keywords = keywords.value;

		} );
		section.append( labeled( 'Nome', name ), labeled( 'Categoria', category ), labeled( 'Palavras-chave', keywords ) );
		return section;

	}

	function labeled( text, input ) {

		const label = el( 'label', 'SimpleModelField' );
		label.append( el( 'span', '', text ), input );
		return label;

	}

	function renderDimensions() {

		const section = el( 'fieldset', 'SimpleModelSection' );
		section.appendChild( el( 'legend', '', 'Dimensões do modelo' ) );
		section.appendChild( el( 'p', 'SimpleModelHint', 'O glTF usa metros. A unidade do projeto muda só a apresentação; corrija a escala apenas se o arquivo veio com tamanho errado.' ) );
		const size = scaledSize( state.size, state.settings );
		const grid = el( 'div', 'SimpleModelDims' );
		[[ 'width', 'Largura' ], [ 'height', 'Altura' ], [ 'depth', 'Profundidade' ]].forEach( ( [ key, label ], axis ) => {

			const input = new SimpleNumberInput( {
				kind: 'length', units, label, min: 0, exclusiveMin: true,
				onCommit: ( value ) => setDimension( axis, value ),
				onInvalid: () => context.notify( 'Valor inválido.', 'warning' )
			} );
			input.dom.dataset.field = key;
			input.setValue( size.getComponent( axis ) );
			const field = el( 'label', 'SimpleModelField' );
			field.append( el( 'span', '', `${label} (${units.getUnit().label})` ), input.dom );
			grid.appendChild( field );

		} );
		section.appendChild( grid );

		const scale = new SimpleNumberInput( {
			kind: 'factor', label: 'Escala uniforme', min: 0, exclusiveMin: true,
			onCommit: ( value ) => setUniformScale( value ),
			onInvalid: () => context.notify( 'Valor inválido.', 'warning' )
		} );
		scale.dom.dataset.field = 'scale';
		scale.setValue( state.settings.scale[ 0 ] );
		const scaleField = el( 'label', 'SimpleModelField' );
		scaleField.append( el( 'span', '', 'Escala uniforme (×)' ), scale.dom );
		section.appendChild( scaleField );

		const keep = el( 'label', 'SimpleCheckboxRow' );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.className = 'SimpleModelUniform';
		box.checked = state.settings.uniform;
		box.addEventListener( 'change', () => {

			state.settings.uniform = box.checked;
			if ( box.checked ) state.settings.scale = [ state.settings.scale[ 0 ], state.settings.scale[ 0 ], state.settings.scale[ 0 ] ];
			applySettings( false );

		} );
		keep.append( box, el( 'span', '', 'Manter proporções' ) );
		section.appendChild( keep );
		if ( state.settings.uniform === false ) section.appendChild( el( 'p', 'SimpleModelWarning', 'Redimensionar os eixos de forma independente pode deformar o modelo.' ) );
		return section;

	}

	function renderOrientation() {

		const section = el( 'fieldset', 'SimpleModelSection' );
		section.appendChild( el( 'legend', '', 'Orientação e base' ) );
		const row = el( 'div', 'SimpleModelRow' );
		row.append(
			button( '−90° (Y)', () => rotate( - 90 ), { className: 'SimpleModelRotate', title: 'Girar −90° em torno do eixo vertical' } ),
			button( '+90° (Y)', () => rotate( 90 ), { className: 'SimpleModelRotate', title: 'Girar +90° em torno do eixo vertical' } ),
			button( 'Restaurar', () => {

				state.settings.rotationY = 0;
				state.settings.upright = 'none';
				applySettings( true );

			}, { className: 'SimpleModelRestore', title: 'Restaurar orientação original' } )
		);
		row.querySelectorAll( '.SimpleModelRotate' )[ 0 ].dataset.dir = '-90';
		row.querySelectorAll( '.SimpleModelRotate' )[ 1 ].dataset.dir = '90';
		section.appendChild( row );
		const upright = el( 'select', 'SimpleSelect SimpleModelUpright' );
		for ( const [ key, value ] of Object.entries( UPRIGHT ) ) {

			const option = el( 'option', '', value.label );
			option.value = key;
			upright.appendChild( option );

		}

		upright.value = state.settings.upright;
		upright.addEventListener( 'change', () => {

			state.settings.upright = upright.value;
			applySettings( true );

		} );
		section.appendChild( labeled( 'Orientação vertical', upright ) );
		section.appendChild( el( 'p', 'SimpleModelHint', `Giro em Y: ${state.settings.rotationY}°` ) );

		const base = el( 'label', 'SimpleCheckboxRow' );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.className = 'SimpleModelBase';
		box.checked = state.settings.base;
		box.addEventListener( 'change', () => {

			state.settings.base = box.checked;
			applySettings( true );

		} );
		base.append( box, el( 'span', '', 'Ajustar base do modelo (base em Y = 0, centro na origem)' ) );
		section.appendChild( base );
		if ( state.settings.base === false ) section.appendChild( el( 'p', 'SimpleModelHint', 'Usando o pivô original do arquivo.' ) );
		return section;

	}

	function renderLicense() {

		const section = el( 'details', 'SimpleModelSection SimpleModelLicense' );
		section.appendChild( el( 'summary', '', 'Licença e origem (opcional)' ) );
		section.appendChild( el( 'p', 'SimpleModelHint', 'Registre o que você sabe sobre o modelo. Importar não significa que ele possa ser redistribuído: confira a licença antes de compartilhar projetos.' ) );
		for ( const [ key, label, max ] of [[ 'author', 'Autor', 200 ], [ 'source', 'Fonte', 200 ], [ 'url', 'URL de origem (apenas texto)', 200 ], [ 'license', 'Tipo de licença', 200 ], [ 'notes', 'Observações de uso', 600 ]] ) {

			const input = el( key === 'notes' ? 'textarea' : 'input', 'SimpleInput' );
			input.dataset.license = key;
			input.maxLength = max;
			input.value = state.form.license[ key ];
			input.addEventListener( 'input', () => {

				state.form.license[ key ] = input.value;

			} );
			section.appendChild( labeled( label, input ) );

		}

		if ( Object.values( state.form.license ).some( ( v ) => v !== '' ) ) section.open = true;
		return section;

	}

	function renderWarnings() {

		const box = el( 'div', 'SimpleModelWarnings' );
		box.setAttribute( 'aria-live', 'polite' );
		const warnings = state.loaded !== null ? state.loaded.warnings : [];
		for ( const warning of warnings ) box.appendChild( el( 'p', 'SimpleModelWarning', warning ) );
		const verification = state.verification;
		if ( verification === null ) box.appendChild( el( 'p', 'SimpleModelHint SimpleModelVerify', 'Verificando se o modelo é preservado ao salvar e reabrir o projeto…' ) );
		else if ( verification.ok ) box.appendChild( el( 'p', 'SimpleModelOk SimpleModelVerify', `Preservação verificada: geometria, materiais e texturas sobrevivem ao salvar e reabrir (≈ ${formatBytes( verification.bytes )} no projeto por modelo).` ) );
		else {

			box.appendChild( el( 'p', 'SimpleModelErrorText SimpleModelVerify', 'O modelo não pode ser inserido nem salvo: ele não seria preservado ao salvar o projeto.' ) );
			const list = el( 'ul', 'SimpleModelErrorList' );
			for ( const problem of verification.problems ) list.appendChild( el( 'li', '', problem ) );
			box.appendChild( list );

		}

		return box;

	}

	// ajustes ---------------------------------------------------------------------------------------------------------

	function applySettings( reframe ) {

		state.settings = sanitizeSettings( state.settings );
		const result = attachPreview( state.preview.holder, state.template, state.settings );
		state.size = result.size;
		const preview = state.preview;
		const scroll = panel.querySelector( '.SimpleModelSettings' ) ? panel.querySelector( '.SimpleModelSettings' ).scrollTop : 0;
		state.preview = null;
		preview.close();
		renderMain();
		const settings = panel.querySelector( '.SimpleModelSettings' );
		if ( settings ) settings.scrollTop = scroll;
		if ( reframe === false ) state.preview.request();

	}

	function rotate( delta ) {

		state.settings.rotationY = ( ( state.settings.rotationY + delta ) % 360 + 360 ) % 360;
		applySettings( true );

	}

	function setDimension( axis, value ) {

		const scale = scaleForDimension( state.size, state.settings, axis, value );
		if ( scale === null ) {

			context.notify( 'Dimensão fora dos limites (entre 1 mm e 1.000 m, escala finita).', 'warning' );
			applySettings( false );
			return;

		}

		state.settings.scale = scale;
		applySettings( false );

	}

	function setUniformScale( value ) {

		const scale = scaleForFactor( state.size, value );
		if ( scale === null ) {

			context.notify( 'Escala fora dos limites.', 'warning' );
			applySettings( false );
			return;

		}

		state.settings.scale = scale;
		state.settings.uniform = true;
		applySettings( false );

	}

	// ciclo de vida ---------------------------------------------------------------------------------------------------

	async function verify() {

		const token = state.token;
		const asset = currentAsset();
		const probe = createInstance( state.template, asset, state.settings );
		try {

			const result = await verifyRoundTrip( probe );
			if ( token === state.token ) state.verification = result;

		} catch ( error ) {

			console.error( error );
			if ( token === state.token ) state.verification = { ok: false, problems: [ 'falha ao reconstruir o modelo a partir dos dados salvos' ], bytes: 0 };

		} finally {

			probe.traverse( ( child ) => {

				if ( child.isMesh ) for ( const material of [].concat( child.material ) ) material.dispose(); // só as cópias desta sonda

			} );

		}

		if ( token === state.token && state.open ) applySettings( false );

	}

	function currentAsset() {

		if ( state.mode === 'record' ) return Object.assign( library.assetOf( state.record ), { name: cleanModelText( state.form.name, MODEL_RECORD_LIMITS.name ) || state.record.name, category: state.form.category } );
		return { id: state.assetId, name: cleanModelText( state.form.name, MODEL_RECORD_LIMITS.name ) || 'Modelo importado', category: state.form.category, format: state.loaded.info.format, originalName: state.loaded.info.fileName, hash: state.hash || null };

	}

	function show() {

		state.open = true;
		overlay.hidden = false;
		if ( context.interaction !== undefined ) context.interaction.deactivate();

	}

	async function openFiles( files ) {

		if ( state.open ) close();
		show();
		state.mode = 'import';
		state.token ++;
		const token = state.token;
		const list = Array.from( files );
		renderLoading( ( list.find( ( f ) => /\.(glb|gltf)$/i.test( f.name ) ) || list[ 0 ] || { name: 'arquivo' } ).name );

		try {

			const loaded = await loadExternalModel( list, { config: editor.config } );
			if ( token !== state.token || state.open === false ) {

				library.forget( loaded.object );
				return;

			}

			state.loaded = loaded;
			state.record = null;
			state.template = loaded.object;
			state.adopted = false;
			state.assetId = newId();
			state.settings = defaultSettings();
			state.verification = null;
			state.form = { name: loaded.info.fileName.replace( /\.(glb|gltf)$/i, '' ).replace( /[_-]+/g, ' ' ).trim().slice( 0, MODEL_RECORD_LIMITS.name ) || 'Modelo importado', category: 'furniture', keywords: '', license: cleanLicense( {} ) };
			state.size = null;
			state.hash = await library.hashFiles( loaded.files );
			state.preview = null;
			measureAndRender();
			verify();

		} catch ( error ) {

			if ( error instanceof CancelledError || token !== state.token ) return;
			if ( error instanceof ModelError === false ) console.error( error );
			renderError( error instanceof ModelError ? error : new ModelError( 'Não foi possível importar o modelo.' ) );

		}

	}

	async function openRecord( record ) {

		if ( state.open ) close();
		show();
		state.mode = 'record';
		state.token ++;
		const token = state.token;
		renderLoading( record.name );

		try {

			const template = await library.loadTemplate( record );
			if ( token !== state.token || state.open === false ) return;
			state.loaded = null;
			state.record = record;
			state.template = template;
			state.adopted = true; // pertence ao cache da biblioteca
			state.settings = sanitizeSettings( record.defaults );
			state.verification = null;
			state.form = { name: record.name, category: record.category, keywords: ( record.keywords || [] ).join( ', ' ), license: cleanLicense( record.license ) };
			state.preview = null;
			measureAndRender();
			verify();

		} catch ( error ) {

			if ( token !== state.token ) return;
			renderError( error instanceof ModelError ? error : new ModelError( error.message || 'Não foi possível abrir o modelo da biblioteca.' ) );

		}

	}

	function measureAndRender() {

		// dimensões sem escala (orientação/base aplicadas) medidas num grupo provisório fora da cena
		const holder = new THREE.Group();
		const result = attachPreview( holder, state.template, state.settings );
		state.size = result.size;
		state.template.removeFromParent();
		renderMain();

	}

	function close() {

		if ( state.open === false ) return;
		state.open = false;
		state.token ++;
		overlay.hidden = true;
		cancelActiveImport();
		if ( state.preview !== null ) {

			state.preview.close();
			state.preview = null;

		}

		if ( state.template !== null ) {

			state.template.removeFromParent();
			// modelo que não foi salvo nem inserido: todos os seus recursos são liberados
			if ( state.adopted === false && library.isCached( state.template ) === false ) library.forget( state.template );

		}

		state.template = null;
		state.loaded = null;
		state.record = null;
		panel.textContent = '';

	}

	// ações -----------------------------------------------------------------------------------------------------------

	function projectSizeWarning( bytes ) {

		const total = bytes * ( 1 + countInstances( currentAsset().id ) );
		if ( total > PROJECT_SIZE_WARNING ) context.notify( `O projeto ficará maior (≈ ${formatBytes( total )} de modelos importados): salvamentos automáticos, versões e backups ocuparão mais espaço no navegador.`, 'warning' );

	}

	function countInstances( assetId ) {

		let count = 0;
		editor.scene.traverse( ( object ) => {

			const meta = object.userData.project3ds;
			if ( meta && meta.importedAsset && meta.importedAsset.assetId === assetId ) count ++;

		} );
		return count;

	}

	function buildInstance() {

		const instance = createInstance( state.template, currentAsset(), state.settings );
		library.remember( currentAsset().id, state.template ); // o modelo decodificado passa a ser usado pela cena
		state.adopted = true;
		return instance;

	}

	function insert() {

		if ( state.verification === null || state.verification.ok === false ) return;
		const instance = buildInstance();
		projectSizeWarning( state.verification.bytes );
		close();
		context.insertImportedModel( instance );

	}

	function place() {

		if ( state.verification === null || state.verification.ok === false ) return;
		const template = state.template, asset = currentAsset(), settings = sanitizeSettings( state.settings );
		const heavy = ( state.loaded !== null ? state.loaded.stats.vertices : state.record.stats.vertices ) > 150000;
		library.remember( asset.id, template );
		state.adopted = true;
		projectSizeWarning( state.verification.bytes );
		close();
		context.startTool( 'place', { name: asset.name, create: () => createInstance( template, asset, settings ), simplePreview: heavy } );

	}

	async function saveToLibrary() {

		if ( state.busy || state.verification === null || state.verification.ok === false ) return;
		const name = cleanModelText( state.form.name, MODEL_RECORD_LIMITS.name );
		if ( name === '' ) {

			context.notify( 'Informe um nome para o modelo.', 'warning' );
			return;

		}

		state.busy = true;
		try {

			const duplicates = await library.storage.findByHash( state.hash );
			if ( duplicates.length > 0 ) {

				const choice = await dialog.ask( { title: 'Modelo já existe na biblioteca', message: `O mesmo arquivo já está salvo como "${duplicates[ 0 ].name}". Salvar outra cópia?`, choices: [ { id: 'copy', label: 'Salvar outra cópia', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice !== 'copy' ) return;

			}

			const thumbnail = state.preview !== null ? state.preview.thumbnail() : null;
			const saved = await library.save( state.loaded, {
				id: state.assetId,
				name,
				category: state.form.category,
				keywords: cleanKeywords( state.form.keywords ),
				license: cleanLicense( state.form.license ),
				settings: state.settings,
				thumbnail,
				hash: state.hash
			} );

			state.adopted = true;
			state.mode = 'record';
			state.record = saved;
			state.loaded = null;
			context.notify( `Modelo "${saved.name}" salvo na biblioteca.`, 'success' );
			if ( context.showImportedModels ) context.showImportedModels();
			applySettings( false );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível salvar o modelo.', 'error' );

		} finally {

			state.busy = false;
			if ( state.open && state.preview !== null ) applySettings( false );

		}

	}

	async function saveRecord() {

		if ( state.busy ) return;
		state.busy = true;
		try {

			const saved = await library.update( state.record.id, {
				name: state.form.name,
				category: state.form.category,
				keywords: cleanKeywords( state.form.keywords ),
				license: cleanLicense( state.form.license ),
				defaults: sanitizeSettings( state.settings )
			} );
			state.record = library.getRecord( saved.id ) || saved;
			context.notify( 'Modelo atualizado na biblioteca (instâncias já inseridas não mudam).', 'success' );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível atualizar o modelo.', 'error' );

		} finally {

			state.busy = false;
			if ( state.open ) applySettings( false );

		}

	}

	async function exportOriginal() {

		try {

			const name = await library.exportOriginal( state.record );
			context.notify( `Arquivo original exportado (${name}).`, 'success' );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível exportar o arquivo original.', 'error' );

		}

	}

	async function removeRecord() {

		const record = state.record;
		const choice = await dialog.ask( { title: 'Excluir modelo da biblioteca', message: `Excluir "${record.name}" da biblioteca? Os objetos já inseridos em projetos continuam funcionando (cada projeto guarda sua própria cópia).`, choices: [ { id: 'delete', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'delete' ) return;
		try {

			state.adopted = true; // a cena pode usar a geometria: não descartar
			close();
			await library.remove( record.id );
			context.notify( `Modelo "${record.name}" excluído da biblioteca.`, 'success' );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível excluir o modelo.', 'error' );

		}

	}

	overlay.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' && dialog.isOpen() === false ) {

			event.preventDefault();
			close();

		}

		event.stopPropagation();

	} );

	overlay.addEventListener( 'mousedown', ( event ) => {

		if ( event.target === overlay ) close();

	} );

	units.changed.add( () => {

		if ( state.open && state.preview !== null ) applySettings( false );

	} );

	return { openFiles, openRecord, close, isOpen: () => state.open, getState: () => ( { phase: state.preview !== null ? 'ready' : 'loading', settings: Object.assign( {}, state.settings ), size: state.size ? state.size.toArray() : null, verification: state.verification } ) };

}

export { SimpleModeExternalModelPanel };
