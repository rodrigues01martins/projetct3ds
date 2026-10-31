// EV-011 — Sistema de Gestão de Projetos, Versionamento e Recuperação 3D
//
// Miniaturas estáticas (320 × 180, JPEG) do projeto aberto, pelo mesmo renderizador do viewport (EV-008):
// nenhum WebGLRenderer novo, nenhuma cena extra carregada. A miniatura é só ilustrativa — nunca fonte de verdade —
// e qualquer falha é ignorada (o salvamento do projeto tem prioridade).

import { renderToCanvas } from './SimpleMode.ImageExport.js';

const WIDTH = 320, HEIGHT = 180;

function captureThumbnail( editor ) {

	try {

		if ( editor.viewportRenderer === undefined || editor.scene.children.length === 0 ) return null;

		const canvas = renderToCanvas( editor, editor.viewportCamera, WIDTH, HEIGHT );
		const url = canvas.toDataURL( 'image/jpeg', 0.72 );
		canvas.width = 0;
		canvas.height = 0;
		return url.startsWith( 'data:image/jpeg' ) ? url : null;

	} catch ( error ) {

		return null;

	}

}

export { captureThumbnail };
