// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Interface do Catálogo Técnico (sobreposição no padrão de "Meus projetos"):
//   Catálogo        — pesquisa (código, nome, categoria, fabricante, modelo, material, palavras-chave), nova peça,
//                     consultar/editar/duplicar/associar/usos/exportar/excluir, backup do catálogo;
//   Ficha técnica   — cadastro e edição em seções A–G (identificação, dimensões, material, dados físicos, conexões,
//                     referências, controle); toda alteração gera nova revisão; campos vazios = "Não informado";
//   Peças do projeto— lista consolidada (projeto ou conjunto), pesos conhecidos, localizar instâncias, CSV/XLSX/PDF;
//   Conferência     — consistência cadastral e dimensional (não é laudo de segurança);
//   Compatibilidade — regras declaradas entre famílias técnicas e teste de pares;
//   Resumo          — indicadores clicáveis.
// Navegar pela ficha não cria passos no histórico; associações passam por SetTechnicalPartCommand.

import { createSimpleButton } from './SimpleMode.Icons.js';
import { parseNumber } from './SimpleMode.Units.js';
import { isAssembly, assemblyAncestors } from './SimpleMode.AssemblyData.js';
import {
	TECHNICAL_CATEGORIES, TECHNICAL_MATERIALS, VALIDATION_STATES, DISCLAIMER, DIMENSION_KEYS, DIMENSION_LABELS, DISPLAY_UNITS, RULE_RESULTS,
	emptyPart, categoryName, validationName, formatWeight, formatNominal, pendingFields, getSnapshot, FIELD_LABELS
} from './SimpleMode.TechnicalCatalogData.js';
import { associate, updateRevision, findUses, logicalRoot, draftFromObject } from './SimpleMode.TechnicalPartLinks.js';
import { buildBOM, weightText } from './SimpleMode.TechnicalBOM.js';
import { validateAssembly } from './SimpleMode.TechnicalValidation.js';
import { technicalSummary, filterRows } from './SimpleMode.TechnicalSummary.js';
import { evaluateFamilies, RESULT_LABELS, CAVEAT, effectiveRules } from './SimpleMode.TechnicalCompatibility.js';
import { toTechnicalCSV, toTechnicalXLSX, toTechnicalPDF } from './SimpleMode.TechnicalExport.js';
import { buildBackup, readBackup, applyImport } from './SimpleMode.TechnicalBackup.js';
import { SetTechnicalCatalogSnapshotCommand } from './commands/SetTechnicalCatalogSnapshotCommand.js';

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function button( label, onClick, { icon, className = '', title } = {} ) {

	return createSimpleButton( { icon, label, title: title || label, className, onClick } ).dom;

}

function field( labelText, control, hint = '' ) {

	const wrap = el( 'label', 'SimpleCatalogField' );
	wrap.appendChild( el( 'span', 'SimpleCatalogFieldLabel', labelText ) );
	wrap.appendChild( control );
	if ( hint ) wrap.appendChild( el( 'small', 'SimpleCatalogFieldHint', hint ) );
	return wrap;

}

function input( name, value = '', { type = 'text', placeholder = '', maxLength = 160 } = {} ) {

	const node = el( 'input', 'SimpleInput SimpleCatalogInput' );
	node.type = type;
	node.dataset.field = name;
	node.value = value === null || value === undefined ? '' : value;
	node.placeholder = placeholder;
	if ( type === 'text' ) node.maxLength = maxLength;
	return node;

}

function select( name, options, value ) {

	const node = el( 'select', 'SimpleSelect SimpleCatalogSelect' );
	node.dataset.field = name;
	for ( const [ id, label ] of options ) {

		const option = el( 'option', '', label );
		option.value = id;
		node.appendChild( option );

	}

	node.value = value;
	return node;

}

const fmtNumber = ( value, decimals = 3 ) => ( value === null || value === undefined ? '' : value.toLocaleString( 'pt-BR', { maximumFractionDigits: decimals, useGrouping: false } ) );

