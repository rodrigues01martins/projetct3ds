// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Validação dos arquivos ANTES da decodificação (estrutura glTF 2.0, caminhos e extensões) e DEPOIS dela (complexidade,
// texturas, dimensões e recursos não suportados). O modelo é entrada não confiável: nada é executado, nenhum endereço
// remoto é resolvido e nada vai para a cena sem confirmação explícita.
//
// GLB: cabeçalho "glTF" + versão 2 + tamanho; blocos JSON e BIN.  GLTF: JSON + arquivos auxiliares selecionados juntos
// (.bin e imagens). Cada URI é conferida: data: (tipos permitidos) ou caminho relativo resolvido SOMENTE entre os
// arquivos fornecidos — esquemas (http:, https:, file:, javascript:, blob:…), caminhos absolutos e ".." que escapem
// do conjunto são recusados; arquivos ausentes são listados pelo nome.

const LIMITS = {
	mainBytes: 50 * 1024 * 1024,
	totalBytes: 100 * 1024 * 1024,
	auxFiles: 64,
	meshes: 500,
	vertices: 1000000,
	triangles: 2000000,
	materials: 256,
	textures: 32,
	textureSize: 4096,
	nodes: 5000,
	depth: 64,
	geometryBytes: 256 * 1024 * 1024,
	minDimension: 0.001,
	maxDimension: 1000,
	warnVertices: 300000,
	warnBytes: 20 * 1024 * 1024
};

// extensões que o carregador trata e cujo resultado é preservável no JSON do projeto
const SUPPORTED_EXTENSIONS = new Set( [
	'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_transform',
	'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_clearcoat', 'KHR_materials_ior',
	'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_sheen',
	'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'EXT_texture_webp'
] );

// reconhecidas, mas não importadas (o restante do modelo continua válido): avisadas
const IGNORED_EXTENSIONS = { KHR_lights_punctual: 'luzes do modelo', KHR_materials_variants: 'variantes de material', EXT_lights_image_based: 'iluminação do modelo' };

// recusadas: o resultado não poderia ser preservado ao salvar/reabrir o projeto, ou mudaria o modelo
const REJECTED_EXTENSIONS = {
	KHR_texture_basisu: 'texturas KTX2/Basis não podem ser preservadas ao salvar o projeto',
	EXT_mesh_gpu_instancing: 'instanciamento por GPU não é suportado no Modo Simples'
};

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BUFFER_DATA = /^data:application\/(octet-stream|gltf-buffer);base64,[A-Za-z0-9+/=]*$/;
const IMAGE_DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]*$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

class ModelError extends Error {

	constructor( message, details = [] ) {

		super( message );
		this.name = 'ModelError';
		this.details = details;

	}

}

// limites configuráveis (config 'externalModels/limits'): só números positivos substituem os padrões
function getLimits( config ) {

	const limits = Object.assign( {}, LIMITS );
	const custom = config !== undefined && config !== null ? config.getKey( 'externalModels/limits' ) : null;
	if ( custom !== null && typeof custom === 'object' ) {

		for ( const key of Object.keys( LIMITS ) ) if ( Number.isFinite( custom[ key ] ) && custom[ key ] > 0 ) limits[ key ] = custom[ key ];

	}

	return limits;

}

function extensionOf( name ) {

	const match = /\.([a-z0-9]+)$/i.exec( name || '' );
	return match !== null ? match[ 1 ].toLowerCase() : '';

}

function formatMB( bytes ) {

	return ( bytes / 1024 / 1024 ).toLocaleString( 'pt-BR', { maximumFractionDigits: 1 } ) + ' MB';

}

// caminho relativo normalizado ("texturas/./cor.png" -> "texturas/cor.png"); null quando inválido ou fora do conjunto
function normalizePath( uri ) {

	let path;
	try {

		path = decodeURIComponent( uri );

	} catch ( error ) {

		return null;

	}

	if ( path === '' || path.startsWith( '/' ) || path.startsWith( '\\' ) || path.includes( '\0' ) || SCHEME.test( path ) ) return null;

	const parts = [];
	for ( const part of path.replace( /\\/g, '/' ).split( '/' ) ) {

		if ( part === '' || part === '.' ) continue;
		if ( part === '..' ) {

			if ( parts.length === 0 ) return null; // escaparia do conjunto fornecido
			parts.pop();
			continue;

		}

		parts.push( part );

	}

	return parts.length > 0 ? parts.join( '/' ) : null;

}

