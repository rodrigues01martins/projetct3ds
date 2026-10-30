// EV-007 — Ferramentas Arquitetônicas Inteligentes
//
// Regras de validação das aberturas (funções puras, sem efeitos colaterais).
// A margem de 10 cm é uma restrição operacional de edição — não um requisito estrutural.
//
// Cada abertura é um retângulo no plano local XY da parede:
//   x ∈ [centerX − width/2, centerX + width/2],  y ∈ [bottomY, bottomY + height]

import { getDefinition, validateParameters } from './SimpleMode.Components.js';
import { OPENING_TYPES, hostedParameters } from './SimpleMode.Openings.js';

const MARGIN = 0.1;
const FRAME_MAX_WALL_THICKNESS = 0.48; // batente/moldura têm profundidade máxima de 0,50 m (espessura + 2 cm)

const finite = ( value ) => typeof value === 'number' && Number.isFinite( value );

function rect( opening ) {

	return { x0: opening.centerX - opening.width / 2, x1: opening.centerX + opening.width / 2, y0: opening.bottomY, y1: opening.bottomY + opening.height };

}

// Retorna null (válido) ou { code, ... } com o motivo.
//   wall: { width, height, thickness }; openings: aberturas existentes; candidate: abertura nova ou alterada
function validateOpening( wall, openings, candidate, { ignoreId = null, margin = MARGIN } = {} ) {

	if ( OPENING_TYPES[ candidate.type ] === undefined ) return { code: 'type' };
	if ( [ candidate.centerX, candidate.bottomY, candidate.width, candidate.height ].every( finite ) === false ) return { code: 'number' };
	if ( candidate.width <= 0 || candidate.height <= 0 ) return { code: 'size' };
	if ( [ wall.width, wall.height, wall.thickness ].every( finite ) === false ) return { code: 'wall' };

	if ( wall.thickness > FRAME_MAX_WALL_THICKNESS ) return { code: 'thickness' };

	const r = rect( candidate );

	if ( candidate.type === 'door' && Math.abs( candidate.bottomY ) > 1e-9 ) return { code: 'doorBase' };
	if ( candidate.type === 'window' && r.y0 < margin - 1e-9 ) return { code: 'bottom' };

	if ( candidate.width > wall.width - 2 * margin + 1e-9 ) return { code: 'tooWide' };
	if ( r.x0 < - wall.width / 2 + margin - 1e-9 || r.x1 > wall.width / 2 - margin + 1e-9 ) return { code: 'ends' };
	if ( r.y1 > wall.height - margin + 1e-9 ) return { code: 'top' };

	for ( const other of openings ) {

		if ( other.id === ignoreId ) continue;

		const o = rect( other );
		const overlapX = r.x0 < o.x1 + margin - 1e-9 && r.x1 > o.x0 - margin + 1e-9;
		const overlapY = r.y0 < o.y1 + margin - 1e-9 && r.y1 > o.y0 - margin + 1e-9;

		if ( overlapX && overlapY ) return { code: 'overlap', other: other.id };

	}

	// parâmetros do componente (porta/janela) precisam respeitar os limites da EV-003
	const definition = getDefinition( OPENING_TYPES[ candidate.type ].component );
	const invalid = validateParameters( definition, hostedParameters( candidate.type, candidate, wall.thickness ) );

	if ( invalid !== null ) return { code: 'component', message: invalid.message, key: invalid.key };

	return null;

}

// Alteração de medidas da parede hospedeira: todas as aberturas precisam continuar válidas
function validateWallChange( newWall, openings ) {

	for ( const opening of openings ) {

		const problem = validateOpening( newWall, openings, opening, { ignoreId: opening.id } );
		if ( problem !== null ) return Object.assign( { opening }, problem );

	}

	return null;

}

// distâncias livres do vão até as extremidades da parede (para a interface)
function distancesToEnds( wallWidth, opening ) {

	const r = rect( opening );
	return { left: r.x0 + wallWidth / 2, right: wallWidth / 2 - r.x1 };

}

export { MARGIN, validateOpening, validateWallChange, distancesToEnds };
