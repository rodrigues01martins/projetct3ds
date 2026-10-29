// EV-005 — Galeria de Projetos Prontos e Modelos Iniciais 3D
//
// Definições declarativas e versionadas dos projetos prontos: apenas dados (nenhuma função),
// equivalentes a JSON. Usam somente componentes existentes em SimpleMode.Components.js.
//
// Convenções (iguais às da EV-003):
//   - medidas em metros; origem de cada componente no centro da base;
//   - o piso fica em y = 0 com espessura FLOOR (0,10 m): móveis, paredes e painéis começam em y = 0,10,
//     sobre a superfície do piso (nunca dentro da sua espessura);
//   - rotation em graus (X, Y, Z); appearance: { <parte>: <id do acabamento da EV-004> };
//   - não há recortes automáticos: portas e janelas nunca são sobrepostas a paredes contínuas.
//
// camera (opcional): { direction: [x, y, z] } — direção de onde a câmera olha o conjunto (enquadramento automático).

const TEMPLATE_CATEGORIES = [
	{ id: 'rooms', name: 'Ambientes' },
	{ id: 'offices', name: 'Escritórios' },
	{ id: 'events', name: 'Exposições e eventos' }
];

const LIMITS = { components: 40 };

const FLOOR = 0.1; // espessura do piso dos modelos
const WALL = 0.12; // espessura das paredes dos modelos
const PANEL = 0.05; // espessura dos painéis modulares

const NEUTRAL_WALL = '#efece6';
const WHITE_PANEL = '#f4f3f0';