// classificação de uma URI do glTF
function classifyURI( uri, kind ) {

	if ( typeof uri !== 'string' || uri.length === 0 ) return { type: 'invalid', reason: 'URI vazia' };
	if ( uri.startsWith( 'data:' ) ) {

		const ok = kind === 'buffer' ? BUFFER_DATA.test( uri ) : IMAGE_DATA.test( uri );
		return ok ? { type: 'data' } : { type: 'invalid', reason: 'dados incorporados de tipo não permitido' };

	}

	if ( uri.startsWith( '//' ) ) return { type: 'blocked', reason: 'endereço remoto' };
	if ( SCHEME.test( uri ) ) {

		const scheme = uri.slice( 0, uri.indexOf( ':' ) ).toLowerCase();
		return { type: 'blocked', reason: scheme === 'http' || scheme === 'https' ? 'endereço remoto' : `esquema "${scheme}:" não permitido` };

	}

	const path = normalizePath( uri );
	return path === null ? { type: 'blocked', reason: 'caminho fora dos arquivos selecionados' } : { type: 'relative', path };

}

function readGLB( buffer ) {

	const view = new DataView( buffer );
	if ( buffer.byteLength < 20 || view.getUint32( 0, true ) !== 0x46546C67 ) throw new ModelError( 'O arquivo não é um GLB válido (cabeçalho ausente).' );
	if ( view.getUint32( 4, true ) !== 2 ) throw new ModelError( `Versão de GLB não suportada (${view.getUint32( 4, true )}). Apenas glTF 2.0.` );
	const length = view.getUint32( 8, true );
	if ( length > buffer.byteLength || length < 20 ) throw new ModelError( 'O arquivo GLB está incompleto ou corrompido.' );

	let offset = 12, json = null, bin = null;
	while ( offset + 8 <= length ) {

		const chunkLength = view.getUint32( offset, true );
		const chunkType = view.getUint32( offset + 4, true );
		const start = offset + 8;
		if ( start + chunkLength > length ) throw new ModelError( 'O arquivo GLB está incompleto ou corrompido.' );
		if ( chunkType === 0x4E4F534A && json === null ) json = new TextDecoder().decode( new Uint8Array( buffer, start, chunkLength ) );
		else if ( chunkType === 0x004E4942 && bin === null ) bin = chunkLength;
		offset = start + chunkLength + ( ( 4 - ( chunkLength % 4 ) ) % 4 );

	}

	if ( json === null ) throw new ModelError( 'O arquivo GLB não contém a descrição do modelo (bloco JSON).' );
	return { jsonText: json, binLength: bin };

}

