// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Serviço de importação independente da cena: lê os arquivos localmente, valida (SimpleMode.ExternalModelValidation),
// decodifica com o GLTFLoader do repositório (DRACO e Meshopt locais; KTX2 recusado por não ser preservável) e devolve
// um objeto TEMPORÁRIO, nunca inserido na cena aqui.
//
// Segurança: o gerenciador de carregamento só entrega URLs data:, os blob: criados pelo próprio carregador e os
// arquivos auxiliares fornecidos (mapeados para blob: locais, revogados ao final). Qualquer outro endereço vira um
// recurso vazio — nenhuma requisição a domínios externos. Metadados do arquivo (extras/userData) são descartados:
// nada do arquivo pode se passar por componente do Project3DS.
//
// Texturas: cada imagem é reconstituída a partir dos BYTES ORIGINAIS (PNG/JPEG/WebP) como imagem data:. Assim a
// serialização do projeto (Editor.toJSON) grava a imagem original, sem reprocessar a cada salvamento automático, e o
// projeto exportado continua completo em outro navegador (não depende da biblioteca local nem de URLs blob:).

import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { ModelError, inspectFiles, analyzeObject, checkDimensions, extensionOf, getLimits, IMAGE_TYPES } from './SimpleMode.ExternalModelValidation.js';

const DRACO_PATH = '../examples/jsm/libs/draco/gltf/';

let activeToken = null;

class CancelledError extends Error {

	constructor() {

		super( 'Importação cancelada.' );
		this.name = 'CancelledError';

	}

}

function bytesToDataURL( bytes, mime ) {

	return new Promise( ( resolve, reject ) => {

		const reader = new FileReader();
		reader.onload = () => resolve( reader.result );
		reader.onerror = () => reject( reader.error );
		reader.readAsDataURL( new Blob( [ bytes ], { type: mime } ) );

	} );

}

function sniffImage( bytes ) {

	const b = new Uint8Array( bytes, 0, Math.min( 12, bytes.byteLength ) );
	if ( b[ 0 ] === 0x89 && b[ 1 ] === 0x50 && b[ 2 ] === 0x4e && b[ 3 ] === 0x47 ) return 'image/png';
	if ( b[ 0 ] === 0xff && b[ 1 ] === 0xd8 && b[ 2 ] === 0xff ) return 'image/jpeg';
	if ( b[ 0 ] === 0x52 && b[ 1 ] === 0x49 && b[ 2 ] === 0x46 && b[ 3 ] === 0x46 && b[ 8 ] === 0x57 && b[ 9 ] === 0x45 && b[ 10 ] === 0x42 && b[ 11 ] === 0x50 ) return 'image/webp';
	return null;

}

function loadImage( url ) {

	return new Promise( ( resolve, reject ) => {

		const image = new Image();
		image.onload = () => resolve( image );
		image.onerror = () => reject( new ModelError( 'Uma textura do modelo não pôde ser decodificada (imagem corrompida ou de formato não suportado).' ) );
		image.src = url;

	} );

}

// descarta todos os recursos de um objeto temporário (usado em cancelamentos e falhas)
function disposeObject( root ) {

	if ( root === null || root === undefined ) return;
	const textures = new Set();
	root.traverse( ( object ) => {

		if ( object.geometry ) object.geometry.dispose();
		for ( const material of [].concat( object.material || [] ) ) {

			for ( const value of Object.values( material ) ) if ( value && value.isTexture ) textures.add( value );
			material.dispose();

		}

	} );
	for ( const texture of textures ) {

		if ( typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap ) texture.image.close();
		texture.dispose();

	}

}

