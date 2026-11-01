// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Lista de peças por conjunto e do projeto inteiro.
//   - percorre a hierarquia; a raiz de um conjunto NÃO é peça (seus componentes são, uma vez cada), inclusive em
//     conjuntos aninhados; malhas internas de um componente não são peças; portas/janelas hospedadas contam uma vez
//     (como peças próprias, fora da parede);
//   - consolida instâncias com o mesmo catalogId + revisão; instâncias do mesmo código com dimensões efetivas
//     diferentes ficam em linhas separadas e sinalizadas (nunca somadas como se fossem iguais);
//   - peso: Peso_total_item = Quantidade × Peso_unitário, apenas com pesos INFORMADOS. Se faltar algum, o resultado é
//     "peso conhecido parcial" — nunca apresentado como peso total completo. Peso embalado é somado à parte.
//   - informações técnicas próprias de um conjunto não são somadas às de suas peças (sem dupla contagem).

import { isAssembly } from './SimpleMode.AssemblyData.js';
import { getComponentData, isUserComponent, isImportedModelRoot } from './SimpleMode.ComponentFactory.js';
import { isHostedFixture } from './SimpleMode.Openings.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';
import { labelOf } from './SimpleMode.ShareExport.js';
import { getTechnicalLink, getSnapshot, categoryName, nominalSummary, pendingFields } from './SimpleMode.TechnicalCatalogData.js';
import { describe, geometricSize } from './SimpleMode.TechnicalPartLinks.js';

// unidades (peças) sob uma raiz (cena ou conjunto)
function collectParts( root ) {

	const parts = [];
	const assemblies = [];

	( function walk( node, path, insideUnit ) {

		for ( const child of node.children ) {

			if ( isLightingGroup( child ) || child.isLight || child.isCamera ) continue;

			if ( insideUnit === false && isAssembly( child ) ) {

				const next = path.concat( [ child ] );
				assemblies.push( { object: child, path: next } );
				walk( child, next, false );
				continue;

			}

			let unit = false;
			if ( isHostedFixture( child ) ) unit = true;
			else if ( insideUnit === false && ( getComponentData( child ) !== null || isUserComponent( child ) || isImportedModelRoot( child ) ) ) unit = true;
			else if ( insideUnit === false && ( child.isMesh || child.isGroup || child.type === 'Object3D' ) ) unit = true;

			if ( unit ) parts.push( { object: child, path, hosted: isHostedFixture( child ) } );
			walk( child, path, insideUnit || unit );

		}

	} )( root, isAssembly( root ) ? [ root ] : [], false );

	return { parts, assemblies };

}

const sizeKey = ( size ) => ( size === null ? 'sem-geometria' : [ size.x, size.y, size.z ].map( ( v ) => Math.round( v * 1000 ) ).join( 'x' ) );

// options: { requireManufacturer }
function buildBOM( editor, root, catalog = null, options = {} ) {

	const scene = editor.scene;
	const snapshot = getSnapshot( scene );
	const { parts, assemblies } = collectParts( root );
	const groups = new Map();
	const units = [];

	for ( const entry of parts ) {

		const object = entry.object;
		const info = describe( editor, object, catalog, snapshot );
		const size = geometricSize( object );
		const origin = entry.path.map( ( a ) => a.name || 'Conjunto' ).join( ' › ' ) || 'Sem conjunto';
		units.push( { object, info, origin } );

		let key;
		if ( info.link === null ) key = `none|${labelOf( object )}|${sizeKey( size )}`;
		else if ( info.record === null ) key = `missing|${info.link.catalogId}@${info.link.catalogRevision}`;
		else key = `part|${info.record.catalogId}@${info.record.revision}|${info.dimensions.status === 'divergent' ? sizeKey( size ) : 'nominal'}`;

		if ( groups.has( key ) === false ) groups.set( key, { key, info, objects: [], origins: new Set(), size } );
		const group = groups.get( key );
		group.objects.push( object );
		group.origins.add( origin );

	}

	// linhas
	const rows = [];
	for ( const group of groups.values() ) {

		const { info } = group;
		const quantity = group.objects.length;
		const row = {
			key: group.key, objects: group.objects, origins: [ ...group.origins ], quantity,
			linked: info.link !== null, record: info.record || null, outdated: info.outdated === true, latest: info.latest ?? null,
			code: '', name: '', category: '', manufacturer: '', model: '', nominal: '', revision: null,
			unitWeight: null, totalWeight: null, packagedUnit: null, packagedTotal: null,
			status: '', statusKind: 'ok', notes: [], dimsStatus: null
		};

		if ( info.link === null ) {

			row.name = labelOf( group.objects[ 0 ] );
			row.status = 'Sem ficha técnica';
			row.statusKind = 'missing';
			row.notes.push( 'Componente sem ficha técnica associada.' );

		} else if ( info.record === null ) {

			row.code = info.link.code;
			row.name = `Ficha ${info.link.code} (revisão ${info.link.catalogRevision})`;
			row.revision = info.link.catalogRevision;
			row.status = 'Revisão da ficha indisponível';
			row.statusKind = 'missing';
			row.notes.push( 'A revisão associada não está no projeto nem no catálogo local.' );

		} else {

			const r = info.record;
			Object.assign( row, { code: r.code, name: r.name, category: categoryName( r.category ), manufacturer: r.manufacturer.name, model: r.manufacturer.model, nominal: nominalSummary( r ), revision: r.revision, dimsStatus: info.dimensions.status } );
			row.unitWeight = r.physical.weight;
			row.totalWeight = r.physical.weight !== null ? r.physical.weight * quantity : null;
			row.packagedUnit = r.physical.packagedWeight;
			row.packagedTotal = r.physical.packagedWeight !== null ? r.physical.packagedWeight * quantity : null;
			const pending = pendingFields( r, options );
			const problems = [];
			if ( info.dimensions.status === 'divergent' ) problems.push( 'Divergência dimensional' );
			if ( pending.length > 0 ) problems.push( 'Pendências: ' + pending.join( ', ' ) );
			if ( info.outdated ) row.notes.push( `Revisão ${info.latest} disponível no catálogo local.` );
			row.status = problems.length > 0 ? problems.join( ' · ' ) : 'Identificada';
			row.statusKind = info.dimensions.status === 'divergent' ? 'divergent' : pending.length > 0 ? 'pending' : 'ok';

		}

		rows.push( row );

	}

	// mesmo código em linhas diferentes (dimensões efetivas distintas): sinalizado
	const byCode = new Map();
	for ( const row of rows ) if ( row.record !== null ) byCode.set( row.record.catalogId, ( byCode.get( row.record.catalogId ) || 0 ) + 1 );
	for ( const row of rows ) if ( row.record !== null && byCode.get( row.record.catalogId ) > 1 ) row.notes.push( 'Mesmo código com dimensões efetivas ou revisões diferentes: linhas não consolidadas.' );

	rows.sort( ( a, b ) => ( a.linked === b.linked ? 0 : a.linked ? - 1 : 1 ) || a.code.localeCompare( b.code, 'pt-BR', { numeric: true } ) || a.name.localeCompare( b.name, 'pt-BR' ) );

	return { rows, units, assemblies, summary: summarize( rows, units ), scope: isAssembly( root ) ? ( root.name || 'Conjunto' ) : 'Projeto inteiro' };

}

