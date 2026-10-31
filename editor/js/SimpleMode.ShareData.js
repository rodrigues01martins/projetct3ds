// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// Formato do pacote de visualização (.p3ds-review.zip) e a SANITIZAÇÃO por lista explícita do que é permitido.
// O mesmo código roda nos dois lados:
//   - no editor, depois de serializar a cena, para que só dados de visualização saiam do aplicativo;
//   - no visualizador, ao abrir o arquivo recebido (entrada NÃO confiável), antes de qualquer objeto Three.js existir.
// Nada é copiado "por inteiro": cada objeto, geometria, material, textura e imagem é RECONSTRUÍDO com os campos aceitos.
// Assim, metadados que versões futuras do editor venham a criar não passam a ser compartilhados sem revisão deste
// arquivo (orçamento, histórico, scripts, dados do gerenciador de projetos etc. nunca estão na lista).
//
//   manifest.json   { format: 'project3ds-review-package', formatVersion: 1, shareId, source: { projectId, revision },
//                     title, description, createdAt, permissions, contents, excluded, display, stats, contentHash,
//                     files: [ { path, role, size, sha256 } ] }
//   scene.json      { metadata: { format: 'project3ds-share-scene', version: 1 }, object, geometries, materials,
//                     textures, images }   (subconjunto do formato JSON do Three.js; geometrias só BufferGeometry)
//   views.json      { views: [ vista salva da EV-008 ] }
//   preview.jpg     imagem de capa (opcional, declarada no manifesto)
//
// contentHash = SHA-256 de "project3ds-share-v1\n<hash scene.json>\n<hash views.json>": calculado sobre o conteúdo
// efetivamente enviado (já filtrado). Confere integridade e correspondência; NÃO comprova autoria (não há assinatura).

import { zipSync, unzipSync, strToU8, strFromU8 } from '../../examples/jsm/libs/fflate.module.js';

import { digest } from './SimpleMode.ProjectData.js';

const PACKAGE_FORMAT = 'project3ds-review-package';
const PACKAGE_VERSION = 1;
const SCENE_FORMAT = 'project3ds-share-scene';
const SCENE_VERSION = 1;

const LIMITS = {
	zipBytes: 150 * 1024 * 1024,
	entries: 8,
	entryBytes: 200 * 1024 * 1024,
	totalBytes: 300 * 1024 * 1024,
	objects: 20000,
	depth: 64,
	geometries: 20000,
	materials: 2000,
	textures: 256,
	images: 128,
	imageChars: 12 * 1024 * 1024,
	vertices: 6000000,
	indices: 18000000,
	views: 50,
	previewBytes: 2 * 1024 * 1024,
	title: 120,
	description: 600,
	name: 120,
	label: 60
};

const FILES = {
	'manifest.json': 'manifest',
	'scene.json': 'scene',
	'views.json': 'views',
	'preview.jpg': 'preview'
};

const PERMISSIONS = { view: true, comment: true, editModel: false };

// categorias apresentadas ao proprietário antes de exportar
const CONTENT_OPTIONS = [
	{ key: 'geometry', label: 'Geometria 3D', locked: true },
	{ key: 'materials', label: 'Materiais e texturas suportados' },
	{ key: 'lighting', label: 'Iluminação' },
	{ key: 'views', label: 'Câmeras e vistas salvas' },
	{ key: 'names', label: 'Nomes dos componentes' },
	{ key: 'dimensions', label: 'Dimensões básicas dos objetos' }
];

const EXCLUDED = [
	'Orçamento e preços',
	'Histórico de comandos do editor',
	'Scripts executáveis',
	'Versões anteriores, rascunhos e backups',
	'Dados do armazenamento local e de sessões',
	'Comentários e revisões existentes',
	'Plantas, cotas e documentação interna',
	'Metadados administrativos do projeto'
];

