// EV-013 — Sistema de Importação e Biblioteca de Modelos 3D Externos
//
// Aba "Modelos" (modelos importados) do painel esquerdo, ao lado de Básicos, Biblioteca e Meus componentes.
// Lista só metadados e miniaturas (a geometria é lida do armazenamento somente ao usar um modelo). Ações: importar,
// inserir (clique no cartão), posicionar na cena, detalhes (renomear, categoria, licença, exportar original, excluir),
// selecionar para backup, exportar/importar backup da biblioteca. Pesquisa por nome, categoria, formato e palavras-chave.

import { MODEL_CATEGORIES, categoryName } from './SimpleMode.ExternalModelStorage.js';
import { exportLibrary, readLibraryBackup, importLibraryItem } from './SimpleMode.ExternalModelBackup.js';
import { formatBytes } from './SimpleMode.ProjectData.js';
import { createIcon, createSimpleButton, createText } from './SimpleMode.Icons.js';

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function SimpleModeExternalModelLibraryView( editor, context, library, panelDom, { matches, insert, place, openRecord } ) {

	const units = context.units;
	const selected = new Set();
	let busy = false;

	const fileInput = el( 'input' );
	fileInput.type = 'file';
	fileInput.multiple = true;
	fileInput.accept = '.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp';
	fileInput.dataset.role = 'model-import';
	fileInput.hidden = true;
	fileInput.addEventListener( 'change', () => {

		const files = Array.from( fileInput.files );
		fileInput.value = '';
		if ( files.length > 0 ) context.openExternalModelFiles( files );

	} );

	const backupInput = el( 'input' );
	backupInput.type = 'file';
	backupInput.accept = '.zip,application/zip';
	backupInput.dataset.role = 'model-backup-import';
	backupInput.hidden = true;
	backupInput.addEventListener( 'change', () => {

		const file = backupInput.files[ 0 ];
		backupInput.value = '';
		if ( file ) importBackup( file );

	} );

	function render() {

		panelDom.textContent = '';
		panelDom.append( fileInput, backupInput );

		const toolbar = el( 'div', 'SimpleModelLibraryBar' );
		toolbar.append(
			createSimpleButton( { icon: 'add', label: 'Importar modelo 3D', title: 'Importar modelo 3D (.glb ou .gltf com seus arquivos)', className: 'SimpleModelImportButton', onClick: () => fileInput.click() } ).dom,
			createSimpleButton( { icon: 'save', label: 'Exportar', title: 'Exportar backup dos modelos (selecionados ou todos)', className: 'SimpleModelBackupExport', onClick: () => exportBackup() } ).dom,
			createSimpleButton( { icon: 'open', label: 'Importar', title: 'Importar backup de modelos (.zip)', className: 'SimpleModelBackupImport', onClick: () => backupInput.click() } ).dom
		);
		toolbar.insertBefore( el( 'span', 'SimpleModelBackupLabel', 'Backup:' ), toolbar.querySelector( '.SimpleModelBackupExport' ) );
		panelDom.appendChild( toolbar );
		panelDom.appendChild( createText( 'Modelos GLB/GLTF guardados neste navegador. O backup da biblioteca é separado do backup de projetos (que já inclui os modelos inseridos em cada projeto).', 'SimpleNotice' ).dom );

		if ( library.getError() !== null ) {

			panelDom.appendChild( createText( library.getError(), 'SimpleEmpty SimpleError' ).dom );
			return;

		}

		if ( library.isLoaded() === false ) {

			panelDom.appendChild( createText( 'Carregando modelos…', 'SimpleEmpty' ).dom );
			return;

		}

		const corrupted = library.getCorrupted();
		if ( corrupted.length > 0 ) panelDom.appendChild( createText( `${corrupted.length} registro(s) danificado(s) foram ignorados (não removidos).`, 'SimpleEmpty SimpleError' ).dom );

		const records = library.getRecords();
		if ( records.length === 0 ) {

			panelDom.appendChild( createText( 'Nenhum modelo importado ainda. Use "Importar modelo 3D" para trazer móveis, equipamentos e objetos em GLB ou GLTF.', 'SimpleEmpty' ).dom );
			return;

		}

		const filtered = records.filter( ( record ) => matches( record.name, categoryName( record.category ), record.format, ...( record.keywords || [] ) ) );
		if ( filtered.length === 0 ) {

			panelDom.appendChild( createText( 'Nenhum modelo corresponde à pesquisa.', 'SimpleEmpty' ).dom );
			return;

		}

		for ( const category of MODEL_CATEGORIES ) {

			const items = filtered.filter( ( record ) => record.category === category.id );
			if ( items.length === 0 ) continue;
			const group = el( 'div', 'SimpleCardGroup' );
			group.setAttribute( 'role', 'group' );
			group.setAttribute( 'aria-label', category.name );
			group.appendChild( el( 'div', 'SimpleCardGroupTitle', category.name ) );
			for ( const record of items ) group.appendChild( createRow( record ) );
			panelDom.appendChild( group );

		}

	}

	function formatDims( record ) {

		const [ w, h, d ] = record.dimensions;
		const s = record.defaults && Array.isArray( record.defaults.scale ) ? record.defaults.scale : [ 1, 1, 1 ];
		const swap = record.defaults && ( record.defaults.rotationY === 90 || record.defaults.rotationY === 270 );
		const dims = swap ? [ d, h, w ] : [ w, h, d ];
		return dims.map( ( v, i ) => units.formatInput( v * s[ i ] ) ).join( ' × ' ) + ' ' + units.getUnit().label;

	}

	function createRow( record ) {

		const row = el( 'div', 'SimpleCardRow SimpleModelCardRow' );
		row.dataset.model = record.id;

		const check = el( 'input', 'SimpleModelSelect' );
		check.type = 'checkbox';
		check.checked = selected.has( record.id );
		check.setAttribute( 'aria-label', `Selecionar "${record.name}" para backup` );
		check.addEventListener( 'change', () => {

			if ( check.checked ) selected.add( record.id );
			else selected.delete( record.id );

		} );
		row.appendChild( check );

		const card = el( 'button', 'SimpleCard SimpleModelCard' );
		card.type = 'button';
		const title = `Inserir "${record.name}" (${categoryName( record.category )}, ${formatDims( record )}, ${record.format.toUpperCase()}, ${formatBytes( record.size )})`;
		card.title = title;
		card.setAttribute( 'aria-label', title );
		if ( record.thumbnail !== null ) {

			const img = el( 'img', 'SimpleModelThumb' );
			img.alt = '';
			img.src = record.thumbnail;
			card.appendChild( img );

		} else {

			card.appendChild( createIcon( 'views' ) );

		}

		const text = el( 'span', 'SimpleCardText' );
		text.append( el( 'span', 'SimpleCardName', record.name ), el( 'span', 'SimpleCardDetail', formatDims( record ) ), el( 'span', 'SimpleCardDetail', `${record.format.toUpperCase()} · ${formatBytes( record.size )}` ) );
		card.appendChild( text );
		card.addEventListener( 'click', () => insert( record ) );
		row.appendChild( card );

		const actions = el( 'span', 'SimpleCardActions' );
		const placeButton = createSimpleButton( { icon: 'place', title: `Posicionar "${record.name}" na cena`, className: 'SimpleIconButton SimplePlaceButton', onClick: () => place( record ) } ).dom;
		placeButton.dataset.place = record.name;
		actions.append(
			placeButton,
			createSimpleButton( { icon: 'edit', title: `Detalhes de "${record.name}" (renomear, categoria, licença, exportar, excluir)`, className: 'SimpleIconButton SimpleModelDetails', onClick: () => openRecord( record ) } ).dom
		);
		row.appendChild( actions );
		return row;

	}

	async function exportBackup() {

		if ( busy ) return;
		const records = library.getRecords();
		if ( records.length === 0 ) return context.notify( 'Nenhum modelo para exportar.', 'warning' );
		const chosen = records.filter( ( r ) => selected.has( r.id ) );
		const choice = await context.dialog.ask( {
			title: 'Exportar modelos importados',
			message: 'Gera um .zip com os arquivos originais, metadados e hashes. É separado do backup de projetos.',
			choices: [ ...( chosen.length > 0 ? [ { id: 'selected', label: `Selecionados (${chosen.length})`, kind: 'primary' } ] : [] ), { id: 'all', label: `Biblioteca inteira (${records.length})`, kind: chosen.length > 0 ? 'default' : 'primary' }, { id: 'cancel', label: 'Cancelar' } ]
		} );
		if ( choice !== 'selected' && choice !== 'all' ) return;
		busy = true;
		try {

			const { blob, manifest } = await exportLibrary( library, choice === 'selected' ? chosen : records );
			const stamp = new Date().toISOString().slice( 0, 10 );
			editor.utils.save( blob, `modelos-project3ds-${stamp}.zip` );
			context.notify( `Backup com ${manifest.models.length} modelo(s) exportado.`, 'success' );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível exportar o backup.', 'error' );

		} finally {

			busy = false;

		}

	}

	async function importBackup( file ) {

		if ( busy ) return;
		busy = true;
		try {

			if ( library.isLoaded() === false ) await library.load();
			const { models } = await readLibraryBackup( file, library, editor.config );
			const valid = models.filter( ( m ) => m.valid );
			const duplicates = valid.filter( ( m ) => m.duplicate !== null );
			const invalid = models.filter( ( m ) => m.valid === false );
			let mode = 'skip';
			if ( duplicates.length > 0 ) {

				mode = await context.dialog.ask( {
					title: 'Modelos já existentes',
					message: `${duplicates.length} modelo(s) do backup já existem na biblioteca (mesmo identificador ou mesmo arquivo): ${duplicates.slice( 0, 5 ).map( ( m ) => `"${m.name}"` ).join( ', ' )}${duplicates.length > 5 ? '…' : ''}.`,
					choices: [ { id: 'skip', label: 'Manter os existentes', kind: 'primary' }, { id: 'copy', label: 'Importar como cópias' }, { id: 'replace', label: 'Substituir existentes', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ]
				} );
				if ( mode === 'cancel' || mode === undefined ) return;
				if ( mode === 'replace' ) {

					const confirm = await context.dialog.ask( { title: 'Substituir modelos', message: `Substituir ${duplicates.length} modelo(s) da biblioteca pelos do backup? Projetos que já usam esses modelos não são afetados.`, choices: [ { id: 'yes', label: 'Substituir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
					if ( confirm !== 'yes' ) return;

				}

			}

			let imported = 0, skipped = 0;
			const failed = invalid.map( ( m ) => `${m.name}: ${m.problems.join( ' ' )}` );
			for ( const item of valid ) {

				if ( item.duplicate !== null && mode === 'skip' ) {

					skipped ++;
					continue;

				}

				try {

					await importLibraryItem( library, item, item.duplicate !== null ? mode : 'new' );
					imported ++;

				} catch ( error ) {

					failed.push( `${item.name}: ${error.message}` );

				}

			}

			await library.load();
			await context.dialog.ask( {
				title: 'Importação do backup de modelos',
				message: `${imported} importado(s), ${skipped} mantido(s) sem alteração, ${failed.length} com problema.`,
				details: failed.slice( 0, 10 ),
				choices: [ { id: 'ok', label: 'OK', kind: 'primary' } ]
			} );

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível importar o backup.', 'error' );

		} finally {

			busy = false;

		}

	}

	library.changed.add( render );
	units.changed.add( render );

	return { render, chooseFiles: () => fileInput.click() };

}

export { SimpleModeExternalModelLibraryView };
