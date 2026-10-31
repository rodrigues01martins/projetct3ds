// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// "Compartilhar projeto": preparação (nome, identificação da versão, data, descrição, conteúdo), RESUMO do que será
// enviado e confirmação explícita. O pacote só é gerado depois da confirmação; a cena não é modificada.
// O projeto precisa estar salvo em Meus projetos (EV-011): o pacote informa o projeto e a revisão de origem, e o
// compartilhamento fica registrado neste navegador para conferir as revisões devolvidas.

import { CONTENT_OPTIONS, EXCLUDED, ShareError } from './SimpleMode.ShareData.js';
import { prepareShare, exportShare, registerShare } from './SimpleMode.ShareExport.js';
import { formatBytes, formatDate } from './SimpleMode.ProjectData.js';
import { cleanText } from './SimpleMode.ReviewData.js';
import { createSimpleButton } from './SimpleMode.Icons.js';

function el( tag, className, text ) {

	const node = document.createElement( tag );
	if ( className ) node.className = className;
	if ( text !== undefined ) node.textContent = text;
	return node;

}

function viewerAddress() {

	return new URL( 'viewer/', window.location.href.split( '#' )[ 0 ] ).href;

}

function SimpleModeShareDialog( editor, context, root ) {

	const projects = context.projects;
	const state = { open: false, step: 'form', prepared: null, busy: false, options: { materials: true, lighting: true, views: true, names: true, dimensions: true } };

	const overlay = el( 'div', 'SimpleShareOverlay' );
	overlay.id = 'simple-share';
	overlay.hidden = true;
	const panel = el( 'div', 'SimpleSharePanel' );
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-modal', 'true' );
	panel.setAttribute( 'aria-labelledby', 'simple-share-title' );
	overlay.appendChild( panel );
	root.appendChild( overlay );

	const fields = { title: null, version: null, description: null };

	function header( titleText ) {

		const head = el( 'div', 'SimpleShareHeader' );
		const title = el( 'h2', 'SimpleShareTitle', titleText );
		title.id = 'simple-share-title';
		const close = createSimpleButton( { icon: 'close', label: 'Fechar', title: 'Fechar', className: 'SimpleShareClose', onClick: () => hide() } ).dom;
		head.append( title, close );
		return head;

	}

	function renderForm() {

		const project = projects.getActive();
		panel.textContent = '';
		panel.appendChild( header( 'Compartilhar projeto' ) );

		const body = el( 'div', 'SimpleShareBody' );
		body.appendChild( el( 'p', 'SimpleShareIntro', 'Gera um pacote de visualização (.p3ds-review.zip) para enviar por e-mail, mensagem ou outro meio de sua preferência. O destinatário abre o arquivo no Visualizador Project3DS, navega pelo modelo e devolve comentários em um arquivo de revisão. O projeto original continua só com você.' ) );

		const grid = el( 'div', 'SimpleShareFields' );
		const field = ( labelText, input ) => {

			const label = el( 'label', 'SimpleShareField' );
			label.appendChild( el( 'span', '', labelText ) );
			label.appendChild( input );
			grid.appendChild( label );
			return input;

		};

		fields.title = field( 'Nome do projeto', Object.assign( el( 'input', 'SimpleInput' ), { value: fields.title !== null ? fields.title.value : ( project !== null ? project.name : '' ), maxLength: 120 } ) );
		fields.title.dataset.field = 'title';
		fields.version = field( 'Identificação da versão', Object.assign( el( 'input', 'SimpleInput' ), { value: fields.version !== null ? fields.version.value : ( project !== null ? `Revisão ${project.revision}` : '' ), maxLength: 60 } ) );
		fields.version.dataset.field = 'version';
		const date = el( 'span', 'SimpleShareStatic', formatDate( Date.now() ) );
		field( 'Data do compartilhamento', date );
		fields.description = field( 'Descrição (opcional)', Object.assign( el( 'textarea', 'SimpleInput' ), { value: fields.description !== null ? fields.description.value : '', maxLength: 600, rows: 3 } ) );
		fields.description.dataset.field = 'description';
		body.appendChild( grid );

		const contents = el( 'fieldset', 'SimpleShareContents' );
		contents.appendChild( el( 'legend', '', 'Conteúdo incluído' ) );
		for ( const option of CONTENT_OPTIONS ) {

			const row = el( 'label', 'SimpleCheckboxRow' );
			const box = el( 'input' );
			box.type = 'checkbox';
			box.dataset.option = option.key;
			box.checked = option.locked ? true : state.options[ option.key ] !== false;
			box.disabled = option.locked === true;
			box.addEventListener( 'change', () => {

				state.options[ option.key ] = box.checked;

			} );
			row.append( box, el( 'span', '', option.label + ( option.locked ? ' (sempre incluída)' : '' ) ) );
			contents.appendChild( row );

		}

		body.appendChild( contents );

		const excluded = el( 'div', 'SimpleShareExcluded' );
		excluded.appendChild( el( 'strong', '', 'Nunca incluídos no pacote' ) );
		const list = el( 'ul' );
		for ( const item of EXCLUDED ) list.appendChild( el( 'li', '', item ) );
		excluded.appendChild( list );
		body.appendChild( excluded );

		body.appendChild( el( 'p', 'SimpleShareWarning', 'Atenção: qualquer pessoa que receber o arquivo poderá copiá-lo e repassá-lo. A visualização somente leitura impede modificações pela interface, mas não é proteção criptográfica: a geometria contida no arquivo pode ser extraída.' ) );
		panel.appendChild( body );

		const actions = el( 'div', 'SimpleShareActions' );
		const next = createSimpleButton( { icon: 'next', label: 'Revisar conteúdo', title: 'Mostra o resumo do que será enviado', className: 'active SimpleSharePrepare', onClick: () => prepare() } ).dom;
		actions.append( createSimpleButton( { label: 'Cancelar', title: 'Cancelar', onClick: () => hide() } ).dom, next );
		panel.appendChild( actions );

	}

	function renderSummary() {

		const prepared = state.prepared;
		const manifest = prepared.manifest;
		panel.textContent = '';
		panel.appendChild( header( 'Confirmar compartilhamento' ) );

		const body = el( 'div', 'SimpleShareBody' );
		body.appendChild( el( 'p', 'SimpleShareIntro', `Resumo do pacote "${manifest.title}" (${manifest.source.versionLabel || 'versão atual'}). Confira antes de gerar o arquivo.` ) );

		const table = el( 'table', 'SimpleShareSummary' );
		const row = ( label, value, included ) => {

			const tr = el( 'tr' );
			if ( included !== undefined ) tr.dataset.included = included ? 'yes' : 'no';
			tr.append( el( 'th', '', label ), el( 'td', '', value ) );
			table.appendChild( tr );

		};

		const s = prepared.stats;
		row( 'Geometria', `incluída — ${s.units} componente(s), ${s.objects} objeto(s), ${s.vertices.toLocaleString( 'pt-BR' )} vértices`, true );
		row( 'Materiais e texturas', manifest.contents.materials ? `incluídos — ${s.materials} material(is), ${s.textures} textura(s)` : 'excluídos (acabamento neutro)', manifest.contents.materials );
		row( 'Iluminação', manifest.contents.lighting ? `incluída — ${s.lights} luz(es)` : 'excluída (o visualizador usa iluminação padrão)', manifest.contents.lighting );
		row( 'Vistas salvas', manifest.contents.views ? `incluídas — ${s.views} vista(s)` : 'excluídas', manifest.contents.views );
		row( 'Nomes dos componentes', manifest.contents.names ? 'incluídos' : 'excluídos (apenas o tipo é exibido)', manifest.contents.names );
		row( 'Dimensões básicas', manifest.contents.dimensions ? 'incluídas' : 'excluídas', manifest.contents.dimensions );
		for ( const item of EXCLUDED ) row( item, 'excluído', false );
		row( 'Tamanho estimado', formatBytes( prepared.bytes ) + ' antes da compactação' );
		body.appendChild( table );

		if ( prepared.removed.length > 0 ) {

			const notes = el( 'div', 'SimpleShareNotes' );
			notes.appendChild( el( 'strong', '', 'Filtrados automaticamente (não suportados pelo visualizador):' ) );
			const list = el( 'ul' );
			for ( const item of prepared.removed.filter( ( entry ) => /metadados internos/.test( entry ) === false ) ) list.appendChild( el( 'li', '', item ) );
			list.appendChild( el( 'li', '', 'metadados internos de edição (parâmetros, acabamentos, orçamento, planta) — não fazem parte da visualização' ) );
			notes.appendChild( list );
			body.appendChild( notes );

		}

		body.appendChild( el( 'p', 'SimpleShareWarning', 'Qualquer pessoa que receber o arquivo poderá copiá-lo e repassá-lo. O visualizador é somente leitura, mas isso não impede a extração da geometria.' ) );
		panel.appendChild( body );

		const actions = el( 'div', 'SimpleShareActions' );
		actions.append(
			createSimpleButton( { icon: 'previous', label: 'Voltar', title: 'Voltar às opções', onClick: () => {

				state.step = 'form';
				render();

			} } ).dom,
			createSimpleButton( { label: 'Cancelar', title: 'Cancelar', onClick: () => hide() } ).dom,
			createSimpleButton( { icon: 'save', label: 'Gerar pacote', title: 'Gera e baixa o arquivo .p3ds-review.zip', className: 'active SimpleShareConfirm', onClick: () => confirm() } ).dom
		);
		panel.appendChild( actions );

	}

	function renderDone( result ) {

		panel.textContent = '';
		panel.appendChild( header( 'Pacote gerado' ) );
		const body = el( 'div', 'SimpleShareBody' );
		body.appendChild( el( 'p', 'SimpleShareIntro', `O arquivo "${result.fileName}" (${formatBytes( result.size )}) foi baixado. Envie-o ao destinatário junto com o endereço do visualizador:` ) );
		const address = el( 'code', 'SimpleShareAddress', viewerAddress() );
		body.appendChild( address );
		const steps = el( 'ol', 'SimpleShareSteps' );
		for ( const step of [ 'O destinatário abre o endereço acima e seleciona o arquivo recebido.', 'Ele navega pelo modelo, comenta e exporta um arquivo .p3ds-feedback.json.', 'Você importa esse arquivo em Revisões do projeto (nada é alterado no modelo automaticamente).' ] ) steps.appendChild( el( 'li', '', step ) );
		body.appendChild( steps );
		body.appendChild( el( 'p', 'SimpleShareHint', `Identificador do compartilhamento: ${result.manifest.shareId}` ) );
		panel.appendChild( body );
		const actions = el( 'div', 'SimpleShareActions' );
		actions.appendChild( createSimpleButton( { label: 'Concluir', title: 'Fechar', className: 'active SimpleShareDone', onClick: () => hide() } ).dom );
		panel.appendChild( actions );

	}

	function render( result ) {

		if ( state.step === 'summary' ) renderSummary();
		else if ( state.step === 'done' ) renderDone( result );
		else renderForm();
		const first = panel.querySelector( '.SimpleShareActions .active, input, button' );
		if ( first ) first.focus();

	}

	async function ensureSaved() {

		if ( projects === undefined || projects.state.available === false ) {

			context.notify( 'Meus projetos não está disponível neste navegador: não é possível registrar o compartilhamento.', 'error' );
			return false;

		}

		if ( projects.getActive() === null ) {

			const choice = await context.dialog.ask( {
				title: 'Salvar antes de compartilhar',
				message: 'O compartilhamento identifica o projeto e a revisão de origem. Salve a cena em Meus projetos para continuar.',
				choices: [ { id: 'save', label: 'Salvar e continuar', kind: 'primary' }, { id: 'cancel', label: 'Cancelar' } ]
			} );
			if ( choice !== 'save' ) return false;

		}

		if ( projects.getActive() === null || projects.isDirty() ) {

			if ( await projects.save( 'manual' ) === false ) {

				context.notify( 'Não foi possível salvar o projeto; o compartilhamento foi cancelado.', 'error' );
				return false;

			}

		}

		return projects.getActive() !== null;

	}

	function prepare() {

		const project = projects.getActive();
		const title = cleanText( fields.title.value, 120 ) || ( project !== null ? project.name : 'Projeto' );
		try {

			state.prepared = prepareShare( editor, {
				project,
				title,
				description: cleanText( fields.description.value, 600 ),
				versionLabel: cleanText( fields.version.value, 60 ),
				options: Object.assign( {}, state.options )
			} );
			state.step = 'summary';
			render();

		} catch ( error ) {

			console.error( error );
			context.notify( error instanceof ShareError ? error.message : 'Não foi possível preparar o compartilhamento.', 'error' );

		}

	}

	async function confirm() {

		if ( state.busy || state.prepared === null ) return;
		state.busy = true;

		try {

			const result = await exportShare( state.prepared );
			editor.utils.save( result.blob, result.fileName );
			try {

				await registerShare( projects.storage, result.manifest, state.prepared.fingerprints );

			} catch ( error ) {

				console.warn( error );
				context.notify( 'Pacote gerado, mas o registro local do compartilhamento falhou (as revisões ainda poderão ser importadas, com verificação reduzida).', 'warning' );

			}

			state.prepared = null;
			state.step = 'done';
			render( result );

		} catch ( error ) {

			console.error( error );
			context.notify( error instanceof ShareError ? error.message : 'Não foi possível gerar o pacote.', 'error' );

		} finally {

			state.busy = false;

		}

	}

	async function show() {

		if ( state.open ) return;
		if ( await ensureSaved() === false ) return;
		state.open = true;
		state.step = 'form';
		state.prepared = null;
		fields.title = fields.version = fields.description = null;
		overlay.hidden = false;
		if ( context.interaction !== undefined ) context.interaction.deactivate();
		render();

	}

	function hide() {

		if ( state.open === false ) return;
		state.open = false;
		state.prepared = null;
		overlay.hidden = true;

	}

	overlay.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' && context.dialog.isOpen() === false ) {

			event.preventDefault();
			hide();

		}

		event.stopPropagation();

	} );

	overlay.addEventListener( 'mousedown', ( event ) => {

		if ( event.target === overlay ) hide();

	} );

	return { show, hide, isOpen: () => state.open, viewerAddress };

}

export { SimpleModeShareDialog, viewerAddress };
