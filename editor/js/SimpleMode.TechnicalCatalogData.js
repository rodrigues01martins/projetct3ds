// EV-015 — Sistema de Catálogo Técnico de Peças e Sistemas Modulares 3D
//
// Esquema, validação e revisões das fichas técnicas. Princípio: GEOMETRIA NÃO É ESPECIFICAÇÃO TÉCNICA.
//   A. geometria — derivada do modelo 3D (nunca gravada aqui; medida na hora pelo TechnicalPartLinks);
//   B. especificação declarada — informada pelo usuário (peso, material, fabricante, dimensões nominais…);
//   C. sustentação documental — referência a documento de origem (fonte, identificador, revisão, data).
// Nenhum campo é preenchido com valor fictício: ausente = null / '' ("Não informado"). Nenhum estado de validação
// equivale a certificação, homologação, aprovação de engenharia ou garantia de segurança.
//
// Registro de uma revisão da ficha (imutável depois de gravado):
//   { format: 'project3ds-technical-part', formatVersion: 1, catalogId, revision, code, name, category, description,
//     keywords: [], manufacturer: { name, brand, model, manufacturerCode, commercialRef, url },
//     dimensions: { unit, width, height, depth, length, thickness, tolerance: { absolute, relative } } (metros; % ),
//     material: { primary, secondary, finish, color, notes },
//     physical: { weight, packagedWeight, packageDims: [w,h,d] | null, weightSource, weightDate } (kg; metros),
//     connectors: [ { id, name, family, standard, code, nominalSize, variant, restrictions, geometric } ],
//     references: { source, documentId, documentRevision, date, url, notes },
//     control: { validation, createdAt, updatedAt, revisionNote, changedFields: [] } }
//
// Vínculo na instância (raiz lógica do componente; não toca component/importedAsset/assembly/connectors/openings/
// appearance): userData.project3ds.technicalPart = { version: 1, catalogId, catalogRevision, code }
//
// Snapshot do projeto (autossuficiência): scene.userData.project3ds.technicalCatalog =
//   { version: 1, parts: { '<catalogId>@<revision>': registro }, rules: { '<ruleId>': regra } }
// Só as revisões efetivamente usadas entram; a revisão gravada no projeto NUNCA é trocada silenciosamente.

const PART_FORMAT = 'project3ds-technical-part';
const PART_VERSION = 1;
const LINK_VERSION = 1;
const SNAPSHOT_VERSION = 1;

const TECHNICAL_CATEGORIES = [
	{ id: 'structures', name: 'Estruturas' },
	{ id: 'profiles', name: 'Perfis' },
	{ id: 'panels', name: 'Painéis' },
	{ id: 'platforms', name: 'Plataformas' },
	{ id: 'connectors', name: 'Conectores' },
	{ id: 'fasteners', name: 'Fixadores' },
	{ id: 'furniture', name: 'Mobiliário' },
	{ id: 'equipment', name: 'Equipamentos' },
	{ id: 'architectural', name: 'Elementos Arquitetônicos' },
	{ id: 'others', name: 'Outros' }
];

// valores de CLASSIFICAÇÃO apenas — nenhuma propriedade mecânica é associada a eles
const TECHNICAL_MATERIALS = [ 'Alumínio', 'Aço', 'Madeira', 'MDF', 'Vidro', 'Plástico', 'Material composto', 'Outro' ];

const VALIDATION_STATES = [
	{ id: 'draft', name: 'Rascunho', hint: 'Informações incompletas.' },
	{ id: 'filled', name: 'Preenchida', hint: 'Campos mínimos informados.' },
	{ id: 'checked', name: 'Conferida pelo usuário', hint: 'O usuário declarou ter conferido os dados.' },
	{ id: 'documented', name: 'Referenciada documentalmente', hint: 'Existe referência identificável a documento de origem.' }
];

const DISCLAIMER = 'Nenhum estado da ficha equivale a certificação, homologação, aprovação de engenharia, conformidade normativa ou garantia de segurança.';

