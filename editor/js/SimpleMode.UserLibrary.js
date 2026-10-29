// EV-003 — Biblioteca Inteligente de Componentes 3D
//
// "Meus componentes": componentes salvos pelo usuário para reutilizar em outros projetos.
//
// Armazenamento: IndexedDB próprio ('project3ds-library' / store 'components'), separado do banco do editor
// ('threejs-editor' / store 'states'), que nunca é aberto nem alterado aqui. "Novo projeto" não apaga nada.
// Os dados ficam apenas neste navegador (sem sincronização entre dispositivos).
//
// Formato de cada registro (formatVersion 1):
//   { format: 'project3ds-user-component', formatVersion: 1, id, name, category, kind: 'parametric' | 'group',
//     componentId?, componentVersion?, parameters?, object?, dimensions: { x, y, z }, createdAt, updatedAt }
//   - 'parametric': componente da biblioteca, guardado apenas pela definição paramétrica (reconstruído pela fábrica)
//   - 'group': grupo/malha compatível, guardado em JSON do Three.js (Object3D.toJSON), sem texturas

import * as THREE from 'three';

import { getDefinition, migrateParameters, validateParameters } from './SimpleMode.Components.js';
import { getComponentData, setMeta, createComponent, findComponentRoot } from './SimpleMode.ComponentFactory.js';

const DB_NAME = 'project3ds-library';
const DB_VERSION = 1;
const STORE = 'components';

const FORMAT = 'project3ds-user-component';
const FORMAT_VERSION = 1;

const LIMITS = {
	count: 100, // componentes salvos
	bytes: 2 * 1024 * 1024, // tamanho máximo de cada componente (JSON)
	meshes: 200, // malhas por componente
	vertices: 200000, // vértices por componente
	name: 80,
	category: 40
};

