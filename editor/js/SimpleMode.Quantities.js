// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Levantamento geométrico: lê a cena (a mesma do 3D e da planta) e devolve um registro por componente mensurável.
// Fonte primária = parâmetros dos componentes × escala efetiva da matriz mundial; nada depende do corte, do papel
// ou da escala da prancha (EV-009), e nenhum objeto é criado ou alterado.
//
//   - componentes paramétricos (paredes, pisos, painéis, plataformas, portas, janelas, mesas, cadeiras, estantes):
//     um registro por componente, nunca por peça (tampo e pernas não viram móveis);
//   - portas/janelas hospedadas: pelo vínculo da EV-007 (registro da abertura + componente filho da parede),
//     contadas uma única vez; registro sem componente = aviso de abertura órfã;
//   - "Meus componentes" e objetos sem parâmetros: contagem por unidade, dimensões da caixa envolvente (estimadas).

import * as THREE from 'three';

import { getComponentData, isUserComponent } from './SimpleMode.ComponentFactory.js';
import { getDefinition, validateParameters } from './SimpleMode.Components.js';
import { getOpenings, getHosted, findFixture } from './SimpleMode.Openings.js';
import { isLightingGroup } from './SimpleMode.Lighting.js';
import { TYPES, roundTo } from './SimpleMode.QuantityRules.js';

const _position = new THREE.Vector3(), _quaternion = new THREE.Quaternion(), _scale = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

// escala efetiva (módulo por eixo) e detecção de deformação (escala não uniforme sob rotação → cisalhamento)
function effectiveScale( object ) {

	object.updateWorldMatrix( true, false );
	object.matrixWorld.decompose( _position, _quaternion, _scale );
	object.matrixWorld.extractBasis( _x, _y, _z );

	const scale = [ Math.abs( _scale.x ), Math.abs( _scale.y ), Math.abs( _scale.z ) ];
	const valid = scale.every( ( v ) => Number.isFinite( v ) && v > 1e-9 );
	const sheared = valid && ( Math.abs( _x.clone().normalize().dot( _y.clone().normalize() ) ) > 1e-6 || Math.abs( _x.clone().normalize().dot( _z.clone().normalize() ) ) > 1e-6 || Math.abs( _y.clone().normalize().dot( _z.clone().normalize() ) ) > 1e-6 );
	const scaled = valid && scale.some( ( v ) => Math.abs( v - 1 ) > 1e-9 );

	return { scale, valid, sheared, scaled };

}

const mm = ( value ) => roundTo( value, 3 );

function dimsKey( type, dims ) {

	const parts = [ 'width', 'length', 'height', 'depth', 'thickness' ].filter( ( key ) => dims[ key ] !== undefined ).map( ( key ) => mm( dims[ key ] ) );
	return type + '|' + parts.join( 'x' );

}

function boxOf( object ) {

	const box = new THREE.Box3().setFromObject( object, true );
	if ( box.isEmpty() ) return null;
	const size = box.getSize( new THREE.Vector3() );
	return { width: size.x, height: size.y, depth: size.z };

}

// medições por tipo a partir das dimensões efetivas (metros)
function measure( type, dims, extra = {} ) {

	switch ( type ) {

		case 'wall': {

			const grossArea = dims.length * dims.height;
			const openingsArea = extra.openingsArea || 0;
			const netArea = grossArea - openingsArea;
			return { count: 1, length: dims.length, height: dims.height, thickness: dims.thickness, grossArea, openingsArea, netArea, netAreaTwoFaces: 2 * netArea, grossVolume: grossArea * dims.thickness, netVolume: netArea * dims.thickness };

		}

		case 'floor': {

			const area = dims.width * dims.depth;
			return { count: 1, width: dims.width, depth: dims.depth, thickness: dims.thickness, area, perimeter: 2 * ( dims.width + dims.depth ), volume: area * dims.thickness };

		}

		case 'panel': {

			const face = dims.width * dims.height;
			return { count: 1, width: dims.width, height: dims.height, thickness: dims.thickness, areaOneFace: face, areaTwoFaces: 2 * face, volume: face * dims.thickness };

		}

		case 'platform': {

			const top = dims.width * dims.depth;
			return { count: 1, width: dims.width, depth: dims.depth, height: dims.height, topArea: top, volume: top * dims.height };

		}

		case 'door':
		case 'window':
			return { count: 1, width: dims.width, height: dims.height, openingArea: dims.width * dims.height };

		case 'custom':
		case 'generic':
			return dims.width !== undefined ? { count: 1, width: dims.width, depth: dims.depth, height: dims.height, boxVolume: dims.width * dims.depth * dims.height } : { count: 1 };

		default:
			return { count: 1, width: dims.width, depth: dims.depth, height: dims.height };

	}

}