const DIMENSION_KEYS = [ 'width', 'height', 'depth', 'length', 'thickness' ];
const DIMENSION_LABELS = { width: 'Largura', height: 'Altura', depth: 'Profundidade', length: 'Comprimento', thickness: 'Espessura' };
const DISPLAY_UNITS = { mm: 1000, cm: 100, m: 1 };

// campos cuja alteração muda a especificação técnica (a atualização de associações nunca é automática)
const TECHNICAL_FIELDS = [ 'code', 'dimensions', 'physical', 'material', 'connectors', 'manufacturer' ];
const FIELD_LABELS = { code: 'código', name: 'nome', category: 'categoria', description: 'descrição', keywords: 'palavras-chave', manufacturer: 'fabricante', dimensions: 'dimensões', material: 'material', physical: 'peso/dados físicos', connectors: 'conectores', references: 'referências', validation: 'estado de validação' };

const LIMITS = { code: 40, name: 120, text: 160, description: 1000, notes: 600, keywords: 20, keyword: 40, url: 300, connectors: 32, maxLength: 1000, maxWeight: 1e6, maxRelative: 100, parts: 5000, rules: 2000, revisions: 200 };

// ---------------------------------------------------------------------------------------------------------------
// utilitários de saneamento

const stripControl = ( value ) => Array.from( value, ( c ) => ( c.charCodeAt( 0 ) < 32 && c !== '\n' ? ' ' : c ) ).join( '' );

function cleanText( value, max = LIMITS.text, multiline = false ) {

	if ( typeof value !== 'string' ) return '';
	let clean = stripControl( value );
	clean = multiline ? clean.replace( /[ \t]+/g, ' ' ).replace( /\n{3,}/g, '\n\n' ) : clean.replace( /\s+/g, ' ' );
	return clean.trim().slice( 0, max );

}

// número positivo finito dentro do limite; qualquer outra coisa é "não informado" (null) — nunca zero implícito
function positive( value, max, allowZero = false ) {

	if ( typeof value !== 'number' || Number.isFinite( value ) === false ) return null;
	if ( value < 0 || ( value === 0 && allowZero === false ) || value > max ) return null;
	return value;

}

const date = ( value ) => ( typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test( value ) && Number.isFinite( Date.parse( value ) ) ? value : null );
const iso = ( value ) => ( typeof value === 'string' && Number.isFinite( Date.parse( value ) ) ? new Date( Date.parse( value ) ).toISOString() : null );

// URL apenas informativa: http(s), sem credenciais; nunca carregada pelo aplicativo
function cleanUrl( value ) {

	const textValue = cleanText( value, LIMITS.url );
	if ( textValue === '' ) return '';
	try {

		const url = new URL( textValue );
		if ( ( url.protocol === 'http:' || url.protocol === 'https:' ) && url.username === '' && url.password === '' ) return url.href.slice( 0, LIMITS.url );

	} catch ( error ) { /* inválida */ }

	return '';

}

// código técnico: letras, números e . _ - / (sem espaços nas pontas); comparação sem diferenciar maiúsculas
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,39}$/;

function cleanCode( value ) {

	const code = cleanText( value, LIMITS.code );
	return CODE_PATTERN.test( code ) ? code : '';

}

const codeKey = ( code ) => cleanText( code, LIMITS.code ).toLocaleUpperCase( 'pt-BR' );

// família técnica de conector (ex.: perfil-modular-40); 'generic' nunca prova compatibilidade técnica
function cleanFamily( value ) {

	return cleanText( value, 60 ).toLowerCase().replace( /[^a-z0-9._\-/ ]/g, '' ).replace( /\s+/g, '-' );

}

function newId( prefix = 'part' ) {

	const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString( 16 ).slice( 2 ) + Date.now().toString( 16 );
	return `${prefix}-${random}`;

}

const isId = ( value ) => typeof value === 'string' && /^[a-z]+-[A-Za-z0-9-]{8,80}$/.test( value );

// ---------------------------------------------------------------------------------------------------------------
// ficha

