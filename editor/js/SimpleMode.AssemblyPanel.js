// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Interface da montagem modular: menu "Montagem" (um único botão na barra superior), painel lateral contextual
// (repetir em linha, criar matriz, configurar encaixes, montar com assistente, salvar na biblioteca modular),
// diálogo de exclusão de conjunto (excluir conteúdo OU desagrupar — ações diferentes) e a seção "Conjunto
// modular" do painel de propriedades. Todas as alterações passam pelo histórico nativo do editor.

import * as THREE from 'three';

import { CreateAssemblyCommand } from './commands/CreateAssemblyCommand.js';
import { UngroupAssemblyCommand } from './commands/UngroupAssemblyCommand.js';
import { SetAssemblyMembershipCommand } from './commands/SetAssemblyMembershipCommand.js';
import { AddAssemblyInstancesCommand } from './commands/AddAssemblyInstancesCommand.js';
import { SetAssemblyDataCommand } from './commands/SetAssemblyDataCommand.js';
import { RemoveObjectCommand } from './commands/RemoveObjectCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';
import { SetValueCommand } from './commands/SetValueCommand.js';

import { COMPONENTS } from './SimpleMode.Components.js';
import { createComponent } from './SimpleMode.ComponentFactory.js';
import { isHostedFixture } from './SimpleMode.Openings.js';
import {
	ASSEMBLY_CATEGORIES, ASSEMBLY_LIMITS, CONNECTOR_KINDS, isAssembly, getAssembly, assemblyAncestors, getConnectors,
	connectorsMeta, categoryName, cleanText, exactDecompose
} from './SimpleMode.AssemblyData.js';
import { AssemblyError, validateGrouping, validateUngroup, countComponents, localBounds } from './SimpleMode.AssemblyFactory.js';
import { derivedConnectors, explicitConnectors, toWorld, snapToConnector } from './SimpleMode.AssemblyConnectors.js';
import { AssemblyPreview } from './SimpleMode.AssemblyPreview.js';
import { lineOffsets, matrixOffsets, repeatCommand, maxInstances } from './SimpleMode.AssemblyRepeat.js';
import { SimpleNumberInput } from './SimpleMode.Inputs.js';
import { createIcon, createSimpleButton } from './SimpleMode.Icons.js';

const NORMALS = { '+x': [ 1, 0, 0 ], '-x': [ - 1, 0, 0 ], '+y': [ 0, 1, 0 ], '-y': [ 0, - 1, 0 ], '+z': [ 0, 0, 1 ], '-z': [ 0, 0, - 1 ] };
const NORMAL_LABELS = { '+x': 'Direita (+X)', '-x': 'Esquerda (−X)', '+y': 'Para cima (+Y)', '-y': 'Para baixo (−Y)', '+z': 'Frente (+Z)', '-z': 'Trás (−Z)' };
const KIND_LABELS = { center: 'Centro', face: 'Face', edge: 'Extremidade', point: 'Ponto' };

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function button( label, onClick, { icon, className = '', title } = {} ) {

	return createSimpleButton( { icon, label, title: title || label, className, onClick } ).dom;

}

function presetOf( vector ) {

	for ( const [ key, value ] of Object.entries( NORMALS ) ) if ( value.every( ( v, i ) => Math.abs( v - vector[ i ] ) < 1e-3 ) ) return key;
	return 'custom';

}

