// EV-004 — Sistema Inteligente de Materiais, Texturas e Iluminação 3D
//
// Catálogo declarativo de acabamentos (sem código de renderização) e validação das especificações.
//
// Especificação de aparência (dados simples, serializáveis em userData):
//   { preset, color, roughness, metalness, opacity, texture: { id, scale, seed } | null }
//   - roughness / metalness / opacity: 0 a 1
//   - texture.scale: multiplicador do tamanho físico do padrão (1 = tamanho real)

const MATERIAL_CATEGORIES = [
	{ id: 'wood', name: 'Madeiras' },
	{ id: 'stone', name: 'Pedras e revestimentos' },
	{ id: 'metal', name: 'Metais' },
	{ id: 'other', name: 'Outros' }
];

// controls: quais ajustes fazem sentido para o acabamento (os demais ficam ocultos na interface)
const MATERIALS = [
	{ id: 'wood-light', version: 1, name: 'Madeira clara', category: 'wood', color: '#c9a477', roughness: 0.7, metalness: 0, opacity: 1, texture: 'wood-grain', controls: [ 'color', 'gloss', 'texture' ] },
	{ id: 'wood-dark', version: 1, name: 'Madeira escura', category: 'wood', color: '#5a3a24', roughness: 0.6, metalness: 0, opacity: 1, texture: 'wood-grain', controls: [ 'color', 'gloss', 'texture' ] },
	{ id: 'wood-red', version: 1, name: 'Madeira avermelhada', category: 'wood', color: '#8e4a33', roughness: 0.65, metalness: 0, opacity: 1, texture: 'wood-grain', controls: [ 'color', 'gloss', 'texture' ] },

	{ id: 'concrete', version: 1, name: 'Concreto', category: 'stone', color: '#a3a29d', roughness: 0.95, metalness: 0, opacity: 1, texture: 'concrete', controls: [ 'color', 'gloss', 'texture' ] },
	{ id: 'marble-light', version: 1, name: 'Mármore claro', category: 'stone', color: '#eeede8', roughness: 0.15, metalness: 0, opacity: 1, texture: 'marble', controls: [ 'color', 'gloss', 'texture' ] },
	{ id: 'ceramic', version: 1, name: 'Cerâmica', category: 'stone', color: '#e7e2d8', roughness: 0.35, metalness: 0, opacity: 1, texture: 'ceramic-tile', controls: [ 'color', 'gloss', 'texture' ] },

	{ id: 'steel-brushed', version: 1, name: 'Aço escovado', category: 'metal', color: '#b8bcc2', roughness: 0.35, metalness: 1, opacity: 1, texture: null, controls: [ 'color', 'gloss', 'metal' ] },
	{ id: 'aluminum', version: 1, name: 'Alumínio', category: 'metal', color: '#d4d7db', roughness: 0.25, metalness: 1, opacity: 1, texture: null, controls: [ 'color', 'gloss', 'metal' ] },
	{ id: 'metal-dark', version: 1, name: 'Metal escuro', category: 'metal', color: '#3b3d41', roughness: 0.45, metalness: 0.9, opacity: 1, texture: null, controls: [ 'color', 'gloss', 'metal' ] },

	{ id: 'glass', version: 1, name: 'Vidro', category: 'other', color: '#cfe8ff', roughness: 0.05, metalness: 0, opacity: 0.3, texture: null, controls: [ 'color', 'gloss', 'opacity' ] },
	{ id: 'plastic', version: 1, name: 'Plástico', category: 'other', color: '#f2f2f2', roughness: 0.4, metalness: 0, opacity: 1, texture: null, controls: [ 'color', 'gloss', 'opacity', 'texture' ] },
	{ id: 'fabric', version: 1, name: 'Tecido', category: 'other', color: '#7d8aa6', roughness: 0.95, metalness: 0, opacity: 1, texture: 'fabric', controls: [ 'color', 'texture' ] }
];

// "Personalizado": acabamento original do objeto com ajustes do usuário
const CUSTOM_CONTROLS = [ 'color', 'gloss', 'metal', 'opacity', 'texture' ];

// Atalhos de brilho (rugosidade)
const GLOSS_LEVELS = [
	{ id: 'matte', name: 'Fosco', roughness: 0.85 },
	{ id: 'satin', name: 'Intermediário', roughness: 0.5 },
	{ id: 'glossy', name: 'Brilhante', roughness: 0.15 }
];

const TEXTURE_SCALE_LIMITS = { min: 0.1, max: 10 };

const MATERIAL_MAP = new Map( MATERIALS.map( ( material ) => [ material.id, material ] ) );

function getMaterialPreset( id ) {

	return MATERIAL_MAP.get( id ) || null;

}

// semente determinística a partir do identificador (o mesmo acabamento gera sempre o mesmo padrão)
function seedFromId( id ) {

	let hash = 2166136261;
	for ( let i = 0; i < id.length; i ++ ) hash = Math.imul( hash ^ id.charCodeAt( i ), 16777619 );
	return ( hash >>> 0 ) % 100000;

}

function specFromPreset( id ) {

	const preset = getMaterialPreset( id );
	if ( preset === null ) return null;

	return {
		preset: preset.id,
		version: preset.version,
		color: preset.color,
		roughness: preset.roughness,
		metalness: preset.metalness,
		opacity: preset.opacity,
		texture: preset.texture !== null ? { id: preset.texture, scale: 1, seed: seedFromId( preset.id ) } : null
	};

}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const isUnit = ( value ) => typeof value === 'number' && Number.isFinite( value ) && value >= 0 && value <= 1;

// Valida e normaliza uma especificação vinda da interface, do JSON ou do armazenamento local.
// Retorna uma cópia limpa ou null quando inválida (nunca lança exceção).
function sanitizeSpec( spec, isKnownTexture ) {

	if ( spec === null || typeof spec !== 'object' ) return null;
	if ( typeof spec.color !== 'string' || COLOR_PATTERN.test( spec.color ) === false ) return null;
	if ( isUnit( spec.roughness ) === false || isUnit( spec.metalness ) === false || isUnit( spec.opacity ) === false ) return null;

	const clean = {
		preset: typeof spec.preset === 'string' && MATERIAL_MAP.has( spec.preset ) ? spec.preset : null,
		version: 1,
		color: spec.color.toLowerCase(),
		roughness: spec.roughness,
		metalness: spec.metalness,
		opacity: spec.opacity,
		texture: null
	};

	if ( spec.texture !== null && spec.texture !== undefined ) {

		const texture = spec.texture;
		const scale = texture.scale;

		if ( typeof texture !== 'object' || isKnownTexture( texture.id ) === false ) return null;
		if ( typeof scale !== 'number' || Number.isFinite( scale ) === false || scale < TEXTURE_SCALE_LIMITS.min || scale > TEXTURE_SCALE_LIMITS.max ) return null;
		if ( Number.isInteger( texture.seed ) === false || texture.seed < 0 || texture.seed > 1e9 ) return null;

		clean.texture = { id: texture.id, scale, seed: texture.seed };

	}

	return clean;

}

export { MATERIAL_CATEGORIES, MATERIALS, CUSTOM_CONTROLS, GLOSS_LEVELS, TEXTURE_SCALE_LIMITS, getMaterialPreset, specFromPreset, seedFromId, sanitizeSpec };