function emptyPart() {

	return {
		format: PART_FORMAT, formatVersion: PART_VERSION, catalogId: null, revision: 0,
		code: '', name: '', category: 'others', description: '', keywords: [],
		manufacturer: { name: '', brand: '', model: '', manufacturerCode: '', commercialRef: '', url: '' },
		dimensions: { unit: 'mm', width: null, height: null, depth: null, length: null, thickness: null, tolerance: { absolute: null, relative: null } },
		material: { primary: '', secondary: '', finish: '', color: '', notes: '' },
		physical: { weight: null, packagedWeight: null, packageDims: null, weightSource: '', weightDate: null },
		connectors: [],
		references: { source: '', documentId: '', documentRevision: '', date: null, url: '', notes: '' },
		control: { validation: 'draft', createdAt: null, updatedAt: null, revisionNote: '', changedFields: [] }
	};

}

function sanitizeConnector( connector, index ) {

	if ( connector === null || typeof connector !== 'object' ) return null;
	const family = cleanFamily( connector.family );
	const name = cleanText( connector.name, 60 );
	if ( family === '' && name === '' ) return null;
	return {
		id: typeof connector.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test( connector.id ) ? connector.id : `c${index + 1}`,
		name: name || `Conector ${index + 1}`,
		family,
		standard: cleanText( connector.standard, 80 ),
		code: cleanText( connector.code, 40 ),
		nominalSize: positive( connector.nominalSize, LIMITS.maxLength ),
		variant: cleanText( connector.variant, 40 ),
		restrictions: cleanText( connector.restrictions, 300 ),
		geometric: cleanText( connector.geometric, 60 ) // conector geométrico da EV-014 (id ou nome) que esta interface descreve
	};

}

// saneia uma ficha inteira (importação, formulário, armazenamento). Lança erro quando o mínimo não é atendido.
function sanitizePart( input, { requireIdentity = true } = {} ) {

	if ( input === null || typeof input !== 'object' || Array.isArray( input ) ) throw new TechnicalError( 'Ficha técnica inválida.' );
	const m = input.manufacturer || {}, d = input.dimensions || {}, tol = d.tolerance || {}, mat = input.material || {}, ph = input.physical || {}, ref = input.references || {}, ctl = input.control || {};

	const part = {
		format: PART_FORMAT,
		formatVersion: PART_VERSION,
		catalogId: isId( input.catalogId ) ? input.catalogId : null,
		revision: Number.isInteger( input.revision ) && input.revision >= 1 && input.revision <= 1e6 ? input.revision : 0,
		code: cleanCode( input.code ),
		name: cleanText( input.name, LIMITS.name ),
		category: TECHNICAL_CATEGORIES.some( ( c ) => c.id === input.category ) ? input.category : 'others',
		description: cleanText( input.description, LIMITS.description, true ),
		keywords: Array.isArray( input.keywords ) ? [ ...new Set( input.keywords.map( ( k ) => cleanText( k, LIMITS.keyword ).toLowerCase() ).filter( Boolean ) ) ].slice( 0, LIMITS.keywords ) : [],
		manufacturer: {
			name: cleanText( m.name, 100 ), brand: cleanText( m.brand, 100 ), model: cleanText( m.model, 100 ),
			manufacturerCode: cleanText( m.manufacturerCode, 60 ), commercialRef: cleanText( m.commercialRef, 100 ), url: cleanUrl( m.url )
		},
		dimensions: {
			unit: DISPLAY_UNITS[ d.unit ] !== undefined ? d.unit : 'mm',
			width: positive( d.width, LIMITS.maxLength ), height: positive( d.height, LIMITS.maxLength ), depth: positive( d.depth, LIMITS.maxLength ),
			length: positive( d.length, LIMITS.maxLength ), thickness: positive( d.thickness, LIMITS.maxLength ),
			tolerance: { absolute: positive( tol.absolute, 10, true ), relative: positive( tol.relative, LIMITS.maxRelative, true ) }
		},
		material: { primary: cleanText( mat.primary, 60 ), secondary: cleanText( mat.secondary, 60 ), finish: cleanText( mat.finish, 80 ), color: cleanText( mat.color, 60 ), notes: cleanText( mat.notes, LIMITS.notes, true ) },
		physical: {
			weight: positive( ph.weight, LIMITS.maxWeight ),
			packagedWeight: positive( ph.packagedWeight, LIMITS.maxWeight ),
			packageDims: Array.isArray( ph.packageDims ) && ph.packageDims.length === 3 && ph.packageDims.every( ( v ) => positive( v, LIMITS.maxLength ) !== null ) ? ph.packageDims.slice() : null,
			weightSource: cleanText( ph.weightSource, 160 ),
			weightDate: date( ph.weightDate )
		},
		connectors: Array.isArray( input.connectors ) ? input.connectors.slice( 0, LIMITS.connectors ).map( sanitizeConnector ).filter( Boolean ) : [],
		references: { source: cleanText( ref.source, 200 ), documentId: cleanText( ref.documentId, 100 ), documentRevision: cleanText( ref.documentRevision, 40 ), date: date( ref.date ), url: cleanUrl( ref.url ), notes: cleanText( ref.notes, LIMITS.notes, true ) },
		control: { validation: 'draft', createdAt: iso( ctl.createdAt ), updatedAt: iso( ctl.updatedAt ), revisionNote: cleanText( ctl.revisionNote, 200 ), changedFields: Array.isArray( ctl.changedFields ) ? ctl.changedFields.filter( ( f ) => FIELD_LABELS[ f ] !== undefined ) : [] }
	};

	// ids únicos de conectores
	const seen = new Set();
	part.connectors.forEach( ( c, i ) => {

		while ( seen.has( c.id ) ) c.id = `c${i + 1}-${seen.size}`;
		seen.add( c.id );

	} );

	if ( requireIdentity ) {

		if ( part.code === '' ) throw new TechnicalError( typeof input.code === 'string' && input.code.trim() !== '' ? 'Código técnico inválido: use letras, números e . _ - / (até 40 caracteres).' : 'Informe o código técnico da peça.' );
		if ( part.name === '' ) throw new TechnicalError( 'Informe o nome da peça.' );

	}

	part.control.validation = coerceValidation( part, ctl.validation );
	return part;

}

