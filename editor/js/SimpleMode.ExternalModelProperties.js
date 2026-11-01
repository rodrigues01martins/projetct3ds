// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Seção "Modelo importado" do painel de propriedades: identificação (modelo importado, arquivo de origem, formato,
// categoria, situação na biblioteca, correções de importação) e edição SEGURA dos materiais da instância
// selecionada (cor, rugosidade, metalicidade, opacidade) pelos comandos existentes (Desfazer/Refazer).
// Cada instância tem cópias próprias dos materiais (SimpleMode.ExternalModelInstances): editar uma cadeira não
// altera as outras e nenhuma textura é descartada. Os acabamentos predefinidos da EV-004 não se aplicam aqui
// (eles não reconstroem materiais glTF arbitrários).

import { SetMaterialColorCommand } from './commands/SetMaterialColorCommand.js';
import { SetMaterialValueCommand } from './commands/SetMaterialValueCommand.js';

import { getImportedAsset } from './SimpleMode.ExternalModelInstances.js';
import { categoryName } from './SimpleMode.ExternalModelStorage.js';
import { UPRIGHT } from './SimpleMode.ExternalModelTransforms.js';

const MAX_MATERIALS = 24;

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function SimpleModeExternalModelProperties( editor, context, library, section ) {

	const body = section.body.dom;
	let current = null;

	// materiais da instância: [ { material, mesh, slot } ] (um por material, na ordem da hierarquia)
	function materialsOf( root ) {

		const list = [], seen = new Set();
		root.traverse( ( object ) => {

			if ( object.isMesh !== true ) return;
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			materials.forEach( ( material, slot ) => {

				if ( material === undefined || seen.has( material ) ) return;
				seen.add( material );
				list.push( { material, mesh: object, slot: Array.isArray( object.material ) ? slot : - 1 } );

			} );

		} );
		return list;

	}

	function render( object ) {

		body.textContent = '';
		const asset = getImportedAsset( object );
		const facts = el( 'dl', 'SimpleModelFacts' );
		const add = ( label, value ) => facts.append( el( 'dt', '', label ), el( 'dd', '', value ) );
		add( 'Tipo', 'Modelo importado' );
		add( 'Arquivo de origem', asset.originalName || '—' );
		add( 'Formato', String( asset.sourceFormat || '' ).toUpperCase() );
		add( 'Categoria', categoryName( asset.category ) );
		const record = library.isLoaded() ? library.getRecord( asset.assetId ) : null;
		add( 'Biblioteca', record !== null ? `disponível ("${record.name}")` : 'não está na biblioteca deste navegador (o projeto guarda a própria cópia)' );
		const t = asset.transforms || {};
		const corrections = [];
		if ( t.rotationY ) corrections.push( `giro de ${t.rotationY}° em Y` );
		if ( t.upright && t.upright !== 'none' && UPRIGHT[ t.upright ] ) corrections.push( UPRIGHT[ t.upright ].label.toLowerCase() );
		corrections.push( t.baseNormalized ? 'base ajustada (Y = 0)' : 'pivô original' );
		add( 'Correções de importação', corrections.join( ', ' ) );
		if ( Array.isArray( asset.originalDimensions ) ) add( 'Dimensões originais', asset.originalDimensions.map( ( v ) => context.units.format( v ) ).join( ' × ' ) );
		body.appendChild( facts );
		if ( record !== null && record.license && ( record.license.license || record.license.author ) ) body.appendChild( el( 'p', 'SimpleModelHint', `Licença registrada: ${[ record.license.license, record.license.author ].filter( Boolean ).join( ' — ' )}. Confira as condições antes de redistribuir.` ) );

		const materials = materialsOf( object );
		body.appendChild( el( 'div', 'SimpleSubLabel', `Materiais desta instância (${materials.length})` ) );
		body.appendChild( el( 'p', 'SimpleModelHint', 'As alterações valem só para o objeto selecionado; texturas são preservadas.' ) );

		for ( const entry of materials.slice( 0, MAX_MATERIALS ) ) body.appendChild( materialRow( object, entry ) );
		if ( materials.length > MAX_MATERIALS ) body.appendChild( el( 'p', 'SimpleModelHint', `Mais ${materials.length - MAX_MATERIALS} material(is) editável(is) pelo Modo Avançado.` ) );

	}

	function materialRow( root, { material, mesh, slot } ) {

		const row = el( 'div', 'SimpleModelMaterial' );
		row.dataset.material = material.uuid;
		const name = material.name || 'Material';
		row.appendChild( el( 'div', 'SimpleModelMaterialName', name + ( material.map ? ' (com textura)' : '' ) ) );

		const controls = el( 'div', 'SimpleModelMaterialControls' );
		if ( material.color !== undefined ) {

			const color = el( 'input', 'SimpleModelMaterialColor' );
			color.type = 'color';
			color.value = '#' + material.color.getHexString();
			color.title = material.map ? 'Cor (multiplica a textura)' : 'Cor';
			color.setAttribute( 'aria-label', `Cor de ${name}` );
			color.addEventListener( 'change', () => {

				editor.execute( new SetMaterialColorCommand( editor, mesh, 'color', parseInt( color.value.slice( 1 ), 16 ), slot ) );

			} );
			controls.appendChild( color );

		}

		for ( const [ key, label ] of [[ 'roughness', 'Rugosidade' ], [ 'metalness', 'Metalicidade' ], [ 'opacity', 'Opacidade' ]] ) {

			if ( typeof material[ key ] !== 'number' ) continue;
			const range = el( 'input', 'SimpleModelMaterialRange' );
			range.type = 'range';
			range.min = '0';
			range.max = '1';
			range.step = '0.01';
			range.value = String( material[ key ] );
			range.dataset.key = key;
			range.title = label;
			range.setAttribute( 'aria-label', `${label} de ${name}` );
			range.addEventListener( 'change', () => {

				const value = Math.min( Math.max( parseFloat( range.value ), 0 ), 1 );
				if ( key === 'opacity' && value < 1 && material.transparent !== true ) editor.execute( new SetMaterialValueCommand( editor, mesh, 'transparent', true, slot ) );
				editor.execute( new SetMaterialValueCommand( editor, mesh, key, value, slot ) );

			} );
			range.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
			const field = el( 'label', 'SimpleModelMaterialField' );
			field.append( el( 'span', '', label ), range );
			controls.appendChild( field );

		}

		row.appendChild( controls );
		void root;
		return row;

	}

	// devolve true quando o objeto é um modelo importado (a seção aparece)
	function update( object ) {

		if ( object === null || getImportedAsset( object ) === null ) {

			current = null;
			return false;

		}

		const focused = document.activeElement !== null && body.contains( document.activeElement );
		if ( current !== object || focused === false ) render( object );
		current = object;
		return true;

	}

	return { update };

}

export { SimpleModeExternalModelProperties };
