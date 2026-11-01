// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Associação entre fichas técnicas (definições) e componentes 3D (instâncias).
//   - a ficha é gravada na RAIZ LÓGICA do componente (componente paramétrico, componente pessoal, raiz do modelo
//     importado, porta/janela hospedada, conjunto ou objeto genérico de nível superior) — nunca em cada malha;
//   - renomear, mover ou duplicar uma instância não altera o catálogo; alterar escala/dimensões só dispara nova
//     conferência dimensional (a ficha nominal nunca é modificada por uma edição geométrica).
//
// Conferência dimensional: dimensão NOMINAL (ficha) × dimensão GEOMÉTRICA (modelo). A medida geométrica é a caixa
// envolvente no espaço LOCAL do componente multiplicada pela escala efetiva da hierarquia (a rotação não interfere:
// não se compara a caixa mundial alinhada aos eixos de uma peça girada). Largura = X local, altura = Y, profundidade
// = Z, comprimento = maior dimensão, espessura = menor. Sem tolerância cadastrada, usa-se apenas uma folga numérica
// de processamento (0,01 mm) contra erros de ponto flutuante — que NÃO é tolerância de fabricação.

import * as THREE from 'three';

import { SetTechnicalPartCommand } from './commands/SetTechnicalPartCommand.js';
import { findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { findHostedFixture, isHostedFixture } from './SimpleMode.Openings.js';
import { isAssembly } from './SimpleMode.AssemblyData.js';
import { getTechnicalLink, makeLink, resolveRecord, getSnapshot, DIMENSION_KEYS, DIMENSION_LABELS, formatNominal } from './SimpleMode.TechnicalCatalogData.js';

const PROCESSING_EPSILON = 1e-5; // 0,01 mm

const _inverse = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _part = new THREE.Box3();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// raiz lógica que recebe a ficha
function logicalRoot( object, scene ) {

	if ( object === null || object === undefined || object === scene ) return null;
	if ( isAssembly( object ) ) return object;
	const hosted = findHostedFixture( object, scene );
	if ( hosted !== null ) return hosted;
	const component = findComponentRoot( object, scene );
	if ( component !== null ) return component;
	// objeto genérico: o ancestral direto da cena ou do conjunto que o contém
	let current = object;
	while ( current.parent !== null && current.parent !== scene && isAssembly( current.parent ) === false ) current = current.parent;
	return current.isLight || current.isCamera ? null : current;

}

// caixa local (sem subárvores de portas/janelas hospedadas, que são peças próprias) × escala efetiva
function geometricSize( object ) {

	object.updateWorldMatrix( true, true );
	_inverse.copy( object.matrixWorld ).invert();
	_box.makeEmpty();

	( function walk( node ) {

		if ( node !== object && isHostedFixture( node ) ) return;
		if ( node.isMesh === true && node.geometry !== undefined ) {

			if ( node.geometry.boundingBox === null ) node.geometry.computeBoundingBox();
			_matrix.multiplyMatrices( _inverse, node.matrixWorld );
			_part.copy( node.geometry.boundingBox ).applyMatrix4( _matrix );
			_box.union( _part );

		}

		for ( const child of node.children ) walk( child );

	} )( object );

	if ( _box.isEmpty() ) return null;
	object.matrixWorld.decompose( _p, _q, _s );
	const size = _box.getSize( new THREE.Vector3() );
	return { x: size.x * Math.abs( _s.x ), y: size.y * Math.abs( _s.y ), z: size.z * Math.abs( _s.z ) };

}

function measuredFor( key, size ) {

	switch ( key ) {

		case 'width': return size.x;
		case 'height': return size.y;
		case 'depth': return size.z;
		case 'length': return Math.max( size.x, size.y, size.z );
		case 'thickness': return Math.min( size.x, size.y, size.z );
		default: return null;

	}

}

// folga admitida para uma dimensão nominal (a maior entre as tolerâncias informadas)
function allowedFor( nominal, tolerance ) {

	const options = [];
	if ( tolerance.absolute !== null ) options.push( tolerance.absolute );
	if ( tolerance.relative !== null ) options.push( nominal * tolerance.relative / 100 );
	return options.length > 0 ? Math.max( PROCESSING_EPSILON, ...options ) : PROCESSING_EPSILON;

}

// status: 'compatible' | 'divergent' | 'none' (sem dimensão nominal) | 'no-geometry'
function checkDimensions( record, object ) {

	const d = record.dimensions;
	const informed = DIMENSION_KEYS.filter( ( k ) => d[ k ] !== null );
	if ( informed.length === 0 ) return { status: 'none', items: [], toleranceDeclared: false };
	const size = geometricSize( object );
	if ( size === null ) return { status: 'no-geometry', items: [], toleranceDeclared: false };
	const toleranceDeclared = d.tolerance.absolute !== null || d.tolerance.relative !== null;
	const items = informed.map( ( key ) => {

		const nominal = d[ key ], measured = measuredFor( key, size );
		const diff = measured - nominal;
		const allowed = allowedFor( nominal, d.tolerance );
		return { key, label: DIMENSION_LABELS[ key ], nominal, measured, diff, allowed, ok: Math.abs( diff ) <= allowed };

	} );
	return { status: items.every( ( i ) => i.ok ) ? 'compatible' : 'divergent', items, toleranceDeclared, size };

}

function dimensionMessage( check, unit = 'mm' ) {

	switch ( check.status ) {

		case 'compatible': return check.toleranceDeclared ? 'Compatível dimensionalmente (dentro da tolerância declarada).' : 'Compatível dimensionalmente.';
		case 'divergent': return 'Divergência dimensional entre ficha e modelo: ' + check.items.filter( ( i ) => i.ok === false ).map( ( i ) => `${i.label.toLowerCase()} nominal ${formatNominal( i.nominal, unit )}, modelo ${formatNominal( i.measured, unit )}` ).join( '; ' ) + '.';
		case 'none': return 'A ficha não declara dimensões nominais: conferência dimensional não aplicável.';
		default: return 'O componente não tem geometria mensurável.';

	}

}

// situação completa de uma instância
function describe( editor, object, catalog = null, snapshot = null ) {

	const link = getTechnicalLink( object );
	if ( link === null ) return { link: null };
	const { record, origin } = resolveRecord( editor.scene, link.catalogId, link.catalogRevision, snapshot !== null ? snapshot : getSnapshot( editor.scene ) );
	const latest = catalog !== null ? catalog.latestRevision( link.catalogId ) : null;
	const latestRecord = latest !== null && catalog !== null ? catalog.getRevision( link.catalogId, latest ) : null;
	return {
		link,
		record,
		origin,
		latest,
		latestRecord,
		outdated: latest !== null && latest > link.catalogRevision,
		inCatalog: catalog !== null && catalog.getPart( link.catalogId ) !== null,
		dimensions: record !== null ? checkDimensions( record, object ) : null
	};

}

// associar / trocar (um passo de Desfazer); records: revisões a preservar no snapshot
function associate( editor, objects, record, name = null ) {

	const targets = [ ...new Set( objects.map( ( o ) => logicalRoot( o, editor.scene ) ).filter( Boolean ) ) ];
	if ( targets.length === 0 ) return null;
	const label = name || ( targets.length === 1 ? `Associar ficha ${record.code}: ${targets[ 0 ].name || 'componente'}` : `Associar ficha ${record.code} a ${targets.length} componentes` );
	const command = new SetTechnicalPartCommand( editor, targets, makeLink( record ), [ record ], label );
	editor.execute( command );
	return targets;

}

function detach( editor, objects ) {

	const targets = objects.filter( ( o ) => getTechnicalLink( o ) !== null );
	if ( targets.length === 0 ) return null;
	editor.execute( new SetTechnicalPartCommand( editor, targets, null, [], targets.length === 1 ? `Remover ficha técnica: ${targets[ 0 ].name || 'componente'}` : `Remover ficha técnica de ${targets.length} componentes` ) );
	return targets;

}

// atualização EXPLÍCITA para a revisão mais recente do catálogo local (todas as instâncias indicadas)
function updateRevision( editor, objects, record ) {

	return associate( editor, objects, record, `Atualizar ficha ${record.code} para a revisão ${record.revision}` );

}

// instâncias do projeto que usam uma ficha (qualquer revisão, ou uma revisão específica)
function findUses( scene, catalogId, revision = null ) {

	const uses = [];
	scene.traverse( ( object ) => {

		const link = getTechnicalLink( object );
		if ( link !== null && link.catalogId === catalogId && ( revision === null || link.catalogRevision === revision ) ) uses.push( object );

	} );
	return uses;

}

// valores para "Criar ficha a partir do componente": SOMENTE o que é verificável na geometria (dimensões).
// Peso, material construtivo, fabricante, capacidade e certificação ficam vazios até serem informados.
function draftFromObject( object ) {

	const size = geometricSize( object );
	const round = ( v ) => Math.round( v * 1e5 ) / 1e5;
	return {
		name: object.name || '',
		dimensions: size !== null ? { unit: 'mm', width: round( size.x ) || null, height: round( size.y ) || null, depth: round( size.z ) || null, length: null, thickness: null, tolerance: { absolute: null, relative: null } } : undefined
	};

}

export { logicalRoot, geometricSize, checkDimensions, dimensionMessage, describe, associate, detach, updateRevision, findUses, draftFromObject, PROCESSING_EPSILON };
