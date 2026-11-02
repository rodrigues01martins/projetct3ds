// EV-016 — Sistema de Planejamento de Montagem e Logística de Projetos 3D
//
// Esquema, saneamento e identificadores do plano logístico, guardado no projeto em
//   editor.scene.userData.project3ds.logistics
// Quatro tipos de informação são mantidos separados:
//   A. modelo 3D        — quais componentes existem (lido do projeto; nunca gravado aqui);
//   B. catálogo técnico — especificações declaradas (EV-015; referenciadas por catalogId + revisão);
//   C. planejamento     — etapas, kits, cargas, alocações (intenção do usuário);
//   D. execução         — quantidades e estados DECLARADOS como realizados (separação, carregamento, recebimento,
//                         progresso, retorno, ocorrências). Planejar não comprova execução; declarar não comprova
//                         fisicamente nada (sem autenticação, o "responsável" é apenas uma identificação informada).
//
// Esquema (versão 1):
// { version, planId, projectId, createdAt, updatedAt,
//   baseline: { id, revision, createdAt, projectId, projectRevision, hash, items: [ linha ], summary },
//   baselineHistory: [ { id, revision, createdAt, hash, totalUnits, note } ],
//   retiredLines: [ linha ]  — linhas de bases anteriores que deixaram o modelo mas têm registros (preservadas),
//   lines: { [lineId]: { classification, location, notes } },              // dados de planejamento por linha
//   stages: [ etapa ], kits: [ kit ], loads: [ carga ],
//   picking: { [lineId]: registro }, loading: { ['loadId|lineId']: registro },
//   receiving: { ['loadId|lineId']: registro }, returns: { [lineId]: registro },
//   incidents: [ ocorrência ], events: [ evento ],
//   settings: { weightUnit: 'kg', quantityUnit: 'un', responsible } }
// Linha da base: { lineId, key, code, name, catalogId, catalogRevision, category, unitWeight, packagedWeight,
//   packageDims, nominal, quantity, units: [uuid], unitAssemblies: { uuid: [assemblyId] }, linked }
// lineId é estável por chave lógica (ficha + revisão, ou tipo + dimensões para peças sem ficha) — nunca pela posição.

const LOGISTICS_VERSION = 1;

const STAGE_TYPES = [
	{ id: 'preparation', name: 'Preparação' },
	{ id: 'picking', name: 'Separação' },
	{ id: 'transport', name: 'Transporte' },
	{ id: 'receiving', name: 'Recebimento' },
	{ id: 'assembly', name: 'Montagem' },
	{ id: 'inspection', name: 'Conferência' },
	{ id: 'disassembly', name: 'Desmontagem' },
	{ id: 'return', name: 'Retorno' }
];

const STAGE_STATUSES = [
	{ id: 'todo', name: 'Não iniciada' },
	{ id: 'doing', name: 'Em andamento' },
	{ id: 'done', name: 'Concluída' },
	{ id: 'blocked', name: 'Bloqueada' },
	{ id: 'cancelled', name: 'Cancelada' }
];

const CLASSIFICATIONS = [
	{ id: 'undefined', name: 'Não definido' },
	{ id: 'returnable', name: 'Retornável' },
	{ id: 'consumable', name: 'Consumível' },
	{ id: 'disposable', name: 'Descartável' }
];

const INCIDENT_TYPES = [
	{ id: 'missing', name: 'Item faltante' },
	{ id: 'surplus', name: 'Item excedente' },
	{ id: 'damaged', name: 'Item avariado' },
	{ id: 'wrong', name: 'Item incorreto' },
	{ id: 'code', name: 'Divergência de código' },
	{ id: 'quantity', name: 'Divergência de quantidade' },
	{ id: 'record', name: 'Divergência de ficha' },
	{ id: 'other', name: 'Outro' }
];

const INCIDENT_STATUSES = [
	{ id: 'open', name: 'Aberta' },
	{ id: 'review', name: 'Em análise' },
	{ id: 'resolved', name: 'Resolvida' },
	{ id: 'dismissed', name: 'Descartada' }
];

