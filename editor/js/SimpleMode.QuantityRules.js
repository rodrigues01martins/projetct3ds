// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Regras de medição: unidades, medições disponíveis por tipo de componente (com fórmula explícita), arredondamento
// e formatação. Três conceitos separados:
//   A. quantitativo geométrico — medida do modelo (SimpleMode.Quantities.js);
//   B. quantidade orçada — quantitativo × coeficiente (opcional) × (1 + perda) (SimpleMode.BudgetCalculator.js);
//   C. custo — quantidade orçada × preço unitário, em centavos inteiros.

const UNITS = {
	m: { id: 'm', label: 'm', name: 'metro', decimals: 2 },
	m2: { id: 'm2', label: 'm²', name: 'metro quadrado', decimals: 2 },
	m3: { id: 'm3', label: 'm³', name: 'metro cúbico', decimals: 4 },
	un: { id: 'un', label: 'un.', name: 'unidade', decimals: 2 },
	kg: { id: 'kg', label: 'kg', name: 'quilograma', decimals: 2 },
	L: { id: 'L', label: 'L', name: 'litro', decimals: 2 },
	vb: { id: 'vb', label: 'vb', name: 'verba', decimals: 2 }
};

// medições: rótulo, unidade e critério (exibido na interface e nas notas técnicas dos relatórios)
const MEASUREMENTS = {
	count: { label: 'Quantidade', unit: 'un', formula: '1 unidade por componente' },
	length: { label: 'Comprimento', unit: 'm', formula: 'largura do componente × escala efetiva' },
	width: { label: 'Largura', unit: 'm', formula: 'parâmetro largura × escala efetiva' },
	height: { label: 'Altura', unit: 'm', formula: 'parâmetro altura × escala efetiva' },
	depth: { label: 'Profundidade', unit: 'm', formula: 'parâmetro profundidade × escala efetiva' },
	thickness: { label: 'Espessura', unit: 'm', formula: 'parâmetro espessura × escala efetiva' },
	perimeter: { label: 'Perímetro', unit: 'm', formula: '2 × (largura + profundidade)' },
	grossArea: { label: 'Área bruta de uma face', unit: 'm2', formula: 'comprimento × altura' },
	openingsArea: { label: 'Área dos vãos', unit: 'm2', formula: 'soma(largura do vão × altura do vão)' },
	netArea: { label: 'Área líquida de uma face', unit: 'm2', formula: 'área bruta − área dos vãos' },
	netAreaTwoFaces: { label: 'Área líquida das duas faces principais', unit: 'm2', formula: '2 × área líquida de uma face (sem ombreiras, vergas, peitoris e encontros)' },
	grossVolume: { label: 'Volume bruto', unit: 'm3', formula: 'área bruta × espessura' },
	netVolume: { label: 'Volume líquido', unit: 'm3', formula: 'área líquida de uma face × espessura' },
	area: { label: 'Área', unit: 'm2', formula: 'largura × profundidade' },
	areaOneFace: { label: 'Área de uma face', unit: 'm2', formula: 'largura × altura' },
	areaTwoFaces: { label: 'Área das duas faces', unit: 'm2', formula: '2 × largura × altura' },
	topArea: { label: 'Área do tampo', unit: 'm2', formula: 'largura × profundidade' },
	volume: { label: 'Volume', unit: 'm3', formula: 'área × espessura (ou altura)' },
	openingArea: { label: 'Área do vão', unit: 'm2', formula: 'largura × altura' },
	boxVolume: { label: 'Volume da caixa envolvente (estimado)', unit: 'm3', formula: 'largura × altura × profundidade da caixa envolvente' }
};