// validação estrutural (antes de qualquer decodificação). files: [ File ] (principal + auxiliares)
async function inspectFiles( files, limits = LIMITS ) {

	const list = Array.from( files || [] );
	if ( list.length === 0 ) throw new ModelError( 'Nenhum arquivo selecionado.' );

	const mains = list.filter( ( file ) => [ 'glb', 'gltf' ].includes( extensionOf( file.name ) ) );
	if ( mains.length === 0 ) throw new ModelError( 'Selecione um arquivo .glb ou .gltf (os demais formatos não são suportados nesta versão).' );
	if ( mains.length > 1 ) throw new ModelError( 'Selecione apenas um modelo (.glb ou .gltf) por vez, junto com seus arquivos auxiliares.' );

	const main = mains[ 0 ];
	const aux = list.filter( ( file ) => file !== main );
	const format = extensionOf( main.name );

	if ( main.size === 0 ) throw new ModelError( 'O arquivo está vazio.' );
	if ( main.size > limits.mainBytes ) throw new ModelError( `Arquivo grande demais (${formatMB( main.size )}; limite de ${formatMB( limits.mainBytes )}).` );
	if ( aux.length > limits.auxFiles ) throw new ModelError( `Arquivos auxiliares demais (limite de ${limits.auxFiles}).` );
	const total = list.reduce( ( sum, file ) => sum + file.size, 0 );
	if ( total > limits.totalBytes ) throw new ModelError( `O conjunto de arquivos excede ${formatMB( limits.totalBytes )}.` );
	if ( format === 'glb' && aux.length > 0 && aux.some( ( file ) => [ 'bin', 'png', 'jpg', 'jpeg', 'webp' ].includes( extensionOf( file.name ) ) === false ) ) throw new ModelError( 'Arquivos auxiliares de tipo não suportado.' );

	const buffer = await main.arrayBuffer();
	let jsonText, binLength = null;

	if ( format === 'glb' ) {

		( { jsonText, binLength } = readGLB( buffer ) );

	} else {

		const head = new Uint8Array( buffer, 0, Math.min( 4, buffer.byteLength ) );
		if ( head[ 0 ] === 0x67 && head[ 1 ] === 0x6c && head[ 2 ] === 0x54 && head[ 3 ] === 0x46 ) throw new ModelError( 'O arquivo tem conteúdo GLB (binário) com extensão .gltf. Renomeie-o para .glb.' );
		jsonText = new TextDecoder().decode( buffer );

	}

	let json;
	try {

		json = JSON.parse( jsonText );

	} catch ( error ) {

		throw new ModelError( 'A descrição do modelo está corrompida (JSON inválido).' );

	}

	if ( json === null || typeof json !== 'object' || json.asset === null || typeof json.asset !== 'object' ) throw new ModelError( 'O arquivo não é um modelo glTF válido (sem bloco "asset").' );
	if ( typeof json.asset.version !== 'string' || json.asset.version.startsWith( '2.' ) === false ) throw new ModelError( `Versão de glTF não suportada (${String( json.asset.version ).slice( 0, 10 )}). Apenas glTF 2.0.` );

	for ( const key of [ 'nodes', 'meshes', 'materials', 'textures', 'images', 'buffers', 'bufferViews', 'accessors', 'animations', 'skins', 'cameras', 'scenes' ] ) {

		if ( json[ key ] !== undefined && Array.isArray( json[ key ] ) === false ) throw new ModelError( `Estrutura inválida no modelo ("${key}").` );

	}

	if ( ( json.nodes || [] ).length > limits.nodes ) throw new ModelError( `O modelo tem nós demais (${json.nodes.length}; limite de ${limits.nodes}).` );
	if ( ( json.meshes || [] ).length > limits.meshes ) throw new ModelError( `O modelo tem malhas demais (${json.meshes.length}; limite de ${limits.meshes}).` );
	if ( ( json.materials || [] ).length > limits.materials ) throw new ModelError( `O modelo tem materiais demais (${json.materials.length}; limite de ${limits.materials}).` );
	if ( ( json.images || [] ).length > limits.textures ) throw new ModelError( `O modelo tem texturas demais (${json.images.length}; limite de ${limits.textures}).` );

	const warnings = [];
	const required = Array.isArray( json.extensionsRequired ) ? json.extensionsRequired : [];
	const used = Array.isArray( json.extensionsUsed ) ? json.extensionsUsed : [];

	for ( const name of new Set( [ ...required, ...used ] ) ) {

		if ( typeof name !== 'string' ) continue;
		if ( REJECTED_EXTENSIONS[ name ] !== undefined ) throw new ModelError( `Recurso não suportado: ${name} (${REJECTED_EXTENSIONS[ name ]}).` );
		if ( SUPPORTED_EXTENSIONS.has( name ) ) continue;
		if ( IGNORED_EXTENSIONS[ name ] !== undefined ) {

			warnings.push( `${IGNORED_EXTENSIONS[ name ]} (${name}) não serão importadas.` );
			continue;

		}

		if ( required.includes( name ) ) throw new ModelError( `O modelo exige uma extensão desconhecida (${name.slice( 0, 60 )}); a importação foi recusada.` );
		warnings.push( `Extensão desconhecida ignorada: ${name.slice( 0, 60 )}.` );

	}

	// recursos referenciados
	const byPath = new Map(), byName = new Map();
	for ( const file of aux ) {

		const path = normalizePath( file.webkitRelativePath && file.webkitRelativePath.includes( '/' ) ? file.webkitRelativePath.split( '/' ).slice( 1 ).join( '/' ) : file.name );
		if ( path !== null ) byPath.set( path, file );
		const base = file.name.toLowerCase();
		byName.set( base, byName.has( base ) ? null : file ); // nome repetido: ambíguo

	}

	const resources = new Map(); // uri original -> File
	const missing = [], blocked = [], used_ = new Set();

	const check = ( uri, kind, label ) => {

		const info = classifyURI( uri, kind );
		if ( info.type === 'data' ) return;
		if ( info.type !== 'relative' ) {

			blocked.push( `${label}: ${info.reason}` );
			return;

		}

		let file = byPath.get( info.path );
		if ( file === undefined ) {

			const base = info.path.split( '/' ).pop().toLowerCase();
			file = byName.get( base );

		}

		if ( file === undefined || file === null ) missing.push( info.path );
		else {

			resources.set( uri, file );
			used_.add( file );

		}

	};

	( json.buffers || [] ).forEach( ( buffer, index ) => {

		if ( buffer === null || typeof buffer !== 'object' ) throw new ModelError( 'Estrutura inválida no modelo ("buffers").' );
		if ( buffer.uri === undefined ) {

			if ( format !== 'glb' || index !== 0 || binLength === null ) missing.push( `buffer ${index} (dados binários ausentes)` );
			return;

		}

		check( buffer.uri, 'buffer', `buffer ${index}` );

	} );

	( json.images || [] ).forEach( ( image, index ) => {

		if ( image === null || typeof image !== 'object' ) throw new ModelError( 'Estrutura inválida no modelo ("images").' );
		if ( image.uri !== undefined ) check( image.uri, 'image', `imagem ${index}` );
		else if ( image.bufferView === undefined ) missing.push( `imagem ${index} (sem dados)` );
		if ( image.mimeType !== undefined && IMAGE_TYPES[ image.mimeType ] === undefined ) throw new ModelError( `Tipo de imagem não suportado (${String( image.mimeType ).slice( 0, 30 )}). Use PNG, JPEG ou WebP.` );
		if ( image.uri !== undefined && classifyURI( image.uri, 'image' ).type === 'relative' && /\.(png|jpe?g|webp)$/i.test( image.uri.split( '?' )[ 0 ] ) === false && image.mimeType === undefined ) throw new ModelError( `Imagem de formato não suportado: ${String( image.uri ).slice( 0, 60 )}. Use PNG, JPEG ou WebP.` );

	} );

	if ( blocked.length > 0 ) throw new ModelError( 'O modelo referencia recursos não permitidos (nenhuma requisição foi feita):', blocked );
	if ( missing.length > 0 ) throw new ModelError( `Arquivos ausentes: ${[ ...new Set( missing ) ].join( ', ' )}. Selecione-os junto com o arquivo .gltf.`, [ ...new Set( missing ) ] );

	const unused = aux.filter( ( file ) => used_.has( file ) === false ).map( ( file ) => file.name );
	if ( unused.length > 0 ) warnings.push( `Arquivos não utilizados pelo modelo foram ignorados: ${unused.join( ', ' )}.` );

	if ( ( json.animations || [] ).length > 0 && ( json.skins || [] ).length === 0 ) warnings.push( `O modelo contém ${json.animations.length} animação(ões), que não serão importadas: ele ficará na pose inicial.` );
	if ( ( json.cameras || [] ).length > 0 ) warnings.push( `Câmeras do arquivo (${json.cameras.length}) não serão importadas.` );

	return {
		main,
		format,
		buffer,
		json,
		resources,
		auxFiles: aux.filter( ( file ) => used_.has( file ) ),
		size: main.size + aux.filter( ( file ) => used_.has( file ) ).reduce( ( sum, file ) => sum + file.size, 0 ),
		warnings
	};

}

