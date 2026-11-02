// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Base do plano: registro histórico das peças e quantidades consideradas quando o plano foi elaborado.
//   - origem única das unidades: buildBOM() da EV-015 (sem segunda contagem): a raiz de um conjunto não é peça,
//     malhas internas não são peças, portas/janelas hospedadas contam uma vez;
//   - cada linha guarda a chave lógica (ficha + revisão, ou tipo + dimensões), o lineId estável derivado dela, o código
//     técnico, o ID e a revisão da ficha, os UUIDs das instâncias e os IDs dos conjuntos — identificadores DISTINTOS;
//   - alterações posteriores do modelo NUNCA reescrevem a base: são detectadas por comparação (diffBaseline) e só
//     entram numa nova revisão da base por decisão explícita (rebaseline), preservando todos os registros feitos.

import { buildBOM } from './SimpleMode.TechnicalBOM.js';
import { assemblyAncestors, getAssembly } from './SimpleMode.AssemblyData.js';
import { lineIdFor, newId, sanitizeLine } from './SimpleMode.LogisticsData.js';

function fnv( textValue ) {

	let h1 = 0x811c9dc5, h2 = 0x01000193;
	for ( let i = 0; i < textValue.length; i ++ ) {

		const c = textValue.charCodeAt( i );
		h1 = Math.imul( h1 ^ c, 16777619 ) >>> 0;
		h2 = Math.imul( h2 ^ c, 2246822507 ) >>> 0;

	}

	return 'fnv:' + h1.toString( 16 ).padStart( 8, '0' ) + h2.toString( 16 ).padStart( 8, '0' );

}

// levantamento atual do modelo (linhas no formato da base)
function surveyModel( editor, catalog = null ) {

	const bom = buildBOM( editor, editor.scene, catalog );
	const items = bom.rows.map( ( row ) => {

		const record = row.record;
		const units = row.objects.map( ( o ) => o.uuid );
		const unitAssemblies = {};
		for ( const object of row.objects ) {

			const chain = assemblyAncestors( object, editor.scene ).map( ( a ) => ( getAssembly( a ) || {} ).id ).filter( Boolean );
			if ( chain.length > 0 ) unitAssemblies[ object.uuid ] = chain;

		}

		return sanitizeLine( {
			lineId: lineIdFor( row.key ),
			key: row.key,
			code: row.code,
			name: row.name,
			catalogId: record !== null ? record.catalogId : null,
			catalogRevision: record !== null ? record.revision : ( row.revision ?? null ),
			category: row.category,
			unitWeight: row.unitWeight,
			packagedWeight: record !== null ? record.physical.packagedWeight : null,
			packageDims: record !== null ? record.physical.packageDims : null,
			nominal: row.nominal,
			quantity: row.quantity,
			units,
			unitAssemblies,
			linked: record !== null
		} );

	} ).filter( Boolean );

	return { items, bom };

}

function hashItems( items ) {

	return fnv( items.map( ( i ) => `${i.key}:${i.quantity}:${i.units.slice().sort().join( ',' )}` ).sort().join( '|' ) );

}

function summaryOf( items ) {

	const linked = items.filter( ( i ) => i.linked );
	const withoutWeight = items.filter( ( i ) => i.linked === false || i.unitWeight === null ).reduce( ( s, i ) => s + i.quantity, 0 );
	return {
		totalUnits: items.reduce( ( s, i ) => s + i.quantity, 0 ),
		identified: linked.reduce( ( s, i ) => s + i.quantity, 0 ),
		knownWeight: linked.reduce( ( s, i ) => s + ( i.unitWeight !== null ? i.unitWeight * i.quantity : 0 ), 0 ),
		partial: withoutWeight > 0,
		records: [ ...new Set( linked.map( ( i ) => `${i.catalogId}@${i.catalogRevision}` ) ) ]
	};

}

function createBaseline( editor, catalog, { project = null, revision = 1 } = {} ) {

	const { items } = surveyModel( editor, catalog );
	return {
		id: newId( 'base' ),
		revision,
		createdAt: new Date().toISOString(),
		projectId: project !== null ? project.id : null,
		projectRevision: project !== null && Number.isInteger( project.revision ) ? project.revision : null,
		hash: hashItems( items ),
		items,
		summary: summaryOf( items )
	};

}

