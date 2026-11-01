// EV-001 — Modo Simples de Criação 3D
//
// Interface simplificada montada *sobre* o editor original. Nada é recriado na troca de modo:
// o mesmo Editor, a mesma cena e o mesmo Viewport são reutilizados; apenas a classe
// `mode-simple` / `mode-advanced` do <body> decide quais painéis ficam visíveis (ver css/simple.css).

import { UIDiv, UIPanel } from './libs/ui.js';

import { SimpleModeTopbar } from './SimpleMode.Topbar.js';
import { SimpleModeObjects } from './SimpleMode.Objects.js';
import { SimpleModeTools } from './SimpleMode.Tools.js';
import { SimpleModeProperties } from './SimpleMode.Properties.js';

import { Units } from './SimpleMode.Units.js';
import { Precision } from './SimpleMode.Precision.js';
import { Measure } from './SimpleMode.Measure.js';
import { Alignment } from './SimpleMode.Alignment.js';
import { UserLibrary } from './SimpleMode.UserLibrary.js';
import { findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { isOwnedLighting } from './SimpleMode.Lighting.js';
import { LightingService } from './SimpleMode.LightingPanel.js';
import { SimpleModeTemplateGallery } from './SimpleMode.TemplateGallery.js';
import { Interaction } from './SimpleMode.Interaction.js';
import { ConstructionTools } from './SimpleMode.ConstructionTools.js';
import { OpeningTools } from './SimpleMode.OpeningTools.js';
import { findHostedFixture, isHostedFixture, getOpeningOf } from './SimpleMode.Openings.js';
import { RemoveWallOpeningCommand } from './commands/RemoveWallOpeningCommand.js';
import { CameraController } from './SimpleMode.CameraController.js';
import { Walkthrough } from './SimpleMode.Walkthrough.js';
import { Presentation, SimpleModePresentationBar } from './SimpleMode.Presentation.js';
import { ProjectDialog } from './SimpleMode.ProjectDialog.js';
import { ProjectManager } from './SimpleMode.ProjectManager.js';
import { SimpleModeProjectGallery } from './SimpleMode.ProjectGallery.js';
import { SimpleModeProjectStatus } from './SimpleMode.ProjectStatus.js';
import { ReviewManager } from './SimpleMode.ReviewManager.js';
import { SimpleModeShareDialog } from './SimpleMode.ShareDialog.js';
import { SimpleModeReviewPanel } from './SimpleMode.ReviewPanel.js';
import { ExternalModelLibrary } from './SimpleMode.ExternalModelLibrary.js';
import { SimpleModeExternalModelPanel } from './SimpleMode.ExternalModelPanel.js';
import { previewStats } from './SimpleMode.ExternalModelPreview.js';
import { AssemblyLibrary } from './SimpleMode.AssemblyLibrary.js';
import { AssemblySelection } from './SimpleMode.AssemblySelection.js';
import { AssemblyPreview } from './SimpleMode.AssemblyPreview.js';
import { AssemblySnapping } from './SimpleMode.AssemblySnapping.js';
import { SimpleModeAssemblyPanel } from './SimpleMode.AssemblyPanel.js';
import { TechnicalCatalogLibrary } from './SimpleMode.TechnicalCatalogLibrary.js';
import { SimpleModeTechnicalCatalog } from './SimpleMode.TechnicalCatalogPanel.js';
import { completeSnapshot, getSnapshot, getTechnicalLink } from './SimpleMode.TechnicalCatalogData.js';
import { describe as describeTechnical } from './SimpleMode.TechnicalPartLinks.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';

const MODE_KEY = 'interface/mode';

function SimpleMode( editor ) {

	const signals = editor.signals;
	const config = editor.config;

	const container = new UIDiv();
	container.setId( 'simple-mode' );

	// mensagens curtas e não bloqueantes

	const toasts = new UIDiv().setClass( 'SimpleToasts' );
	toasts.dom.setAttribute( 'role', 'status' );
	toasts.dom.setAttribute( 'aria-live', 'polite' );

	function notify( message, type = 'info' ) {

		const toast = document.createElement( 'div' );
		toast.className = 'SimpleToast ' + type;
		toast.textContent = message;
		toasts.dom.appendChild( toast );

		// mantém no máximo 3 mensagens visíveis
		while ( toasts.dom.children.length > 3 ) toasts.dom.firstChild.remove();

		setTimeout( function () {

			toast.classList.add( 'leaving' );
			setTimeout( () => toast.remove(), 300 );

		}, type === 'error' ? 6000 : 2800 );

	}

	// serviços da EV-002 (unidades, precisão, medição e alinhamento), compartilhados com os painéis

	const units = new Units( editor );
	const precision = new Precision( editor );
	// EV-006: controlador único de interação com o viewport (régua e ferramentas de construção)
	const interaction = new Interaction( editor );
	const measure = new Measure( editor, units, precision.getSnap, interaction );
	const alignment = new Alignment( editor );

	let currentMode = null; // 'simple' | 'advanced'

	// EV-003: componentes salvos pelo usuário (IndexedDB próprio)
	const userLibrary = new UserLibrary();
	userLibrary.load(); // em segundo plano: a aba "Meus" já abre pronta

	// EV-003: no Modo Simples, clicar em qualquer peça de um componente seleciona o componente inteiro.
	// No Modo Avançado a seleção original (peça por peça) continua igual.
	editor.selector.resolveSelection = function ( object ) {

		if ( currentMode !== 'simple' ) return object;

		// EV-004: as luzes do Project3DS são controladas pelo painel Iluminação (não são selecionadas no Modo Simples)
		if ( isOwnedLighting( object, editor.scene ) ) return null;

		// EV-007: porta/janela hospedada tem prioridade (clicar nela seleciona a porta; na parede, a parede)
		const hosted = findHostedFixture( object, editor.scene );
		if ( hosted !== null ) return hosted;

		const root = findComponentRoot( object, editor.scene );
		return root !== null ? root : object;

	};

	// EV-007: no Modo Simples, porta/janela hospedada não recebe alças livres (move só ao longo da parede)
	editor.transformFilter = function ( object ) {

		return currentMode !== 'simple' || isHostedFixture( object ) === false;

	};

	// EV-004: reaplica a iluminação salva no projeto e mantém sombras/auxiliares coerentes
	const lighting = new LightingService( editor, () => currentMode );
	let shadingBeforeSimple = null;

	// contexto compartilhado com os painéis

	const context = { notify, setMode, units, precision, measure, alignment, userLibrary, interaction };

	// EV-013: biblioteca de modelos importados (banco próprio "project3ds-assets"; só metadados até um modelo ser usado)
	context.modelLibrary = new ExternalModelLibrary( editor );

	// EV-014: montagem modular — biblioteca própria ("project3ds-assemblies"), seleção hierárquica (encadeada à
	// resolução acima, só no Modo Simples), prévia temporária e ferramenta de encaixe
	context.assemblyLibrary = new AssemblyLibrary( editor, context.modelLibrary );
	context.assemblySelection = new AssemblySelection( editor, context, () => currentMode === 'simple' );
	context.assemblyPreview = new AssemblyPreview( editor, interaction );
	context.assemblySnapping = new AssemblySnapping( editor, context, interaction, context.assemblyPreview, context.assemblySelection );

	// EV-015: catálogo técnico de peças (banco próprio "project3ds-parts"), carregado em segundo plano
	context.technical = { catalog: new TechnicalCatalogLibrary(), panel: null };
	context.technical.catalog.load();

	// EV-011: diálogo de confirmação e gestão de projetos (identidade, autosave, versões, recuperação).
	// Criada antes dos painéis: instala os envoltórios de Editor.toJSON/clear antes de qualquer carregamento.
	context.dialog = new ProjectDialog( container.dom );
	context.projects = new ProjectManager( editor, context );

	// EV-006: desenhar parede, criar piso, posicionar componente e apoiar objeto
	context.construction = new ConstructionTools( editor, context, interaction );

	// EV-007: inserir porta, inserir janela e reposicionar abertura
	context.openings = new OpeningTools( editor, context, interaction );

	// EV-008: vistas e câmeras transitórias, exploração em primeira pessoa e apresentação das vistas salvas
	const cameras = new CameraController( editor );
	context.cameras = cameras;
	context.walkthrough = new Walkthrough( editor, context, interaction, cameras );
	context.presentation = new Presentation( editor, context, interaction, cameras );

	// EV-007: Delete/Backspace sobre uma porta/janela hospedada remove a abertura inteira (vão fechado, um Desfazer)
	window.addEventListener( 'keydown', function ( event ) {

		if ( currentMode !== 'simple' ) return;
		if ( event.key !== 'Delete' && event.key !== 'Backspace' ) return;

		const target = event.target;
		if ( target !== null && ( target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test( target.tagName ) ) ) return;

		const object = editor.selected;
		const opening = isHostedFixture( object ) ? getOpeningOf( object ) : null;
		if ( opening === null ) return;

		event.preventDefault();
		event.stopImmediatePropagation();

		const wall = object.parent;
		editor.execute( new RemoveWallOpeningCommand( editor, wall, opening.id ) );
		editor.select( wall );
		notify( t( 'opening/removed' ), 'success' );

	}, true );

	container.add(
		new SimpleModeTopbar( editor, context ),
		new SimpleModeObjects( editor, context ),
		new SimpleModeTools( editor, context ),
		new SimpleModeProperties( editor, context ),
		toasts
	);

	// EV-008: barra discreta do Modo Apresentação (fora dos painéis, que ficam ocultos durante a apresentação)
	container.add( new SimpleModePresentationBar( editor, context ) );

	// EV-011: "Meus projetos" e indicador de persistência
	const projectGallery = new SimpleModeProjectGallery( editor, context, container.dom );
	context.openProjects = ( tab ) => projectGallery.open( tab );
	new SimpleModeProjectStatus( editor, context, context.projectStatusAnchor, container.dom );

	// EV-012: compartilhamento (pacote de visualização) e revisões devolvidas pelos destinatários
	context.reviews = new ReviewManager( editor, context );
	const shareDialog = new SimpleModeShareDialog( editor, context, container.dom );
	const reviewPanel = new SimpleModeReviewPanel( editor, context, context.reviews, container.dom );
	context.openShare = () => shareDialog.show();
	context.openReviews = () => reviewPanel.show();
	context.importReview = () => reviewPanel.importFile();

	// EV-013: janela de importação/pré-visualização de modelos 3D externos (GLB/GLTF)
	const modelPanel = new SimpleModeExternalModelPanel( editor, context, context.modelLibrary, container.dom );
	context.openExternalModelFiles = ( files ) => modelPanel.openFiles( files );
	context.openExternalModelRecord = ( record ) => modelPanel.openRecord( record );
	context.externalModels = { panel: modelPanel, library: context.modelLibrary, previewStats };
	// EV-014: menu "Montagem", painel lateral contextual e diálogos de conjunto
	context.assemblyPanel = new SimpleModeAssemblyPanel( editor, context, container.dom, { selection: context.assemblySelection, snapping: context.assemblySnapping, preview: context.assemblyPreview, library: context.assemblyLibrary } );
	context.openAssemblyMenu = ( anchor ) => context.assemblyPanel.openMenu( anchor );
	// EV-015: interface do catálogo técnico (Catálogo, Ficha, Peças do projeto, Conferência, Compatibilidade, Resumo)
	context.technical.panel = new SimpleModeTechnicalCatalog( editor, context, container.dom, { catalog: context.technical.catalog } );
	context.openTechnicalCatalog = ( tab = 'catalog' ) => context.technical.panel.open( tab );

	// snapshot técnico do projeto: completa (somente acrescenta) as revisões usadas por componentes inseridos de
	// conjuntos da biblioteca/pacotes; a revisão já gravada no projeto nunca é trocada
	editor.signals.sceneGraphChanged.add( () => completeSnapshot( editor.scene ) );

	// ao abrir um projeto: aviso (uma vez) quando há fichas com revisão mais recente no catálogo local
	let technicalCheckPending = false, technicalTimer = null;
	editor.signals.editorCleared.add( () => ( technicalCheckPending = true ) );
	editor.signals.sceneGraphChanged.add( () => {

		if ( technicalCheckPending === false ) return;
		clearTimeout( technicalTimer );
		technicalTimer = setTimeout( async () => {

			technicalCheckPending = false;
			const catalog = context.technical.catalog;
			await catalog.load();
			let outdated = 0;
			editor.scene.traverse( ( object ) => {

				const link = getTechnicalLink( object );
				if ( link !== null && ( catalog.latestRevision( link.catalogId ) ?? 0 ) > link.catalogRevision ) outdated ++;

			} );
			if ( outdated > 0 ) notify( `${outdated} componente(s) usam revisões anteriores de fichas técnicas. Revisão mais recente disponível no catálogo local (atualização somente com confirmação).`, 'info' );

		}, 800 );

	} );

	// diagnóstico somente leitura do catálogo técnico (testes automatizados)
	window.project3dsTechnical = Object.freeze( {
		catalogState: () => ( { loaded: context.technical.catalog.state.loaded, available: context.technical.catalog.state.available, parts: context.technical.catalog.state.parts.size, revisions: context.technical.catalog.state.revisions.size, rules: context.technical.catalog.state.rules.size } ),
		snapshot: () => JSON.parse( JSON.stringify( getSnapshot( editor.scene ) ) ),
		describe: ( uuid ) => {

			const object = editor.scene.getObjectByProperty( 'uuid', uuid );
			if ( object === undefined ) return null;
			const info = describeTechnical( editor, object, context.technical.catalog );
			return info.link === null ? { link: null } : { link: info.link, origin: info.origin, record: info.record, latest: info.latest, outdated: info.outdated, dimensions: info.dimensions ? { status: info.dimensions.status, items: info.dimensions.items } : null };

		},
		panel: () => ( { open: context.technical.panel.isOpen(), tab: context.technical.panel.state.tab } )
	} );
	// diagnóstico somente leitura da montagem (resultado do encaixe em prévia, conjunto em edição, painel lateral)
	window.project3dsAssembly = Object.freeze( {
		snapResult: () => {

			const r = context.assemblySnapping.getResult();
			return r === null ? null : { moving: r.moving.id, target: r.target.id, targetUuid: r.targetObject ? r.targetObject.uuid : null, from: r.from.position.toArray(), to: r.to.position.toArray(), normalFrom: r.from.normal.toArray(), normalTo: r.to.normal.toArray(), distance: r.distance, angle: r.angle };

		},
		editing: () => ( context.assemblySelection.getEditing() !== null ? context.assemblySelection.getEditing().uuid : null ),
		side: () => context.assemblyPanel.getSideState()
	} );

	// diagnóstico somente leitura (estado da janela e memória da pré-visualização), usado nos testes automatizados
	window.project3dsExternal = Object.freeze( { panel: Object.freeze( { getState: () => modelPanel.getState() } ), previewStats } );

	// EV-005: galeria de projetos prontos (aberta por "Novo" ou pelo convite da cena vazia)
	const gallery = new SimpleModeTemplateGallery( editor, context );
	container.dom.appendChild( gallery.dom );

	// alternância de modo

	function setMode( mode ) {

		if ( mode !== 'simple' && mode !== 'advanced' ) mode = 'simple';
		if ( mode === currentMode ) return;

		currentMode = mode;

		document.body.classList.toggle( 'mode-simple', mode === 'simple' );
		document.body.classList.toggle( 'mode-advanced', mode === 'advanced' );

		// ao entrar no Modo Simples, uma peça selecionada no Avançado passa a selecionar o componente inteiro
		if ( mode === 'simple' && editor.selected !== null ) {

			const hosted = findHostedFixture( editor.selected, editor.scene );
			const root = hosted !== null ? hosted : findComponentRoot( editor.selected, editor.scene );
			if ( root !== null && root !== editor.selected ) editor.select( root );
			else if ( isHostedFixture( editor.selected ) ) signals.objectSelected.dispatch( editor.selected ); // retira as alças livres

		}

		if ( mode === 'advanced' ) {

			// encerra a régua e as ferramentas de construção, removendo prévias e marcadores temporários
			interaction.deactivate();
			measure.deactivate();

			// EV-008: o Modo Avançado usa a câmera principal (perspectiva equivalente à vista técnica atual)
			cameras.toPerspective();

			// EV-009: a planta baixa é uma visualização do Modo Simples
			if ( context.planView !== undefined ) context.planView.close();
			if ( context.budgetView !== undefined ) context.budgetView.close(); // EV-010

			// a ferramenta "Selecionar" não existe no Modo Avançado: volta para "Mover"
			signals.transformModeChanged.dispatch( 'translate' );

		}

		// encaixe e grade do Modo Simples; no Modo Avançado voltam ao comportamento original
		precision.setEnabled( mode === 'simple' );

		// EV-004: o Modo Simples mostra os materiais reais (sombreamento padrão); o modo anterior volta no Avançado
		if ( mode === 'simple' && editor.viewportShading !== 'default' ) {

			shadingBeforeSimple = editor.viewportShading;
			editor.setViewportShading( 'default' );

		} else if ( mode === 'advanced' && shadingBeforeSimple !== null ) {

			editor.setViewportShading( shadingBeforeSimple );
			shadingBeforeSimple = null;

		}

		if ( mode === 'advanced' && context.lightingPanel !== undefined ) context.lightingPanel.close();
		if ( mode === 'advanced' ) gallery.close( false );

		lighting.updateHelpers();

		if ( config.getKey( MODE_KEY ) !== mode ) config.setKey( MODE_KEY, mode );

		// o viewport muda de tamanho: recalcula renderer e câmera
		signals.windowResize.dispatch();

	}

	function getMode() {

		return currentMode;

	}

	// botão para voltar ao Modo Simples, exibido na barra de menus original

	function createAdvancedToggle() {

		const panel = new UIPanel();
		panel.setClass( 'menu right SimpleModeToggle' );

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'title';
		button.textContent = t( 'advanced/toSimple' );
		button.title = t( 'advanced/toSimple/title' );
		button.addEventListener( 'click', function () {

			setMode( 'simple' );

		} );

		panel.dom.appendChild( button );

		return panel;

	}

	return {
		dom: container.dom,
		setMode,
		getMode,
		createAdvancedToggle,
		notify,
		context,
		projects: context.projects,
		reviews: context.reviews,
		externalModels: context.externalModels,
		initialMode: config.getKey( MODE_KEY ) === 'advanced' ? 'advanced' : 'simple'
	};

}

export { SimpleMode };