const MANUAL_LABEL = 'Item logístico manual — não representado no modelo 3D';

const LIMITS = { text: 160, long: 1000, stages: 300, kits: 300, loads: 200, kitItems: 500, incidents: 2000, events: 20000, lines: 5000, units: 20000, quantity: 1e6, weight: 1e7, chars: 8 * 1024 * 1024 };

// ---------------------------------------------------------------------------------------------------------------

const stripControl = ( value ) => Array.from( value, ( c ) => ( c.charCodeAt( 0 ) < 32 && c !== '\n' ? ' ' : c ) ).join( '' );

function text( value, max = LIMITS.text, multiline = false ) {

	if ( typeof value !== 'string' ) return '';
	const clean = stripControl( value );
	return ( multiline ? clean.replace( /[ \t]+/g, ' ' ).replace( /\n{3,}/g, '\n\n' ) : clean.replace( /\s+/g, ' ' ) ).trim().slice( 0, max );

}

// quantidades de peças: inteiros não negativos
const count = ( value, max = LIMITS.quantity ) => ( Number.isInteger( value ) && value >= 0 && value <= max ? value : 0 );
const positiveOrNull = ( value, max ) => ( typeof value === 'number' && Number.isFinite( value ) && value > 0 && value <= max ? value : null );
const day = ( value ) => ( typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test( value ) && Number.isFinite( Date.parse( value + 'T00:00:00' ) ) ? value : null );
const iso = ( value ) => ( typeof value === 'string' && Number.isFinite( Date.parse( value ) ) ? new Date( Date.parse( value ) ).toISOString() : null );
const oneOf = ( value, list, fallback ) => ( list.some( ( x ) => x.id === value ) ? value : fallback );
const isId = ( value ) => typeof value === 'string' && /^[a-z]+-[A-Za-z0-9-]{6,80}$/.test( value );
const isUuid = ( value ) => typeof value === 'string' && value.length >= 8 && value.length <= 64 && /^[A-Za-z0-9-]+$/.test( value );

function newId( prefix ) {

	const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString( 16 ).slice( 2 ) + Date.now().toString( 16 );
	return `${prefix}-${random}`;

}

// identificador determinístico de linha a partir da chave lógica (estável entre atualizações da base)
function lineIdFor( key ) {

	let h1 = 0x811c9dc5, h2 = 0x9747b28c;
	for ( let i = 0; i < key.length; i ++ ) {

		const c = key.charCodeAt( i );
		h1 = Math.imul( h1 ^ c, 16777619 ) >>> 0;
		h2 = Math.imul( h2 ^ c, 2246822507 ) >>> 0;

	}

	return 'line-' + h1.toString( 16 ).padStart( 8, '0' ) + h2.toString( 16 ).padStart( 8, '0' );

}

const name = ( list, id ) => ( list.find( ( x ) => x.id === id ) || list[ 0 ] ).name;

// ---------------------------------------------------------------------------------------------------------------
// saneamento

function sanitizeLine( line ) {

	if ( line === null || typeof line !== 'object' || isId( line.lineId ) === false || typeof line.key !== 'string' ) return null;
	const units = Array.isArray( line.units ) ? [ ...new Set( line.units.filter( isUuid ) ) ].slice( 0, LIMITS.units ) : [];
	const unitAssemblies = {};
	if ( line.unitAssemblies && typeof line.unitAssemblies === 'object' ) for ( const u of units ) if ( Array.isArray( line.unitAssemblies[ u ] ) ) unitAssemblies[ u ] = line.unitAssemblies[ u ].filter( ( a ) => typeof a === 'string' ).slice( 0, 16 ).map( ( a ) => a.slice( 0, 80 ) );
	return {
		lineId: line.lineId,
		key: line.key.slice( 0, 300 ),
		code: text( line.code, 40 ),
		name: text( line.name, 160 ),
		catalogId: typeof line.catalogId === 'string' && /^part-/.test( line.catalogId ) ? line.catalogId.slice( 0, 90 ) : null,
		catalogRevision: Number.isInteger( line.catalogRevision ) && line.catalogRevision > 0 ? line.catalogRevision : null,
		category: text( line.category, 60 ),
		unitWeight: positiveOrNull( line.unitWeight, LIMITS.weight ),
		packagedWeight: positiveOrNull( line.packagedWeight, LIMITS.weight ),
		packageDims: Array.isArray( line.packageDims ) && line.packageDims.length === 3 && line.packageDims.every( ( v ) => positiveOrNull( v, 1000 ) !== null ) ? line.packageDims.slice() : null,
		nominal: text( line.nominal, 120 ),
		quantity: count( line.quantity ),
		units,
		unitAssemblies,
		linked: line.linked === true
	};

}

