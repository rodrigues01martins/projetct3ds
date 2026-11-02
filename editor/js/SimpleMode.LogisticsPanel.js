// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Área "Planejamento e Logística" (sobreposição no padrão de "Meus projetos"; usa o projeto ativo, sem cena própria):
//   Visão Geral · Etapas · Separação e Kits · Transporte · Conferência · Relatórios, e o "Modo conferência" compacto
//   (botões grandes para toque, listas por etapa e por kit). Cada operação persistente = um SetLogisticsPlanCommand;
//   trocar de aba ou localizar componentes não cria passos no histórico. O levantamento do modelo (buildBOM) é
//   recalculado só ao abrir e após alterações da cena (com atraso), nunca a cada digitação.

import { createSimpleButton } from './SimpleMode.Icons.js';
import { SetLogisticsPlanCommand } from './commands/SetLogisticsPlanCommand.js';
import { isAssembly, getAssembly } from './SimpleMode.AssemblyData.js';
import {
	getPlan, hasPlan, STAGE_TYPES, STAGE_STATUSES, CLASSIFICATIONS, INCIDENT_TYPES, INCIDENT_STATUSES, MANUAL_LABEL,
	labelOf, brDate, brDateTime, kg, newId
} from './SimpleMode.LogisticsData.js';
import { LogisticsError, createPlan, clone, stamp, addEvent, allLines, lineMap, demandOf, lineLabel, kitAllocation, weightText } from './SimpleMode.LogisticsPlan.js';
import { surveyModel, diffBaseline, describeDiff, rebaseline } from './SimpleMode.LogisticsBaseline.js';
import { addStage, updateStage, removeStage, moveStage, stageReferences, setStageStatus, setStageProgress, schedule, suggestDisassembly } from './SimpleMode.LogisticsStages.js';
import { addKit, updateKit, removeKit, setKitItem, addManualItem, removeManualItem, kitDetails, kitStatus, pickState, setPicking, closePicking } from './SimpleMode.LogisticsKits.js';
import { addLoad, updateLoad, removeLoad, setLoadKits, setLoadItem, loadDetails, setLoaded, receivingState, setReceived, RECEIVING_CONVENTION, TRANSPORT_LIMITS } from './SimpleMode.LogisticsLoads.js';
import { classificationOf, setClassification, returnState, setReturn, addIncident, setIncidentStatus } from './SimpleMode.LogisticsReturns.js';
import { validatePlan, VALIDATION_NOTICE } from './SimpleMode.LogisticsValidation.js';
import { planSummary } from './SimpleMode.LogisticsSummary.js';
import { exportChecks, analyzeChecks, applyChecks } from './SimpleMode.LogisticsTransfer.js';
import { toPickingCSV, toLogisticsXLSX, toLogisticsPDF, LOGISTICS_REPORTS } from './SimpleMode.LogisticsExport.js';
import { getTechnicalLink, resolveRecord } from './SimpleMode.TechnicalCatalogData.js';

function el( tag, className, textValue ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( textValue !== undefined ) node.textContent = textValue;
	return node;

}

function button( label, onClick, { icon, className = '', title } = {} ) {

	return createSimpleButton( { icon, label, title: title || label, className, onClick } ).dom;

}

function select( options, value, className = '' ) {

	const node = el( 'select', 'SimpleSelect SimpleLogSelect ' + className );
	for ( const [ id, label ] of options ) {

		const option = el( 'option', '', label );
		option.value = id;
		node.appendChild( option );

	}

	node.value = value;
	return node;

}

function input( value = '', { type = 'text', placeholder = '', className = '', maxLength = 160 } = {} ) {

	const node = el( 'input', 'SimpleInput SimpleLogInput ' + className );
	node.type = type;
	node.value = value === null || value === undefined ? '' : value;
	node.placeholder = placeholder;
	if ( type === 'text' ) node.maxLength = maxLength;
	if ( type === 'number' ) {

		node.min = '0';
		node.step = '1';
		node.inputMode = 'numeric';

	}

	node.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
	return node;

}

function field( label, control ) {

	const wrap = el( 'label', 'SimpleLogField' );
	wrap.append( el( 'span', 'SimpleLogFieldLabel', label ), control );
	return wrap;

}

// inteiro não negativo a partir de um campo (vazio = 0); inválido = null
function intValue( node ) {

	const raw = node.value.trim();
	if ( raw === '' ) return 0;
	return /^\d+$/.test( raw ) ? Number( raw ) : null;

}

function table( headers, className = '' ) {

	const wrap = el( 'div', 'SimpleLogTableWrap' );
	const t = el( 'table', 'SimpleLogTable ' + className );
	const tr = el( 'tr' );
	for ( const h of headers ) tr.appendChild( el( 'th', '', h ) );
	const thead = el( 'thead' );
	thead.appendChild( tr );
	t.appendChild( thead );
	const tbody = el( 'tbody' );
	t.appendChild( tbody );
	wrap.appendChild( t );
	return { wrap, tbody };

}

