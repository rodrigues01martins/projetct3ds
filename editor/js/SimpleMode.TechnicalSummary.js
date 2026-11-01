// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Indicadores agregados do projeto ("Resumo técnico"). Cada indicador tem um filtro para a lista de peças.
// Tons visuais distinguem informação completa, faltante, incompatibilidade declarada e divergência de revisão —
// nenhuma cor de "sucesso" sugere aprovação estrutural (completo usa tom neutro/informativo).

import { validateAssembly } from './SimpleMode.TechnicalValidation.js';
import { weightText } from './SimpleMode.TechnicalBOM.js';

const kg = ( v ) => v.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) + ' kg';

function technicalSummary( editor, { catalog = null, modelLibrary = null, requireManufacturer = false } = {} ) {

	const result = validateAssembly( editor, editor.scene, { catalog, modelLibrary, requireManufacturer } );
	const s = result.bom.summary, v = result.summary;
	const indicators = [
		{ id: 'total', label: 'Peças no projeto', value: String( s.totalUnits ), tone: 'neutral', filter: 'all' },
		{ id: 'identified', label: 'Com ficha associada', value: String( s.identified ), tone: 'complete', filter: 'identified' },
		{ id: 'unidentified', label: 'Sem ficha', value: String( s.unidentified ), tone: s.unidentified > 0 ? 'missing' : 'neutral', filter: 'missing' },
		{ id: 'codes', label: 'Códigos distintos', value: String( s.distinctCodes ), tone: 'neutral', filter: 'identified' },
		{ id: 'weight', label: s.partial ? 'Peso conhecido (parcial)' : 'Peso conhecido', value: s.hasAnyWeight ? kg( s.knownWeight ) : 'Desconhecido', tone: s.partial ? 'missing' : 'complete', filter: 'identified' },
		{ id: 'noWeight', label: 'Peças sem peso', value: String( s.unknownWeightUnits ), tone: s.unknownWeightUnits > 0 ? 'missing' : 'neutral', filter: 'noWeight' },
		{ id: 'divergent', label: 'Divergências dimensionais', value: String( s.divergent ), tone: s.divergent > 0 ? 'divergent' : 'neutral', filter: 'divergent' },
		{ id: 'incompatible', label: 'Incompatibilidades declaradas', value: String( v.incompatible ), tone: v.incompatible > 0 ? 'incompatible' : 'neutral', filter: 'check' },
		{ id: 'outdated', label: 'Fichas desatualizadas', value: String( s.outdated ), tone: s.outdated > 0 ? 'revision' : 'neutral', filter: 'outdated' }
	];
	return { indicators, result, weight: weightText( s ) };

}

// filtros da lista de peças acionados pelos indicadores
function filterRows( rows, filter ) {

	switch ( filter ) {

		case 'identified': return rows.filter( ( r ) => r.record !== null );
		case 'missing': return rows.filter( ( r ) => r.record === null );
		case 'noWeight': return rows.filter( ( r ) => r.record === null || r.unitWeight === null );
		case 'divergent': return rows.filter( ( r ) => r.statusKind === 'divergent' );
		case 'outdated': return rows.filter( ( r ) => r.outdated );
		default: return rows;

	}

}

export { technicalSummary, filterRows };