// substitui a imagem de cada textura pela imagem original (data:), compartilhando por fonte (Source)
async function embedTextures( gltf, inspected, token ) {

	const parser = gltf.parser;
	const json = parser.json;
	const sourceIndex = new Map(); // THREE.Source -> índice de imagem do glTF
	const textures = new Set();

	gltf.scene.traverse( ( object ) => {

		for ( const material of [].concat( object.material || [] ) ) {

			for ( const value of Object.values( material ) ) if ( value && value.isTexture ) textures.add( value );

		}

	} );

	for ( const texture of textures ) {

		const association = parser.associations.get( texture );
		if ( association === undefined || association.textures === undefined || sourceIndex.has( texture.source ) ) continue;
		const definition = json.textures[ association.textures ] || {};
		const source = definition.source !== undefined ? definition.source : ( definition.extensions && definition.extensions.EXT_texture_webp ? definition.extensions.EXT_texture_webp.source : undefined );
		if ( source !== undefined ) sourceIndex.set( texture.source, source );

	}

	const images = new Map(); // índice -> HTMLImageElement
	for ( const texture of textures ) {

		const index = sourceIndex.get( texture.source );
		if ( index === undefined ) throw new ModelError( 'Não foi possível identificar a origem de uma textura do modelo.' );

		if ( images.has( index ) === false ) {

			const definition = json.images[ index ];
			let url;
			if ( definition.bufferView !== undefined ) {

				const bytes = await parser.getDependency( 'bufferView', definition.bufferView );
				const mime = sniffImage( bytes );
				if ( mime === null ) throw new ModelError( 'Textura com conteúdo inválido (esperado PNG, JPEG ou WebP).' );
				url = await bytesToDataURL( bytes, mime );

			} else if ( definition.uri.startsWith( 'data:' ) ) {

				url = definition.uri;

			} else {

				const file = inspected.resources.get( definition.uri );
				const bytes = await file.arrayBuffer();
				const mime = sniffImage( bytes );
				if ( mime === null || IMAGE_TYPES[ mime ] === undefined ) throw new ModelError( `A textura "${file.name}" não é PNG, JPEG ou WebP válido.` );
				url = await bytesToDataURL( bytes, mime );

			}

			if ( token.cancelled ) throw new CancelledError();
			images.set( index, await loadImage( url ) );

		}

		const previous = texture.source.data;
		if ( previous !== images.get( index ) ) {

			if ( typeof ImageBitmap !== 'undefined' && previous instanceof ImageBitmap ) previous.close();
			texture.source.data = images.get( index );
			texture.source.needsUpdate = true;
			texture.needsUpdate = true;

		}

	}

}

// remove do resultado o que não é importado (câmeras, luzes) e limpa os metadados vindos do arquivo
function sanitizeScene( root ) {

	const removed = { cameras: 0, lights: 0 };
	const remove = [];
	root.traverse( ( object ) => {

		if ( object.isCamera ) remove.push( [ object, 'cameras' ] );
		else if ( object.isLight ) remove.push( [ object, 'lights' ] );
		object.userData = {}; // extras/extensões do arquivo: nunca interpretados nem preservados

	} );

	for ( const [ object, kind ] of remove ) {

		object.removeFromParent();
		removed[ kind ] ++;

	}

	// materiais: sem metadados do arquivo
	root.traverse( ( object ) => {

		for ( const material of [].concat( object.material || [] ) ) material.userData = {};

	} );

	return removed;

}