// campos mínimos: código, nome e categoria
function isComplete( part ) {

	return part.code !== '' && part.name !== '' && TECHNICAL_CATEGORIES.some( ( c ) => c.id === part.category );

}

function hasDocument( part ) {

	return part.references.documentId !== '' || part.references.source !== '';

}

// o estado declarado não pode afirmar mais do que os dados sustentam
function coerceValidation( part, requested ) {

	const state = VALIDATION_STATES.some( ( s ) => s.id === requested ) ? requested : 'draft';
	if ( isComplete( part ) === false ) return 'draft';
	if ( state === 'documented' && hasDocument( part ) === false ) return 'checked';
	return state;

}

function validationProblem( part, requested ) {

	if ( requested !== 'draft' && isComplete( part ) === false ) return 'Uma ficha incompleta só pode ficar como Rascunho.';
	if ( requested === 'documented' && hasDocument( part ) === false ) return '"Referenciada documentalmente" exige a fonte ou o identificador do documento de origem (Seção F).';
	return null;

}

// pendências cadastrais (não são erros de engenharia — são informações faltantes)
function pendingFields( part, { requireManufacturer = false } = {} ) {

	const pending = [];
	if ( isComplete( part ) === false ) pending.push( 'campos mínimos (código, nome, categoria)' );
	if ( DIMENSION_KEYS.every( ( k ) => part.dimensions[ k ] === null ) ) pending.push( 'dimensões nominais' );
	if ( part.physical.weight === null ) pending.push( 'peso unitário' );
	if ( part.material.primary === '' ) pending.push( 'material principal' );
	if ( requireManufacturer && part.manufacturer.name === '' ) pending.push( 'fabricante' );
	return pending;

}

