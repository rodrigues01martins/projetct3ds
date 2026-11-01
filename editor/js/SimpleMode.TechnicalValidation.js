// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// "Conferir montagem": verificação de CONSISTÊNCIA CADASTRAL E DIMENSIONAL de um conjunto (ou do projeto).
// Não é laudo de segurança: a ausência de pendências não significa que o conjunto está apto à montagem física.
// Verificações: peças sem ficha, códigos duplicados entre fichas diferentes, revisão associada inexistente,
// divergência dimensional, conector sem especificação, incompatibilidade técnica declarada, informação insuficiente,
// peso ausente, fabricante ausente (quando exigido pelo usuário), dependências de modelos externos indisponíveis
// e revisões desatualizadas em relação ao catálogo local.

import { buildBOM } from './SimpleMode.TechnicalBOM.js';
import { evaluateUnits, effectiveRules, RESULT_LABELS } from './SimpleMode.TechnicalCompatibility.js';
import { codeKey } from './SimpleMode.TechnicalCatalogData.js';
import { dimensionMessage } from './SimpleMode.TechnicalPartLinks.js';
import { isImportedModelRoot } from './SimpleMode.ComponentFactory.js';

const VALIDATION_NOTICE = 'Verificação de consistência cadastral e dimensional. Não é laudo de segurança nem verificação estrutural: a ausência de pendências não indica que o conjunto está apto à montagem física.';

const SEVERITY_LABELS = { pending: 'Pendência cadastral', divergent: 'Divergência dimensional', incompatible: 'Incompatibilidade declarada', insufficient: 'Informação insuficiente', revision: 'Divergência de revisão', info: 'Informação' };

function validateAssembly( editor, root, { catalog = null, modelLibrary = null, requireManufacturer = false } = {} ) {

	const bom = buildBOM( editor, root, catalog, { requireManufacturer } );
	const findings = [];
	const add = ( severity, message, objects = [] ) => findings.push( { severity, label: SEVERITY_LABELS[ severity ], message, objects } );
	const nameOf = ( object ) => object.name || 'componente';

	for ( const unit of bom.units ) {

		const { object, info } = unit;
		if ( info.link === null ) {

			add( 'pending', `"${nameOf( object )}" não possui ficha técnica associada.`, [ object ] );
			continue;

		}

		if ( info.record === null ) {

			add( 'pending', `"${nameOf( object )}" está associado à revisão ${info.link.catalogRevision} da ficha ${info.link.code}, que não existe no projeto nem no catálogo local.`, [ object ] );
			continue;

		}

		const r = info.record;
		if ( info.dimensions.status === 'divergent' ) add( 'divergent', `"${nameOf( object )}" (${r.code}): ${dimensionMessage( info.dimensions, r.dimensions.unit )}`, [ object ] );
		if ( info.outdated ) add( 'revision', `"${nameOf( object )}" usa a revisão ${r.revision} de ${r.code}; a revisão ${info.latest} está disponível no catálogo local.`, [ object ] );

	}

	// pendências por ficha (uma vez por código/revisão)
	for ( const row of bom.rows ) {

		if ( row.record === null ) continue;
		const r = row.record;
		if ( r.physical.weight === null ) add( 'pending', `${r.code} (rev. ${r.revision}): peso unitário não informado (${row.quantity} peça(s)).`, row.objects );
		if ( requireManufacturer && r.manufacturer.name === '' ) add( 'pending', `${r.code} (rev. ${r.revision}): fabricante não informado.`, row.objects );
		if ( r.connectors.length === 0 ) add( 'pending', `${r.code} (rev. ${r.revision}): nenhum conector com especificação técnica declarado na ficha.`, row.objects );
		else if ( r.connectors.some( ( c ) => c.family === '' ) ) add( 'pending', `${r.code} (rev. ${r.revision}): conector sem família técnica.`, row.objects );

	}

	// códigos duplicados entre fichas diferentes (catalogIds distintos)
	const codes = new Map();
	for ( const row of bom.rows ) if ( row.record !== null ) {

		const key = codeKey( row.record.code );
		if ( codes.has( key ) === false ) codes.set( key, new Set() );
		codes.get( key ).add( row.record.catalogId );

	}

	for ( const [ code, ids ] of codes ) if ( ids.size > 1 ) add( 'pending', `O código ${code} é usado por ${ids.size} fichas diferentes neste conjunto.`, bom.rows.filter( ( r ) => r.record !== null && codeKey( r.record.code ) === code ).flatMap( ( r ) => r.objects ) );

	// dependências de modelos externos
	if ( modelLibrary !== null ) for ( const unit of bom.units ) {

		const object = unit.object;
		if ( isImportedModelRoot( object ) === false ) continue;
		const asset = object.userData.project3ds.importedAsset;
		if ( asset && asset.assetId && modelLibrary.getRecord( asset.assetId ) === null ) add( 'info', `"${nameOf( object )}": o modelo externo de origem não está na biblioteca de modelos deste navegador (a instância no projeto permanece íntegra).`, [ object ] );

	}

	// conexões (camada técnica sobre os encaixes geométricos da EV-014)
	const rules = effectiveRules( editor.scene, catalog );
	const connections = evaluateUnits( editor, bom.units.map( ( u ) => u.object ), rules );
	for ( const c of connections ) {

		if ( c.result === 'compatible' ) continue;
		add( c.result, `${nameOf( c.a )} (${c.connectorA.name}) × ${nameOf( c.b )} (${c.connectorB.name}): ${RESULT_LABELS[ c.result ]}. ${c.reason}`, [ c.a, c.b ] );

	}

	const count = ( severity ) => findings.filter( ( f ) => f.severity === severity ).length;
	return {
		bom,
		findings,
		connections,
		summary: {
			analyzed: bom.summary.totalUnits,
			identified: bom.summary.identified,
			pending: count( 'pending' ),
			divergent: count( 'divergent' ),
			incompatible: count( 'incompatible' ),
			insufficient: count( 'insufficient' ),
			revision: count( 'revision' ),
			compatibleConnections: connections.filter( ( c ) => c.result === 'compatible' ).length,
			connections: connections.length
		},
		notice: VALIDATION_NOTICE
	};

}

export { validateAssembly, VALIDATION_NOTICE, SEVERITY_LABELS };
