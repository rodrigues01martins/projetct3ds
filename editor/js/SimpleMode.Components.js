// EV-003 — Biblioteca Inteligente de Componentes 3D
//
// Definições declarativas dos componentes paramétricos (sem nenhum código de renderização).
// Cada definição descreve: identificador estável, versão do modelo, nome, categoria, parâmetros
// (em metros), limites, validação cruzada, migração de versões antigas e as PEÇAS que a fábrica
// (SimpleMode.ComponentFactory.js) transforma em malhas Three.js.
//
// Convenção de origem: centro da base (y = 0 apoiado no plano de referência).
// Eixos: largura = X, altura = Y, profundidade/espessura = Z.

const CATEGORIES = [
	{ id: 'structures', name: 'Estruturas' },
	{ id: 'openings', name: 'Aberturas' },
	{ id: 'furniture', name: 'Mobiliário' },
	{ id: 'modular', name: 'Estruturas modulares' }
];

// tipos de parâmetro: 'length' (metros), 'integer', 'color' ('#rrggbb')
// dimension: eixo físico ('x' | 'y' | 'z') -> aparece na seção Dimensões
// material: (cores) chave do material que a cor define; um acabamento da EV-004 nessa parte tem prioridade

const COMPONENTS = [

	// C01 ------------------------------------------------------------------
	{
		id: 'wall',
		version: 1,
		name: 'Parede',
		category: 'structures',
		icon: 'wall',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 3, min: 0.1, max: 30 },
			{ key: 'height', label: 'Altura', type: 'length', dimension: 'y', default: 2.7, min: 0.1, max: 10 },
			{ key: 'thickness', label: 'Espessura', type: 'length', dimension: 'z', default: 0.15, min: 0.01, max: 2 },
			{ key: 'color', label: 'Cor', type: 'color', material: 'main', default: '#e8e4dc' }
		],
		materials: ( p ) => ( { main: { label: 'Parede', color: p.color, roughness: 0.9 } } ),
		parts: ( p ) => [
			{ id: 'parede', label: 'Parede', size: [ p.width, p.height, p.thickness ], position: [ 0, p.height / 2, 0 ], material: 'main' }
		]
	},

	// C02 ------------------------------------------------------------------
	{
		id: 'floor',
		version: 1,
		name: 'Piso',
		category: 'structures',
		icon: 'floor',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 4, min: 0.1, max: 50 },
			{ key: 'thickness', label: 'Espessura', type: 'length', dimension: 'y', default: 0.15, min: 0.01, max: 2 },
			{ key: 'depth', label: 'Profundidade', type: 'length', dimension: 'z', default: 4, min: 0.1, max: 50 },
			{ key: 'color', label: 'Cor', type: 'color', material: 'main', default: '#b9a58a' }
		],
		materials: ( p ) => ( { main: { label: 'Piso', color: p.color, roughness: 0.85 } } ),
		parts: ( p ) => [
			{ id: 'piso', label: 'Piso', size: [ p.width, p.thickness, p.depth ], position: [ 0, p.thickness / 2, 0 ], material: 'main' }
		]
	},

	// C03 ------------------------------------------------------------------
	{
		id: 'panel',
		version: 1,
		name: 'Painel / divisória',
		category: 'structures',
		icon: 'panel',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 2, min: 0.1, max: 20 },
			{ key: 'height', label: 'Altura', type: 'length', dimension: 'y', default: 2, min: 0.1, max: 10 },
			{ key: 'thickness', label: 'Espessura', type: 'length', dimension: 'z', default: 0.05, min: 0.005, max: 0.5 },
			{ key: 'color', label: 'Cor', type: 'color', material: 'main', default: '#9fb7c9' }
		],
		materials: ( p ) => ( { main: { label: 'Painel', color: p.color, roughness: 0.6 } } ),
		parts: ( p ) => [
			{ id: 'painel', label: 'Painel', size: [ p.width, p.height, p.thickness ], position: [ 0, p.height / 2, 0 ], material: 'main' }
		]
	},

	// C04 ------------------------------------------------------------------
	{
		id: 'door',
		version: 1,
		name: 'Porta',
		category: 'openings',
		icon: 'door',
		parameters: [
			{ key: 'width', label: 'Largura (com batente)', type: 'length', dimension: 'x', default: 0.9, min: 0.4, max: 3 },
			{ key: 'height', label: 'Altura (com batente)', type: 'length', dimension: 'y', default: 2.1, min: 1, max: 4 },
			{ key: 'leafThickness', label: 'Espessura da folha', type: 'length', default: 0.04, min: 0.01, max: 0.15 },
			{ key: 'frameWidth', label: 'Largura do batente', type: 'length', default: 0.05, min: 0.01, max: 0.3 },
			{ key: 'frameDepth', label: 'Profundidade do batente', type: 'length', dimension: 'z', default: 0.12, min: 0.02, max: 0.5 },
			{ key: 'leafColor', label: 'Cor da folha', type: 'color', material: 'leaf', default: '#a47148' },
			{ key: 'frameColor', label: 'Cor do batente', type: 'color', material: 'frame', default: '#f2f2f2' }
		],
		validate: ( p ) => {

			if ( p.leafThickness > p.frameDepth ) return 'A espessura da folha não pode ser maior que a profundidade do batente.';
			if ( p.width - 2 * p.frameWidth < 0.2 ) return 'O batente está largo demais para essa largura de porta.';
			if ( p.height - p.frameWidth < 0.5 ) return 'O batente está largo demais para essa altura de porta.';
			return null;

		},
		materials: ( p ) => ( {
			leaf: { label: 'Folha', color: p.leafColor, roughness: 0.7 },
			frame: { label: 'Batente', color: p.frameColor, roughness: 0.6 },
			handle: { label: 'Maçaneta', color: '#8c8c8c', roughness: 0.3, metalness: 0.8 }
		} ),
		parts: ( p ) => {

			const gap = 0.003; // folga entre folha e batente
			const leafWidth = p.width - 2 * p.frameWidth - 2 * gap;
			const leafHeight = p.height - p.frameWidth - gap;
			const handleY = Math.min( 1.05, leafHeight * 0.5 );
			const handleX = leafWidth / 2 - Math.min( 0.07, leafWidth * 0.15 );

			return [
				{ id: 'batente-esquerdo', label: 'Batente esquerdo', size: [ p.frameWidth, p.height, p.frameDepth ], position: [ - ( p.width - p.frameWidth ) / 2, p.height / 2, 0 ], material: 'frame' },
				{ id: 'batente-direito', label: 'Batente direito', size: [ p.frameWidth, p.height, p.frameDepth ], position: [ ( p.width - p.frameWidth ) / 2, p.height / 2, 0 ], material: 'frame' },
				{ id: 'batente-superior', label: 'Batente superior', size: [ p.width - 2 * p.frameWidth, p.frameWidth, p.frameDepth ], position: [ 0, p.height - p.frameWidth / 2, 0 ], material: 'frame' },
				{ id: 'folha', label: 'Folha', size: [ leafWidth, leafHeight, p.leafThickness ], position: [ 0, leafHeight / 2, 0 ], material: 'leaf' },
				{ id: 'macaneta', label: 'Maçaneta', size: [ 0.1, 0.02, p.leafThickness + 0.06 ], position: [ handleX - 0.03, handleY, 0 ], material: 'handle' }
			];

		}
	},

	// C05 ------------------------------------------------------------------
	{
		id: 'window',
		version: 1,
		name: 'Janela',
		category: 'openings',
		icon: 'window',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 1.2, min: 0.2, max: 6 },
			{ key: 'height', label: 'Altura', type: 'length', dimension: 'y', default: 1, min: 0.2, max: 4 },
			{ key: 'depth', label: 'Profundidade', type: 'length', dimension: 'z', default: 0.08, min: 0.02, max: 0.5 },
			{ key: 'sill', label: 'Altura do peitoril (do chão)', type: 'length', default: 1, min: 0, max: 5 },
			{ key: 'frameWidth', label: 'Largura da moldura', type: 'length', default: 0.05, min: 0.01, max: 0.3 },
			{ key: 'frameColor', label: 'Cor da moldura', type: 'color', material: 'frame', default: '#ffffff' },
			{ key: 'glassColor', label: 'Cor do vidro', type: 'color', material: 'glass', default: '#a8d8ff' }
		],
		validate: ( p ) => {

			if ( p.width - 2 * p.frameWidth < 0.05 || p.height - 2 * p.frameWidth < 0.05 ) return 'A moldura está larga demais para o tamanho da janela.';
			return null;

		},
		materials: ( p ) => ( {
			frame: { label: 'Moldura', color: p.frameColor, roughness: 0.5 },
			glass: { label: 'Vidro', color: p.glassColor, roughness: 0.05, transparent: true, opacity: 0.35 }
		} ),
		parts: ( p ) => {

			const innerWidth = p.width - 2 * p.frameWidth;
			const innerHeight = p.height - 2 * p.frameWidth;
			const base = p.sill;

			return [
				{ id: 'moldura-inferior', label: 'Moldura inferior', size: [ p.width, p.frameWidth, p.depth ], position: [ 0, base + p.frameWidth / 2, 0 ], material: 'frame' },
				{ id: 'moldura-superior', label: 'Moldura superior', size: [ p.width, p.frameWidth, p.depth ], position: [ 0, base + p.height - p.frameWidth / 2, 0 ], material: 'frame' },
				{ id: 'moldura-esquerda', label: 'Moldura esquerda', size: [ p.frameWidth, innerHeight, p.depth ], position: [ - ( p.width - p.frameWidth ) / 2, base + p.height / 2, 0 ], material: 'frame' },
				{ id: 'moldura-direita', label: 'Moldura direita', size: [ p.frameWidth, innerHeight, p.depth ], position: [ ( p.width - p.frameWidth ) / 2, base + p.height / 2, 0 ], material: 'frame' },
				{ id: 'vidro', label: 'Vidro', size: [ innerWidth, innerHeight, Math.min( 0.01, p.depth / 2 ) ], position: [ 0, base + p.height / 2, 0 ], material: 'glass' }
			];

		}
	},

	// C06 ------------------------------------------------------------------
	{
		id: 'table',
		version: 1,
		name: 'Mesa',
		category: 'furniture',
		icon: 'table',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 1.2, min: 0.3, max: 5 },
			{ key: 'height', label: 'Altura', type: 'length', dimension: 'y', default: 0.75, min: 0.2, max: 1.5 },
			{ key: 'depth', label: 'Profundidade', type: 'length', dimension: 'z', default: 0.6, min: 0.3, max: 3 },
			{ key: 'topThickness', label: 'Espessura do tampo', type: 'length', default: 0.03, min: 0.01, max: 0.15 },
			{ key: 'legThickness', label: 'Espessura das pernas', type: 'length', default: 0.05, min: 0.02, max: 0.2 },
			{ key: 'legInset', label: 'Recuo das pernas', type: 'length', default: 0.05, min: 0, max: 0.5 },
			{ key: 'topColor', label: 'Cor do tampo', type: 'color', material: 'top', default: '#c8a27a' },
			{ key: 'legColor', label: 'Cor das pernas', type: 'color', material: 'legs', default: '#5b4636' }
		],
		validate: ( p ) => {

			if ( p.topThickness >= p.height - 0.05 ) return 'O tampo está espesso demais para essa altura.';
			if ( 2 * ( p.legInset + p.legThickness ) >= Math.min( p.width, p.depth ) ) return 'As pernas não cabem: reduza o recuo ou a espessura das pernas.';
			return null;

		},
		materials: ( p ) => ( {
			top: { label: 'Tampo', color: p.topColor, roughness: 0.6 },
			legs: { label: 'Pernas', color: p.legColor, roughness: 0.7 }
		} ),
		parts: ( p ) => {

			const legHeight = p.height - p.topThickness;
			const lx = p.width / 2 - p.legInset - p.legThickness / 2;
			const lz = p.depth / 2 - p.legInset - p.legThickness / 2;
			const leg = ( id, label, x, z ) => ( { id, label, size: [ p.legThickness, legHeight, p.legThickness ], position: [ x, legHeight / 2, z ], material: 'legs' } );

			return [
				{ id: 'tampo', label: 'Tampo', size: [ p.width, p.topThickness, p.depth ], position: [ 0, p.height - p.topThickness / 2, 0 ], material: 'top' },
				leg( 'perna-1', 'Perna 01', - lx, - lz ),
				leg( 'perna-2', 'Perna 02', lx, - lz ),
				leg( 'perna-3', 'Perna 03', lx, lz ),
				leg( 'perna-4', 'Perna 04', - lx, lz )
			];

		}
	},

	// C07 ------------------------------------------------------------------
	{
		id: 'chair',
		version: 1,
		name: 'Cadeira',
		category: 'furniture',
		icon: 'chair',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 0.45, min: 0.25, max: 1.2 },
			{ key: 'height', label: 'Altura total', type: 'length', dimension: 'y', default: 0.9, min: 0.4, max: 1.6 },
			{ key: 'depth', label: 'Profundidade', type: 'length', dimension: 'z', default: 0.5, min: 0.25, max: 1.2 },
			{ key: 'seatHeight', label: 'Altura do assento', type: 'length', default: 0.45, min: 0.15, max: 1 },
			{ key: 'seatThickness', label: 'Espessura do assento', type: 'length', default: 0.04, min: 0.01, max: 0.15 },
			{ key: 'legThickness', label: 'Espessura dos suportes', type: 'length', default: 0.035, min: 0.01, max: 0.1 },
			{ key: 'seatColor', label: 'Cor do assento e encosto', type: 'color', material: 'seat', default: '#d9d2c5' },
			{ key: 'frameColor', label: 'Cor dos suportes', type: 'color', material: 'frame', default: '#4a4a4a' }
		],
		validate: ( p ) => {

			if ( p.seatHeight > p.height - 0.1 ) return 'O assento precisa ficar pelo menos 10 cm abaixo da altura total.';
			if ( p.seatThickness >= p.seatHeight - 0.05 ) return 'O assento está espesso demais para essa altura.';
			if ( 3 * p.legThickness >= Math.min( p.width, p.depth ) ) return 'Os suportes estão espessos demais para o tamanho da cadeira.';
			return null;

		},
		materials: ( p ) => ( {
			seat: { label: 'Assento e encosto', color: p.seatColor, roughness: 0.8 },
			frame: { label: 'Suportes', color: p.frameColor, roughness: 0.5, metalness: 0.3 }
		} ),
		parts: ( p ) => {

			const t = p.legThickness;
			const lx = p.width / 2 - t / 2;
			const lz = p.depth / 2 - t / 2;
			const frontLeg = p.seatHeight - p.seatThickness;
			const backHeight = Math.min( 0.35, ( p.height - p.seatHeight ) * 0.7 );
			const backThickness = Math.min( 0.03, t );

			return [
				{ id: 'assento', label: 'Assento', size: [ p.width, p.seatThickness, p.depth ], position: [ 0, p.seatHeight - p.seatThickness / 2, 0 ], material: 'seat' },
				{ id: 'encosto', label: 'Encosto', size: [ p.width - 2 * t, backHeight, backThickness ], position: [ 0, p.height - backHeight / 2, - lz ], material: 'seat' },
				{ id: 'suporte-frontal-esquerdo', label: 'Suporte frontal esquerdo', size: [ t, frontLeg, t ], position: [ - lx, frontLeg / 2, lz ], material: 'frame' },
				{ id: 'suporte-frontal-direito', label: 'Suporte frontal direito', size: [ t, frontLeg, t ], position: [ lx, frontLeg / 2, lz ], material: 'frame' },
				{ id: 'suporte-traseiro-esquerdo', label: 'Suporte traseiro esquerdo', size: [ t, p.height, t ], position: [ - lx, p.height / 2, - lz ], material: 'frame' },
				{ id: 'suporte-traseiro-direito', label: 'Suporte traseiro direito', size: [ t, p.height, t ], position: [ lx, p.height / 2, - lz ], material: 'frame' }
			];

		}
	},

	// C08 ------------------------------------------------------------------
	{
		id: 'shelf',
		version: 1,
		name: 'Estante',
		category: 'furniture',
		icon: 'shelf',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 0.9, min: 0.2, max: 4 },
			{ key: 'height', label: 'Altura', type: 'length', dimension: 'y', default: 1.8, min: 0.2, max: 3.5 },
			{ key: 'depth', label: 'Profundidade', type: 'length', dimension: 'z', default: 0.35, min: 0.1, max: 1.2 },
			{ key: 'shelves', label: 'Quantidade de prateleiras', type: 'integer', default: 5, min: 2, max: 12, hint: 'Inclui a base e o topo.' },
			{ key: 'boardThickness', label: 'Espessura das placas', type: 'length', default: 0.018, min: 0.005, max: 0.08 },
			{ key: 'color', label: 'Cor', type: 'color', material: 'main', default: '#e0d2b8' }
		],
		validate: ( p ) => {

			if ( ( p.height - p.boardThickness ) / ( p.shelves - 1 ) < Math.max( 0.06, p.boardThickness * 2 ) ) return 'Prateleiras demais para essa altura: o espaço entre elas ficaria menor que 6 cm.';
			if ( p.width - 2 * p.boardThickness < 0.05 ) return 'As placas estão espessas demais para essa largura.';
			return null;

		},
		materials: ( p ) => ( { main: { label: 'Estante', color: p.color, roughness: 0.75 } } ),
		parts: ( p ) => {

			const t = p.boardThickness;
			const innerWidth = p.width - 2 * t;
			const step = ( p.height - t ) / ( p.shelves - 1 );
			const parts = [
				{ id: 'lateral-esquerda', label: 'Lateral esquerda', size: [ t, p.height, p.depth ], position: [ - ( p.width - t ) / 2, p.height / 2, 0 ], material: 'main' },
				{ id: 'lateral-direita', label: 'Lateral direita', size: [ t, p.height, p.depth ], position: [ ( p.width - t ) / 2, p.height / 2, 0 ], material: 'main' },
				{ id: 'fundo', label: 'Fundo', size: [ innerWidth, p.height, Math.min( 0.006, t ) ], position: [ 0, p.height / 2, - p.depth / 2 + Math.min( 0.006, t ) / 2 ], material: 'main' }
			];

			for ( let i = 0; i < p.shelves; i ++ ) {

				parts.push( { id: 'prateleira-' + ( i + 1 ), label: 'Prateleira ' + String( i + 1 ).padStart( 2, '0' ), size: [ innerWidth, t, p.depth ], position: [ 0, t / 2 + step * i, 0 ], material: 'main' } );

			}

			return parts;

		}
	},

	// C09 ------------------------------------------------------------------
	{
		id: 'platform',
		version: 1,
		name: 'Plataforma',
		category: 'modular',
		icon: 'platform',
		parameters: [
			{ key: 'width', label: 'Largura', type: 'length', dimension: 'x', default: 2, min: 0.2, max: 30 },
			{ key: 'height', label: 'Altura', type: 'length', dimension: 'y', default: 0.4, min: 0.02, max: 3 },
			{ key: 'depth', label: 'Profundidade', type: 'length', dimension: 'z', default: 1, min: 0.2, max: 30 },
			{ key: 'topColor', label: 'Cor do tampo', type: 'color', material: 'top', default: '#6f7680' },
			{ key: 'baseColor', label: 'Cor da base', type: 'color', material: 'base', default: '#3f444b' }
		],
		materials: ( p ) => ( {
			top: { label: 'Tampo', color: p.topColor, roughness: 0.8 },
			base: { label: 'Base', color: p.baseColor, roughness: 0.8 }
		} ),
		parts: ( p ) => {

			const topThickness = Math.min( 0.04, p.height * 0.25 );
			const inset = Math.min( 0.02, p.width * 0.05, p.depth * 0.05 );
			const baseHeight = p.height - topThickness;

			return [
				{ id: 'tampo', label: 'Tampo', size: [ p.width, topThickness, p.depth ], position: [ 0, p.height - topThickness / 2, 0 ], material: 'top' },
				{ id: 'base', label: 'Base', size: [ p.width - 2 * inset, baseHeight, p.depth - 2 * inset ], position: [ 0, baseHeight / 2, 0 ], material: 'base' }
			];

		}
	}

];

