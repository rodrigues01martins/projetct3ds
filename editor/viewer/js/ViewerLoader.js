// EV-012 — Visualizador Project3DS: leitura do pacote recebido (entrada NÃO confiável).
//
// Ordem: limites de tamanho -> ZIP com filtro de nomes e tamanhos -> manifesto -> hashes -> sanitização por lista
// explícita (SimpleMode.ShareData.js, a mesma do editor) -> só então o ObjectLoader do Three.js monta os objetos.
// Não usa Editor.fromJSON, não instancia o Editor, não executa scripts (o formato nem os transporta) e não carrega
// recursos externos: além da sanitização (só imagens data:image/png|jpeg|webp), o gerenciador de carregamento troca
// qualquer endereço que não seja data:image por um recurso vazio, e a política de segurança da página bloqueia
// requisições a outros endereços.

import * as THREE from 'three';

import { readPackage, describeReport, SHARE_LIMITS, ShareError } from '../../js/SimpleMode.ShareData.js';
import { sanitizeView } from '../../js/SimpleMode.SavedViews.js';

const SAFE_URL = /^data:image\/(png|jpeg|webp);base64,/;
const ALLOWED = ( object ) => object.isScene || object.isMesh || object.isGroup || object.isLight || object.type === 'Object3D' || object.isCamera;

async function loadPackageFile( file ) {

	if ( file === null || file === undefined ) throw new ShareError( 'Nenhum arquivo selecionado.' );
	if ( file.size > SHARE_LIMITS.zipBytes ) throw new ShareError( 'Arquivo grande demais para o visualizador (limite de 150 MB).' );
	if ( file.size === 0 ) throw new ShareError( 'O arquivo está vazio.' );

	const bytes = new Uint8Array( await file.arrayBuffer() );
	const pkg = await readPackage( bytes, { sanitizeView } );

	const manager = new THREE.LoadingManager();
	manager.setURLModifier( ( url ) => SAFE_URL.test( url ) ? url : 'data:image/png;base64,' ); // defesa adicional
	const loader = new THREE.ObjectLoader( manager );

	let root;
	try {

		root = await loader.parseAsync( pkg.scene );

	} catch ( error ) {

		console.error( error );
		throw new ShareError( 'Não foi possível montar a cena compartilhada.' );

	}

	if ( root === null || root.isScene !== true ) throw new ShareError( 'A raiz do arquivo compartilhado não é uma cena.' );

	// conferência final dos tipos efetivamente criados (nenhum objeto fora da lista permanece)
	const remove = [];
	root.traverse( ( object ) => {

		if ( ALLOWED( object ) === false ) remove.push( object );
		if ( object.isMesh && object.isSkinnedMesh ) remove.push( object );

	} );
	for ( const object of remove ) object.removeFromParent();

	const previewURL = pkg.preview !== null ? URL.createObjectURL( new Blob( [ pkg.preview ], { type: 'image/jpeg' } ) ) : null;

	return {
		manifest: pkg.manifest,
		views: pkg.views,
		stats: pkg.stats,
		report: pkg.report,
		removed: describeReport( pkg.report ),
		previewURL,
		root
	};

}

export { loadPackageFile };
