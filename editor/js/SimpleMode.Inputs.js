// EV-002 — Sistema de Medidas e Precisão Dimensional 3D
// Campo numérico do Modo Simples: aceita vírgula ou ponto, valida o valor e trabalha sempre com o valor
// interno exato (metros, graus ou fator), nunca com o texto arredondado exibido.

import { UIElement } from './libs/ui.js';

import { parseNumber, getInputFormatter } from './SimpleMode.Units.js';

// kind:
//   'length' -> valor interno em metros, exibido na unidade do projeto
//   'angle'  -> graus
//   'factor' -> número puro (escala)

class SimpleNumberInput extends UIElement {

	constructor( { kind = 'factor', units = null, label = '', min = - Infinity, exclusiveMin = false, onCommit, onInvalid } ) {

		super( document.createElement( 'input' ) );

		this.kind = kind;
		this.units = units;
		this.min = min;
		this.exclusiveMin = exclusiveMin;
		this.onCommit = onCommit;
		this.onInvalid = onInvalid;

		this.value = 0; // valor interno exato
		this.renderedText = '';
		this.disabled = false;

		const dom = this.dom;
		dom.type = 'text';
		dom.inputMode = 'decimal';
		dom.className = 'SimpleNumber';
		dom.setAttribute( 'autocomplete', 'off' );
		dom.setAttribute( 'spellcheck', 'false' );
		dom.setAttribute( 'aria-label', label );
		dom.title = label;

		dom.addEventListener( 'keydown', ( event ) => {

			event.stopPropagation(); // não aciona atalhos do editor (Delete, W/E/R...)

			switch ( event.key ) {

				case 'Enter':
					this.commit();
					dom.select();
					break;

				case 'Escape':
					this.render( true );
					dom.blur();
					break;

				case 'ArrowUp':
				case 'ArrowDown':
					event.preventDefault();
					this.nudge( event.key === 'ArrowUp' ? 1 : - 1, event.shiftKey );
					break;

			}

		} );

		dom.addEventListener( 'focus', () => dom.select() );
		dom.addEventListener( 'blur', () => this.commit() );
		dom.addEventListener( 'input', () => dom.classList.remove( 'invalid' ) );

	}

	// valor interno -> texto

	format( value ) {

		if ( this.kind === 'length' ) return this.units.formatInput( value );

		const decimals = this.kind === 'angle' ? 2 : 4;
		return getInputFormatter( decimals ).format( value + 0 );

	}

	// texto -> valor interno (ou null)

	parse( text ) {

		const number = parseNumber( text );

		if ( number === null ) return null;

		return this.kind === 'length' ? this.units.fromDisplay( number ) : number;

	}

	isValid( value ) {

		if ( value === null || Number.isFinite( value ) === false ) return false;

		return this.exclusiveMin ? value > this.min : value >= this.min;

	}

	setValue( value ) {

		this.value = value;
		this.render();

		return this;

	}

	setDisabled( disabled, text ) {

		this.disabled = disabled;
		this.dom.disabled = disabled;
		this.dom.classList.remove( 'invalid' );

		if ( disabled && text !== undefined ) {

			this.dom.value = text;
			this.renderedText = text;

		} else {

			this.render( true );

		}

		return this;

	}

	// não sobrescreve o que o usuário está digitando, a menos que seja forçado
	render( force = false ) {

		if ( this.disabled ) return;
		if ( force === false && document.activeElement === this.dom ) return;

		this.renderedText = this.format( this.value );
		this.dom.value = this.renderedText;
		this.dom.classList.remove( 'invalid' );

	}

	commit() {

		if ( this.disabled ) return;

		const text = this.dom.value;

		// texto inalterado: nada a fazer (evita gravar o valor arredondado da tela)
		if ( text.trim() === this.renderedText ) return;

		const value = this.parse( text );

		if ( this.isValid( value ) === false ) {

			this.dom.classList.add( 'invalid' );
			if ( this.onInvalid !== undefined ) this.onInvalid( text );
			this.render( true );
			return;

		}

		this.value = value;
		this.render( true );

		if ( this.onCommit !== undefined ) this.onCommit( value );

	}

	// setas do teclado: 1 unidade exibida (Shift = 10), calculado sobre o valor interno exato

	nudge( direction, large ) {

		if ( this.disabled ) return;

		let step;

		if ( this.kind === 'length' ) {

			const unit = this.units.getUnit();
			step = ( unit.id === 'm' ? 0.01 : 1 ) / unit.factor;

		} else if ( this.kind === 'angle' ) {

			step = 1;

		} else {

			step = 0.1;

		}

		if ( large ) step *= 10;

		const value = this.value + direction * step;

		if ( this.isValid( value ) === false ) return;

		this.value = value;
		this.render( true );

		if ( this.onCommit !== undefined ) this.onCommit( value );

	}

}

export { SimpleNumberInput };
