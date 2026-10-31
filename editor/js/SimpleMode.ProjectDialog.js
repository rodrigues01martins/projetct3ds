// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Diálogo modal simples e acessível (role="dialog", foco preso, Esc = cancelar) para confirmações e escolhas.
// Usado só em ações potencialmente destrutivas ou decisões que o aplicativo não pode tomar sozinho.

function ProjectDialog( root ) {

	const overlay = document.createElement( 'div' );
	overlay.className = 'SimpleDialogOverlay';
	overlay.hidden = true;

	const dialog = document.createElement( 'div' );
	dialog.className = 'SimpleDialog';
	dialog.setAttribute( 'role', 'dialog' );
	dialog.setAttribute( 'aria-modal', 'true' );
	overlay.appendChild( dialog );
	root.appendChild( overlay );

	let resolver = null;
	let previousFocus = null;
	let cancelValue = 'cancel';

	function close( value ) {

		if ( resolver === null ) return;
		const resolve = resolver;
		resolver = null;
		overlay.hidden = true;
		dialog.textContent = '';
		if ( previousFocus !== null && typeof previousFocus.focus === 'function' ) previousFocus.focus();
		resolve( value );

	}

	// choices: [ { id, label, kind: 'primary' | 'danger' | 'default' } ]; input opcional { label, value, maxLength }
	function ask( { title, message, details = [], choices, input = null, cancel = 'cancel' } ) {

		if ( resolver !== null ) close( cancelValue );

		previousFocus = document.activeElement;
		cancelValue = cancel;
		dialog.textContent = '';

		const heading = document.createElement( 'h2' );
		heading.className = 'SimpleDialogTitle';
		heading.id = 'simple-dialog-title';
		heading.textContent = title;
		dialog.setAttribute( 'aria-labelledby', heading.id );
		dialog.appendChild( heading );

		if ( message ) {

			const text = document.createElement( 'p' );
			text.className = 'SimpleDialogMessage';
			text.textContent = message;
			dialog.appendChild( text );

		}

		if ( details.length > 0 ) {

			const list = document.createElement( 'ul' );
			list.className = 'SimpleDialogDetails';
			for ( const item of details ) {

				const li = document.createElement( 'li' );
				li.textContent = item;
				list.appendChild( li );

			}

			dialog.appendChild( list );

		}

		let field = null;

		if ( input !== null ) {

			const label = document.createElement( 'label' );
			label.className = 'SimpleDialogField';
			label.textContent = input.label;
			field = document.createElement( 'input' );
			field.className = 'SimpleTextInput';
			field.value = input.value || '';
			field.maxLength = input.maxLength || 80;
			field.addEventListener( 'keydown', ( event ) => {

				event.stopPropagation();
				if ( event.key === 'Enter' ) {

					event.preventDefault();
					const primary = choices.find( ( c ) => c.kind === 'primary' );
					if ( primary ) close( { choice: primary.id, value: field.value } );

				}

				if ( event.key === 'Escape' ) close( input ? { choice: cancel, value: field.value } : cancel );

			} );
			label.appendChild( field );
			dialog.appendChild( label );

		}

		const actions = document.createElement( 'div' );
		actions.className = 'SimpleDialogActions';

		for ( const choice of choices ) {

			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'SimpleButton SimpleDialogButton ' + ( choice.kind === 'primary' ? 'active' : ( choice.kind === 'danger' ? 'danger' : '' ) );
			button.dataset.choice = choice.id;
			button.textContent = choice.label;
			button.addEventListener( 'click', () => close( input !== null ? { choice: choice.id, value: field.value } : choice.id ) );
			actions.appendChild( button );

		}

		dialog.appendChild( actions );
		overlay.hidden = false;

		requestAnimationFrame( () => ( field || actions.querySelector( '.active' ) || actions.querySelector( 'button' ) ).focus() );

		return new Promise( ( resolve ) => {

			resolver = resolve;

		} );

	}

	// foco preso no diálogo; Esc cancela
	overlay.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' ) {

			event.preventDefault();
			event.stopPropagation();
			const field = dialog.querySelector( 'input' );
			close( field !== null ? { choice: cancelValue, value: field.value } : cancelValue );
			return;

		}

		if ( event.key === 'Tab' ) {

			const focusable = [ ...dialog.querySelectorAll( 'button, input' ) ];
			if ( focusable.length === 0 ) return;
			const index = focusable.indexOf( document.activeElement );
			const next = event.shiftKey ? ( index <= 0 ? focusable.length - 1 : index - 1 ) : ( index === focusable.length - 1 ? 0 : index + 1 );
			event.preventDefault();
			focusable[ next ].focus();

		}

		event.stopPropagation(); // atalhos do editor não agem por trás do diálogo

	} );

	return { ask, close: () => close( cancelValue ), isOpen: () => resolver !== null };

}

export { ProjectDialog };
