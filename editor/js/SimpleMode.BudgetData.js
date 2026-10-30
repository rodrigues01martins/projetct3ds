// EV-010 — Sistema Inteligente de Quantitativos e Orçamento de Projetos 3D
//
// Dados do orçamento guardados no projeto (somente dados serializáveis; totais NUNCA são guardados — são sempre
// recalculados a partir da geometria e destes dados):
//   editor.scene.userData.project3ds.budget = {
//     version, currency: 'BRL', referenceDate, notes,
//     items: [ {
//       id, code, category, description, unit,
//       source: { kind: 'object', objectUuid, measurement }                      // um componente
//             | { kind: 'group', componentId, groupKey | null, measurement }    // todos de um tipo (e dimensão)
//             | { kind: 'manual', quantity },                                  // sem vínculo geométrico
//       coefficient (null = 1; obrigatório para converter unidades), wastePercent,
//       unitPriceCents (null = preço não informado), priceSource, priceDate, priceCode, notes
//     } ],
//     adjustments: [ { id, label, kind: 'percent' | 'fixed', value } ]   // % sobre o custo direto precificado | centavos
//   }

import * as THREE from 'three';

import { UNITS, MEASUREMENTS, CATEGORIES, TYPES } from './SimpleMode.QuantityRules.js';

const BUDGET_VERSION = 1;
const LIMITS = { items: 500, adjustments: 20, text: 160, short: 80, notes: 600, waste: 300, maxCents: 1e13, maxQuantity: 1e9 };

function defaultBudget() {

	return { version: BUDGET_VERSION, currency: 'BRL', referenceDate: null, notes: '', items: [], adjustments: [] };

}

const finite = ( value ) => typeof value === 'number' && Number.isFinite( value );
// caracteres de controle viram espaço (texto de uma linha, seguro para XML/CSV/PDF)
const stripControl = ( value ) => Array.from( value, ( c ) => ( c.charCodeAt( 0 ) < 32 ? ' ' : c ) ).join( '' );
const text = ( value, max ) => ( typeof value === 'string' ? stripControl( value ).replace( /\s+/g, ' ' ).trim().slice( 0, max ) : '' );
const date = ( value ) => ( typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test( value ) ? value : null );

function sanitizeSource( source ) {

	if ( source === null || typeof source !== 'object' ) return null;

	if ( source.kind === 'manual' ) return { kind: 'manual', quantity: finite( source.quantity ) && source.quantity >= 0 && source.quantity <= LIMITS.maxQuantity ? source.quantity : 0 };

	if ( MEASUREMENTS[ source.measurement ] === undefined ) return null;

	if ( source.kind === 'object' && typeof source.objectUuid === 'string' && source.objectUuid.length <= 64 ) return { kind: 'object', objectUuid: source.objectUuid, measurement: source.measurement };

	if ( source.kind === 'group' && TYPES[ source.componentId ] !== undefined ) {

		return { kind: 'group', componentId: source.componentId, groupKey: typeof source.groupKey === 'string' && source.groupKey.length <= 120 ? source.groupKey : null, measurement: source.measurement };

	}

	return null;

}

function sanitizeItem( item, index = 0 ) {

	if ( item === null || typeof item !== 'object' ) return null;

	const source = sanitizeSource( item.source );
	if ( source === null ) return null;

	return {
		id: typeof item.id === 'string' && item.id !== '' ? item.id.slice( 0, 40 ) : newId( 'item' ),
		code: text( item.code, 20 ) || String( index + 1 ).padStart( 2, '0' ),
		category: CATEGORIES[ item.category ] !== undefined ? item.category : 'others',
		description: text( item.description, LIMITS.text ) || 'Item',
		unit: UNITS[ item.unit ] !== undefined ? item.unit : 'un',
		source,
		coefficient: finite( item.coefficient ) && item.coefficient > 0 ? item.coefficient : null,
		wastePercent: finite( item.wastePercent ) && item.wastePercent >= 0 && item.wastePercent <= LIMITS.waste ? item.wastePercent : 0,
		unitPriceCents: Number.isInteger( item.unitPriceCents ) && item.unitPriceCents >= 0 && item.unitPriceCents <= LIMITS.maxCents ? item.unitPriceCents : null,
		priceSource: text( item.priceSource, LIMITS.short ),
		priceDate: date( item.priceDate ),
		priceCode: text( item.priceCode, 40 ),
		notes: text( item.notes, 240 )
	};

}

function sanitizeAdjustment( adjustment ) {

	if ( adjustment === null || typeof adjustment !== 'object' ) return null;
	const kind = adjustment.kind === 'fixed' ? 'fixed' : ( adjustment.kind === 'percent' ? 'percent' : null );
	if ( kind === null || finite( adjustment.value ) === false || adjustment.value < 0 ) return null;
	if ( kind === 'percent' && adjustment.value > 1000 ) return null;
	if ( kind === 'fixed' && ( Number.isInteger( adjustment.value ) === false || adjustment.value > LIMITS.maxCents ) ) return null;

	return { id: typeof adjustment.id === 'string' && adjustment.id !== '' ? adjustment.id.slice( 0, 40 ) : newId( 'adj' ), label: text( adjustment.label, LIMITS.short ) || 'Adicional', kind, value: adjustment.value };

}

// dados do arquivo validados (o que for inválido é descartado; nunca impede abrir o projeto)
function sanitizeBudget( value ) {

	const budget = defaultBudget();
	if ( value === null || typeof value !== 'object' ) return budget;

	budget.referenceDate = date( value.referenceDate );
	budget.notes = text( value.notes, LIMITS.notes );
	if ( Array.isArray( value.items ) ) budget.items = value.items.slice( 0, LIMITS.items ).map( sanitizeItem ).filter( ( item ) => item !== null );
	if ( Array.isArray( value.adjustments ) ) budget.adjustments = value.adjustments.slice( 0, LIMITS.adjustments ).map( sanitizeAdjustment ).filter( ( item ) => item !== null );

	return budget;

}

function hasBudget( scene ) {

	const meta = scene.userData.project3ds;
	return meta !== undefined && meta !== null && meta.budget !== undefined;

}

function getBudget( scene ) {

	const meta = scene.userData.project3ds;
	return sanitizeBudget( meta !== undefined && meta !== null ? meta.budget : null );

}

// grava preservando plan, savedViews, unidades e demais metadados; null remove o orçamento
function setBudget( scene, budget ) {

	const meta = Object.assign( {}, scene.userData.project3ds );

	if ( budget !== null ) meta.budget = JSON.parse( JSON.stringify( budget ) );
	else delete meta.budget;

	if ( Object.keys( meta ).length > 0 ) scene.userData.project3ds = meta;
	else delete scene.userData.project3ds;

}

function newId( prefix ) {

	return prefix + '-' + THREE.MathUtils.generateUUID().slice( 0, 8 );

}

function nextCode( budget ) {

	const numbers = budget.items.map( ( item ) => Number( item.code ) ).filter( Number.isInteger );
	return String( ( numbers.length > 0 ? Math.max( ...numbers ) : 0 ) + 1 ).padStart( 2, '0' );

}

export { BUDGET_VERSION, LIMITS as BUDGET_LIMITS, defaultBudget, sanitizeBudget, sanitizeItem, sanitizeAdjustment, hasBudget, getBudget, setBudget, newId, nextCode };
