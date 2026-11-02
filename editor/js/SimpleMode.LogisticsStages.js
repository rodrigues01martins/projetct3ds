// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Etapas (montagem, desmontagem e demais tipos), dependências e cronograma.
//   - etapas são unidades de PLANEJAMENTO: a ordem não é instrução segura de execução física;
//   - dependências por IDs estáveis; sem autodependência nem ciclos; excluir etapa referenciada exige decisão;
//   - concluir uma etapa antes da predecessora é permitido só com confirmação e justificativa registrada;
//   - não há cálculo de caminho crítico, estimativa de duração, equipes ou produtividade.
// A sequência de desmontagem é própria; a inversão da montagem é só uma SUGESTÃO organizacional de edição.

import { newId, sanitizeStage, STAGE_STATUSES, labelOf, todayLocal } from './SimpleMode.LogisticsData.js';
import { LogisticsError, clone, stamp, addEvent } from './SimpleMode.LogisticsPlan.js';

function renumber( stages ) {

	stages.forEach( ( s, i ) => ( s.number = i + 1 ) );
	return stages;

}

function addStage( plan, data ) {

	const next = clone( plan );
	const stage = sanitizeStage( Object.assign( { id: newId( 'stage' ), status: 'todo' }, data ), next.stages.length );
	if ( stage.deps.includes( stage.id ) ) stage.deps = stage.deps.filter( ( d ) => d !== stage.id );
	next.stages.push( stage );
	renumber( next.stages );
	addEvent( next, 'stage-added', { ref: stage.id, to: stage.title } );
	return { plan: stamp( next ), stage };

}

function updateStage( plan, id, changes, note = '' ) {

	const next = clone( plan );
	const index = next.stages.findIndex( ( s ) => s.id === id );
	if ( index === - 1 ) throw new LogisticsError( 'A etapa não existe mais no plano.' );
	const before = next.stages[ index ];
	const merged = sanitizeStage( Object.assign( {}, before, changes, { id } ), index );
	if ( changes.deps !== undefined ) checkDeps( next, id, merged.deps );
	next.stages[ index ] = merged;
	const fields = Object.keys( changes ).filter( ( k ) => JSON.stringify( before[ k ] ) !== JSON.stringify( merged[ k ] ) );
	if ( fields.length > 0 ) addEvent( next, 'stage-edited', { ref: id, from: fields.map( ( f ) => `${f}: ${JSON.stringify( before[ f ] )}` ).join( '; ' ).slice( 0, 200 ), to: fields.map( ( f ) => `${f}: ${JSON.stringify( merged[ f ] )}` ).join( '; ' ).slice( 0, 200 ), note } );
	return stamp( next );

}

// referências à etapa (dependências, kits)
function stageReferences( plan, id ) {

	return { dependents: plan.stages.filter( ( s ) => s.deps.includes( id ) ), kits: plan.kits.filter( ( k ) => k.stageId === id ) };

}

// mode 'detach': remove as dependências que apontam para a etapa (e o vínculo dos kits)
function removeStage( plan, id, mode = 'detach' ) {

	const refs = stageReferences( plan, id );
	if ( mode !== 'detach' && ( refs.dependents.length > 0 || refs.kits.length > 0 ) ) throw new LogisticsError( 'A etapa é referenciada por outras etapas ou kits.' );
	const next = clone( plan );
	const stage = next.stages.find( ( s ) => s.id === id );
	if ( stage === undefined ) throw new LogisticsError( 'A etapa não existe mais no plano.' );
	next.stages = next.stages.filter( ( s ) => s.id !== id );
	for ( const s of next.stages ) s.deps = s.deps.filter( ( d ) => d !== id );
	for ( const k of next.kits ) if ( k.stageId === id ) k.stageId = null;
	renumber( next.stages );
	addEvent( next, 'stage-removed', { ref: id, from: stage.title, note: refs.dependents.length > 0 ? `Dependências removidas de ${refs.dependents.map( ( s ) => s.title ).join( ', ' )}.` : '' } );
	return stamp( next );

}

function moveStage( plan, id, offset ) {

	const next = clone( plan );
	const index = next.stages.findIndex( ( s ) => s.id === id );
	const target = index + offset;
	if ( index === - 1 || target < 0 || target >= next.stages.length ) return plan;
	const [ stage ] = next.stages.splice( index, 1 );
	next.stages.splice( target, 0, stage );
	renumber( next.stages );
	addEvent( next, 'stage-moved', { ref: id, from: index + 1, to: target + 1 } );
	return stamp( next );

}

// ciclo: a partir das dependências propostas, alcança a própria etapa?
function wouldCycle( plan, id, deps ) {

	const graph = new Map( plan.stages.map( ( s ) => [ s.id, s.id === id ? deps : s.deps ] ) );
	const stack = deps.slice(), seen = new Set();
	while ( stack.length > 0 ) {

		const current = stack.pop();
		if ( current === id ) return true;
		if ( seen.has( current ) ) continue;
		seen.add( current );
		for ( const d of graph.get( current ) || [] ) stack.push( d );

	}

	return false;

}

