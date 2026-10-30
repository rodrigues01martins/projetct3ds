// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Área de trabalho "Quantitativos e Orçamento" (sobre a visualização, com retorno simples ao 3D):
//   Quantitativos — registros medidos do modelo (pesquisa, filtro, ordenação, agrupamento, detalhes, localizar no 3D,
//                   criar item orçamentário a partir de uma medição);
//   Orçamento     — itens com base de medição, coeficiente, perda, preço (edição direta), metadados do preço;
//   Resumo        — indicadores, categorias, adicionais, referência de preços, consolidação física, exportações.
// Quantidades e totais são recalculados quando o projeto muda (eventos confirmados: histórico, cena, geometria);
// só edições do orçamento geram SetBudgetCommand (uma por confirmação de campo).

import { UIDiv } from './libs/ui.js';

import { SetBudgetCommand } from './commands/SetBudgetCommand.js';

import { groupRecords, dimsText } from './SimpleMode.Quantities.js';
import { formatBRL, parseMoney } from './SimpleMode.BudgetCalculator.js';
import { getBudget, sanitizeItem, sanitizeAdjustment, newId, nextCode, BUDGET_LIMITS } from './SimpleMode.BudgetData.js';
import { buildReportData, statusLabel } from './SimpleMode.BudgetSummary.js';
import { toCSV } from './SimpleMode.BudgetCSV.js';
import { toXLSX } from './SimpleMode.BudgetXLSX.js';
import { toReportPDF } from './SimpleMode.BudgetPDF.js';
import { UNITS, MEASUREMENTS, TYPES, CATEGORIES, QUANTITY_CATEGORIES, formatQuantity, unitLabel, measurementLabel, measurementUnit } from './SimpleMode.QuantityRules.js';
import { parseNumber } from './SimpleMode.Units.js';

import { getSimpleString as t } from './SimpleMode.Strings.js';
import { createSimpleButton } from './SimpleMode.Icons.js';

const TABS = [ 'quantities', 'budget', 'summary' ];

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function option( value, label, selected = false ) {

	const node = el( 'option', '', label );
	node.value = value;
	node.selected = selected;
	return node;

}

function stopKeys( input ) {

	input.addEventListener( 'keydown', ( event ) => {

		event.stopPropagation();
		if ( event.key === 'Enter' && input.tagName === 'INPUT' ) input.blur();

	} );

}