function sanitizeBaseline( baseline ) {

	if ( baseline === null || typeof baseline !== 'object' || isId( baseline.id ) === false ) return null;
	const items = Array.isArray( baseline.items ) ? baseline.items.slice( 0, LIMITS.lines ).map( sanitizeLine ).filter( Boolean ) : [];
	const s = baseline.summary || {};
	return {
		id: baseline.id,
		revision: Number.isInteger( baseline.revision ) && baseline.revision >= 1 ? baseline.revision : 1,
		createdAt: iso( baseline.createdAt ),
		projectId: typeof baseline.projectId === 'string' ? baseline.projectId.slice( 0, 80 ) : null,
		projectRevision: Number.isInteger( baseline.projectRevision ) ? baseline.projectRevision : null,
		hash: typeof baseline.hash === 'string' ? baseline.hash.slice( 0, 80 ) : '',
		items,
		summary: { totalUnits: count( s.totalUnits ), identified: count( s.identified ), knownWeight: typeof s.knownWeight === 'number' && s.knownWeight >= 0 ? s.knownWeight : 0, partial: s.partial === true, records: Array.isArray( s.records ) ? s.records.filter( ( r ) => typeof r === 'string' ).slice( 0, 2000 ) : [] }
	};

}

function sanitizeStage( stage, index ) {

	if ( stage === null || typeof stage !== 'object' || isId( stage.id ) === false ) return null;
	return {
		id: stage.id,
		number: Number.isInteger( stage.number ) && stage.number > 0 ? stage.number : index + 1,
		title: text( stage.title, 120 ) || `Etapa ${index + 1}`,
		description: text( stage.description, LIMITS.long, true ),
		type: oneOf( stage.type, STAGE_TYPES, 'assembly' ),
		plannedStart: day( stage.plannedStart ), plannedEnd: day( stage.plannedEnd ),
		actualStart: iso( stage.actualStart ), actualEnd: iso( stage.actualEnd ),
		responsible: text( stage.responsible, 80 ),
		status: oneOf( stage.status, STAGE_STATUSES, 'todo' ),
		assemblies: Array.isArray( stage.assemblies ) ? stage.assemblies.filter( isUuid ).slice( 0, 200 ) : [],
		units: Array.isArray( stage.units ) ? [ ...new Set( stage.units.filter( isUuid ) ) ].slice( 0, LIMITS.units ) : [],
		reuse: Array.isArray( stage.reuse ) ? stage.reuse.filter( isUuid ).slice( 0, LIMITS.units ) : [], // unidades em reutilização sequencial (não somam demanda)
		deps: Array.isArray( stage.deps ) ? [ ...new Set( stage.deps.filter( isId ) ) ].slice( 0, 50 ) : [],
		installed: count( stage.installed ),
		kitId: isId( stage.kitId ) ? stage.kitId : null,
		notes: text( stage.notes, LIMITS.long, true ),
		justification: text( stage.justification, 300 )
	};

}

