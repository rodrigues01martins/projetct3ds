// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Compatibilidade TÉCNICA DECLARADA entre conectores (camada 2). A camada 1 — compatibilidade geométrica (posição,
// orientação, tipo, família, papel) — continua inteiramente em SimpleMode.AssemblyConnectors.js e não é alterada.
//
// Resultados possíveis (nunca "seguro" ou "aprovado estruturalmente"):
//   compatible   — compatibilidade técnica declarada no catálogo, sujeita à conferência das condições reais de montagem;
//   incompatible — incompatibilidade identificada (regra explícita);
//   insufficient — informação insuficiente.
// Regras:
//   - a família 'generic' (alternativa geométrica da EV-014) NUNCA prova compatibilidade técnica;
//   - regras direcionais valem só no sentido declarado; as não direcionais valem nos dois sentidos;
//   - não há transitividade: A↔B e B↔C não implicam A↔C;
//   - mesma família técnica declarada nas duas fichas = compatibilidade declarada (salvo regra explícita contrária).

import * as THREE from 'three';

import { connectorsOf, toWorld, compatible as geometricCompatible } from './SimpleMode.AssemblyConnectors.js';
import { getTechnicalLink, resolveRecord, getSnapshot } from './SimpleMode.TechnicalCatalogData.js';

const RESULT_LABELS = {
	compatible: 'Compatibilidade técnica declarada',
	incompatible: 'Incompatibilidade identificada',
	insufficient: 'Informação insuficiente'
};

const CAVEAT = 'Compatibilidade declarada no catálogo, sujeita à conferência das condições reais de montagem. Não é verificação estrutural.';

const CONTACT = 0.002; // 2 mm: conectores coincidentes (peças encaixadas)

function evaluateFamilies( familyA, familyB, rules ) {

	if ( familyA === '' || familyB === '' ) return { result: 'insufficient', reason: 'Conector sem família técnica especificada.' };
	if ( familyA === 'generic' || familyB === 'generic' ) return { result: 'insufficient', reason: 'Conector genérico: é apenas uma referência geométrica e não comprova compatibilidade técnica.' };

	const direct = rules.find( ( r ) => r.familyA === familyA && r.familyB === familyB );
	if ( direct !== undefined ) return { result: direct.result, reason: `Regra declarada: ${direct.familyA} → ${direct.familyB}${direct.directional ? ' (direcional)' : ''}${direct.note ? ` — ${direct.note}` : ''}.`, rule: direct };
	const reverse = rules.find( ( r ) => r.familyA === familyB && r.familyB === familyA && r.directional === false );
	if ( reverse !== undefined ) return { result: reverse.result, reason: `Regra declarada: ${reverse.familyA} ↔ ${reverse.familyB}${reverse.note ? ` — ${reverse.note}` : ''}.`, rule: reverse };
	if ( familyA === familyB ) return { result: 'compatible', reason: `Mesma família técnica declarada nas duas fichas (${familyA}).` };
	const reverseOnly = rules.find( ( r ) => r.familyA === familyB && r.familyB === familyA );
	if ( reverseOnly !== undefined ) return { result: 'insufficient', reason: `Existe regra apenas no sentido ${reverseOnly.familyA} → ${reverseOnly.familyB} (direcional); o sentido inverso não foi declarado.` };
	return { result: 'insufficient', reason: `Nenhuma relação declarada entre as famílias ${familyA} e ${familyB}.` };

}

// interface técnica da ficha correspondente a um conector geométrico da EV-014
function technicalConnector( record, geometric ) {

	if ( record === null ) return null;
	const id = String( geometric.id || '' ).toLowerCase(), name = String( geometric.name || '' ).toLowerCase();
	const match = record.connectors.find( ( c ) => c.geometric !== '' && ( c.geometric.toLowerCase() === id || c.geometric.toLowerCase() === name ) );
	if ( match !== undefined ) return match;
	const generic = record.connectors.filter( ( c ) => c.geometric === '' );
	return generic.length === 1 ? generic[ 0 ] : null; // interface única declarada vale para todos os pontos de encaixe

}

function evaluateConnection( recordA, geoA, recordB, geoB, rules ) {

	if ( recordA === null || recordB === null ) return { result: 'insufficient', reason: 'Peça sem ficha técnica associada.' };
	const techA = technicalConnector( recordA, geoA ), techB = technicalConnector( recordB, geoB );
	if ( techA === null || techB === null ) {

		const missing = [ techA === null ? recordA.code : null, techB === null ? recordB.code : null ].filter( Boolean );
		return { result: 'insufficient', reason: `Conector sem especificação técnica na ficha ${missing.join( ' e ' )}.`, techA, techB };

	}

	return Object.assign( evaluateFamilies( techA.family, techB.family, rules ), { techA, techB } );

}

// conexões físicas presumidas: pares de conectores geométricos coincidentes (≤ 2 mm) e opostos entre unidades
function findConnections( units ) {

	const entries = units.map( ( object ) => {

		const box = new THREE.Box3().setFromObject( object ).expandByScalar( CONTACT );
		const connectors = connectorsOf( object ).filter( ( c ) => c.kind !== 'center' ).map( ( c ) => ( { connector: c, world: toWorld( object, c ) } ) );
		return { object, box, connectors };

	} );

	const connections = [];
	for ( let i = 0; i < entries.length; i ++ ) for ( let j = i + 1; j < entries.length; j ++ ) {

		const a = entries[ i ], b = entries[ j ];
		if ( a.box.intersectsBox( b.box ) === false ) continue;
		let best = null;
		for ( const ca of a.connectors ) for ( const cb of b.connectors ) {

			const distance = ca.world.position.distanceTo( cb.world.position );
			if ( distance > CONTACT || ca.world.normal.dot( cb.world.normal ) > - 0.8 ) continue;
			if ( geometricCompatible( ca.connector, cb.connector, ca.world, cb.world ) === false ) continue;
			const score = distance - ( ca.connector.origin === 'explicit' ? 1 : 0 ) - ( cb.connector.origin === 'explicit' ? 1 : 0 );
			if ( best === null || score < best.score ) best = { score, a: a.object, b: b.object, connectorA: ca.connector, connectorB: cb.connector };

		}

		if ( best !== null ) connections.push( best );

	}

	return connections;

}

function evaluateUnits( editor, units, rules ) {

	const snapshot = getSnapshot( editor.scene );
	const recordOf = ( object ) => {

		const link = getTechnicalLink( object );
		return link !== null ? resolveRecord( editor.scene, link.catalogId, link.catalogRevision, snapshot ).record : null;

	};

	return findConnections( units ).map( ( c ) => Object.assign( c, evaluateConnection( recordOf( c.a ), c.connectorA, recordOf( c.b ), c.connectorB, rules ) ) );

}

// regras efetivas: as do projeto (snapshot) prevalecem sobre as locais de mesmo id (sem atualização silenciosa)
function effectiveRules( scene, catalog ) {

	const project = Object.values( getSnapshot( scene ).rules );
	const ids = new Set( project.map( ( r ) => r.id ) );
	const local = catalog !== null ? catalog.getRules().filter( ( r ) => ids.has( r.id ) === false ) : [];
	return project.concat( local );

}

export { RESULT_LABELS, CAVEAT, evaluateFamilies, technicalConnector, evaluateConnection, findConnections, evaluateUnits, effectiveRules };
