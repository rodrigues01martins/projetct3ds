// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Seção "Ficha técnica" no painel de propriedades do componente selecionado (resumo compacto, sem ocupar o viewport).
//   Com ficha: código, nome, revisão, material, dimensões nominais, peso, fabricante, situação, conferência
//   dimensional e aviso de revisão mais recente no catálogo local. Ações: abrir ficha completa, conferir dimensões,
//   trocar associação, remover associação, atualizar para a revisão mais recente (somente com confirmação).
//   Sem ficha: "Este componente ainda não possui ficha técnica associada." — associar ficha existente ou criar ficha
//   a partir do componente (só as dimensões, verificáveis na geometria, são preenchidas).

import { createSimpleButton } from './SimpleMode.Icons.js';
import { categoryName, validationName, formatWeight, nominalSummary } from './SimpleMode.TechnicalCatalogData.js';
import { describe, detach, logicalRoot, dimensionMessage, updateRevision } from './SimpleMode.TechnicalPartLinks.js';

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function button( label, onClick, className ) {

	return createSimpleButton( { label, title: label, className, onClick } ).dom;

}

function SimpleModeTechnicalPartProperties( editor, context, section, { catalog } ) {

	const body = section.body.dom;
	body.classList.add( 'SimpleTechnicalProperties' );
	let current = null;

	function render( object ) {

		body.textContent = '';
		const info = describe( editor, object, catalog );

		if ( info.link === null ) {

			body.appendChild( el( 'p', 'SimpleModelHint SimpleTechnicalEmpty', 'Este componente ainda não possui ficha técnica associada.' ) );
			const row = el( 'div', 'SimpleAssemblyRow' );
			row.append(
				button( 'Associar ficha existente', () => context.technical.panel.pickFor( [ object ] ), 'SimpleTechnicalAssociate' ),
				button( 'Criar ficha a partir do componente', () => context.technical.panel.newFromObject( object ), 'SimpleTechnicalCreate' )
			);
			body.appendChild( row );
			return;

		}

		if ( info.record === null ) {

			body.appendChild( el( 'p', 'SimpleTechnicalWarning', `Associado à ficha ${info.link.code} (revisão ${info.link.catalogRevision}), mas essa revisão não está no projeto nem no catálogo local.` ) );
			body.appendChild( button( 'Remover associação', () => detach( editor, [ object ] ), 'SimpleTechnicalDetach' ) );
			return;

		}

		const r = info.record;
		const facts = el( 'dl', 'SimpleModelFacts SimpleTechnicalFacts' );
		const add = ( label, value, missing = false ) => facts.append( el( 'dt', '', label ), el( 'dd', missing ? 'missing' : '', value ) );
		add( 'Código', r.code );
		add( 'Nome', r.name );
		add( 'Revisão', `${r.revision}${info.origin === 'project' ? ' (preservada no projeto)' : ''}` );
		add( 'Categoria', categoryName( r.category ) );
		add( 'Material', r.material.primary || 'Não informado', r.material.primary === '' );
		add( 'Dimensões nominais', nominalSummary( r ), nominalSummary( r ) === 'Não informado' );
		add( 'Peso unitário', formatWeight( r.physical.weight ), r.physical.weight === null );
		add( 'Fabricante', r.manufacturer.name || 'Não informado', r.manufacturer.name === '' );
		add( 'Situação', validationName( r.control.validation ) );
		body.appendChild( facts );

		const dims = info.dimensions;
		const status = el( 'p', 'SimpleTechnicalDims ' + dims.status, dimensionMessage( dims, r.dimensions.unit ) );
		body.appendChild( status );

		if ( info.outdated && info.latestRecord !== null ) {

			const notice = el( 'div', 'SimpleTechnicalOutdated' );
			notice.append( el( 'span', '', `Revisão ${info.latest} disponível no catálogo local (este componente usa a ${r.revision}).` ), button( 'Atualizar associação', () => confirmUpdate( object, info.latestRecord ), 'SimpleTechnicalUpdate' ) );
			body.appendChild( notice );

		} else if ( info.inCatalog === false && catalog.isLoaded() ) {

			body.appendChild( el( 'p', 'SimpleModelHint', 'Ficha não encontrada no catálogo local deste navegador: os dados exibidos vêm do snapshot do projeto.' ) );

		}

		const row = el( 'div', 'SimpleAssemblyRow' );
		row.append(
			button( 'Abrir ficha completa', () => context.technical.panel.viewRecord( r ), 'SimpleTechnicalOpen' ),
			button( 'Conferir dimensões', () => {

				render( object );
				context.notify( dimensionMessage( describe( editor, object, catalog ).dimensions, r.dimensions.unit ), dims.status === 'divergent' ? 'warning' : 'info' );

			}, 'SimpleTechnicalCheck' ),
			button( 'Trocar associação', () => context.technical.panel.pickFor( [ object ] ), 'SimpleTechnicalSwap' ),
			button( 'Remover associação', () => detach( editor, [ object ] ), 'SimpleTechnicalDetach' )
		);
		body.appendChild( row );

	}

	async function confirmUpdate( object, record ) {

		const choice = await context.dialog.ask( { title: `Atualizar para a revisão ${record.revision} de ${record.code}?`, message: 'A associação deste componente passará a usar a revisão mais recente do catálogo local. Você pode desfazer.', details: record.control.changedFields.length > 0 ? [ 'Alterações da revisão: ' + record.control.changedFields.join( ', ' ) ] : [], choices: [ { id: 'ok', label: 'Atualizar', kind: 'primary' }, { id: 'cancel', label: 'Manter' } ] } );
		if ( choice === 'ok' ) updateRevision( editor, [ object ], record );

	}

	// componente elegível: a raiz lógica (o painel mostra a ficha da peça selecionada)
	function update( object ) {

		if ( object === null || object === undefined || object.isLight || object.isCamera || object === editor.scene ) {

			current = null;
			return false;

		}

		const target = logicalRoot( object, editor.scene );
		if ( target !== object ) {

			current = null;
			return false;

		}

		const focused = document.activeElement !== null && body.contains( document.activeElement );
		if ( current !== object || focused === false ) render( object );
		current = object;
		return true;

	}

	catalog.changed.add( () => {

		if ( current !== null ) render( current );

	} );

	return { update };

}

export { SimpleModeTechnicalPartProperties };
