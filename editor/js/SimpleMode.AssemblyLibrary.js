// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Serviço da biblioteca modular (sem interface): lista (metadados e miniaturas; nenhuma geometria é carregada para
// montar a lista), salvar um conjunto da cena (registro INDEPENDENTE do projeto: alterar o conjunto depois não muda
// a definição salva), inserir (nova instância: UUIDs, IDs e vínculos próprios), duplicar na biblioteca, renomear,
// recategorizar e excluir. Excluir uma definição não afeta conjuntos já inseridos em projetos (cada projeto guarda
// a própria geometria).

import * as THREE from 'three';

import { AssemblyStorage } from './SimpleMode.AssemblyStorage.js';
import { serializeAssembly, instantiateDefinition, validateDefinition, missingDependencies, localBounds } from './SimpleMode.AssemblyFactory.js';
import { newId, getAssembly, cleanText, ASSEMBLY_LIMITS } from './SimpleMode.AssemblyData.js';
import { ExternalModelPreview } from './SimpleMode.ExternalModelPreview.js';

function AssemblyLibrary( editor, modelLibrary ) {

	const Signal = signals.Signal; // eslint-disable-line no-undef
	const changed = new Signal();
	const storage = new AssemblyStorage();
	const state = { loaded: false, loading: null, records: [], corrupted: [], error: null };

	async function load() {

		if ( state.loading !== null ) return state.loading;
		state.loading = ( async () => {

			try {

				const { records, corrupted } = await storage.list();
				state.records = records;
				state.corrupted = corrupted;
				state.error = null;

			} catch ( error ) {

				state.error = error.message || 'Não foi possível abrir a biblioteca modular.';

			} finally {

				state.loaded = true;
				state.loading = null;
				changed.dispatch();

			}

		} )();
		return state.loading;

	}

	// miniatura pelo renderizador reaproveitado da pré-visualização (EV-013): nenhuma cena extra permanece
	function thumbnail( object ) {

		const host = document.createElement( 'div' );
		host.style.cssText = 'position:fixed;left:-10000px;top:0;width:240px;height:180px;';
		document.body.appendChild( host );
		let url = null;
		const copy = object.clone( true );
		copy.position.set( 0, 0, 0 );
		copy.quaternion.identity();
		const preview = new ExternalModelPreview( host );
		try {

			preview.holder.add( copy );
			preview.frameModel();
			url = preview.thumbnail();

		} catch ( error ) {

			url = null;

		} finally {

			preview.close();
			host.remove();

		}

		return url;

	}

	async function save( group, { name, category, keywords = [] } ) {

		if ( modelLibrary !== null && modelLibrary.isLoaded() === false ) await modelLibrary.load();
		const id = newId();
		const serialized = serializeAssembly( group, { id, name, category, keywords, modelLibrary } );
		const now = Date.now();
		const record = {
			id,
			name: serialized.definition.name,
			category,
			keywords,
			dimensions: serialized.size,
			componentCount: serialized.componentCount,
			dependencies: serialized.definition.dependencies,
			thumbnail: thumbnail( group ),
			createdAt: now
		};
		const saved = await storage.put( record, serialized.definition );
		await load();
		return { record: saved, definition: serialized.definition };

	}

	async function definitionOf( record ) {

		return validateDefinition( await storage.getDefinition( record.id ) );

	}

	async function instantiate( record ) {

		const definition = await definitionOf( record );
		return instantiateDefinition( definition, { modelLibrary } );

	}

	async function missing( record ) {

		if ( modelLibrary !== null && modelLibrary.isLoaded() === false ) await modelLibrary.load();
		return missingDependencies( await definitionOf( record ), modelLibrary );

	}

	async function duplicateRecord( record ) {

		const definition = await definitionOf( record );
		const id = newId();
		const copy = Object.assign( {}, definition, { id, name: cleanText( `${record.name} (cópia)`, ASSEMBLY_LIMITS.name ) } );
		const saved = await storage.put( Object.assign( {}, record, { id, name: copy.name, createdAt: Date.now() } ), copy );
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
		await load();

	}

	// importa uma definição já validada (pacotes): sempre como registro novo ou cópia
	async function importDefinition( definition, meta, { asCopy = false } = {} ) {

		const id = asCopy || state.records.some( ( r ) => r.id === definition.id ) ? newId() : definition.id;
		const name = asCopy ? cleanText( `${definition.name} (cópia)`, ASSEMBLY_LIMITS.name ) : definition.name;
		const next = Object.assign( {}, definition, { id, name } );
		const record = {
			id,
			name,
			category: next.category,
			keywords: next.keywords || [],
			dimensions: Array.isArray( meta.dimensions ) ? meta.dimensions : [ 0, 0, 0 ],
			componentCount: Number.isInteger( meta.componentCount ) ? meta.componentCount : ( next.components || [] ).length,
			dependencies: next.dependencies,
			thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : null,
			createdAt: Number.isFinite( meta.createdAt ) ? meta.createdAt : Date.now()
		};
		const saved = await storage.put( record, next );
		await load();
		return saved;

	}

	function sizeOf( group ) {

		const box = localBounds( group );
		return box.isEmpty() ? new THREE.Vector3() : box.getSize( new THREE.Vector3() );

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
		save,
		definitionOf,
		instantiate,
		missing,
		duplicateRecord,
		update,
		remove,
		importDefinition,
		sizeOf,
		thumbnail,
		metaOf: getAssembly
	};

}

export { AssemblyLibrary };