// diferenças entre o modelo atual e a base (nada é alterado)
function diffBaseline( baseline, current, scene ) {

	const result = { changed: false, added: [], removed: [], quantity: [], revisions: [], unitsAdded: [], unitsRemoved: [], currentHash: hashItems( current ) };
	if ( baseline === null ) return result;
	const before = new Map( baseline.items.map( ( i ) => [ i.key, i ] ) );
	const after = new Map( current.map( ( i ) => [ i.key, i ] ) );
	for ( const [ key, item ] of after ) {

		const old = before.get( key );
		if ( old === undefined ) result.added.push( item );
		else if ( old.quantity !== item.quantity ) result.quantity.push( { key, code: item.code, name: item.name, from: old.quantity, to: item.quantity } );

	}

	for ( const [ key, item ] of before ) if ( after.has( key ) === false ) result.removed.push( item );

	// mesma ficha em outra revisão
	for ( const item of result.added ) {

		if ( item.catalogId === null ) continue;
		const old = baseline.items.find( ( i ) => i.catalogId === item.catalogId && i.catalogRevision !== item.catalogRevision );
		if ( old !== undefined ) result.revisions.push( { code: item.code, from: old.catalogRevision, to: item.catalogRevision } );

	}

	const baseUnits = new Set( baseline.items.flatMap( ( i ) => i.units ) );
	const nowUnits = new Set( current.flatMap( ( i ) => i.units ) );
	for ( const u of nowUnits ) if ( baseUnits.has( u ) === false ) result.unitsAdded.push( u );
	for ( const u of baseUnits ) if ( nowUnits.has( u ) === false ) result.unitsRemoved.push( { uuid: u, exists: scene.getObjectByProperty( 'uuid', u ) !== undefined } );
	result.changed = result.currentHash !== baseline.hash;
	return result;

}

// mensagem resumida no estilo "Foram identificados 2 painéis adicionais"
function describeDiff( diff ) {

	const lines = [];
	for ( const q of diff.quantity ) lines.push( q.to > q.from ? `${q.code || q.name}: ${q.to - q.from} unidade(s) adicional(is) (${q.from} → ${q.to}).` : `${q.code || q.name}: ${q.from - q.to} unidade(s) a menos (${q.from} → ${q.to}).` );
	for ( const a of diff.added ) lines.push( `Nova linha: ${a.code || a.name} — ${a.quantity} un.` );
	for ( const r of diff.removed ) lines.push( `Linha fora do modelo atual: ${r.code || r.name} — ${r.quantity} un. na base.` );
	for ( const r of diff.revisions ) lines.push( `Ficha ${r.code}: revisão ${r.from} na base, ${r.to} no modelo.` );
	if ( diff.unitsRemoved.length > 0 ) lines.push( `${diff.unitsRemoved.length} instância(s) da base não existem mais no modelo.` );
	return lines;

}

// nova revisão da base: linhas pelo lineId estável; registros e linhas antigas com registros são preservados
function rebaseline( plan, editor, catalog, { project = null, note = '' } = {} ) {

	const previous = plan.baseline;
	const next = createBaseline( editor, catalog, { project, revision: previous !== null ? previous.revision + 1 : 1 } );
	const history = plan.baselineHistory.slice();
	if ( previous !== null ) history.push( { id: previous.id, revision: previous.revision, createdAt: previous.createdAt, hash: previous.hash, totalUnits: previous.summary.totalUnits, note } );
	const activeIds = new Set( next.items.map( ( i ) => i.lineId ) );
	const retired = new Map( plan.retiredLines.map( ( l ) => [ l.lineId, l ] ) );
	const hasRecords = ( lineId ) => plan.picking[ lineId ] !== undefined || plan.returns[ lineId ] !== undefined || Object.keys( plan.loading ).some( ( k ) => k.endsWith( '|' + lineId ) ) || Object.keys( plan.receiving ).some( ( k ) => k.endsWith( '|' + lineId ) ) || plan.kits.some( ( k ) => k.items.some( ( i ) => i.lineId === lineId ) ) || plan.loads.some( ( l ) => l.items.some( ( i ) => i.lineId === lineId ) );
	if ( previous !== null ) for ( const line of previous.items ) if ( activeIds.has( line.lineId ) === false && hasRecords( line.lineId ) ) retired.set( line.lineId, line );
	for ( const id of activeIds ) retired.delete( id );
	return Object.assign( {}, plan, { baseline: next, baselineHistory: history, retiredLines: [ ...retired.values() ] } );

}

export { surveyModel, createBaseline, diffBaseline, describeDiff, rebaseline, hashItems, summaryOf };
