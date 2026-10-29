// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
//
// Precisão de movimento (encaixe das alças de mover) e espaçamento da grade.
// São preferências da interface (Config/localStorage), não dados do projeto.
// O encaixe usa o snapping nativo do TransformControls via sinal `snapChanged`;
// a grade usa o sinal `gridChanged` tratado pelo Viewport. No Modo Avançado ambos voltam ao original.

const SNAP_KEY = 'interface/simple/snap';
const GRID_KEY = 'interface/simple/grid';

// valores em metros (1 unidade = 1 m); null = livre
const SNAP_OPTIONS = [
	{ id: 'free', value: null, label: 'Livre' },
	{ id: '1cm', value: 0.01, label: '1 cm' },
	{ id: '5cm', value: 0.05, label: '5 cm' },
	{ id: '10cm', value: 0.1, label: '10 cm' },
	{ id: '50cm', value: 0.5, label: '50 cm' },
	{ id: '1m', value: 1, label: '1 m' }
];

const DEFAULT_SNAP = '10cm';

// a grade visual tem no máximo 100 divisões, mesmo com encaixes pequenos (evita milhares de linhas)
const GRID_OPTIONS = [
	{ id: '10cm', label: '10 cm', description: 'quadrados de 10 cm, linhas fortes a cada 1 m, área de 10 m', size: 10, divisions: 100, majorDivisions: 10 },
	{ id: '50cm', label: '50 cm', description: 'quadrados de 50 cm, linhas fortes a cada 5 m, área de 20 m', size: 20, divisions: 40, majorDivisions: 4 },
	{ id: '1m', label: '1 m', description: 'quadrados de 1 m, linhas fortes a cada 5 m, área de 30 m (padrão)', size: 30, divisions: 30, majorDivisions: 6 }
];

const DEFAULT_GRID = '1m';

function Precision( editor ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const config = editor.config;
	const changed = new Signal();

	let enabled = false; // só atua no Modo Simples

	function getSnapOption() {

		const id = config.getKey( SNAP_KEY );
		return SNAP_OPTIONS.find( ( option ) => option.id === id ) || SNAP_OPTIONS.find( ( option ) => option.id === DEFAULT_SNAP );

	}

	function getGridOption() {

		const id = config.getKey( GRID_KEY );
		return GRID_OPTIONS.find( ( option ) => option.id === id ) || GRID_OPTIONS.find( ( option ) => option.id === DEFAULT_GRID );

	}

	function apply() {

		editor.signals.snapChanged.dispatch( enabled ? getSnapOption().value : null );
		editor.signals.gridChanged.dispatch( enabled ? getGridOption() : null );

	}

	function setSnap( id ) {

		if ( SNAP_OPTIONS.some( ( option ) => option.id === id ) === false ) return;

		config.setKey( SNAP_KEY, id );
		apply();
		changed.dispatch();

	}

	function setGrid( id ) {

		if ( GRID_OPTIONS.some( ( option ) => option.id === id ) === false ) return;

		config.setKey( GRID_KEY, id );
		apply();
		changed.dispatch();

	}

	function setEnabled( value ) {

		enabled = value;
		apply();

	}

	return {
		SNAP_OPTIONS,
		GRID_OPTIONS,
		changed,
		getSnapOption,
		getGridOption,
		getSnap: () => ( enabled ? getSnapOption().value : null ),
		setSnap,
		setGrid,
		setEnabled
	};

}

export { Precision };