// carrega um modelo. options: { config, onProgress } -> { object, info, stats, warnings, unsupported }
async function loadExternalModel( files, { config } = {} ) {

	if ( activeToken !== null ) activeToken.cancelled = true; // uma importação por vez: a anterior é abandonada
	const token = { cancelled: false };
	activeToken = token;

	const limits = getLimits( config );
	const urls = [];
	let gltf = null;
	let dracoLoader = null;

	try {

		const inspected = await inspectFiles( files, limits );
		if ( token.cancelled ) throw new CancelledError();

		const resourceURLs = new Map();
		for ( const [ uri, file ] of inspected.resources ) {

			const url = URL.createObjectURL( file );
			urls.push( url );
			resourceURLs.set( uri, url );

		}

		const manager = new THREE.LoadingManager();
		const origin = window.location.origin;
		manager.setURLModifier( ( url ) => {

			if ( url.startsWith( 'data:' ) ) return url;
			if ( resourceURLs.has( url ) ) return resourceURLs.get( url );
			if ( url.startsWith( 'blob:' + origin + '/' ) ) return url; // criado pelo próprio carregador (imagens incorporadas)
			const decoded = ( () => {

				try {

					return decodeURIComponent( url );

				} catch ( error ) {

					return url;

				}

			} )();
			for ( const [ uri, target ] of resourceURLs ) if ( decodeURIComponent( uri ) === decoded ) return target;
			return 'data:application/octet-stream;base64,'; // qualquer outro endereço: recurso vazio, sem requisição

		} );

		const loader = new GLTFLoader( manager );
		dracoLoader = new DRACOLoader( manager );
		dracoLoader.setDecoderPath( new URL( DRACO_PATH, window.location.href ).href );
		loader.setDRACOLoader( dracoLoader );
		loader.setMeshoptDecoder( MeshoptDecoder );

		const data = inspected.format === 'glb' ? inspected.buffer : new TextDecoder().decode( inspected.buffer );

		try {

			gltf = await loader.parseAsync( data, '' );

		} catch ( error ) {

			console.warn( error );
			throw new ModelError( 'Não foi possível decodificar o modelo (dados corrompidos ou incompatíveis).' );

		}

		if ( token.cancelled ) throw new CancelledError();

		const root = gltf.scene || ( gltf.scenes && gltf.scenes[ 0 ] );
		if ( root === undefined || root === null ) throw new ModelError( 'O arquivo não contém uma cena com objetos.' );

		const removed = sanitizeScene( root );
		const analysis = analyzeObject( root, limits );

		const blocking = [];
		if ( analysis.unsupported.length > 0 ) blocking.push( ...analysis.unsupported.map( ( item ) => `recurso não suportado: ${item}` ) );
		if ( ( gltf.animations || [] ).length > 0 && ( analysis.unsupported.length > 0 || ( inspected.json.skins || [] ).length > 0 ) ) blocking.push( 'animação dependente de esqueleto ou deformação (removê-la mudaria o modelo)' );
		if ( analysis.problems.length > 0 ) blocking.push( ...analysis.problems );
		if ( analysis.errors.length > 0 ) blocking.push( ...analysis.errors );
		if ( blocking.length > 0 ) throw new ModelError( 'O modelo não pode ser importado:', blocking );

		await embedTextures( gltf, inspected, token );
		if ( token.cancelled ) throw new CancelledError();

		// texturas: dimensão conferida sobre a imagem já decodificada
		const final = analyzeObject( root, limits );
		if ( final.errors.length > 0 ) throw new ModelError( 'O modelo não pode ser importado:', final.errors );

		root.updateMatrixWorld( true );
		const box = new THREE.Box3().setFromObject( root, true );
		if ( box.isEmpty() ) throw new ModelError( 'O modelo não tem geometria mensurável.' );
		const size = box.getSize( new THREE.Vector3() );
		const dimensionProblem = checkDimensions( size, limits );
		if ( dimensionProblem !== null ) throw new ModelError( `O modelo não pode ser importado: ${dimensionProblem}.` );

		const warnings = inspected.warnings.slice();
		if ( removed.cameras > 0 && warnings.some( ( w ) => w.startsWith( 'Câmeras' ) ) === false ) warnings.push( `Câmeras do arquivo (${removed.cameras}) não foram importadas.` );
		if ( removed.lights > 0 && warnings.some( ( w ) => w.startsWith( 'luzes' ) ) === false ) warnings.push( `Luzes do arquivo (${removed.lights}) não foram importadas.` );
		warnings.push( ...final.warnings );

		root.name = root.name || inspected.main.name.replace( /\.(glb|gltf)$/i, '' );

		return {
			object: root,
			info: {
				fileName: inspected.main.name,
				format: inspected.format,
				size: inspected.size,
				auxNames: inspected.auxFiles.map( ( file ) => file.name ),
				generator: typeof inspected.json.asset.generator === 'string' ? inspected.json.asset.generator.slice( 0, 80 ) : '',
				copyright: typeof inspected.json.asset.copyright === 'string' ? inspected.json.asset.copyright.slice( 0, 200 ) : ''
			},
			files: [ inspected.main, ...inspected.auxFiles ],
			stats: final.stats,
			size: { x: size.x, y: size.y, z: size.z },
			minY: box.min.y,
			warnings,
			removed
		};

	} catch ( error ) {

		if ( gltf !== null ) disposeObject( gltf.scene );
		if ( error instanceof ModelError || error instanceof CancelledError ) throw error;
		console.error( error );
		throw new ModelError( 'Falha inesperada ao importar o modelo.' );

	} finally {

		for ( const url of urls ) URL.revokeObjectURL( url );
		if ( dracoLoader !== null ) dracoLoader.dispose(); // encerra os workers do decodificador
		if ( activeToken === token ) activeToken = null;

	}

}