// dimensões efetivas de um componente paramétrico (parâmetros × escala do eixo correspondente)
function componentDims( type, parameters, scale ) {

	const [ sx, sy, sz ] = scale;

	switch ( type ) {

		case 'wall': return { length: parameters.width * sx, height: parameters.height * sy, thickness: parameters.thickness * sz };
		case 'floor': return { width: parameters.width * sx, thickness: parameters.thickness * sy, depth: parameters.depth * sz };
		case 'panel': return { width: parameters.width * sx, height: parameters.height * sy, thickness: parameters.thickness * sz };
		case 'door':
		case 'window': return { width: parameters.width * sx, height: parameters.height * sy };
		default: return { width: parameters.width * sx, height: parameters.height * sy, depth: parameters.depth * sz };

	}

}

// levantamento -------------------------------------------------------------------------------------------------

function buildQuantities( scene ) {

	scene.updateMatrixWorld( true );

	const records = [];
	const issues = [];

	function record( object, type, { dims = null, extra = {}, host = null, notes = [], status = 'ok', definitionName = null } = {} ) {

		const info = TYPES[ type ];
		const entry = {
			uuid: object.uuid,
			name: object.name || info.label,
			type,
			typeLabel: definitionName || info.label,
			category: info.category,
			dims: dims || {},
			measurements: dims !== null ? measure( type, dims, extra ) : { count: 1 },
			primary: info.primary,
			host,
			status,
			notes,
			groupKey: dims !== null ? dimsKey( type, dims ) : type + '|'
		};

		records.push( entry );
		return entry;

	}

	function visitComponent( object, data ) {

		const type = TYPES[ data.id ] !== undefined ? data.id : null;
		const definition = getDefinition( data.id );

		if ( type === null || definition === null ) {

			record( object, 'generic', { dims: boxOf( object ), status: 'estimated', notes: [ 'Tipo de componente desconhecido nesta versão: contado por unidade, dimensões da caixa envolvente.' ] } );
			return;

		}

		const scale = effectiveScale( object );
		const notes = [];
		let status = 'ok';

		if ( data.parameters === null || typeof data.parameters !== 'object' || validateParameters( definition, data.parameters ) !== null ) {

			record( object, type, { status: 'invalid', notes: [ 'Parâmetros do componente inválidos: medidas indisponíveis.' ] } ).measurements = { count: 1 };
			issues.push( { code: 'invalidParameters', uuid: object.uuid, message: `${object.name || TYPES[ type ].label}: parâmetros inválidos.` } );
			return;

		}

		if ( scale.valid === false ) {

			record( object, type, { status: 'invalid', notes: [ 'Escala inválida (zero ou não numérica): medidas indisponíveis.' ] } ).measurements = { count: 1 };
			issues.push( { code: 'invalidScale', uuid: object.uuid, message: `${object.name || TYPES[ type ].label}: escala inválida.` } );
			return;

		}

		if ( scale.sheared ) {

			status = 'warning';
			notes.push( 'Escala não uniforme sob rotação (deformação): medidas aproximadas pela escala decomposta.' );
			issues.push( { code: 'shearedScale', uuid: object.uuid, message: `${object.name || TYPES[ type ].label}: escala incompatível (deformação).` } );

		} else if ( scale.scaled ) {

			notes.push( `Escala efetiva aplicada (× ${scale.scale.map( ( v ) => roundTo( v, 3 ) ).join( ' × ' )}).` );

		}

		const dims = componentDims( type, data.parameters, scale.scale );
		const extra = {};

		if ( type === 'wall' ) {

			// vãos: registros da EV-007, uma vez cada (a porta/janela filha não gera um segundo desconto)
			const openings = getOpenings( object );
			extra.openingsArea = openings.reduce( ( sum, o ) => sum + o.width * scale.scale[ 0 ] * o.height * scale.scale[ 1 ], 0 );
			const entry = record( object, type, { dims, extra, status, notes, definitionName: definition.name } );
			entry.openings = openings.length;

			if ( entry.measurements.netArea < - 1e-9 ) {

				entry.status = 'warning';
				entry.notes.push( 'Área dos vãos maior que a área bruta.' );

			}

			for ( const opening of openings ) {

				const fixture = findFixture( object, opening );

				if ( fixture === null ) {

					issues.push( { code: 'orphanOpening', uuid: object.uuid, message: `${object.name || 'Parede'}: vão de ${opening.type === 'door' ? 'porta' : 'janela'} sem componente (abertura órfã) — o vão é descontado da área, mas não é contado como ${opening.type === 'door' ? 'porta' : 'janela'}.` } );
					continue;

				}

				visitHosted( fixture, object );

			}

			// filhos com vínculo de hospedagem sem registro correspondente (inconsistência)
			for ( const child of object.children ) {

				const hosted = getHosted( child );
				if ( hosted !== null && openings.some( ( o ) => o.fixtureUuid === child.uuid ) === false ) {

					const childData = getComponentData( child );
					if ( childData !== null && ( childData.id === 'door' || childData.id === 'window' ) ) {

						const childEntry = recordComponent( child, childData );
						if ( childEntry !== null ) {

							childEntry.status = 'warning';
							childEntry.notes.push( 'Vínculo de abertura sem registro na parede: contado como componente, sem vão correspondente.' );

						}

						issues.push( { code: 'hostedWithoutOpening', uuid: child.uuid, message: `${child.name}: vinculado à parede, mas sem registro de abertura.` } );

					}

				}

			}

			return;

		}

		record( object, type, { dims, status, notes, definitionName: definition.name } );

	}

	function recordComponent( object, data ) {

		const before = records.length;
		visitComponent( object, data );
		return records.length > before ? records[ records.length - 1 ] : null;

	}

	function visitHosted( fixture, wall ) {

		const data = getComponentData( fixture );
		if ( data === null ) return;
		const entry = recordComponent( fixture, data );
		if ( entry !== null ) entry.host = { uuid: wall.uuid, name: wall.name || 'Parede' };

	}

	function containsComponent( object ) {

		let found = false;
		object.traverse( ( child ) => {

			if ( child !== object && ( getComponentData( child ) !== null || isUserComponent( child ) ) ) found = true;

		} );
		return found;

	}

	function visit( object ) {

		if ( isLightingGroup( object ) || object.isLight === true || object.isCamera === true ) return;

		const data = getComponentData( object );
		if ( data !== null ) return visitComponent( object, data );

		if ( isUserComponent( object ) ) {

			const dims = boxOf( object );
			record( object, 'custom', { dims, status: 'estimated', notes: [ 'Componente personalizado: contado por unidade; dimensões da caixa envolvente (estimadas).' ], definitionName: object.userData.project3ds.userComponent.name || null } );
			return;

		}

		// grupo com componentes dentro: cada componente conta por si; senão o grupo inteiro é UM objeto
		if ( object.children.length > 0 && containsComponent( object ) ) {

			for ( const child of object.children ) visit( child );
			return;

		}

		if ( object.isMesh === true || object.children.length > 0 ) {

			const dims = boxOf( object );
			record( object, 'generic', { dims, status: 'estimated', notes: [ 'Objeto sem parâmetros: contado por unidade; dimensões da caixa envolvente (estimadas), sem consumo de materiais.' ] } );

		}

	}

	for ( const child of scene.children ) visit( child );

	// códigos por tipo, na ordem da cena (PAR-01, PIS-01…)
	const counters = {};
	for ( const entry of records ) {

		const prefix = TYPES[ entry.type ].prefix;
		counters[ prefix ] = ( counters[ prefix ] || 0 ) + 1;
		entry.code = prefix + '-' + String( counters[ prefix ] ).padStart( 2, '0' );

	}

	if ( records.length === 0 ) issues.push( { code: 'empty', uuid: null, message: 'Nenhum componente mensurável na cena.' } );

	return { records, issues };

}

