// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
//
// Alinhamento e distribuição de objetos usando as caixas delimitadoras no espaço mundial.
//
// Seleção múltipla complementar: objetos "marcados" na lista do painel esquerdo. O sistema original
// (`editor.selected`) continua sendo a seleção principal e define o objeto de REFERÊNCIA, que nunca se move.
// Cada operação gera um único MultiCmdsCommand de SetPositionCommand (uma ação de Desfazer).

import * as THREE from 'three';

import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';

const AXES = [ 'x', 'y', 'z' ];
const TOLERANCE = 1e-7;

function Alignment( editor ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	const marked = new Set();
	const changed = new Signal();

	// apenas objetos diretamente na raiz da cena (transformação local = mundial)

	function isSupported( object ) {

		return object !== null && object !== undefined && object.parent === editor.scene && object.isCamera !== true;

	}

	function toggle( object ) {

		if ( marked.has( object ) ) {

			marked.delete( object );

		} else if ( isSupported( object ) ) {

			marked.add( object );

		}

		changed.dispatch();

	}

	function clear() {

		if ( marked.size === 0 ) return;

		marked.clear();
		changed.dispatch();

	}

	// remove marcas de objetos que saíram da cena (exclusão, desfazer, novo projeto)

	function prune() {

		let removed = false;

		for ( const object of marked ) {

			if ( isSupported( object ) === false ) {

				marked.delete( object );
				removed = true;

			}

		}

		if ( removed ) changed.dispatch();

	}

	editor.signals.sceneGraphChanged.add( prune );
	editor.signals.objectRemoved.add( prune );
	editor.signals.editorCleared.add( clear );

	// participantes: referência (objeto selecionado) + objetos marcados

	function getParticipants() {

		const selected = editor.selected;
		const reference = isSupported( selected ) ? selected : null;

		const others = [ ...marked ].filter( ( object ) => object !== reference && isSupported( object ) );

		return {
			reference,
			others,
			all: reference !== null ? [ reference, ...others ] : others,
			selectedIsNested: selected !== null && selected !== editor.scene && reference === null
		};

	}

	function getWorldBox( object ) {

		const box = new THREE.Box3().setFromObject( object, true );

		if ( box.isEmpty() ) {

			// luzes e objetos vazios: usa o ponto de origem
			const point = object.getWorldPosition( new THREE.Vector3() );
			box.set( point, point.clone() );

		}

		return box;

	}

	function getAnchor( box, axis, mode ) {

		switch ( mode ) {

			case 'start': return box.min[ axis ];
			case 'end': return box.max[ axis ];
			default: return ( box.min[ axis ] + box.max[ axis ] ) / 2;

		}

	}

	function createMoveCommands( moves ) {

		const commands = [];

		for ( const { object, axis, delta } of moves ) {

			if ( Math.abs( delta ) < TOLERANCE ) continue;

			const position = object.position.clone();
			position[ axis ] += delta;

			commands.push( new SetPositionCommand( editor, object, position ) );

		}

		return commands;

	}

	function execute( commands, name ) {

		if ( commands.length === 0 ) return 0;

		const command = new MultiCmdsCommand( editor, commands );
		command.name = name;
		editor.execute( command );

		return commands.length;

	}

	// Alinha os objetos marcados ao objeto de referência. Retorna o número de objetos movidos ou um código de erro.

	function align( axis, mode ) {

		const { reference, others } = getParticipants();

		if ( reference === null ) return 'noReference';
		if ( others.length === 0 ) return 'needTwo';

		const target = getAnchor( getWorldBox( reference ), axis, mode );

		const moves = others.map( ( object ) => ( {
			object,
			axis,
			delta: target - getAnchor( getWorldBox( object ), axis, mode )
		} ) );

		return execute( createMoveCommands( moves ), 'Alinhar objetos: ' + axis.toUpperCase() );

	}

	// Distribui uniformemente os centros das caixas no eixo. Os objetos dos extremos ficam fixos.

	function distribute( axis ) {

		const { all } = getParticipants();

		if ( all.length < 3 ) return 'needThree';

		const items = all
			.map( ( object ) => ( { object, center: getAnchor( getWorldBox( object ), axis, 'center' ) } ) )
			.sort( ( a, b ) => a.center - b.center );

		const first = items[ 0 ].center;
		const last = items[ items.length - 1 ].center;
		const step = ( last - first ) / ( items.length - 1 );

		const moves = [];

		for ( let i = 1; i < items.length - 1; i ++ ) {

			moves.push( { object: items[ i ].object, axis, delta: first + step * i - items[ i ].center } );

		}

		return execute( createMoveCommands( moves ), 'Distribuir objetos: ' + axis.toUpperCase() );

	}

	return {
		AXES,
		changed,
		toggle,
		clear,
		isMarked: ( object ) => marked.has( object ),
		isSupported,
		getParticipants,
		getWorldBox,
		align,
		distribute
	};

}

export { Alignment };
