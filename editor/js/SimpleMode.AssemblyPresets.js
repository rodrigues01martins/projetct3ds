// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Conjuntos prontos (exemplos didáticos) montados SOMENTE com os componentes nativos da EV-003, com parâmetros
// dentro dos limites de cada componente. Não representam peças de fabricantes nem estruturas certificadas: são
// arranjos geométricos para mostrar como funciona a montagem modular.

import * as THREE from 'three';

import { createComponent, setMeta } from './SimpleMode.ComponentFactory.js';
import { createAssemblyMeta, connectorsMeta } from './SimpleMode.AssemblyData.js';

function place( id, params, name, position, rotationY = 0 ) {

	const object = createComponent( id, params );
	object.name = name;
	object.position.set( ...position );
	object.rotation.set( 0, THREE.MathUtils.degToRad( rotationY ), 0 );
	return object;

}

const PRESETS = [
	{
		id: 'preset-basic-stand',
		name: 'Estande Básico',
		category: 'stands',
		description: 'Plataforma 3 × 3 m, três painéis, mesa e duas cadeiras.',
		build() {

			const h = 0.2;
			return [
				place( 'platform', { width: 3, depth: 3, height: h }, 'Plataforma', [ 0, 0, 0 ] ),
				place( 'panel', { width: 3, height: 2.4, thickness: 0.05 }, 'Painel de fundo', [ 0, h, - 1.475 ] ),
				place( 'panel', { width: 2.9, height: 2.4, thickness: 0.05 }, 'Painel esquerdo', [ - 1.475, h, 0.025 ], 90 ),
				place( 'panel', { width: 2.9, height: 2.4, thickness: 0.05 }, 'Painel direito', [ 1.475, h, 0.025 ], 90 ),
				place( 'table', { width: 1.2, depth: 0.6, height: 0.75 }, 'Mesa', [ 0, h, 0.1 ] ),
				place( 'chair', {}, 'Cadeira 01', [ - 0.35, h, 0.75 ], 180 ),
				place( 'chair', {}, 'Cadeira 02', [ 0.35, h, 0.75 ], 180 )
			];

		}
	},
	{
		id: 'preset-meeting',
		name: 'Área de Reunião',
		category: 'rooms',
		description: 'Duas mesas, seis cadeiras e painel de apresentação.',
		build() {

			const items = [
				place( 'table', { width: 1.2, depth: 0.8, height: 0.75 }, 'Mesa 01', [ - 0.6, 0, 0 ] ),
				place( 'table', { width: 1.2, depth: 0.8, height: 0.75 }, 'Mesa 02', [ 0.6, 0, 0 ] ),
				place( 'panel', { width: 2, height: 1.4, thickness: 0.05 }, 'Painel de apresentação', [ 0, 0, - 1.4 ] )
			];
			[ - 0.8, 0, 0.8 ].forEach( ( x, i ) => {

				items.push( place( 'chair', {}, `Cadeira ${String( i * 2 + 1 ).padStart( 2, '0' )}`, [ x, 0, 0.75 ], 180 ) );
				items.push( place( 'chair', {}, `Cadeira ${String( i * 2 + 2 ).padStart( 2, '0' )}`, [ x, 0, - 0.75 ], 0 ) );

			} );
			return items;

		}
	},
	{
		id: 'preset-exhibition',
		name: 'Exposição Modular',
		category: 'exhibition',
		description: 'Duas plataformas, três painéis e duas estantes.',
		build() {

			const h = 0.3;
			return [
				place( 'platform', { width: 2, depth: 1.2, height: h }, 'Plataforma 01', [ - 1, 0, 0 ] ),
				place( 'platform', { width: 2, depth: 1.2, height: h }, 'Plataforma 02', [ 1, 0, 0 ] ),
				place( 'panel', { width: 1.3, height: 2.2, thickness: 0.05 }, 'Painel 01', [ - 1.35, 0, - 0.85 ] ),
				place( 'panel', { width: 1.3, height: 2.2, thickness: 0.05 }, 'Painel 02', [ 0, 0, - 0.85 ] ),
				place( 'panel', { width: 1.3, height: 2.2, thickness: 0.05 }, 'Painel 03', [ 1.35, 0, - 0.85 ] ),
				place( 'shelf', { width: 0.9, height: 1.8, depth: 0.35 }, 'Estante 01', [ - 1, h, - 0.3 ] ),
				place( 'shelf', { width: 0.9, height: 1.8, depth: 0.35 }, 'Estante 02', [ 1, h, - 0.3 ] )
			];

		}
	},
	{
		id: 'preset-partitions',
		name: 'Linha de Divisórias',
		category: 'modular',
		description: 'Cinco painéis de 1 m em linha, com encaixes laterais explícitos.',
		build() {

			const items = [];
			for ( let i = 0; i < 5; i ++ ) {

				const panel = place( 'panel', { width: 1, height: 2, thickness: 0.05 }, `Divisória ${String( i + 1 ).padStart( 2, '0' )}`, [ ( i - 2 ) * 1, 0, 0 ] );
				setMeta( panel, { connectors: connectorsMeta( [
					{ id: 'lado-esquerdo', name: 'Lado esquerdo', kind: 'edge', position: [ - 0.5, 0, 0 ], normal: [ - 1, 0, 0 ], up: [ 0, 1, 0 ], family: 'divisoria' },
					{ id: 'lado-direito', name: 'Lado direito', kind: 'edge', position: [ 0.5, 0, 0 ], normal: [ 1, 0, 0 ], up: [ 0, 1, 0 ], family: 'divisoria' }
				] ) } );
				items.push( panel );

			}

			return items;

		}
	}
];

// constrói um conjunto pronto (fora da cena): grupo com os componentes, origem no centro da base
function buildPreset( id ) {

	const preset = PRESETS.find( ( p ) => p.id === id );
	if ( preset === undefined ) return null;
	const group = new THREE.Group();
	const meta = createAssemblyMeta( { name: preset.name, category: preset.category } );
	group.name = preset.name;
	setMeta( group, { assembly: meta } );
	for ( const object of preset.build() ) group.add( object );
	group.updateMatrixWorld( true );
	return group;

}

export { PRESETS as ASSEMBLY_PRESETS, buildPreset };