// diferenças relevantes entre duas revisões (para o registro e para a decisão de atualização)
function changedFields( previous, next ) {

	const keys = [ 'code', 'name', 'category', 'description', 'keywords', 'manufacturer', 'dimensions', 'material', 'physical', 'connectors', 'references' ];
	const changed = keys.filter( ( key ) => JSON.stringify( previous[ key ] ) !== JSON.stringify( next[ key ] ) );
	if ( previous.control.validation !== next.control.validation ) changed.push( 'validation' );
	return changed;

}

const isTechnicalChange = ( fields ) => fields.some( ( f ) => TECHNICAL_FIELDS.includes( f ) );

const revisionKey = ( catalogId, revision ) => `${catalogId}@${revision}`;

const categoryName = ( id ) => ( TECHNICAL_CATEGORIES.find( ( c ) => c.id === id ) || TECHNICAL_CATEGORIES[ TECHNICAL_CATEGORIES.length - 1 ] ).name;
const validationName = ( id ) => ( VALIDATION_STATES.find( ( s ) => s.id === id ) || VALIDATION_STATES[ 0 ] ).name;

// texto de pesquisa (código, nome, categoria, fabricante, modelo, material, palavras-chave)
function searchText( part ) {

	return [ part.code, part.name, categoryName( part.category ), part.manufacturer.name, part.manufacturer.brand, part.manufacturer.model, part.manufacturer.manufacturerCode, part.material.primary, part.material.secondary, ...part.keywords ].join( ' ' ).toLocaleLowerCase( 'pt-BR' ).normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' );

}

function normalizeQuery( query ) {

	return String( query || '' ).toLocaleLowerCase( 'pt-BR' ).normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).trim();

}

// ---------------------------------------------------------------------------------------------------------------
// regras de compatibilidade (direcionais por padrão quando assim declaradas; nada é inferido por transitividade)

const RULE_RESULTS = [
	{ id: 'compatible', name: 'Compatibilidade declarada' },
	{ id: 'incompatible', name: 'Incompatibilidade declarada' }
];

function sanitizeRule( rule ) {

	if ( rule === null || typeof rule !== 'object' ) throw new TechnicalError( 'Regra de compatibilidade inválida.' );
	const familyA = cleanFamily( rule.familyA ), familyB = cleanFamily( rule.familyB );
	if ( familyA === '' || familyB === '' ) throw new TechnicalError( 'Informe as duas famílias técnicas da regra.' );
	if ( familyA === 'generic' || familyB === 'generic' ) throw new TechnicalError( 'A família "generic" é apenas geométrica e não pode receber regra técnica de compatibilidade.' );
	if ( RULE_RESULTS.some( ( r ) => r.id === rule.result ) === false ) throw new TechnicalError( 'Resultado da regra inválido.' );
	return {
		id: isId( rule.id ) ? rule.id : newId( 'rule' ),
		familyA, familyB,
		result: rule.result,
		directional: rule.directional === true,
		note: cleanText( rule.note, 300 ),
		source: cleanText( rule.source, 200 ),
		revision: Number.isInteger( rule.revision ) && rule.revision >= 1 ? rule.revision : 1,
		updatedAt: iso( rule.updatedAt ) || new Date().toISOString()
	};

}

// ---------------------------------------------------------------------------------------------------------------
// vínculo na instância

function getTechnicalLink( object ) {

	const meta = object && object.userData ? object.userData.project3ds : undefined;
	const link = meta !== undefined && meta !== null ? meta.technicalPart : undefined;
	if ( link === undefined || link === null || typeof link !== 'object' || isId( link.catalogId ) === false || Number.isInteger( link.catalogRevision ) === false ) return null;
	return { version: LINK_VERSION, catalogId: link.catalogId, catalogRevision: link.catalogRevision, code: cleanCode( link.code ) };

}

function makeLink( record ) {

	return { version: LINK_VERSION, catalogId: record.catalogId, catalogRevision: record.revision, code: record.code };

}

// ---------------------------------------------------------------------------------------------------------------
// snapshot do projeto

