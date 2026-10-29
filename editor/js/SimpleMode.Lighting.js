// EV-004 — Sistema Inteligente de Materiais, Texturas e Iluminação 3D
//
// Iluminação simplificada por cenários. As luzes do Project3DS ficam em um único grupo na cena
// (luzes nativas do Three.js, serializadas normalmente no JSON do editor):
//
//   Group "Iluminação (Project3DS)"   userData.project3ds.lighting = { version, scenario, intensity, temperature, shadows, shadowQuality }
//     ├─ HemisphereLight  (luz do céu/chão)
//     ├─ DirectionalLight (luz principal, com sombras)
//     └─ Mesh com ShadowMaterial (recebe sombras no chão; transparente e não selecionável)
//
// Regras de segurança:
//   - nunca altera nem remove luzes criadas pelo usuário (Modo Avançado);
//   - existe no máximo um grupo do Project3DS (ao abrir projetos, cópias extras são ignoradas);
//   - cenário "Padrão do editor" remove apenas o grupo do Project3DS.
//   - as sombras do renderer seguem a configuração do projeto (Modo Avançado); aqui só luzes e qualidade mudam.

import * as THREE from 'three';

const META = 'project3ds';
const VERSION = 1;
const GROUP_NAME = 'Iluminação (Project3DS)';

const SCENARIOS = [
	{
		id: 'none', name: 'Padrão do editor', description: 'Sem luzes adicionais: usa o ambiente padrão do editor.',
		defaults: { intensity: 1, temperature: 6500, shadows: false }
	},
	{
		id: 'studio', name: 'Estúdio neutro', description: 'Luz equilibrada e suave para ver objetos e móveis.',
		environmentIntensity: 0.55,
		hemisphere: { sky: '#ffffff', ground: '#8d8d8d', intensity: 1.2 },
		sun: { intensity: 1.6, position: [ 4, 8, 6 ] },
		defaults: { intensity: 1, temperature: 6000, shadows: true }
	},
	{
		id: 'interior', name: 'Ambiente interno', description: 'Luz mais quente, para ambientes e interiores.',
		environmentIntensity: 0.35,
		hemisphere: { sky: '#fff1dc', ground: '#6b5a4a', intensity: 1.1 },
		sun: { intensity: 1.1, position: [ - 3, 6, 4 ] },
		defaults: { intensity: 1, temperature: 3500, shadows: true }
	},
	{
		id: 'daylight', name: 'Luz do dia', description: 'Sol claro e direcional, com sombras marcadas.',
		environmentIntensity: 0.4,
		hemisphere: { sky: '#cfe6ff', ground: '#9a8f7a', intensity: 0.8 },
		sun: { intensity: 3, position: [ 6, 10, 4 ] },
		defaults: { intensity: 1, temperature: 6500, shadows: true }
	}
];

const SHADOW_QUALITY = {
	low: { mapSize: 1024, radius: 2 },
	high: { mapSize: 2048, radius: 4 }
};

const LIMITS = { intensity: [ 0, 2 ], temperature: [ 2700, 7500 ] };

function getScenario( id ) {

	return SCENARIOS.find( ( scenario ) => scenario.id === id ) || null;

}

function defaultSettings( scenarioId = 'none' ) {

	const scenario = getScenario( scenarioId ) || SCENARIOS[ 0 ];

	return {
		version: VERSION,
		scenario: scenario.id,
		intensity: scenario.defaults.intensity,
		temperature: scenario.defaults.temperature,
		shadows: scenario.defaults.shadows,
		shadowQuality: 'low'
	};

}

const inRange = ( value, [ min, max ] ) => typeof value === 'number' && Number.isFinite( value ) && value >= min && value <= max;