const COMPONENT_MAP = new Map( COMPONENTS.map( ( definition ) => [ definition.id, definition ] ) );

function getDefinition( id ) {

	return COMPONENT_MAP.get( id ) || null;

}

function getCategory( id ) {

	return CATEGORIES.find( ( category ) => category.id === id ) || null;

}

function getDefaultParameters( definition ) {

	const parameters = {};
	for ( const parameter of definition.parameters ) parameters[ parameter.key ] = parameter.default;
	return parameters;

}

// Migração de parâmetros de versões anteriores do mesmo componente.
// Hoje todos estão na versão 1; versões futuras devem tratar aqui os parâmetros renomeados/novos.
// Parâmetros ausentes recebem o valor padrão; desconhecidos são descartados apenas na cópia (o original não é alterado).

function migrateParameters( definition, parameters, version ) {

	const migrated = getDefaultParameters( definition );

	if ( version > definition.version ) return null; // criado por uma versão mais nova do aplicativo

	for ( const parameter of definition.parameters ) {

		if ( parameters !== null && typeof parameters === 'object' && parameters[ parameter.key ] !== undefined ) {

			migrated[ parameter.key ] = parameters[ parameter.key ];

		}

	}

	return migrated;

}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// Valida um conjunto completo de parâmetros. Retorna null (válido) ou { key, message }.