function sanitizeKit( kit ) {

	if ( kit === null || typeof kit !== 'object' || isId( kit.id ) === false ) return null;
	const items = Array.isArray( kit.items ) ? kit.items.slice( 0, LIMITS.kitItems ).map( ( item ) => {

		if ( item === null || typeof item !== 'object' ) return null;
		if ( item.manual === true ) {

			const label = text( item.name, 120 );
			if ( label === '' ) return null;
			return { id: isId( item.id ) ? item.id : newId( 'manual' ), manual: true, name: label, quantity: count( item.quantity ), unitWeight: positiveOrNull( item.unitWeight, LIMITS.weight ), notes: text( item.notes, 300 ) };

		}

		if ( isId( item.lineId ) === false ) return null;
		return { lineId: item.lineId, quantity: count( item.quantity ), mode: item.mode === 'reuse' ? 'reuse' : 'exclusive', notes: text( item.notes, 300 ) };

	} ).filter( Boolean ) : [];
	return { id: kit.id, name: text( kit.name, 120 ) || 'Kit', description: text( kit.description, LIMITS.long, true ), stageId: isId( kit.stageId ) ? kit.stageId : null, packageId: text( kit.packageId, 60 ), notes: text( kit.notes, LIMITS.long, true ), items, returnKit: kit.returnKit === true };

}

function sanitizeLoad( load ) {

	if ( load === null || typeof load !== 'object' || isId( load.id ) === false ) return null;
	const v = load.vehicle || {};
	return {
		id: load.id,
		code: text( load.code, 60 ) || 'Carga',
		description: text( load.description, LIMITS.long, true ),
		date: day( load.date ),
		origin: text( load.origin, 160 ), destination: text( load.destination, 160 ),
		responsible: text( load.responsible, 80 ),
		vehicle: { name: text( v.name, 120 ), capacityKg: positiveOrNull( v.capacityKg, LIMITS.weight ), volumeM3: positiveOrNull( v.volumeM3, 1e4 ), notes: text( v.notes, 300 ) },
		kits: Array.isArray( load.kits ) ? [ ...new Set( load.kits.filter( isId ) ) ].slice( 0, 200 ) : [],
		items: Array.isArray( load.items ) ? load.items.filter( ( i ) => i && isId( i.lineId ) ).slice( 0, LIMITS.kitItems ).map( ( i ) => ( { lineId: i.lineId, quantity: count( i.quantity ), transfer: i.transfer === true } ) ) : [],
		notes: text( load.notes, LIMITS.long, true )
	};

}

// registro de execução (declaração): números inteiros + metadados
function sanitizeRecord( record, fields ) {

	if ( record === null || typeof record !== 'object' ) return null;
	const clean = { updatedAt: iso( record.updatedAt ), responsible: text( record.responsible, 80 ), notes: text( record.notes, 600, true ), rev: count( record.rev ) };
	for ( const f of fields ) clean[ f ] = count( record[ f ] );
	if ( record.closed === true ) clean.closed = true;
	if ( typeof record.location === 'string' ) clean.location = text( record.location, 120 );
	return clean;

}

const RECORD_FIELDS = {
	picking: [ 'picked', 'notFound', 'surplus' ],
	loading: [ 'loaded', 'surplus' ],
	receiving: [ 'received', 'damaged', 'surplus' ],
	returns: [ 'returned', 'damaged', 'discarded' ]
};

function sanitizeRecords( map, fields, keyTest ) {

	const out = {};
	if ( map === null || typeof map !== 'object' ) return out;
	for ( const [ key, value ] of Object.entries( map ).slice( 0, LIMITS.lines * 4 ) ) {

		if ( keyTest( key ) === false ) continue;
		const clean = sanitizeRecord( value, fields );
		if ( clean !== null ) out[ key ] = clean;

	}

	return out;

}

const lineKeyTest = ( key ) => isId( key );
const pairKeyTest = ( key ) => /^[a-z]+-[A-Za-z0-9-]{6,80}\|[a-z]+-[A-Za-z0-9-]{6,80}$/.test( key );

