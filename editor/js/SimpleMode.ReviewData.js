// EV-012 — Sistema de Compartilhamento, Visualização e Revisão Colaborativa de Projetos 3D
//
// Dados puros das revisões (sem DOM, sem Three.js, sem acesso ao editor): usados pelo editor do proprietário E pelo
// visualizador do destinatário. Toda entrada vinda de arquivo é tratada como NÃO CONFIÁVEL: é reconstruída campo a
// campo a partir de uma lista explícita do que é aceito (nada é copiado "por inteiro").
//
// Arquivo de revisão (.p3ds-feedback.json), produzido pelo visualizador:
//   { format: 'project3ds-review-feedback', formatVersion: 1, reviewId, shareId, snapshotHash,
//     source: { projectId, revision }, projectTitle, reviewer: { name }, createdAt, comments: [ COMENTÁRIO ] }
//
// COMENTÁRIO:
//   { id, author, text, createdAt,
//     anchor: { kind: 'project' }
//           | { kind: 'object', objectUuid, objectName, objectLabel }
//           | { kind: 'object-point', objectUuid, objectName, objectLabel, localPosition: [x,y,z], worldPosition: [x,y,z] },
//     camera: { projection, position, quaternion, target, fov | frustumHeight + zoom } | null,
//     viewName, replies: [ { id, author, text, createdAt } ] }
//
// No projeto do proprietário (scene.userData.project3ds.reviews — acompanha o JSON do projeto, as versões, os backups
// e as cópias da EV-011; alterações só por SetProjectReviewsCommand, com Desfazer/Refazer):
//   { version: 1, comments: [ COMENTÁRIO + { status, source: { reviewId, shareId, revision, snapshotHash, importedAt },
//                                            stale, conflictOf } ],
//     imports: [ { reviewId, shareId, reviewer, importedAt, revision, comments } ] }
//
// Os nomes informados (autor/revisor) são identificação DECLARADA, não identidade verificada.

const FEEDBACK_FORMAT = 'project3ds-review-feedback';
const FEEDBACK_VERSION = 1;
const REVIEWS_VERSION = 1;

const LIMITS = {
	fileBytes: 5 * 1024 * 1024,
	comments: 500,
	ownerComments: 1000,
	replies: 50,
	imports: 200,
	text: 2000,
	name: 80,
	objectName: 120,
	label: 60,
	coordinate: 1e6
};

