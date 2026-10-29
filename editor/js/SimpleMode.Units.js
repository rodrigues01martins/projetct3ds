// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
//
// Convenção do Modo Simples: 1 unidade Three.js = 1 metro.
// A unidade escolhida (mm, cm, m) altera apenas a *representação* dos números; a cena nunca é reescalonada.
// A unidade pertence ao projeto e fica em `scene.userData.project3ds.units` (serializado no JSON do editor).

const PROJECT_KEY = 'project3ds';
const DEFAULT_UNIT = 'cm';

// factor: quantas unidades de exibição cabem em 1 metro
// decimals: casas exibidas (todas equivalem a 0,1 mm de resolução visual)
const UNITS = {
	mm: { id: 'mm', label: 'mm', name: 'Milímetros', factor: 1000, decimals: 1 },
	cm: { id: 'cm', label: 'cm', name: 'Centímetros', factor: 100, decimals: 2 },
	m: { id: 'm', label: 'm', name: 'Metros', factor: 1, decimals: 4 }
};

const inputFormatters = {};
const labelFormatters = {};

function getInputFormatter( decimals ) {

	if ( inputFormatters[ decimals ] === undefined ) {

		// sem separador de milhar nos campos editáveis, para que o texto possa ser lido de volta sem ambiguidade
		inputFormatters[ decimals ] = new Intl.NumberFormat( 'pt-BR', { maximumFractionDigits: decimals, useGrouping: false } );

	}

	return inputFormatters[ decimals ];

}

function getLabelFormatter( decimals ) {

	if ( labelFormatters[ decimals ] === undefined ) {

		labelFormatters[ decimals ] = new Intl.NumberFormat( 'pt-BR', { maximumFractionDigits: decimals } );

	}

	return labelFormatters[ decimals ];

}

// Converte texto digitado em número. Aceita vírgula ou ponto como separador decimal.
// Quando os dois aparecem, o último é o decimal e os demais são separadores de milhar ("1.234,5" ou "1,234.5").
// Retorna null para qualquer valor inválido (vazio, NaN, Infinity, texto).

function parseNumber( text ) {

	if ( typeof text === 'number' ) return Number.isFinite( text ) ? text : null;
	if ( typeof text !== 'string' ) return null;

	let value = text.trim().replace( /\s+/g, '' ).replace( /(mm|cm|m|°)$/i, '' );

	if ( value === '' ) return null;

	const lastComma = value.lastIndexOf( ',' );
	const lastDot = value.lastIndexOf( '.' );

	if ( lastComma !== - 1 && lastDot !== - 1 ) {

		const decimal = lastComma > lastDot ? ',' : '.';
		const thousands = decimal === ',' ? '.' : ',';
		value = value.split( thousands ).join( '' ).replace( decimal, '.' );

	} else if ( lastComma !== - 1 ) {

		if ( value.indexOf( ',' ) !== lastComma ) return null; // "1,2,3"
		value = value.replace( ',', '.' );

	} else if ( lastDot !== - 1 && value.indexOf( '.' ) !== lastDot ) {

		return null; // "1.2.3"

	}

	if ( /^[-+]?(\d+\.?\d*|\.\d+)$/.test( value ) === false ) return null;

	const number = Number( value );

	return Number.isFinite( number ) ? number : null;

}

function Units( editor ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const changed = new Signal();

	let current = readUnit();

	function readUnit() {

		const data = editor.scene.userData[ PROJECT_KEY ];
		const unit = data !== undefined && data !== null ? data.units : undefined;

		// projetos antigos (sem unidade) seguem a convenção padrão, sem nenhuma conversão
		return UNITS[ unit ] !== undefined ? unit : DEFAULT_UNIT;

	}

	function setUnit( unit ) {

		if ( UNITS[ unit ] === undefined || unit === current ) return;

		// preserva qualquer metadado existente em userData
		const data = editor.scene.userData[ PROJECT_KEY ];
		editor.scene.userData[ PROJECT_KEY ] = Object.assign( {}, typeof data === 'object' && data !== null ? data : {}, { units: unit } );

		current = unit;
		changed.dispatch( unit );

		// dispara o salvamento automático do projeto (index.html escuta sceneGraphChanged)
		editor.signals.sceneGraphChanged.dispatch();

	}

	// projeto aberto, recarregado ou reiniciado: relê a unidade do userData da cena

	function sync() {

		const unit = readUnit();

		if ( unit !== current ) {

			current = unit;
			changed.dispatch( unit );

		}

	}

	editor.signals.sceneGraphChanged.add( sync );
	editor.signals.editorCleared.add( sync );

	function getUnit() {

		return UNITS[ current ];

	}

	// metros -> número na unidade atual (sem arredondar: a precisão interna é preservada)
	function toDisplay( meters, unit = getUnit() ) {

		return meters * unit.factor;

	}

	// número na unidade atual -> metros
	// toPrecision(15) remove o ruído binário da divisão (12,3 / 100 = 0,12300000000000001 -> 0,123)
	// sem perder a precisão do valor digitado (os números do JavaScript têm ~15-17 dígitos significativos)
	function fromDisplay( value, unit = getUnit() ) {

		return Number( ( value / unit.factor ).toPrecision( 15 ) );

	}

	// texto para campos editáveis, ex.: "120,5"
	function formatInput( meters, unit = getUnit() ) {

		return getInputFormatter( unit.decimals ).format( toDisplay( meters, unit ) + 0 ); // + 0 evita "-0"

	}

	// texto para rótulos, ex.: "1.000 mm"
	function format( meters, unit = getUnit() ) {

		return getLabelFormatter( unit.decimals ).format( toDisplay( meters, unit ) + 0 ) + ' ' + unit.label;

	}

	return {
		UNITS,
		changed,
		getUnit,
		setUnit,
		toDisplay,
		fromDisplay,
		formatInput,
		format,
		parse: parseNumber
	};

}

export { Units, UNITS, DEFAULT_UNIT, parseNumber, getInputFormatter };