const TEMPLATES = [

	// MODELO 01 ------------------------------------------------------------------------------------
	{
		id: 'room-basic',
		version: 1,
		name: 'Ambiente básico',
		category: 'rooms',
		description: 'Piso de madeira com duas paredes neutras: um espaço simples para começar a distribuir móveis.',
		area: { width: 4, depth: 4 },
		units: 'cm',
		lighting: 'daylight',
		components: [
			{ component: 'floor', name: 'Piso', parameters: { width: 4, depth: 4, thickness: FLOOR }, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], appearance: { main: 'wood-light' } },
			{ component: 'wall', name: 'Parede de fundo', parameters: { width: 4, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ 0, FLOOR, - 2 + WALL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'wall', name: 'Parede lateral', parameters: { width: 4 - WALL, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ - 2 + WALL / 2, FLOOR, WALL / 2 ], rotation: [ 0, 90, 0 ] }
		]
	},

	// MODELO 02 ------------------------------------------------------------------------------------
	{
		id: 'office-compact',
		version: 1,
		name: 'Escritório compacto',
		category: 'offices',
		description: 'Estação de trabalho com mesa, cadeira, estante e painel decorativo.',
		area: { width: 4, depth: 3 },
		units: 'cm',
		lighting: 'interior',
		components: [
			{ component: 'floor', name: 'Piso', parameters: { width: 4, depth: 3, thickness: FLOOR }, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], appearance: { main: 'concrete' } },
			{ component: 'wall', name: 'Parede de fundo', parameters: { width: 4, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ 0, FLOOR, - 1.5 + WALL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'wall', name: 'Parede lateral', parameters: { width: 3 - WALL, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ - 2 + WALL / 2, FLOOR, WALL / 2 ], rotation: [ 0, 90, 0 ] },
			{ component: 'table', name: 'Mesa de trabalho', parameters: { width: 1.4, height: 0.75, depth: 0.7 }, position: [ 0.2, FLOOR, - 1.0 ], rotation: [ 0, 0, 0 ], appearance: { top: 'wood-light', legs: 'steel-brushed' } },
			{ component: 'chair', name: 'Cadeira', parameters: {}, position: [ 0.2, FLOOR, - 0.35 ], rotation: [ 0, 180, 0 ], appearance: { seat: 'fabric', frame: 'metal-dark' } },
			{ component: 'shelf', name: 'Estante', parameters: { width: 0.9, height: 1.8, depth: 0.35, shelves: 5 }, position: [ - 2 + WALL + 0.175, FLOOR, 0.6 ], rotation: [ 0, 90, 0 ], appearance: { main: 'wood-dark' } },
			{ component: 'panel', name: 'Painel decorativo', parameters: { width: 0.9, height: 0.6, thickness: 0.03 }, position: [ 1.3, FLOOR + 1.1, - 1.5 + WALL + 0.015 ], rotation: [ 0, 0, 0 ], appearance: { main: 'wood-red' } }
		]
	},

	// MODELO 03 ------------------------------------------------------------------------------------
	{
		id: 'meeting-room',
		version: 1,
		name: 'Sala de reuniões',
		category: 'offices',
		description: 'Duas mesas unidas, quatro cadeiras e um painel para apresentações.',
		area: { width: 6, depth: 4 },
		units: 'cm',
		lighting: 'studio',
		components: [
			{ component: 'floor', name: 'Piso', parameters: { width: 6, depth: 4, thickness: FLOOR }, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], appearance: { main: 'ceramic' } },
			{ component: 'wall', name: 'Parede de fundo', parameters: { width: 6, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ 0, FLOOR, - 2 + WALL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'wall', name: 'Parede esquerda', parameters: { width: 4 - WALL, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ - 3 + WALL / 2, FLOOR, WALL / 2 ], rotation: [ 0, 90, 0 ] },
			{ component: 'wall', name: 'Parede direita', parameters: { width: 4 - WALL, height: 2.7, thickness: WALL, color: NEUTRAL_WALL }, position: [ 3 - WALL / 2, FLOOR, WALL / 2 ], rotation: [ 0, 90, 0 ] },
			{ component: 'table', name: 'Mesa 01', parameters: { width: 1.4, height: 0.75, depth: 0.9 }, position: [ - 0.7, FLOOR, 0.2 ], rotation: [ 0, 0, 0 ], appearance: { top: 'wood-light', legs: 'aluminum' } },
			{ component: 'table', name: 'Mesa 02', parameters: { width: 1.4, height: 0.75, depth: 0.9 }, position: [ 0.7, FLOOR, 0.2 ], rotation: [ 0, 0, 0 ], appearance: { top: 'wood-light', legs: 'aluminum' } },
			{ component: 'chair', name: 'Cadeira 01', parameters: {}, position: [ - 0.7, FLOOR, - 0.55 ], rotation: [ 0, 0, 0 ], appearance: { seat: 'fabric', frame: 'aluminum' } },
			{ component: 'chair', name: 'Cadeira 02', parameters: {}, position: [ 0.7, FLOOR, - 0.55 ], rotation: [ 0, 0, 0 ], appearance: { seat: 'fabric', frame: 'aluminum' } },
			{ component: 'chair', name: 'Cadeira 03', parameters: {}, position: [ - 0.7, FLOOR, 0.95 ], rotation: [ 0, 180, 0 ], appearance: { seat: 'fabric', frame: 'aluminum' } },
			{ component: 'chair', name: 'Cadeira 04', parameters: {}, position: [ 0.7, FLOOR, 0.95 ], rotation: [ 0, 180, 0 ], appearance: { seat: 'fabric', frame: 'aluminum' } },
			{ component: 'panel', name: 'Painel de apresentação', parameters: { width: 2, height: 1.2, thickness: 0.03, color: '#2b2f36' }, position: [ 0, FLOOR + 0.9, - 2 + WALL + 0.015 ], rotation: [ 0, 0, 0 ] }
		]
	},

	// MODELO 04 ------------------------------------------------------------------------------------
	{
		id: 'booth-modular',
		version: 1,
		name: 'Estande modular',
		category: 'events',
		description: 'Painéis modulares, plataforma de exposição, balcão e duas cadeiras. Representação visual, sem cálculo estrutural.',
		area: { width: 3, depth: 3 },
		units: 'cm',
		lighting: 'studio',
		components: [
			{ component: 'floor', name: 'Piso', parameters: { width: 3, depth: 3, thickness: FLOOR }, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], appearance: { main: 'concrete' } },
			{ component: 'panel', name: 'Painel de fundo 01', parameters: { width: 1, height: 2.4, thickness: PANEL, color: WHITE_PANEL }, position: [ - 1, FLOOR, - 1.5 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 02', parameters: { width: 1, height: 2.4, thickness: PANEL, color: WHITE_PANEL }, position: [ 0, FLOOR, - 1.5 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 03', parameters: { width: 1, height: 2.4, thickness: PANEL, color: WHITE_PANEL }, position: [ 1, FLOOR, - 1.5 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel lateral 01', parameters: { width: 1, height: 2.4, thickness: PANEL, color: WHITE_PANEL }, position: [ - 1.5 + PANEL / 2, FLOOR, - 0.95 ], rotation: [ 0, 90, 0 ] },
			{ component: 'panel', name: 'Painel lateral 02', parameters: { width: 1, height: 2.4, thickness: PANEL, color: WHITE_PANEL }, position: [ - 1.5 + PANEL / 2, FLOOR, 0.05 ], rotation: [ 0, 90, 0 ] },
			{ component: 'platform', name: 'Plataforma de exposição', parameters: { width: 1.6, height: 0.15, depth: 0.9 }, position: [ 0.5, FLOOR, - 0.9 ], rotation: [ 0, 0, 0 ], appearance: { top: 'wood-light', base: 'metal-dark' } },
			{ component: 'table', name: 'Balcão', parameters: { width: 1, height: 0.75, depth: 0.6 }, position: [ - 0.3, FLOOR, 0.6 ], rotation: [ 0, 0, 0 ], appearance: { top: 'plastic', legs: 'steel-brushed' } },
			{ component: 'chair', name: 'Cadeira 01', parameters: {}, position: [ - 0.55, FLOOR, 1.2 ], rotation: [ 0, 180, 0 ], appearance: { frame: 'steel-brushed' } },
			{ component: 'chair', name: 'Cadeira 02', parameters: {}, position: [ - 0.05, FLOOR, 1.2 ], rotation: [ 0, 180, 0 ], appearance: { frame: 'steel-brushed' } }
		]
	},

	// MODELO 05 ------------------------------------------------------------------------------------
	{
		id: 'exhibition-space',
		version: 1,
		name: 'Espaço de exposição',
		category: 'events',
		description: 'Painéis brancos, estantes de madeira e três plataformas para distribuir produtos e objetos.',
		area: { width: 5, depth: 4 },
		units: 'cm',
		lighting: 'studio',
		components: [
			{ component: 'floor', name: 'Piso', parameters: { width: 5, depth: 4, thickness: FLOOR }, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], appearance: { main: 'concrete' } },
			{ component: 'panel', name: 'Painel de fundo 01', parameters: { width: 1.25, height: 2.4, thickness: PANEL, color: '#ffffff' }, position: [ - 1.875, FLOOR, - 2 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 02', parameters: { width: 1.25, height: 2.4, thickness: PANEL, color: '#ffffff' }, position: [ - 0.625, FLOOR, - 2 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 03', parameters: { width: 1.25, height: 2.4, thickness: PANEL, color: '#ffffff' }, position: [ 0.625, FLOOR, - 2 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 04', parameters: { width: 1.25, height: 2.4, thickness: PANEL, color: '#ffffff' }, position: [ 1.875, FLOOR, - 2 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'shelf', name: 'Estante 01', parameters: { width: 0.9, height: 1.8, depth: 0.35, shelves: 5 }, position: [ - 1.5, FLOOR, - 2 + PANEL + 0.175 ], rotation: [ 0, 0, 0 ], appearance: { main: 'wood-light' } },
			{ component: 'shelf', name: 'Estante 02', parameters: { width: 0.9, height: 1.8, depth: 0.35, shelves: 5 }, position: [ 1.5, FLOOR, - 2 + PANEL + 0.175 ], rotation: [ 0, 0, 0 ], appearance: { main: 'wood-light' } },
			{ component: 'platform', name: 'Plataforma 01', parameters: { width: 0.6, height: 0.4, depth: 0.6 }, position: [ - 1.2, FLOOR, 0.3 ], rotation: [ 0, 0, 0 ], appearance: { top: 'plastic', base: 'plastic' } },
			{ component: 'platform', name: 'Plataforma 02', parameters: { width: 0.6, height: 0.6, depth: 0.6 }, position: [ 0, FLOOR, 0.3 ], rotation: [ 0, 0, 0 ], appearance: { top: 'plastic', base: 'plastic' } },
			{ component: 'platform', name: 'Plataforma 03', parameters: { width: 0.6, height: 0.8, depth: 0.6 }, position: [ 1.2, FLOOR, 0.3 ], rotation: [ 0, 0, 0 ], appearance: { top: 'plastic', base: 'plastic' } }
		]
	},

	// MODELO 06 ------------------------------------------------------------------------------------
	{
		id: 'presentation-space',
		version: 1,
		name: 'Espaço de apresentação',
		category: 'events',
		description: 'Palco central escuro, painéis de fundo neutros e elementos laterais de composição.',
		area: { width: 6, depth: 5 },
		units: 'cm',
		lighting: 'studio',
		components: [
			{ component: 'floor', name: 'Piso', parameters: { width: 6, depth: 5, thickness: FLOOR }, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], appearance: { main: 'concrete' } },
			{ component: 'platform', name: 'Palco', parameters: { width: 3, height: 0.4, depth: 2 }, position: [ 0, FLOOR, - 0.9 ], rotation: [ 0, 0, 0 ], appearance: { top: 'wood-dark', base: 'metal-dark' } },
			{ component: 'panel', name: 'Painel de fundo 01', parameters: { width: 2, height: 3, thickness: PANEL, color: '#d9d7d2' }, position: [ - 2, FLOOR, - 2.5 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 02', parameters: { width: 2, height: 3, thickness: PANEL, color: '#d9d7d2' }, position: [ 0, FLOOR, - 2.5 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel de fundo 03', parameters: { width: 2, height: 3, thickness: PANEL, color: '#d9d7d2' }, position: [ 2, FLOOR, - 2.5 + PANEL / 2 ], rotation: [ 0, 0, 0 ] },
			{ component: 'panel', name: 'Painel lateral esquerdo', parameters: { width: 1, height: 2.4, thickness: PANEL, color: '#2f3339' }, position: [ - 2.4, FLOOR, 0.6 ], rotation: [ 0, 30, 0 ] },
			{ component: 'panel', name: 'Painel lateral direito', parameters: { width: 1, height: 2.4, thickness: PANEL, color: '#2f3339' }, position: [ 2.4, FLOOR, 0.6 ], rotation: [ 0, - 30, 0 ] },
			{ component: 'platform', name: 'Pedestal esquerdo', parameters: { width: 0.5, height: 0.9, depth: 0.5 }, position: [ - 2, FLOOR, - 0.9 ], rotation: [ 0, 0, 0 ], appearance: { top: 'aluminum', base: 'aluminum' } },
			{ component: 'platform', name: 'Pedestal direito', parameters: { width: 0.5, height: 0.9, depth: 0.5 }, position: [ 2, FLOOR, - 0.9 ], rotation: [ 0, 0, 0 ], appearance: { top: 'aluminum', base: 'aluminum' } }
		]
	}

];

function getTemplate( id ) {

	return TEMPLATES.find( ( template ) => template.id === id ) || null;

}

function getTemplateCategory( id ) {

	return TEMPLATE_CATEGORIES.find( ( category ) => category.id === id ) || null;

}

export { TEMPLATE_CATEGORIES, TEMPLATES, LIMITS as TEMPLATE_LIMITS, getTemplate, getTemplateCategory };