function SimpleModeAssemblyPanel( editor, context, root, { selection, snapping, preview, library } ) {

	const units = context.units;
	const dialog = context.dialog;
	const markers = new AssemblyPreview( editor, context.interaction ); // conectores visíveis (separado da prévia de encaixe)

	// menu -----------------------------------------------------------------------------------------------------------

	const ITEMS = [
		[ 'create', 'Criar conjunto', 'Agrupa os componentes selecionados/marcados', 'templates' ],
		[ 'edit', 'Editar conjunto', 'Selecionar componentes internos (duplo clique também)', 'edit' ],
		[ 'ungroup', 'Desagrupar', 'Devolve os componentes à cena, sem mover nada', 'distribute' ],
		[ 'add', 'Adicionar ao conjunto', 'Leva os objetos marcados para o conjunto em edição', 'add' ],
		[ 'remove', 'Remover do conjunto', 'Tira o componente selecionado do conjunto', 'delete' ],
		[ 'snap', 'Encaixar componente', 'Alinha o selecionado a outro pelos pontos de encaixe', 'snap' ],
		[ 'line', 'Repetir em linha', 'Cópias com espaçamento ou distância entre centros', 'alignStart' ],
		[ 'matrix', 'Criar matriz', 'Linhas × colunas (até 200 instâncias)', 'grid' ],
		[ 'connectors', 'Configurar encaixes', 'Pontos de encaixe do objeto selecionado', 'place' ],
		[ 'assistant', 'Montar com assistente', 'Inserção peça a peça por encaixe', 'next' ],
		[ 'save', 'Salvar na biblioteca modular', 'Torna o conjunto reutilizável', 'bookmark' ],
		[ 'catalog', 'Catálogo técnico', 'Fichas, códigos, revisões e compatibilidade (EV-015)', 'budget' ],
		[ 'check', 'Conferir montagem', 'Consistência cadastral e dimensional do conjunto', 'measure' ],
		[ 'bom', 'Gerar lista de peças', 'Quantidades e pesos conhecidos por código', 'templates' ]
	];

	const menu = el( 'div', 'SimpleMenu SimpleAssemblyMenu' );
	menu.setAttribute( 'role', 'menu' );
	menu.setAttribute( 'aria-label', 'Montagem modular' );
	menu.hidden = true;
	let menuButton = null;
	for ( const [ key, label, hint, icon ] of ITEMS ) {

		const item = el( 'button', 'SimpleAssemblyMenuItem' );
		item.type = 'button';
		item.dataset.item = key;
		item.setAttribute( 'role', 'menuitem' );
		item.tabIndex = - 1;
		item.appendChild( createIcon( icon ) );
		const text = el( 'span' );
		text.append( el( 'strong', '', label ), el( 'small', '', hint ) );
		item.appendChild( text );
		item.addEventListener( 'click', () => {

			closeMenu( false );
			run( key );

		} );
		menu.appendChild( item );

	}

	menu.addEventListener( 'keydown', ( event ) => {

		event.stopPropagation();
		const items = [ ...menu.querySelectorAll( '.SimpleAssemblyMenuItem' ) ];
		const index = items.indexOf( document.activeElement );
		if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {

			event.preventDefault();
			items[ ( index + ( event.key === 'ArrowDown' ? 1 : items.length - 1 ) ) % items.length ].focus();

		} else if ( event.key === 'Escape' || event.key === 'Tab' ) {

			event.preventDefault();
			closeMenu();

		}

	} );
	document.body.appendChild( menu );
	document.addEventListener( 'mousedown', ( event ) => {

		if ( menu.hidden === false && menu.contains( event.target ) === false && ( menuButton === null || menuButton.contains( event.target ) === false ) ) closeMenu( false );

	} );

	function openMenu( anchor ) {

		menuButton = anchor;
		const rect = anchor.getBoundingClientRect();
		menu.style.left = Math.max( 8, Math.min( rect.left, window.innerWidth - 310 ) ) + 'px';
		menu.style.top = ( rect.bottom + 6 ) + 'px';
		const selected = editor.selected;
		const editing = selection.getEditing();
		const state = {
			create: true,
			edit: isAssembly( selected ) || assemblyAncestors( selected, editor.scene ).length > 0,
			ungroup: isAssembly( selected ) || editing !== null,
			add: editing !== null,
			remove: selected !== null && selected.parent !== null && isAssembly( selected.parent ),
			snap: selected !== null,
			line: selected !== null, matrix: selected !== null, connectors: selected !== null, assistant: selected !== null,
			save: isAssembly( selected )
		};
		for ( const item of menu.querySelectorAll( '.SimpleAssemblyMenuItem' ) ) item.disabled = state[ item.dataset.item ] === false;
		menu.hidden = false;
		anchor.setAttribute( 'aria-expanded', 'true' );
		const first = menu.querySelector( '.SimpleAssemblyMenuItem:not(:disabled)' );
		if ( first ) first.focus();

	}

	function closeMenu( restore = true ) {

		if ( menu.hidden ) return;
		menu.hidden = true;
		if ( menuButton !== null ) {

			menuButton.setAttribute( 'aria-expanded', 'false' );
			if ( restore ) menuButton.focus();

		}

	}

	// ações ----------------------------------------------------------------------------------------------------------

	function notifyError( error ) {

		const details = error && Array.isArray( error.details ) && error.details.length > 0 ? ` (${error.details.slice( 0, 4 ).join( ', ' )})` : '';
		context.notify( ( error && error.message ? error.message : 'Operação não concluída.' ) + details, 'warning' );

	}

	function currentAssembly() {

		const selected = editor.selected;
		if ( isAssembly( selected ) ) return selected;
		return selection.getEditing();

	}

	async function createAssembly( objectsOverride = null ) {

		const objects = objectsOverride || context.alignment.getParticipants().all;
		try {

			validateGrouping( objects, editor.scene );

		} catch ( error ) {

			notifyError( error );
			return null;

		}

		const result = await dialog.ask( { title: 'Criar conjunto', message: `${objects.length} componente(s) serão agrupados. As posições, rotações, escalas, materiais e vínculos permanecem iguais.`, input: { label: 'Nome do conjunto', value: 'Conjunto', maxLength: ASSEMBLY_LIMITS.name }, choices: [ { id: 'ok', label: 'Criar conjunto', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( result === null || typeof result !== 'object' || result.choice !== 'ok' ) return null;
		const command = new CreateAssemblyCommand( editor, objects, { name: cleanText( result.value, ASSEMBLY_LIMITS.name ) || 'Conjunto' } );
		editor.execute( command );
		context.alignment.clear();
		context.notify( `Conjunto "${command.group.name}" criado com ${objects.length} componente(s).`, 'success' );
		return command.group;

	}

	function ungroup( group = currentAssembly() ) {

		if ( isAssembly( group ) === false ) return context.notify( 'Selecione um conjunto para desagrupar.', 'warning' );
		try {

			validateUngroup( group );

		} catch ( error ) {

			return notifyError( error );

		}

		if ( selection.getEditing() === group ) selection.exitEditing();
		editor.execute( new UngroupAssemblyCommand( editor, group ) );
		context.notify( `Conjunto "${group.name}" desagrupado; componentes preservados.`, 'success' );

	}

	function addToAssembly() {

		const group = selection.getEditing();
		if ( group === null ) return context.notify( 'Entre em "Editar conjunto" e marque os objetos a adicionar.', 'warning' );
		const objects = context.alignment.getParticipants().all.filter( ( o ) => o !== group && o.parent === editor.scene );
		if ( objects.length === 0 ) return context.notify( 'Marque na lista os objetos que entrarão no conjunto.', 'warning' );
		group.updateWorldMatrix( true, false );
		const blocked = objects.filter( ( o ) => exactDecompose( new THREE.Matrix4().copy( group.matrixWorld ).invert().multiply( o.matrixWorld ) ) === null );
		if ( blocked.length > 0 ) return notifyError( new AssemblyError( 'Não é possível adicionar sem deformar (escala não uniforme combinada com rotação).', blocked.map( ( o ) => o.name ) ) );
		const command = new MultiCmdsCommand( editor, objects.map( ( o ) => new SetAssemblyMembershipCommand( editor, o, group, undefined ) ) );
		command.name = `Adicionar ao conjunto: ${group.name}`;
		editor.execute( command );
		context.alignment.clear();
		context.notify( `${objects.length} objeto(s) adicionado(s) a "${group.name}".`, 'success' );

	}

	function removeFromAssembly( object = editor.selected ) {

		if ( object === null || object.parent === null || isAssembly( object.parent ) === false ) return context.notify( 'Selecione um componente dentro de um conjunto (Editar conjunto).', 'warning' );
		const group = object.parent;
		const target = group.parent;
		target.updateWorldMatrix( true, false );
		if ( exactDecompose( new THREE.Matrix4().copy( target.matrixWorld ).invert().multiply( object.matrixWorld ) ) === null ) return notifyError( new AssemblyError( 'Não é possível remover sem deformar o componente.' ) );
		editor.execute( new SetAssemblyMembershipCommand( editor, object, target, target.children.indexOf( group ) + 1, `Remover do conjunto: ${object.name}` ) );
		context.notify( `"${object.name}" removido de "${group.name}" (posição preservada).`, 'success' );

	}

	// excluir conjunto: duas ações explícitas e diferentes
	async function deleteAssembly( group ) {

		const choice = await dialog.ask( {
			title: 'Excluir conjunto',
			message: `O que fazer com "${group.name}" (${countComponents( group )} componente(s))?`,
			choices: [ { id: 'ungroup', label: 'Desagrupar, preservando os componentes', kind: 'primary' }, { id: 'delete', label: 'Excluir conjunto e conteúdo', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ]
		} );
		if ( choice === 'ungroup' ) ungroup( group );
		else if ( choice === 'delete' ) {

			if ( selection.getEditing() === group ) selection.exitEditing();
			editor.execute( new RemoveObjectCommand( editor, group ) );
			context.notify( `Conjunto "${group.name}" e seu conteúdo excluídos (Desfazer disponível).`, 'success' );

		}

	}

	window.addEventListener( 'keydown', ( event ) => {

		if ( event.key !== 'Delete' && event.key !== 'Backspace' ) return;
		if ( document.body.classList.contains( 'mode-simple' ) === false ) return;
		const target = event.target;
		if ( target !== null && ( target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test( target.tagName ) ) ) return;
		if ( isAssembly( editor.selected ) === false ) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		deleteAssembly( editor.selected );

	}, true );

	function run( key ) {

		const selected = editor.selected;
		switch ( key ) {

			case 'create': return createAssembly();
			case 'edit': {

				const group = isAssembly( selected ) ? selected : assemblyAncestors( selected, editor.scene ).pop();
				if ( group === undefined || group === null ) return context.notify( 'Selecione um conjunto para editar.', 'warning' );
				return selection.enterEditing( group );

			}

			case 'ungroup': return ungroup();
			case 'add': return addToAssembly();
			case 'remove': return removeFromAssembly();
			case 'snap':
				if ( selected !== null && isHostedFixture( selected ) ) return context.notify( 'Portas e janelas hospedadas são posicionadas pela parede (EV-007).', 'warning' );
				return snapping.start( selected );
			case 'line': return openSide( 'line' );
			case 'matrix': return openSide( 'matrix' );
			case 'connectors': return openSide( 'connectors' );
			case 'assistant': return openSide( 'assistant' );
			case 'save': return openSide( 'save' );
			case 'catalog': return context.technical !== undefined ? context.technical.panel.open( 'catalog' ) : null;
			case 'check':
			case 'bom': {

				if ( context.technical === undefined ) return null;
				const group = isAssembly( selected ) ? selected : ( selected !== null ? assemblyAncestors( selected, editor.scene )[ 0 ] : undefined );
				return key === 'check' ? context.technical.panel.check( group || null ) : context.technical.panel.showBOM( group || null );

			}

		}

	}

	// painel lateral -----------------------------------------------------------------------------------------------------

	const side = el( 'aside', 'SimpleAssemblyPanel' );
	side.id = 'simple-assembly-panel';
	side.hidden = true;
	side.setAttribute( 'aria-label', 'Montagem modular' );
	root.appendChild( side );
	side.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' && dialog.isOpen() === false ) {

			event.preventDefault();
			closeSide();

		}

		event.stopPropagation();

	} );

	const sideState = { mode: null, object: null, repeat: { axis: 'x', sign: 1, count: 5, mode: 'gap', value: 0.3, includeOriginal: true, group: false, rows: 4, columns: 5, modeX: 'gap', valueX: 0.3, modeZ: 'gap', valueZ: 0.3, angle: 0 }, assistant: null };

	function header( title ) {

		const head = el( 'div', 'SimpleAssemblyHeader' );
		head.append( el( 'h2', '', title ), button( 'Fechar', () => closeSide(), { icon: 'close', className: 'SimpleAssemblyClose' } ) );
		return head;

	}

	function field( label, input ) {

		const wrap = el( 'label', 'SimpleAssemblyField' );
		wrap.append( el( 'span', '', label ), input );
		return wrap;

	}

	function select( options, value, onChange, className = '' ) {

		const node = el( 'select', 'SimpleSelect ' + className );
		for ( const [ v, label ] of options ) {

			const option = el( 'option', '', label );
			option.value = v;
			node.appendChild( option );

		}

		node.value = value;
		node.addEventListener( 'change', () => onChange( node.value ) );
		return node;

	}

	function lengthInput( value, onCommit, key, label ) {

		const input = new SimpleNumberInput( { kind: 'length', units, label, min: 0, onCommit, onInvalid: () => context.notify( 'Valor inválido.', 'warning' ) } );
		input.dom.dataset.field = key;
		input.setValue( value );
		return input.dom;

	}

	function integerInput( value, onCommit, key, label, max ) {

		const input = el( 'input', 'SimpleInput' );
		input.type = 'number';
		input.min = '1';
		input.max = String( max );
		input.step = '1';
		input.value = String( value );
		input.dataset.field = key;
		input.setAttribute( 'aria-label', label );
		input.addEventListener( 'change', () => onCommit( parseInt( input.value, 10 ) ) );
		return input;

	}

	function openSide( mode, object = editor.selected ) {

		if ( object === null || object === undefined ) return context.notify( 'Selecione um objeto primeiro.', 'warning' );
		if ( ( mode === 'line' || mode === 'matrix' ) && isHostedFixture( object ) ) return context.notify( 'Portas e janelas hospedadas não são repetidas isoladamente.', 'warning' );
		if ( mode === 'save' && isAssembly( object ) === false ) return context.notify( 'Selecione um conjunto modular.', 'warning' );
		context.interaction.deactivate();
		sideState.mode = mode;
		sideState.object = object;
		if ( mode === 'assistant' ) sideState.assistant = { base: object, piece: 'panel', connector: null, candidate: null, result: null, inserted: [], useLast: true, group: true };
		side.hidden = false;
		document.body.classList.add( 'assembly-panel-open' );
		renderSide();

	}

	function closeSide() {

		sideState.mode = null;
		sideState.object = null;
		sideState.assistant = null;
		side.hidden = true;
		side.textContent = '';
		document.body.classList.remove( 'assembly-panel-open' );
		preview.clear();
		markers.clear();
		if ( context.interaction.isActive( 'assembly-pick-connector' ) ) context.interaction.deactivate();

	}

	function renderSide() {

		side.textContent = '';
		preview.clear();
		markers.clear();
		if ( sideState.object !== null && sideState.object.parent === null ) return closeSide();
		switch ( sideState.mode ) {

			case 'line': return renderLine();
			case 'matrix': return renderMatrix();
			case 'connectors': return renderConnectors();
			case 'assistant': return renderAssistant();
			case 'save': return renderSave();

		}

	}

	// repetição ----------------------------------------------------------------------------------------------------------

	function previewOffsets( object, offsets ) {

		object.parent.updateWorldMatrix( true, false );
		object.updateMatrix();
		for ( const offset of offsets ) {

			const local = new THREE.Matrix4().makeTranslation( offset.x, offset.y, offset.z ).multiply( object.matrix );
			preview.addBox( object, new THREE.Matrix4().multiplyMatrices( object.parent.matrixWorld, local ), true, false );

		}

		preview.render();

	}

	function renderLine() {

		const r = sideState.repeat;
		const object = sideState.object;
		side.appendChild( header( 'Repetir em linha' ) );
		const body = el( 'div', 'SimpleAssemblyBody' );
		body.appendChild( el( 'p', 'SimpleAssemblyHint', `Objeto: ${object.name || 'sem nome'}. As cópias mantêm a orientação do original.` ) );
		body.appendChild( field( 'Direção', select( [[ 'x', 'Eixo X' ], [ 'z', 'Eixo Z' ], [ 'y', 'Eixo Y (vertical)' ]], r.axis, ( v ) => {

			r.axis = v;
			renderSide();

		}, 'SimpleAssemblyAxis' ) ) );
		body.appendChild( field( 'Sentido', select( [[ '1', 'Positivo (+)' ], [ '-1', 'Negativo (−)' ]], String( r.sign ), ( v ) => {

			r.sign = Number( v );
			renderSide();

		} ) ) );
		body.appendChild( field( 'Quantidade total na linha', integerInput( r.count, ( v ) => {

			r.count = v;
			renderSide();

		}, 'count', 'Quantidade', ASSEMBLY_LIMITS.repeatInstances + 1 ) ) );
		body.appendChild( field( 'Medida usada', select( [[ 'gap', 'Espaçamento livre entre objetos' ], [ 'center', 'Distância entre centros' ]], r.mode, ( v ) => {

			r.mode = v;
			renderSide();

		}, 'SimpleAssemblyMode' ) ) );
		body.appendChild( field( r.mode === 'gap' ? `Espaçamento livre (${units.getUnit().label})` : `Distância entre centros (${units.getUnit().label})`, lengthInput( r.value, ( v ) => {

			r.value = v;
			renderSide();

		}, r.mode === 'gap' ? 'gap' : 'pitch', r.mode === 'gap' ? 'Espaçamento livre' : 'Distância entre centros' ) ) );
		body.appendChild( check( 'Incluir o objeto original na contagem', r.includeOriginal, ( v ) => {

			r.includeOriginal = v;
			renderSide();

		}, 'SimpleAssemblyIncludeOriginal' ) );
		body.appendChild( check( 'Criar conjunto com as cópias', r.group, ( v ) => {

			r.group = v;

		}, 'SimpleAssemblyGroupResult' ) );

		let layout = null;
		try {

			layout = lineOffsets( object, r );
			body.appendChild( el( 'p', 'SimpleAssemblyInfo SimpleAssemblyStep', `Passo entre centros: ${units.format( layout.step )} (largura no eixo ${units.format( layout.size )} ${r.mode === 'gap' ? `+ espaçamento ${units.format( r.value )}` : ''}) · ${layout.newCount} cópia(s) nova(s)` ) );
			previewOffsets( object, layout.offsets );

		} catch ( error ) {

			body.appendChild( el( 'p', 'SimpleAssemblyWarning', error.message ) );

		}

		side.appendChild( body );
		side.appendChild( actions( [
			button( 'Cancelar', () => closeSide(), { className: 'SimpleAssemblyCancel' } ),
			button( 'Confirmar', () => confirmRepeat( layout, 'linha' ), { className: 'active SimpleAssemblyConfirm' } )
		], layout === null ) );

	}

	function renderMatrix() {

		const r = sideState.repeat;
		const object = sideState.object;
		side.appendChild( header( 'Criar matriz' ) );
		const body = el( 'div', 'SimpleAssemblyBody' );
		body.appendChild( el( 'p', 'SimpleAssemblyHint', `Objeto: ${object.name || 'sem nome'} (primeira posição). Limites: ${ASSEMBLY_LIMITS.repeatRows} linhas × ${ASSEMBLY_LIMITS.repeatColumns} colunas, ${Math.min( ASSEMBLY_LIMITS.repeatInstances, maxInstances( object ) )} instâncias novas.` ) );
		body.appendChild( field( 'Linhas (eixo Z)', integerInput( r.rows, ( v ) => {

			r.rows = v;
			renderSide();

		}, 'rows', 'Linhas', ASSEMBLY_LIMITS.repeatRows ) ) );
		body.appendChild( field( 'Colunas (eixo X)', integerInput( r.columns, ( v ) => {

			r.columns = v;
			renderSide();

		}, 'columns', 'Colunas', ASSEMBLY_LIMITS.repeatColumns ) ) );
		for ( const axis of [ 'X', 'Z' ] ) {

			const modeKey = 'mode' + axis, valueKey = 'value' + axis;
			body.appendChild( field( `Medida em ${axis}`, select( [[ 'gap', 'Espaçamento livre' ], [ 'center', 'Distância entre centros' ]], r[ modeKey ], ( v ) => {

				r[ modeKey ] = v;
				renderSide();

			} ) ) );
			body.appendChild( field( `${r[ modeKey ] === 'gap' ? 'Espaçamento livre' : 'Distância entre centros'} em ${axis} (${units.getUnit().label})`, lengthInput( r[ valueKey ], ( v ) => {

				r[ valueKey ] = v;
				renderSide();

			}, valueKey, `Espaçamento em ${axis}` ) ) );

		}

		body.appendChild( field( 'Orientação do conjunto', select( [[ '0', '0°' ], [ '90', '90°' ], [ '180', '180°' ], [ '270', '270°' ]], String( r.angle ), ( v ) => {

			r.angle = Number( v );
			renderSide();

		} ) ) );
		body.appendChild( check( 'Agrupar resultado (com o original) em um conjunto', r.group, ( v ) => {

			r.group = v;

		}, 'SimpleAssemblyGroupResult' ) );

		let layout = null;
		try {

			layout = matrixOffsets( object, r );
			body.appendChild( el( 'p', 'SimpleAssemblyInfo', `${r.rows} × ${r.columns} = ${r.rows * r.columns} unidades (${layout.newCount} novas) · passo X ${units.format( layout.stepX )}, passo Z ${units.format( layout.stepZ )}` ) );
			previewOffsets( object, layout.offsets );

		} catch ( error ) {

			body.appendChild( el( 'p', 'SimpleAssemblyWarning', error.message ) );

		}

		side.appendChild( body );
		side.appendChild( actions( [
			button( 'Cancelar', () => closeSide(), { className: 'SimpleAssemblyCancel' } ),
			button( 'Confirmar', () => confirmRepeat( layout, 'matriz' ), { className: 'active SimpleAssemblyConfirm' } )
		], layout === null ) );

	}

	function confirmRepeat( layout, kind ) {

		if ( layout === null ) return;
		const object = sideState.object;
		const r = sideState.repeat;
		const includeOriginal = kind === 'matriz' ? true : r.includeOriginal;
		try {

			const group = r.group ? { name: `${object.name || 'Objeto'} — ${kind}`, category: 'others' } : null;
			const command = repeatCommand( editor, object, layout.offsets, { group, includeOriginal, name: kind === 'matriz' ? `Criar matriz: ${r.rows} × ${r.columns}` : `Repetir em linha: ${layout.offsets.length} cópia(s)` } );
			closeSide();
			editor.execute( command );
			context.notify( `${layout.offsets.length} cópia(s) criada(s) em uma única operação (Desfazer remove todas).`, 'success' );

		} catch ( error ) {

			notifyError( error );

		}

	}

	function check( label, value, onChange, className = '' ) {

		const row = el( 'label', 'SimpleCheckboxRow ' + className );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.checked = value;
		box.addEventListener( 'change', () => onChange( box.checked ) );
		row.append( box, el( 'span', '', label ) );
		return row;

	}

	function actions( buttons, disableConfirm = false ) {

		const row = el( 'div', 'SimpleAssemblyActions' );
		row.append( ...buttons );
		const confirm = row.querySelector( '.SimpleAssemblyConfirm' );
		if ( confirm ) confirm.disabled = disableConfirm;
		return row;

	}

	// conectores ---------------------------------------------------------------------------------------------------------

	function showMarkers( object ) {

		markers.clear();
		for ( const connector of explicitConnectors( object ) ) {

			const world = toWorld( object, connector );
			markers.addPoint( world.position, 'connector' );
			markers.addArrow( world.position, world.normal, 0.25, 0x8a4fff );

		}

		for ( const connector of derivedConnectors( object ) ) {

			if ( connector.kind === 'center' ) continue;
			markers.addPoint( toWorld( object, connector ).position, 'source', 0.015 );

		}

		markers.render();

	}

	function commitConnectors( object, items, name = 'Alterar pontos de encaixe' ) {

		editor.execute( new SetAssemblyDataCommand( editor, object, 'connectors', connectorsMeta( items ), name ) );
		renderSide();

	}

	function renderConnectors() {

		const object = sideState.object;
		side.appendChild( header( 'Configurar encaixes' ) );
		const body = el( 'div', 'SimpleAssemblyBody' );
		body.appendChild( el( 'p', 'SimpleAssemblyHint', `Objeto: ${object.name || 'sem nome'}. Pontos de encaixe são dados auxiliares de montagem (coordenadas locais do objeto): a geometria não é alterada.` ) );
		const items = getConnectors( object );
		const toolbar = el( 'div', 'SimpleAssemblyRow' );
		toolbar.append(
			button( 'Adicionar conector', () => {

				const base = derivedConnectors( object ).find( ( c ) => c.id === 'right' );
				const next = items.concat( [ Object.assign( {}, base || { position: [ 0, 0, 0 ], normal: [ 1, 0, 0 ], up: [ 0, 1, 0 ] }, { id: `c${Date.now().toString( 36 )}`, name: `Conector ${items.length + 1}`, kind: 'face', family: 'generic', role: 'neutral' } ) ] );
				commitConnectors( object, next, 'Adicionar ponto de encaixe' );

			}, { icon: 'add', className: 'SimpleConnectorAdd' } ),
			button( 'Selecionar ponto na geometria', () => startPick( object ), { icon: 'place', className: 'SimpleConnectorPick' } )
		);
		body.appendChild( toolbar );

		const list = el( 'div', 'SimpleConnectorList' );
		if ( items.length === 0 ) list.appendChild( el( 'p', 'SimpleAssemblyHint', 'Nenhum conector personalizado. O encaixe usa os pontos derivados da geometria (abaixo).' ) );
		items.forEach( ( connector, index ) => list.appendChild( connectorRow( object, items, connector, index ) ) );
		body.appendChild( list );

		const derived = el( 'details', 'SimpleConnectorDerived' );
		derived.appendChild( el( 'summary', '', 'Pontos derivados da geometria' ) );
		const dl = derivedConnectors( object );
		if ( dl.length > 0 && dl[ 0 ].approximate ) derived.appendChild( el( 'p', 'SimpleAssemblyWarning', 'Aproximados: calculados pela caixa envolvente. Não indicam pontos físicos de fixação do objeto.' ) );
		for ( const c of dl ) derived.appendChild( el( 'div', 'SimpleConnectorDerivedRow', `${c.name} · ${c.position.map( ( v ) => units.format( v ) ).join( ', ' )}` ) );
		body.appendChild( derived );
		side.appendChild( body );
		side.appendChild( actions( [ button( 'Concluir', () => closeSide(), { className: 'active SimpleAssemblyDone' } ) ] ) );
		showMarkers( object );

	}

	function connectorRow( object, items, connector, index ) {

		const row = el( 'div', 'SimpleConnectorRow' );
		row.dataset.connector = connector.id;
		const update = ( patch ) => {

			const next = items.map( ( c, i ) => i === index ? Object.assign( {}, c, patch ) : c );
			commitConnectors( object, next );

		};

		const name = el( 'input', 'SimpleInput SimpleConnectorName' );
		name.value = connector.name;
		name.maxLength = ASSEMBLY_LIMITS.connectorName;
		name.addEventListener( 'change', () => update( { name: name.value } ) );
		row.appendChild( field( 'Nome', name ) );
		row.appendChild( field( 'Tipo', select( CONNECTOR_KINDS.map( ( k ) => [ k, KIND_LABELS[ k ] ] ), connector.kind, ( v ) => update( { kind: v } ), 'SimpleConnectorKind' ) ) );
		const family = el( 'input', 'SimpleInput SimpleConnectorFamily' );
		family.value = connector.family;
		family.maxLength = ASSEMBLY_LIMITS.family;
		family.addEventListener( 'change', () => update( { family: family.value } ) );
		row.appendChild( field( 'Família', family ) );
		const coords = el( 'div', 'SimpleConnectorCoords' );
		[ 'x', 'y', 'z' ].forEach( ( axis, i ) => coords.appendChild( field( axis.toUpperCase(), lengthInput( connector.position[ i ], ( v ) => {

			const position = connector.position.slice();
			position[ i ] = v;
			update( { position } );

		}, `pos-${axis}`, `Posição ${axis.toUpperCase()}` ) ) ) );
		row.appendChild( coords );
		const normalKey = presetOf( connector.normal );
		row.appendChild( field( 'Orientação (normal)', select( Object.entries( NORMAL_LABELS ).concat( normalKey === 'custom' ? [[ 'custom', 'Personalizada' ]] : [] ), normalKey, ( v ) => {

			if ( NORMALS[ v ] ) update( { normal: NORMALS[ v ], up: Math.abs( NORMALS[ v ][ 1 ] ) > 0.5 ? [ 0, 0, 1 ] : [ 0, 1, 0 ] } );

		}, 'SimpleConnectorNormal' ) ) );
		row.appendChild( button( 'Excluir', () => commitConnectors( object, items.filter( ( c, i ) => i !== index ), 'Excluir ponto de encaixe' ), { icon: 'delete', className: 'danger SimpleConnectorDelete' } ) );
		return row;

	}

	// ferramenta de escolha de ponto na geometria
	const pick = { object: null };
	context.interaction.register( 'assembly-pick-connector', {

		activate( options ) {

			pick.object = options.object;
			preview.setLabel( 'Clique num ponto do objeto (Esc cancela)', null );

		},
		deactivate() {

			pick.object = null;
			preview.clear();

		},
		onMove( info ) {

			preview.clear();
			const hit = info.raycaster.intersectObject( pick.object, true )[ 0 ];
			if ( hit === undefined ) return;
			preview.addPoint( hit.point, 'target' );
			preview.setLabel( 'Novo ponto de encaixe aqui', hit.point );
			preview.render();

		},
		onClick( info ) {

			const object = pick.object;
			const hit = info.raycaster.intersectObject( object, true )[ 0 ];
			if ( hit === undefined ) return context.notify( 'Clique sobre o próprio objeto.', 'warning' );
			object.updateWorldMatrix( true, false );
			const inverse = new THREE.Matrix4().copy( object.matrixWorld ).invert();
			const local = hit.point.clone().applyMatrix4( inverse );
			let normal = new THREE.Vector3( 0, 1, 0 );
			if ( hit.face ) normal = hit.face.normal.clone().transformDirection( hit.object.matrixWorld ).transformDirection( inverse );
			context.interaction.deactivate();
			const items = getConnectors( object );
			commitConnectors( object, items.concat( [ { id: `c${Date.now().toString( 36 )}`, name: `Conector ${items.length + 1}`, kind: 'point', position: local.toArray(), normal: normal.toArray(), up: Math.abs( normal.y ) > 0.9 ? [ 0, 0, 1 ] : [ 0, 1, 0 ], family: 'generic' } ] ), 'Adicionar ponto de encaixe' );

		}

	} );

	function startPick( object ) {

		context.interaction.activate( 'assembly-pick-connector', { object } );

	}

	// assistente ---------------------------------------------------------------------------------------------------------

	const PIECES = COMPONENTS.filter( ( c ) => c.id !== 'door' && c.id !== 'window' );

	function renderAssistant() {

		const a = sideState.assistant;
		side.appendChild( header( 'Montar com assistente' ) );
		const body = el( 'div', 'SimpleAssemblyBody' );
		body.appendChild( el( 'p', 'SimpleAssemblyHint', 'Ordem de inserção DIGITAL das peças (não é instrução de montagem física nem de segurança).' ) );
		body.appendChild( el( 'p', 'SimpleAssemblyStepTitle', `1. Base: ${a.base.name || 'objeto'}` ) );
		body.appendChild( field( '2. Nova peça', select( PIECES.map( ( c ) => [ c.id, c.name ] ), a.piece, ( v ) => {

			a.piece = v;
			a.candidate = null;
			renderSide();

		}, 'SimpleAssistantPiece' ) ) );

		const connectors = explicitConnectors( a.base ).concat( derivedConnectors( a.base ) ).filter( ( c ) => c.kind !== 'center' );
		if ( a.connector === null || connectors.some( ( c ) => c.id === a.connector ) === false ) a.connector = ( connectors.find( ( c ) => c.id === 'right' ) || connectors[ 0 ] || {} ).id || null;
		body.appendChild( field( '3. Ponto de encaixe na base', select( connectors.map( ( c ) => [ c.id, c.name + ( c.approximate ? ' (aproximado)' : '' ) ] ), a.connector, ( v ) => {

			a.connector = v;
			renderSide();

		}, 'SimpleAssistantConnector' ) ) );

		if ( a.candidate === null || a.candidate.userData.project3ds.component.id !== a.piece ) a.candidate = createComponent( a.piece );
		const target = connectors.find( ( c ) => c.id === a.connector );
		a.result = target !== undefined ? snapToConnector( a.candidate, a.base, target ) : null;
		if ( a.result !== null ) {

			preview.addBox( a.candidate, a.result.matrix, true, true );
			preview.addPoint( a.result.to.position, 'target' );
			body.appendChild( el( 'p', 'SimpleAssemblyInfo', `4. Prévia: ${a.result.moving.name} da nova peça → ${target.name} da base.` ) );
			preview.render();

		} else {

			body.appendChild( el( 'p', 'SimpleAssemblyWarning', 'Nenhum encaixe compatível para esta peça neste ponto. Escolha outro ponto ou outra peça.' ) );

		}

		body.appendChild( check( 'Usar a última peça inserida como nova base', a.useLast, ( v ) => {

			a.useLast = v;

		} ) );
		body.appendChild( check( 'Ao concluir, agrupar base e peças em um conjunto', a.group, ( v ) => {

			a.group = v;

		} ) );
		if ( a.inserted.length > 0 ) body.appendChild( el( 'p', 'SimpleAssemblyInfo', `Peças inseridas: ${a.inserted.map( ( o, i ) => `${i + 1}. ${o.name}` ).join( ' · ' )}` ) );
		side.appendChild( body );
		side.appendChild( actions( [
			button( 'Concluir montagem', () => finishAssistant(), { className: 'SimpleAssistantFinish' } ),
			button( '5. Inserir peça', () => insertPiece(), { className: 'active SimpleAssemblyConfirm SimpleAssistantInsert' } )
		], a.result === null ) );

	}

	function insertPiece() {

		const a = sideState.assistant;
		if ( a.result === null ) return;
		const piece = a.candidate;
		const parent = a.base.parent;
		parent.updateWorldMatrix( true, false );
		const local = exactDecompose( new THREE.Matrix4().copy( parent.matrixWorld ).invert().multiply( a.result.matrix ) );
		if ( local === null ) return context.notify( 'Encaixe não representável sem deformar a peça.', 'warning' );
		piece.position.copy( local.position );
		piece.quaternion.copy( local.quaternion );
		piece.scale.copy( local.scale );
		piece.name = `${PIECES.find( ( c ) => c.id === a.piece ).name} ${String( a.inserted.length + 1 ).padStart( 2, '0' )}`;
		editor.execute( new AddAssemblyInstancesCommand( editor, [ piece ], { parent, name: `Assistente: inserir ${piece.name}` } ) );
		a.inserted.push( piece );
		if ( a.useLast ) a.base = piece;
		a.candidate = null;
		renderSide();

	}

	function finishAssistant() {

		const a = sideState.assistant;
		const objects = [ sideState.object, ...a.inserted ];
		closeSide();
		if ( a.group && a.inserted.length > 0 && objects.every( ( o ) => o.parent === objects[ 0 ].parent ) ) {

			try {

				validateGrouping( objects, editor.scene );
				editor.execute( new CreateAssemblyCommand( editor, objects, { name: 'Montagem' } ) );
				context.notify( `Montagem concluída: conjunto com ${objects.length} peça(s).`, 'success' );

			} catch ( error ) {

				notifyError( error );

			}

		} else {

			context.notify( `Montagem concluída: ${a.inserted.length} peça(s) inserida(s).`, 'success' );

		}

	}

	// salvar na biblioteca modular -----------------------------------------------------------------------------------------

	function renderSave() {

		const group = sideState.object;
		const meta = getAssembly( group );
		side.appendChild( header( 'Salvar na biblioteca modular' ) );
		const body = el( 'div', 'SimpleAssemblyBody' );
		const name = el( 'input', 'SimpleInput SimpleAssemblySaveName' );
		name.value = group.name || meta.name;
		name.maxLength = ASSEMBLY_LIMITS.name;
		body.appendChild( field( 'Nome', name ) );
		const category = select( ASSEMBLY_CATEGORIES.map( ( c ) => [ c.id, c.name ] ), meta.category || 'others', () => {}, 'SimpleAssemblySaveCategory' );
		body.appendChild( field( 'Categoria', category ) );
		const keywords = el( 'input', 'SimpleInput SimpleAssemblySaveKeywords' );
		keywords.placeholder = 'Ex.: feira, balcão';
		body.appendChild( field( 'Palavras-chave', keywords ) );
		const size = localBounds( group ).getSize( new THREE.Vector3() );
		body.appendChild( el( 'p', 'SimpleAssemblyInfo', `Dimensões: ${units.format( size.x )} × ${units.format( size.y )} × ${units.format( size.z )} (L × A × P) · ${countComponents( group )} componente(s)` ) );
		body.appendChild( el( 'p', 'SimpleAssemblyHint', 'O registro salvo é independente do projeto: alterar o conjunto depois não muda a biblioteca. Modelos importados que estão na biblioteca de modelos entram como referência (sem duplicar o arquivo); os demais são incorporados.' ) );
		side.appendChild( body );
		side.appendChild( actions( [
			button( 'Cancelar', () => closeSide(), { className: 'SimpleAssemblyCancel' } ),
			button( 'Salvar', async () => {

				try {

					const { record } = await library.save( group, { name: name.value, category: category.value, keywords: keywords.value.split( ',' ) } );
					closeSide();
					context.notify( `Conjunto "${record.name}" salvo na biblioteca modular.`, 'success' );
					if ( context.showAssemblies ) context.showAssemblies();

				} catch ( error ) {

					notifyError( error );

				}

			}, { className: 'active SimpleAssemblyConfirm' } )
		] ) );

	}

	editor.signals.sceneGraphChanged.add( () => {

		if ( sideState.mode !== null && sideState.object !== null && sideState.object.parent === null ) closeSide();

	} );
	editor.signals.editorCleared.add( () => closeSide() );

	return { openMenu, closeMenu, run, createAssembly, ungroup, deleteAssembly, addToAssembly, removeFromAssembly, openSide, closeSide, getSideState: () => ( { mode: sideState.mode } ) };

}

// seção "Conjunto modular" das propriedades ---------------------------------------------------------------------------

function SimpleModeAssemblyProperties( editor, context, section ) {

	const body = section.body.dom;
	let current = null;

	function render( group ) {

		body.textContent = '';
		const meta = getAssembly( group );
		const units = context.units;
		const size = localBounds( group ).getSize( new THREE.Vector3() );
		const facts = el( 'dl', 'SimpleModelFacts SimpleAssemblyFacts' );
		const add = ( label, value ) => facts.append( el( 'dt', '', label ), el( 'dd', '', value ) );
		add( 'Tipo', 'Conjunto modular' );
		add( 'Componentes', String( countComponents( group ) ) );
		add( 'Dimensões', `${units.format( size.x )} × ${units.format( size.y )} × ${units.format( size.z )}` );
		const explicit = getConnectors( group ).length;
		add( 'Conectores', explicit > 0 ? `${explicit} personalizado(s) + derivados da geometria` : 'derivados da geometria (aproximados)' );
		if ( meta.definitionId ) add( 'Origem', 'biblioteca modular' );
		body.appendChild( facts );

		const category = el( 'select', 'SimpleSelect SimpleAssemblyCategory' );
		for ( const c of ASSEMBLY_CATEGORIES ) {

			const option = el( 'option', '', c.name );
			option.value = c.id;
			category.appendChild( option );

		}

		category.value = meta.category;
		category.addEventListener( 'change', () => editor.execute( new SetAssemblyDataCommand( editor, group, 'assembly', Object.assign( {}, getAssembly( group ), { category: category.value } ), 'Categoria do conjunto' ) ) );
		const label = el( 'label', 'SimpleAssemblyField' );
		label.append( el( 'span', '', 'Categoria' ), category );
		body.appendChild( label );

		const row = el( 'div', 'SimpleAssemblyRow' );
		const editing = context.assemblySelection.isEditing( group );
		row.append(
			button( editing ? 'Concluir edição' : 'Editar conjunto', () => ( editing ? context.assemblySelection.exitEditing() : context.assemblySelection.enterEditing( group ) ), { icon: 'edit', className: 'SimpleAssemblyEdit' } ),
			button( 'Desagrupar', () => context.assemblyPanel.ungroup( group ), { icon: 'distribute', className: 'SimpleAssemblyUngroup' } ),
			button( 'Salvar na biblioteca', () => context.assemblyPanel.openSide( 'save', group ), { icon: 'bookmark', className: 'SimpleAssemblySave' } ),
			button( 'Encaixes', () => context.assemblyPanel.openSide( 'connectors', group ), { icon: 'place', className: 'SimpleAssemblyConnectors' } )
		);
		body.appendChild( row );
		body.appendChild( el( 'p', 'SimpleModelHint', `Categoria: ${categoryName( meta.category )}. Duplo clique no conjunto para editar os componentes internos.` ) );

	}

	function update( object ) {

		if ( object === null || isAssembly( object ) === false ) {

			current = null;
			return false;

		}

		const focused = document.activeElement !== null && body.contains( document.activeElement );
		if ( current !== object || focused === false ) render( object );
		current = object;
		return true;

	}

	// nome do conjunto: o nome do objeto é a fonte; os metadados acompanham (um Desfazer)
	function rename( group, name ) {

		const clean = cleanText( name, ASSEMBLY_LIMITS.name ) || 'Conjunto';
		const command = new MultiCmdsCommand( editor, [ new SetValueCommand( editor, group, 'name', clean ), new SetAssemblyDataCommand( editor, group, 'assembly', Object.assign( {}, getAssembly( group ), { name: clean } ), 'Renomear conjunto' ) ] );
		command.name = 'Renomear conjunto';
		editor.execute( command );

	}

	return { update, rename };

}

export { SimpleModeAssemblyPanel, SimpleModeAssemblyProperties };