function getSnapshot( scene ) {

	const meta = scene.userData.project3ds;
	const raw = meta !== undefined && meta !== null ? meta.technicalCatalog : undefined;
	const snapshot = { version: SNAPSHOT_VERSION, parts: {}, rules: {} };
	if ( raw === undefined || raw === null || typeof raw !== 'object' ) return snapshot;
	for ( const [ key, record ] of Object.entries( raw.parts || {} ).slice( 0, LIMITS.parts ) ) {

		try {

			const part = sanitizePart( record );
			if ( part.catalogId !== null && part.revision >= 1 && key === revisionKey( part.catalogId, part.revision ) ) snapshot.parts[ key ] = part;

		} catch ( error ) { /* registro inválido ignorado */ }

	}

	for ( const [ id, rule ] of Object.entries( raw.rules || {} ).slice( 0, LIMITS.rules ) ) {

		try {

			const clean = sanitizeRule( rule );
			if ( clean.id === id ) snapshot.rules[ id ] = clean;

		} catch ( error ) { /* ignorada */ }

	}

	return snapshot;

}

function hasSnapshot( scene ) {

	const meta = scene.userData.project3ds;
	return meta !== undefined && meta !== null && meta.technicalCatalog !== undefined;

}

// grava (cópia); sem fichas nem regras a chave é removida (projetos antigos continuam idênticos)
function setSnapshot( scene, snapshot ) {

	const meta = Object.assign( {}, scene.userData.project3ds );
	if ( snapshot === null || ( Object.keys( snapshot.parts ).length === 0 && Object.keys( snapshot.rules ).length === 0 ) ) delete meta.technicalCatalog;
	else meta.technicalCatalog = JSON.parse( JSON.stringify( { version: SNAPSHOT_VERSION, parts: snapshot.parts, rules: snapshot.rules } ) );
	if ( Object.keys( meta ).length > 0 ) scene.userData.project3ds = meta;
	else delete scene.userData.project3ds;

}

// registros vistos nesta sessão (definições de conjuntos inseridas, pacotes importados): permitem completar o
// snapshot quando o catálogo local não tem a revisão
const remembered = new Map();
let localResolver = null; // ( catalogId, revision ) => registro | null (catálogo local carregado)

function rememberRecords( records ) {

	for ( const record of records || [] ) {

		try {

			const part = sanitizePart( record );
			if ( part.catalogId !== null && part.revision >= 1 && remembered.has( revisionKey( part.catalogId, part.revision ) ) === false ) remembered.set( revisionKey( part.catalogId, part.revision ), part );

		} catch ( error ) { /* ignorado */ }

	}

}

function setLocalResolver( resolver ) {

	localResolver = resolver;

}

// registro da revisão usada por um vínculo: projeto → sessão → catálogo local
function resolveRecord( scene, catalogId, revision, snapshot = null ) {

	const key = revisionKey( catalogId, revision );
	const snap = snapshot !== null ? snapshot : getSnapshot( scene );
	if ( snap.parts[ key ] !== undefined ) return { record: snap.parts[ key ], origin: 'project' };
	if ( remembered.has( key ) ) return { record: remembered.get( key ), origin: 'session' };
	const local = localResolver !== null ? localResolver( catalogId, revision ) : null;
	if ( local !== null && local !== undefined ) return { record: local, origin: 'local' };
	return { record: null, origin: 'missing' };

}

// acrescenta ao snapshot as revisões usadas que ainda não estão nele (sessão/catálogo local); nunca substitui nem
// remove (desfazer uma exclusão continua encontrando os dados do projeto). Retorna true se acrescentou algo.
function completeSnapshot( scene ) {

	const missing = [];
	let snapshot = null;
	scene.traverse( ( object ) => {

		const link = getTechnicalLink( object );
		if ( link === null ) return;
		if ( snapshot === null ) snapshot = getSnapshot( scene );
		const key = revisionKey( link.catalogId, link.catalogRevision );
		if ( snapshot.parts[ key ] !== undefined || missing.some( ( r ) => revisionKey( r.catalogId, r.revision ) === key ) ) return;
		const { record } = resolveRecord( scene, link.catalogId, link.catalogRevision, snapshot );
		if ( record !== null ) missing.push( record );

	} );
	if ( missing.length === 0 ) return false;
	for ( const record of missing ) snapshot.parts[ revisionKey( record.catalogId, record.revision ) ] = record;
	setSnapshot( scene, snapshot );
	return true;

}