function sanitizeIncident( incident ) {

	if ( incident === null || typeof incident !== 'object' || isId( incident.id ) === false ) return null;
	const ref = incident.ref && typeof incident.ref === 'object' ? { kind: [ 'line', 'stage', 'unit', 'load', 'kit', 'check' ].includes( incident.ref.kind ) ? incident.ref.kind : 'line', id: typeof incident.ref.id === 'string' ? incident.ref.id.slice( 0, 120 ) : '' } : null;
	return {
		id: incident.id,
		type: oneOf( incident.type, INCIDENT_TYPES, 'other' ),
		date: iso( incident.date ) || new Date().toISOString(),
		ref,
		lineId: isId( incident.lineId ) ? incident.lineId : null,
		quantity: count( incident.quantity ),
		description: text( incident.description, LIMITS.long, true ),
		status: oneOf( incident.status, INCIDENT_STATUSES, 'open' ),
		notes: text( incident.notes, 600, true ),
		responsible: text( incident.responsible, 80 ),
		history: Array.isArray( incident.history ) ? incident.history.slice( 0, 200 ).map( ( h ) => ( { at: iso( h && h.at ) || new Date( 0 ).toISOString(), status: oneOf( h && h.status, INCIDENT_STATUSES, 'open' ), note: text( h && h.note, 300 ), responsible: text( h && h.responsible, 80 ) } ) ) : []
	};

}

function sanitizeEvent( event ) {

	if ( event === null || typeof event !== 'object' || isId( event.id ) === false ) return null;
	const short = ( v ) => ( v === null || v === undefined ? null : typeof v === 'number' || typeof v === 'boolean' ? v : text( String( v ), 200 ) );
	return { id: event.id, at: iso( event.at ) || new Date( 0 ).toISOString(), type: text( event.type, 60 ), ref: text( event.ref, 160 ), from: short( event.from ), to: short( event.to ), responsible: text( event.responsible, 80 ), note: text( event.note, 300 ) };

}

function emptyPlan() {

	return {
		version: LOGISTICS_VERSION, planId: null, projectId: null, createdAt: null, updatedAt: null,
		baseline: null, baselineHistory: [], retiredLines: [], lines: {}, stages: [], kits: [], loads: [],
		picking: {}, loading: {}, receiving: {}, returns: {}, incidents: [], events: [],
		settings: { weightUnit: 'kg', quantityUnit: 'un', responsible: '' }
	};

}

function sanitizePlan( raw ) {

	const plan = emptyPlan();
	if ( raw === null || raw === undefined || typeof raw !== 'object' ) return plan;
	plan.planId = isId( raw.planId ) ? raw.planId : null;
	plan.projectId = typeof raw.projectId === 'string' ? raw.projectId.slice( 0, 80 ) : null;
	plan.createdAt = iso( raw.createdAt );
	plan.updatedAt = iso( raw.updatedAt );
	plan.baseline = sanitizeBaseline( raw.baseline );
	plan.baselineHistory = Array.isArray( raw.baselineHistory ) ? raw.baselineHistory.slice( 0, 200 ).filter( ( b ) => b && isId( b.id ) ).map( ( b ) => ( { id: b.id, revision: count( b.revision ), createdAt: iso( b.createdAt ), hash: text( b.hash, 80 ), totalUnits: count( b.totalUnits ), note: text( b.note, 200 ) } ) ) : [];
	plan.retiredLines = Array.isArray( raw.retiredLines ) ? raw.retiredLines.slice( 0, LIMITS.lines ).map( sanitizeLine ).filter( Boolean ) : [];
	if ( raw.lines && typeof raw.lines === 'object' ) for ( const [ id, data ] of Object.entries( raw.lines ).slice( 0, LIMITS.lines * 2 ) ) {

		if ( isId( id ) && data && typeof data === 'object' ) plan.lines[ id ] = { classification: oneOf( data.classification, CLASSIFICATIONS, 'undefined' ), location: text( data.location, 120 ), notes: text( data.notes, 600, true ) };

	}

	plan.stages = Array.isArray( raw.stages ) ? raw.stages.slice( 0, LIMITS.stages ).map( sanitizeStage ).filter( Boolean ) : [];
	plan.kits = Array.isArray( raw.kits ) ? raw.kits.slice( 0, LIMITS.kits ).map( sanitizeKit ).filter( Boolean ) : [];
	plan.loads = Array.isArray( raw.loads ) ? raw.loads.slice( 0, LIMITS.loads ).map( sanitizeLoad ).filter( Boolean ) : [];
	plan.picking = sanitizeRecords( raw.picking, RECORD_FIELDS.picking, lineKeyTest );
	plan.loading = sanitizeRecords( raw.loading, RECORD_FIELDS.loading, pairKeyTest );
	plan.receiving = sanitizeRecords( raw.receiving, RECORD_FIELDS.receiving, pairKeyTest );
	plan.returns = sanitizeRecords( raw.returns, RECORD_FIELDS.returns, lineKeyTest );
	plan.incidents = Array.isArray( raw.incidents ) ? raw.incidents.slice( 0, LIMITS.incidents ).map( sanitizeIncident ).filter( Boolean ) : [];
	plan.events = Array.isArray( raw.events ) ? raw.events.slice( 0, LIMITS.events ).map( sanitizeEvent ).filter( Boolean ) : [];
	const s = raw.settings || {};
	plan.settings = { weightUnit: 'kg', quantityUnit: 'un', responsible: text( s.responsible, 80 ) };
	// ids únicos
	const unique = ( list ) => {

		const seen = new Set();
		return list.filter( ( x ) => ( seen.has( x.id ) ? false : seen.add( x.id ) ) );

	};

	plan.stages = unique( plan.stages );
	plan.kits = unique( plan.kits );
	plan.loads = unique( plan.loads );
	plan.incidents = unique( plan.incidents );
	plan.events = unique( plan.events );
	return plan;

}

