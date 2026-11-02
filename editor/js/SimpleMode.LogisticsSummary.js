// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Resumo do planejamento: indicadores a partir dos REGISTROS do plano (nada é dado como concluído só porque foi
// planejado). Pesos líquido e embalado são mostrados separadamente, com a contagem de peças sem peso.

import { allLines, demandOf, weightOf } from './SimpleMode.LogisticsPlan.js';
import { pickState, kitStatus } from './SimpleMode.LogisticsKits.js';
import { loadDetails } from './SimpleMode.LogisticsLoads.js';
import { returnState } from './SimpleMode.LogisticsReturns.js';

function planSummary( plan ) {

	const lines = allLines( plan ).filter( ( l ) => l.retired !== true );
	const needed = lines.reduce( ( s, l ) => s + demandOf( l ), 0 );
	const picks = lines.map( ( l ) => pickState( l, plan.picking[ l.lineId ] ) );
	const picked = picks.reduce( ( s, p ) => s + Math.min( p.picked, p.demand ), 0 );
	const kits = plan.kits.map( ( k ) => kitStatus( plan, k ) );
	const loads = plan.loads.map( ( l ) => ( { load: l, details: loadDetails( plan, l ) } ) );
	const returns = lines.map( ( l ) => returnState( plan, l ) );
	const weight = weightOf( plan, lines.map( ( l ) => ( { lineId: l.lineId, quantity: demandOf( l ) } ) ) );
	return {
		needed,
		identified: lines.filter( ( l ) => l.linked ).reduce( ( s, l ) => s + l.quantity, 0 ),
		unidentified: lines.filter( ( l ) => l.linked === false ).reduce( ( s, l ) => s + l.quantity, 0 ),
		picked,
		pickPending: needed - picked,
		kitsComplete: kits.filter( ( k ) => k.complete ).length,
		kitsIncomplete: kits.filter( ( k ) => k.complete === false ).length,
		loadsPlanned: plan.loads.length,
		loadsLoaded: loads.filter( ( l ) => l.details.state === 'done' ).length,
		stagesDone: plan.stages.filter( ( s ) => s.status === 'done' ).length,
		stagesPending: plan.stages.filter( ( s ) => s.status !== 'done' && s.status !== 'cancelled' ).length,
		divergences: picks.filter( ( p ) => p.state === 'divergent' ).length + plan.incidents.filter( ( i ) => i.status === 'open' || i.status === 'review' ).length,
		returned: returns.reduce( ( s, r ) => s + r.returned, 0 ),
		returnMissing: returns.reduce( ( s, r ) => s + ( r.returned > 0 || r.discarded > 0 ? r.missing : 0 ), 0 ),
		weight,
		loadWeights: loads.map( ( l ) => ( { code: l.load.code, known: l.details.weight.known, unknown: l.details.weight.unknown, capacityText: l.details.capacityText, state: l.details.capacityState } ) )
	};

}

export { planSummary };
