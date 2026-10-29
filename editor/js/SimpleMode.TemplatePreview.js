// EV-005 — Galeria de Projetos Prontos e Modelos Iniciais 3D
//
// Miniatura leve de cada modelo: planta baixa em SVG gerada a partir da própria definição
// (sem WebGL, sem imagens externas e sem cenas de pré-visualização em memória).

import { getDefinition, getDefaultParameters, getParameterSize } from './SimpleMode.Components.js';
import { getMaterialPreset } from './SimpleMode.MaterialCatalog.js';

const DRAW_ORDER = { floor: 0, platform: 1, table: 2, shelf: 2, chair: 3, panel: 4, wall: 5, door: 5, window: 5 };

const escape = ( text ) => String( text ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ c ] ) );

// cor representativa de um componente: acabamento da parte principal ou cor do parâmetro
function getColor( definition, parameters, appearance ) {

	const preset = appearance !== undefined ? getMaterialPreset( Object.values( appearance )[ 0 ] ) : null;
	if ( preset !== null ) return preset.color;

	const colorParameter = definition.parameters.find( ( parameter ) => parameter.type === 'color' );
	return colorParameter !== undefined ? parameters[ colorParameter.key ] : '#cccccc';

}

function createPreviewSVG( template, title ) {

	const pad = 0.4;
	const width = template.area.width + pad * 2;
	const depth = template.area.depth + pad * 2;

	const items = template.components
		.map( ( item ) => {

			const definition = getDefinition( item.component );
			if ( definition === null ) return null;

			const parameters = Object.assign( getDefaultParameters( definition ), item.parameters || {} );
			const size = getParameterSize( definition, parameters );

			return { item, definition, parameters, size: { x: size.x || 0.2, z: size.z || 0.2 } };

		} )
		.filter( Boolean )
		.sort( ( a, b ) => ( DRAW_ORDER[ a.item.component ] || 0 ) - ( DRAW_ORDER[ b.item.component ] || 0 ) );

	const shapes = items.map( ( { item, definition, parameters, size } ) => {

		const [ x, , z ] = item.position;
		const angle = - item.rotation[ 1 ]; // rotação em Y vista de cima (eixo Z para baixo no SVG)
		const color = getColor( definition, parameters, item.appearance );
		const stroke = item.component === 'floor' ? 'none' : 'rgba(0,0,0,.35)';

		return `<rect x="${ ( x - size.x / 2 ).toFixed( 3 ) }" y="${ ( z - size.z / 2 ).toFixed( 3 ) }" width="${ size.x.toFixed( 3 ) }" height="${ size.z.toFixed( 3 ) }" rx="0.02" fill="${ escape( color ) }" stroke="${ stroke }" stroke-width="0.02" transform="rotate(${ angle } ${ x } ${ z })"/>`;

	} ).join( '' );

	const viewBox = `${ - width / 2 } ${ - depth / 2 } ${ width } ${ depth }`;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ viewBox }" role="img" aria-label="${ escape( title ) }" preserveAspectRatio="xMidYMid meet"><title>${ escape( title ) }</title>${ shapes }</svg>`;

}

export { createPreviewSVG };
