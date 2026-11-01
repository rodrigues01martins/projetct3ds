// EV-014 — Sistema de Componentes Modulares e Montagem Inteligente 3D
//
// Aba "Conjuntos" (biblioteca modular) do painel esquerdo: conjuntos prontos (componentes nativos) e conjuntos
// salvos. Cartões com miniatura, nome, categoria, dimensões, quantidade de componentes e datas — só metadados (a
// geometria é lida apenas ao inserir). Ações: inserir, posicionar na cena, pré-visualizar, detalhes (renomear,
// categoria, palavras-chave), duplicar na biblioteca, exportar pacote portátil, excluir; importar pacote.

import { ASSEMBLY_CATEGORIES, categoryName } from './SimpleMode.AssemblyData.js';
import { ASSEMBLY_PRESETS, buildPreset } from './SimpleMode.AssemblyPresets.js';
import { exportAssemblies, readAssemblyPackage, importModels } from './SimpleMode.AssemblyBackup.js';
import { duplicate } from './SimpleMode.AssemblyFactory.js';
import { ExternalModelPreview } from './SimpleMode.ExternalModelPreview.js';
import { formatDate } from './SimpleMode.ProjectData.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function SimpleModeAssemblyLibraryView( editor, context, library, modelLibrary, panelDom, { matches, insert } ) {

	const units = context.units;
	let busy = false;

	const importInput = el( 'input' );
	importInput.type = 'file';
	importInput.accept = '.zip,application/zip';
	importInput.dataset.role = 'assembly-import';
	importInput.hidden = true;
	importInput.addEventListener( 'change', () => {

		const file = importInput.files[ 0 ];
		importInput.value = '';
		if ( file ) importPackage( file );

	} );

	function formatDims( d ) {

		return d.map( ( v ) => units.formatInput( v ) ).join( ' × ' ) + ' ' + units.getUnit().label;

	}

	function render() {

		panelDom.textContent = '';
		panelDom.appendChild( importInput );
		const bar = el( 'div', 'SimpleModelLibraryBar' );
		bar.appendChild( createSimpleButton( { icon: 'open', label: 'Importar conjunto', title: 'Importar pacote .p3ds-assembly.zip', className: 'SimpleAssemblyImportButton', onClick: () => importInput.click() } ).dom );
		panelDom.appendChild( bar );
		panelDom.appendChild( createText( 'Salve um conjunto selecionado pelo menu Montagem → "Salvar na biblioteca modular".', 'SimpleNotice' ).dom );

		// conjuntos prontos
		const presets = ASSEMBLY_PRESETS.filter( ( p ) => matches( p.name, categoryName( p.category ), p.description ) );
		if ( presets.length > 0 ) {

			const group = el( 'div', 'SimpleCardGroup' );
			group.appendChild( el( 'div', 'SimpleCardGroupTitle', 'Conjuntos prontos' ) );
			for ( const preset of presets ) {

				const row = el( 'div', 'SimpleCardRow SimpleAssemblyCardRow' );
				row.dataset.preset = preset.id;
				const card = el( 'button', 'SimpleCard SimpleAssemblyCard' );
				card.type = 'button';
				card.title = `Inserir "${preset.name}": ${preset.description}`;
				card.appendChild( createIcon( 'templates' ) );
				const text = el( 'span', 'SimpleCardText' );
				text.append( el( 'span', 'SimpleCardName', preset.name ), el( 'span', 'SimpleCardDetail', preset.description ) );
				card.appendChild( text );
				card.addEventListener( 'click', () => insert( buildPreset( preset.id ), preset.name ) );
				row.appendChild( card );
				const actions = el( 'span', 'SimpleCardActions' );
				const place = createSimpleButton( { icon: 'place', title: `Posicionar "${preset.name}" na cena`, className: 'SimpleIconButton SimplePlaceButton', onClick: () => startPlace( buildPreset( preset.id ), preset.name ) } ).dom;
				place.dataset.place = preset.name;
				actions.appendChild( place );
				row.appendChild( actions );
				group.appendChild( row );

			}

			panelDom.appendChild( group );

		}

		if ( library.getError() !== null ) {

			panelDom.appendChild( createText( library.getError(), 'SimpleEmpty SimpleError' ).dom );
			return;

		}

		if ( library.isLoaded() === false ) {

			panelDom.appendChild( createText( 'Carregando conjuntos…', 'SimpleEmpty' ).dom );
			return;

		}

		const records = library.getRecords().filter( ( r ) => matches( r.name, categoryName( r.category ), ...( r.keywords || [] ) ) );
		if ( library.getRecords().length === 0 ) {

			panelDom.appendChild( createText( 'Nenhum conjunto salvo ainda.', 'SimpleEmpty' ).dom );
			return;

		}

		for ( const category of ASSEMBLY_CATEGORIES ) {

			const items = records.filter( ( r ) => r.category === category.id );
			if ( items.length === 0 ) continue;
			const group = el( 'div', 'SimpleCardGroup' );
			group.appendChild( el( 'div', 'SimpleCardGroupTitle', category.name ) );
			for ( const record of items ) group.appendChild( createRow( record ) );
			panelDom.appendChild( group );

		}

	}

	function createRow( record ) {

		const row = el( 'div', 'SimpleCardRow SimpleAssemblyCardRow' );
		row.dataset.assembly = record.id;
		const card = el( 'button', 'SimpleCard SimpleAssemblyCard' );
		card.type = 'button';
		card.title = `Inserir "${record.name}" (${categoryName( record.category )}, ${formatDims( record.dimensions )}, ${record.componentCount} componente(s))`;
		if ( record.thumbnail !== null ) {

			const img = el( 'img', 'SimpleModelThumb' );
			img.alt = '';
			img.src = record.thumbnail;
			card.appendChild( img );

		} else {

			card.appendChild( createIcon( 'templates' ) );

		}

		const text = el( 'span', 'SimpleCardText' );
		text.append(
			el( 'span', 'SimpleCardName', record.name ),
			el( 'span', 'SimpleCardDetail', `${formatDims( record.dimensions )} · ${record.componentCount} comp.` ),
			el( 'span', 'SimpleCardDetail', `Criado ${formatDate( record.createdAt )} · alterado ${formatDate( record.updatedAt )}` )
		);
		card.appendChild( text );
		card.addEventListener( 'click', () => insertRecord( record ) );
		row.appendChild( card );

		const actions = el( 'span', 'SimpleCardActions' );
		const place = createSimpleButton( { icon: 'place', title: `Posicionar "${record.name}" na cena`, className: 'SimpleIconButton SimplePlaceButton', onClick: () => placeRecord( record ) } ).dom;
		place.dataset.place = record.name;
		actions.append( place, createSimpleButton( { icon: 'edit', title: `Detalhes de "${record.name}"`, className: 'SimpleIconButton SimpleAssemblyDetails', onClick: () => details( record ) } ).dom );
		row.appendChild( actions );
		return row;

	}

	async function instantiate( record ) {

		try {

			return await library.instantiate( record );

		} catch ( error ) {

			const choice = await context.dialog.ask( { title: 'Não foi possível inserir o conjunto', message: error.message, details: error.details || [], choices: [ { id: 'import', label: 'Importar dependência (.p3ds-assembly.zip)' }, { id: 'ok', label: 'OK', kind: 'primary' } ] } );
			if ( choice === 'import' ) importInput.click();
			return null;

		}

	}

	async function insertRecord( record ) {

		const instance = await instantiate( record );
		if ( instance !== null ) insert( instance, record.name );

	}

	async function placeRecord( record ) {

		const instance = await instantiate( record );
		if ( instance !== null ) startPlace( instance, record.name );

	}

	function startPlace( instance, name ) {

		let first = instance;
		context.startTool( 'place', { name, create: () => {

			const next = first !== null ? first : duplicate( instance );
			first = null;
			return next;

		} } );

	}

	async function preview( record ) {

		const instance = await instantiate( record );
		if ( instance === null ) return;
		const host = el( 'div', 'SimpleAssemblyPreviewHost' );
		const p = new ExternalModelPreview( host );
		const box = el( 'div' );
		box.append( host );
		const closeChoice = context.dialog.ask( { title: `Pré-visualizar "${record.name}"`, message: `${formatDims( record.dimensions )} · ${record.componentCount} componente(s) · ${categoryName( record.category )}`, choices: [ { id: 'ok', label: 'Fechar', kind: 'primary' } ] } );
		const dialogBody = document.querySelector( '.SimpleDialog .SimpleDialogMessage, .SimpleDialog p' );
		if ( dialogBody !== null ) dialogBody.after( box );
		p.holder.add( instance );
		p.frameModel();
		await closeChoice;
		p.close();

	}

	async function details( record ) {

		const choice = await context.dialog.ask( {
			title: record.name,
			message: `${categoryName( record.category )} · ${formatDims( record.dimensions )} · ${record.componentCount} componente(s)${record.dependencies.length > 0 ? ` · depende de ${record.dependencies.length} modelo(s) importado(s)` : ''}`,
			choices: [ { id: 'preview', label: 'Pré-visualizar' }, { id: 'rename', label: 'Renomear / categoria' }, { id: 'duplicate', label: 'Duplicar na biblioteca' }, { id: 'export', label: 'Exportar pacote' }, { id: 'delete', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Fechar' } ]
		} );

		try {

			if ( choice === 'preview' ) await preview( record );
			if ( choice === 'rename' ) {

				const name = await context.dialog.ask( { title: 'Renomear conjunto', message: 'Novo nome:', input: { label: 'Nome', value: record.name, maxLength: 80 }, choices: [ { id: 'ok', label: 'Salvar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( name && name.choice === 'ok' ) {

					const category = await context.dialog.ask( { title: 'Categoria', message: 'Escolha a categoria do conjunto.', choices: ASSEMBLY_CATEGORIES.map( ( c ) => ( { id: c.id, label: c.name, kind: c.id === record.category ? 'primary' : 'default' } ) ) } );
					await library.update( record.id, { name: name.value, category: ASSEMBLY_CATEGORIES.some( ( c ) => c.id === category ) ? category : record.category } );
					context.notify( 'Conjunto atualizado na biblioteca (instâncias já inseridas não mudam).', 'success' );

				}

			}

			if ( choice === 'duplicate' ) {

				const copy = await library.duplicateRecord( record );
				context.notify( `"${copy.name}" criado na biblioteca.`, 'success' );

			}

			if ( choice === 'export' ) await exportPackage( [ record ] );
			if ( choice === 'delete' ) {

				const confirm = await context.dialog.ask( { title: 'Excluir conjunto da biblioteca', message: `Excluir "${record.name}" da biblioteca modular? Conjuntos já inseridos em projetos continuam funcionando.`, choices: [ { id: 'delete', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
				if ( confirm === 'delete' ) {

					await library.remove( record.id );
					context.notify( `"${record.name}" excluído da biblioteca modular.`, 'success' );

				}

			}

		} catch ( error ) {

			context.notify( error.message || 'Operação não concluída.', 'error' );

		}

	}

	async function exportPackage( records ) {

		if ( busy ) return;
		busy = true;
		try {

			const { blob, name, manifest } = await exportAssemblies( library, modelLibrary, records );
			editor.utils.save( blob, name );
			context.notify( `Pacote exportado: ${manifest.assemblies.length} conjunto(s), ${manifest.models.length} modelo(s) externo(s).`, 'success' );

		} catch ( error ) {

			context.notify( error.message + ( error.details && error.details.length ? ` (${error.details.join( ', ' )})` : '' ), 'error' );

		} finally {

			busy = false;

		}

	}

	async function importPackage( file ) {

		if ( busy ) return;
		busy = true;
		try {

			if ( library.isLoaded() === false ) await library.load();
			const { models, assemblies } = await readAssemblyPackage( file, editor.config );
			const modelsResult = await importModels( modelLibrary, models );
			let imported = 0, kept = 0;
			for ( const item of assemblies ) {

				const existing = library.getRecord( item.id ) || library.getRecords().find( ( r ) => r.name === item.definition.name && JSON.stringify( r.dimensions ) === JSON.stringify( item.meta.dimensions ) );
				let mode = 'new';
				if ( existing ) {

					mode = await context.dialog.ask( { title: 'Conjunto já existe', message: `"${item.definition.name}" já está na biblioteca modular.`, choices: [ { id: 'keep', label: 'Manter existente', kind: 'primary' }, { id: 'copy', label: 'Importar como cópia' }, { id: 'cancel', label: 'Cancelar' } ] } );
					if ( mode === 'cancel' || mode === undefined ) break;
					if ( mode === 'keep' ) {

						kept ++;
						continue;

					}

				}

				await library.importDefinition( item.definition, item.meta, { asCopy: mode === 'copy' } );
				imported ++;

			}

			await context.dialog.ask( { title: 'Importação de conjuntos', message: `${imported} conjunto(s) importado(s), ${kept} mantido(s). Modelos externos: ${modelsResult.added} adicionado(s), ${modelsResult.reused} já existente(s).`, choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ] } );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível importar o pacote.', 'error' );

		} finally {

			busy = false;

		}

	}

	library.changed.add( render );
	units.changed.add( render );

	return { render, importPackage, exportPackage };

}

export { SimpleModeAssemblyLibraryView };