const STATUSES = [ 'open', 'analysis', 'resolved', 'discarded' ];
const STATUS_LABELS = { open: 'Aberto', analysis: 'Em análise', resolved: 'Resolvido', discarded: 'Descartado' };
const ANCHOR_KINDS = [ 'project', 'object', 'object-point' ];

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function newId() {

	const crypto = globalThis.crypto;
	if ( crypto !== undefined && typeof crypto.randomUUID === 'function' ) return crypto.randomUUID();

	// alternativa (contextos sem randomUUID): 128 bits aleatórios no formato UUID v4
	const bytes = new Uint8Array( 16 );
	if ( crypto !== undefined && typeof crypto.getRandomValues === 'function' ) crypto.getRandomValues( bytes );
	else for ( let i = 0; i < 16; i ++ ) bytes[ i ] = Math.floor( Math.random() * 256 );
	bytes[ 6 ] = ( bytes[ 6 ] & 0x0f ) | 0x40;
	bytes[ 8 ] = ( bytes[ 8 ] & 0x3f ) | 0x80;
	const hex = Array.from( bytes, ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	return `${hex.slice( 0, 8 )}-${hex.slice( 8, 12 )}-${hex.slice( 12, 16 )}-${hex.slice( 16, 20 )}-${hex.slice( 20 )}`;

}

// texto livre: sem caracteres de controle (exceto quebra de linha), espaços normalizados, tamanho limitado.
// O texto nunca é interpretado como HTML: as telas o exibem com textContent.
function cleanText( value, max, { multiline = false } = {} ) {

	if ( typeof value !== 'string' ) return '';
	let out = '';
	for ( const char of value ) {

		const code = char.codePointAt( 0 );
		if ( code === 10 && multiline ) out += '\n';
		else if ( code < 32 || code === 127 || ( code >= 0x200b && code <= 0x200f ) || code === 0x2028 || code === 0x2029 || code === 0xfeff ) out += code === 9 || code === 10 || code === 13 ? ' ' : '';
		else out += char;

	}

	out = multiline ? out.split( '\n' ).map( ( line ) => line.replace( /\s+/g, ' ' ).trim() ).join( '\n' ).replace( /\n{3,}/g, '\n\n' ).trim() : out.replace( /\s+/g, ' ' ).trim();
	return Array.from( out ).slice( 0, max ).join( '' );

}

function cleanId( value ) {

	return typeof value === 'string' && ID.test( value ) ? value : null;

}

function cleanDate( value, fallback = null ) {

	if ( typeof value !== 'string' || value.length > 40 ) return fallback;
	const time = Date.parse( value );
	return Number.isFinite( time ) ? new Date( time ).toISOString() : fallback;

}

function vector( value, length = 3, limit = LIMITS.coordinate ) {

	return Array.isArray( value ) && value.length === length && value.every( ( n ) => typeof n === 'number' && Number.isFinite( n ) && Math.abs( n ) <= limit ) ? value.slice() : null;

}

// enquadramento associado (mesmo formato das vistas salvas da EV-008)
function cleanCamera( camera ) {

	if ( camera === null || typeof camera !== 'object' ) return null;
	if ( camera.projection !== 'perspective' && camera.projection !== 'orthographic' ) return null;

	const position = vector( camera.position );
	const target = vector( camera.target );
	const quaternion = vector( camera.quaternion, 4, 2 );
	if ( position === null || target === null || quaternion === null ) return null;
	if ( Math.hypot( ...quaternion ) < 1e-6 ) return null;

	const clean = { projection: camera.projection, position, quaternion, target };
	if ( camera.projection === 'perspective' ) {

		clean.fov = typeof camera.fov === 'number' && camera.fov >= 5 && camera.fov <= 120 ? camera.fov : 50;

	} else {

		if ( ! ( typeof camera.frustumHeight === 'number' && camera.frustumHeight > 0 && camera.frustumHeight < 1e5 ) ) return null;
		clean.frustumHeight = camera.frustumHeight;
		clean.zoom = typeof camera.zoom === 'number' && camera.zoom > 0 && camera.zoom < 1e4 ? camera.zoom : 1;

	}

	return clean;

}

function cleanAnchor( anchor ) {

	if ( anchor === null || typeof anchor !== 'object' || ANCHOR_KINDS.includes( anchor.kind ) === false || anchor.kind === 'project' ) return { kind: 'project' };

	const objectUuid = cleanId( anchor.objectUuid );
	if ( objectUuid === null ) return { kind: 'project' };

	const clean = {
		kind: anchor.kind,
		objectUuid,
		objectName: cleanText( anchor.objectName, LIMITS.objectName ),
		objectLabel: cleanText( anchor.objectLabel, LIMITS.label )
	};

	if ( anchor.kind === 'object-point' ) {

		const localPosition = vector( anchor.localPosition );
		if ( localPosition === null ) {

			clean.kind = 'object'; // ponto inválido: o vínculo com o componente continua valendo

		} else {

			clean.localPosition = localPosition;
			const worldPosition = vector( anchor.worldPosition );
			if ( worldPosition !== null ) clean.worldPosition = worldPosition;

		}

	}

	return clean;

}

function cleanReply( reply ) {

	if ( reply === null || typeof reply !== 'object' ) return null;
	const id = cleanId( reply.id );
	const text = cleanText( reply.text, LIMITS.text, { multiline: true } );
	if ( id === null || text === '' ) return null;

	const clean = { id, author: cleanText( reply.author, LIMITS.name ) || 'Sem identificação', text, createdAt: cleanDate( reply.createdAt, new Date( 0 ).toISOString() ) };
	if ( reply.own === true ) clean.own = true;
	const edited = cleanDate( reply.editedAt );
	if ( edited !== null ) clean.editedAt = edited;
	return clean;

}

// comentário (com ou sem os campos do proprietário). Devolve null quando não há o mínimo necessário (id e texto)
function cleanComment( comment, { owner = false } = {} ) {

	if ( comment === null || typeof comment !== 'object' ) return null;
	const id = cleanId( comment.id );
	const text = cleanText( comment.text, LIMITS.text, { multiline: true } );
	if ( id === null || text === '' ) return null;

	const replies = [];
	const seen = new Set();
	for ( const reply of Array.isArray( comment.replies ) ? comment.replies.slice( 0, LIMITS.replies ) : [] ) {

		const clean = cleanReply( reply );
		if ( clean !== null && seen.has( clean.id ) === false ) {

			seen.add( clean.id );
			replies.push( clean );

		}

	}

	const clean = {
		id,
		author: cleanText( comment.author, LIMITS.name ) || 'Sem identificação',
		text,
		createdAt: cleanDate( comment.createdAt, new Date( 0 ).toISOString() ),
		anchor: cleanAnchor( comment.anchor ),
		camera: cleanCamera( comment.camera ),
		viewName: cleanText( comment.viewName, LIMITS.label ),
		replies
	};

	if ( owner ) {

		clean.status = STATUSES.includes( comment.status ) ? comment.status : 'open';
		const source = comment.source;
		if ( source !== null && typeof source === 'object' ) {

			clean.source = {
				reviewId: cleanId( source.reviewId ),
				shareId: cleanId( source.shareId ),
				revision: Number.isInteger( source.revision ) && source.revision >= 0 ? source.revision : null,
				snapshotHash: typeof source.snapshotHash === 'string' && /^(sha256|fnv):[0-9a-f]{16,64}$/.test( source.snapshotHash ) ? source.snapshotHash : null,
				importedAt: cleanDate( source.importedAt )
			};

		}

		if ( comment.stale === true ) clean.stale = true;
		const conflictOf = cleanId( comment.conflictOf );
		if ( conflictOf !== null ) clean.conflictOf = conflictOf;

	}

	return clean;

}

// conteúdo que identifica um comentário (para reconhecer reimportações e conflitos de mesmo ID)
function commentSignature( comment ) {

	return JSON.stringify( [ comment.author, comment.text, comment.createdAt, comment.anchor ] );

}

function replySignature( reply ) {

	return JSON.stringify( [ reply.author, reply.text, reply.createdAt ] );

}

// arquivo de revisão -------------------------------------------------------------------------------------------------

function buildFeedback( { reviewId, shareId, snapshotHash, source, projectTitle, reviewer, comments } ) {

	return {
		format: FEEDBACK_FORMAT,
		formatVersion: FEEDBACK_VERSION,
		reviewId,
		shareId,
		snapshotHash,
		source: { projectId: source.projectId, revision: source.revision },
		projectTitle: cleanText( projectTitle, 120 ),
		reviewer: { name: cleanText( reviewer, LIMITS.name ) },
		createdAt: new Date().toISOString(),
		app: 'Project3DS Visualizador',
		comments: comments.map( ( comment ) => cleanComment( comment ) ).filter( ( comment ) => comment !== null )
	};

}

// valida (e reconstrói) um arquivo de revisão. Devolve { feedback, problems } ou lança um Error com mensagem clara
function parseFeedback( text ) {

	if ( typeof text !== 'string' ) throw new Error( 'O arquivo de revisão não pôde ser lido.' );
	if ( text.length > LIMITS.fileBytes ) throw new Error( 'Arquivo de revisão grande demais (limite de 5 MB).' );

	let data;
	try {

		data = JSON.parse( text );

	} catch ( error ) {

		throw new Error( 'O arquivo não é um JSON válido (pode estar corrompido).' );

	}

	if ( data === null || typeof data !== 'object' || data.format !== FEEDBACK_FORMAT ) throw new Error( 'O arquivo não é uma revisão do Project3DS (.p3ds-feedback.json).' );
	if ( data.formatVersion !== FEEDBACK_VERSION ) throw new Error( `Versão do arquivo de revisão não suportada (${String( data.formatVersion ).slice( 0, 10 )}).` );

	const reviewId = cleanId( data.reviewId );
	const shareId = cleanId( data.shareId );
	const projectId = data.source && cleanId( data.source.projectId );
	if ( reviewId === null || shareId === null ) throw new Error( 'Arquivo de revisão sem identificadores válidos.' );
	if ( projectId === null || projectId === undefined ) throw new Error( 'Arquivo de revisão sem a identificação do projeto de origem.' );
	if ( Array.isArray( data.comments ) === false ) throw new Error( 'Arquivo de revisão sem lista de comentários.' );

	const problems = [];
	if ( data.comments.length > LIMITS.comments ) problems.push( `O arquivo tem ${data.comments.length} comentários; apenas os ${LIMITS.comments} primeiros foram considerados.` );

	const comments = [];
	const ids = new Set();
	let invalid = 0;
	for ( const raw of data.comments.slice( 0, LIMITS.comments ) ) {

		const comment = cleanComment( raw );
		if ( comment === null || ids.has( comment.id ) ) {

			invalid ++;
			continue;

		}

		ids.add( comment.id );
		comments.push( comment );

	}

	if ( invalid > 0 ) problems.push( `${invalid} comentário(s) inválido(s) ou repetido(s) foram ignorados.` );

	const revision = Number.isInteger( data.source.revision ) && data.source.revision >= 0 ? data.source.revision : null;
	const snapshotHash = typeof data.snapshotHash === 'string' && /^(sha256|fnv):[0-9a-f]{16,64}$/.test( data.snapshotHash ) ? data.snapshotHash : null;
	if ( snapshotHash === null ) problems.push( 'O arquivo não informa um hash válido do conteúdo revisado.' );

	return {
		feedback: {
			format: FEEDBACK_FORMAT,
			formatVersion: FEEDBACK_VERSION,
			reviewId,
			shareId,
			snapshotHash,
			source: { projectId, revision },
			projectTitle: cleanText( data.projectTitle, 120 ),
			reviewer: { name: cleanText( data.reviewer && data.reviewer.name, LIMITS.name ) },
			createdAt: cleanDate( data.createdAt ),
			comments
		},
		problems
	};

}

// revisões no projeto do proprietário -------------------------------------------------------------------------------

function emptyReviews() {

	return { version: REVIEWS_VERSION, comments: [], imports: [] };

}

function sanitizeReviews( value ) {

	const reviews = emptyReviews();
	if ( value === null || typeof value !== 'object' ) return reviews;

	const ids = new Set();
	for ( const raw of Array.isArray( value.comments ) ? value.comments.slice( 0, LIMITS.ownerComments ) : [] ) {

		const comment = cleanComment( raw, { owner: true } );
		if ( comment !== null && ids.has( comment.id ) === false ) {

			ids.add( comment.id );
			reviews.comments.push( comment );

		}

	}

	for ( const raw of Array.isArray( value.imports ) ? value.imports.slice( - LIMITS.imports ) : [] ) {

		if ( raw === null || typeof raw !== 'object' || cleanId( raw.reviewId ) === null ) continue;
		reviews.imports.push( {
			reviewId: raw.reviewId,
			shareId: cleanId( raw.shareId ),
			reviewer: cleanText( raw.reviewer, LIMITS.name ),
			importedAt: cleanDate( raw.importedAt ),
			revision: Number.isInteger( raw.revision ) ? raw.revision : null,
			comments: Number.isInteger( raw.comments ) ? raw.comments : 0
		} );

	}

	return reviews;

}

function getReviews( scene ) {

	const meta = scene.userData.project3ds;
	return sanitizeReviews( meta !== undefined && meta !== null ? meta.reviews : null );

}

function hasReviews( scene ) {

	const meta = scene.userData.project3ds;
	return meta !== undefined && meta !== null && meta.reviews !== undefined;

}

// grava (cópia) — demais metadados do projeto preservados; sem comentários nem importações, a chave é removida
function setReviews( scene, reviews ) {

	const meta = Object.assign( {}, scene.userData.project3ds );
	const clean = reviews === null ? emptyReviews() : sanitizeReviews( reviews );

	if ( clean.comments.length > 0 || clean.imports.length > 0 ) meta.reviews = clean;
	else delete meta.reviews;

	if ( Object.keys( meta ).length > 0 ) scene.userData.project3ds = meta;
	else delete scene.userData.project3ds;

}

// mescla um arquivo de revisão validado sem nunca sobrescrever: mesmo ID e mesmo conteúdo = já importado; mesmo ID e
// conteúdo diferente = conflito, importado como comentário separado (marcado), o existente fica intacto.
// anchors: Map objectUuid -> 'found' | 'missing' | 'stale' (apenas informativo; nenhum vínculo é recriado)
function mergeFeedback( current, feedback, { anchors = new Map(), now = new Date().toISOString() } = {} ) {

	const reviews = sanitizeReviews( current );
	const byId = new Map( reviews.comments.map( ( comment ) => [ comment.id, comment ] ) );
	const summary = { added: 0, duplicates: 0, conflicts: 0, repliesAdded: 0, replyConflicts: 0, missing: 0, stale: 0, alreadyImported: reviews.imports.some( ( entry ) => entry.reviewId === feedback.reviewId ), skippedByLimit: 0 };
	const source = { reviewId: feedback.reviewId, shareId: feedback.shareId, revision: feedback.source.revision, snapshotHash: feedback.snapshotHash, importedAt: now };

	const anchorState = ( comment ) => comment.anchor.kind === 'project' ? 'found' : ( anchors.get( comment.anchor.objectUuid ) || 'missing' );

	for ( const incoming of feedback.comments ) {

		const existing = byId.get( incoming.id );

		if ( existing !== undefined && commentSignature( existing ) === commentSignature( incoming ) ) {

			summary.duplicates ++;
			const replies = new Map( existing.replies.map( ( reply ) => [ reply.id, reply ] ) );
			for ( const reply of incoming.replies ) {

				const known = replies.get( reply.id );
				if ( known === undefined ) {

					if ( existing.replies.length >= LIMITS.replies ) continue;
					existing.replies.push( Object.assign( {}, reply ) );
					replies.set( reply.id, reply );
					summary.repliesAdded ++;

				} else if ( replySignature( known ) !== replySignature( reply ) ) {

					summary.replyConflicts ++; // resposta de mesmo ID com outro conteúdo: a existente é mantida

				}

			}

			continue;

		}

		if ( reviews.comments.length >= LIMITS.ownerComments ) {

			summary.skippedByLimit ++;
			continue;

		}

		const state = anchorState( incoming );
		const comment = Object.assign( {}, incoming, { replies: incoming.replies.map( ( reply ) => Object.assign( {}, reply ) ), status: 'open', source: Object.assign( {}, source ) } );
		if ( state === 'stale' ) {

			comment.stale = true;
			summary.stale ++;

		}

		if ( state === 'missing' ) summary.missing ++;

		if ( existing !== undefined ) {

			comment.id = newId();
			comment.conflictOf = incoming.id;
			summary.conflicts ++;

		} else {

			summary.added ++;

		}

		reviews.comments.push( comment );
		byId.set( comment.id, comment );

	}

	if ( summary.alreadyImported === false ) {

		reviews.imports.push( { reviewId: feedback.reviewId, shareId: feedback.shareId, reviewer: feedback.reviewer.name, importedAt: now, revision: feedback.source.revision, comments: feedback.comments.length } );
		if ( reviews.imports.length > LIMITS.imports ) reviews.imports.splice( 0, reviews.imports.length - LIMITS.imports );

	}

	summary.changed = summary.added + summary.conflicts + summary.repliesAdded > 0 || summary.alreadyImported === false;
	return { reviews, summary };

}

function countByStatus( comments ) {

	const counts = { total: comments.length, open: 0, analysis: 0, resolved: 0, discarded: 0 };
	for ( const comment of comments ) counts[ comment.status || 'open' ] ++;
	return counts;

}

export {
	FEEDBACK_FORMAT,
	FEEDBACK_VERSION,
	REVIEWS_VERSION,
	LIMITS as REVIEW_LIMITS,
	STATUSES,
	STATUS_LABELS,
	newId,
	cleanText,
	cleanId,
	cleanCamera,
	cleanAnchor,
	cleanComment,
	cleanReply,
	buildFeedback,
	parseFeedback,
	emptyReviews,
	sanitizeReviews,
	getReviews,
	hasReviews,
	setReviews,
	mergeFeedback,
	countByStatus
};