function SimpleModeLogisticsPanel( editor, context, root ) {

	const dialog = context.dialog;
	const state = { open: false, tab: 'overview', field: false, fieldView: 'stage', survey: null, diff: null, keepBase: null, editingStage: null, search: '', locate: new Map(), timer: null };

	const overlay = el( 'div', 'SimpleProjectsOverlay SimpleLogOverlay' );
	overlay.id = 'simple-logistics';
	overlay.hidden = true;
	root.appendChild( overlay );
	const panel = el( 'div', 'SimpleProjects SimpleLog' );
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-modal', 'true' );
	panel.setAttribute( 'aria-labelledby', 'simple-logistics-title' );
	overlay.appendChild( panel );

	const header = el( 'div', 'SimpleProjectsHeader' );
	panel.appendChild( header );
	const title = el( 'h2', 'SimpleProjectsTitle', 'Planejamento e Logística' );
	title.id = 'simple-logistics-title';
	header.appendChild( title );
	const TABS = [[ 'overview', 'Visão Geral' ], [ 'stages', 'Etapas' ], [ 'picking', 'Separação e Kits' ], [ 'transport', 'Transporte' ], [ 'check', 'Conferência' ], [ 'reports', 'Relatórios' ]];
	const tabs = el( 'div', 'SimpleBudgetTabs SimpleLogTabs' );
	tabs.setAttribute( 'role', 'tablist' );
	header.appendChild( tabs );
	const tabButtons = {};
	for ( const [ id, label ] of TABS ) {

		const tab = el( 'button', 'SimpleBudgetTab SimpleLogTab', label );
		tab.type = 'button';
		tab.dataset.tab = id;
		tab.setAttribute( 'role', 'tab' );
		tab.addEventListener( 'click', () => show( id ) );
		tabs.appendChild( tab );
		tabButtons[ id ] = tab;

	}

	const fieldToggle = button( 'Modo conferência', () => {

		state.field = ! state.field;
		render();

	}, { icon: 'measure', className: 'SimpleLogFieldToggle' } );
	header.append( fieldToggle, button( 'Voltar ao modelo', () => close(), { icon: 'close', className: 'SimpleLogClose' } ) );
	const body = el( 'div', 'SimpleLogBody' );
	panel.appendChild( body );

	const importInput = el( 'input' );
	importInput.type = 'file';
	importInput.accept = '.json,application/json';
	importInput.hidden = true;
	importInput.dataset.role = 'logistics-import';
	importInput.addEventListener( 'change', () => {

		const file = importInput.files[ 0 ];
		importInput.value = '';
		if ( file ) importFile( file );

	} );
	panel.appendChild( importInput );

	overlay.addEventListener( 'keydown', ( event ) => {

		event.stopPropagation();
		if ( event.key === 'Escape' && dialog.isOpen() === false ) {

			event.preventDefault();
			if ( state.editingStage !== null ) {

				state.editingStage = null;
				render();

			} else close();

		}

	} );

	// levantamento do modelo (só ao abrir e após mudanças na cena)
	function refreshSurvey() {

		const catalog = context.technical ? context.technical.catalog : null;
		state.survey = surveyModel( editor, catalog );
		const plan = getPlan( editor.scene );
		state.diff = plan.baseline !== null ? diffBaseline( plan.baseline, state.survey.items, editor.scene ) : null;

	}

	editor.signals.sceneGraphChanged.add( () => {

		if ( state.open === false ) return;
		clearTimeout( state.timer );
		state.timer = setTimeout( () => {

			refreshSurvey();
			if ( document.activeElement === null || overlay.contains( document.activeElement ) === false || document.activeElement.tagName === 'BUTTON' ) render();

		}, 400 );

	} );
	editor.signals.editorCleared.add( () => {

		state.keepBase = null;
		state.editingStage = null;

	} );

	async function open( tab = 'overview' ) {

		state.open = true;
		overlay.hidden = false;
		state.tab = tab;
		if ( context.technical ) await context.technical.catalog.load();
		refreshSurvey();
		render();
		const focus = body.querySelector( 'button, input, select' );
		if ( focus ) focus.focus();

	}

	function close() {

		state.open = false;
		overlay.hidden = true;

	}

	function show( tab ) {

		state.tab = tab;
		state.field = false;
		render();

	}

	const plan = () => getPlan( editor.scene );
	const responsible = () => plan().settings.responsible || '';

	// grava uma operação (um passo de histórico); erros conhecidos viram mensagens/diálogos
	function commit( name, producer ) {

		try {

			const result = producer( plan() );
			const next = result && result.plan ? result.plan : result;
			editor.execute( new SetLogisticsPlanCommand( editor, next, name ) );
			render();
			return result;

		} catch ( error ) {

			if ( error instanceof LogisticsError ) context.notify( error.message, 'warning' );
			else throw error;
			render();
			return null;

		}

	}

	// tenta uma operação; erros de excedente/alocação/predecessora abrem decisão explícita
	async function attempt( name, producer, resolver ) {

		try {

			const result = producer( plan() );
			editor.execute( new SetLogisticsPlanCommand( editor, result && result.plan ? result.plan : result, name ) );
			render();
			return true;

		} catch ( error ) {

			if ( ( error instanceof LogisticsError ) === false ) throw error;
			if ( resolver && resolver[ error.code ] ) return resolver[ error.code ]( error );
			context.notify( error.message, 'warning' );
			render();
			return false;

		}

	}

	function render() {

		for ( const [ id, tab ] of Object.entries( tabButtons ) ) {

			tab.classList.toggle( 'active', id === state.tab && state.field === false );
			tab.setAttribute( 'aria-selected', id === state.tab ? 'true' : 'false' );

		}

		fieldToggle.classList.toggle( 'active', state.field );
		panel.classList.toggle( 'field', state.field );
		body.textContent = '';
		body.dataset.tab = state.field ? 'field' : state.tab;
		const p = plan();
		if ( p.planId === null && state.tab !== 'overview' && state.field === false ) {

			body.appendChild( el( 'p', 'SimpleLogEmpty', 'Ainda não há plano neste projeto. Use "Criar plano de montagem" na Visão Geral.' ) );
			body.appendChild( button( 'Ir para a Visão Geral', () => show( 'overview' ), { className: 'SimpleLogGoOverview' } ) );
			return;

		}

		if ( state.field ) return renderField( p );
		switch ( state.tab ) {

			case 'overview': return renderOverview( p );
			case 'stages': return renderStages( p );
			case 'picking': return renderPicking( p );
			case 'transport': return renderTransport( p );
			case 'check': return renderCheck( p );
			case 'reports': return renderReports( p );

		}

	}

	// localizar no projeto: seleção (destaque temporário do editor) + enquadramento; nada é modificado
	function locate( uuids, key ) {

		const objects = uuids.map( ( u ) => editor.scene.getObjectByProperty( 'uuid', u ) ).filter( Boolean );
		if ( objects.length === 0 ) return context.notify( 'Nenhum componente correspondente existe mais no modelo (referência inválida).', 'warning' );
		const index = ( ( state.locate.get( key ) ?? - 1 ) + 1 ) % objects.length;
		state.locate.set( key, index );
		const object = objects[ index ];
		let assembly = null;
		for ( let c = object.parent; c !== null && c !== editor.scene; c = c.parent ) if ( isAssembly( c ) ) {

			assembly = c;
			break;

		}

		if ( assembly !== null && context.assemblySelection ) context.assemblySelection.enterEditing( assembly, object );
		else editor.select( object );
		if ( context.cameras ) context.cameras.frameSelection( object );
		context.notify( `Componente ${index + 1} de ${objects.length}: ${object.name || 'componente'}.`, 'info' );

	}

	// ===================================================================================== Visão Geral

	function renderOverview( p ) {

		const project = context.projects ? context.projects.getActive() : null;
		const survey = state.survey;
		const facts = el( 'dl', 'SimpleModelFacts SimpleLogFacts' );
		const fact = ( k, v ) => facts.append( el( 'dt', '', k ), el( 'dd', '', v ) );
		fact( 'Projeto', editor.config.getKey( 'project/title' ) || 'Projeto sem nome' );

		if ( p.planId === null ) {

			body.appendChild( facts );
			if ( survey.items.length === 0 ) {

				body.appendChild( el( 'p', 'SimpleLogEmpty', 'O projeto ainda não tem peças. Adicione componentes, conjuntos ou modelos importados ao 3D e volte aqui para criar o plano de montagem.' ) );
				return;

			}

			const s = survey.bom.summary;
			fact( 'Peças no modelo', `${s.totalUnits} (${s.identified} com ficha técnica, ${s.unidentified} sem ficha)` );
			fact( 'Peso conhecido', weightText( { known: s.knownWeight, unknown: s.unknownWeightUnits, partial: s.partial } ) );
			body.appendChild( el( 'p', 'SimpleLogNotice', 'O plano usa a lista de peças do Catálogo Técnico (EV-015): a raiz de um conjunto não é peça, malhas internas não são peças e portas/janelas hospedadas contam uma vez. Peças modeladas não estão necessariamente disponíveis fisicamente.' ) );
			body.appendChild( button( 'Criar plano de montagem', () => createFlow(), { icon: 'add', className: 'SimpleLogCreate primary' } ) );
			return;

		}

		const s = planSummary( p );
		const v = validatePlan( p, editor, state.diff );
		fact( 'Plano atualizado em', brDateTime( p.updatedAt ) );
		fact( 'Base do plano', `revisão ${p.baseline.revision} — ${brDateTime( p.baseline.createdAt )}` );
		fact( 'Peças necessárias', `${s.needed} (${s.identified} com ficha técnica, ${s.unidentified} sem ficha)` );
		fact( 'Peso líquido', weightText( s.weight ) );
		fact( 'Etapas', `${p.stages.length} (${s.stagesDone} concluída(s))` );
		fact( 'Pendências operacionais', String( ( v.counts.pending || 0 ) + ( v.counts.divergence || 0 ) + ( v.counts.alert || 0 ) ) );
		body.appendChild( facts );

		// projeto duplicado: o plano veio de outro projeto
		if ( project !== null && p.projectId !== null && p.projectId !== project.id ) {

			const box = el( 'div', 'SimpleLogBanner' );
			box.append( el( 'span', '', 'Este plano foi copiado de outro projeto. Os registros operacionais não devem se misturar entre projetos distintos.' ),
				button( 'Vincular a este projeto (manter registros copiados)', () => commit( 'Vincular plano ao projeto', ( cur ) => addEvent( Object.assign( clone( cur ), { projectId: project.id } ), 'plan-relinked', { from: cur.projectId, to: project.id } ) ), { className: 'SimpleLogRelink' } ),
				button( 'Iniciar novo plano a partir da base copiada', () => commit( 'Novo plano a partir da base copiada', ( cur ) => {

					const fresh = Object.assign( clone( cur ), { planId: newId( 'plan' ), projectId: project.id, picking: {}, loading: {}, receiving: {}, returns: {}, incidents: [], events: [], createdAt: new Date().toISOString() } );
					for ( const st of fresh.stages ) Object.assign( st, { status: 'todo', installed: 0, actualStart: null, actualEnd: null, justification: '' } );
					return stamp( addEvent( fresh, 'plan-created', { ref: fresh.planId, note: `Novo plano a partir da base copiada do plano ${cur.planId}; o histórico original permanece no projeto de origem.` } ) );

				} ), { className: 'SimpleLogFresh' } ) );
			body.appendChild( box );

		}

		// divergência entre modelo e base
		if ( state.diff !== null && state.diff.changed && state.keepBase !== p.baseline.id ) {

			const lines = describeDiff( state.diff );
			const box = el( 'div', 'SimpleLogBanner alert' );
			box.appendChild( el( 'strong', '', 'O projeto foi alterado após a criação do plano.' ) );
			box.appendChild( el( 'span', 'SimpleLogDiffSummary', ' ' + lines.slice( 0, 2 ).join( ' ' ) ) );
			box.append(
				button( 'Visualizar diferenças', () => dialog.ask( { title: 'Diferenças entre o modelo e a base do plano', message: `Base revisão ${p.baseline.revision} (${p.baseline.summary.totalUnits} peça(s)) × modelo atual (${state.survey.items.reduce( ( a, i ) => a + i.quantity, 0 )} peça(s)).`, details: lines.length > 0 ? lines : [ 'Mesmas quantidades; instâncias diferentes.' ], choices: [ { id: 'ok', label: 'Fechar', kind: 'primary' } ] } ), { className: 'SimpleLogDiffView' } ),
				button( 'Atualizar planejamento', () => rebaseFlow( 'Atualização das quantidades futuras' ), { className: 'SimpleLogRebase primary' } ),
				button( 'Criar revisão da base', () => rebaseFlow( null ), { className: 'SimpleLogRebaseNote' } ),
				button( 'Manter base anterior', () => {

					state.keepBase = p.baseline.id;
					render();

				}, { className: 'SimpleLogKeepBase' } )
			);
			body.appendChild( box );

		}

		const grid = el( 'div', 'SimpleTechIndicators SimpleLogIndicators' );
		for ( const [ label, value, tone ] of [
			[ 'Peças necessárias', s.needed, 'neutral' ], [ 'Separadas (declarado)', s.picked, 'complete' ], [ 'Pendentes de separação', s.pickPending, s.pickPending > 0 ? 'missing' : 'neutral' ],
			[ 'Kits completos', s.kitsComplete, 'neutral' ], [ 'Kits incompletos', s.kitsIncomplete, s.kitsIncomplete > 0 ? 'missing' : 'neutral' ],
			[ 'Cargas planejadas', s.loadsPlanned, 'neutral' ], [ 'Cargas carregadas (declarado)', s.loadsLoaded, 'neutral' ],
			[ 'Etapas concluídas', s.stagesDone, 'neutral' ], [ 'Etapas pendentes', s.stagesPending, s.stagesPending > 0 ? 'missing' : 'neutral' ],
			[ 'Itens com divergência', s.divergences, s.divergences > 0 ? 'incompatible' : 'neutral' ], [ 'Peças devolvidas', s.returned, 'neutral' ], [ 'Faltantes no retorno', s.returnMissing, s.returnMissing > 0 ? 'missing' : 'neutral' ],
			[ s.weight.partial ? 'Peso líquido conhecido (parcial)' : 'Peso líquido conhecido', s.weight.known === 0 && s.weight.unknown > 0 ? 'Desconhecido' : kg( s.weight.known ), s.weight.partial ? 'missing' : 'neutral' ],
			[ s.weight.packagedUnknown > 0 ? 'Peso embalado conhecido (parcial)' : 'Peso embalado conhecido', s.weight.packaged === 0 && s.weight.packagedUnknown > 0 ? 'Desconhecido' : kg( s.weight.packaged ), s.weight.packagedUnknown > 0 ? 'missing' : 'neutral' ],
			[ 'Peças sem peso', s.weight.unknown, s.weight.unknown > 0 ? 'missing' : 'neutral' ]
		] ) {

			const card = el( 'div', 'SimpleTechIndicator ' + tone );
			card.append( el( 'strong', '', String( value ) ), el( 'span', '', label ) );
			grid.appendChild( card );

		}

		body.appendChild( grid );
		for ( const lw of s.loadWeights ) body.appendChild( el( 'p', 'SimpleLogHint ' + lw.state, `${lw.code}: peso conhecido ${kg( lw.known )}${lw.unknown > 0 ? ` (+ ${lw.unknown} item(ns) sem peso)` : ''}. ${lw.capacityText}` ) );

		const resp = input( p.settings.responsible, { placeholder: 'Nome declarado (sem verificação de identidade)', className: 'SimpleLogResponsible', maxLength: 80 } );
		resp.addEventListener( 'change', () => commit( 'Responsável informado', ( cur ) => stamp( Object.assign( clone( cur ), { settings: Object.assign( {}, cur.settings, { responsible: resp.value.trim().slice( 0, 80 ) } ) } ) ) ) );
		body.appendChild( field( 'Responsável informado para novos registros', resp ) );

		body.appendChild( el( 'h3', 'SimpleLogH3', 'Verificações' ) );
		body.appendChild( el( 'p', 'SimpleLogNotice', VALIDATION_NOTICE ) );
		const list = el( 'ul', 'SimpleCheckFindings SimpleLogFindings' );
		if ( v.findings.length === 0 ) list.appendChild( el( 'li', 'SimpleLogEmpty', 'Nenhuma verificação pendente.' ) );
		for ( const f of v.findings.slice( 0, 200 ) ) {

			const li = el( 'li', 'SimpleCheckFinding ' + ( { info: 'info', pending: 'pending', divergence: 'divergent', alert: 'incompatible' } )[ f.level ] );
			li.dataset.level = f.level;
			li.append( el( 'strong', '', f.label ), el( 'span', '', ' ' + f.message ) );
			if ( f.ref && f.ref.kind === 'line' ) {

				const line = lineMap( p ).get( f.ref.id );
				if ( line ) li.addEventListener( 'click', () => locate( line.units, f.ref.id ) );

			}

			list.appendChild( li );

		}

		body.appendChild( list );

	}

	async function createFlow() {

		const survey = state.survey;
		const s = survey.bom.summary;
		const top = editor.scene.children.filter( ( o ) => isAssembly( o ) );
		const loose = survey.bom.units.filter( ( u ) => u.origin === 'Sem conjunto' ).map( ( u ) => u.object.uuid );
		const details = [ `${s.totalUnits} peça(s) em ${survey.items.length} linha(s): ${s.identified} com ficha técnica, ${s.unidentified} sem ficha.`, weightText( { known: s.knownWeight, unknown: s.unknownWeightUnits, partial: s.partial } ), `${survey.bom.assemblies.length} conjunto(s) identificado(s); a raiz de cada conjunto não é contada como peça.` ];
		if ( top.length > 0 || loose.length > 0 ) details.push( `Etapas sugeridas: ${top.map( ( a ) => `"Montar ${a.name || 'conjunto'}"` ).concat( loose.length > 0 ? [ `"Posicionar componentes avulsos" (${loose.length})` ] : [] ).join( ', ' )}.` );
		const choice = await dialog.ask( { title: 'Criar plano de montagem', message: 'Proposta inicial a partir da lista de peças (EV-015). Nada no modelo 3D é alterado.', details, choices: [ { id: 'stages', label: 'Criar com etapas sugeridas', kind: 'primary' }, { id: 'plain', label: 'Criar sem etapas' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'stages' && choice !== 'plain' ) return;
		const project = context.projects ? context.projects.getActive() : null;
		commit( 'Criar plano de montagem', () => {

			let next = createPlan( editor, context.technical ? context.technical.catalog : null, project );
			if ( choice === 'stages' ) {

				const unitsOf = ( assembly ) => survey.bom.units.filter( ( u ) => {

					for ( let c = u.object.parent; c !== null; c = c.parent ) if ( c === assembly ) return true;
					return false;

				} ).map( ( u ) => u.object.uuid );
				for ( const a of top ) next = addStage( next, { title: `Montar ${a.name || 'conjunto'}`, type: 'assembly', assemblies: [ a.uuid ], units: unitsOf( a ), description: 'Sugestão organizacional: revise a sequência.' } ).plan;
				if ( loose.length > 0 ) next = addStage( next, { title: 'Posicionar componentes avulsos', type: 'assembly', units: loose } ).plan;

			}

			return next;

		} );
		refreshSurvey();
		render();

	}

	async function rebaseFlow( defaultNote ) {

		let note = defaultNote;
		if ( note === null ) {

			const answer = await dialog.ask( { title: 'Criar revisão da base operacional', message: 'A base atual vira histórico; a nova base reflete o modelo atual. Separações, carregamentos, recebimentos, retornos e ocorrências já registrados são preservados (linhas que saíram do modelo ficam marcadas, sem transferência a outras peças).', input: { label: 'Motivo da revisão', value: '', maxLength: 200 }, choices: [ { id: 'ok', label: 'Criar revisão', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
			if ( answer.choice !== 'ok' ) return;
			note = answer.value || 'Revisão da base';

		} else {

			const choice = await dialog.ask( { title: 'Atualizar planejamento?', message: 'As quantidades futuras passam a seguir o modelo atual numa nova revisão da base. Todos os registros já feitos são preservados.', details: describeDiff( state.diff ), choices: [ { id: 'ok', label: 'Atualizar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
			if ( choice !== 'ok' ) return;

		}

		const project = context.projects ? context.projects.getActive() : null;
		commit( 'Atualizar base do plano', ( cur ) => {

			const next = rebaseline( cur, editor, context.technical ? context.technical.catalog : null, { project, note } );
			addEvent( next, 'baseline-updated', { ref: next.baseline.id, from: `revisão ${cur.baseline.revision} (${cur.baseline.summary.totalUnits} peça(s))`, to: `revisão ${next.baseline.revision} (${next.baseline.summary.totalUnits} peça(s))`, note } );
			return stamp( next );

		} );
		refreshSurvey();
		render();

	}

	// ===================================================================================== Etapas

	function stageOptionsFor( p ) {

		return [[ '', 'Nenhuma' ]].concat( p.stages.map( ( s ) => [ s.id, `${s.number}. ${s.title}` ] ) );

	}

	function renderStages( p ) {

		if ( state.editingStage !== null ) return renderStageForm( p );
		const toolbar = el( 'div', 'SimpleLogToolbar' );
		toolbar.append(
			button( 'Nova etapa', () => {

				state.editingStage = 'new';
				render();

			}, { icon: 'add', className: 'SimpleLogStageAdd' } ),
			button( 'Nova etapa de desmontagem', () => {

				state.editingStage = 'new-disassembly';
				render();

			}, { className: 'SimpleLogStageAddDis' } ),
			button( 'Sugerir desmontagem (inversão)', async () => {

				const suggestions = suggestDisassembly( p );
				if ( suggestions.length === 0 ) return context.notify( 'Não há etapas de montagem para inverter.', 'info' );
				const choice = await dialog.ask( { title: 'Sugestão organizacional de desmontagem', message: 'Cria etapas de desmontagem com os componentes das etapas de montagem em ordem inversa. É apenas uma conveniência de edição — não é procedimento técnico validado.', details: suggestions.map( ( s ) => s.title ), choices: [ { id: 'ok', label: 'Criar etapas sugeridas', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'ok' ) commit( 'Sugerir desmontagem', ( cur ) => suggestions.reduce( ( acc, s ) => addStage( acc, s ).plan, cur ) );

			}, { className: 'SimpleLogSuggestDis' } )
		);
		body.appendChild( toolbar );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'Etapas são unidades de planejamento: a ordem não é instrução segura de execução física. Não há cálculo automático de caminho crítico nem estimativa de duração.' ) );
		if ( p.stages.length === 0 ) {

			body.appendChild( el( 'p', 'SimpleLogEmpty', 'Nenhuma etapa cadastrada.' ) );
			return;

		}

		const { wrap, tbody } = table( [ 'Nº', 'Etapa', 'Tipo', 'Previsto', 'Status', 'Depende de', 'Componentes', 'Ações' ], 'SimpleLogStages' );
		for ( const row of schedule( p ).sort( ( a, b ) => a.stage.number - b.stage.number ) ) {

			const s = row.stage;
			const tr = el( 'tr', 'SimpleLogStageRow' + ( row.late ? ' late' : '' ) );
			tr.dataset.stageId = s.id;
			const status = select( STAGE_STATUSES.map( ( x ) => [ x.id, x.name ] ), s.status, 'SimpleLogStageStatus' );
			status.addEventListener( 'change', () => changeStatus( s, status.value ) );
			const actions = el( 'td', 'SimpleLogActions' );
			actions.append(
				button( 'Editar', () => {

					state.editingStage = s.id;
					render();

				}, { className: 'SimpleLogStageEdit' } ),
				button( '↑', () => commit( 'Reordenar etapa', ( cur ) => moveStage( cur, s.id, - 1 ) ), { className: 'SimpleLogStageUp', title: 'Mover para cima' } ),
				button( '↓', () => commit( 'Reordenar etapa', ( cur ) => moveStage( cur, s.id, 1 ) ), { className: 'SimpleLogStageDown', title: 'Mover para baixo' } ),
				button( 'Localizar', () => locate( s.units, 'stage:' + s.id ), { className: 'SimpleLogLocate' } ),
				button( 'Excluir', () => deleteStage( s ), { className: 'SimpleLogStageDelete danger' } )
			);
			tr.append( el( 'td', '', String( s.number ) ), el( 'td', '', s.title ), el( 'td', '', labelOf( STAGE_TYPES, s.type ) ), el( 'td', '', row.noDate ? 'Sem data' : `${brDate( s.plannedStart )}${s.plannedEnd ? ' a ' + brDate( s.plannedEnd ) : ''}${row.late ? ' (atrasada)' : ''}` ) );
			const statusCell = el( 'td' );
			statusCell.appendChild( status );
			if ( s.status === 'done' && s.actualEnd ) statusCell.appendChild( el( 'small', 'SimpleLogHint', ` ${brDateTime( s.actualEnd )}${s.responsible ? ' — ' + s.responsible : ''}` ) );
			tr.append( statusCell, el( 'td', '', row.deps.map( ( d ) => d.number ).join( ', ' ) ), el( 'td', '', String( s.units.length ) ), actions );
			tbody.appendChild( tr );

		}

		body.appendChild( wrap );
		body.appendChild( el( 'h3', 'SimpleLogH3', 'Cronograma operacional' ) );
		const sch = table( [ 'Etapa', 'Início previsto', 'Término previsto', 'Início registrado', 'Término registrado', 'Dependências', 'Situação' ], 'SimpleLogSchedule' );
		for ( const row of schedule( p ) ) {

			const s = row.stage;
			const tr = el( 'tr', row.late ? 'late' : row.noDate ? 'nodate' : '' );
			tr.append( el( 'td', '', `${s.number}. ${s.title}` ), el( 'td', '', brDate( s.plannedStart ) || '—' ), el( 'td', '', brDate( s.plannedEnd ) || '—' ), el( 'td', '', brDateTime( s.actualStart ) ), el( 'td', '', brDateTime( s.actualEnd ) ), el( 'td', '', row.deps.map( ( d ) => `${d.number}. ${d.title}` ).join( '; ' ) ), el( 'td', '', row.noDate ? 'Sem data prevista' : row.late ? 'Atrasada em relação ao previsto' : labelOf( STAGE_STATUSES, s.status ) ) );
			sch.tbody.appendChild( tr );

		}

		body.appendChild( sch.wrap );

	}

	async function changeStatus( stage, status, { responsibleName = null } = {} ) {

		const who = responsibleName !== null ? responsibleName : responsible();
		await attempt( `Status da etapa: ${stage.title}`, ( cur ) => setStageStatus( cur, stage.id, status, { responsible: who } ), {
			predecessor: async ( error ) => {

				const answer = await dialog.ask( { title: 'Etapa predecessora não concluída', message: error.message, input: { label: 'Justificativa (registrada no histórico)', value: '', maxLength: 300 }, choices: [ { id: 'ok', label: 'Concluir mesmo assim', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( answer.choice === 'ok' && answer.value.trim() !== '' ) return attempt( `Status da etapa: ${stage.title}`, ( cur ) => setStageStatus( cur, stage.id, status, { justification: answer.value.trim(), responsible: who } ) );
				if ( answer.choice === 'ok' ) context.notify( 'A justificativa é obrigatória para concluir antes da predecessora.', 'warning' );
				render();
				return false;

			}
		} );

	}

	async function deleteStage( stage ) {

		const refs = stageReferences( plan(), stage.id );
		const details = [];
		if ( refs.dependents.length > 0 ) details.push( `Etapas que dependem desta: ${refs.dependents.map( ( s ) => `${s.number}. ${s.title}` ).join( ', ' )} — as dependências serão removidas.` );
		if ( refs.kits.length > 0 ) details.push( `Kits vinculados: ${refs.kits.map( ( k ) => k.name ).join( ', ' )} — ficarão sem etapa.` );
		const choice = await dialog.ask( { title: `Excluir a etapa "${stage.title}"?`, message: 'A exclusão entra no histórico operacional e pode ser desfeita.', details, choices: [ { id: 'delete', label: refs.dependents.length > 0 ? 'Excluir e remover dependências' : 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice === 'delete' ) commit( `Excluir etapa: ${stage.title}`, ( cur ) => removeStage( cur, stage.id, 'detach' ) );

	}

	function renderStageForm( p ) {

		const isNew = state.editingStage === 'new' || state.editingStage === 'new-disassembly';
		const base = isNew ? { title: '', type: state.editingStage === 'new-disassembly' ? 'disassembly' : 'assembly', description: '', plannedStart: null, plannedEnd: null, responsible: '', notes: '', deps: [], units: [], assemblies: [], kitId: null, installed: 0 } : p.stages.find( ( s ) => s.id === state.editingStage );
		if ( base === undefined ) {

			state.editingStage = null;
			return render();

		}

		const form = el( 'form', 'SimpleLogForm' );
		form.noValidate = true;
		body.appendChild( form );
		form.appendChild( el( 'h3', 'SimpleLogH3', isNew ? 'Nova etapa' : `Editar etapa ${base.number}` ) );
		const grid = el( 'div', 'SimpleLogGrid' );
		const fTitle = input( base.title, { className: 'SimpleLogStageTitle', maxLength: 120 } );
		const fType = select( STAGE_TYPES.map( ( t ) => [ t.id, t.name ] ), base.type, 'SimpleLogStageType' );
		const fStart = input( base.plannedStart || '', { type: 'date', className: 'SimpleLogStageStart' } );
		const fEnd = input( base.plannedEnd || '', { type: 'date', className: 'SimpleLogStageEnd' } );
		const fResp = input( base.responsible, { className: 'SimpleLogStageResp', maxLength: 80 } );
		const fKit = select( [[ '', 'Nenhum' ]].concat( p.kits.map( ( k ) => [ k.id, k.name ] ) ), base.kitId || '', 'SimpleLogStageKit' );
		grid.append( field( 'Título', fTitle ), field( 'Tipo', fType ), field( 'Início previsto', fStart ), field( 'Término previsto', fEnd ), field( 'Responsável informado', fResp ), field( 'Kit associado (ex.: kit de retorno)', fKit ) );
		form.appendChild( grid );
		const fDesc = el( 'textarea', 'SimpleInput SimpleLogTextarea SimpleLogStageDesc' );
		fDesc.value = base.description;
		const fNotes = el( 'textarea', 'SimpleInput SimpleLogTextarea SimpleLogStageNotes' );
		fNotes.value = base.notes;
		for ( const t of [ fDesc, fNotes ] ) t.addEventListener( 'keydown', ( e ) => e.stopPropagation() );
		form.append( field( 'Descrição', fDesc ), field( 'Observações', fNotes ) );

		// dependências
		const deps = el( 'fieldset', 'SimpleLogFieldset SimpleLogDeps' );
		deps.appendChild( el( 'legend', '', 'Depende de' ) );
		for ( const other of p.stages.filter( ( s ) => s.id !== base.id ) ) {

			const lab = el( 'label', 'SimpleCheckboxRow' );
			const box = el( 'input' );
			box.type = 'checkbox';
			box.value = other.id;
			box.checked = base.deps.includes( other.id );
			lab.append( box, el( 'span', '', `${other.number}. ${other.title}` ) );
			deps.appendChild( lab );

		}

		if ( p.stages.length <= ( isNew ? 0 : 1 ) ) deps.appendChild( el( 'p', 'SimpleLogHint', 'Sem outras etapas.' ) );
		form.appendChild( deps );

		// componentes (pelas linhas da base: UUIDs das instâncias)
		const comps = el( 'fieldset', 'SimpleLogFieldset SimpleLogComponents' );
		comps.appendChild( el( 'legend', '', 'Componentes relacionados' ) );
		const chosen = new Set( base.units );
		const selectedRow = el( 'div', 'SimpleLogToolbar' );
		selectedRow.appendChild( button( 'Adicionar a seleção do 3D', () => {

			const sel = editor.selected;
			if ( sel === null ) return context.notify( 'Selecione um componente ou conjunto no 3D.', 'warning' );
			const known = new Set( allLines( p ).flatMap( ( l ) => l.units ) );
			const add = [];
			sel.traverse( ( o ) => known.has( o.uuid ) && add.push( o.uuid ) );
			for ( let c = sel; c !== null && add.length === 0; c = c.parent ) if ( known.has( c.uuid ) ) add.push( c.uuid );
			if ( add.length === 0 ) return context.notify( 'A seleção não corresponde a peças da base do plano.', 'warning' );
			for ( const u of add ) chosen.add( u );
			form.querySelectorAll( '.SimpleLogUnit' ).forEach( ( b ) => ( b.checked = chosen.has( b.value ) ) );

		}, { className: 'SimpleLogAddSelection' } ) );
		comps.appendChild( selectedRow );
		const unitList = el( 'div', 'SimpleLogUnitList' );
		for ( const line of p.baseline.items ) {

			const group = el( 'div', 'SimpleLogUnitGroup' );
			group.appendChild( el( 'strong', '', `${lineLabel( line )} (${line.quantity})` ) );
			line.units.forEach( ( uuid, i ) => {

				const obj = editor.scene.getObjectByProperty( 'uuid', uuid );
				const lab = el( 'label', 'SimpleCheckboxRow' );
				const box = el( 'input', 'SimpleLogUnit' );
				box.type = 'checkbox';
				box.value = uuid;
				box.checked = chosen.has( uuid );
				box.addEventListener( 'change', () => ( box.checked ? chosen.add( uuid ) : chosen.delete( uuid ) ) );
				lab.append( box, el( 'span', '', obj ? obj.name || `unidade ${i + 1}` : `unidade ${i + 1} (excluída do modelo)` ) );
				group.appendChild( lab );

			} );
			unitList.appendChild( group );

		}

		const stale = base.units.filter( ( u ) => p.baseline.items.some( ( l ) => l.units.includes( u ) ) === false );
		if ( stale.length > 0 ) unitList.appendChild( el( 'p', 'SimpleLogHint', `${stale.length} referência(s) de bases anteriores mantida(s) (não transferidas a outros objetos).` ) );
		comps.appendChild( unitList );
		form.appendChild( comps );

		const actions = el( 'div', 'SimpleLogToolbar' );
		const save = el( 'button', 'SimpleButton primary SimpleLogStageSave', isNew ? 'Criar etapa' : 'Salvar etapa' );
		save.type = 'submit';
		actions.append( save, button( 'Cancelar', () => {

			state.editingStage = null;
			render();

		}, { className: 'SimpleLogStageCancel' } ) );
		form.appendChild( actions );
		form.addEventListener( 'submit', ( event ) => {

			event.preventDefault();
			const data = {
				title: fTitle.value, type: fType.value, plannedStart: fStart.value || null, plannedEnd: fEnd.value || null, responsible: fResp.value, kitId: fKit.value || null,
				description: fDesc.value, notes: fNotes.value,
				deps: [ ...deps.querySelectorAll( 'input:checked' ) ].map( ( b ) => b.value ),
				units: [ ...chosen ],
				assemblies: [ ...new Set( [ ...chosen ].map( ( u ) => editor.scene.getObjectByProperty( 'uuid', u ) ).filter( Boolean ).map( ( o ) => {

					let top = null;
					for ( let c = o.parent; c !== null && c !== editor.scene; c = c.parent ) if ( isAssembly( c ) ) top = c;
					return top !== null ? top.uuid : null;

				} ).filter( Boolean ) ) ]
			};
			if ( data.plannedStart && data.plannedEnd && data.plannedEnd < data.plannedStart ) return context.notify( 'O término previsto não pode ser anterior ao início previsto.', 'warning' );
			if ( data.title.trim() === '' ) return context.notify( 'Informe o título da etapa.', 'warning' );
			const ok = isNew ? commit( `Criar etapa: ${data.title}`, ( cur ) => {

				const { plan: created, stage } = addStage( cur, Object.assign( {}, data, { deps: [] } ) );
				return data.deps.length > 0 ? updateStage( created, stage.id, { deps: data.deps } ) : created;

			} ) : commit( `Editar etapa: ${data.title}`, ( cur ) => updateStage( cur, base.id, data ) );
			if ( ok !== null ) {

				state.editingStage = null;
				render();

			}

		} );
		fTitle.focus();

	}

	// ===================================================================================== Separação e Kits

	function renderPicking( p ) {

		const toolbar = el( 'div', 'SimpleLogToolbar' );
		const search = input( state.search, { placeholder: 'Pesquisar código ou descrição', className: 'SimpleLogSearch' } );
		search.addEventListener( 'input', () => {

			state.search = search.value;
			const q = state.search.toLocaleLowerCase( 'pt-BR' );
			body.querySelectorAll( '.SimpleLogPickRow' ).forEach( ( tr ) => ( tr.hidden = q !== '' && tr.dataset.search.includes( q ) === false ) );

		} );
		toolbar.append( search, button( 'Exportar separação — CSV', () => exportCSV(), { icon: 'save', className: 'SimpleLogPickCSV' } ) );
		body.appendChild( toolbar );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'Separar é uma declaração operacional: não gera entrada de estoque nem significa que a peça foi transportada. Quantidade pendente = necessária − separada.' ) );

		const { wrap, tbody } = table( [ 'Código', 'Descrição', 'Rev.', 'Categoria', 'Necessária', 'Separada', 'Não localizada', 'Pendente', 'Local', 'Situação', 'Ações' ], 'SimpleLogPicking' );
		for ( const line of allLines( p ) ) {

			const pick = pickState( line, p.picking[ line.lineId ] );
			const tr = el( 'tr', 'SimpleLogPickRow ' + pick.state );
			tr.dataset.lineId = line.lineId;
			tr.dataset.code = line.code;
			tr.dataset.search = `${line.code} ${line.name}`.toLocaleLowerCase( 'pt-BR' );
			tr.hidden = state.search !== '' && tr.dataset.search.includes( state.search.toLocaleLowerCase( 'pt-BR' ) ) === false;
			const picked = input( String( pick.picked ), { type: 'number', className: 'SimpleLogPicked' } );
			const notFound = input( String( pick.notFound ), { type: 'number', className: 'SimpleLogNotFound' } );
			const location = input( ( p.picking[ line.lineId ] || {} ).location || '', { className: 'SimpleLogLocation', maxLength: 120 } );
			const save = () => recordPicking( line, picked, notFound, location );
			for ( const n of [ picked, notFound, location ] ) n.addEventListener( 'change', save );
			const actions = el( 'td', 'SimpleLogActions' );
			actions.append(
				pick.closed ? button( 'Reabrir', () => commit( 'Reabrir separação', ( cur ) => closePicking( cur, line.lineId, false, responsible() ) ), { className: 'SimpleLogPickReopen' } ) : button( 'Concluir', () => commit( 'Concluir separação', ( cur ) => closePicking( cur, line.lineId, true, responsible() ) ), { className: 'SimpleLogPickClose' } ),
				button( 'Ocorrência', () => incidentFlow( { lineId: line.lineId, type: 'missing' } ), { className: 'SimpleLogPickIncident' } ),
				button( 'Localizar', () => locate( line.units, line.lineId ), { className: 'SimpleLogLocate' } ),
				...( line.catalogId ? [ button( 'Ficha', () => openRecord( line ), { className: 'SimpleLogRecord' } ) ] : [] )
			);
			const cell = ( node ) => {

				const td = el( 'td' );
				td.appendChild( node );
				return td;

			};

			tr.append( el( 'td', '', line.code || '—' ), el( 'td', '', line.name + ( line.retired ? ' (fora do modelo atual)' : '' ) ), el( 'td', '', line.catalogRevision === null ? '' : String( line.catalogRevision ) ), el( 'td', '', line.category ), el( 'td', 'num', String( pick.demand ) ), cell( picked ), cell( notFound ), el( 'td', 'num SimpleLogPending', String( pick.pending ) ), cell( location ), el( 'td', 'SimpleLogPickState', pick.label + ( pick.surplus > 0 ? ` (excedente ${pick.surplus})` : '' ) + ( pick.closed ? ' — concluída' : '' ) ), actions );
			tbody.appendChild( tr );

		}

		body.appendChild( wrap );
		renderKits( p );

	}

	async function recordPicking( line, pickedNode, notFoundNode, locationNode ) {

		const picked = intValue( pickedNode ), notFound = intValue( notFoundNode );
		if ( picked === null || notFound === null ) {

			context.notify( 'Use números inteiros não negativos.', 'warning' );
			return render();

		}

		const data = { picked, notFound, location: locationNode.value, responsible: responsible() };
		await attempt( `Separação: ${line.code || line.name}`, ( cur ) => setPicking( cur, line.lineId, data ), {
			surplus: async ( error ) => {

				const extra = Number( error.details[ 0 ] );
				const choice = await dialog.ask( { title: 'Quantidade acima da necessária', message: error.message, choices: [ { id: 'surplus', label: `Registrar excedente de ${extra}`, kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'surplus' ) return attempt( `Separação com excedente: ${line.code || line.name}`, ( cur ) => setPicking( cur, line.lineId, Object.assign( {}, data, { picked: picked - extra, surplus: extra } ) ) );
				render();
				return false;

			}
		} );

	}

	function renderKits( p ) {

		body.appendChild( el( 'h3', 'SimpleLogH3', 'Kits de montagem' ) );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'Kit é uma unidade logística de organização: não cria objetos 3D nem duplica componentes. Modo exclusivo = alocação física (a soma por peça não excede a necessidade); reutilização = mesma peça usada de novo em etapa seguinte (não conta como peça adicional).' ) );
		body.appendChild( button( 'Criar kit', async () => {

			const answer = await dialog.ask( { title: 'Criar kit', message: 'Nome do kit (ex.: Kit Painéis).', input: { label: 'Nome', value: `Kit ${p.kits.length + 1}`, maxLength: 120 }, choices: [ { id: 'ok', label: 'Criar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
			if ( answer.choice === 'ok' ) commit( `Criar kit: ${answer.value}`, ( cur ) => addKit( cur, { name: answer.value } ) );

		}, { icon: 'add', className: 'SimpleLogKitAdd' } ) );
		const lines = allLines( p ).filter( ( l ) => l.retired !== true );
		for ( const kit of p.kits ) {

			const card = el( 'section', 'SimpleLogCard SimpleLogKit' );
			card.dataset.kitId = kit.id;
			const head = el( 'div', 'SimpleLogCardHead' );
			const name = input( kit.name, { className: 'SimpleLogKitName', maxLength: 120 } );
			name.addEventListener( 'change', () => commit( 'Renomear kit', ( cur ) => updateKit( cur, kit.id, { name: name.value } ) ) );
			const stage = select( stageOptionsFor( p ), kit.stageId || '', 'SimpleLogKitStage' );
			stage.addEventListener( 'change', () => commit( 'Etapa do kit', ( cur ) => updateKit( cur, kit.id, { stageId: stage.value || null } ) ) );
			const pkg = input( kit.packageId, { placeholder: 'Identificação da embalagem', className: 'SimpleLogKitPackage', maxLength: 60 } );
			pkg.addEventListener( 'change', () => commit( 'Embalagem do kit', ( cur ) => updateKit( cur, kit.id, { packageId: pkg.value } ) ) );
			head.append( field( 'Kit', name ), field( 'Etapa relacionada', stage ), field( 'Embalagem', pkg ), button( 'Excluir kit', async () => {

				const choice = await dialog.ask( { title: `Excluir "${kit.name}"?`, message: 'O kit sai do plano (e das cargas). Os registros de separação das peças permanecem.', choices: [ { id: 'delete', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'delete' ) commit( `Excluir kit: ${kit.name}`, ( cur ) => removeKit( cur, kit.id ) );

			}, { className: 'SimpleLogKitDelete danger' } ) );
			card.appendChild( head );
			const details = kitDetails( p, kit );
			const status = kitStatus( p, kit );
			card.appendChild( el( 'p', 'SimpleLogKitSummary' + ( details.weight.partial ? ' partial' : '' ), `${status.label}. ${weightText( details.weight )}` ) );
			const t = table( [ 'Código', 'Descrição', 'Modo', 'Quantidade', 'Peso unitário', 'Peso conhecido', 'Situação', '' ], 'SimpleLogKitItems' );
			for ( const row of details.rows ) {

				const tr = el( 'tr', row.manual ? 'manual' : '' );
				const qty = input( String( row.quantity ), { type: 'number', className: 'SimpleLogKitQty' } );
				qty.addEventListener( 'change', () => {

					const value = intValue( qty );
					if ( value === null ) return context.notify( 'Use um número inteiro não negativo.', 'warning' );
					if ( row.manual ) return commit( 'Item manual do kit', ( cur ) => {

						const next = clone( cur );
						const item = next.kits.find( ( k ) => k.id === kit.id ).items.find( ( i ) => i.id === row.id );
						const from = item.quantity;
						item.quantity = value;
						return stamp( addEvent( next, 'kit-manual-item', { ref: `${kit.id}|${row.id}`, from, to: value, note: MANUAL_LABEL } ) );

					} );
					allocate( kit, row.lineId, value, row.mode );

				} );
				const td = el( 'td' );
				td.appendChild( qty );
				const remove = el( 'td' );
				remove.appendChild( button( 'Remover', () => commit( 'Remover item do kit', ( cur ) => ( row.manual ? removeManualItem( cur, kit.id, row.id ) : setKitItem( cur, kit.id, row.lineId, 0, row.mode ) ) ), { className: 'SimpleLogKitRemove danger' } ) );
				tr.append( el( 'td', '', row.code || ( row.manual ? '(manual)' : '—' ) ), el( 'td', '', row.name ), el( 'td', '', row.manual ? 'Item manual' : row.mode === 'reuse' ? 'Reutilização' : 'Exclusivo' ), td, el( 'td', 'num', row.unitWeight === null ? 'Não informado' : kg( row.unitWeight ) ), el( 'td', 'num', row.weight === null ? '—' : kg( row.weight ) ), el( 'td', '', row.status ), remove );
				t.tbody.appendChild( tr );

			}

			if ( details.rows.length > 0 ) card.appendChild( t.wrap );
			// adicionar peça do plano
			const addRow = el( 'div', 'SimpleLogToolbar SimpleLogKitAddRow' );
			const lineSel = select( lines.map( ( l ) => [ l.lineId, `${lineLabel( l )} — necessário ${demandOf( l )}, em kits ${kitAllocation( p, l.lineId )}` ] ), lines.length > 0 ? lines[ 0 ].lineId : '', 'SimpleLogKitLine' );
			const addQty = input( '1', { type: 'number', className: 'SimpleLogKitAddQty' } );
			const mode = select( [[ 'exclusive', 'Exclusivo (alocação física)' ], [ 'reuse', 'Reutilização sequencial' ]], 'exclusive', 'SimpleLogKitMode' );
			addRow.append( lineSel, addQty, mode, button( 'Adicionar peça', () => {

				const value = intValue( addQty );
				if ( value === null || value === 0 ) return context.notify( 'Informe uma quantidade inteira positiva.', 'warning' );
				const existing = kit.items.find( ( i ) => i.manual !== true && i.lineId === lineSel.value && i.mode === mode.value );
				allocate( kit, lineSel.value, ( existing ? existing.quantity : 0 ) + value, mode.value );

			}, { className: 'SimpleLogKitAddLine' } ) );
			card.appendChild( addRow );
			const manualRow = el( 'div', 'SimpleLogToolbar SimpleLogKitManualRow' );
			const mName = input( '', { placeholder: 'Item manual (ex.: parafusos, fita)', className: 'SimpleLogManualName', maxLength: 120 } );
			const mQty = input( '1', { type: 'number', className: 'SimpleLogManualQty' } );
			const mWeight = input( '', { placeholder: 'Peso unit. (kg) — opcional', className: 'SimpleLogManualWeight', maxLength: 20 } );
			manualRow.append( mName, mQty, mWeight, button( 'Adicionar item manual', () => {

				const q = intValue( mQty );
				const raw = mWeight.value.trim().replace( ',', '.' );
				const w = raw === '' ? null : Number( raw );
				if ( q === null || q === 0 ) return context.notify( 'Informe uma quantidade inteira positiva.', 'warning' );
				if ( w !== null && ( Number.isFinite( w ) === false || w <= 0 ) ) return context.notify( 'Peso inválido (deixe vazio se não for conhecido).', 'warning' );
				commit( 'Adicionar item manual', ( cur ) => addManualItem( cur, kit.id, { name: mName.value, quantity: q, unitWeight: w } ) );

			}, { className: 'SimpleLogManualAdd' } ) );
			card.appendChild( manualRow );
			card.appendChild( el( 'small', 'SimpleLogHint', MANUAL_LABEL + ': não entra na cena nem no orçamento e não é quantitativo geométrico.' ) );
			body.appendChild( card );

		}

	}

	async function allocate( kit, lineId, quantity, mode ) {

		await attempt( `Alocação no kit: ${kit.name}`, ( cur ) => setKitItem( cur, kit.id, lineId, quantity, mode ), {
			allocation: async ( error ) => {

				const choice = await dialog.ask( { title: 'Duplicidade de peças físicas', message: error.message, details: [ 'Se a mesma peça física for usada de novo numa etapa seguinte, registre como reutilização sequencial (não conta como peça adicional).' ], choices: [ { id: 'reuse', label: 'Registrar como reutilização', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'reuse' ) return attempt( `Reutilização no kit: ${kit.name}`, ( cur ) => setKitItem( cur, kit.id, lineId, quantity, 'reuse' ) );
				render();
				return false;

			}
		} );

	}

	// ===================================================================================== Transporte

	function renderTransport( p ) {

		body.appendChild( button( 'Nova carga', () => commit( 'Criar carga', ( cur ) => addLoad( cur, {} ) ), { icon: 'add', className: 'SimpleLogLoadAdd' } ) );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'Uma carga representa uma distribuição planejada — não significa que o transporte ocorreu. ' + TRANSPORT_LIMITS ) );
		if ( p.loads.length === 0 ) body.appendChild( el( 'p', 'SimpleLogEmpty', 'Nenhuma carga planejada.' ) );
		const lines = allLines( p ).filter( ( l ) => l.retired !== true );
		for ( const load of p.loads ) {

			const card = el( 'section', 'SimpleLogCard SimpleLogLoad' );
			card.dataset.loadId = load.id;
			const grid = el( 'div', 'SimpleLogGrid' );
			const fieldFor = ( label, value, key, opts = {}, vehicle = false ) => {

				const node = input( value, opts );
				node.addEventListener( 'change', () => {

					let v = node.value;
					if ( opts.numeric ) {

						const raw = v.trim().replace( ',', '.' );
						v = raw === '' ? null : Number( raw );
						if ( v !== null && ( Number.isFinite( v ) === false || v <= 0 ) ) return context.notify( 'Valor inválido (deixe vazio se não for informado).', 'warning' );

					}

					commit( `Editar carga: ${load.code}`, ( cur ) => updateLoad( cur, load.id, vehicle ? { vehicle: { [ key ]: v } } : { [ key ]: v || ( key === 'date' ? null : '' ) } ) );

				} );
				grid.appendChild( field( label, node ) );
				return node;

			};

			fieldFor( 'Código / nome', load.code, 'code', { className: 'SimpleLogLoadCode', maxLength: 60 } );
			fieldFor( 'Data prevista', load.date || '', 'date', { type: 'date', className: 'SimpleLogLoadDate' } );
			fieldFor( 'Origem', load.origin, 'origin', { className: 'SimpleLogLoadOrigin' } );
			fieldFor( 'Destino', load.destination, 'destination', { className: 'SimpleLogLoadDestination' } );
			fieldFor( 'Responsável informado', load.responsible, 'responsible', { className: 'SimpleLogLoadResp', maxLength: 80 } );
			fieldFor( 'Veículo / meio informado', load.vehicle.name, 'name', { className: 'SimpleLogVehicle' }, true );
			fieldFor( 'Capacidade declarada (kg)', load.vehicle.capacityKg === null ? '' : String( load.vehicle.capacityKg ).replace( '.', ',' ), 'capacityKg', { className: 'SimpleLogCapacity', numeric: true, maxLength: 20 }, true );
			fieldFor( 'Volume útil informado (m³)', load.vehicle.volumeM3 === null ? '' : String( load.vehicle.volumeM3 ).replace( '.', ',' ), 'volumeM3', { className: 'SimpleLogVolume', numeric: true, maxLength: 20 }, true );
			card.appendChild( grid );

			const kits = el( 'fieldset', 'SimpleLogFieldset SimpleLogLoadKits' );
			kits.appendChild( el( 'legend', '', 'Kits associados' ) );
			for ( const kit of p.kits ) {

				const lab = el( 'label', 'SimpleCheckboxRow' );
				const box = el( 'input' );
				box.type = 'checkbox';
				box.value = kit.id;
				box.checked = load.kits.includes( kit.id );
				box.addEventListener( 'change', () => {

					const ids = [ ...kits.querySelectorAll( 'input:checked' ) ].map( ( b ) => b.value );
					commit( `Kits da carga: ${load.code}`, ( cur ) => setLoadKits( cur, load.id, ids ) );

				} );
				lab.append( box, el( 'span', '', kit.name ) );
				kits.appendChild( lab );

			}

			if ( p.kits.length === 0 ) kits.appendChild( el( 'p', 'SimpleLogHint', 'Nenhum kit cadastrado (aba Separação e Kits).' ) );
			card.appendChild( kits );
			const addRow = el( 'div', 'SimpleLogToolbar' );
			const lineSel = select( lines.map( ( l ) => [ l.lineId, lineLabel( l ) ] ), lines.length > 0 ? lines[ 0 ].lineId : '', 'SimpleLogLoadLine' );
			const qty = input( '1', { type: 'number', className: 'SimpleLogLoadQty' } );
			const transfer = el( 'label', 'SimpleCheckboxRow' );
			const tBox = el( 'input' );
			tBox.type = 'checkbox';
			transfer.append( tBox, el( 'span', '', 'Transferência/reutilização declarada' ) );
			addRow.append( lineSel, qty, transfer, button( 'Adicionar peça avulsa', () => {

				const value = intValue( qty );
				if ( value === null || value === 0 ) return context.notify( 'Informe uma quantidade inteira positiva.', 'warning' );
				const existing = load.items.find( ( i ) => i.lineId === lineSel.value && i.transfer === tBox.checked );
				commit( `Peça avulsa na carga: ${load.code}`, ( cur ) => setLoadItem( cur, load.id, lineSel.value, ( existing ? existing.quantity : 0 ) + value, tBox.checked ) );

			}, { className: 'SimpleLogLoadAddLine' } ) );
			card.appendChild( addRow );

			const d = loadDetails( p, load );
			card.appendChild( el( 'p', 'SimpleLogLoadWeight' + ( d.weight.partial ? ' partial' : '' ), `${d.stateLabel}. ${weightText( d.weight )}${d.weight.packaged > 0 ? ` Peso embalado conhecido: ${kg( d.weight.packaged )}${d.weight.packagedUnknown > 0 ? ' (parcial)' : ''}.` : ''}${d.weight.volume > 0 ? ` Volume de embalagens informado: ${d.weight.volume.toLocaleString( 'pt-BR', { maximumFractionDigits: 3 } )} m³${d.weight.volumeUnknown > 0 ? ' (parcial)' : ''} — informativo, não é ocupação real no veículo.` : ''}` ) );
			card.appendChild( el( 'p', 'SimpleLogCapacityText ' + d.capacityState, d.capacityText ) );
			card.appendChild( el( 'h4', 'SimpleLogH4', 'Lista de carregamento' ) );
			const t = table( [ 'Kit / origem', 'Código', 'Descrição', 'Planejada', 'Carregada', 'Pendente', 'Peso conhecido', 'Observações' ], 'SimpleLogLoading' );
			for ( const row of d.rows ) {

				const tr = el( 'tr', 'SimpleLogLoadingRow' );
				tr.dataset.lineId = row.lineId;
				const loaded = input( String( row.loaded ), { type: 'number', className: 'SimpleLogLoaded' } );
				const notes = input( row.notes, { className: 'SimpleLogLoadedNotes', maxLength: 600 } );
				const saveLoaded = async () => {

					const value = intValue( loaded );
					if ( value === null ) return context.notify( 'Use um número inteiro não negativo.', 'warning' );
					await attempt( `Carregamento: ${load.code}`, ( cur ) => setLoaded( cur, load.id, row.lineId, { loaded: value, notes: notes.value, responsible: responsible() } ), {
						surplus: async ( error ) => {

							const extra = Number( error.details[ 0 ] );
							const choice = await dialog.ask( { title: 'Carregado acima do planejado', message: error.message, choices: [ { id: 'surplus', label: `Registrar excedente de ${extra}`, kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
							if ( choice === 'surplus' ) return attempt( `Carregamento com excedente: ${load.code}`, ( cur ) => setLoaded( cur, load.id, row.lineId, { loaded: value - extra, surplus: extra, notes: notes.value, responsible: responsible() } ) );
							render();
							return false;

						}
					} );

				};

				loaded.addEventListener( 'change', saveLoaded );
				notes.addEventListener( 'change', saveLoaded );
				const c1 = el( 'td' ), c2 = el( 'td' );
				c1.appendChild( loaded );
				c2.appendChild( notes );
				tr.append( el( 'td', '', row.via ), el( 'td', '', row.code || '—' ), el( 'td', '', row.name ), el( 'td', 'num', String( row.planned ) ), c1, el( 'td', 'num SimpleLogPending', String( row.pending ) + ( row.surplus ? ` (+${row.surplus} excedente)` : '' ) ), el( 'td', 'num', row.weight === null ? 'Não informado' : kg( row.weight ) ), c2 );
				t.tbody.appendChild( tr );

			}

			for ( const m of d.manual ) {

				const tr = el( 'tr', 'manual' );
				tr.append( el( 'td', '', 'Item manual' ), el( 'td', '', '' ), el( 'td', '', m.name ), el( 'td', 'num', String( m.quantity ) ), el( 'td', '', '—' ), el( 'td', '', '' ), el( 'td', 'num', m.unitWeight === null ? 'Não informado' : kg( m.unitWeight * m.quantity ) ), el( 'td', '', MANUAL_LABEL ) );
				t.tbody.appendChild( tr );

			}

			if ( d.rows.length + d.manual.length > 0 ) card.appendChild( t.wrap );
			else card.appendChild( el( 'p', 'SimpleLogHint', 'Carga vazia: associe kits ou peças avulsas.' ) );
			card.appendChild( button( 'Excluir carga', async () => {

				const choice = await dialog.ask( { title: `Excluir "${load.code}"?`, message: 'Cargas com carregamento ou recebimento registrado não podem ser excluídas.', choices: [ { id: 'delete', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( choice === 'delete' ) commit( `Excluir carga: ${load.code}`, ( cur ) => removeLoad( cur, load.id ) );

			}, { className: 'SimpleLogLoadDelete danger' } ) );
			body.appendChild( card );

		}

	}

	// ===================================================================================== Conferência

	function renderCheck( p ) {

		const toolbar = el( 'div', 'SimpleLogToolbar' );
		toolbar.append(
			button( 'Modo conferência (toque)', () => {

				state.field = true;
				render();

			}, { className: 'SimpleLogOpenField' } ),
			button( 'Exportar registros de conferência', () => exportTransfer(), { icon: 'save', className: 'SimpleLogTransferExport' } ),
			button( 'Importar registros de conferência', () => importInput.click(), { icon: 'open', className: 'SimpleLogTransferImport' } )
		);
		body.appendChild( toolbar );

		// recebimento
		body.appendChild( el( 'h3', 'SimpleLogH3', 'Conferência de recebimento' ) );
		body.appendChild( el( 'p', 'SimpleLogNotice', RECEIVING_CONVENTION + ' Peça sem avaria registrada não está "tecnicamente aprovada": apenas não teve avaria declarada.' ) );
		if ( p.loads.length === 0 ) body.appendChild( el( 'p', 'SimpleLogEmpty', 'Nenhuma carga planejada.' ) );
		for ( const load of p.loads ) {

			const d = loadDetails( p, load );
			const t = table( [ 'Código', 'Descrição', 'Esperada', 'Carregada (declarado)', 'Recebida', 'Avariada (incluída)', 'Excedente', 'Faltante', 'Sem avaria declarada', 'Registro', 'Observações' ], 'SimpleLogReceiving' );
			for ( const row of d.rows ) {

				const key = `${load.id}|${row.lineId}`;
				const rec = p.receiving[ key ];
				const st = receivingState( row.planned, rec );
				const tr = el( 'tr', 'SimpleLogReceivingRow' + ( st.registered && ( st.missing > 0 || st.damaged > 0 ) ? ' divergent' : '' ) );
				tr.dataset.lineId = row.lineId;
				tr.dataset.loadId = load.id;
				const received = input( st.registered ? String( st.received ) : '', { type: 'number', className: 'SimpleLogReceived', placeholder: '—' } );
				const damaged = input( String( st.damaged ), { type: 'number', className: 'SimpleLogDamaged' } );
				const surplus = input( String( st.surplus ), { type: 'number', className: 'SimpleLogRecSurplus' } );
				const notes = input( rec ? rec.notes : '', { className: 'SimpleLogRecNotes', maxLength: 600 } );
				const save = () => {

					if ( received.value.trim() === '' ) return;
					const r = intValue( received ), dmg = intValue( damaged ), sp = intValue( surplus );
					if ( r === null || dmg === null || sp === null ) return context.notify( 'Use números inteiros não negativos.', 'warning' );
					commit( `Recebimento: ${load.code}`, ( cur ) => setReceived( cur, load.id, row.lineId, { received: r, damaged: dmg, surplus: sp, notes: notes.value, responsible: responsible() } ) );

				};

				for ( const n of [ received, damaged, surplus, notes ] ) n.addEventListener( 'change', save );
				const cell = ( n ) => {

					const td = el( 'td' );
					td.appendChild( n );
					return td;

				};

				tr.append( el( 'td', '', row.code || '—' ), el( 'td', '', row.name ), el( 'td', 'num', String( st.expected ) ), el( 'td', 'num', String( row.loaded ) ), cell( received ), cell( damaged ), cell( surplus ), el( 'td', 'num SimpleLogMissing', st.registered ? String( st.missing ) : '' ), el( 'td', 'num SimpleLogFit', st.registered ? String( st.fit ) : '' ), el( 'td', '', rec ? `${brDateTime( rec.updatedAt )}${rec.responsible ? ' — ' + rec.responsible : ''}` : 'Não registrado' ), cell( notes ) );
				t.tbody.appendChild( tr );

			}

			body.appendChild( el( 'h4', 'SimpleLogH4', `${load.code} — ${d.stateLabel}` ) );
			body.appendChild( d.rows.length > 0 ? t.wrap : el( 'p', 'SimpleLogHint', 'Carga vazia.' ) );

		}

		// acompanhamento da montagem/desmontagem
		body.appendChild( el( 'h3', 'SimpleLogH3', 'Acompanhamento da montagem e desmontagem' ) );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'Progresso declarado: nada é movido no modelo 3D, e carregar peças não conclui etapas.' ) );
		const st = table( [ 'Etapa', 'Tipo', 'Componentes previstos', 'Utilizados/instalados (declarado)', 'Status', 'Pendências', 'Ações' ], 'SimpleLogProgress' );
		for ( const stage of p.stages ) {

			const tr = el( 'tr', 'SimpleLogProgressRow' );
			tr.dataset.stageId = stage.id;
			const installed = input( String( stage.installed ), { type: 'number', className: 'SimpleLogInstalled' } );
			installed.addEventListener( 'change', () => {

				const v = intValue( installed );
				if ( v === null ) return context.notify( 'Use um número inteiro não negativo.', 'warning' );
				commit( `Progresso: ${stage.title}`, ( cur ) => setStageProgress( cur, stage.id, v, { responsible: responsible() } ) );

			} );
			const status = select( STAGE_STATUSES.map( ( x ) => [ x.id, x.name ] ), stage.status, 'SimpleLogProgressStatus' );
			status.addEventListener( 'change', () => changeStatus( stage, status.value ) );
			const c1 = el( 'td' ), c2 = el( 'td' ), c3 = el( 'td', 'SimpleLogActions' );
			c1.appendChild( installed );
			c2.appendChild( status );
			c3.append( button( 'Localizar no projeto', () => locate( stage.units, 'stage:' + stage.id ), { className: 'SimpleLogLocate' } ), button( 'Ocorrência', () => incidentFlow( { type: 'other', ref: { kind: 'stage', id: stage.id } } ), { className: 'SimpleLogStageIncident' } ) );
			const missingRefs = stage.units.filter( ( u ) => editor.scene.getObjectByProperty( 'uuid', u ) === undefined ).length;
			tr.append( el( 'td', '', `${stage.number}. ${stage.title}` ), el( 'td', '', labelOf( STAGE_TYPES, stage.type ) ), el( 'td', 'num', String( stage.units.length ) ), c1, c2, el( 'td', '', [ stage.units.length - stage.installed > 0 ? `${stage.units.length - stage.installed} a declarar` : '', missingRefs > 0 ? `${missingRefs} referência(s) inválida(s)` : '' ].filter( Boolean ).join( ' · ' ) ), c3 );
			st.tbody.appendChild( tr );

		}

		body.appendChild( p.stages.length > 0 ? st.wrap : el( 'p', 'SimpleLogEmpty', 'Nenhuma etapa cadastrada.' ) );

		// retorno
		body.appendChild( el( 'h3', 'SimpleLogH3', 'Conferência de retorno' ) );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'A classificação é informada por você (nunca inferida do material visual). Consumíveis e descartáveis não são presumidos como devolvidos. Avariadas estão incluídas nas devolvidas.' ) );
		const rt = table( [ 'Código', 'Descrição', 'Classificação', 'Prevista', 'Devolvida', 'Avariada (incluída)', 'Descartada', 'Faltante', 'Situação', 'Observações' ], 'SimpleLogReturns' );
		for ( const line of allLines( p ) ) {

			const r = returnState( p, line );
			const rec = p.returns[ line.lineId ];
			const tr = el( 'tr', 'SimpleLogReturnRow ' + r.state );
			tr.dataset.lineId = line.lineId;
			const cls = select( CLASSIFICATIONS.map( ( c ) => [ c.id, c.name ] ), classificationOf( p, line.lineId ), 'SimpleLogClass' );
			cls.addEventListener( 'change', () => commit( 'Classificação de retorno', ( cur ) => setClassification( cur, line.lineId, cls.value ) ) );
			const returned = input( String( r.returned ), { type: 'number', className: 'SimpleLogReturned' } );
			const damaged = input( String( r.damaged ), { type: 'number', className: 'SimpleLogRetDamaged' } );
			const discarded = input( String( r.discarded ), { type: 'number', className: 'SimpleLogDiscarded' } );
			const notes = input( rec ? rec.notes : '', { className: 'SimpleLogRetNotes', maxLength: 600 } );
			const save = () => {

				const a = intValue( returned ), b = intValue( damaged ), c = intValue( discarded );
				if ( a === null || b === null || c === null ) return context.notify( 'Use números inteiros não negativos.', 'warning' );
				commit( `Retorno: ${line.code || line.name}`, ( cur ) => setReturn( cur, line.lineId, { returned: a, damaged: b, discarded: c, notes: notes.value, responsible: responsible() } ) );

			};

			for ( const n of [ returned, damaged, discarded, notes ] ) n.addEventListener( 'change', save );
			const cell = ( n ) => {

				const td = el( 'td' );
				td.appendChild( n );
				return td;

			};

			tr.append( el( 'td', '', line.code || '—' ), el( 'td', '', line.name ), cell( cls ), el( 'td', 'num', String( r.expected ) ), cell( returned ), cell( damaged ), cell( discarded ), el( 'td', 'num SimpleLogMissing', String( r.missing ) ), el( 'td', 'SimpleLogReturnState', r.label ), cell( notes ) );
			rt.tbody.appendChild( tr );

		}

		body.appendChild( rt.wrap );

		// ocorrências
		body.appendChild( el( 'h3', 'SimpleLogH3', 'Ocorrências' ) );
		body.appendChild( button( 'Registrar ocorrência', () => incidentFlow( {} ), { icon: 'add', className: 'SimpleLogIncidentAdd' } ) );
		const it = table( [ 'Tipo', 'Data', 'Peça', 'Qtd.', 'Descrição', 'Status', 'Histórico' ], 'SimpleLogIncidents' );
		const lines = lineMap( p );
		for ( const incident of p.incidents ) {

			const tr = el( 'tr', 'SimpleLogIncidentRow ' + incident.status );
			tr.dataset.incidentId = incident.id;
			const status = select( INCIDENT_STATUSES.map( ( s ) => [ s.id, s.name ] ), incident.status, 'SimpleLogIncidentStatus' );
			status.addEventListener( 'change', async () => {

				const answer = await dialog.ask( { title: 'Alterar status da ocorrência', message: `${labelOf( INCIDENT_STATUSES, incident.status )} → ${labelOf( INCIDENT_STATUSES, status.value )}. A ocorrência e seu histórico são preservados.`, input: { label: 'Observação', value: '', maxLength: 300 }, choices: [ { id: 'ok', label: 'Confirmar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( answer.choice === 'ok' ) commit( 'Status da ocorrência', ( cur ) => setIncidentStatus( cur, incident.id, status.value, { note: answer.value, responsible: responsible() } ) );
				else render();

			} );
			const c = el( 'td' );
			c.appendChild( status );
			tr.append( el( 'td', '', labelOf( INCIDENT_TYPES, incident.type ) ), el( 'td', '', brDateTime( incident.date ) ), el( 'td', '', incident.lineId ? lineLabel( lines.get( incident.lineId ) ) : ( incident.ref ? `${incident.ref.kind}` : '' ) ), el( 'td', 'num', String( incident.quantity ) ), el( 'td', '', incident.description ), c, el( 'td', 'SimpleLogIncidentHistory', incident.history.map( ( h ) => `${brDateTime( h.at )} ${labelOf( INCIDENT_STATUSES, h.status )}${h.note ? ': ' + h.note : ''}` ).join( ' | ' ) ) );
			it.tbody.appendChild( tr );

		}

		body.appendChild( p.incidents.length > 0 ? it.wrap : el( 'p', 'SimpleLogEmpty', 'Nenhuma ocorrência registrada.' ) );

	}

	async function incidentFlow( { lineId = null, type = 'other', ref = null } ) {

		const p = plan();
		const box = el( 'div', 'SimpleLogIncidentForm' );
		const typeSel = select( INCIDENT_TYPES.map( ( t ) => [ t.id, t.name ] ), type, 'SimpleLogIncidentType' );
		const lineSel = select( [[ '', 'Nenhuma peça específica' ]].concat( allLines( p ).map( ( l ) => [ l.lineId, lineLabel( l ) ] ) ), lineId || '', 'SimpleLogIncidentLine' );
		const qty = input( '1', { type: 'number', className: 'SimpleLogIncidentQty' } );
		box.append( field( 'Tipo', typeSel ), field( 'Peça relacionada', lineSel ), field( 'Quantidade afetada', qty ) );
		const pending = dialog.ask( { title: 'Registrar ocorrência', message: 'Descreva a ocorrência. Ela fica no histórico e nunca é apagada automaticamente.', input: { label: 'Descrição', value: '', maxLength: 1000 }, choices: [ { id: 'ok', label: 'Registrar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		const target = document.querySelector( '.SimpleDialog .SimpleDialogMessage, .SimpleDialog p' );
		if ( target !== null ) target.after( box );
		const answer = await pending;
		if ( answer.choice !== 'ok' ) return;
		const quantity = intValue( qty );
		commit( `Ocorrência: ${labelOf( INCIDENT_TYPES, typeSel.value )}`, ( cur ) => addIncident( cur, { type: typeSel.value, lineId: lineSel.value || null, ref: lineSel.value ? { kind: 'line', id: lineSel.value } : ref, quantity: quantity === null ? 0 : quantity, description: answer.value, responsible: responsible() } ) );

	}

	function openRecord( line ) {

		const { record } = resolveRecord( editor.scene, line.catalogId, line.catalogRevision );
		if ( record === null ) return context.notify( 'Ficha técnica não localizada no projeto nem no catálogo local.', 'warning' );
		if ( context.technical && context.technical.panel ) {

			close();
			context.technical.panel.viewRecord( record );

		}

	}

	// ===================================================================================== Modo conferência (toque)

	function renderField( p ) {

		if ( p.planId === null ) {

			body.appendChild( el( 'p', 'SimpleLogEmpty', 'Ainda não há plano neste projeto.' ) );
			return;

		}

		const toolbar = el( 'div', 'SimpleLogToolbar SimpleLogFieldTabs' );
		for ( const [ id, label ] of [[ 'stage', 'Por etapa' ], [ 'kit', 'Por kit' ]] ) {

			const b = button( label, () => {

				state.fieldView = id;
				render();

			}, { className: 'SimpleLogFieldView' + ( state.fieldView === id ? ' active' : '' ) } );
			b.dataset.view = id;
			toolbar.appendChild( b );

		}

		toolbar.appendChild( button( 'Registrar ocorrência', () => incidentFlow( {} ), { className: 'SimpleLogFieldIncident' } ) );
		body.appendChild( toolbar );
		body.appendChild( el( 'p', 'SimpleLogHint', 'Registros salvos localmente no projeto (sem sincronização entre equipes). Para levar a outro aparelho, use "Exportar registros de conferência".' ) );
		const lines = lineMap( p );
		const pickCard = ( line, label = null ) => {

			const pick = pickState( line, p.picking[ line.lineId ] );
			const card = el( 'div', 'SimpleLogFieldItem ' + pick.state );
			card.dataset.lineId = line.lineId;
			const info = el( 'div', 'SimpleLogFieldInfo' );
			info.append( el( 'strong', '', label || lineLabel( line ) ), el( 'span', '', `Separadas ${pick.picked} de ${pick.demand} · pendentes ${pick.pending}` ) );
			const step = ( delta ) => () => recordPickingValue( line, Math.max( pick.picked + delta, 0 ) );
			const controls = el( 'div', 'SimpleLogFieldControls' );
			controls.append( button( '−', step( - 1 ), { className: 'SimpleLogFieldMinus', title: 'Diminuir separadas' } ), button( '+', step( 1 ), { className: 'SimpleLogFieldPlus', title: 'Aumentar separadas' } ) );
			if ( line.catalogId ) controls.appendChild( button( 'Ficha', () => openRecord( line ), { className: 'SimpleLogRecord' } ) );
			card.append( info, controls );
			return card;

		};

		if ( state.fieldView === 'kit' ) {

			if ( p.kits.length === 0 ) body.appendChild( el( 'p', 'SimpleLogEmpty', 'Nenhum kit cadastrado.' ) );
			for ( const kit of p.kits ) {

				const section = el( 'section', 'SimpleLogFieldSection' );
				section.appendChild( el( 'h3', 'SimpleLogH3', `${kit.name} — ${kitStatus( p, kit ).label}` ) );
				for ( const item of kit.items ) {

					if ( item.manual ) section.appendChild( el( 'div', 'SimpleLogFieldItem manual', `${item.quantity} × ${item.name} (${MANUAL_LABEL})` ) );
					else if ( lines.has( item.lineId ) ) section.appendChild( pickCard( lines.get( item.lineId ), `${lineLabel( lines.get( item.lineId ) )} — ${item.quantity} no kit` ) );

				}

				body.appendChild( section );

			}

			return;

		}

		if ( p.stages.length === 0 ) body.appendChild( el( 'p', 'SimpleLogEmpty', 'Nenhuma etapa cadastrada.' ) );
		for ( const stage of p.stages ) {

			const section = el( 'section', 'SimpleLogFieldSection' );
			section.dataset.stageId = stage.id;
			section.appendChild( el( 'h3', 'SimpleLogH3', `${stage.number}. ${stage.title} — ${labelOf( STAGE_STATUSES, stage.status )}` ) );
			const controls = el( 'div', 'SimpleLogFieldControls' );
			controls.append(
				button( 'Iniciar', () => changeStatus( stage, 'doing' ), { className: 'SimpleLogFieldStart' } ),
				button( 'Concluir', () => changeStatus( stage, 'done' ), { className: 'SimpleLogFieldDone' } ),
				button( `Instalados: ${stage.installed}/${stage.units.length} −`, () => commit( `Progresso: ${stage.title}`, ( cur ) => setStageProgress( cur, stage.id, Math.max( stage.installed - 1, 0 ), { responsible: responsible() } ) ), { className: 'SimpleLogFieldInstMinus' } ),
				button( '+', () => commit( `Progresso: ${stage.title}`, ( cur ) => setStageProgress( cur, stage.id, stage.installed + 1, { responsible: responsible() } ) ), { className: 'SimpleLogFieldInstPlus' } ),
				button( 'Localizar', () => locate( stage.units, 'stage:' + stage.id ), { className: 'SimpleLogLocate' } )
			);
			section.appendChild( controls );
			const stageLines = allLines( p ).filter( ( l ) => l.units.some( ( u ) => stage.units.includes( u ) ) );
			for ( const line of stageLines ) section.appendChild( pickCard( line ) );
			body.appendChild( section );

		}

	}

	async function recordPickingValue( line, value ) {

		const current = plan().picking[ line.lineId ] || {};
		await attempt( `Separação: ${line.code || line.name}`, ( cur ) => setPicking( cur, line.lineId, { picked: value, notFound: current.notFound || 0, responsible: responsible() } ), {
			surplus: async ( error ) => {

				context.notify( error.message + ' Use a aba Separação e Kits para registrar excedente.', 'warning' );
				return false;

			}
		} );

	}

	// ===================================================================================== Relatórios e transferência

	const meta = () => ( { projectTitle: editor.config.getKey( 'project/title' ) || '', date: new Date() } );
	const fileBase = () => ( editor.config.getKey( 'project/title' ) || 'projeto' ).replace( /[^A-Za-z0-9À-ÿ._-]+/g, '_' ).slice( 0, 50 );

	function exportCSV() {

		editor.utils.save( new Blob( [ toPickingCSV( plan(), meta().projectTitle ) ], { type: 'text/csv;charset=utf-8' } ), `separacao-${fileBase()}.csv` );

	}

	function renderReports( p ) {

		const grid = el( 'div', 'SimpleLogReports' );
		grid.append(
			button( 'Exportar separação — CSV', () => exportCSV(), { icon: 'save', className: 'SimpleLogPickCSV' } ),
			button( 'Exportar plano logístico — Excel', () => editor.utils.save( toLogisticsXLSX( plan(), meta() ), `plano-logistico-${fileBase()}.xlsx` ), { icon: 'save', className: 'SimpleLogXLSX' } )
		);
		for ( const [ kind, label ] of Object.entries( LOGISTICS_REPORTS ) ) {

			const b = button( `PDF — ${label}`, () => editor.utils.save( toLogisticsPDF( plan(), meta(), kind ), `${label.toLowerCase().replace( /\s+/g, '-' ).normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' )}-${fileBase()}.pdf` ), { icon: 'save', className: 'SimpleLogPDF' } );
			b.dataset.report = kind;
			grid.appendChild( b );

		}

		body.appendChild( grid );
		body.appendChild( el( 'p', 'SimpleLogNotice', 'Relatórios operacionais: "Plano de Montagem e Logística — Project3DS". Não são laudos, certificados nem autorizações de transporte.' ) );
		body.appendChild( el( 'h3', 'SimpleLogH3', 'Histórico operacional' ) );
		body.appendChild( el( 'p', 'SimpleLogHint', 'Registro local, só de acréscimo (Desfazer/Refazer acrescentam marcadores e não apagam eventos). Não é auditoria independente nem trilha inviolável.' ) );
		const t = table( [ 'Data e hora', 'Tipo', 'Referência', 'Anterior', 'Novo', 'Responsável declarado', 'Observação' ], 'SimpleLogEvents' );
		for ( const e of p.events.slice( - 300 ).reverse() ) {

			const tr = el( 'tr' );
			tr.append( el( 'td', '', brDateTime( e.at ) ), el( 'td', '', e.type ), el( 'td', '', e.ref.slice( 0, 40 ) ), el( 'td', '', e.from === null ? '' : String( e.from ) ), el( 'td', '', e.to === null ? '' : String( e.to ) ), el( 'td', '', e.responsible ), el( 'td', '', e.note ) );
			t.tbody.appendChild( tr );

		}

		body.appendChild( t.wrap );
		if ( p.events.length > 300 ) body.appendChild( el( 'p', 'SimpleLogHint', `Exibindo os 300 eventos mais recentes de ${p.events.length} (todos estão nos relatórios e no projeto).` ) );

	}

	async function exportTransfer() {

		try {

			const { blob, name } = await exportChecks( plan(), meta().projectTitle );
			editor.utils.save( blob, name );

		} catch ( error ) {

			context.notify( error.message, 'warning' );

		}

	}

	async function importFile( file ) {

		let analysis;
		try {

			analysis = await analyzeChecks( file, plan() );

		} catch ( error ) {

			await dialog.ask( { title: 'Registros não importados', message: error.message, choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );
			return;

		}

		if ( analysis.changes.length === 0 && analysis.events.length === 0 && analysis.conflicts.length === 0 ) return dialog.ask( { title: 'Nada a importar', message: 'Os registros do arquivo já estão no plano.', choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );
		const lines = lineMap( plan() );
		const describe = ( c ) => `${c.kind === 'stage' ? `Etapa "${c.label}"` : c.kind === 'incident' ? 'Ocorrência' : `${c.kind} — ${lineLabel( lines.get( c.key.split( '|' ).pop() ) )}`}: local ${JSON.stringify( c.local ).slice( 0, 80 )} × arquivo ${JSON.stringify( c.incoming ).slice( 0, 80 )}`;
		const choices = [ { id: 'apply', label: analysis.conflicts.length > 0 ? 'Incorporar só os registros sem conflito' : 'Incorporar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ];
		const choice = await dialog.ask( { title: analysis.conflicts.length > 0 ? 'Conflitos nos registros de conferência' : 'Importar registros de conferência', message: `${analysis.changes.length} registro(s) novo(s), ${analysis.events.length} evento(s) novo(s), ${analysis.conflicts.length} conflito(s). Registros em conflito NÃO sobrescrevem os locais.`, details: analysis.warnings.concat( analysis.conflicts.slice( 0, 15 ).map( describe ) ), choices } );
		if ( choice !== 'apply' ) return;
		commit( 'Importar registros de conferência', ( cur ) => applyChecks( cur, analysis ) );

	}

	return {
		open, close, show, isOpen: () => state.open,
		state,
		hasPlan: () => hasPlan( editor.scene ),
		linkInfo: ( object ) => getTechnicalLink( object ),
		assemblyId: ( object ) => ( isAssembly( object ) ? getAssembly( object ).id : null )
	};

}

export { SimpleModeLogisticsPanel };
