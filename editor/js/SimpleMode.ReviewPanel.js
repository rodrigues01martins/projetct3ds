// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// Painel "Revisões do projeto" (editor do proprietário): contadores por situação, pesquisa, filtros (situação e
// componente), lista de comentários, detalhes com respostas, alteração de situação, localização no modelo, exclusão
// com confirmação e importação de arquivos de revisão (com prévia e confirmação). Todo texto vindo de revisores é
// exibido com textContent (nunca interpretado como HTML). As alterações passam pelo ReviewManager (Desfazer/Refazer).

import { STATUSES, STATUS_LABELS } from './SimpleMode.ReviewData.js';
import { formatDate } from './SimpleMode.ProjectData.js';
import { SimpleModeReviewMarkers } from './SimpleMode.ReviewMarkers.js';
import { createSimpleButton } from './SimpleMode.Icons.js';

const ANCHOR_LABELS = { project: 'Projeto inteiro', found: 'Localizado', missing: 'Não localizado', stale: 'Possivelmente desatualizado' };

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function button( label, onClick, { icon, className = '', title } = {} ) {

	return createSimpleButton( { icon, label, title: title || label, className, onClick } ).dom;

}

function SimpleModeReviewPanel( editor, context, reviews, root ) {

	const dialog = context.dialog;
	const state = { open: false, view: 'list', selected: null, search: '', status: 'all', component: 'all', analysis: null, busy: false };

	const panel = el( 'aside', 'SimpleReviewsPanel' );
	panel.id = 'simple-reviews';
	panel.hidden = true;
	panel.setAttribute( 'aria-label', 'Revisões do projeto' );
	root.appendChild( panel );

	const fileInput = el( 'input' );
	fileInput.type = 'file';
	fileInput.accept = '.json,application/json';
	fileInput.dataset.role = 'review-import';
	fileInput.hidden = true;
	root.appendChild( fileInput );

	const markers = new SimpleModeReviewMarkers( editor, reviews, { onSelect: ( id ) => {

		if ( state.open === false ) show();
		select( id, { locate: true } );

	} } );

	function number( comment ) {

		return reviews.comments().findIndex( ( c ) => c.id === comment.id ) + 1;

	}

	function anchorText( comment ) {

		if ( comment.anchor.kind === 'project' ) return 'Projeto inteiro';
		const object = reviews.findObject( comment.anchor.objectUuid );
		const name = object !== undefined ? ( object.name || comment.anchor.objectName ) : comment.anchor.objectName;
		return [ comment.anchor.objectLabel, name ].filter( Boolean ).join( ' — ' ) || 'Componente';

	}

	function filtered() {

		const search = state.search.toLocaleLowerCase( 'pt-BR' );
		return reviews.comments().filter( ( comment ) => {

			if ( state.status !== 'all' && comment.status !== state.status ) return false;
			if ( state.component === 'project' && comment.anchor.kind !== 'project' ) return false;
			if ( state.component === 'missing' && reviews.anchorState( comment ) !== 'missing' ) return false;
			if ( state.component !== 'all' && state.component !== 'project' && state.component !== 'missing' && comment.anchor.objectUuid !== state.component ) return false;
			if ( search !== '' ) {

				const haystack = [ comment.text, comment.author, anchorText( comment ), ...comment.replies.map( ( r ) => r.text ) ].join( ' ' ).toLocaleLowerCase( 'pt-BR' );
				if ( haystack.includes( search ) === false ) return false;

			}

			return true;

		} );

	}

	// lista ------------------------------------------------------------------------------------------------------------------

	function renderHeader() {

		const head = el( 'div', 'SimpleReviewsHeader' );
		head.appendChild( el( 'h2', 'SimpleReviewsTitle', 'Revisões do projeto' ) );
		head.appendChild( button( 'Fechar', () => hide(), { icon: 'close', className: 'SimpleReviewsClose' } ) );
		return head;

	}

	function renderList() {

		panel.textContent = '';
		panel.appendChild( renderHeader() );

		const toolbar = el( 'div', 'SimpleReviewsToolbar' );
		toolbar.append(
			button( 'Importar revisão', () => fileInput.click(), { icon: 'open', className: 'SimpleReviewsImport', title: 'Importar arquivo .p3ds-feedback.json' } ),
			button( 'Compartilhar', () => context.openShare(), { icon: 'share', title: 'Compartilhar projeto' } )
		);
		const markerRow = el( 'label', 'SimpleCheckboxRow' );
		const markerBox = el( 'input' );
		markerBox.type = 'checkbox';
		markerBox.dataset.role = 'review-markers';
		markerBox.checked = markers.isVisible();
		markerBox.addEventListener( 'change', () => markers.setVisible( markerBox.checked ) );
		markerRow.append( markerBox, el( 'span', '', 'Marcadores no modelo' ) );
		toolbar.appendChild( markerRow );
		panel.appendChild( toolbar );

		panel.appendChild( el( 'p', 'SimpleReviewsHint', 'Os comentários chegam por arquivo de revisão: não há envio nem recebimento automático pela internet.' ) );

		const counts = reviews.counts();
		const countBar = el( 'div', 'SimpleReviewsCounts' );
		for ( const key of [ 'all', ...STATUSES ] ) {

			const chip = el( 'button', 'SimpleReviewsCount' + ( state.status === key ? ' active' : '' ) );
			chip.type = 'button';
			chip.dataset.status = key;
			chip.append( el( 'strong', '', String( key === 'all' ? counts.total : counts[ key ] ) ), el( 'span', '', key === 'all' ? 'Total' : STATUS_LABELS[ key ] ) );
			chip.addEventListener( 'click', () => {

				state.status = state.status === key ? 'all' : key;
				render();

			} );
			countBar.appendChild( chip );

		}

		panel.appendChild( countBar );

		const filters = el( 'div', 'SimpleReviewsFilters' );
		const search = el( 'input', 'SimpleInput SimpleReviewsSearch' );
		search.type = 'search';
		search.placeholder = 'Pesquisar nos comentários';
		search.value = state.search;
		search.addEventListener( 'input', () => {

			state.search = search.value;
			renderItems();

		} );
		const component = el( 'select', 'SimpleSelect SimpleReviewsComponent' );
		const options = [[ 'all', 'Todos os componentes' ], [ 'project', 'Projeto inteiro' ], [ 'missing', 'Não localizados' ]];
		const seen = new Set();
		for ( const comment of reviews.comments() ) {

			if ( comment.anchor.kind === 'project' || seen.has( comment.anchor.objectUuid ) || reviews.anchorState( comment ) !== 'found' ) continue;
			seen.add( comment.anchor.objectUuid );
			options.push( [ comment.anchor.objectUuid, anchorText( comment ) ] );

		}

		for ( const [ value, label ] of options ) {

			const option = el( 'option', '', label );
			option.value = value;
			component.appendChild( option );

		}

		component.value = options.some( ( [ value ] ) => value === state.component ) ? state.component : 'all';
		component.addEventListener( 'change', () => {

			state.component = component.value;
			renderItems();

		} );
		filters.append( search, component );
		panel.appendChild( filters );

		const list = el( 'div', 'SimpleReviewsList' );
		list.setAttribute( 'role', 'list' );
		panel.appendChild( list );
		renderItems();

	}

	function renderItems() {

		const list = panel.querySelector( '.SimpleReviewsList' );
		if ( list === null ) return;
		list.textContent = '';
		const items = filtered();

		if ( reviews.comments().length === 0 ) {

			list.appendChild( el( 'p', 'SimpleReviewsEmpty', 'Nenhum comentário ainda. Compartilhe o projeto e importe aqui o arquivo de revisão devolvido.' ) );
			return;

		}

		if ( items.length === 0 ) list.appendChild( el( 'p', 'SimpleReviewsEmpty', 'Nenhum comentário corresponde aos filtros.' ) );

		for ( const comment of items ) {

			const item = el( 'article', 'SimpleReviewItem' + ( state.selected === comment.id ? ' selected' : '' ) );
			item.dataset.comment = comment.id;
			item.dataset.status = comment.status;
			item.setAttribute( 'role', 'listitem' );

			const head = el( 'button', 'SimpleReviewItemHead' );
			head.type = 'button';
			head.setAttribute( 'aria-expanded', state.selected === comment.id ? 'true' : 'false' );
			const anchorState = reviews.anchorState( comment );
			head.append(
				el( 'span', 'SimpleReviewNumber', String( number( comment ) ) ),
				el( 'span', 'SimpleReviewMeta', `${comment.author} · ${formatDate( Date.parse( comment.createdAt ) )}` ),
				el( 'span', 'SimpleReviewStatusPill', STATUS_LABELS[ comment.status ] )
			);
			head.addEventListener( 'click', () => select( state.selected === comment.id ? null : comment.id, { locate: state.selected !== comment.id } ) );
			item.appendChild( head );

			const anchor = el( 'div', 'SimpleReviewAnchor' );
			anchor.appendChild( el( 'span', '', anchorText( comment ) ) );
			if ( anchorState === 'missing' ) anchor.appendChild( el( 'span', 'SimpleReviewBadge missing', 'Não localizado' ) );
			if ( comment.stale && anchorState === 'found' ) anchor.appendChild( el( 'span', 'SimpleReviewBadge stale', 'Possivelmente desatualizado' ) );
			if ( comment.conflictOf ) anchor.appendChild( el( 'span', 'SimpleReviewBadge conflict', 'Conflito de identificador' ) );
			item.appendChild( anchor );

			const textNode = el( 'p', 'SimpleReviewText', comment.text );
			item.appendChild( textNode );

			if ( state.selected === comment.id ) item.appendChild( renderDetails( comment, anchorState ) );
			else if ( comment.replies.length > 0 ) item.appendChild( el( 'span', 'SimpleReviewRepliesCount', `${comment.replies.length} resposta(s)` ) );

			list.appendChild( item );

		}

	}

	function renderDetails( comment, anchorState ) {

		const details = el( 'div', 'SimpleReviewDetails' );

		const source = comment.source || {};
		const info = el( 'dl', 'SimpleReviewInfo' );
		const add = ( label, value ) => {

			if ( value === null || value === undefined || value === '' ) return;
			info.append( el( 'dt', '', label ), el( 'dd', '', String( value ) ) );

		};

		add( 'Revisor (declarado)', comment.author );
		add( 'Vínculo', anchorState === 'project' ? 'Projeto inteiro' : ANCHOR_LABELS[ comment.stale && anchorState === 'found' ? 'stale' : anchorState ] );
		add( 'Vista associada', comment.viewName );
		add( 'Revisão de origem', source.revision !== null && source.revision !== undefined ? `revisão ${source.revision}` : null );
		add( 'Compartilhamento', source.shareId ? source.shareId.slice( 0, 8 ) + '…' : null );
		add( 'Importado em', source.importedAt ? formatDate( Date.parse( source.importedAt ) ) : null );
		details.appendChild( info );

		const statusRow = el( 'label', 'SimpleReviewStatusRow' );
		statusRow.appendChild( el( 'span', '', 'Situação' ) );
		const status = el( 'select', 'SimpleSelect SimpleReviewStatus' );
		for ( const key of STATUSES ) {

			const option = el( 'option', '', STATUS_LABELS[ key ] );
			option.value = key;
			status.appendChild( option );

		}

		status.value = comment.status;
		status.addEventListener( 'change', () => {

			if ( reviews.setStatus( comment.id, status.value ) ) context.notify( `Comentário ${number( comment )}: ${STATUS_LABELS[ status.value ]}.`, 'success' );

		} );
		statusRow.appendChild( status );
		details.appendChild( statusRow );

		const actions = el( 'div', 'SimpleReviewActions' );
		if ( anchorState === 'found' ) actions.appendChild( button( 'Localizar no modelo', () => reviews.locate( comment ), { icon: 'frameSelection', className: 'SimpleReviewLocate' } ) );
		if ( comment.camera !== null ) actions.appendChild( button( 'Vista do revisor', () => reviews.locate( comment, { useCamera: true } ), { icon: 'camera', className: 'SimpleReviewCamera', title: 'Recupera o enquadramento usado pelo revisor (não altera o projeto)' } ) );
		actions.appendChild( button( 'Excluir', () => remove( comment ), { icon: 'delete', className: 'SimpleReviewDelete danger' } ) );
		details.appendChild( actions );

		if ( anchorState === 'missing' ) details.appendChild( el( 'p', 'SimpleReviewWarning', 'O componente comentado não existe na versão atual do projeto. O comentário foi preservado e não foi associado a nenhum outro componente.' ) );

		const replies = el( 'div', 'SimpleReviewReplies' );
		for ( const reply of comment.replies ) {

			const node = el( 'div', 'SimpleReviewReply' + ( reply.own ? ' own' : '' ) );
			node.dataset.reply = reply.id;
			node.appendChild( el( 'span', 'SimpleReviewMeta', `${reply.author} · ${formatDate( Date.parse( reply.createdAt ) )}${reply.editedAt ? ' (editada)' : ''}` ) );
			node.appendChild( el( 'p', 'SimpleReviewText', reply.text ) );
			if ( reply.own ) node.appendChild( button( 'Editar', () => editReply( comment, reply ), { className: 'SimpleReviewEditReply' } ) );
			replies.appendChild( node );

		}

		details.appendChild( replies );

		const form = el( 'div', 'SimpleReviewReplyForm' );
		const textarea = el( 'textarea', 'SimpleInput SimpleReviewReplyText' );
		textarea.rows = 2;
		textarea.maxLength = 2000;
		textarea.placeholder = `Responder como ${reviews.ownerName()}`;
		const send = button( 'Responder', () => {

			if ( reviews.addReply( comment.id, textarea.value ) ) context.notify( 'Resposta registrada no projeto.', 'success' );
			else context.notify( 'Escreva a resposta antes de enviar.', 'warning' );

		}, { icon: 'comment', className: 'SimpleReviewReplySend' } );
		form.append( textarea, send );
		details.appendChild( form );
		details.appendChild( el( 'p', 'SimpleReviewsHint', 'As respostas ficam no projeto. Para o revisor vê-las, compartilhe uma nova versão (não há entrega instantânea).' ) );

		return details;

	}

	async function remove( comment ) {

		const choice = await dialog.ask( { title: 'Excluir comentário', message: `Excluir o comentário ${number( comment )} de ${comment.author}? É possível desfazer (Ctrl+Z).`, choices: [ { id: 'delete', label: 'Excluir', kind: 'danger' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( choice === 'delete' && reviews.deleteComment( comment.id ) ) {

			state.selected = null;
			context.notify( 'Comentário excluído.', 'success' );

		}

	}

	async function editReply( comment, reply ) {

		const result = await dialog.ask( { title: 'Editar resposta', message: 'Altere o texto da sua resposta.', input: { label: 'Resposta', value: reply.text, maxLength: 2000 }, choices: [ { id: 'ok', label: 'Salvar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ] } );
		if ( result && result.choice === 'ok' ) reviews.editReply( comment.id, reply.id, result.value );

	}

	function select( id, { locate = false } = {} ) {

		state.selected = id;
		markers.setActive( id );
		if ( state.view !== 'list' ) state.view = 'list';
		render();
		if ( id !== null && locate ) {

			const comment = reviews.comments().find( ( c ) => c.id === id );
			if ( comment !== undefined ) reviews.locate( comment );

		}

		const item = id !== null ? panel.querySelector( `.SimpleReviewItem[data-comment="${id}"]` ) : null;
		if ( item !== null ) item.scrollIntoView( { block: 'nearest' } );

	}

	// importação -------------------------------------------------------------------------------------------------------------

	fileInput.addEventListener( 'change', async () => {

		const file = fileInput.files[ 0 ];
		fileInput.value = '';
		if ( file === undefined ) return;
		await analyzeFile( file );

	} );

	async function analyzeFile( file ) {

		try {

			state.analysis = await reviews.analyze( file );
			state.view = 'import';
			if ( state.open === false ) show();
			else render();

		} catch ( error ) {

			context.notify( error.message || 'Não foi possível ler o arquivo de revisão.', 'error' );

		}

	}

	function renderImport() {

		const analysis = state.analysis;
		const feedback = analysis.feedback;
		panel.textContent = '';
		panel.appendChild( renderHeader() );

		const wrap = el( 'div', 'SimpleReviewsImportView' );
		wrap.appendChild( el( 'h3', '', 'Importar revisão' ) );

		const info = el( 'dl', 'SimpleReviewInfo' );
		const add = ( label, value ) => info.append( el( 'dt', '', label ), el( 'dd', '', value ) );
		add( 'Projeto revisado', feedback.projectTitle || '—' );
		add( 'Revisor (declarado)', feedback.reviewer.name || 'Sem identificação' );
		add( 'Exportada em', feedback.createdAt ? formatDate( Date.parse( feedback.createdAt ) ) : '—' );
		add( 'Revisão de origem', feedback.source.revision !== null ? `revisão ${feedback.source.revision}` : '—' );
		add( 'Compartilhamento', analysis.share !== null ? `registrado neste navegador (${formatDate( Date.parse( analysis.share.createdAt ) )})` : 'não registrado neste navegador' );
		add( 'Comentários no arquivo', String( feedback.comments.length ) );
		wrap.appendChild( info );

		if ( analysis.blocked !== null ) {

			wrap.appendChild( el( 'p', 'SimpleReviewWarning SimpleReviewBlocked', analysis.blocked ) );
			const actions = el( 'div', 'SimpleReviewActions' );
			if ( analysis.otherProject !== null ) actions.appendChild( button( `Abrir "${analysis.otherProject.name}"`, async () => {

				if ( await context.projects.openProject( analysis.otherProject.id ) ) context.notify( 'Projeto aberto. Importe a revisão novamente.', 'success' );

			}, { icon: 'folder' } ) );
			actions.appendChild( button( 'Voltar', () => {

				state.view = 'list';
				state.analysis = null;
				render();

			}, { icon: 'previous', className: 'SimpleReviewImportCancel' } ) );
			wrap.appendChild( actions );
			panel.appendChild( wrap );
			return;

		}

		for ( const message of [ ...analysis.warnings, ...analysis.problems ] ) wrap.appendChild( el( 'p', 'SimpleReviewWarning', message ) );

		const s = analysis.summary;
		const summary = el( 'p', 'SimpleReviewImportSummary' );
		const parts = [ `${s.added} novo(s)` ];
		if ( s.duplicates > 0 ) parts.push( `${s.duplicates} já importado(s) (não serão duplicados)` );
		if ( s.conflicts > 0 ) parts.push( `${s.conflicts} com identificador repetido e conteúdo diferente (entram como comentários separados; os existentes ficam intactos)` );
		if ( s.repliesAdded > 0 ) parts.push( `${s.repliesAdded} resposta(s) nova(s)` );
		if ( s.missing > 0 ) parts.push( `${s.missing} sobre componentes não localizados` );
		if ( s.stale > 0 ) parts.push( `${s.stale} sobre componentes alterados depois do compartilhamento` );
		summary.textContent = parts.join( ' · ' );
		wrap.appendChild( summary );

		const list = el( 'ul', 'SimpleReviewImportList' );
		for ( const item of analysis.items ) {

			const li = el( 'li', '' );
			li.dataset.state = item.state;
			li.dataset.comment = item.comment.id;
			li.append(
				el( 'span', 'SimpleReviewBadge ' + item.state, ANCHOR_LABELS[ item.state ] ),
				el( 'strong', '', item.comment.anchor.kind === 'project' ? 'Projeto inteiro' : ( [ item.label, item.comment.anchor.objectName ].filter( Boolean ).join( ' — ' ) || 'Componente' ) ),
				el( 'p', 'SimpleReviewText', item.comment.text )
			);
			list.appendChild( li );

		}

		wrap.appendChild( list );
		wrap.appendChild( el( 'p', 'SimpleReviewsHint', 'A importação só adiciona observações: nenhuma dimensão, material ou posição é alterada. Os comentários entram com a situação "Aberto". É possível desfazer.' ) );

		const actions = el( 'div', 'SimpleReviewActions' );
		actions.append(
			button( 'Cancelar', () => {

				state.view = 'list';
				state.analysis = null;
				render();

			}, { className: 'SimpleReviewImportCancel' } ),
			button( s.changed ? 'Importar comentários' : 'Nada a importar', () => confirmImport(), { icon: 'save', className: 'active SimpleReviewImportConfirm' } )
		);
		wrap.appendChild( actions );
		panel.appendChild( wrap );

	}

	function confirmImport() {

		const analysis = state.analysis;
		state.analysis = null;
		state.view = 'list';
		const summary = reviews.importAnalysis( analysis );
		if ( summary === null ) return render();
		if ( summary.changed && markers.isVisible() === false ) markers.setVisible( true );
		if ( summary.changed ) context.notify( `Revisão importada: ${summary.added + summary.conflicts} comentário(s) novo(s)${summary.repliesAdded ? `, ${summary.repliesAdded} resposta(s)` : ''}${summary.duplicates ? `; ${summary.duplicates} já existiam` : ''}.`, 'success' );
		else context.notify( 'Esta revisão já havia sido importada: nenhum comentário duplicado.', 'info' );
		render();

	}

	// abrir e fechar ---------------------------------------------------------------------------------------------------------

	function render() {

		if ( state.open === false ) return;
		const focused = document.activeElement;
		const restoreSearch = focused !== null && focused.classList.contains( 'SimpleReviewsSearch' );
		if ( state.view === 'import' && state.analysis !== null ) renderImport();
		else renderList();
		if ( restoreSearch ) {

			const search = panel.querySelector( '.SimpleReviewsSearch' );
			search.focus();
			search.setSelectionRange( search.value.length, search.value.length );

		}

	}

	function show() {

		state.open = true;
		panel.hidden = false;
		document.body.classList.add( 'reviews-open' );
		if ( markers.isVisible() === false && reviews.comments().length > 0 ) markers.setVisible( true );
		render();

	}

	function hide() {

		if ( state.open === false ) return;
		state.open = false;
		panel.hidden = true;
		document.body.classList.remove( 'reviews-open' );
		markers.setVisible( false );

	}

	panel.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' && dialog.isOpen() === false ) {

			event.preventDefault();
			hide();

		}

		event.stopPropagation(); // atalhos do editor não agem enquanto se escreve aqui

	} );

	// histórico (Desfazer/Refazer), carregamento de outro projeto e edições externas atualizam a lista
	editor.signals.historyChanged.add( () => render() );
	editor.signals.sceneGraphChanged.add( () => {

		if ( state.open && document.activeElement && panel.contains( document.activeElement ) && document.activeElement.tagName === 'TEXTAREA' ) return;
		render();

	} );

	return { show, hide, toggle: () => ( state.open ? hide() : show() ), isOpen: () => state.open, importFile: () => fileInput.click(), analyzeFile, select, markers };

}

export { SimpleModeReviewPanel };