function validateParameters( definition, parameters ) {

	for ( const parameter of definition.parameters ) {

		const value = parameters[ parameter.key ];

		if ( parameter.type === 'color' ) {

			if ( typeof value !== 'string' || COLOR_PATTERN.test( value ) === false ) return { key: parameter.key, message: 'Cor inválida.' };
			continue;

		}

		if ( typeof value !== 'number' || Number.isFinite( value ) === false ) return { key: parameter.key, message: 'Valor inválido.' };
		if ( parameter.type === 'integer' && Number.isInteger( value ) === false ) return { key: parameter.key, message: 'Use um número inteiro.' };
		if ( value < parameter.min || value > parameter.max ) return { key: parameter.key, range: true, message: 'Fora do limite permitido.' };

	}

	if ( typeof definition.validate === 'function' ) {

		const message = definition.validate( parameters );
		if ( message !== null ) return { key: null, message };

	}

	return null;

}

// tamanho físico (metros) a partir dos parâmetros de dimensão
function getParameterSize( definition, parameters ) {

	const size = { x: 0, y: 0, z: 0 };

	for ( const parameter of definition.parameters ) {

		if ( parameter.dimension !== undefined ) size[ parameter.dimension ] = parameters[ parameter.key ];

	}

	return size;

}

export { CATEGORIES, COMPONENTS, getDefinition, getCategory, getDefaultParameters, migrateParameters, validateParameters, getParameterSize };
