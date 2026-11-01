// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Ferramenta "Encaixar componente" (controlador de interação da EV-006):
//   1. o objeto selecionado é o MÓVEL; 2. o usuário aponta para outro componente; 3. o par de conectores compatível
//   mais próximo do ponto apontado é escolhido (explícitos primeiro, derivados como alternativa); 4. a prévia mostra a
//   caixa do móvel na posição prevista, o ponto de origem, o de destino, a orientação, a distância e o estado;
//   5. o clique confirma (UM passo de Desfazer: posição + rotação); Esc cancela sem tocar em nada.
// Durante pointermove nada é gravado no histórico e o objeto permanente não se move. As geometrias da prévia não
// participam do raycasting (ficam em sceneHelpers).

import * as THREE from 'three';

import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';

import { findComponentRoot } from './SimpleMode.ComponentFactory.js';
import { findHostedFixture } from './SimpleMode.Openings.js';
import { assemblyAncestors, exactDecompose, vertexCount } from './SimpleMode.AssemblyData.js';
import { bestSnap } from './SimpleMode.AssemblyConnectors.js';

const HEAVY_VERTICES = 150000;

// unidade que recebe o encaixe sob o cursor (conjunto mais externo, ou componente quando dentro do conjunto em edição)
function targetUnit( object, scene, editing ) {

	if ( editing !== null ) {

		let current = object, child = null;
		while ( current !== null && current !== editing && current !== scene ) {

			child = current;
			current = current.parent;

		}

		if ( current === editing && child !== null ) return child;

	}

	const chain = assemblyAncestors( object, scene );
	if ( chain.length > 0 && ( editing === null || chain.includes( editing ) === false ) ) return chain[ 0 ];
	const hosted = findHostedFixture( object, scene );
	if ( hosted !== null ) return hosted;
	return findComponentRoot( object, scene ) || object;

}

// comando único (posição + rotação) para levar um objeto a uma matriz mundial
function transformCommand( editor, object, world, name ) {

	object.parent.updateWorldMatrix( true, false );
	const local = exactDecompose( new THREE.Matrix4().copy( object.parent.matrixWorld ).invert().multiply( world ) );
	if ( local === null ) return null;
	const commands = [ new SetPositionCommand( editor, object, local.position ), new SetRotationCommand( editor, object, new THREE.Euler().setFromQuaternion( local.quaternion, object.rotation.order ) ) ];
	if ( local.scale.distanceTo( object.scale ) > 1e-6 ) commands.push( new SetScaleCommand( editor, object, local.scale ) );
	const command = new MultiCmdsCommand( editor, commands );
	command.name = name;
	return command;

}

function AssemblySnapping( editor, context, interaction, preview, selection ) {

	const state = { moving: null, result: null, heavy: false, raycaster: new THREE.Raycaster() };

	function contains( ancestor, object ) {

		let current = object;
		while ( current !== null && current !== undefined ) {

			if ( current === ancestor ) return true;
			current = current.parent;

		}

		return false;

	}

	function onMove( info ) {

		preview.clear();
		state.result = null;
		const moving = state.moving;
		const hits = info.raycaster.intersectObjects( editor.scene.children, true ).filter( ( h ) => h.object.visible && contains( moving, h.object ) === false );
		const hit = hits[ 0 ];
		if ( hit === undefined ) {

			preview.setLabel( 'Aponte para outro componente', null );
			return;

		}

		const target = targetUnit( hit.object, editor.scene, selection.getEditing() );
		if ( target === null || target === moving || contains( moving, target ) || contains( target, moving ) ) return;

		const result = bestSnap( moving, target, hit.point );
		if ( result === null ) {

			preview.addBox( target, target.matrixWorld, false );
			preview.setLabel( `Sem conectores compatíveis em "${target.name || 'componente'}"`, hit.point, false );
			preview.render();
			return;

		}

		state.result = Object.assign( result, { targetObject: target } );
		preview.addBox( moving, result.matrix, true, state.heavy === false );
		preview.addPoint( result.from.position, 'source' );
		preview.addPoint( result.to.position, 'target' );
		const length = Math.max( editor.viewportCamera.position.distanceTo( result.to.position ) * 0.06, 0.15 );
		preview.addArrow( result.to.position, result.to.normal, length );
		preview.addArrow( result.to.position, result.to.normal.clone().negate(), length * 0.7, preview.COLORS.source );
		const approx = result.moving.approximate || result.target.approximate ? ' (aproximado: caixa envolvente)' : '';
		const turn = result.angle > 1e-3 ? `, giro de ${Math.round( THREE.MathUtils.radToDeg( result.angle ) )}°` : '';
		preview.setLabel( `${result.moving.name} → ${result.target.name} de "${target.name || 'componente'}": ${context.units.format( result.distance )}${turn}${approx}`, result.to.position, true );
		preview.render();

	}

	function onClick( info ) {

		onMove( info );
		const result = state.result;
		if ( result === null ) {

			context.notify( 'Nenhum encaixe compatível neste ponto. Aponte para uma face ou extremidade de outro componente.', 'warning' );
			return;

		}

		const command = transformCommand( editor, state.moving, result.matrix, `Encaixar: ${state.moving.name || 'componente'}` );
		if ( command === null ) {

			context.notify( 'Este encaixe deformaria o objeto (escala não uniforme sob rotação). Operação cancelada.', 'warning' );
			return;

		}

		const moving = state.moving;
		interaction.deactivate();
		editor.execute( command );
		editor.select( moving );
		context.notify( `Encaixado em "${result.targetObject.name || 'componente'}" (${result.moving.name} → ${result.target.name}).`, 'success' );

	}

	interaction.register( 'assembly-snap', {

		activate( options ) {

			state.moving = options.object;
			state.heavy = vertexCount( options.object ) > HEAVY_VERTICES;
			state.result = null;
			preview.setLabel( 'Aponte para o componente de destino (Esc cancela)', null );

		},

		deactivate() {

			state.moving = null;
			state.result = null;
			preview.clear();

		},

		onMove,
		onClick

	} );

	function start( object ) {

		if ( object === null || object === undefined ) {

			context.notify( 'Selecione o componente que será encaixado.', 'warning' );
			return false;

		}

		interaction.activate( 'assembly-snap', { object } );
		return true;

	}

	return { start, getResult: () => state.result };

}

export { AssemblySnapping, transformCommand, targetUnit };