const OBJECT_TYPES = new Set( [ 'Scene', 'Group', 'Object3D', 'Mesh', 'AmbientLight', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'SpotLight' ] );
const LIGHT_TYPES = new Set( [ 'AmbientLight', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'SpotLight' ] );
const MATERIAL_TYPES = new Set( [ 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshBasicMaterial', 'ShadowMaterial' ] );
const ATTRIBUTES = new Set( [ 'position', 'normal', 'uv', 'uv1', 'color' ] );
const ARRAY_TYPES = new Set( [ 'Float32Array', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array' ] );
const INDEX_TYPES = new Set( [ 'Uint16Array', 'Uint32Array' ] );
const TEXTURE_MAPS = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'aoMap', 'emissiveMap', 'alphaMap' ];
const FILTERS = new Set( [ 1003, 1004, 1005, 1006, 1007, 1008 ] );
const WRAPS = new Set( [ 1000, 1001, 1002 ] );
const COMPONENT_ID = /^[a-z0-9-]{1,40}$/;
const UUID = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

class ShareError extends Error {}

// utilidades de validação ---------------------------------------------------------------------------------------------

const isNumber = ( v ) => typeof v === 'number' && Number.isFinite( v );
const num = ( v, min, max, fallback ) => isNumber( v ) && v >= min && v <= max ? v : fallback;
const color = ( v, fallback = 0xffffff ) => Number.isInteger( v ) && v >= 0 && v <= 0xffffff ? v : fallback;
const numbers = ( v, length, limit = 1e7 ) => Array.isArray( v ) && v.length === length && v.every( ( n ) => isNumber( n ) && Math.abs( n ) <= limit ) ? v.slice() : null;
const uuid = ( v ) => typeof v === 'string' && UUID.test( v ) ? v : null;

function text( value, max ) {

	if ( typeof value !== 'string' ) return '';
	let out = '';
	for ( const char of value ) {

		const code = char.codePointAt( 0 );
		out += code < 32 || code === 127 ? ' ' : char;

	}

	return Array.from( out.replace( /\s+/g, ' ' ).trim() ).slice( 0, max ).join( '' );

}

function newReport() {

	return { removed: {}, notes: [] };

}

function note( report, key, count = 1 ) {

	report.removed[ key ] = ( report.removed[ key ] || 0 ) + count;

}

// descrição legível do que foi filtrado (apresentada no editor e no visualizador)
const REMOVED_LABELS = {
	scripts: 'scripts (não executados)',
	topLevel: 'blocos de dados não permitidos',
	objectTypes: 'objetos de tipo não suportado',
	userData: 'metadados internos de objetos',
	geometries: 'geometrias inválidas',
	attributes: 'atributos de geometria não suportados',
	materials: 'materiais não suportados (acabamento substituto)',
	textures: 'texturas inválidas',
	images: 'imagens não suportadas',
	externalImages: 'imagens externas bloqueadas (nenhuma requisição feita)',
	references: 'referências inexistentes',
	views: 'vistas inválidas',
	duplicateIds: 'identificadores repetidos'
};

function describeReport( report ) {

	return Object.entries( report.removed ).filter( ( [ , count ] ) => count > 0 ).map( ( [ key, count ] ) => `${count} ${REMOVED_LABELS[ key ] || key}` );

}

// sanitização da cena ---------------------------------------------------------------------------------------------------

function sanitizeImage( image, report ) {

	const id = uuid( image && image.uuid );
	if ( id === null ) return null;

	const url = image.url;
	if ( typeof url !== 'string' ) {

		note( report, 'images' ); // dados brutos, cubos, listas: não suportados neste formato
		return null;

	}

	if ( url.length > LIMITS.imageChars ) {

		note( report, 'images' );
		return null;

	}

	if ( DATA_URL.test( url ) === false ) {

		note( report, /^(https?:|\/\/|blob:|file:|ftp:)/i.test( url.trim() ) || url.startsWith( '/' ) || url.startsWith( '.' ) ? 'externalImages' : 'images' );
		return null;

	}

	return { uuid: id, url };

}

function sanitizeTexture( texture, images, report ) {

	const id = uuid( texture && texture.uuid );
	if ( id === null || typeof texture.image !== 'string' || images.has( texture.image ) === false ) {

		note( report, 'textures' );
		return null;

	}

	const clean = { uuid: id, image: texture.image, mapping: 300 };
	clean.name = text( texture.name, LIMITS.name );
	const pair = ( value, fallback ) => numbers( value, 2, 1e4 ) || fallback;
	clean.repeat = pair( texture.repeat, [ 1, 1 ] );
	clean.offset = pair( texture.offset, [ 0, 0 ] );
	clean.center = pair( texture.center, [ 0, 0 ] );
	clean.rotation = num( texture.rotation, - 1e3, 1e3, 0 );
	clean.wrap = Array.isArray( texture.wrap ) && texture.wrap.length === 2 && texture.wrap.every( ( w ) => WRAPS.has( w ) ) ? texture.wrap.slice() : [ 1001, 1001 ];
	clean.channel = Number.isInteger( texture.channel ) && texture.channel >= 0 && texture.channel <= 1 ? texture.channel : 0;
	clean.colorSpace = texture.colorSpace === 'srgb' ? 'srgb' : ( texture.colorSpace === 'srgb-linear' ? 'srgb-linear' : '' );
	clean.minFilter = FILTERS.has( texture.minFilter ) ? texture.minFilter : 1008;
	clean.magFilter = texture.magFilter === 1003 || texture.magFilter === 1006 ? texture.magFilter : 1006;
	clean.anisotropy = Number.isInteger( texture.anisotropy ) ? Math.min( Math.max( texture.anisotropy, 1 ), 16 ) : 1;
	clean.flipY = texture.flipY !== false;
	clean.generateMipmaps = texture.generateMipmaps !== false;
	clean.premultiplyAlpha = texture.premultiplyAlpha === true;
	clean.unpackAlignment = [ 1, 2, 4, 8 ].includes( texture.unpackAlignment ) ? texture.unpackAlignment : 4;
	return clean;

}

function sanitizeMaterial( material, textures, report ) {

	const id = uuid( material && material.uuid );
	if ( id === null ) return null;

	if ( MATERIAL_TYPES.has( material.type ) === false ) {

		note( report, 'materials' );
		return { uuid: id, type: 'MeshStandardMaterial', name: text( material.name, LIMITS.name ), color: color( material.color, 0xbfbfbf ), roughness: 0.8, metalness: 0 };

	}

	const clean = { uuid: id, type: material.type, name: text( material.name, LIMITS.name ) };
	if ( material.color !== undefined ) clean.color = color( material.color );
	if ( material.emissive !== undefined ) clean.emissive = color( material.emissive, 0 );
	if ( material.specular !== undefined ) clean.specular = color( material.specular, 0x111111 );
	const scalar = ( key, min, max ) => {

		if ( isNumber( material[ key ] ) ) clean[ key ] = Math.min( Math.max( material[ key ], min ), max );

	};

	scalar( 'roughness', 0, 1 );
	scalar( 'metalness', 0, 1 );
	scalar( 'emissiveIntensity', 0, 100 );
	scalar( 'shininess', 0, 1000 );
	scalar( 'opacity', 0, 1 );
	scalar( 'alphaTest', 0, 1 );
	scalar( 'bumpScale', - 100, 100 );
	scalar( 'aoMapIntensity', 0, 10 );
	scalar( 'clearcoat', 0, 1 );
	scalar( 'clearcoatRoughness', 0, 1 );
	scalar( 'ior', 1, 2.333 );
	scalar( 'transmission', 0, 1 );
	scalar( 'thickness', 0, 1e4 );
	scalar( 'reflectivity', 0, 1 );
	for ( const key of [ 'transparent', 'flatShading', 'vertexColors', 'depthTest', 'depthWrite', 'wireframe' ] ) {

		if ( typeof material[ key ] === 'boolean' ) clean[ key ] = material[ key ];

	}

	if ( [ 0, 1, 2 ].includes( material.side ) ) clean.side = material.side;
	const normalScale = numbers( material.normalScale, 2, 100 );
	if ( normalScale !== null ) clean.normalScale = normalScale;

	for ( const key of TEXTURE_MAPS ) {

		if ( material[ key ] === undefined ) continue;
		if ( typeof material[ key ] === 'string' && textures.has( material[ key ] ) ) clean[ key ] = material[ key ];
		else note( report, 'references' );

	}

	return clean;

}

function sanitizeGeometry( geometry, report, totals ) {

	const id = uuid( geometry && geometry.uuid );
	if ( id === null || geometry.type !== 'BufferGeometry' || geometry.data === null || typeof geometry.data !== 'object' ) {

		note( report, 'geometries' );
		return null;

	}

	const data = geometry.data;
	const attributes = {};
	let vertexCount = - 1;

	for ( const [ name, attribute ] of Object.entries( data.attributes || {} ) ) {

		if ( ATTRIBUTES.has( name ) === false || attribute === null || typeof attribute !== 'object' ) {

			note( report, 'attributes' );
			continue;

		}

		const itemSize = attribute.itemSize;
		if ( Number.isInteger( itemSize ) === false || itemSize < 1 || itemSize > 4 || ARRAY_TYPES.has( attribute.type ) === false || Array.isArray( attribute.array ) === false || attribute.array.length % itemSize !== 0 ) {

			if ( name === 'position' ) {

				note( report, 'geometries' );
				return null;

			}

			note( report, 'attributes' );
			continue;

		}

		const array = attribute.array;
		let finite = true;
		for ( let i = 0; i < array.length; i ++ ) {

			if ( typeof array[ i ] !== 'number' || Number.isFinite( array[ i ] ) === false ) {

				finite = false;
				break;

			}

		}

		if ( finite === false ) {

			if ( name === 'position' ) {

				note( report, 'geometries' );
				return null;

			}

			note( report, 'attributes' );
			continue;

		}

		const count = array.length / itemSize;
		if ( name === 'position' ) vertexCount = count;
		attributes[ name ] = { itemSize, type: attribute.type, array, normalized: attribute.normalized === true };

	}

	if ( vertexCount <= 0 || attributes.position === undefined || attributes.position.itemSize !== 3 ) {

		note( report, 'geometries' );
		return null;

	}

	for ( const name of Object.keys( attributes ) ) {

		if ( attributes[ name ].array.length / attributes[ name ].itemSize !== vertexCount ) {

			delete attributes[ name ];
			note( report, 'attributes' );

		}

	}

	totals.vertices += vertexCount;
	if ( totals.vertices > LIMITS.vertices ) throw new ShareError( 'O modelo é complexo demais para este visualizador (limite de vértices excedido).' );

	const clean = { uuid: id, type: 'BufferGeometry', data: { attributes } };

	if ( data.index !== undefined ) {

		const index = data.index;
		if ( index === null || INDEX_TYPES.has( index.type ) === false || Array.isArray( index.array ) === false || index.array.some( ( v ) => Number.isInteger( v ) === false || v < 0 || v >= vertexCount ) ) {

			note( report, 'geometries' );
			return null;

		}

		totals.indices += index.array.length;
		if ( totals.indices > LIMITS.indices ) throw new ShareError( 'O modelo é complexo demais para este visualizador (limite de faces excedido).' );
		clean.data.index = { type: index.type, array: index.array };

	}

	if ( Array.isArray( data.groups ) ) {

		clean.data.groups = data.groups.slice( 0, 256 ).filter( ( g ) => g !== null && typeof g === 'object' && Number.isInteger( g.start ) && g.start >= 0 && ( Number.isInteger( g.count ) || g.count === Infinity ) && Number.isInteger( g.materialIndex ) && g.materialIndex >= 0 && g.materialIndex < 64 ).map( ( g ) => ( { start: g.start, count: g.count, materialIndex: g.materialIndex } ) );

	}

	if ( data.boundingSphere && numbers( data.boundingSphere.center, 3 ) !== null && isNumber( data.boundingSphere.radius ) && data.boundingSphere.radius >= 0 ) {

		clean.data.boundingSphere = { center: data.boundingSphere.center.slice(), radius: data.boundingSphere.radius };

	}

	return clean;

}

// metadados de visualização de um objeto (o ÚNICO userData que entra no pacote)
function sanitizeShareInfo( share ) {

	if ( share === null || typeof share !== 'object' ) return null;
	const clean = {};
	if ( share.unit === true ) clean.unit = true;
	if ( [ 'component', 'object', 'opening', 'lighting' ].includes( share.kind ) ) clean.kind = share.kind;
	if ( typeof share.component === 'string' && COMPONENT_ID.test( share.component ) ) clean.component = share.component;
	const label = text( share.label, LIMITS.label );
	if ( label !== '' ) clean.label = label;
	const dims = numbers( share.dims, 3, 1e5 );
	if ( dims !== null && dims.every( ( d ) => d >= 0 ) ) clean.dims = dims;
	if ( share.hosted === true ) clean.hosted = true;
	return Object.keys( clean ).length > 0 ? clean : null;

}

function sanitizeShadow( shadow ) {

	if ( shadow === null || typeof shadow !== 'object' ) return null;
	const clean = { bias: num( shadow.bias, - 1, 1, 0 ), normalBias: num( shadow.normalBias, - 10, 10, 0 ), radius: num( shadow.radius, 0, 25, 1 ) };
	const mapSize = numbers( shadow.mapSize, 2 );
	clean.mapSize = mapSize !== null && mapSize.every( ( v ) => Number.isInteger( v ) && v >= 16 && v <= 4096 ) ? mapSize : [ 1024, 1024 ];

	const camera = shadow.camera;
	if ( camera !== null && typeof camera === 'object' && ( camera.type === 'OrthographicCamera' || camera.type === 'PerspectiveCamera' ) ) {

		const c = { uuid: uuid( camera.uuid ) || 'shadow-camera', type: camera.type, near: num( camera.near, 1e-4, 1e5, 0.5 ), far: num( camera.far, 1e-3, 1e6, 500 ), zoom: num( camera.zoom, 1e-3, 1e3, 1 ) };
		if ( camera.type === 'OrthographicCamera' ) for ( const key of [ 'left', 'right', 'top', 'bottom' ] ) c[ key ] = num( camera[ key ], - 1e5, 1e5, key === 'left' || key === 'bottom' ? - 5 : 5 );
		else Object.assign( c, { fov: num( camera.fov, 1, 179, 50 ), aspect: num( camera.aspect, 1e-3, 1e3, 1 ) } );
		clean.camera = c;

	}

	return clean;

}

function sanitizeObject( object, ctx, depth ) {

	if ( object === null || typeof object !== 'object' ) return null;
	if ( depth > LIMITS.depth ) throw new ShareError( 'A hierarquia de objetos é profunda demais.' );
	if ( ++ ctx.count > LIMITS.objects ) throw new ShareError( 'O modelo tem objetos demais para este visualizador.' );

	const report = ctx.report;
	let type = object.type;
	const children = Array.isArray( object.children ) ? object.children : [];

	if ( OBJECT_TYPES.has( type ) === false || ( depth > 0 && type === 'Scene' ) ) {

		note( report, 'objectTypes' );
		if ( children.length === 0 ) return null;
		type = 'Group'; // tipo não suportado com filhos: a hierarquia (e o que ela contém) é preservada

	}

	if ( LIGHT_TYPES.has( type ) && ctx.lighting === false ) return null;

	let id = uuid( object.uuid );
	if ( id === null || ctx.ids.has( id ) ) {

		note( report, 'duplicateIds' );
		id = `obj-${ctx.count}`;
		while ( ctx.ids.has( id ) ) id += '-x';

	}

	ctx.ids.add( id );

	const clean = { uuid: id, type };
	const name = ctx.names ? text( object.name, LIMITS.name ) : '';
	if ( name !== '' ) clean.name = name;
	clean.matrix = numbers( object.matrix, 16, 1e7 ) || [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];
	if ( object.visible === false ) clean.visible = false;
	if ( object.castShadow === true ) clean.castShadow = true;
	if ( object.receiveShadow === true ) clean.receiveShadow = true;

	if ( object.userData !== undefined && object.userData !== null && typeof object.userData === 'object' ) {

		const keys = Object.keys( object.userData );
		const share = sanitizeShareInfo( object.userData.share );
		if ( share !== null ) {

			if ( ctx.dimensions === false ) delete share.dims;
			clean.userData = { share };

		}

		const dropped = keys.filter( ( key ) => key !== 'share' );
		if ( dropped.some( ( key ) => /script/i.test( key ) ) ) note( report, 'scripts' );
		if ( dropped.length > 0 ) note( report, 'userData', dropped.length );

	}

	if ( type === 'Mesh' ) {

		if ( typeof object.geometry !== 'string' || ctx.geometries.has( object.geometry ) === false ) {

			note( report, 'references' );
			if ( children.length === 0 ) return null;
			clean.type = 'Group';

		} else {

			clean.geometry = object.geometry;
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			const resolved = materials.slice( 0, 64 ).map( ( m ) => {

				if ( typeof m === 'string' && ctx.materials.has( m ) ) return m;
				note( report, 'references' );
				return ctx.fallbackMaterial();

			} );
			clean.material = Array.isArray( object.material ) ? resolved : resolved[ 0 ];

		}

	}

	if ( LIGHT_TYPES.has( type ) ) {

		clean.color = color( object.color );
		clean.intensity = num( object.intensity, 0, 1e6, 1 );
		if ( type === 'HemisphereLight' ) clean.groundColor = color( object.groundColor, 0x444444 );
		if ( type === 'PointLight' || type === 'SpotLight' ) {

			clean.distance = num( object.distance, 0, 1e6, 0 );
			clean.decay = num( object.decay, 0, 10, 2 );

		}

		if ( type === 'SpotLight' ) {

			clean.angle = num( object.angle, 0, Math.PI / 2, Math.PI / 3 );
			clean.penumbra = num( object.penumbra, 0, 1, 0 );

		}

		if ( type === 'DirectionalLight' || type === 'SpotLight' ) {

			if ( uuid( object.target ) !== null ) ctx.targets.push( [ clean, object.target ] );

		}

		if ( type !== 'AmbientLight' && type !== 'HemisphereLight' ) {

			const shadow = sanitizeShadow( object.shadow );
			if ( shadow !== null ) clean.shadow = shadow;

		}

	}

	if ( type === 'Scene' ) {

		if ( Number.isInteger( object.background ) ) clean.background = color( object.background );
		const fog = object.fog;
		if ( fog !== null && typeof fog === 'object' ) {

			if ( fog.type === 'Fog' ) clean.fog = { type: 'Fog', color: color( fog.color ), near: num( fog.near, 0, 1e6, 1 ), far: num( fog.far, 0, 1e7, 1000 ) };
			else if ( fog.type === 'FogExp2' ) clean.fog = { type: 'FogExp2', color: color( fog.color ), density: num( fog.density, 0, 10, 0.00025 ) };

		}

	}

	const cleanChildren = [];
	for ( const child of children ) {

		const result = sanitizeObject( child, ctx, depth + 1 );
		if ( result !== null ) cleanChildren.push( result );

	}

	if ( cleanChildren.length > 0 ) clean.children = cleanChildren;
	return clean;

}

// options: { materials, lighting, names, dimensions } (o visualizador usa todos verdadeiros: aplica o que vier permitido)
function sanitizeScene( json, options = {} ) {

	const report = newReport();
	if ( json === null || typeof json !== 'object' || json.object === null || typeof json.object !== 'object' ) throw new ShareError( 'A cena compartilhada está ausente ou incompleta.' );
	if ( json.object.type !== 'Scene' ) throw new ShareError( 'A raiz do arquivo compartilhado não é uma cena.' );

	const allowedTop = new Set( [ 'metadata', 'object', 'geometries', 'materials', 'textures', 'images' ] );
	for ( const key of Object.keys( json ) ) {

		if ( allowedTop.has( key ) ) continue;
		note( report, /script/i.test( key ) ? 'scripts' : 'topLevel' );

	}

	const opts = Object.assign( { materials: true, lighting: true, names: true, dimensions: true }, options );
	const list = ( value, max, label ) => {

		if ( value === undefined ) return [];
		if ( Array.isArray( value ) === false ) throw new ShareError( `Lista de ${label} inválida.` );
		if ( value.length > max ) throw new ShareError( `O modelo tem ${label} demais para este visualizador.` );
		return value;

	};

	const totals = { vertices: 0, indices: 0 };

	const images = new Map();
	const textures = new Map();
	if ( opts.materials ) {

		for ( const image of list( json.images, LIMITS.images, 'imagens' ) ) {

			const clean = sanitizeImage( image, report );
			if ( clean !== null && images.has( clean.uuid ) === false ) images.set( clean.uuid, clean );

		}

		for ( const texture of list( json.textures, LIMITS.textures, 'texturas' ) ) {

			const clean = sanitizeTexture( texture, images, report );
			if ( clean !== null && textures.has( clean.uuid ) === false ) textures.set( clean.uuid, clean );

		}

	}

	const materials = new Map();
	for ( const material of list( json.materials, LIMITS.materials, 'materiais' ) ) {

		const clean = opts.materials ? sanitizeMaterial( material, textures, report ) : null;
		const id = uuid( material && material.uuid );
		if ( id === null || materials.has( id ) ) continue;
		materials.set( id, clean !== null ? clean : { uuid: id, type: 'MeshStandardMaterial', color: 0xbfbfbf, roughness: 0.8, metalness: 0 } );

	}

	const geometries = new Map();
	for ( const geometry of list( json.geometries, LIMITS.geometries, 'geometrias' ) ) {

		const clean = sanitizeGeometry( geometry, report, totals );
		if ( clean !== null && geometries.has( clean.uuid ) === false ) geometries.set( clean.uuid, clean );

	}

	let fallback = null;
	const ctx = {
		report, count: 0, ids: new Set(), targets: [], geometries, materials,
		lighting: opts.lighting, names: opts.names, dimensions: opts.dimensions,
		fallbackMaterial: () => {

			if ( fallback === null ) {

				fallback = 'share-fallback-material';
				materials.set( fallback, { uuid: fallback, type: 'MeshStandardMaterial', name: 'Acabamento substituto', color: 0xbfbfbf, roughness: 0.8, metalness: 0 } );

			}

			return fallback;

		}
	};

	const object = sanitizeObject( json.object, ctx, 0 );

	for ( const [ light, target ] of ctx.targets ) {

		if ( ctx.ids.has( target ) ) light.target = target;

	}

	// só o que é usado segue adiante (nada órfão no pacote)
	const used = { geometries: new Set(), materials: new Set() };
	( function collect( node ) {

		if ( node.geometry !== undefined ) used.geometries.add( node.geometry );
		if ( node.material !== undefined ) for ( const m of [].concat( node.material ) ) used.materials.add( m );
		for ( const child of node.children || [] ) collect( child );

	} )( object );

	const outMaterials = [ ...materials.values() ].filter( ( m ) => used.materials.has( m.uuid ) );
	const usedTextures = new Set( outMaterials.flatMap( ( m ) => TEXTURE_MAPS.map( ( key ) => m[ key ] ).filter( Boolean ) ) );
	const outTextures = [ ...textures.values() ].filter( ( t ) => usedTextures.has( t.uuid ) );
	const usedImages = new Set( outTextures.map( ( t ) => t.image ) );

	const scene = {
		metadata: { format: SCENE_FORMAT, version: SCENE_VERSION },
		object,
		geometries: [ ...geometries.values() ].filter( ( g ) => used.geometries.has( g.uuid ) ),
		materials: outMaterials,
		textures: outTextures,
		images: [ ...images.values() ].filter( ( i ) => usedImages.has( i.uuid ) )
	};

	const stats = { objects: ctx.count, units: 0, materials: scene.materials.length, textures: scene.textures.length, vertices: totals.vertices, lights: 0 };
	( function count( node ) {

		if ( node.userData && node.userData.share && node.userData.share.unit ) stats.units ++;
		if ( LIGHT_TYPES.has( node.type ) ) stats.lights ++;
		for ( const child of node.children || [] ) count( child );

	} )( object );

	return { scene, report, stats };

}

function sanitizeViews( value, sanitizeView, report ) {

	const list = value !== null && typeof value === 'object' && Array.isArray( value.views ) ? value.views : [];
	const views = [];
	for ( const raw of list.slice( 0, LIMITS.views ) ) {

		const clean = sanitizeView( raw, views.length );
		if ( clean === null ) note( report, 'views' );
		else views.push( clean );

	}

	if ( list.length > LIMITS.views ) note( report, 'views', list.length - LIMITS.views );
	return views;

}

function sanitizeDisplay( display ) {

	const d = display !== null && typeof display === 'object' ? display : {};
	return {
		units: [ 'm', 'cm', 'mm' ].includes( d.units ) ? d.units : 'm',
		toneMapping: Number.isInteger( d.toneMapping ) && d.toneMapping >= 0 && d.toneMapping <= 7 ? d.toneMapping : 0,
		exposure: num( d.exposure, 0, 10, 1 ),
		shadows: d.shadows !== false,
		environment: [ 'Default', 'Room', 'None', 'ModelViewer' ].includes( d.environment ) ? d.environment : 'Default'
	};

}

// pacote -----------------------------------------------------------------------------------------------------------------

async function contentHashOf( sceneHash, viewsHash ) {

	return digest( `project3ds-share-v1\n${sceneHash}\n${viewsHash}` );

}

// { manifest (sem files/contentHash), sceneText, viewsText, preview (Uint8Array|null) } -> { bytes, manifest }
async function buildPackage( { manifest, sceneText, viewsText, preview } ) {

	const files = {};
	const entries = [];
	const add = async ( path, bytes, textValue ) => {

		files[ path ] = bytes;
		entries.push( { path, role: FILES[ path ], size: bytes.length, sha256: textValue !== undefined ? await digest( textValue ) : await digestBytes( bytes ) } );

	};

	await add( 'scene.json', strToU8( sceneText ), sceneText );
	await add( 'views.json', strToU8( viewsText ), viewsText );
	if ( preview instanceof Uint8Array && preview.length > 0 && preview.length <= LIMITS.previewBytes ) await add( 'preview.jpg', preview );

	const complete = Object.assign( {}, manifest, {
		format: PACKAGE_FORMAT,
		formatVersion: PACKAGE_VERSION,
		permissions: Object.assign( {}, PERMISSIONS ),
		contentHash: await contentHashOf( entries[ 0 ].sha256, entries[ 1 ].sha256 ),
		files: entries
	} );

	files[ 'manifest.json' ] = strToU8( JSON.stringify( complete, null, 1 ) );
	return { bytes: zipSync( files, { level: 6 } ), manifest: complete };

}

async function digestBytes( bytes ) {

	const subtle = globalThis.crypto && globalThis.crypto.subtle;
	if ( subtle !== undefined ) {

		const buffer = await subtle.digest( 'SHA-256', bytes );
		return 'sha256:' + Array.from( new Uint8Array( buffer ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

	}

	// sem Web Crypto: FNV sobre os bytes (marcado como "fnv": verificação fraca, nunca apresentada como SHA-256)
	let text = '';
	for ( let i = 0; i < bytes.length; i += 4096 ) text += String.fromCharCode.apply( null, bytes.subarray( i, i + 4096 ) );
	return digest( text );

}

// leitura de um pacote recebido (Uint8Array) -> { manifest, scene, views, preview, report } ou ShareError.
// sanitizeView vem do módulo de vistas da EV-008 (injetado para manter este arquivo sem dependências de Three.js)
async function readPackage( bytes, { sanitizeView } ) {

	if ( ! ( bytes instanceof Uint8Array ) || bytes.length === 0 ) throw new ShareError( 'O arquivo está vazio.' );
	if ( bytes.length > LIMITS.zipBytes ) throw new ShareError( 'Arquivo grande demais para o visualizador (limite de 150 MB).' );
	if ( bytes.length < 2 || bytes[ 0 ] !== 0x50 || bytes[ 1 ] !== 0x4b ) throw new ShareError( 'O arquivo não é um pacote de visualização do Project3DS (.p3ds-review.zip).' );
	if ( bytes.length < 22 ) throw new ShareError( 'O arquivo .zip está corrompido ou incompleto.' );

	let count = 0, total = 0;
	const undeclared = [];
	let entries;

	try {

		entries = unzipSync( bytes, {
			filter: ( info ) => {

				count ++;
				if ( count > LIMITS.entries ) throw new ShareError( 'O pacote contém arquivos demais.' );
				if ( FILES[ info.name ] === undefined ) {

					undeclared.push( info.name );
					return false; // nada fora do formato é descompactado

				}

				total += info.originalSize;
				if ( info.originalSize > LIMITS.entryBytes || total > LIMITS.totalBytes ) throw new ShareError( 'O conteúdo descompactado do pacote excede o limite seguro.' );
				return true;

			}
		} );

	} catch ( error ) {

		if ( error instanceof ShareError ) throw error;
		throw new ShareError( 'O arquivo .zip está corrompido ou incompleto.' );

	}

	if ( undeclared.length > 0 ) throw new ShareError( `O pacote contém arquivos não permitidos (${undeclared.slice( 0, 3 ).map( ( n ) => text( n, 60 ) ).join( ', ' )}).` );
	if ( entries[ 'manifest.json' ] === undefined ) throw new ShareError( 'Manifesto ausente: o arquivo não é um pacote de visualização do Project3DS.' );

	let manifest;
	try {

		manifest = JSON.parse( strFromU8( entries[ 'manifest.json' ] ) );

	} catch ( error ) {

		throw new ShareError( 'Manifesto corrompido.' );

	}

	if ( manifest === null || typeof manifest !== 'object' || manifest.format !== PACKAGE_FORMAT ) throw new ShareError( 'Formato de pacote desconhecido.' );
	if ( manifest.formatVersion !== PACKAGE_VERSION ) throw new ShareError( `Versão de pacote não suportada (${text( String( manifest.formatVersion ), 10 )}). Atualize a página do visualizador.` );
	if ( uuid( manifest.shareId ) === null ) throw new ShareError( 'Manifesto sem identificador de compartilhamento válido.' );
	if ( Array.isArray( manifest.files ) === false ) throw new ShareError( 'Manifesto sem a lista de arquivos.' );

	const declared = new Map();
	for ( const file of manifest.files.slice( 0, LIMITS.entries ) ) {

		if ( file === null || typeof file !== 'object' || FILES[ file.path ] === undefined || file.path === 'manifest.json' || FILES[ file.path ] !== file.role ) throw new ShareError( 'O manifesto declara um arquivo não permitido.' );
		declared.set( file.path, file );

	}

	for ( const name of Object.keys( entries ) ) {

		if ( name !== 'manifest.json' && declared.has( name ) === false ) throw new ShareError( `Arquivo não declarado no manifesto: ${name}.` );

	}

	const hashes = {};
	for ( const [ path, file ] of declared ) {

		const raw = entries[ path ];
		if ( raw === undefined ) throw new ShareError( `Pacote incompleto: ${path} ausente.` );
		if ( raw.length !== file.size ) throw new ShareError( `Falha de integridade: tamanho de ${path} não confere.` );
		const hash = path.endsWith( '.json' ) ? await digest( strFromU8( raw ) ) : await digestBytes( raw );
		if ( hash !== file.sha256 ) throw new ShareError( `Falha de integridade: o conteúdo de ${path} foi alterado ou corrompido.` );
		hashes[ path ] = hash;

	}

	if ( hashes[ 'scene.json' ] === undefined || hashes[ 'views.json' ] === undefined ) throw new ShareError( 'Pacote incompleto: cena ou vistas ausentes.' );
	const contentHash = await contentHashOf( hashes[ 'scene.json' ], hashes[ 'views.json' ] );
	if ( contentHash !== manifest.contentHash ) throw new ShareError( 'Falha de integridade: o hash do conteúdo compartilhado não confere.' );

	let sceneJSON, viewsJSON;
	try {

		sceneJSON = JSON.parse( strFromU8( entries[ 'scene.json' ] ) );
		viewsJSON = JSON.parse( strFromU8( entries[ 'views.json' ] ) );

	} catch ( error ) {

		throw new ShareError( 'A cena compartilhada está corrompida (JSON inválido).' );

	}

	if ( sceneJSON === null || typeof sceneJSON !== 'object' || sceneJSON.metadata === null || typeof sceneJSON.metadata !== 'object' || sceneJSON.metadata.format !== SCENE_FORMAT ) throw new ShareError( 'A cena do pacote não está no formato esperado.' );
	if ( sceneJSON.metadata.version !== SCENE_VERSION ) throw new ShareError( 'Versão da cena não suportada. Atualize a página do visualizador.' );

	// sanitização completa no RECEBIMENTO, mesmo que o editor já a tenha feito (o arquivo pode ter sido montado à mão)
	const { scene, report, stats } = sanitizeScene( sceneJSON );
	const views = sanitizeViews( viewsJSON, sanitizeView, report );

	let preview = null;
	const jpeg = entries[ 'preview.jpg' ];
	if ( jpeg !== undefined && jpeg.length <= LIMITS.previewBytes && jpeg[ 0 ] === 0xff && jpeg[ 1 ] === 0xd8 && jpeg[ 2 ] === 0xff ) preview = jpeg;

	const source = manifest.source !== null && typeof manifest.source === 'object' ? manifest.source : {};
	const cleanManifest = {
		format: PACKAGE_FORMAT,
		formatVersion: PACKAGE_VERSION,
		shareId: manifest.shareId,
		source: { projectId: uuid( source.projectId ), revision: Number.isInteger( source.revision ) && source.revision >= 0 ? source.revision : null, versionLabel: text( source.versionLabel, LIMITS.label ) },
		title: text( manifest.title, LIMITS.title ) || 'Projeto compartilhado',
		description: text( manifest.description, LIMITS.description ),
		createdAt: typeof manifest.createdAt === 'string' && Number.isFinite( Date.parse( manifest.createdAt ) ) ? new Date( Date.parse( manifest.createdAt ) ).toISOString() : null,
		permissions: Object.assign( {}, PERMISSIONS ), // capacidades FIXAS do visualizador: o arquivo não as amplia
		contents: Object.fromEntries( CONTENT_OPTIONS.map( ( o ) => [ o.key, manifest.contents ? manifest.contents[ o.key ] !== false : true ] ) ),
		display: sanitizeDisplay( manifest.display ),
		contentHash
	};

	return { manifest: cleanManifest, scene, views, preview, report, stats };

}

export {
	PACKAGE_FORMAT,
	PACKAGE_VERSION,
	SCENE_FORMAT,
	SCENE_VERSION,
	LIMITS as SHARE_LIMITS,
	CONTENT_OPTIONS,
	EXCLUDED,
	PERMISSIONS,
	ShareError,
	sanitizeScene,
	sanitizeViews,
	sanitizeDisplay,
	describeReport,
	buildPackage,
	readPackage,
	digestBytes
};