// ---------------------------------------------------------------------------------------------------------------
// leitura/gravação no projeto (somente a chave "logistics"; os demais metadados ficam intactos)

function hasPlan( scene ) {

	const meta = scene.userData.project3ds;
	return meta !== undefined && meta !== null && meta.logistics !== undefined && meta.logistics !== null;

}

function getPlan( scene ) {

	const meta = scene.userData.project3ds;
	return sanitizePlan( meta !== undefined && meta !== null ? meta.logistics : null );

}

function setPlan( scene, plan ) {

	const meta = Object.assign( {}, scene.userData.project3ds );
	if ( plan === null || plan.planId === null ) delete meta.logistics;
	else meta.logistics = JSON.parse( JSON.stringify( plan ) );
	if ( Object.keys( meta ).length > 0 ) scene.userData.project3ds = meta;
	else delete scene.userData.project3ds;

}

function planSize( plan ) {

	return JSON.stringify( plan ).length;

}

// formatação --------------------------------------------------------------------------------------------------------

const kg = ( value ) => ( value === null || value === undefined ? 'Não informado' : value.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) + ' kg' );
const brDate = ( value ) => ( value ? value.slice( 0, 10 ).split( '-' ).reverse().join( '/' ) : '' );
const brDateTime = ( value ) => ( value ? new Date( value ).toLocaleString( 'pt-BR', { dateStyle: 'short', timeStyle: 'short' } ) : '' );
function todayLocal() {

	const d = new Date();
	return `${d.getFullYear()}-${String( d.getMonth() + 1 ).padStart( 2, '0' )}-${String( d.getDate() ).padStart( 2, '0' )}`;

}

export {
	LOGISTICS_VERSION, LIMITS as LOGISTICS_LIMITS, STAGE_TYPES, STAGE_STATUSES, CLASSIFICATIONS, INCIDENT_TYPES, INCIDENT_STATUSES, MANUAL_LABEL, RECORD_FIELDS,
	text as cleanText, count as cleanCount, positiveOrNull, day as cleanDay, isId, isUuid, newId, lineIdFor, name as labelOf,
	emptyPlan, sanitizePlan, sanitizeLine, sanitizeStage, sanitizeKit, sanitizeLoad, sanitizeRecord, sanitizeIncident, sanitizeEvent, sanitizeBaseline,
	hasPlan, getPlan, setPlan, planSize, kg, brDate, brDateTime, todayLocal
};