function cancelActiveImport() {

	if ( activeToken !== null ) activeToken.cancelled = true;

}

// verificação de preservação: serializa (como o projeto faz ao salvar), reconstrói e compara.
// A importação só é aceita se geometria, materiais e texturas sobrevivem ao ciclo salvar/reabrir.
async function verifyRoundTrip( object ) {

	const count = ( root ) => {

		const result = { meshes: 0, vertices: 0, materials: new Set(), textures: 0 };
		root.traverse( ( child ) => {

			if ( child.isMesh !== true ) return;
			result.meshes ++;
			result.vertices += child.geometry.attributes.position.count;
			for ( const material of [].concat( child.material ) ) {

				result.materials.add( material.uuid );
				for ( const value of Object.values( material ) ) if ( value && value.isTexture && value.image ) result.textures ++;

			}

		} );
		return { meshes: result.meshes, vertices: result.vertices, materials: result.materials.size, textures: result.textures };

	};

	object.updateMatrixWorld( true );
	const json = object.toJSON();
	const problems = [];
	for ( const image of json.images || [] ) {

		const url = typeof image.url === 'string' ? image.url : '';
		if ( /^data:image\/(png|jpeg|webp);base64,/.test( url ) === false ) problems.push( 'uma textura não pôde ser incorporada ao projeto' );

	}

	// gerenciador PRÓPRIO: o filtro de endereços não pode alterar o DefaultLoadingManager global do Three.js
	// (que o importador do Modo Avançado e o restante do editor usam)
	const manager = new THREE.LoadingManager();
	manager.setURLModifier( ( url ) => url.startsWith( 'data:' ) ? url : 'data:image/png;base64,' );
	const loader = new THREE.ObjectLoader( manager );
	const copy = await loader.parseAsync( json );
	const before = count( object ), after = count( copy );
	for ( const key of [ 'meshes', 'vertices', 'materials', 'textures' ] ) if ( before[ key ] !== after[ key ] ) problems.push( `diferença após reabrir (${key}: ${before[ key ]} → ${after[ key ]})` );

	const boxA = new THREE.Box3().setFromObject( object, true ), boxB = new THREE.Box3().setFromObject( copy, true );
	if ( boxA.min.distanceTo( boxB.min ) > 1e-4 || boxA.max.distanceTo( boxB.max ) > 1e-4 ) problems.push( 'dimensões diferentes após reabrir' );

	disposeObject( copy );
	return { ok: problems.length === 0, problems: [ ...new Set( problems ) ], bytes: JSON.stringify( json ).length };

}

export { loadExternalModel, cancelActiveImport, verifyRoundTrip, disposeObject, CancelledError, extensionOf };
