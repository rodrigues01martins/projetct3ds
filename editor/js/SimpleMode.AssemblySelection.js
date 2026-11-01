// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Seleção hierárquica consciente do contexto (SOMENTE no Modo Simples; o Modo Avançado continua peça por peça):
//   - fora do modo de edição, clicar em qualquer peça de um conjunto seleciona o conjunto mais externo;
//   - "Editar conjunto" (duplo clique sobre o conjunto, botão ou a lista de objetos) entra no conjunto: clicar seleciona
//     o componente interno (ou o subconjunto como unidade); portas/janelas hospedadas continuam selecionáveis e com
//     as restrições da EV-007;
//   - clicar fora do conjunto em edição, Esc ou "Concluir edição" sai do modo de edição.
// A resolução é encadeada à existente (EV-003/EV-004/EV-007): nenhuma regra anterior é substituída.

import * as THREE from 'three';

import { findHostedFixture } from './SimpleMode.Openings.js';
import { isAssembly, assemblyAncestors } from './SimpleMode.AssemblyData.js';

function AssemblySelection( editor, context, isSimple ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef
	const changed = new Signal();
	const state = { editing: null };
	const previous = editor.selector.resolveSelection;

	function contains( ancestor, object ) {

		let current = object;
		while ( current !== null && current !== undefined ) {

			if ( current === ancestor ) return true;
			current = current.parent;

		}

		return false;

	}

	// resolução dentro do conjunto em edição: subconjunto como unidade, porta/janela hospedada, componente
	function resolveInside( object, scope ) {

		const hosted = findHostedFixture( object, editor.scene );
		if ( hosted !== null && contains( scope, hosted ) ) return hosted;

		// primeiro nível abaixo do escopo no caminho até o objeto
		let current = object, child = null;
		while ( current !== null && current !== scope ) {

			child = current;
			current = current.parent;

		}

		if ( child === null ) return scope;
		if ( isAssembly( child ) ) return child; // subconjunto: entra-se nele com outro "Editar conjunto"
		return child;

	}

	function resolve( object ) {

		if ( isSimple() === false || object === null || object === undefined ) return previous !== null ? previous( object ) : object;

		if ( state.editing !== null ) {

			if ( state.editing.parent === null || contains( editor.scene, state.editing ) === false ) setEditing( null );
			else if ( contains( state.editing, object ) && object !== state.editing ) return resolveInside( object, state.editing );
			else if ( object !== state.editing ) setEditing( null ); // clicou fora: sai da edição

		}

		const chain = assemblyAncestors( object, editor.scene );
		if ( chain.length > 0 ) return chain[ 0 ];
		return previous !== null ? previous( object ) : object;

	}

	editor.selector.resolveSelection = resolve;

	// aviso do modo de edição
	const viewport = document.getElementById( 'viewport' );
	const banner = document.createElement( 'div' );
	banner.className = 'SimpleAssemblyEditBanner';
	banner.hidden = true;
	banner.setAttribute( 'role', 'status' );
	const bannerText = document.createElement( 'span' );
	const done = document.createElement( 'button' );
	done.type = 'button';
	done.className = 'SimpleButton active SimpleAssemblyEditDone';
	done.textContent = 'Concluir edição';
	done.addEventListener( 'click', () => exitEditing() );
	banner.append( bannerText, done );
	if ( viewport !== null ) viewport.appendChild( banner );

	function setEditing( group ) {

		if ( state.editing === group ) return;
		state.editing = group;
		banner.hidden = group === null;
		if ( group !== null ) bannerText.textContent = `Editando o conjunto "${group.name || 'Conjunto'}": clique para selecionar componentes internos.`;
		changed.dispatch( group );

	}

	function enterEditing( group, select = null ) {

		if ( isAssembly( group ) === false ) return;
		setEditing( group );
		editor.selected = null; // força nova resolução dentro do conjunto
		editor.select( select !== null ? select : group );

	}

	function exitEditing() {

		const group = state.editing;
		if ( group === null ) return;
		setEditing( null );
		editor.selected = null;
		editor.select( group.parent !== null ? group : null );

	}

	// duplo clique sobre um conjunto entra no modo de edição (com a peça apontada já selecionada)
	const raycaster = new THREE.Raycaster();
	if ( viewport !== null ) viewport.addEventListener( 'dblclick', ( event ) => {

		if ( isSimple() === false || context.interaction.getActive() !== null ) return;
		const rect = viewport.getBoundingClientRect();
		const ndc = new THREE.Vector2( ( ( event.clientX - rect.left ) / rect.width ) * 2 - 1, - ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1 );
		raycaster.setFromCamera( ndc, editor.viewportCamera );
		const hit = raycaster.intersectObjects( editor.scene.children, true ).find( ( h ) => h.object.visible );
		if ( hit === undefined ) return;
		const chain = assemblyAncestors( hit.object, editor.scene );
		const scope = state.editing !== null && contains( state.editing, hit.object ) ? chain[ chain.indexOf( state.editing ) + 1 ] : chain[ 0 ];
		if ( scope === undefined ) return;
		setEditing( scope );
		editor.selected = null;
		editor.select( hit.object );

	} );

	document.addEventListener( 'keydown', ( event ) => {

		if ( event.key !== 'Escape' || state.editing === null || context.interaction.getActive() !== null ) return;
		const target = event.target;
		if ( target && target.closest && target.closest( 'input, textarea, select, .SimpleDialog, #simple-assembly-panel' ) ) return;
		exitEditing();

	} );

	editor.signals.editorCleared.add( () => setEditing( null ) );
	editor.signals.sceneGraphChanged.add( () => {

		if ( state.editing !== null && contains( editor.scene, state.editing ) === false ) setEditing( null );

	} );

	return { changed, resolve, enterEditing, exitEditing, getEditing: () => state.editing, isEditing: ( group ) => state.editing === group };

}

export { AssemblySelection };