function SimpleModeTechnicalCatalog( editor, context, root, { catalog } ) {

	const dialog = context.dialog;
	const state = { open: false, tab: 'catalog', query: '', category: '', sheet: null, pick: null, scope: null, filter: 'all', requireManufacturer: false, locateIndex: new Map(), lastCheck: null };

	const overlay = el( 'div', 'SimpleProjectsOverlay SimpleCatalogOverlay' );
	overlay.id = 'simple-catalog';
	overlay.hidden = true;
	root.appendChild( overlay );

	const panel = el( 'div', 'SimpleProjects SimpleCatalog' );
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-modal', 'true' );
	panel.setAttribute( 'aria-labelledby', 'simple-catalog-title' );
	overlay.appendChild( panel );

	const header = el( 'div', 'SimpleProjectsHeader' );
	panel.appendChild( header );
	const title = el( 'h2', 'SimpleProjectsTitle', 'Catálogo Técnico' );
	title.id = 'simple-catalog-title';
	header.appendChild( title );

	const TABS = [[ 'catalog', 'Catálogo' ], [ 'sheet', 'Ficha técnica' ], [ 'project', 'Peças do projeto' ], [ 'check', 'Conferência' ], [ 'compat', 'Compatibilidade' ], [ 'summary', 'Resumo' ]];
	const tabs = el( 'div', 'SimpleBudgetTabs SimpleCatalogTabs' );
	tabs.setAttribute( 'role', 'tablist' );
	header.appendChild( tabs );
	const tabButtons = {};
	for ( const [ id, label ] of TABS ) {

		const tab = el( 'button', 'SimpleBudgetTab SimpleCatalogTab', label );
		tab.type = 'button';
		tab.dataset.tab = id;
		tab.setAttribute( 'role', 'tab' );
		tab.addEventListener( 'click', () => show( id ) );
		tabs.appendChild( tab );
		tabButtons[ id ] = tab;

	}

	const closeButton = button( 'Fechar', () => close(), { icon: 'close', className: 'SimpleCatalogClose' } );
	header.appendChild( closeButton );

	const body = el( 'div', 'SimpleCatalogBody' );
	panel.appendChild( body );

	const importInput = el( 'input' );
	importInput.type = 'file';
	importInput.accept = '.json,application/json';
	importInput.hidden = true;
	importInput.dataset.role = 'catalog-import';
	importInput.addEventListener( 'change', () => {

		const file = importInput.files[ 0 ];
		importInput.value = '';
		if ( file ) importCatalog( file );

	} );
	panel.appendChild( importInput );

	overlay.addEventListener( 'keydown', ( event ) => {

		event.stopPropagation();
		if ( event.key === 'Escape' && dialog.isOpen() === false ) {

			event.preventDefault();
			if ( state.tab === 'sheet' && state.sheet !== null && state.sheet.mode !== 'view' ) show( 'catalog' );
			else close();

		}

	} );

	catalog.changed.add( () => {

		if ( state.open && state.tab !== 'sheet' ) render();

	} );

	// abertura -------------------------------------------------------------------------------------------------------

	async function open( tab = 'catalog', options = {} ) {

		state.open = true;
		overlay.hidden = false;
		if ( options.pick !== undefined ) state.pick = options.pick;
		if ( options.scope !== undefined ) state.scope = options.scope;
		if ( options.filter !== undefined ) state.filter = options.filter;
		state.tab = tab;
		render();
		await catalog.load();
		if ( state.open ) render();
		const focus = body.querySelector( 'input, select, button' );
		if ( focus !== null && tab !== 'sheet' ) focus.focus();

	}

	function close() {

		state.open = false;
		state.pick = null;
		overlay.hidden = true;

	}

	function show( tab ) {

		if ( tab === 'sheet' && state.sheet === null ) return context.notify( 'Abra uma ficha no catálogo (Consultar, Editar ou Nova peça).', 'info' );
		state.tab = tab;
		render();

	}

	function render() {

		for ( const [ id, tab ] of Object.entries( tabButtons ) ) {

			tab.classList.toggle( 'active', id === state.tab );
			tab.setAttribute( 'aria-selected', id === state.tab ? 'true' : 'false' );

		}

		tabButtons.sheet.hidden = state.sheet === null;
		body.textContent = '';
		body.dataset.tab = state.tab;
		if ( catalog.state.loaded && catalog.state.available === false && state.tab === 'catalog' ) body.appendChild( el( 'p', 'SimpleCatalogWarning', 'O catálogo técnico local não está disponível neste navegador: ' + ( catalog.state.error ? catalog.state.error.message : '' ) + ' As fichas preservadas nos projetos continuam visíveis.' ) );
		switch ( state.tab ) {

			case 'catalog': renderCatalog(); break;
			case 'sheet': renderSheet(); break;
			case 'project': renderProject(); break;
			case 'check': renderCheck(); break;
			case 'compat': renderCompat(); break;
			case 'summary': renderSummary(); break;

		}

	}

	// catálogo ---------------------------------------------------------------------------------------------------------

	function renderCatalog() {

		if ( state.pick !== null ) {

			const banner = el( 'div', 'SimpleCatalogPick' );
			banner.append( el( 'span', '', `Escolha a ficha técnica para associar a ${state.pick.length === 1 ? `"${state.pick[ 0 ].name || 'componente'}"` : `${state.pick.length} componentes`}. Confira as divergências dimensionais antes de confirmar.` ), button( 'Cancelar associação', () => {

				state.pick = null;
				render();

			}, { className: 'SimpleCatalogPickCancel' } ) );
			body.appendChild( banner );

		}

		const toolbar = el( 'div', 'SimpleCatalogToolbar' );
		const search = input( 'search', state.query, { placeholder: 'Pesquisar código, nome, fabricante, modelo, material…' } );
		search.classList.add( 'SimpleCatalogSearch' );
		search.setAttribute( 'aria-label', 'Pesquisar no catálogo técnico' );
		search.addEventListener( 'input', () => {

			state.query = search.value;
			renderList();

		} );
		const category = select( 'category', [[ '', 'Todas as categorias' ], ...TECHNICAL_CATEGORIES.map( ( c ) => [ c.id, c.name ] ) ], state.category );
		category.classList.add( 'SimpleCatalogCategory' );
		category.setAttribute( 'aria-label', 'Filtrar por categoria' );
		category.addEventListener( 'change', () => {

			state.category = category.value;
			renderList();

		} );
		toolbar.append(
			button( 'Nova peça', () => openSheet( null, 'new' ), { icon: 'add', className: 'SimpleCatalogNew' } ),
			search, category,
			button( 'Exportar catálogo', () => exportCatalog(), { icon: 'save', className: 'SimpleCatalogExport' } ),
			button( 'Importar catálogo', () => importInput.click(), { icon: 'open', className: 'SimpleCatalogImport' } )
		);
		body.appendChild( toolbar );

		const list = el( 'div', 'SimpleCatalogList' );
		list.setAttribute( 'role', 'list' );
		body.appendChild( list );

		function renderList() {

			list.textContent = '';
			if ( catalog.state.loaded === false ) {

				list.appendChild( el( 'p', 'SimpleCatalogEmpty', 'Carregando o catálogo…' ) );
				return;

			}

			const parts = catalog.list( { query: state.query, category: state.category } );
			if ( parts.length === 0 ) {

				list.appendChild( el( 'p', 'SimpleCatalogEmpty', catalog.list().length === 0 ? 'Nenhuma ficha cadastrada. Use "Nova peça" ou, com um componente selecionado, "Criar ficha a partir do componente" nas propriedades.' : 'Nenhuma ficha corresponde à pesquisa.' ) );
				return;

			}

			for ( const part of parts ) list.appendChild( catalogRow( part ) );

		}

		renderList();

	}

	function catalogRow( part ) {

		const row = el( 'div', 'SimpleCatalogRow' );
		row.dataset.catalogId = part.catalogId;
		row.setAttribute( 'role', 'listitem' );
		const uses = findUses( editor.scene, part.catalogId ).length;
		const main = el( 'div', 'SimpleCatalogRowMain' );
		main.append(
			el( 'strong', 'SimpleCatalogCode', part.code ),
			el( 'span', 'SimpleCatalogName', part.name ),
			el( 'small', 'SimpleCatalogMeta', [ categoryName( part.category ), `rev. ${part.revision}`, validationName( part.control.validation ), part.manufacturer.name || 'Fabricante não informado', part.physical.weight === null ? 'Peso não informado' : formatWeight( part.physical.weight ), uses > 0 ? `${uses} uso(s) no projeto` : '' ].filter( Boolean ).join( ' · ' ) )
		);
		row.appendChild( main );
		const actions = el( 'div', 'SimpleCatalogActions' );
		const action = ( id, label, fn, extra = '' ) => {

			const b = button( label, fn, { className: 'SimpleCatalogAction ' + extra } );
			b.dataset.action = id;
			actions.appendChild( b );

		};

		if ( state.pick !== null ) action( 'pick', 'Associar esta ficha', () => confirmAssociation( part ), 'primary' );
		action( 'view', 'Consultar', () => openSheet( part.catalogId, 'view' ) );
		action( 'edit', 'Editar', () => openSheet( part.catalogId, 'edit' ) );
		action( 'duplicate', 'Duplicar', () => duplicatePart( part ) );
		if ( state.pick === null ) action( 'associate', 'Associar ao 3D', () => associateSelected( part ) );
		action( 'uses', 'Usos', () => showUses( part ) );
		action( 'export', 'Exportar', () => exportPart( part ) );
		action( 'delete', 'Excluir', () => deletePart( part ), 'danger' );
		row.appendChild( actions );
		return row;

	}

	function selectedTargets() {

		const selected = editor.selected;
		if ( selected === null ) return [];
		const target = logicalRoot( selected, editor.scene );
		return target !== null ? [ target ] : [];

	}

	function associateSelected( part ) {

		const targets = selectedTargets();
		if ( targets.length === 0 ) return context.notify( 'Selecione no 3D o componente que receberá a ficha técnica.', 'warning' );
		state.pick = targets;
		confirmAssociation( part );

	}

	// confirmação com a conferência dimensional de cada componente
	async function confirmAssociation( part ) {

		const targets = state.pick || [];
		if ( targets.length === 0 ) return;
		const { checkDimensions, dimensionMessage } = await import( './SimpleMode.TechnicalPartLinks.js' );
		const details = targets.map( ( object ) => `${object.name || 'componente'}: ${dimensionMessage( checkDimensions( part, object ), part.dimensions.unit )}` );
		const replacing = targets.filter( ( o ) => o.userData.project3ds && o.userData.project3ds.technicalPart );
		if ( replacing.length > 0 ) details.push( `${replacing.length} componente(s) já tinha(m) ficha: a associação será trocada.` );
		const choice = await dialog.ask( { title: `Associar ${part.code} — ${part.name} (rev. ${part.revision})`, message: 'A ficha será gravada na raiz lógica do componente. Nenhuma geometria, material ou preço é alterado.', details, choices: [ { id: 'ok', label: 'Confirmar associação', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'ok' ) return;
		associate( editor, targets, part );
		state.pick = null;
		context.notify( `Ficha ${part.code} (rev. ${part.revision}) associada a ${targets.length} componente(s).`, 'success' );
		close();

	}

	async function duplicatePart( part ) {

		const answer = await dialog.ask( { title: `Duplicar ${part.code}`, message: 'A cópia recebe um novo identificador interno e precisa de um código técnico próprio.', input: { label: 'Código técnico da cópia', value: `${part.code}-B`, maxLength: 40 }, choices: [ { id: 'ok', label: 'Duplicar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( answer.choice !== 'ok' ) return;
		try {

			const copy = await catalog.duplicate( part.catalogId, answer.value );
			context.notify( `Ficha duplicada como ${copy.code}.`, 'success' );
			openSheet( copy.catalogId, 'edit' );

		} catch ( error ) {

			context.notify( error.message, 'warning' );

		}

	}

	async function showUses( part ) {

		const uses = findUses( editor.scene, part.catalogId );
		if ( uses.length === 0 ) return dialog.ask( { title: `Usos de ${part.code}`, message: 'Nenhum componente deste projeto usa esta ficha.', choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );
		const details = uses.map( ( o ) => `${o.name || 'componente'} — revisão ${o.userData.project3ds.technicalPart.catalogRevision}` );
		const choice = await dialog.ask( { title: `Usos de ${part.code} neste projeto`, message: `${uses.length} componente(s).`, details, choices: [ { id: 'locate', label: 'Localizar no 3D', kind: 'primary' }, { id: 'ok', label: 'Fechar' } ] } );
		if ( choice === 'locate' ) locate( uses, 'uses:' + part.catalogId );

	}

	async function exportPart( part ) {

		const { blob, name } = await buildBackup( catalog, [ part.catalogId ] );
		editor.utils.save( blob, name );

	}

	async function exportCatalog() {

		try {

			const { blob, name, counts } = await buildBackup( catalog );
			editor.utils.save( blob, name );
			context.notify( `Catálogo exportado: ${counts.parts} ficha(s), ${counts.revisions} revisão(ões), ${counts.rules} regra(s).`, 'success' );

		} catch ( error ) {

			context.notify( error.message, 'warning' );

		}

	}

	async function importCatalog( file ) {

		let analysis;
		try {

			analysis = await readBackup( file, catalog );

		} catch ( error ) {

			await dialog.ask( { title: 'Catálogo não importado', message: error.message, details: error.details || [], choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );
			return;

		}

		let choice = 'keep';
		if ( analysis.conflicts.length > 0 ) {

			const choices = [ { id: 'keep', label: 'Manter existente' }, { id: 'copy', label: 'Importar como cópia com novo código' } ];
			if ( analysis.canMerge ) choices.push( { id: 'merge', label: 'Mesclar revisões compatíveis', kind: 'primary' } );
			choices.push( { id: 'cancel', label: 'Cancelar' } );
			choice = await dialog.ask( {
				title: 'Conflitos no catálogo importado',
				message: `${analysis.counts.parts} ficha(s) no arquivo: ${analysis.counts.new} nova(s), ${analysis.counts.same} idêntica(s), ${analysis.conflicts.length} em conflito.`,
				details: analysis.conflicts.map( ( c ) => `${c.head.code}: ${c.kind === 'code' ? `código já usado pela ficha local "${c.codeOwner.name}"` : c.kind === 'divergent' ? 'revisão de mesmo número com conteúdo diferente (não pode ser mesclada)' : `${c.missing.length} revisão(ões) nova(s) da mesma ficha` }` ),
				choices
			} );
			if ( choice === 'cancel' ) return;

		}

		try {

			const result = await applyImport( analysis, catalog, choice );
			await dialog.ask( { title: 'Catálogo importado', message: `${result.added} ficha(s) nova(s), ${result.merged} mesclada(s), ${result.copied} importada(s) como cópia, ${result.kept} mantida(s) sem alteração, ${result.rules} regra(s) de compatibilidade.`, choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );

		} catch ( error ) {

			context.notify( error.message, 'warning' );

		}

	}

	async function deletePart( part ) {

		const uses = findUses( editor.scene, part.catalogId ).length;
		const choice = await dialog.ask( { title: `Excluir ${part.code}?`, message: 'A ficha sai do catálogo local deste navegador. As revisões históricas são preservadas, e os projetos salvos mantêm os dados técnicos que já usam (snapshot do projeto).', details: uses > 0 ? [ `Este projeto usa a ficha em ${uses} componente(s): as associações e os dados do projeto permanecem.` ] : [], choices: [ { id: 'delete', label: 'Excluir do catálogo', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice !== 'delete' ) return;
		try {

			await catalog.remove( part.catalogId );
			context.notify( `Ficha ${part.code} excluída do catálogo local.`, 'success' );

		} catch ( error ) {

			context.notify( error.message, 'warning' );

		}

	}

	// ficha técnica --------------------------------------------------------------------------------------------------

	// mode: 'view' | 'edit' | 'new'; draft: valores iniciais (ex.: criar a partir do componente)
	function openSheet( catalogId, mode, { draft = null, record = null, source = null } = {} ) {

		const current = record || ( catalogId !== null ? catalog.getPart( catalogId ) : null );
		if ( mode !== 'new' && current === null ) return context.notify( 'A ficha não está no catálogo local.', 'warning' );
		const base = mode === 'new' ? Object.assign( emptyPart(), draft || {} ) : JSON.parse( JSON.stringify( current ) );
		if ( draft && draft.dimensions ) base.dimensions = Object.assign( emptyPart().dimensions, draft.dimensions );
		state.sheet = { mode, catalogId, data: base, source, readOnly: record !== null && catalogId !== null && catalog.getPart( catalogId ) === null };
		state.tab = 'sheet';
		if ( state.open === false ) open( 'sheet' );
		else render();

	}

	function renderSheet() {

		const sheet = state.sheet;
		if ( sheet.mode === 'view' ) return renderSheetView( sheet );
		renderSheetForm( sheet );

	}

	function renderSheetView( sheet ) {

		const p = sheet.data;
		const head = el( 'div', 'SimpleCatalogSheetHead' );
		head.append( el( 'h3', '', `${p.code} — ${p.name}` ), el( 'span', 'SimpleCatalogBadge', `Revisão ${p.revision} · ${validationName( p.control.validation )}` ) );
		body.appendChild( head );
		body.appendChild( el( 'p', 'SimpleCatalogDisclaimer', DISCLAIMER ) );

		const facts = ( titleText, pairs ) => {

			const section = el( 'section', 'SimpleCatalogSection' );
			section.appendChild( el( 'h4', '', titleText ) );
			const dl = el( 'dl', 'SimpleModelFacts SimpleCatalogFacts' );
			for ( const [ k, v ] of pairs ) dl.append( el( 'dt', '', k ), el( 'dd', v === '' || v === null ? 'missing' : '', v === '' || v === null ? 'Não informado' : v ) );
			section.appendChild( dl );
			body.appendChild( section );

		};

		const m = p.manufacturer, d = p.dimensions, mat = p.material, ph = p.physical, ref = p.references;
		facts( 'A — Identificação', [[ 'Código técnico', p.code ], [ 'Nome', p.name ], [ 'Categoria', categoryName( p.category ) ], [ 'Descrição', p.description ], [ 'Fabricante', m.name ], [ 'Marca', m.brand ], [ 'Modelo', m.model ], [ 'Código do fabricante', m.manufacturerCode ], [ 'Referência comercial', m.commercialRef ], [ 'URL informativa', m.url ], [ 'Palavras-chave', p.keywords.join( ', ' ) ]] );
		facts( 'B — Dimensões nominais', DIMENSION_KEYS.map( ( k ) => [ DIMENSION_LABELS[ k ], d[ k ] === null ? '' : formatNominal( d[ k ], d.unit ) ] ).concat( [[ 'Tolerância absoluta', d.tolerance.absolute === null ? '' : '± ' + formatNominal( d.tolerance.absolute, d.unit ) ], [ 'Tolerância relativa', d.tolerance.relative === null ? '' : `± ${fmtNumber( d.tolerance.relative )}%` ]] ) );
		facts( 'C — Material construtivo', [[ 'Material principal', mat.primary ], [ 'Material secundário', mat.secondary ], [ 'Acabamento', mat.finish ], [ 'Cor de referência', mat.color ], [ 'Observações', mat.notes ]] );
		facts( 'D — Dados físicos', [[ 'Peso unitário (líquido)', ph.weight === null ? '' : formatWeight( ph.weight ) ], [ 'Peso embalado', ph.packagedWeight === null ? '' : formatWeight( ph.packagedWeight ) ], [ 'Embalagem', ph.packageDims === null ? '' : ph.packageDims.map( ( v ) => formatNominal( v, d.unit ) ).join( ' × ' ) ], [ 'Fonte do peso', ph.weightSource ], [ 'Data da referência', ph.weightDate ? ph.weightDate.split( '-' ).reverse().join( '/' ) : '' ]] );
		facts( 'E — Conexões', p.connectors.length === 0 ? [[ 'Conectores', '' ]] : p.connectors.map( ( c ) => [ c.name, [ c.family ? `família ${c.family}` : 'sem família técnica', c.standard, c.code, c.nominalSize !== null ? `interface ${formatNominal( c.nominalSize, d.unit )}` : '', c.variant ? `variante ${c.variant}` : '', c.geometric ? `ponto de encaixe "${c.geometric}"` : '', c.restrictions ].filter( Boolean ).join( ' · ' ) ] ) );
		facts( 'F — Referências', [[ 'Fonte das informações', ref.source ], [ 'Identificador do documento', ref.documentId ], [ 'Revisão do documento', ref.documentRevision ], [ 'Data de referência', ref.date ? ref.date.split( '-' ).reverse().join( '/' ) : '' ], [ 'URL informativa', ref.url ], [ 'Observações', ref.notes ]] );
		facts( 'G — Controle', [[ 'Criada em', p.control.createdAt ? new Date( p.control.createdAt ).toLocaleString( 'pt-BR' ) : '' ], [ 'Última alteração', p.control.updatedAt ? new Date( p.control.updatedAt ).toLocaleString( 'pt-BR' ) : '' ], [ 'Revisão da ficha', String( p.revision ) ], [ 'Preenchimento', pendingFields( p ).length === 0 ? 'Completo' : 'Faltam: ' + pendingFields( p ).join( ', ' ) ], [ 'Estado de validação declarado', validationName( p.control.validation ) ]] );

		const history = el( 'section', 'SimpleCatalogSection SimpleCatalogHistory' );
		history.appendChild( el( 'h4', '', 'Revisões' ) );
		const revisions = catalog.revisionsOf( p.catalogId );
		const ul = el( 'ul', 'SimpleCatalogRevisions' );
		for ( const r of revisions.length > 0 ? revisions : [ p ] ) {

			const li = el( 'li', '', `Revisão ${r.revision} — ${r.control.updatedAt ? new Date( r.control.updatedAt ).toLocaleDateString( 'pt-BR' ) : ''} — ${r.control.revisionNote || ''}` );
			if ( r.revision !== p.revision ) li.appendChild( button( 'Consultar', () => openSheet( r.catalogId, 'view', { record: r } ), { className: 'SimpleCatalogRevisionView' } ) );
			ul.appendChild( li );

		}

		history.appendChild( ul );
		body.appendChild( history );

		const actions = el( 'div', 'SimpleCatalogSheetActions' );
		const isHead = catalog.getPart( p.catalogId ) !== null && catalog.getPart( p.catalogId ).revision === p.revision;
		if ( isHead ) actions.append( button( 'Editar ficha', () => openSheet( p.catalogId, 'edit' ), { icon: 'edit', className: 'SimpleCatalogEdit' } ), button( 'Associar ao 3D', () => associateSelected( p ), { className: 'SimpleCatalogAssociate' } ) );
		else actions.appendChild( el( 'span', 'SimpleCatalogHint', isHead === false && catalog.getPart( p.catalogId ) !== null ? `Revisão histórica (a vigente é a ${catalog.getPart( p.catalogId ).revision}).` : 'Ficha preservada no projeto (não está no catálogo local).' ) );
		actions.appendChild( button( 'Voltar ao catálogo', () => show( 'catalog' ), { className: 'SimpleCatalogBack' } ) );
		body.appendChild( actions );

	}

	function renderSheetForm( sheet ) {

		const p = sheet.data;
		const unit = p.dimensions.unit;
		const form = el( 'form', 'SimpleCatalogForm' );
		form.noValidate = true;
		form.addEventListener( 'submit', ( event ) => {

			event.preventDefault();
			saveSheet( form );

		} );
		body.appendChild( form );
		form.appendChild( el( 'h3', '', sheet.mode === 'new' ? 'Nova peça' : `Editar ${p.code} (revisão ${p.revision} → nova revisão ${p.revision + 1})` ) );
		form.appendChild( el( 'p', 'SimpleCatalogDisclaimer', 'Informe apenas dados conhecidos: campos vazios ficam como "Não informado". ' + DISCLAIMER ) );

		const section = ( text ) => {

			const s = el( 'fieldset', 'SimpleCatalogSection' );
			s.appendChild( el( 'legend', '', text ) );
			const grid = el( 'div', 'SimpleCatalogGrid' );
			s.appendChild( grid );
			form.appendChild( s );
			return grid;

		};

		const toDisplay = ( meters ) => ( meters === null ? '' : fmtNumber( meters * DISPLAY_UNITS[ unit ], 4 ) );

		let g = section( 'A — Identificação' );
		g.append(
			field( 'Código técnico *', input( 'code', p.code, { maxLength: 40, placeholder: 'ex.: PAIN-1000-01' } ), 'Único no catálogo. Não use o nome como código.' ),
			field( 'Nome *', input( 'name', p.name, { maxLength: 120 } ) ),
			field( 'Categoria *', select( 'category', TECHNICAL_CATEGORIES.map( ( c ) => [ c.id, c.name ] ), p.category ) ),
			field( 'Fabricante', input( 'manufacturer.name', p.manufacturer.name ) ),
			field( 'Marca', input( 'manufacturer.brand', p.manufacturer.brand ) ),
			field( 'Modelo', input( 'manufacturer.model', p.manufacturer.model ) ),
			field( 'Código do fabricante', input( 'manufacturer.manufacturerCode', p.manufacturer.manufacturerCode ) ),
			field( 'Referência comercial', input( 'manufacturer.commercialRef', p.manufacturer.commercialRef ) ),
			field( 'URL informativa', input( 'manufacturer.url', p.manufacturer.url, { placeholder: 'https://…' } ), 'Apenas referência: nunca é carregada pelo aplicativo.' ),
			field( 'Palavras-chave', input( 'keywords', p.keywords.join( ', ' ) ), 'Separadas por vírgula.' )
		);
		const description = el( 'textarea', 'SimpleInput SimpleCatalogTextarea' );
		description.dataset.field = 'description';
		description.value = p.description;
		description.maxLength = 1000;
		g.appendChild( field( 'Descrição', description ) );

		g = section( 'B — Dimensões nominais (declaradas na ficha)' );
		const unitSelect = select( 'dimensions.unit', [[ 'mm', 'Milímetros (mm)' ], [ 'cm', 'Centímetros (cm)' ], [ 'm', 'Metros (m)' ]], unit );
		unitSelect.addEventListener( 'change', () => {

			collect( form, false ); // preserva o que foi digitado antes de trocar a unidade
			state.sheet.data.dimensions.unit = unitSelect.value;
			render();

		} );
		g.appendChild( field( 'Unidade de medida', unitSelect ) );
		for ( const key of DIMENSION_KEYS ) g.appendChild( field( `${DIMENSION_LABELS[ key ]} (${unit})`, input( 'dimensions.' + key, toDisplay( p.dimensions[ key ] ), { placeholder: 'Não informado' } ) ) );
		g.appendChild( field( `Tolerância absoluta (± ${unit})`, input( 'dimensions.tolerance.absolute', toDisplay( p.dimensions.tolerance.absolute ), { placeholder: 'Não informada' } ), 'Opcional. Não há tolerância universal.' ) );
		g.appendChild( field( 'Tolerância relativa (± %)', input( 'dimensions.tolerance.relative', fmtNumber( p.dimensions.tolerance.relative ), { placeholder: 'Não informada' } ) ) );

		g = section( 'C — Material construtivo (independente do acabamento visual)' );
		const materials = el( 'datalist' );
		materials.id = 'simple-catalog-materials';
		for ( const m of TECHNICAL_MATERIALS ) materials.appendChild( Object.assign( el( 'option' ), { value: m } ) );
		g.appendChild( materials );
		const primary = input( 'material.primary', p.material.primary );
		primary.setAttribute( 'list', materials.id );
		g.append( field( 'Material principal', primary, 'Classificação apenas: nenhuma propriedade mecânica é associada.' ), field( 'Material secundário', input( 'material.secondary', p.material.secondary ) ), field( 'Acabamento', input( 'material.finish', p.material.finish ) ), field( 'Cor de referência', input( 'material.color', p.material.color ) ), field( 'Observações', input( 'material.notes', p.material.notes, { maxLength: 600 } ) ) );

		g = section( 'D — Dados físicos (informados — nunca inferidos)' );
		g.append(
			field( 'Peso unitário líquido (kg)', input( 'physical.weight', fmtNumber( p.physical.weight ), { placeholder: 'Não informado' } ), 'Não é estimado pela textura nem pela caixa envolvente.' ),
			field( 'Peso embalado (kg)', input( 'physical.packagedWeight', fmtNumber( p.physical.packagedWeight ), { placeholder: 'Não informado' } ), 'Peso de transporte — calculado à parte.' ),
			field( `Embalagem: largura (${unit})`, input( 'physical.packageDims.0', p.physical.packageDims ? toDisplay( p.physical.packageDims[ 0 ] ) : '' ) ),
			field( `Embalagem: altura (${unit})`, input( 'physical.packageDims.1', p.physical.packageDims ? toDisplay( p.physical.packageDims[ 1 ] ) : '' ) ),
			field( `Embalagem: profundidade (${unit})`, input( 'physical.packageDims.2', p.physical.packageDims ? toDisplay( p.physical.packageDims[ 2 ] ) : '' ) ),
			field( 'Fonte do peso', input( 'physical.weightSource', p.physical.weightSource ) ),
			field( 'Data da referência do peso', input( 'physical.weightDate', p.physical.weightDate || '', { type: 'date' } ) )
		);

		const connSection = el( 'fieldset', 'SimpleCatalogSection SimpleCatalogConnectors' );
		connSection.appendChild( el( 'legend', '', 'E — Conexões (especificação técnica declarada)' ) );
		connSection.appendChild( el( 'p', 'SimpleCatalogHint', 'A família técnica (ex.: perfil-modular-40) é usada nas regras de compatibilidade. "Ponto de encaixe" liga a interface a um conector geométrico (id ou nome, ex.: right); vazio com uma única interface vale para todos os pontos. A família "generic" não comprova compatibilidade técnica.' ) );
		const connList = el( 'div', 'SimpleCatalogConnectorList' );
		connSection.appendChild( connList );
		const addConnectorRow = ( c = {} ) => {

			const row = el( 'div', 'SimpleCatalogConnectorRow' );
			row.append(
				field( 'Nome', input( 'name', c.name || '', { maxLength: 60 } ) ),
				field( 'Família técnica', input( 'family', c.family || '', { maxLength: 60 } ) ),
				field( 'Padrão de conexão', input( 'standard', c.standard || '', { maxLength: 80 } ) ),
				field( 'Código de conexão', input( 'code', c.code || '', { maxLength: 40 } ) ),
				field( `Interface nominal (${unit})`, input( 'nominalSize', c.nominalSize ? toDisplay( c.nominalSize ) : '' ) ),
				field( 'Variante/revisão', input( 'variant', c.variant || '', { maxLength: 40 } ) ),
				field( 'Ponto de encaixe', input( 'geometric', c.geometric || '', { maxLength: 60 } ) ),
				field( 'Restrições', input( 'restrictions', c.restrictions || '', { maxLength: 300 } ) ),
				button( 'Remover', () => row.remove(), { className: 'SimpleCatalogConnectorRemove danger' } )
			);
			if ( c.id ) row.dataset.id = c.id;
			connList.appendChild( row );

		};

		p.connectors.forEach( addConnectorRow );
		connSection.appendChild( button( 'Adicionar conector', () => addConnectorRow(), { icon: 'add', className: 'SimpleCatalogConnectorAdd' } ) );
		form.appendChild( connSection );

		g = section( 'F — Referências' );
		g.append( field( 'Fonte das informações', input( 'references.source', p.references.source, { maxLength: 200 } ) ), field( 'Identificador do documento', input( 'references.documentId', p.references.documentId, { maxLength: 100 } ) ), field( 'Revisão do documento', input( 'references.documentRevision', p.references.documentRevision, { maxLength: 40 } ) ), field( 'Data de referência', input( 'references.date', p.references.date || '', { type: 'date' } ) ), field( 'URL informativa', input( 'references.url', p.references.url, { placeholder: 'https://…' } ) ), field( 'Observações', input( 'references.notes', p.references.notes, { maxLength: 600 } ) ) );

		g = section( 'G — Controle' );
		g.appendChild( field( 'Estado de validação declarado', select( 'control.validation', VALIDATION_STATES.map( ( s ) => [ s.id, s.name ] ), p.control.validation ), VALIDATION_STATES.map( ( s ) => `${s.name}: ${s.hint}` ).join( ' ' ) ) );
		if ( sheet.mode === 'edit' ) g.appendChild( field( 'Motivo da nova revisão', input( 'control.revisionNote', '', { maxLength: 200, placeholder: 'ex.: peso atualizado' } ) ) );

		const errors = el( 'div', 'SimpleCatalogErrors' );
		errors.setAttribute( 'role', 'alert' );
		form.appendChild( errors );

		const actions = el( 'div', 'SimpleCatalogSheetActions' );
		const save = el( 'button', 'SimpleButton SimpleCatalogSave primary', sheet.mode === 'new' ? 'Cadastrar peça' : 'Salvar nova revisão' );
		save.type = 'submit';
		actions.append( save, button( 'Cancelar', () => {

			state.sheet = sheet.mode === 'new' ? null : { mode: 'view', catalogId: sheet.catalogId, data: catalog.getPart( sheet.catalogId ) };
			show( sheet.mode === 'new' ? 'catalog' : 'sheet' );

		}, { className: 'SimpleCatalogCancel' } ) );
		form.appendChild( actions );
		const first = form.querySelector( '[data-field="code"]' );
		if ( first ) first.focus();

	}

	// lê o formulário; números em pt-BR (vírgula); valor inválido = erro (nunca zero silencioso)
	function collect( form, strict = true ) {

		const data = JSON.parse( JSON.stringify( state.sheet.data ) );
		const unit = data.dimensions.unit;
		const factor = DISPLAY_UNITS[ unit ];
		const problems = [];
		const value = ( name ) => {

			const node = form.querySelector( `[data-field="${name}"]` );
			return node === null ? '' : node.value.trim();

		};

		const num = ( name, label, scale = 1 ) => {

			const raw = value( name );
			if ( raw === '' ) return null;
			const parsed = parseNumber( raw );
			if ( parsed === null || Number.isFinite( parsed ) === false || parsed < 0 ) {

				problems.push( `${label}: "${raw}" não é um número válido.` );
				return null;

			}

			return parsed / scale;

		};

		for ( const key of [ 'code', 'name', 'category', 'description' ] ) data[ key ] = value( key );
		data.keywords = value( 'keywords' ).split( /[,;]/ ).map( ( k ) => k.trim() ).filter( Boolean );
		for ( const key of [ 'name', 'brand', 'model', 'manufacturerCode', 'commercialRef', 'url' ] ) data.manufacturer[ key ] = value( 'manufacturer.' + key );
		for ( const key of DIMENSION_KEYS ) data.dimensions[ key ] = num( 'dimensions.' + key, DIMENSION_LABELS[ key ], factor );
		data.dimensions.tolerance = { absolute: num( 'dimensions.tolerance.absolute', 'Tolerância absoluta', factor ), relative: num( 'dimensions.tolerance.relative', 'Tolerância relativa' ) };
		for ( const key of [ 'primary', 'secondary', 'finish', 'color', 'notes' ] ) data.material[ key ] = value( 'material.' + key );
		data.physical.weight = num( 'physical.weight', 'Peso unitário' );
		data.physical.packagedWeight = num( 'physical.packagedWeight', 'Peso embalado' );
		const pack = [ 0, 1, 2 ].map( ( i ) => num( 'physical.packageDims.' + i, 'Dimensão da embalagem', factor ) );
		data.physical.packageDims = pack.every( ( v ) => v !== null ) ? pack : null;
		if ( pack.some( ( v ) => v !== null ) && data.physical.packageDims === null ) problems.push( 'Embalagem: informe as três dimensões ou nenhuma.' );
		data.physical.weightSource = value( 'physical.weightSource' );
		data.physical.weightDate = value( 'physical.weightDate' ) || null;
		for ( const key of [ 'source', 'documentId', 'documentRevision', 'url', 'notes' ] ) data.references[ key ] = value( 'references.' + key );
		data.references.date = value( 'references.date' ) || null;
		data.control.validation = value( 'control.validation' ) || 'draft';
		data.connectors = [ ...form.querySelectorAll( '.SimpleCatalogConnectorRow' ) ].map( ( row, i ) => {

			const v = ( name ) => row.querySelector( `[data-field="${name}"]` ).value.trim();
			const raw = v( 'nominalSize' );
			let nominal = null;
			if ( raw !== '' ) {

				nominal = parseNumber( raw );
				if ( nominal === null || nominal < 0 ) {

					problems.push( `Conector ${i + 1}: interface nominal inválida.` );
					nominal = null;

				} else nominal /= factor;

			}

			return { id: row.dataset.id, name: v( 'name' ), family: v( 'family' ), standard: v( 'standard' ), code: v( 'code' ), nominalSize: nominal, variant: v( 'variant' ), geometric: v( 'geometric' ), restrictions: v( 'restrictions' ) };

		} );
		for ( const key of [ 'manufacturer.url', 'references.url' ] ) {

			const raw = value( key );
			if ( raw !== '' && /^https?:\/\/[^\s]+$/i.test( raw ) === false ) problems.push( 'URL informativa: use um endereço http:// ou https://.' );

		}

		state.sheet.data = data;
		if ( strict === false ) return { data, problems: [] };
		return { data, problems, revisionNote: value( 'control.revisionNote' ) };

	}

	async function saveSheet( form ) {

		const { data, problems, revisionNote } = collect( form );
		const errors = form.querySelector( '.SimpleCatalogErrors' );
		errors.textContent = '';
		if ( problems.length > 0 ) {

			for ( const problem of problems ) errors.appendChild( el( 'p', '', problem ) );
			return;

		}

		const sheet = state.sheet;
		try {

			if ( sheet.mode === 'new' ) {

				const record = await catalog.create( data );
				context.notify( `Peça ${record.code} cadastrada (revisão 1).`, 'success' );
				state.sheet = { mode: 'view', catalogId: record.catalogId, data: record };
				if ( sheet.source !== null && sheet.source !== undefined ) {

					const choice = await dialog.ask( { title: 'Associar a nova ficha?', message: `Associar ${record.code} ao componente "${sheet.source.name || 'componente'}" que originou a ficha?`, choices: [ { id: 'ok', label: 'Associar', kind: 'primary' }, { id: 'cancel', label: 'Agora não' } ] } );
					if ( choice === 'ok' ) associate( editor, [ sheet.source ], record );

				}

				render();
				return;

			}

			const result = await catalog.update( sheet.catalogId, data, { revisionNote } );
			if ( result.changed.length === 0 ) {

				context.notify( 'Nenhuma alteração: a revisão atual foi mantida.', 'info' );
				state.sheet = { mode: 'view', catalogId: sheet.catalogId, data: result.record };
				render();
				return;

			}

			context.notify( `Revisão ${result.record.revision} de ${result.record.code} gravada (${result.changed.map( ( f ) => FIELD_LABELS[ f ] ).join( ', ' )}). A revisão anterior foi preservada.`, 'success' );
			state.sheet = { mode: 'view', catalogId: sheet.catalogId, data: result.record };
			render();
			await offerUpdate( result.record, result.changed );

		} catch ( error ) {

			errors.appendChild( el( 'p', '', error.message ) );

		}

	}

	// associações do projeto em revisões anteriores: atualização SOMENTE com confirmação (Desfazer disponível)
	async function offerUpdate( record, changed = [] ) {

		const outdated = findUses( editor.scene, record.catalogId ).filter( ( o ) => o.userData.project3ds.technicalPart.catalogRevision < record.revision );
		if ( outdated.length === 0 ) return false;
		const choice = await dialog.ask( {
			title: 'Atualizar associação para revisão mais recente?',
			message: `${outdated.length} componente(s) deste projeto usam revisões anteriores de ${record.code}. A atualização não é automática.`,
			details: [ changed.length > 0 ? `Alterações: ${changed.map( ( f ) => FIELD_LABELS[ f ] ).join( ', ' )}.` : '', 'Os dados da revisão anterior continuam preservados no histórico; você pode desfazer a atualização.' ].filter( Boolean ),
			choices: [ { id: 'update', label: `Atualizar para a revisão ${record.revision}`, kind: 'primary' }, { id: 'keep', label: 'Manter revisão atual' } ]
		} );
		if ( choice !== 'update' ) return false;
		updateRevision( editor, outdated, record );
		context.notify( `${outdated.length} componente(s) atualizado(s) para a revisão ${record.revision}.`, 'success' );
		return true;

	}

	// peças do projeto ---------------------------------------------------------------------------------------------

	function assembliesInScene() {

		const list = [];
		editor.scene.traverse( ( o ) => {

			if ( isAssembly( o ) ) list.push( o );

		} );
		return list;

	}

	function scopeSelect( onChange ) {

		const assemblies = assembliesInScene();
		if ( state.scope !== null && assemblies.includes( state.scope ) === false ) state.scope = null;
		const node = select( 'scope', [[ '', 'Projeto inteiro' ], ...assemblies.map( ( a, i ) => [ String( i ), `Conjunto: ${a.name || 'Conjunto'}${assemblyAncestors( a, editor.scene ).length > 1 ? ' (aninhado)' : ''}` ] ) ], state.scope === null ? '' : String( assemblies.indexOf( state.scope ) ) );
		node.classList.add( 'SimpleCatalogScope' );
		node.setAttribute( 'aria-label', 'Escopo da lista' );
		node.addEventListener( 'change', () => {

			state.scope = node.value === '' ? null : assemblies[ Number( node.value ) ];
			onChange();

		} );
		return node;

	}

	const scopeRoot = () => ( state.scope !== null ? state.scope : editor.scene );

	function renderProject() {

		const bom = buildBOM( editor, scopeRoot(), catalog, { requireManufacturer: state.requireManufacturer } );
		const toolbar = el( 'div', 'SimpleCatalogToolbar' );
		const filter = select( 'filter', [[ 'all', 'Todas as peças' ], [ 'identified', 'Com ficha' ], [ 'missing', 'Sem ficha' ], [ 'noWeight', 'Sem peso' ], [ 'divergent', 'Divergência dimensional' ], [ 'outdated', 'Revisão desatualizada' ]], state.filter );
		filter.classList.add( 'SimpleCatalogFilter' );
		filter.setAttribute( 'aria-label', 'Filtrar lista de peças' );
		filter.addEventListener( 'change', () => {

			state.filter = filter.value;
			render();

		} );
		toolbar.append( scopeSelect( render ), filter,
			button( 'CSV', () => exportList( 'csv' ), { icon: 'save', className: 'SimpleBomCSV', title: 'Exportar lista de peças — CSV' } ),
			button( 'XLSX', () => exportList( 'xlsx' ), { icon: 'save', className: 'SimpleBomXLSX', title: 'Exportar lista técnica — XLSX' } ),
			button( 'PDF', () => exportList( 'pdf' ), { icon: 'save', className: 'SimpleBomPDF', title: 'Relatório técnico cadastral — PDF' } ) );
		body.appendChild( toolbar );

		const s = bom.summary;
		const summary = el( 'p', 'SimpleBomSummary' + ( s.partial ? ' partial' : '' ) );
		summary.textContent = `${bom.scope}: ${s.totalUnits} peça(s) · ${s.identified} com ficha · ${s.unidentified} sem ficha · ${s.distinctCodes} código(s). ${weightText( s )}${s.hasAnyPackaged ? ` Peso embalado conhecido${s.packagedPartial ? ' (parcial)' : ''}: ${formatWeight( s.packagedKnown )}.` : ''}`;
		body.appendChild( summary );

		const rows = filterRows( bom.rows, state.filter );
		if ( rows.length === 0 ) {

			body.appendChild( el( 'p', 'SimpleCatalogEmpty', bom.rows.length === 0 ? 'Nenhuma peça neste escopo.' : 'Nenhuma peça corresponde ao filtro.' ) );
			return;

		}

		const table = el( 'table', 'SimpleBomTable' );
		const thead = el( 'thead' );
		const hr = el( 'tr' );
		for ( const h of [ 'Código', 'Descrição', 'Categoria', 'Fabricante', 'Dimensões nominais', 'Rev.', 'Qtd. (un)', 'Peso unit.', 'Peso total', 'Situação' ] ) hr.appendChild( el( 'th', '', h ) );
		thead.appendChild( hr );
		table.appendChild( thead );
		const tbody = el( 'tbody' );
		for ( const row of rows ) {

			const tr = el( 'tr', 'SimpleBomRow ' + row.statusKind );
			tr.dataset.code = row.code;
			tr.tabIndex = 0;
			tr.title = 'Localizar as instâncias no 3D' + ( row.origins.length > 0 ? ` — ${row.origins.join( '; ' )}` : '' );
			const cells = [ row.code || '—', row.name, row.category, row.manufacturer || ( row.record ? 'Não informado' : '' ), row.nominal, row.revision === null ? '' : String( row.revision ) + ( row.outdated ? ` (há rev. ${row.latest})` : '' ), String( row.quantity ), row.record === null ? '' : row.unitWeight === null ? 'Não informado' : formatWeight( row.unitWeight ), row.totalWeight === null ? '—' : formatWeight( row.totalWeight ), row.status + ( row.notes.length > 0 ? ' — ' + row.notes.join( ' ' ) : '' ) ];
			cells.forEach( ( c, i ) => tr.appendChild( el( 'td', i === 6 || i === 7 || i === 8 ? 'num' : '', c ) ) );
			const go = () => locate( row.objects, row.key );
			tr.addEventListener( 'click', go );
			tr.addEventListener( 'keydown', ( event ) => {

				if ( event.key === 'Enter' ) go();

			} );
			tbody.appendChild( tr );

		}

		table.appendChild( tbody );
		const wrap = el( 'div', 'SimpleBomWrap' );
		wrap.appendChild( table );
		body.appendChild( wrap );

	}

	// localizar: seleciona (entrando no conjunto quando preciso) e enquadra; cliques seguidos percorrem as instâncias
	function locate( objects, key ) {

		if ( objects.length === 0 ) return;
		const index = ( state.locateIndex.get( key ) ?? - 1 ) + 1;
		state.locateIndex.set( key, index % objects.length );
		const object = objects[ index % objects.length ];
		const chain = assemblyAncestors( object, editor.scene );
		const inner = chain.length > 0 ? chain[ chain.length - 1 ] : null;
		if ( inner !== null && inner !== object && context.assemblySelection !== undefined ) context.assemblySelection.enterEditing( inner, object );
		else editor.select( object );
		if ( context.cameras !== undefined ) context.cameras.frameSelection( object );
		context.notify( `Instância ${( index % objects.length ) + 1} de ${objects.length}: ${object.name || 'componente'}.`, 'info' );

	}

	function reportData() {

		const root = scopeRoot();
		const validation = validateAssembly( editor, root, { catalog, modelLibrary: context.modelLibrary || null, requireManufacturer: state.requireManufacturer } );
		return { bom: validation.bom, validation, projectTitle: editor.config.getKey( 'project/title' ) || '', date: new Date() };

	}

	function exportList( kind ) {

		const report = reportData();
		const base = ( ( report.projectTitle || 'projeto' ) + ( state.scope !== null ? '-' + ( state.scope.name || 'conjunto' ) : '' ) ).replace( /[^A-Za-z0-9À-ÿ._-]+/g, '_' ).slice( 0, 60 );
		if ( kind === 'csv' ) editor.utils.save( new Blob( [ toTechnicalCSV( report ) ], { type: 'text/csv;charset=utf-8' } ), `lista-de-pecas-${base}.csv` );
		else if ( kind === 'xlsx' ) editor.utils.save( toTechnicalXLSX( report ), `lista-tecnica-${base}.xlsx` );
		else editor.utils.save( toTechnicalPDF( report ), `relatorio-tecnico-cadastral-${base}.pdf` );

	}

	// conferência ---------------------------------------------------------------------------------------------------

	function renderCheck() {

		const toolbar = el( 'div', 'SimpleCatalogToolbar' );
		const require = el( 'label', 'SimpleCheckboxRow SimpleCatalogRequireManufacturer' );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.checked = state.requireManufacturer;
		box.addEventListener( 'change', () => {

			state.requireManufacturer = box.checked;
			render();

		} );
		require.append( box, el( 'span', '', 'Exigir fabricante' ) );
		toolbar.append( scopeSelect( render ), require );
		body.appendChild( toolbar );

		const result = validateAssembly( editor, scopeRoot(), { catalog, modelLibrary: context.modelLibrary || null, requireManufacturer: state.requireManufacturer } );
		state.lastCheck = result;
		body.appendChild( el( 'p', 'SimpleCatalogNotice', result.notice ) );
		const s = result.summary;
		const counts = el( 'div', 'SimpleTechIndicators SimpleCheckCounts' );
		for ( const [ label, value, tone ] of [[ 'Peças analisadas', s.analyzed, 'neutral' ], [ 'Peças identificadas', s.identified, 'complete' ], [ 'Pendências cadastrais', s.pending, s.pending > 0 ? 'missing' : 'neutral' ], [ 'Divergências dimensionais', s.divergent, s.divergent > 0 ? 'divergent' : 'neutral' ], [ 'Incompatibilidades declaradas', s.incompatible, s.incompatible > 0 ? 'incompatible' : 'neutral' ], [ 'Informações insuficientes', s.insufficient, s.insufficient > 0 ? 'missing' : 'neutral' ], [ 'Conexões com compatibilidade declarada', s.compatibleConnections, 'neutral' ]] ) {

			const card = el( 'div', 'SimpleTechIndicator ' + tone );
			card.append( el( 'strong', '', String( value ) ), el( 'span', '', label ) );
			counts.appendChild( card );

		}

		body.appendChild( counts );
		const list = el( 'ul', 'SimpleCheckFindings' );
		if ( result.findings.length === 0 ) list.appendChild( el( 'li', 'SimpleCatalogEmpty', 'Nenhuma pendência cadastral ou dimensional encontrada nesta conferência. Isso não indica aptidão para montagem física.' ) );
		result.findings.forEach( ( f, i ) => {

			const li = el( 'li', 'SimpleCheckFinding ' + f.severity );
			li.tabIndex = 0;
			li.append( el( 'strong', '', f.label ), el( 'span', '', ' ' + f.message ) );
			if ( f.objects.length > 0 ) {

				li.addEventListener( 'click', () => locate( f.objects, 'finding:' + i ) );
				li.addEventListener( 'keydown', ( event ) => {

					if ( event.key === 'Enter' ) locate( f.objects, 'finding:' + i );

				} );

			}

			list.appendChild( li );

		} );
		body.appendChild( list );
		if ( result.connections.some( ( c ) => c.result === 'compatible' ) ) body.appendChild( el( 'p', 'SimpleCatalogHint', CAVEAT ) );

	}

	// compatibilidade ---------------------------------------------------------------------------------------------

	function renderCompat() {

		body.appendChild( el( 'p', 'SimpleCatalogNotice', 'Regras declaradas entre famílias técnicas de conectores. Regras direcionais valem somente no sentido A → B; nada é inferido por transitividade. ' + CAVEAT ) );

		const form = el( 'div', 'SimpleCatalogToolbar SimpleRuleForm' );
		const famA = input( 'familyA', '', { placeholder: 'Família A (ex.: perfil-modular-40)', maxLength: 60 } );
		famA.classList.add( 'SimpleRuleFamilyA' );
		const famB = input( 'familyB', '', { placeholder: 'Família B', maxLength: 60 } );
		famB.classList.add( 'SimpleRuleFamilyB' );
		const result = select( 'result', RULE_RESULTS.map( ( r ) => [ r.id, r.name ] ), 'compatible' );
		result.classList.add( 'SimpleRuleResult' );
		const directional = el( 'label', 'SimpleCheckboxRow' );
		const dirBox = el( 'input' );
		dirBox.type = 'checkbox';
		dirBox.classList.add( 'SimpleRuleDirectional' );
		directional.append( dirBox, el( 'span', '', 'Direcional (somente A → B)' ) );
		const note = input( 'note', '', { placeholder: 'Observação', maxLength: 300 } );
		note.classList.add( 'SimpleRuleNote' );
		const source = input( 'source', '', { placeholder: 'Origem da informação', maxLength: 200 } );
		source.classList.add( 'SimpleRuleSource' );
		form.append( famA, famB, result, directional, note, source, button( 'Cadastrar regra', async () => {

			try {

				await catalog.saveRule( { familyA: famA.value, familyB: famB.value, result: result.value, directional: dirBox.checked, note: note.value, source: source.value } );
				context.notify( 'Regra de compatibilidade cadastrada no catálogo local.', 'success' );

			} catch ( error ) {

				context.notify( error.message, 'warning' );

			}

		}, { icon: 'add', className: 'SimpleRuleAdd' } ) );
		body.appendChild( form );

		const rules = catalog.getRules();
		const projectRules = Object.values( getSnapshot( editor.scene ).rules );
		if ( rules.length === 0 ) body.appendChild( el( 'p', 'SimpleCatalogEmpty', 'Nenhuma regra cadastrada.' ) );
		else {

			const table = el( 'table', 'SimpleBomTable SimpleRuleTable' );
			const hr = el( 'tr' );
			for ( const h of [ 'Família A', 'Família B', 'Resultado', 'Sentido', 'Observação', 'Origem', 'Rev.', '' ] ) hr.appendChild( el( 'th', '', h ) );
			table.appendChild( hr );
			for ( const rule of rules ) {

				const tr = el( 'tr', 'SimpleRuleRow ' + rule.result );
				tr.dataset.ruleId = rule.id;
				for ( const c of [ rule.familyA, rule.familyB, RULE_RESULTS.find( ( r ) => r.id === rule.result ).name, rule.directional ? 'A → B' : 'A ↔ B', rule.note, rule.source, String( rule.revision ) ] ) tr.appendChild( el( 'td', '', c ) );
				const td = el( 'td' );
				td.appendChild( button( 'Excluir', () => catalog.removeRule( rule.id ), { className: 'SimpleRuleDelete danger' } ) );
				tr.appendChild( td );
				table.appendChild( tr );

			}

			body.appendChild( table );

		}

		// regras do projeto diferentes das locais: atualização explícita (com Desfazer)
		const differing = projectRules.filter( ( pr ) => {

			const local = rules.find( ( r ) => r.id === pr.id );
			return local !== undefined && local.revision !== pr.revision;

		} );
		if ( differing.length > 0 ) {

			const box = el( 'div', 'SimpleCatalogPick' );
			box.append( el( 'span', '', `${differing.length} regra(s) preservada(s) no projeto diferem das do catálogo local (o projeto continua usando as suas).` ), button( 'Atualizar regras do projeto', () => {

				const snapshot = getSnapshot( editor.scene );
				for ( const pr of differing ) snapshot.rules[ pr.id ] = rules.find( ( r ) => r.id === pr.id );
				editor.execute( new SetTechnicalCatalogSnapshotCommand( editor, snapshot, 'Atualizar regras de compatibilidade do projeto' ) );
				render();

			}, { className: 'SimpleRuleUpdateProject' } ) );
			body.appendChild( box );

		}

		// teste de par
		const tester = el( 'div', 'SimpleCatalogToolbar SimpleCompatTester' );
		const ta = input( 'testA', '', { placeholder: 'Família da peça A', maxLength: 60 } );
		ta.classList.add( 'SimpleCompatA' );
		const tb = input( 'testB', '', { placeholder: 'Família da peça B', maxLength: 60 } );
		tb.classList.add( 'SimpleCompatB' );
		const out = el( 'p', 'SimpleCompatResult' );
		out.setAttribute( 'aria-live', 'polite' );
		tester.append( el( 'strong', '', 'Verificar par:' ), ta, tb, button( 'Verificar', () => {

			const clean = ( v ) => v.trim().toLowerCase().replace( /\s+/g, '-' );
			const evaluation = evaluateFamilies( clean( ta.value ), clean( tb.value ), effectiveRules( editor.scene, catalog ) );
			out.className = 'SimpleCompatResult ' + evaluation.result;
			out.textContent = `${RESULT_LABELS[ evaluation.result ]}. ${evaluation.reason}${evaluation.result === 'compatible' ? ' ' + CAVEAT : ''}`;

		}, { className: 'SimpleCompatCheck' } ) );
		body.appendChild( tester );
		body.appendChild( out );

	}

	// resumo -----------------------------------------------------------------------------------------------------------

	function renderSummary() {

		const { indicators, weight, result } = technicalSummary( editor, { catalog, modelLibrary: context.modelLibrary || null, requireManufacturer: state.requireManufacturer } );
		const grid = el( 'div', 'SimpleTechIndicators' );
		for ( const indicator of indicators ) {

			const card = el( 'button', 'SimpleTechIndicator ' + indicator.tone );
			card.type = 'button';
			card.dataset.indicator = indicator.id;
			card.append( el( 'strong', '', indicator.value ), el( 'span', '', indicator.label ) );
			card.addEventListener( 'click', () => {

				state.scope = null;
				if ( indicator.filter === 'check' ) return show( 'check' );
				state.filter = indicator.filter;
				show( 'project' );

			} );
			grid.appendChild( card );

		}

		body.appendChild( grid );
		body.appendChild( el( 'p', 'SimpleBomSummary' + ( result.bom.summary.partial ? ' partial' : '' ), weight ) );
		body.appendChild( el( 'p', 'SimpleCatalogNotice', result.notice ) );
		const legend = el( 'p', 'SimpleCatalogHint', 'Legenda: azul = informação completa · âmbar = informação faltante · vermelho = incompatibilidade declarada · roxo = divergência de revisão ou dimensional.' );
		body.appendChild( legend );

	}

	return {
		open, close, show, openSheet, offerUpdate,
		isOpen: () => state.open,
		// fluxo "Associar ficha existente" a partir das propriedades
		pickFor: ( objects ) => open( 'catalog', { pick: objects } ),
		newFromObject: ( object ) => openSheet( null, 'new', { draft: draftFromObject( object ), source: object } ),
		showBOM: ( rootObject = null ) => open( 'project', { scope: rootObject !== null && isAssembly( rootObject ) ? rootObject : null, filter: 'all' } ),
		check: ( rootObject = null ) => open( 'check', { scope: rootObject !== null && isAssembly( rootObject ) ? rootObject : null } ),
		viewRecord: ( record ) => openSheet( record.catalogId, 'view', { record } ),
		state
	};

}

export { SimpleModeTechnicalCatalog };