function summarize( rows, units ) {

	const linked = rows.filter( ( r ) => r.record !== null );
	const totalUnits = rows.reduce( ( s, r ) => s + r.quantity, 0 );
	const identified = linked.reduce( ( s, r ) => s + r.quantity, 0 );
	const withoutWeight = linked.filter( ( r ) => r.unitWeight === null ).reduce( ( s, r ) => s + r.quantity, 0 );
	const unidentified = totalUnits - identified;
	const knownWeight = linked.reduce( ( s, r ) => s + ( r.totalWeight || 0 ), 0 );
	const packagedKnown = linked.reduce( ( s, r ) => s + ( r.packagedTotal || 0 ), 0 );
	const packagedMissing = linked.filter( ( r ) => r.packagedUnit === null ).reduce( ( s, r ) => s + r.quantity, 0 ) + unidentified;
	return {
		totalUnits,
		identified,
		unidentified,
		distinctCodes: new Set( linked.map( ( r ) => r.record.catalogId ) ).size,
		knownWeight,
		withoutWeight,
		unknownWeightUnits: withoutWeight + unidentified,
		partial: withoutWeight + unidentified > 0,
		hasAnyWeight: linked.some( ( r ) => r.unitWeight !== null ),
		packagedKnown,
		packagedPartial: packagedMissing > 0,
		hasAnyPackaged: linked.some( ( r ) => r.packagedUnit !== null ),
		divergent: rows.filter( ( r ) => r.statusKind === 'divergent' ).reduce( ( s, r ) => s + r.quantity, 0 ),
		pending: rows.filter( ( r ) => r.statusKind === 'pending' ).reduce( ( s, r ) => s + r.quantity, 0 ),
		outdated: rows.filter( ( r ) => r.outdated ).reduce( ( s, r ) => s + r.quantity, 0 ),
		missingRecords: rows.filter( ( r ) => r.linked && r.record === null ).reduce( ( s, r ) => s + r.quantity, 0 ),
		unitsCount: units.length
	};

}

function weightText( summary ) {

	const kg = ( v ) => v.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) + ' kg';
	if ( summary.hasAnyWeight === false ) return 'Peso desconhecido: nenhuma peça com peso cadastrado.';
	if ( summary.partial ) return `Peso conhecido parcial: ${kg( summary.knownWeight )}. Existem peças sem peso cadastrado (${summary.unknownWeightUnits}).`;
	return `Peso conhecido: ${kg( summary.knownWeight )} (todas as peças com peso informado).`;

}

// componentes do projeto com ficha associada (para o catálogo: "Visualizar usos")
function linkedObjects( scene ) {

	const list = [];
	scene.traverse( ( object ) => {

		if ( getTechnicalLink( object ) !== null ) list.push( object );

	} );
	return list;

}

export { collectParts, buildBOM, summarize, weightText, linkedObjects };