function checkDeps( plan, id, deps ) {

	if ( deps.includes( id ) ) throw new LogisticsError( 'Uma etapa não pode depender dela mesma.', [], 'self' );
	const missing = deps.filter( ( d ) => plan.stages.some( ( s ) => s.id === d ) === false );
	if ( missing.length > 0 ) throw new LogisticsError( 'Dependência para etapa inexistente.', missing );
	if ( wouldCycle( plan, id, deps ) ) throw new LogisticsError( 'Dependência circular: esta etapa passaria a depender, direta ou indiretamente, de si mesma.', [], 'cycle' );

}

// predecessoras ainda não concluídas
function pendingPredecessors( plan, id ) {

	const stage = plan.stages.find( ( s ) => s.id === id );
	if ( stage === undefined ) return [];
	return stage.deps.map( ( d ) => plan.stages.find( ( s ) => s.id === d ) ).filter( ( s ) => s && s.status !== 'done' && s.status !== 'cancelled' );

}

// muda o status; concluir antes das predecessoras exige justification (o painel pede confirmação explícita)
function setStageStatus( plan, id, status, { justification = '', responsible = '', note = '' } = {} ) {

	if ( STAGE_STATUSES.some( ( s ) => s.id === status ) === false ) throw new LogisticsError( 'Status inválido.' );
	const stage = plan.stages.find( ( s ) => s.id === id );
	if ( stage === undefined ) throw new LogisticsError( 'A etapa não existe mais no plano.' );
	const pending = status === 'done' ? pendingPredecessors( plan, id ) : [];
	if ( pending.length > 0 && justification.trim() === '' ) throw new LogisticsError( `A etapa depende de ${pending.map( ( s ) => `"${s.title}"` ).join( ', ' )}, ainda não concluída(s). Informe uma justificativa para concluir mesmo assim.`, pending.map( ( s ) => s.id ), 'predecessor' );
	const next = clone( plan );
	const target = next.stages.find( ( s ) => s.id === id );
	const now = new Date().toISOString();
	const from = target.status;
	target.status = status;
	if ( status === 'doing' && target.actualStart === null ) target.actualStart = now;
	if ( status === 'done' ) {

		target.actualEnd = now;
		if ( target.actualStart === null ) target.actualStart = now;
		if ( responsible ) target.responsible = responsible;

	}

	if ( status !== 'done' && from === 'done' ) target.actualEnd = null; // reaberta: a conclusão anterior permanece no histórico
	if ( justification ) target.justification = justification.slice( 0, 300 );
	addEvent( next, 'stage-status', { ref: id, from: labelOf( STAGE_STATUSES, from ), to: labelOf( STAGE_STATUSES, status ), responsible, note: [ note, justification ? `Justificativa: ${justification}` : '' ].filter( Boolean ).join( ' ' ) } );
	return stamp( next );

}

// progresso de montagem/desmontagem declarado (quantidade instalada/desmontada)
function setStageProgress( plan, id, installed, { responsible = '', note = '' } = {} ) {

	const stage = plan.stages.find( ( s ) => s.id === id );
	if ( stage === undefined ) throw new LogisticsError( 'A etapa não existe mais no plano.' );
	if ( Number.isInteger( installed ) === false || installed < 0 ) throw new LogisticsError( 'Informe uma quantidade inteira não negativa.' );
	if ( installed > stage.units.length ) throw new LogisticsError( `A etapa prevê ${stage.units.length} componente(s); não é possível declarar ${installed}.` );
	const next = clone( plan );
	const target = next.stages.find( ( s ) => s.id === id );
	const from = target.installed;
	target.installed = installed;
	addEvent( next, 'stage-progress', { ref: id, from, to: installed, responsible, note } );
	return stamp( next );

}

// cronograma: linhas ordenadas por data prevista (sem data por último) com indicação de atraso
function schedule( plan, today = todayLocal() ) {

	return plan.stages.map( ( s ) => {

		const late = s.status !== 'done' && s.status !== 'cancelled' && s.plannedEnd !== null && s.plannedEnd < today;
		const noDate = s.plannedStart === null && s.plannedEnd === null;
		return { stage: s, late, noDate, deps: s.deps.map( ( d ) => plan.stages.find( ( x ) => x.id === d ) ).filter( Boolean ) };

	} ).sort( ( a, b ) => {

		const ka = a.stage.plannedStart || a.stage.plannedEnd || '9999-99-99', kb = b.stage.plannedStart || b.stage.plannedEnd || '9999-99-99';
		return ka.localeCompare( kb ) || a.stage.number - b.stage.number;

	} );

}

// sugestão organizacional: etapas de desmontagem com as unidades das etapas de montagem em ordem inversa
function suggestDisassembly( plan ) {

	return plan.stages.filter( ( s ) => s.type === 'assembly' ).slice().reverse().map( ( s ) => ( { title: `Desmontar: ${s.title}`, type: 'disassembly', units: s.units.slice(), assemblies: s.assemblies.slice(), description: 'Sugestão organizacional gerada pela inversão da lista de montagem — não é procedimento técnico validado. Revise a ordem antes de usar.' } ) );

}

export { addStage, updateStage, removeStage, moveStage, stageReferences, wouldCycle, checkDeps, pendingPredecessors, setStageStatus, setStageProgress, schedule, suggestDisassembly };