// fichas e regras usadas numa subárvore (para definições de conjunto e pacotes): somente o necessário
function technicalForSubtree( root, scene, rules = null ) {

	const parts = {};
	const snapshot = getSnapshot( scene );
	root.traverse( ( object ) => {

		const link = getTechnicalLink( object );
		if ( link === null ) return;
		const { record } = resolveRecord( scene, link.catalogId, link.catalogRevision, snapshot );
		if ( record !== null ) parts[ revisionKey( record.catalogId, record.revision ) ] = record;

	} );

	const families = new Set();
	for ( const part of Object.values( parts ) ) for ( const c of part.connectors ) if ( c.family !== '' ) families.add( c.family );
	const allRules = Object.values( snapshot.rules ).concat( rules || [] );
	const used = {};
	for ( const rule of allRules ) if ( families.has( rule.familyA ) && families.has( rule.familyB ) && used[ rule.id ] === undefined ) used[ rule.id ] = rule;
	return { parts: Object.values( parts ), rules: Object.values( used ) };

}

class TechnicalError extends Error {

	constructor( message, details = [] ) {

		super( message );
		this.name = 'TechnicalError';
		this.details = details;

	}

}

// formatação --------------------------------------------------------------------------------------------------------

function formatWeight( kg ) {

	if ( kg === null || kg === undefined ) return 'Não informado';
	return kg.toLocaleString( 'pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 } ) + ' kg';

}

// dimensão nominal na unidade declarada da ficha (metros → mm/cm/m)
function formatNominal( meters, unit = 'mm' ) {

	if ( meters === null || meters === undefined ) return 'Não informado';
	const factor = DISPLAY_UNITS[ unit ] || 1000;
	return ( meters * factor ).toLocaleString( 'pt-BR', { maximumFractionDigits: unit === 'm' ? 4 : unit === 'cm' ? 2 : 1, useGrouping: false } ) + ' ' + unit;

}

function nominalSummary( part ) {

	const d = part.dimensions;
	const main = [ d.width, d.height, d.depth ];
	const parts = [];
	if ( main.some( ( v ) => v !== null ) ) parts.push( main.map( ( v ) => ( v === null ? '—' : formatNominal( v, d.unit ).replace( ' ' + d.unit, '' ) ) ).join( ' × ' ) + ' ' + d.unit );
	if ( d.length !== null ) parts.push( 'C ' + formatNominal( d.length, d.unit ) );
	if ( d.thickness !== null ) parts.push( 'esp. ' + formatNominal( d.thickness, d.unit ) );
	return parts.length > 0 ? parts.join( ' · ' ) : 'Não informado';

}

export {
	PART_FORMAT, PART_VERSION, LINK_VERSION, SNAPSHOT_VERSION, LIMITS as TECHNICAL_LIMITS,
	TECHNICAL_CATEGORIES, TECHNICAL_MATERIALS, VALIDATION_STATES, DISCLAIMER, DIMENSION_KEYS, DIMENSION_LABELS, DISPLAY_UNITS,
	TECHNICAL_FIELDS, FIELD_LABELS, RULE_RESULTS,
	TechnicalError, cleanText, cleanCode, codeKey, cleanFamily, cleanUrl, newId, isId,
	emptyPart, sanitizePart, sanitizeRule, isComplete, hasDocument, coerceValidation, validationProblem, pendingFields,
	changedFields, isTechnicalChange, revisionKey, categoryName, validationName, searchText, normalizeQuery,
	getTechnicalLink, makeLink, getSnapshot, hasSnapshot, setSnapshot, rememberRecords, setLocalResolver, resolveRecord, technicalForSubtree, completeSnapshot,
	formatWeight, formatNominal, nominalSummary
};