// validação do conteúdo decodificado (o arquivo pode ser pequeno e gerar geometria enorme)
function analyzeObject( root, limits = LIMITS ) {

	const stats = { meshes: 0, vertices: 0, triangles: 0, materials: 0, textures: 0, geometryBytes: 0, textureBytes: 0, nodes: 0, depth: 0, maxTextureSize: 0 };
	const materials = new Set(), textures = new Set(), geometries = new Set();
	const problems = [], unsupported = [];

	( function walk( object, depth ) {

		stats.nodes ++;
		stats.depth = Math.max( stats.depth, depth );
		if ( object.isSkinnedMesh ) unsupported.push( 'malha com esqueleto (SkinnedMesh)' );
		else if ( object.isInstancedMesh ) unsupported.push( 'malha instanciada' );
		else if ( object.isPoints ) unsupported.push( 'nuvem de pontos' );
		else if ( object.isLine ) unsupported.push( 'linhas' );
		else if ( object.isSprite ) unsupported.push( 'sprites' );

		if ( object.isMesh ) {

			stats.meshes ++;
			const geometry = object.geometry;
			if ( geometry === undefined || geometry.isBufferGeometry !== true || geometry.attributes.position === undefined ) {

				problems.push( 'malha sem geometria válida' );

			} else if ( geometries.has( geometry ) === false ) {

				geometries.add( geometry );
				const count = geometry.attributes.position.count;
				stats.vertices += count;
				stats.triangles += geometry.index !== null ? geometry.index.count / 3 : count / 3;
				for ( const attribute of Object.values( geometry.attributes ) ) stats.geometryBytes += attribute.array.byteLength;
				if ( geometry.index !== null ) stats.geometryBytes += geometry.index.array.byteLength;
				if ( Object.keys( geometry.morphAttributes ).length > 0 ) unsupported.push( 'deformações por morph targets' );

			}

			for ( const material of [].concat( object.material ) ) {

				if ( material === undefined || material === null ) continue;
				if ( [ 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial' ].includes( material.type ) === false ) unsupported.push( `material ${material.type}` );
				materials.add( material );
				for ( const value of Object.values( material ) ) {

					if ( value && value.isTexture && textures.has( value ) === false ) {

						if ( value.isCompressedTexture || value.isDataTexture ) unsupported.push( 'textura comprimida' );
						textures.add( value );

					}

				}

			}

		}

		if ( depth > limits.depth ) return;
		for ( const child of object.children ) walk( child, depth + 1 );

	} )( root, 0 );

	const images = new Set();
	for ( const texture of textures ) {

		const image = texture.image;
		if ( image === undefined || image === null ) continue;
		if ( images.has( image ) ) continue;
		images.add( image );
		const width = image.naturalWidth || image.width || 0, height = image.naturalHeight || image.height || 0;
		stats.maxTextureSize = Math.max( stats.maxTextureSize, width, height );
		stats.textureBytes += width * height * 4;

	}

	stats.materials = materials.size;
	stats.textures = images.size;

	const errors = [];
	if ( stats.depth > limits.depth ) errors.push( `hierarquia profunda demais (mais de ${limits.depth} níveis)` );
	if ( stats.meshes === 0 ) errors.push( 'o modelo não contém malhas visíveis' );
	if ( stats.meshes > limits.meshes ) errors.push( `${stats.meshes} malhas (limite de ${limits.meshes})` );
	if ( stats.vertices > limits.vertices ) errors.push( `${stats.vertices.toLocaleString( 'pt-BR' )} vértices (limite de ${limits.vertices.toLocaleString( 'pt-BR' )})` );
	if ( stats.triangles > limits.triangles ) errors.push( `${Math.round( stats.triangles ).toLocaleString( 'pt-BR' )} triângulos (limite de ${limits.triangles.toLocaleString( 'pt-BR' )})` );
	if ( stats.materials > limits.materials ) errors.push( `${stats.materials} materiais (limite de ${limits.materials})` );
	if ( stats.textures > limits.textures ) errors.push( `${stats.textures} texturas (limite de ${limits.textures})` );
	if ( stats.maxTextureSize > limits.textureSize ) errors.push( `textura de ${stats.maxTextureSize} pixels (limite de ${limits.textureSize})` );
	if ( stats.geometryBytes > limits.geometryBytes ) errors.push( `geometria ocupa ${formatMB( stats.geometryBytes )} em memória (limite de ${formatMB( limits.geometryBytes )})` );

	const warnings = [];
	if ( stats.vertices > limits.warnVertices || stats.geometryBytes + stats.textureBytes > limits.warnBytes * 4 ) warnings.push( 'Este modelo possui geometria muito complexa e pode prejudicar o desempenho do projeto.' );

	return { stats, errors, problems: [ ...new Set( problems ) ], unsupported: [ ...new Set( unsupported ) ], warnings };

}

// dimensões físicas (metros) — finitas e dentro de limites razoáveis
function checkDimensions( size, limits = LIMITS ) {

	const values = [ size.x, size.y, size.z ];
	if ( values.some( ( v ) => Number.isFinite( v ) === false ) ) return 'dimensões inválidas (valores não finitos)';
	if ( Math.max( ...values ) < limits.minDimension ) return 'o modelo é pequeno demais (menor que 1 mm)';
	if ( Math.max( ...values ) > limits.maxDimension ) return `o modelo é grande demais (mais de ${limits.maxDimension} m)`;
	return null;

}

export { LIMITS as MODEL_LIMITS, IMAGE_TYPES, ModelError, getLimits, extensionOf, formatMB, normalizePath, classifyURI, inspectFiles, analyzeObject, checkDimensions };