// consolidação por tipo e dimensões (só registros compatíveis: mesmo tipo e mesmas medidas)
function groupRecords( records ) {

	const groups = new Map();

	for ( const entry of records ) {

		if ( groups.has( entry.groupKey ) === false ) groups.set( entry.groupKey, { key: entry.groupKey, type: entry.type, typeLabel: entry.typeLabel, category: entry.category, dims: entry.dims, primary: entry.primary, members: [], measurements: {}, status: 'ok' } );

		const group = groups.get( entry.groupKey );
		group.members.push( entry );
		for ( const [ key, value ] of Object.entries( entry.measurements ) ) {

			// dimensões lineares (largura, altura…) não se somam: representam o tipo; áreas, volumes e contagens sim
			if ( [ 'width', 'height', 'depth', 'thickness', 'length' ].includes( key ) && entry.type !== 'wall' ) group.measurements[ key ] = value;
			else group.measurements[ key ] = ( group.measurements[ key ] || 0 ) + value;

		}

		if ( entry.status !== 'ok' ) group.status = entry.status === 'invalid' || group.status === 'invalid' ? 'invalid' : ( entry.status === 'warning' || group.status === 'warning' ? 'warning' : 'estimated' );

	}

	return [ ...groups.values() ];

}

// soma de uma medição sobre os registros que atendem à origem de um item orçamentário
function sourceRecords( records, source ) {

	if ( source.kind === 'object' ) return records.filter( ( r ) => r.uuid === source.objectUuid );
	if ( source.kind === 'group' ) return records.filter( ( r ) => r.type === source.componentId && ( source.groupKey === null || source.groupKey === undefined || r.groupKey === source.groupKey ) );
	return [];

}

function dimsText( entry ) {

	const d = entry.dims || {};
	const f = ( v ) => roundTo( v, 2 ).toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } );

	switch ( entry.type ) {

		case 'wall': return d.length !== undefined ? `${f( d.length )} × ${f( d.height )} × ${f( d.thickness )} m` : '—';
		case 'floor': return d.width !== undefined ? `${f( d.width )} × ${f( d.depth )} m, esp. ${f( d.thickness )} m` : '—';
		case 'panel': return d.width !== undefined ? `${f( d.width )} × ${f( d.height )} m, esp. ${f( d.thickness )} m` : '—';
		case 'door':
		case 'window': return d.width !== undefined ? `${f( d.width )} × ${f( d.height )} m` : '—';
		default: return d.width !== undefined ? `${f( d.width )} × ${f( d.depth )} × ${f( d.height )} m (L × P × A)` : '—';

	}

}

export { buildQuantities, groupRecords, sourceRecords, dimsText, effectiveScale };