function sanitizeSettings( settings ) {

	if ( settings === null || typeof settings !== 'object' || getScenario( settings.scenario ) === null ) return null;

	const fallback = defaultSettings( settings.scenario );

	return {
		version: VERSION,
		scenario: settings.scenario,
		intensity: inRange( settings.intensity, LIMITS.intensity ) ? settings.intensity : fallback.intensity,
		temperature: inRange( settings.temperature, LIMITS.temperature ) ? settings.temperature : fallback.temperature,
		shadows: typeof settings.shadows === 'boolean' ? settings.shadows : fallback.shadows,
		shadowQuality: settings.shadowQuality === 'high' ? 'high' : 'low'
	};

}

// cor aproximada de uma temperatura (kelvin) — aproximação usual de corpo negro (Tanner Helland)
function temperatureToColor( kelvin ) {

	const t = kelvin / 100;
	const clamp = ( value ) => Math.max( 0, Math.min( 255, value ) ) / 255;

	const r = t <= 66 ? 255 : 329.698727446 * Math.pow( t - 60, - 0.1332047592 );
	const g = t <= 66 ? 99.4708025861 * Math.log( t ) - 161.1195681661 : 288.1221695283 * Math.pow( t - 60, - 0.0755148492 );
	const b = t >= 66 ? 255 : ( t <= 19 ? 0 : 138.5177312231 * Math.log( t - 10 ) - 305.0447927307 );

	return new THREE.Color().setRGB( clamp( r ), clamp( g ), clamp( b ), THREE.SRGBColorSpace );

}

// grupo do Project3DS -------------------------------------------------------------------------

function getLightingMeta( object ) {

	const meta = object.userData[ META ];
	return meta !== null && typeof meta === 'object' && meta.lighting !== null && typeof meta.lighting === 'object' ? meta.lighting : null;

}

function isLightingGroup( object ) {

	return object !== null && object !== undefined && object.isGroup === true && getLightingMeta( object ) !== null;

}

// objeto pertence ao grupo de iluminação do Project3DS (ele mesmo ou um filho)
function isOwnedLighting( object, scene ) {

	let current = object;

	while ( current !== null && current !== undefined && current !== scene ) {

		if ( isLightingGroup( current ) ) return true;
		current = current.parent;

	}

	return false;

}

function findLightingGroup( scene ) {

	return scene.children.find( isLightingGroup ) || null;

}

function findRole( group, role ) {

	return group.children.find( ( child ) => {

		const meta = child.userData[ META ];
		return meta !== null && typeof meta === 'object' && meta.lightingRole === role;

	} ) || null;

}

function disableRaycast( mesh ) {

	// o receptor de sombras não deve ser selecionado nem atrapalhar a régua de medição
	mesh.raycast = function () {};

}

function createLightingGroup() {

	const group = new THREE.Group();
	group.name = GROUP_NAME;

	const hemisphere = new THREE.HemisphereLight();
	hemisphere.name = 'Luz do céu (Project3DS)';
	hemisphere.position.set( 0, 10, 0 );
	hemisphere.userData[ META ] = { lightingRole: 'hemisphere' };

	const sun = new THREE.DirectionalLight();
	sun.name = 'Luz principal (Project3DS)';
	sun.userData[ META ] = { lightingRole: 'sun' };
	sun.shadow.bias = - 0.0005;
	sun.shadow.normalBias = 0.02;

	const catcher = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ), new THREE.ShadowMaterial( { opacity: 0.22 } ) );
	catcher.name = 'Sombras no chão (Project3DS)';
	catcher.rotation.x = - Math.PI / 2;
	catcher.position.y = 0.001;
	catcher.receiveShadow = true;
	catcher.userData[ META ] = { lightingRole: 'catcher' };
	disableRaycast( catcher );

	group.add( hemisphere, sun, catcher );

	return group;

}