function SimpleModeBudgetView( editor, context, container ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();
	const state = { open: false, tab: 'quantities', frame: 0, report: null, search: '', category: '', grouped: false, sort: { key: 'code', dir: 1 }, selectedRecord: null, selectedItem: null, budgetSearch: '' };

	// estrutura --------------------------------------------------------------------------------------------------

	const root = new UIDiv().setClass( 'SimpleBudget' );
	root.dom.id = 'simple-budget';
	root.dom.setAttribute( 'role', 'region' );
	root.dom.setAttribute( 'aria-label', t( 'budget/title' ) );
	root.dom.hidden = true;
	container.add( root );

	const header = el( 'div', 'SimpleBudgetHeader' );
	root.dom.appendChild( header );
	header.appendChild( el( 'h2', 'SimpleBudgetTitle', t( 'budget/title' ) ) );

	const tabList = el( 'div', 'SimpleBudgetTabs' );
	tabList.setAttribute( 'role', 'tablist' );
	header.appendChild( tabList );

	const tabButtons = {};
	for ( const id of TABS ) {

		const button = el( 'button', 'SimpleBudgetTab', t( 'budget/tab/' + id ) );
		button.type = 'button';
		button.dataset.tab = id;
		button.setAttribute( 'role', 'tab' );
		button.addEventListener( 'click', () => setTab( id ) );
		tabList.appendChild( button );
		tabButtons[ id ] = button;

	}

	const exportGroup = el( 'div', 'SimpleBudgetExport' );
	for ( const [ format, label ] of [[ 'csv', 'CSV' ], [ 'xlsx', 'Excel' ], [ 'pdf', 'PDF' ]] ) {

		const button = createSimpleButton( { icon: 'image', label, title: t( 'budget/export/' + format ), onClick: () => exportAs( format ) } ).dom;
		button.dataset.format = format;
		exportGroup.appendChild( button );

	}

	header.appendChild( exportGroup );
	header.appendChild( createSimpleButton( { icon: 'close', label: t( 'budget/close' ), title: t( 'budget/close/title' ), className: 'SimpleBudgetClose', onClick: () => close() } ).dom );

	const disclaimer = el( 'p', 'SimpleBudgetDisclaimer', t( 'budget/disclaimer' ) );
	root.dom.appendChild( disclaimer );

	const panels = {};
	for ( const id of TABS ) {

		const panel = el( 'div', 'SimpleBudgetPanel' );
		panel.dataset.panel = id;
		panel.setAttribute( 'role', 'tabpanel' );
		root.dom.appendChild( panel );
		panels[ id ] = panel;

	}

	// dados e comandos ------------------------------------------------------------------------------------------------

	function commit( mutate, name, attributeName = '' ) {

		const budget = getBudget( editor.scene );
		const result = mutate( budget );
		if ( result === false ) return false;
		editor.execute( new SetBudgetCommand( editor, budget, name, attributeName ) );
		return true;

	}

	function updateItem( id, changes, name, attributeName = '' ) {

		return commit( ( budget ) => {

			const index = budget.items.findIndex( ( item ) => item.id === id );
			if ( index === - 1 ) return false;
			const next = sanitizeItem( Object.assign( {}, budget.items[ index ], changes ), index );
			if ( next === null ) return false;
			budget.items[ index ] = next;

		}, name, attributeName );

	}

	function build() {

		state.report = buildReportData( editor.scene, { projectTitle: editor.config.getKey( 'project/title' ) || '' } );
		return state.report;

	}

	function schedule() {

		if ( state.open && state.frame === 0 ) state.frame = requestAnimationFrame( render );

	}

	// render preservando o campo em foco (identificado por data-focus)
	function render() {

		state.frame = 0;
		if ( state.open === false ) return;

		const active = document.activeElement;
		const focusKey = active !== null && root.dom.contains( active ) ? active.dataset.focus : undefined;
		const selection = focusKey !== undefined && typeof active.selectionStart === 'number' ? [ active.selectionStart, active.selectionEnd ] : null;

		build();
		renderQuantities();
		renderBudget();
		renderSummary();

		if ( focusKey !== undefined ) {

			const next = root.dom.querySelector( `[data-focus="${focusKey}"]` );
			if ( next !== null ) {

				next.focus();
				if ( selection !== null && typeof next.setSelectionRange === 'function' ) try {

					next.setSelectionRange( ...selection );

				} catch ( error ) { /* campos sem seleção de texto */ }

			}

		}

		changed.dispatch();

	}

	function setTab( id ) {

		state.tab = id;
		for ( const tab of TABS ) {

			tabButtons[ tab ].classList.toggle( 'active', tab === id );
			tabButtons[ tab ].setAttribute( 'aria-selected', tab === id );
			panels[ tab ].hidden = tab !== id;

		}

	}

	// localizar no 3D (sem alterar a geometria) -------------------------------------------------------------------------

	function locate( uuid ) {

		const object = editor.objectByUuid( uuid );
		if ( object === undefined ) {

			context.notify( t( 'budget/locate/missing' ), 'warning' );
			return;

		}

		close();
		editor.select( object );
		if ( context.cameras !== undefined ) context.cameras.frameSelection( object );

	}

	// QUANTITATIVOS --------------------------------------------------------------------------------------------------------

	const qToolbar = el( 'div', 'SimpleBudgetToolbar' );
	panels.quantities.appendChild( qToolbar );

	const search = el( 'input', 'SimpleTextInput SimpleBudgetSearch' );
	search.type = 'search';
	search.placeholder = t( 'budget/search' );
	search.setAttribute( 'aria-label', t( 'budget/search' ) );
	search.dataset.focus = 'q-search';
	stopKeys( search );
	search.addEventListener( 'input', () => {

		state.search = search.value;
		renderQuantities();

	} );
	qToolbar.appendChild( search );

	const categorySelect = el( 'select', 'SimpleSelect' );
	categorySelect.setAttribute( 'aria-label', t( 'budget/filter' ) );
	categorySelect.appendChild( option( '', t( 'budget/filter/all' ) ) );
	for ( const key of QUANTITY_CATEGORIES ) categorySelect.appendChild( option( key, CATEGORIES[ key ] ) );
	stopKeys( categorySelect );
	categorySelect.addEventListener( 'change', () => {

		state.category = categorySelect.value;
		renderQuantities();

	} );
	qToolbar.appendChild( categorySelect );

	const groupLabel = el( 'label', 'SimpleCheckboxRow SimpleBudgetCheck' );
	const groupBox = el( 'input' );
	groupBox.type = 'checkbox';
	groupBox.dataset.focus = 'q-group';
	stopKeys( groupBox );
	groupBox.addEventListener( 'change', () => {

		state.grouped = groupBox.checked;
		state.selectedRecord = null;
		renderQuantities();

	} );
	groupLabel.append( groupBox, el( 'span', '', t( 'budget/group' ) ) );
	qToolbar.appendChild( groupLabel );

	const qCount = el( 'span', 'SimpleBudgetCount' );
	qToolbar.appendChild( qCount );

	const qIssues = el( 'div', 'SimpleNotice SimpleBudgetIssues' );
	qIssues.setAttribute( 'role', 'status' );
	panels.quantities.appendChild( qIssues );

	const qLayout = el( 'div', 'SimpleBudgetSplit' );
	panels.quantities.appendChild( qLayout );
	const qTableBox = el( 'div', 'SimpleBudgetTableBox' );
	qLayout.appendChild( qTableBox );
	const qDetail = el( 'aside', 'SimpleBudgetDetail' );
	qLayout.appendChild( qDetail );

	const Q_COLUMNS = [
		[ 'code', 'budget/col/code' ], [ 'category', 'budget/col/category' ], [ 'description', 'budget/col/description' ], [ 'unit', 'budget/col/unit' ],
		[ 'quantity', 'budget/col/quantity', 'num' ], [ 'origin', 'budget/col/origin' ], [ 'status', 'budget/col/status' ]
	];

	function quantityRows() {

		const records = state.report.quantities.records;
		const rows = state.grouped ? groupRecords( records ).map( ( group ) => ( {
			key: 'g:' + group.key,
			group,
			code: group.members.map( ( m ) => m.code ).join( ', ' ),
			category: CATEGORIES[ group.category ],
			categoryKey: group.category,
			description: `${group.typeLabel} — ${dimsText( group.members[ 0 ] )}`,
			unit: measurementUnit( group.primary ),
			quantity: group.measurements[ group.primary ],
			origin: `${measurementLabel( group.primary )} · ${group.members.length} ${group.members.length === 1 ? 'componente' : 'componentes'}`,
			status: statusLabel( group.status )
		} ) ) : records.map( ( record ) => ( {
			key: record.uuid,
			record,
			code: record.code,
			category: CATEGORIES[ record.category ],
			categoryKey: record.category,
			description: `${record.name} — ${record.typeLabel}, ${dimsText( record )}`,
			unit: measurementUnit( record.primary ),
			quantity: record.measurements[ record.primary ],
			origin: measurementLabel( record.primary ) + ( record.host !== null ? ` · em ${record.host.name}` : '' ),
			status: statusLabel( record.status )
		} ) );

		const query = state.search.trim().toLowerCase();
		const filtered = rows.filter( ( row ) => ( state.category === '' || row.categoryKey === state.category ) && ( query === '' || [ row.code, row.category, row.description, row.origin, row.status ].join( ' ' ).toLowerCase().includes( query ) ) );

		const { key, dir } = state.sort;
		return filtered.sort( ( a, b ) => {

			const va = a[ key ], vb = b[ key ];
			if ( typeof va === 'number' || typeof vb === 'number' ) return ( ( Number.isFinite( va ) ? va : - Infinity ) - ( Number.isFinite( vb ) ? vb : - Infinity ) ) * dir;
			return String( va ).localeCompare( String( vb ), 'pt-BR', { numeric: true } ) * dir;

		} );

	}

	function tableHead( columns, sortable ) {

		const thead = el( 'thead' );
		const tr = el( 'tr' );

		for ( const [ key, label, kind ] of columns ) {

			const th = el( 'th', kind === 'num' ? 'num' : '' );
			th.scope = 'col';

			if ( sortable ) {

				const button = el( 'button', 'SimpleBudgetSort', t( label ) );
				button.type = 'button';
				button.dataset.sort = key;
				const active = state.sort.key === key;
				th.setAttribute( 'aria-sort', active ? ( state.sort.dir > 0 ? 'ascending' : 'descending' ) : 'none' );
				if ( active ) button.textContent += state.sort.dir > 0 ? ' ▲' : ' ▼';
				button.addEventListener( 'click', () => {

					state.sort = { key, dir: state.sort.key === key ? - state.sort.dir : 1 };
					renderQuantities();

				} );
				th.appendChild( button );

			} else th.textContent = t( label );

			tr.appendChild( th );

		}

		thead.appendChild( tr );
		return thead;

	}

	function renderQuantities() {

		if ( state.report === null ) return;

		const report = state.report;
		const rows = quantityRows();

		qCount.textContent = t( 'budget/count', rows.length, report.quantities.records.length );
		categorySelect.value = state.category;
		groupBox.checked = state.grouped;
		if ( document.activeElement !== search ) search.value = state.search;

		const issues = report.quantities.issues;
		qIssues.hidden = issues.length === 0;
		qIssues.textContent = issues.map( ( issue ) => issue.message ).join( ' · ' );

		const table = el( 'table', 'SimpleBudgetTable' );
		table.appendChild( tableHead( Q_COLUMNS, true ) );
		const tbody = el( 'tbody' );

		for ( const row of rows ) {

			const tr = el( 'tr' );
			tr.dataset.key = row.key;
			tr.tabIndex = 0;
			tr.classList.toggle( 'selected', state.selectedRecord === row.key );
			tr.classList.toggle( 'warning', row.status !== 'OK' );

			for ( const [ key, , kind ] of Q_COLUMNS ) {

				const value = key === 'quantity' ? formatQuantity( row.quantity, row.unit ) : ( key === 'unit' ? unitLabel( row.unit ) : row[ key ] );
				tr.appendChild( el( 'td', kind === 'num' ? 'num' : '', value ) );

			}

			const select = () => {

				state.selectedRecord = row.key;
				renderQuantities();

			};

			tr.addEventListener( 'click', select );
			tr.addEventListener( 'keydown', ( event ) => {

				if ( event.key === 'Enter' || event.key === ' ' ) {

					event.preventDefault();
					event.stopPropagation();
					select();

				}

			} );
			tbody.appendChild( tr );

		}

		table.appendChild( tbody );
		qTableBox.textContent = '';
		qTableBox.appendChild( rows.length > 0 ? table : el( 'p', 'SimpleBudgetEmpty', report.quantities.records.length === 0 ? t( 'budget/quantities/empty' ) : t( 'budget/quantities/noMatch' ) ) );

		renderRecordDetail( rows.find( ( row ) => row.key === state.selectedRecord ) );

	}

	function renderRecordDetail( row ) {

		qDetail.textContent = '';

		if ( row === undefined ) {

			qDetail.appendChild( el( 'p', 'SimpleBudgetEmpty', t( 'budget/detail/empty' ) ) );
			return;

		}

		const entry = row.record || row.group.members[ 0 ];
		const members = row.record ? [ row.record ] : row.group.members;
		const measurements = row.record ? row.record.measurements : row.group.measurements;

		qDetail.appendChild( el( 'h3', 'SimpleBudgetDetailTitle', row.record ? `${row.record.code} · ${row.record.name}` : `${row.group.typeLabel} (${members.length})` ) );
		qDetail.appendChild( el( 'p', 'SimpleBudgetDetailMeta', `${entry.typeLabel} · ${CATEGORIES[ entry.category ]} · ${dimsText( entry )}` ) );
		if ( row.record && row.record.host !== null ) qDetail.appendChild( el( 'p', 'SimpleBudgetDetailMeta', t( 'budget/detail/host', row.record.host.name ) ) );

		const list = el( 'dl', 'SimpleBudgetMeasures' );
		for ( const key of TYPES[ entry.type ].measurements ) {

			if ( measurements[ key ] === undefined ) continue;
			const dt = el( 'dt', '', measurementLabel( key ) );
			dt.title = MEASUREMENTS[ key ].formula;
			list.append( dt, el( 'dd', '', formatQuantity( measurements[ key ], measurementUnit( key ), { withUnit: true } ) ) );

		}

		qDetail.appendChild( list );

		for ( const note of new Set( members.flatMap( ( m ) => m.notes ) ) ) qDetail.appendChild( el( 'p', 'SimpleBudgetNote', note ) );

		// localizar
		const locateBox = el( 'div', 'SimpleBudgetMembers' );
		for ( const member of members.slice( 0, 30 ) ) {

			const button = createSimpleButton( { icon: 'frameSelection', label: members.length > 1 ? `${member.code} ${member.name}` : t( 'budget/locate' ), title: t( 'budget/locate/title' ), className: 'SimpleBudgetLocate', onClick: () => locate( member.uuid ) } ).dom;
			locateBox.appendChild( button );

		}

		qDetail.appendChild( locateBox );

		// criar item orçamentário a partir de uma medição
		const form = el( 'div', 'SimpleBudgetCreate' );
		form.appendChild( el( 'h4', '', t( 'budget/create/title' ) ) );

		const measureSelect = el( 'select', 'SimpleSelect' );
		measureSelect.dataset.focus = 'create-measure';
		for ( const key of TYPES[ entry.type ].measurements ) if ( measurements[ key ] !== undefined && Number.isFinite( measurements[ key ] ) ) measureSelect.appendChild( option( key, `${measurementLabel( key )} (${unitLabel( measurementUnit( key ) )})`, key === entry.primary ) );
		stopKeys( measureSelect );

		const scopeSelect = el( 'select', 'SimpleSelect' );
		scopeSelect.dataset.focus = 'create-scope';
		if ( row.record ) scopeSelect.appendChild( option( 'object', t( 'budget/create/scope/object' ) ) );
		scopeSelect.appendChild( option( 'groupDims', t( 'budget/create/scope/groupDims' ), row.group !== undefined ) );
		scopeSelect.appendChild( option( 'group', t( 'budget/create/scope/group' ) ) );
		stopKeys( scopeSelect );

		const label = ( text, control ) => {

			const node = el( 'label', 'SimpleBudgetField' );
			node.append( el( 'span', '', text ), control );
			return node;

		};

		form.append( label( t( 'budget/create/measurement' ), measureSelect ), label( t( 'budget/create/scope' ), scopeSelect ) );
		form.appendChild( createSimpleButton( { icon: 'bookmark', label: t( 'budget/create/button' ), className: 'active SimpleBudgetCreateButton', onClick: () => {

			if ( measureSelect.value === '' ) return context.notify( t( 'budget/create/noMeasure' ), 'warning' );
			createItem( entry, measureSelect.value, scopeSelect.value );

		} } ).dom );

		qDetail.appendChild( form );

	}

	function createItem( entry, measurement, scope ) {

		const unit = measurementUnit( measurement );
		const source = scope === 'object' ? { kind: 'object', objectUuid: entry.uuid, measurement } : { kind: 'group', componentId: entry.type, groupKey: scope === 'groupDims' ? entry.groupKey : null, measurement };
		const scopeText = scope === 'object' ? entry.name : ( scope === 'groupDims' ? `${entry.typeLabel} ${dimsText( entry )}` : `${entry.typeLabel} (todos)` );
		let created = null;

		commit( ( budget ) => {

			if ( budget.items.length >= BUDGET_LIMITS.items ) {

				context.notify( t( 'budget/limit', BUDGET_LIMITS.items ), 'warning' );
				return false;

			}

			created = sanitizeItem( { id: newId( 'item' ), code: nextCode( budget ), category: entry.category, description: `${measurementLabel( measurement )} — ${scopeText}`, unit, source, wastePercent: 0, unitPriceCents: null } );
			budget.items.push( created );

		}, t( 'budget/command/create' ) );

		if ( created !== null ) {

			state.selectedItem = created.id;
			context.notify( t( 'budget/created', created.code ), 'success' );
			setTab( 'budget' );

		}

	}

	// ORÇAMENTO ----------------------------------------------------------------------------------------------------------

	const bToolbar = el( 'div', 'SimpleBudgetToolbar' );
	panels.budget.appendChild( bToolbar );

	const budgetSearch = el( 'input', 'SimpleTextInput SimpleBudgetSearch' );
	budgetSearch.type = 'search';
	budgetSearch.placeholder = t( 'budget/search' );
	budgetSearch.setAttribute( 'aria-label', t( 'budget/search' ) );
	budgetSearch.dataset.focus = 'b-search';
	stopKeys( budgetSearch );
	budgetSearch.addEventListener( 'input', () => {

		state.budgetSearch = budgetSearch.value;
		renderBudget();

	} );
	bToolbar.appendChild( budgetSearch );

	bToolbar.appendChild( createSimpleButton( { icon: 'new', label: t( 'budget/manual/add' ), title: t( 'budget/manual/add/title' ), className: 'SimpleBudgetAddManual', onClick: () => {

		let created = null;
		commit( ( budget ) => {

			created = sanitizeItem( { id: newId( 'item' ), code: nextCode( budget ), category: 'others', description: t( 'budget/manual/description' ), unit: 'vb', source: { kind: 'manual', quantity: 1 }, unitPriceCents: null } );
			budget.items.push( created );

		}, t( 'budget/command/manual' ) );
		state.selectedItem = created.id;

	} } ).dom );

	const bPartial = el( 'div', 'SimpleNotice SimpleBudgetPartial' );
	panels.budget.appendChild( bPartial );

	const bLayout = el( 'div', 'SimpleBudgetSplit' );
	panels.budget.appendChild( bLayout );
	const bTableBox = el( 'div', 'SimpleBudgetTableBox' );
	bLayout.appendChild( bTableBox );
	const bDetail = el( 'aside', 'SimpleBudgetDetail' );
	bLayout.appendChild( bDetail );

	const B_COLUMNS = [
		[ 'code', 'budget/col/code' ], [ 'category', 'budget/col/category' ], [ 'description', 'budget/col/item' ], [ 'unit', 'budget/col/unit' ],
		[ 'base', 'budget/col/base', 'num' ], [ 'waste', 'budget/col/waste', 'num' ], [ 'budgeted', 'budget/col/budgeted', 'num' ], [ 'price', 'budget/col/price', 'num' ], [ 'subtotal', 'budget/col/subtotal', 'num' ], [ 'status', 'budget/col/status' ]
	];

	function numberInput( value, { key, label, onCommit } ) {

		const input = el( 'input', 'SimpleTextInput SimpleBudgetNumber' );
		input.inputMode = 'decimal';
		input.value = value;
		input.dataset.focus = key;
		input.setAttribute( 'aria-label', label );
		stopKeys( input );
		input.addEventListener( 'click', ( event ) => event.stopPropagation() );
		input.addEventListener( 'change', () => onCommit( input.value, input ) );
		return input;

	}

	const decimalText = ( value, digits = 2 ) => ( value === null || value === undefined ? '' : value.toLocaleString( 'pt-BR', { maximumFractionDigits: digits, useGrouping: false } ) );
	const priceText = ( cents ) => ( cents === null ? '' : ( cents / 100 ).toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) );

	function commitWaste( item, text, input ) {

		const value = parseNumber( text === '' ? '0' : text );
		if ( value === null || value < 0 || value > BUDGET_LIMITS.waste ) {

			context.notify( t( 'budget/invalid/waste', BUDGET_LIMITS.waste ), 'warning' );
			input.value = decimalText( item.wastePercent );
			return;

		}

		if ( value !== item.wastePercent ) updateItem( item.id, { wastePercent: value }, t( 'budget/command/waste' ), 'waste-' + item.id );

	}

	function commitPrice( item, text, input ) {

		if ( text.trim() === '' ) {

			if ( item.unitPriceCents !== null ) updateItem( item.id, { unitPriceCents: null }, t( 'budget/command/price' ), 'price-' + item.id );
			return;

		}

		const cents = parseMoney( text );
		if ( cents === null || cents > BUDGET_LIMITS.maxCents ) {

			context.notify( t( 'budget/invalid/price' ), 'warning' );
			input.value = priceText( item.unitPriceCents );
			return;

		}

		if ( cents !== item.unitPriceCents ) updateItem( item.id, { unitPriceCents: cents }, t( 'budget/command/price' ), 'price-' + item.id );

	}

	function renderBudget() {

		if ( state.report === null ) return;

		const report = state.report;
		const summary = report.summary;
		const query = state.budgetSearch.trim().toLowerCase();
		const results = report.computed.items.filter( ( r ) => query === '' || [ r.item.code, r.item.description, CATEGORIES[ r.item.category ], r.sourceLabel ].join( ' ' ).toLowerCase().includes( query ) );

		bPartial.hidden = summary.partial === false;
		bPartial.textContent = summary.partial ? t( 'budget/partial', summary.unpricedCount, summary.problemCount ) : '';
		if ( document.activeElement !== budgetSearch ) budgetSearch.value = state.budgetSearch;

		bTableBox.textContent = '';

		if ( report.computed.items.length === 0 ) {

			bTableBox.appendChild( el( 'p', 'SimpleBudgetEmpty', t( 'budget/items/empty' ) ) );
			renderItemDetail( undefined );
			return;

		}

		const table = el( 'table', 'SimpleBudgetTable SimpleBudgetItems' );
		table.appendChild( tableHead( B_COLUMNS, false ) );
		const tbody = el( 'tbody' );

		for ( const result of results ) {

			const item = result.item;
			const tr = el( 'tr' );
			tr.dataset.item = item.id;
			tr.tabIndex = 0;
			tr.classList.toggle( 'selected', state.selectedItem === item.id );
			tr.classList.toggle( 'warning', result.status !== 'ok' );

			tr.appendChild( el( 'td', '', item.code ) );
			tr.appendChild( el( 'td', '', CATEGORIES[ item.category ] ) );
			const description = el( 'td', 'SimpleBudgetDescription' );
			description.append( el( 'strong', '', item.description ), el( 'small', '', result.sourceLabel ) );
			tr.appendChild( description );
			tr.appendChild( el( 'td', '', unitLabel( item.unit ) ) );
			tr.appendChild( el( 'td', 'num', formatQuantity( result.quantityBase, item.unit ) ) );

			const waste = el( 'td', 'num' );
			waste.appendChild( numberInput( decimalText( item.wastePercent ), { key: 'waste-' + item.id, label: t( 'budget/col/waste' ), onCommit: ( text, input ) => commitWaste( item, text, input ) } ) );
			tr.appendChild( waste );

			tr.appendChild( el( 'td', 'num', formatQuantity( result.quantityBudget, item.unit ) ) );

			const price = el( 'td', 'num' );
			const priceInput = numberInput( priceText( item.unitPriceCents ), { key: 'price-' + item.id, label: t( 'budget/col/price' ) + ' (R$)', onCommit: ( text, input ) => commitPrice( item, text, input ) } );
			priceInput.placeholder = t( 'budget/noPrice' );
			priceInput.classList.toggle( 'missing', item.unitPriceCents === null );
			price.appendChild( priceInput );
			tr.appendChild( price );

			tr.appendChild( el( 'td', 'num SimpleBudgetSubtotal', result.subtotalCents !== null ? formatBRL( result.subtotalCents ) : '—' ) );
			const status = el( 'td', 'SimpleBudgetStatus', statusLabel( result.status ) );
			status.title = result.messages.join( ' ' );
			tr.appendChild( status );

			tr.addEventListener( 'click', () => {

				state.selectedItem = item.id;
				renderBudget();

			} );
			tbody.appendChild( tr );

		}

		table.appendChild( tbody );

		const tfoot = el( 'tfoot' );
		const total = el( 'tr' );
		const label = el( 'td', '', summary.partial ? t( 'budget/total/partial' ) : t( 'budget/total/direct' ) );
		label.colSpan = 8;
		total.append( label, el( 'td', 'num', formatBRL( summary.directCents ) ), el( 'td' ) );
		tfoot.appendChild( total );
		table.appendChild( tfoot );

		bTableBox.appendChild( table );
		renderItemDetail( report.computed.items.find( ( r ) => r.item.id === state.selectedItem ) );

	}

	function renderItemDetail( result ) {

		bDetail.textContent = '';

		if ( result === undefined ) {

			bDetail.appendChild( el( 'p', 'SimpleBudgetEmpty', t( 'budget/item/emptyDetail' ) ) );
			return;

		}

		const item = result.item;
		bDetail.appendChild( el( 'h3', 'SimpleBudgetDetailTitle', `${item.code} · ${item.description}` ) );

		for ( const message of result.messages ) bDetail.appendChild( el( 'p', result.status === 'ok' ? 'SimpleBudgetNote' : 'SimpleBudgetNote warning', message ) );

		const field = ( labelText, control ) => {

			const node = el( 'label', 'SimpleBudgetField' );
			node.append( el( 'span', '', labelText ), control );
			bDetail.appendChild( node );
			return control;

		};

		const textField = ( labelText, key, value, max, attribute ) => {

			const input = el( 'input', 'SimpleTextInput' );
			input.value = value;
			input.maxLength = max;
			input.dataset.focus = `d-${key}-${item.id}`;
			stopKeys( input );
			input.addEventListener( 'change', () => updateItem( item.id, { [ key ]: input.value }, t( 'budget/command/edit' ), attribute + item.id ) );
			return field( labelText, input );

		};

		textField( t( 'budget/field/code' ), 'code', item.code, 20, 'code-' );
		textField( t( 'budget/field/description' ), 'description', item.description, BUDGET_LIMITS.text, 'desc-' );

		const category = field( t( 'budget/field/category' ), el( 'select', 'SimpleSelect' ) );
		for ( const [ key, labelText ] of Object.entries( CATEGORIES ) ) category.appendChild( option( key, labelText, key === item.category ) );
		category.dataset.focus = 'd-category-' + item.id;
		stopKeys( category );
		category.addEventListener( 'change', () => updateItem( item.id, { category: category.value }, t( 'budget/command/edit' ) ) );

		const unit = field( t( 'budget/field/unit' ), el( 'select', 'SimpleSelect' ) );
		for ( const key of Object.keys( UNITS ) ) unit.appendChild( option( key, `${UNITS[ key ].label} — ${UNITS[ key ].name}`, key === item.unit ) );
		unit.dataset.focus = 'd-unit-' + item.id;
		stopKeys( unit );
		unit.addEventListener( 'change', () => updateItem( item.id, { unit: unit.value }, t( 'budget/command/unit' ) ) );

		// base de medição
		if ( item.source.kind === 'manual' ) {

			field( t( 'budget/field/quantity' ), numberInput( decimalText( item.source.quantity, 4 ), { key: 'd-qty-' + item.id, label: t( 'budget/field/quantity' ), onCommit: ( text, input ) => {

				const value = parseNumber( text );
				if ( value === null || value < 0 || value > BUDGET_LIMITS.maxQuantity ) {

					context.notify( t( 'budget/invalid/quantity' ), 'warning' );
					input.value = decimalText( item.source.quantity, 4 );
					return;

				}

				updateItem( item.id, { source: { kind: 'manual', quantity: value } }, t( 'budget/command/quantity' ), 'qty-' + item.id );

			} } ) );

		} else {

			bDetail.appendChild( el( 'p', 'SimpleBudgetDetailMeta', t( 'budget/field/source' ) + ': ' + result.sourceLabel ) );

			const type = item.source.kind === 'object' ? ( result.records[ 0 ] || {} ).type : item.source.componentId;
			const measure = field( t( 'budget/field/measurement' ), el( 'select', 'SimpleSelect' ) );
			for ( const key of ( TYPES[ type ] || { measurements: [ item.source.measurement ] } ).measurements ) measure.appendChild( option( key, `${measurementLabel( key )} (${unitLabel( measurementUnit( key ) )})`, key === item.source.measurement ) );
			measure.dataset.focus = 'd-measure-' + item.id;
			stopKeys( measure );
			measure.addEventListener( 'change', () => {

				// unidades diferentes só com regra de conversão explícita (coeficiente)
				if ( measurementUnit( measure.value ) !== item.unit && item.coefficient === null ) {

					context.notify( t( 'budget/invalid/unit', unitLabel( measurementUnit( measure.value ) ), unitLabel( item.unit ) ), 'warning' );
					measure.value = item.source.measurement;
					return;

				}

				updateItem( item.id, { source: Object.assign( {}, item.source, { measurement: measure.value } ) }, t( 'budget/command/measurement' ) );

			} );

			// religar referência ausente (escolha explícita entre componentes do mesmo tipo)
			if ( result.status === 'missingRef' ) {

				const candidates = state.report.quantities.records.filter( ( r ) => r.measurements[ item.source.measurement ] !== undefined );
				const relink = field( t( 'budget/relink' ), el( 'select', 'SimpleSelect' ) );
				relink.appendChild( option( '', t( 'budget/relink/choose' ) ) );
				for ( const candidate of candidates ) relink.appendChild( option( candidate.uuid, `${candidate.code} ${candidate.name}` ) );
				relink.dataset.focus = 'd-relink-' + item.id;
				stopKeys( relink );
				relink.addEventListener( 'change', () => {

					if ( relink.value !== '' ) updateItem( item.id, { source: Object.assign( {}, item.source, { objectUuid: relink.value } ) }, t( 'budget/command/relink' ) );

				} );

			}

		}

		field( t( 'budget/field/coefficient' ), numberInput( item.coefficient === null ? '' : decimalText( item.coefficient, 6 ), { key: 'd-coef-' + item.id, label: t( 'budget/field/coefficient' ), onCommit: ( text, input ) => {

			if ( text.trim() === '' ) return updateItem( item.id, { coefficient: null }, t( 'budget/command/coefficient' ), 'coef-' + item.id );
			const value = parseNumber( text );
			if ( value === null || value <= 0 ) {

				context.notify( t( 'budget/invalid/coefficient' ), 'warning' );
				input.value = item.coefficient === null ? '' : decimalText( item.coefficient, 6 );
				return;

			}

			updateItem( item.id, { coefficient: value }, t( 'budget/command/coefficient' ), 'coef-' + item.id );

		} } ) ).placeholder = t( 'budget/field/coefficient/none' );
		bDetail.appendChild( el( 'p', 'SimpleBudgetHint', t( 'budget/field/coefficient/hint' ) ) );

		field( t( 'budget/field/waste' ), numberInput( decimalText( item.wastePercent ), { key: 'd-waste-' + item.id, label: t( 'budget/field/waste' ), onCommit: ( text, input ) => commitWaste( item, text, input ) } ) );
		const price = field( t( 'budget/field/price' ), numberInput( priceText( item.unitPriceCents ), { key: 'd-price-' + item.id, label: t( 'budget/field/price' ), onCommit: ( text, input ) => commitPrice( item, text, input ) } ) );
		price.placeholder = t( 'budget/noPrice' );

		textField( t( 'budget/field/priceSource' ), 'priceSource', item.priceSource, BUDGET_LIMITS.short, 'psrc-' );
		const dateInput = field( t( 'budget/field/priceDate' ), el( 'input', 'SimpleTextInput' ) );
		dateInput.type = 'date';
		dateInput.value = item.priceDate || '';
		dateInput.dataset.focus = 'd-date-' + item.id;
		stopKeys( dateInput );
		dateInput.addEventListener( 'change', () => updateItem( item.id, { priceDate: dateInput.value || null }, t( 'budget/command/edit' ) ) );
		textField( t( 'budget/field/priceCode' ), 'priceCode', item.priceCode, 40, 'pcode-' );
		textField( t( 'budget/field/notes' ), 'notes', item.notes, 240, 'notes-' );

		const actions = el( 'div', 'SimpleActions SimpleBudgetItemActions' );
		if ( item.source.kind !== 'manual' && result.records.length > 0 ) actions.appendChild( createSimpleButton( { icon: 'frameSelection', label: t( 'budget/locate' ), onClick: () => locate( result.records[ 0 ].uuid ) } ).dom );
		actions.appendChild( createSimpleButton( { icon: 'delete', label: t( 'budget/item/delete' ), className: 'danger SimpleBudgetDelete', onClick: () => {

			commit( ( budget ) => {

				budget.items = budget.items.filter( ( entry ) => entry.id !== item.id );

			}, t( 'budget/command/delete' ) );
			state.selectedItem = null;
			context.notify( t( 'budget/deleted', item.code ) );

		} } ).dom );
		bDetail.appendChild( actions );

	}

	// RESUMO -----------------------------------------------------------------------------------------------------------------

	const sCards = el( 'div', 'SimpleBudgetCards' );
	panels.summary.appendChild( sCards );
	const sPartial = el( 'div', 'SimpleNotice SimpleBudgetPartial' );
	panels.summary.appendChild( sPartial );
	const sBody = el( 'div', 'SimpleBudgetSummaryBody' );
	panels.summary.appendChild( sBody );

	function card( label, value, key, warn = false ) {

		const node = el( 'div', 'SimpleBudgetCard' + ( warn ? ' warning' : '' ) );
		node.dataset.card = key;
		node.append( el( 'span', '', label ), el( 'strong', '', value ) );
		sCards.appendChild( node );

	}

	function renderSummary() {

		if ( state.report === null ) return;

		const report = state.report;
		const s = report.summary;

		sCards.textContent = '';
		card( t( 'budget/card/items' ), String( s.itemCount ), 'items' );
		card( t( 'budget/card/priced' ), `${s.pricedCount} (${s.pricedPercent.toLocaleString( 'pt-BR', { maximumFractionDigits: 1 } )}%)`, 'priced' );
		card( t( 'budget/card/unpriced' ), String( s.unpricedCount ), 'unpriced', s.unpricedCount > 0 );
		card( t( 'budget/card/problems' ), String( s.problemCount ), 'problems', s.problemCount > 0 );
		card( t( 'budget/card/direct' ), formatBRL( s.directCents ), 'direct' );
		card( t( 'budget/card/adjustments' ), formatBRL( s.adjustmentsCents ), 'adjustments' );
		card( s.partial ? t( 'budget/card/partial' ) : t( 'budget/card/total' ), formatBRL( s.totalCents ), 'total', s.partial );

		sPartial.hidden = s.partial === false;
		sPartial.textContent = s.partial ? t( 'budget/partial/total' ) : '';

		sBody.textContent = '';

		// por categoria
		sBody.appendChild( el( 'h3', 'SimpleBudgetSectionTitle', t( 'budget/summary/categories' ) ) );
		const catTable = el( 'table', 'SimpleBudgetTable SimpleBudgetCompact' );
		catTable.appendChild( tableHead( [[ 'c', 'budget/col/category' ], [ 'n', 'budget/col/items', 'num' ], [ 'p', 'budget/card/priced', 'num' ], [ 'u', 'budget/card/unpriced', 'num' ], [ 's', 'budget/col/subtotal', 'num' ]], false ) );
		const catBody = el( 'tbody' );
		for ( const row of report.categoryRows ) {

			const tr = el( 'tr' );
			tr.append( el( 'td', '', row.label ), el( 'td', 'num', String( row.count ) ), el( 'td', 'num', String( row.priced ) ), el( 'td', 'num', String( row.unpriced + row.problems ) ), el( 'td', 'num', formatBRL( row.subtotalCents ) ) );
			catBody.appendChild( tr );

		}

		if ( report.categoryRows.length === 0 ) {

			const tr = el( 'tr' );
			const td = el( 'td', '', t( 'budget/items/empty' ) );
			td.colSpan = 5;
			tr.appendChild( td );
			catBody.appendChild( tr );

		}

		catTable.appendChild( catBody );
		sBody.appendChild( catTable );

		// adicionais (base visível)
		sBody.appendChild( el( 'h3', 'SimpleBudgetSectionTitle', t( 'budget/summary/adjustments' ) ) );
		sBody.appendChild( el( 'p', 'SimpleBudgetHint', t( 'budget/adjustments/hint' ) ) );
		const adjList = el( 'div', 'SimpleBudgetAdjustments' );

		for ( const { adjustment, amountCents, baseCents } of report.adjustments ) {

			const row = el( 'div', 'SimpleBudgetAdjustment' );
			row.dataset.adjustment = adjustment.id;

			const labelInput = el( 'input', 'SimpleTextInput' );
			labelInput.value = adjustment.label;
			labelInput.maxLength = BUDGET_LIMITS.short;
			labelInput.dataset.focus = 'adj-label-' + adjustment.id;
			labelInput.setAttribute( 'aria-label', t( 'budget/adjustments/label' ) );
			stopKeys( labelInput );
			labelInput.addEventListener( 'change', () => updateAdjustment( adjustment.id, { label: labelInput.value } ) );

			const kind = el( 'select', 'SimpleSelect' );
			kind.append( option( 'percent', t( 'budget/adjustments/percent' ), adjustment.kind === 'percent' ), option( 'fixed', t( 'budget/adjustments/fixed' ), adjustment.kind === 'fixed' ) );
			kind.dataset.focus = 'adj-kind-' + adjustment.id;
			stopKeys( kind );
			kind.addEventListener( 'change', () => updateAdjustment( adjustment.id, { kind: kind.value, value: 0 } ) );

			const value = numberInput( adjustment.kind === 'percent' ? decimalText( adjustment.value, 4 ) : priceText( adjustment.value ), { key: 'adj-value-' + adjustment.id, label: t( 'budget/adjustments/value' ), onCommit: ( text, input ) => {

				const parsed = adjustment.kind === 'percent' ? parseNumber( text ) : parseMoney( text );
				if ( parsed === null || parsed < 0 || ( adjustment.kind === 'percent' && parsed > 1000 ) ) {

					context.notify( t( 'budget/invalid/adjustment' ), 'warning' );
					input.value = adjustment.kind === 'percent' ? decimalText( adjustment.value, 4 ) : priceText( adjustment.value );
					return;

				}

				updateAdjustment( adjustment.id, { value: parsed }, 'adj-' + adjustment.id );

			} } );

			const base = el( 'span', 'SimpleBudgetHint', adjustment.kind === 'percent' ? t( 'budget/adjustments/base', formatBRL( baseCents ) ) : t( 'budget/adjustments/fixedBase' ) );
			const amount = el( 'strong', 'SimpleBudgetAmount', formatBRL( amountCents ) );
			const remove = createSimpleButton( { icon: 'delete', title: t( 'budget/adjustments/delete' ), className: 'SimpleIconButton' } ).dom;
			remove.addEventListener( 'click', () => commit( ( budget ) => {

				budget.adjustments = budget.adjustments.filter( ( a ) => a.id !== adjustment.id );

			}, t( 'budget/command/adjustment' ) ) );

			row.append( labelInput, kind, value, base, amount, remove );
			adjList.appendChild( row );

		}

		sBody.appendChild( adjList );
		sBody.appendChild( createSimpleButton( { icon: 'new', label: t( 'budget/adjustments/add' ), className: 'SimpleBudgetAddAdjustment', onClick: () => commit( ( budget ) => {

			if ( budget.adjustments.length >= BUDGET_LIMITS.adjustments ) return false;
			budget.adjustments.push( sanitizeAdjustment( { id: newId( 'adj' ), label: t( 'budget/adjustments/default' ), kind: 'percent', value: 0 } ) );

		}, t( 'budget/command/adjustment' ) ) } ).dom );

		// referência e observações
		sBody.appendChild( el( 'h3', 'SimpleBudgetSectionTitle', t( 'budget/summary/reference' ) ) );
		const refDate = el( 'input', 'SimpleTextInput' );
		refDate.type = 'date';
		refDate.value = report.budget.referenceDate || '';
		refDate.dataset.focus = 'ref-date';
		stopKeys( refDate );
		refDate.addEventListener( 'change', () => commit( ( budget ) => {

			budget.referenceDate = refDate.value || null;

		}, t( 'budget/command/reference' ) ) );
		const refLabel = el( 'label', 'SimpleBudgetField' );
		refLabel.append( el( 'span', '', t( 'budget/summary/referenceDate' ) ), refDate );
		sBody.appendChild( refLabel );

		const notes = el( 'textarea', 'SimpleTextInput SimpleBudgetNotes' );
		notes.value = report.budget.notes;
		notes.maxLength = BUDGET_LIMITS.notes;
		notes.rows = 3;
		notes.dataset.focus = 'notes';
		notes.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		notes.addEventListener( 'change', () => commit( ( budget ) => {

			budget.notes = notes.value;

		}, t( 'budget/command/notes' ) ) );
		const notesLabel = el( 'label', 'SimpleBudgetField' );
		notesLabel.append( el( 'span', '', t( 'budget/summary/notes' ) ), notes );
		sBody.appendChild( notesLabel );

		// consolidação física (unidades diferentes não se somam)
		sBody.appendChild( el( 'h3', 'SimpleBudgetSectionTitle', t( 'budget/summary/quantities' ) ) );
		const qTable = el( 'table', 'SimpleBudgetTable SimpleBudgetCompact' );
		qTable.appendChild( tableHead( [[ 't', 'budget/col/type' ], [ 'c', 'budget/col/category' ], [ 'n', 'budget/col/components', 'num' ], [ 'q', 'budget/col/quantity', 'num' ]], false ) );
		const qBody = el( 'tbody' );
		for ( const row of report.quantitySummary ) {

			const tr = el( 'tr' );
			tr.append( el( 'td', '', `${row.label} — ${measurementLabel( row.measurement ).toLowerCase()}` ), el( 'td', '', row.categoryLabel ), el( 'td', 'num', String( row.count ) ), el( 'td', 'num', formatQuantity( row.total, row.unit, { withUnit: true } ) + ( row.unavailable > 0 ? ' *' : '' ) ) );
			qBody.appendChild( tr );

		}

		qTable.appendChild( qBody );
		sBody.appendChild( qTable );

	}

	function updateAdjustment( id, changes, attributeName = '' ) {

		commit( ( budget ) => {

			const index = budget.adjustments.findIndex( ( a ) => a.id === id );
			if ( index === - 1 ) return false;
			const next = sanitizeAdjustment( Object.assign( {}, budget.adjustments[ index ], changes ) );
			if ( next === null ) return false;
			budget.adjustments[ index ] = next;

		}, t( 'budget/command/adjustment' ), attributeName );

	}

	// exportação ---------------------------------------------------------------------------------------------------------

	function fileBase() {

		const title = ( editor.config.getKey( 'project/title' ) || 'projeto' ).trim().normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[\\/:*?"<>|]+/g, '' ).replace( /\s+/g, '-' ) || 'projeto';
		return title + '-orcamento';

	}

	function exportAs( format ) {

		try {

			const report = buildReportData( editor.scene, { projectTitle: editor.config.getKey( 'project/title' ) || '' } );
			let blob;

			if ( format === 'csv' ) blob = new Blob( [ toCSV( report ) ], { type: 'text/csv;charset=utf-8' } );
			else if ( format === 'xlsx' ) blob = toXLSX( report );
			else blob = toReportPDF( report );

			const name = fileBase() + '.' + format;
			editor.utils.save( blob, name );
			context.notify( report.summary.partial ? t( 'budget/export/donePartial', name ) : t( 'budget/export/done', name ), report.summary.partial ? 'warning' : 'success' );
			return { name, blob, report };

		} catch ( error ) {

			console.error( error );
			context.notify( t( 'budget/export/error' ), 'error' );
			return null;

		}

	}

	// abrir e fechar -------------------------------------------------------------------------------------------------------

	function open( tab ) {

		if ( state.open === false ) {

			context.interaction.deactivate();
			if ( context.planView !== undefined ) context.planView.close();
			if ( context.lightingPanel !== undefined ) context.lightingPanel.close();

			state.open = true;
			root.dom.hidden = false;
			document.body.classList.add( 'budget-open' );

		}

		setTab( tab || state.tab );
		render();

	}

	function close() {

		if ( state.open === false ) return;

		state.open = false;
		cancelAnimationFrame( state.frame );
		state.frame = 0;
		root.dom.hidden = true;
		document.body.classList.remove( 'budget-open' );
		changed.dispatch();

	}

	// atualização: só eventos confirmados (histórico, estrutura da cena, geometria, projeto novo/aberto)
	for ( const signal of [ 'historyChanged', 'sceneGraphChanged', 'geometryChanged' ] ) editor.signals[ signal ].add( schedule );
	editor.signals.editorCleared.add( () => {

		state.selectedRecord = null;
		state.selectedItem = null;
		schedule();

	} );

	document.addEventListener( 'keydown', ( event ) => {

		if ( state.open && event.key === 'Escape' && event.target.closest?.( 'input, textarea, select' ) === null ) {

			event.preventDefault();
			close();

		}

	} );

	setTab( 'quantities' );

	return { changed, state, open, close, toggle: () => ( state.open ? close() : open() ), isOpen: () => state.open, exportAs, render, setTab };

}

export { SimpleModeBudgetView };
