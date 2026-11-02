// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Verificações cadastrais, dimensionais e operacionais do plano (nunca laudo de risco ou verificação de segurança
// física). Classificação: informação · pendência · divergência · alerta.

import { lineMap, allLines, demandOf, lineLabel, kitAllocation, loadAllocation, stageUsage } from './SimpleMode.LogisticsPlan.js';
import { wouldCycle } from './SimpleMode.LogisticsStages.js';
import { kitStatus, pickState } from './SimpleMode.LogisticsKits.js';
import { loadDetails, receivingState } from './SimpleMode.LogisticsLoads.js';
import { returnState } from './SimpleMode.LogisticsReturns.js';
import { resolveRecord, getSnapshot } from './SimpleMode.TechnicalCatalogData.js';

const LEVELS = { info: 'Informação', pending: 'Pendência', divergence: 'Divergência', alert: 'Alerta' };
const VALIDATION_NOTICE = 'Verificações cadastrais, dimensionais e operacionais do planejamento. Não constituem laudo de risco nem verificação de segurança física.';

function validatePlan( plan, editor, diff = null ) {

	const findings = [];
	const add = ( level, message, ref = null ) => findings.push( { level, label: LEVELS[ level ], message, ref } );
	if ( plan.baseline === null ) return { findings, counts: {}, notice: VALIDATION_NOTICE };
	const lines = lineMap( plan );
	const scene = editor.scene;
	const snapshot = getSnapshot( scene );

	for ( const line of allLines( plan ) ) {

		const label = lineLabel( line );
		if ( line.retired ) add( 'divergence', `${label}: linha fora do modelo atual com registros preservados (base anterior).`, { kind: 'line', id: line.lineId } );
		if ( line.linked === false ) add( 'pending', `${label}: ${line.quantity} peça(s) sem ficha técnica.`, { kind: 'line', id: line.lineId } );
		else {

			if ( line.unitWeight === null ) add( 'pending', `${label}: peso não informado na ficha.`, { kind: 'line', id: line.lineId } );
			if ( line.packageDims === null ) add( 'info', `${label}: dimensão de embalagem não informada.`, { kind: 'line', id: line.lineId } );
			if ( line.catalogId !== null && resolveRecord( scene, line.catalogId, line.catalogRevision, snapshot ).record === null ) add( 'divergence', `${label}: ficha técnica (revisão ${line.catalogRevision}) não localizada no projeto nem no catálogo local.`, { kind: 'line', id: line.lineId } );

		}

		const pick = pickState( line, plan.picking[ line.lineId ] );
		if ( pick.surplus > 0 ) add( 'info', `${label}: excedente de separação registrado (${pick.surplus}).`, { kind: 'line', id: line.lineId } );
		if ( pick.notFound > 0 ) add( 'divergence', `${label}: ${pick.notFound} peça(s) não localizada(s) na separação.`, { kind: 'line', id: line.lineId } );
		if ( pick.picked > pick.demand ) add( 'divergence', `${label}: quantidade separada (${pick.picked}) superior à necessária (${pick.demand}).`, { kind: 'line', id: line.lineId } );
		if ( kitAllocation( plan, line.lineId ) > demandOf( line ) ) add( 'divergence', `${label}: alocação exclusiva em kits (${kitAllocation( plan, line.lineId )}) maior que a necessidade (${demandOf( line )}) — duplicidade de peças físicas.`, { kind: 'line', id: line.lineId } );
		if ( loadAllocation( plan, line.lineId ) > demandOf( line ) ) add( 'divergence', `${label}: atribuída a cargas acima da necessidade (${loadAllocation( plan, line.lineId )} de ${demandOf( line )}).`, { kind: 'line', id: line.lineId } );
		const ret = returnState( plan, line );
		if ( ( ret.returned > 0 || ret.discarded > 0 ) && ret.missing > 0 ) add( 'pending', `${label}: retorno incompleto — faltam ${ret.missing} de ${ret.expected}.`, { kind: 'line', id: line.lineId } );

	}

	// etapas
	const usage = stageUsage( plan );
	for ( const stage of plan.stages ) {

		if ( stage.units.length === 0 && stage.assemblies.length === 0 && stage.type !== 'transport' && stage.type !== 'preparation' ) add( 'pending', `Etapa ${stage.number} "${stage.title}" sem componentes relacionados.`, { kind: 'stage', id: stage.id } );
		if ( wouldCycle( plan, stage.id, stage.deps ) ) add( 'alert', `Etapa ${stage.number} "${stage.title}": dependência circular.`, { kind: 'stage', id: stage.id } );
		const missing = stage.units.filter( ( u ) => scene.getObjectByProperty( 'uuid', u ) === undefined );
		if ( missing.length > 0 ) add( 'divergence', `Etapa ${stage.number} "${stage.title}": ${missing.length} componente(s) excluído(s) do modelo — referência inválida (não transferida a outro objeto).`, { kind: 'stage', id: stage.id } );
		const reused = stage.units.filter( ( u ) => ( usage.get( u ) || [] ).length > 1 );
		if ( reused.length > 0 ) add( 'info', `Etapa ${stage.number} "${stage.title}": ${reused.length} peça(s) também usada(s) em outra etapa (reutilização sequencial — não somam demanda física).`, { kind: 'stage', id: stage.id } );

	}

	for ( const kit of plan.kits ) {

		const st = kitStatus( plan, kit );
		if ( st.complete === false && kit.items.length > 0 ) add( 'pending', `Kit "${kit.name}": ${st.label.toLowerCase()}.`, { kind: 'kit', id: kit.id } );

	}

	for ( const load of plan.loads ) {

		const d = loadDetails( plan, load );
		if ( d.capacityState === 'over' ) add( 'alert', `${load.code}: ${d.capacityText}`, { kind: 'load', id: load.id } );
		else if ( d.capacityState === 'incomplete' ) add( 'pending', `${load.code}: ${d.capacityText}`, { kind: 'load', id: load.id } );
		for ( const row of d.rows ) {

			const rec = receivingState( row.planned, plan.receiving[ `${load.id}|${row.lineId}` ] );
			if ( rec.registered && row.loaded > 0 && rec.received < row.loaded ) add( 'divergence', `${load.code} — ${row.code || row.name}: recebido (${rec.received}) inferior ao carregamento declarado (${row.loaded}).`, { kind: 'load', id: load.id } );
			if ( rec.registered && rec.received > row.planned && rec.surplus === 0 ) add( 'divergence', `${load.code} — ${row.code || row.name}: recebido acima do esperado sem registro de excedente.`, { kind: 'load', id: load.id } );
			if ( lines.has( row.lineId ) === false ) add( 'divergence', `${load.code}: item sem referência na base do plano.`, { kind: 'load', id: load.id } );

		}

	}

	if ( diff !== null && diff.changed ) add( 'alert', 'O projeto foi alterado após a criação (ou última atualização) da base do plano. Veja as diferenças na Visão Geral.', { kind: 'baseline', id: plan.baseline.id } );
	const open = plan.incidents.filter( ( i ) => i.status === 'open' || i.status === 'review' );
	if ( open.length > 0 ) add( 'pending', `${open.length} ocorrência(s) aberta(s) ou em análise.`, { kind: 'incident', id: '' } );

	const counts = {};
	for ( const f of findings ) counts[ f.level ] = ( counts[ f.level ] || 0 ) + 1;
	return { findings, counts, notice: VALIDATION_NOTICE };

}

export { validatePlan, LEVELS, VALIDATION_NOTICE };
