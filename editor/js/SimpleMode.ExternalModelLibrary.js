// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Serviço da biblioteca de modelos importados (sem interface): lista (metadados e miniaturas primeiro), salvar com
// detecção de duplicados por hash, carregar a geometria só quando necessário (cache pequeno de modelos decodificados),
// criar instâncias independentes, exportar o arquivo original e excluir. Excluir um modelo da biblioteca NÃO afeta
// projetos: cada instância inserida é autossuficiente no JSON do projeto (geometria, materiais e imagens incorporados).

import { strToU8, zipSync } from '../../examples/jsm/libs/fflate.module.js';

import { ExternalModelStorage, categoryName } from './SimpleMode.ExternalModelStorage.js';
import { loadExternalModel, disposeObject } from './SimpleMode.ExternalModelLoader.js';
import { createInstance } from './SimpleMode.ExternalModelInstances.js';
import { sanitizeSettings } from './SimpleMode.ExternalModelTransforms.js';
import { digest } from './SimpleMode.ProjectData.js';

const CACHE_SIZE = 3;

async function hashFiles( files ) {

	// conteúdo do arquivo principal + nome e conteúdo de cada auxiliar (ordem estável)
	const parts = [];
	for ( const file of files ) {

		const bytes = new Uint8Array( await file.arrayBuffer() );
		const subtle = globalThis.crypto && globalThis.crypto.subtle;
		if ( subtle !== undefined ) {

			const buffer = await subtle.digest( 'SHA-256', bytes );
			parts.push( file.name.toLowerCase() + ':' + Array.from( new Uint8Array( buffer ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' ) );

		} else {

			let text = '';
			for ( let i = 0; i < bytes.length; i += 4096 ) text += String.fromCharCode.apply( null, bytes.subarray( i, i + 4096 ) );
			parts.push( file.name.toLowerCase() + ':' + await digest( text ) );

		}

	}

	return digest( parts.join( '\n' ) );

}

function ExternalModelLibrary( editor ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef
	const changed = new Signal();
	const storage = new ExternalModelStorage();
	const state = { loaded: false, loading: null, records: [], corrupted: [], error: null };
	const cache = new Map(); // id -> { object, promise }

	async function load() {

		if ( state.loading !== null ) return state.loading;
		state.loading = ( async () => {

			try {

				const { records, corrupted } = await storage.list();
				state.records = records;
				state.corrupted = corrupted;
				state.error = null;

			} catch ( error ) {

				state.error = error.message || 'Não foi possível abrir a biblioteca de modelos.';

			} finally {

				state.loaded = true;
				state.loading = null;
				changed.dispatch();

			}

		} )();
		return state.loading;

	}

	function remember( id, object ) {

		cache.delete( id );
		cache.set( id, { object } );
		while ( cache.size > CACHE_SIZE ) {

			// o modelo decodificado sai do cache; suas geometrias podem estar em uso na cena e NÃO são descartadas
			const oldest = cache.keys().next().value;
			cache.delete( oldest );

		}

	}

	// modelo decodificado de um registro (carregado do armazenamento somente quando necessário)
	async function loadTemplate( record ) {

		const cached = cache.get( record.id );
		if ( cached !== undefined && cached.object ) {

			remember( record.id, cached.object );
			return cached.object;

		}

		const files = await storage.getFiles( record.id );
		const loaded = await loadExternalModel( files, { config: editor.config } );
		remember( record.id, loaded.object );
		return loaded.object;

	}

	async function instantiate( record, settings = record.defaults ) {

		const template = await loadTemplate( record );
		return createInstance( template, assetOf( record ), sanitizeSettings( settings ) );

	}

	function assetOf( record ) {

		return { id: record.id, name: record.name, category: record.category, format: record.format, originalName: record.originalName, hash: record.hash };

	}

	// salva um modelo recém-carregado. Devolve o registro gravado (após a transação concluída)
	async function save( loaded, { id, name, category, keywords, license, settings, thumbnail, hash } ) {

		const record = {
			id,
			name,
			category,
			keywords,
			format: loaded.info.format,
			originalName: loaded.info.fileName,
			mainFile: loaded.info.fileName,
			auxNames: loaded.info.auxNames,
			hash,
			size: loaded.info.size,
			dimensions: [ loaded.size.x, loaded.size.y, loaded.size.z ],
			defaults: sanitizeSettings( settings ),
			stats: { meshes: loaded.stats.meshes, vertices: loaded.stats.vertices, triangles: Math.round( loaded.stats.triangles ), materials: loaded.stats.materials, textures: loaded.stats.textures },
			license,
			thumbnail,
			importedAt: Date.now()
		};

		const saved = await storage.put( record, loaded.files );
		remember( id, loaded.object );
		await load();
		return saved;

	}

	async function update( id, patch ) {

		const saved = await storage.update( id, patch );
		await load();
		return saved;

	}

	async function remove( id ) {

		await storage.remove( id );
		cache.delete( id ); // instâncias na cena continuam válidas (recursos próprios no projeto)
		await load();

	}

	async function exportOriginal( record ) {

		const files = await storage.getFiles( record.id );
		if ( files.length === 1 ) {

			editor.utils.save( files[ 0 ], files[ 0 ].name );
			return files[ 0 ].name;

		}

		const entries = {};
		for ( const file of files ) entries[ file.name ] = new Uint8Array( await file.arrayBuffer() );
		entries[ 'LEIA-ME.txt' ] = strToU8( `Modelo "${record.name}" exportado da biblioteca do Project3DS.\nArquivo principal: ${record.mainFile}\nCategoria: ${categoryName( record.category )}\n` );
		const name = record.mainFile.replace( /\.gltf$/i, '' ) + '.zip';
		editor.utils.save( new Blob( [ zipSync( entries, { level: 6 } ) ], { type: 'application/zip' } ), name );
		return name;

	}

	function forget( object ) {

		// descarta um modelo temporário que não foi salvo nem inserido
		for ( const [ id, entry ] of cache ) if ( entry.object === object ) return id; // em uso pelo cache: preservado
		disposeObject( object );
		return null;

	}

	return {
		changed,
		storage,
		load,
		isLoaded: () => state.loaded,
		getError: () => state.error,
		getRecords: () => state.records.slice(),
		getCorrupted: () => state.corrupted.slice(),
		getRecord: ( id ) => state.records.find( ( r ) => r.id === id ) || null,
		loadTemplate,
		instantiate,
		assetOf,
		save,
		update,
		remove,
		exportOriginal,
		remember,
		forget,
		isCached: ( object ) => [ ...cache.values() ].some( ( entry ) => entry.object === object ),
		hashFiles
	};

}

export { ExternalModelLibrary, hashFiles };