// área coberta pelas sombras: ajustada aos objetos da cena (fora do grupo de iluminação)
function fitShadowCamera( group, scene ) {

	const sun = findRole( group, 'sun' );
	const catcher = findRole( group, 'catcher' );

	if ( sun === null ) return;

	const box = new THREE.Box3();

	for ( const child of scene.children ) {

		if ( child === group || child.isLight === true ) continue;
		box.expandByObject( child, false );

	}

	const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter( new THREE.Vector3() );
	const radius = box.isEmpty() ? 5 : Math.max( 3, box.getBoundingSphere( new THREE.Sphere() ).radius * 1.2 );

	const direction = new THREE.Vector3().fromArray( sun.userData[ META ].direction || [ 4, 8, 6 ] ).normalize();

	sun.position.copy( center ).addScaledVector( direction, radius * 2 );
	sun.target.position.copy( center );
	sun.target.updateMatrixWorld();

	const camera = sun.shadow.camera;
	camera.left = camera.bottom = - radius;
	camera.right = camera.top = radius;
	camera.near = 0.1;
	camera.far = radius * 4;
	camera.updateProjectionMatrix();

	if ( catcher !== null ) {

		catcher.position.set( center.x, 0.001, center.z );
		catcher.scale.set( radius * 3, radius * 3, 1 );

	}

}

// Aplica as configurações ao grupo existente (sem recriar luzes nem o renderer)
function applySettingsToGroup( group, settings, scene ) {

	const scenario = getScenario( settings.scenario );
	const hemisphere = findRole( group, 'hemisphere' );
	const sun = findRole( group, 'sun' );
	const catcher = findRole( group, 'catcher' );
	const tint = temperatureToColor( settings.temperature );

	if ( hemisphere !== null ) {

		hemisphere.color.set( scenario.hemisphere.sky ).multiply( tint );
		hemisphere.groundColor.set( scenario.hemisphere.ground );
		hemisphere.intensity = scenario.hemisphere.intensity * settings.intensity;

	}

	if ( sun !== null ) {

		sun.color.copy( tint );
		sun.intensity = scenario.sun.intensity * settings.intensity;
		sun.userData[ META ] = { lightingRole: 'sun', direction: scenario.sun.position.slice() };

		const quality = SHADOW_QUALITY[ settings.shadowQuality ];

		if ( sun.shadow.mapSize.x !== quality.mapSize ) {

			// troca de qualidade: só o mapa de sombras da luz é recriado (o WebGLRenderer não é reinicializado)
			sun.shadow.mapSize.set( quality.mapSize, quality.mapSize );

			if ( sun.shadow.map !== null ) {

				sun.shadow.map.dispose();
				sun.shadow.map = null;

			}

		}

		sun.shadow.radius = quality.radius;
		sun.castShadow = settings.shadows;

	}

	if ( catcher !== null ) {

		catcher.visible = settings.shadows;
		disableRaycast( catcher );

	}

	scene.environmentIntensity = scenario.environmentIntensity;
	group.userData[ META ] = Object.assign( {}, group.userData[ META ], { lighting: Object.assign( {}, settings ) } );

	fitShadowCamera( group, scene );

}

function getSettings( scene ) {

	const group = findLightingGroup( scene );
	if ( group === null ) return defaultSettings( 'none' );

	return sanitizeSettings( getLightingMeta( group ) ) || defaultSettings( 'none' );

}

// luzes criadas pelo usuário (fora do grupo do Project3DS)
function countUserLights( scene ) {

	let count = 0;

	scene.traverse( ( object ) => {

		if ( object.isLight === true && isOwnedLighting( object, scene ) === false ) count ++;

	} );

	return count;

}

export {
	SCENARIOS,
	SHADOW_QUALITY,
	LIMITS as LIGHTING_LIMITS,
	getScenario,
	defaultSettings,
	sanitizeSettings,
	temperatureToColor,
	isLightingGroup,
	isOwnedLighting,
	findLightingGroup,
	createLightingGroup,
	applySettingsToGroup,
	fitShadowCamera,
	getSettings,
	countUserLights
};