// tipos aceitos em componentes do tipo 'group'
const OBJECT_TYPES = new Set( [ 'Group', 'Object3D', 'Mesh' ] );
const GEOMETRY_TYPES = new Set( [
	'BoxGeometry', 'SphereGeometry', 'CylinderGeometry', 'PlaneGeometry', 'CircleGeometry', 'ConeGeometry',
	'TorusGeometry', 'TorusKnotGeometry', 'CapsuleGeometry', 'RingGeometry', 'DodecahedronGeometry',
	'IcosahedronGeometry', 'OctahedronGeometry', 'TetrahedronGeometry', 'BufferGeometry'
] );
const MATERIAL_TYPES = new Set( [ 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial', 'MeshNormalMaterial' ] );
const TEXTURE_KEYS = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'anisotropyMap', 'gradientMap', 'matcap', 'specularIntensityMap', 'specularColorMap' ];

class LibraryError extends Error {}

// banco de dados ---------------------------------------------------------------

let databasePromise = null;

function openDatabase() {

	if ( databasePromise !== null ) return databasePromise;

	databasePromise = new Promise( function ( resolve, reject ) {

		if ( window.indexedDB === undefined ) {

			reject( new LibraryError( 'Este navegador não permite salvar componentes (IndexedDB indisponível).' ) );
			return;

		}

		const request = window.indexedDB.open( DB_NAME, DB_VERSION );

		request.onupgradeneeded = function () {

			const db = request.result;
			if ( db.objectStoreNames.contains( STORE ) === false ) db.createObjectStore( STORE, { keyPath: 'id' } );

		};

		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( new LibraryError( 'Não foi possível abrir o armazenamento de componentes.' ) );
		request.onblocked = () => reject( new LibraryError( 'O armazenamento de componentes está bloqueado por outra aba.' ) );

	} );

	databasePromise.catch( () => ( databasePromise = null ) );

	return databasePromise;

}

function run( mode, operation ) {

	return openDatabase().then( ( db ) => new Promise( function ( resolve, reject ) {

		const transaction = db.transaction( STORE, mode );
		const store = transaction.objectStore( STORE );
		const request = operation( store );

		transaction.oncomplete = () => resolve( request !== undefined ? request.result : undefined );
		transaction.onerror = () => reject( new LibraryError( transaction.error && transaction.error.name === 'QuotaExceededError' ?
			'Sem espaço no navegador para salvar o componente.' : 'Falha ao acessar os componentes salvos.' ) );
		transaction.onabort = transaction.onerror;

	} ) );

}

// validação ----------------------------------------------------------------------

function cleanText( value, max, fallback ) {

	// remove caracteres de controle (quebras de linha, tabulações etc.)
	const text = typeof value === 'string' ? [ ...value ].filter( ( char ) => char.charCodeAt( 0 ) >= 32 ).join( '' ).trim().slice( 0, max ) : '';
	return text !== '' ? text : fallback;

}

// Verifica se um objeto da cena pode ser salvo como 'group'. Retorna uma mensagem de erro ou null.
function checkGroupObject( object ) {

	let meshes = 0;
	let vertices = 0;
	let problem = null;

	object.traverse( function ( child ) {

		if ( problem !== null ) return;

		if ( OBJECT_TYPES.has( child.type ) === false ) {

			problem = child.isLight || child.isCamera ? 'Luzes e câmeras não podem ser salvas como componente.' : 'Este objeto contém elementos não suportados (' + child.type + ').';
			return;

		}

		if ( Array.isArray( child.animations ) && child.animations.length > 0 ) problem = 'Objetos com animação não podem ser salvos como componente.';

		if ( child.isMesh !== true ) return;

		meshes ++;

		if ( GEOMETRY_TYPES.has( child.geometry.type ) === false ) problem = 'Geometria não suportada: ' + child.geometry.type + '.';
		if ( child.geometry.morphAttributes && Object.keys( child.geometry.morphAttributes ).length > 0 ) problem = 'Objetos deformáveis não podem ser salvos como componente.';

		const position = child.geometry.attributes.position;
		vertices += position !== undefined ? position.count : 0;

		const materials = Array.isArray( child.material ) ? child.material : [ child.material ];

		for ( const material of materials ) {

			if ( MATERIAL_TYPES.has( material.type ) === false ) problem = 'Material não suportado: ' + material.type + '.';
			if ( TEXTURE_KEYS.some( ( key ) => material[ key ] ) ) problem = 'Materiais com texturas/imagens ainda não podem ser salvos como componente.';

		}

	} );

	if ( problem !== null ) return problem;
	if ( meshes === 0 ) return 'O objeto não possui nenhuma forma visível para salvar.';
	if ( meshes > LIMITS.meshes ) return `O objeto tem ${meshes} partes; o limite é ${LIMITS.meshes}.`;
	if ( vertices > LIMITS.vertices ) return 'O objeto é detalhado demais para ser salvo como componente.';

	return null;

}

// Valida o JSON de um componente 'group' antes de reconstruir (dados vindos do armazenamento local)
function checkGroupJSON( json ) {

	if ( json === null || typeof json !== 'object' || json.object === null || typeof json.object !== 'object' ) return false;

	// sem imagens/texturas: nada é baixado nem decodificado
	if ( ( Array.isArray( json.images ) && json.images.length > 0 ) || ( Array.isArray( json.textures ) && json.textures.length > 0 ) ) return false;
	if ( json.animations !== undefined && json.animations.length > 0 ) return false;

	let valid = true;

	( function walk( node ) {

		if ( valid === false ) return;
		if ( node === null || typeof node !== 'object' || OBJECT_TYPES.has( node.type ) === false ) {

			valid = false;
			return;

		}

		if ( Array.isArray( node.children ) ) node.children.forEach( walk );

	} )( json.object );

	if ( valid === false ) return false;

	const geometries = Array.isArray( json.geometries ) ? json.geometries : [];
	const materials = Array.isArray( json.materials ) ? json.materials : [];

	return geometries.every( ( g ) => g && GEOMETRY_TYPES.has( g.type ) ) &&
		materials.every( ( m ) => m && MATERIAL_TYPES.has( m.type ) && TEXTURE_KEYS.every( ( key ) => m[ key ] === undefined ) );

}

function checkRecord( record ) {

	if ( record === null || typeof record !== 'object' ) return false;
	if ( record.format !== FORMAT || record.formatVersion !== FORMAT_VERSION ) return false;
	if ( typeof record.id !== 'string' || typeof record.name !== 'string' ) return false;

	if ( record.kind === 'parametric' ) {

		return typeof record.componentId === 'string' && record.parameters !== null && typeof record.parameters === 'object';

	}

	if ( record.kind === 'group' ) return checkGroupJSON( record.object );

	return false;

}

// conversões --------------------------------------------------------------------

function measure( object ) {

	const clone = object.clone( true );
	clone.position.set( 0, 0, 0 );
	clone.rotation.set( 0, 0, 0 );
	clone.updateMatrixWorld( true );

	const size = new THREE.Box3().setFromObject( clone, true ).getSize( new THREE.Vector3() );

	return { x: size.x, y: size.y, z: size.z };

}

// Cria o registro (ainda não salvo) a partir de um objeto da cena
function createRecord( object, name, category ) {

	const now = new Date().toISOString();

	const record = {
		format: FORMAT,
		formatVersion: FORMAT_VERSION,
		id: 'uc-' + THREE.MathUtils.generateUUID(),
		name: cleanText( name, LIMITS.name, object.name || 'Meu componente' ),
		category: cleanText( category, LIMITS.category, 'Meus componentes' ),
		kind: 'group',
		dimensions: measure( object ),
		createdAt: now,
		updatedAt: now
	};

	const data = getComponentData( object );
	const definition = data !== null ? getDefinition( data.id ) : null;
	const isUnscaled = object.scale.x === 1 && object.scale.y === 1 && object.scale.z === 1;

	if ( definition !== null && isUnscaled ) {

		// componente paramétrico: guarda só a definição (pequeno, reconstruído com geometria nova)
		const parameters = migrateParameters( definition, data.parameters, data.version );

		if ( parameters !== null && validateParameters( definition, parameters ) === null ) {

			record.kind = 'parametric';
			record.componentId = definition.id;
			record.componentVersion = definition.version;
			record.parameters = parameters;

			return record;

		}

	}

	// grupo genérico (ou componente com escala aplicada): JSON do Three.js, com a raiz na origem
	const problem = checkGroupObject( object );
	if ( problem !== null ) throw new LibraryError( problem );

	const clone = object.clone( true );
	clone.position.set( 0, 0, 0 );
	clone.rotation.set( 0, 0, 0 );

	const json = clone.toJSON();
	delete json.metadata;

	const bytes = new Blob( [ JSON.stringify( json ) ] ).size;
	if ( bytes > LIMITS.bytes ) throw new LibraryError( `O componente é grande demais (${( bytes / 1048576 ).toFixed( 1 )} MB; limite de 2 MB).` );

	record.object = json;

	return record;

}

// Reconstrói uma nova instância independente a partir de um registro salvo
function instantiate( record ) {

	if ( checkRecord( record ) === false ) throw new LibraryError( 'Este componente salvo está danificado ou em um formato desconhecido.' );

	let object;

	if ( record.kind === 'parametric' ) {

		const definition = getDefinition( record.componentId );
		if ( definition === null ) throw new LibraryError( 'O tipo deste componente não existe nesta versão do aplicativo.' );

		const parameters = migrateParameters( definition, record.parameters, record.componentVersion );
		if ( parameters === null || validateParameters( definition, parameters ) !== null ) throw new LibraryError( 'Os parâmetros deste componente salvo são inválidos.' );

		object = createComponent( definition.id, parameters );

	} else {

		const loader = new THREE.ObjectLoader();
		const parsed = loader.parse( record.object );

		// novos UUIDs, geometrias e materiais próprios: cada inserção é independente
		object = parsed.clone( true );
		object.traverse( function ( child ) {

			if ( child.geometry !== undefined ) child.geometry = child.geometry.clone();
			if ( child.material !== undefined ) child.material = Array.isArray( child.material ) ? child.material.map( ( m ) => m.clone() ) : child.material.clone();

		} );

	}

	object.name = record.name;
	object.position.set( 0, 0, 0 );
	setMeta( object, { userComponent: { id: record.id, name: record.name, formatVersion: FORMAT_VERSION } } );

	return object;

}

// API --------------------------------------------------------------------------

function UserLibrary() {

	const Signal = signals.Signal; // eslint-disable-line no-undef
	const changed = new Signal();

	let cache = [];
	let loaded = false;
	let error = null;

	function sort( list ) {

		return list.sort( ( a, b ) => a.category.localeCompare( b.category, 'pt-BR' ) || a.name.localeCompare( b.name, 'pt-BR' ) );

	}

	async function load() {

		try {

			const records = await run( 'readonly', ( store ) => store.getAll() );
			cache = sort( ( records || [] ).filter( checkRecord ) );
			error = null;

		} catch ( e ) {

			error = e.message;
			cache = [];

		}

		loaded = true;
		changed.dispatch();

		return cache;

	}

	async function save( object, name, category ) {

		await ( loaded ? Promise.resolve() : load() );

		if ( cache.length >= LIMITS.count ) throw new LibraryError( `Limite de ${LIMITS.count} componentes salvos atingido. Exclua algum para salvar outro.` );

		const record = createRecord( object, name, category );

		await run( 'readwrite', ( store ) => store.put( record ) );
		await load();

		return record;

	}

	async function rename( id, name ) {

		const record = cache.find( ( item ) => item.id === id );
		if ( record === undefined ) throw new LibraryError( 'Componente não encontrado.' );

		const updated = Object.assign( {}, record, { name: cleanText( name, LIMITS.name, record.name ), updatedAt: new Date().toISOString() } );

		await run( 'readwrite', ( store ) => store.put( updated ) );
		await load();

	}

	async function remove( id ) {

		await run( 'readwrite', ( store ) => store.delete( id ) );
		await load();

	}

	return {
		LIMITS,
		changed,
		load,
		save,
		rename,
		remove,
		instantiate,
		getAll: () => cache.slice(),
		get: ( id ) => cache.find( ( item ) => item.id === id ) || null,
		getCategories: () => [ ...new Set( cache.map( ( item ) => item.category ) ) ],
		getError: () => error,
		isLoaded: () => loaded,
		// verifica se um objeto pode ser salvo (mensagem de erro ou null)
		canSave( object, scene ) {

			if ( object === null || object === scene || object.parent === null ) return 'Selecione um objeto da cena.';
			const root = findComponentRoot( object, scene );
			if ( root !== null && root !== object ) return 'Selecione o componente inteiro, não uma parte dele.';

			const data = getComponentData( object );
			const isPlainParametric = data !== null && getDefinition( data.id ) !== null && object.scale.x === 1 && object.scale.y === 1 && object.scale.z === 1;

			return isPlainParametric ? null : checkGroupObject( object );

		}
	};

}

export { UserLibrary, LibraryError };