// medição principal e medições oferecidas por tipo
const TYPES = {
	wall: { label: 'Parede', category: 'structures', prefix: 'PAR', primary: 'netArea', measurements: [ 'length', 'height', 'thickness', 'grossArea', 'openingsArea', 'netArea', 'netAreaTwoFaces', 'grossVolume', 'netVolume', 'count' ] },
	floor: { label: 'Piso', category: 'structures', prefix: 'PIS', primary: 'area', measurements: [ 'width', 'depth', 'thickness', 'area', 'perimeter', 'volume', 'count' ] },
	panel: { label: 'Painel / divisória', category: 'structures', prefix: 'PAI', primary: 'count', measurements: [ 'count', 'width', 'height', 'thickness', 'areaOneFace', 'areaTwoFaces', 'volume' ] },
	platform: { label: 'Plataforma', category: 'structures', prefix: 'PLA', primary: 'count', measurements: [ 'count', 'width', 'depth', 'height', 'topArea', 'volume' ] },
	door: { label: 'Porta', category: 'openings', prefix: 'POR', primary: 'count', measurements: [ 'count', 'width', 'height', 'openingArea' ] },
	window: { label: 'Janela', category: 'openings', prefix: 'JAN', primary: 'count', measurements: [ 'count', 'width', 'height', 'openingArea' ] },
	table: { label: 'Mesa', category: 'furniture', prefix: 'MES', primary: 'count', measurements: [ 'count', 'width', 'depth', 'height' ] },
	chair: { label: 'Cadeira', category: 'furniture', prefix: 'CAD', primary: 'count', measurements: [ 'count', 'width', 'depth', 'height' ] },
	shelf: { label: 'Estante', category: 'furniture', prefix: 'EST', primary: 'count', measurements: [ 'count', 'width', 'depth', 'height' ] },
	custom: { label: 'Componente personalizado', category: 'others', prefix: 'PER', primary: 'count', measurements: [ 'count', 'width', 'depth', 'height', 'boxVolume' ] },
	generic: { label: 'Objeto sem parâmetros', category: 'others', prefix: 'OUT', primary: 'count', measurements: [ 'count', 'width', 'depth', 'height', 'boxVolume' ] }
};

const CATEGORIES = {
	structures: 'Estruturas',
	finishes: 'Revestimentos',
	openings: 'Aberturas',
	furniture: 'Mobiliário',
	others: 'Outros'
};

const QUANTITY_CATEGORIES = [ 'structures', 'openings', 'furniture', 'others' ];

// arredondamento decimal sem erro binário (ex.: 1,005 → 1,01): usa notação exponencial em texto
function roundTo( value, decimals ) {

	if ( Number.isFinite( value ) === false ) return value;
	const sign = value < 0 ? - 1 : 1;
	return sign * Number( Math.round( Number( Math.abs( value ) + 'e' + decimals ) ) + 'e-' + decimals );

}

function decimalsOf( unit ) {

	return UNITS[ unit ] !== undefined ? UNITS[ unit ].decimals : 2;

}

const numberFormats = {};

function formatQuantity( value, unit, { withUnit = false } = {} ) {

	if ( value === null || value === undefined || Number.isFinite( value ) === false ) return '—';
	const decimals = decimalsOf( unit );
	const key = decimals + ( unit === 'un' ? ':un' : '' ); // unidades sem casas mínimas; m, m², m³ com casas fixas
	if ( numberFormats[ key ] === undefined ) numberFormats[ key ] = new Intl.NumberFormat( 'pt-BR', { minimumFractionDigits: unit === 'un' ? 0 : decimals, maximumFractionDigits: decimals } );
	const text = numberFormats[ key ].format( roundTo( value, decimals ) + 0 );
	return withUnit ? text + ' ' + unitLabel( unit ) : text;

}

function unitLabel( unit ) {

	return UNITS[ unit ] !== undefined ? UNITS[ unit ].label : unit;

}

function measurementLabel( key ) {

	return MEASUREMENTS[ key ] !== undefined ? MEASUREMENTS[ key ].label : key;

}

function measurementUnit( key ) {

	return MEASUREMENTS[ key ] !== undefined ? MEASUREMENTS[ key ].unit : null;

}

export { UNITS, MEASUREMENTS, TYPES, CATEGORIES, QUANTITY_CATEGORIES, roundTo, decimalsOf, formatQuantity, unitLabel, measurementLabel, measurementUnit };
