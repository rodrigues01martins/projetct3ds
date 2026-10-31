// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Indicador discreto de persistência ao lado do título (Salvo · Alterações pendentes · Salvando… · Erro ao salvar)
// e aviso flutuante para decisões de recuperação, migração do estado antigo e alterações feitas em outra aba.

import { formatDate } from './SimpleMode.ProjectData.js';

const LABELS = {
	idle: { text: '', title: '' },
	unregistered: { text: 'Não salvo em Meus projetos', title: 'A cena ainda não está em Meus projetos. Ela será registrada ao salvar (Ctrl+S) ou na primeira gravação automática.' },
	pending: { text: 'Alterações pendentes', title: 'Há alterações que serão salvas automaticamente neste navegador em instantes.' },
	draft: { text: 'Alterações pendentes', title: 'Salvamento automático desligado: as alterações estão num rascunho de recuperação até "Salvar projeto".' },
	saving: { text: 'Salvando…', title: 'Gravando no armazenamento local do navegador.' },
	saved: { text: 'Salvo', title: 'Projeto salvo neste navegador.' },
	error: { text: 'Erro ao salvar', title: 'A última gravação falhou. Os dados salvos anteriormente foram preservados.' },
	conflict: { text: 'Conflito com outra aba', title: 'O projeto foi salvo em outra aba. Escolha recarregar ou salvar uma cópia.' },
	loading: { text: 'Carregando…', title: 'Trocando de projeto.' }
};

function SimpleModeProjectStatus( editor, context, anchor, root ) {

	const manager = context.projects;

	const chip = document.createElement( 'button' );
	chip.type = 'button';
	chip.className = 'SimpleProjectStatus';
	chip.setAttribute( 'aria-live', 'polite' );
	chip.addEventListener( 'click', () => context.openProjects() );
	anchor.appendChild( chip );

	const banner = document.createElement( 'div' );
	banner.className = 'SimpleProjectBanner';
	banner.setAttribute( 'role', 'status' );
	banner.hidden = true;
	root.appendChild( banner );

	let remoteDismissed = null;

	function action( label, onClick, primary = false ) {

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'SimpleButton' + ( primary ? ' active' : '' );
		button.textContent = label;
		button.addEventListener( 'click', onClick );
		return button;

	}

	function update() {

		const status = manager.state.status;
		const label = LABELS[ status ] || LABELS.idle;
		chip.textContent = label.text;
		chip.title = ( manager.state.error ? manager.state.error + ' ' : '' ) + label.title;
		chip.dataset.status = status;
		chip.hidden = label.text === '';

		banner.textContent = '';
		const recovery = manager.state.pendingRecovery;
		const migration = manager.state.pendingMigration;
		const remote = manager.state.remote;
		const active = manager.getActive();

		if ( recovery !== null ) {

			banner.append( text( `Encontramos alterações recentes (${formatDate( recovery.draft.savedAt )}) que podem ser recuperadas. Alterações que nunca chegaram a ser gravadas antes de uma falha não podem ser recuperadas.` ),
				action( 'Recuperar alterações', () => manager.recoverDraft( recovery.projectId ), true ),
				action( 'Abrir última versão salva', () => manager.keepSavedVersion( recovery.projectId ) ),
				action( 'Decidir depois', () => manager.postponeRecovery() ) );
			banner.dataset.kind = 'recovery';

		} else if ( migration !== null ) {

			banner.append( text( 'Encontramos um projeto de trabalho de uma versão anterior do aplicativo. Deseja incorporá-lo a Meus projetos? O estado original não é apagado.' ),
				action( 'Incorporar a Meus projetos', () => manager.acceptMigration(), true ),
				action( 'Agora não', () => manager.declineMigration() ) );
			banner.dataset.kind = 'migration';

		} else if ( remote !== null && active !== null && remoteDismissed !== remote.revision ) {

			banner.append( text( `"${active.name}" foi salvo em outra aba. Para não sobrescrever aquele trabalho, recarregue ou salve suas alterações como cópia.` ),
				action( 'Recarregar a versão mais recente', () => manager.resolveConflict(), true ),
				action( 'Ignorar', () => {

					remoteDismissed = remote.revision;
					update();

				} ) );
			banner.dataset.kind = 'remote';

		}

		banner.hidden = banner.childElementCount === 0;

	}

	function text( value ) {

		const node = document.createElement( 'p' );
		node.textContent = value;
		return node;

	}

	manager.changed.add( update );
	update();

	return { update };

}

export { SimpleModeProjectStatus };
