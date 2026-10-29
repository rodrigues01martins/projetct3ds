// EV-001 — Modo Simples de Criação 3D
// Textos da interface do Modo Simples (sempre em português, independente do idioma do Modo Avançado)

const SimpleModeStrings = {

	// barra superior

	'topbar/projectName': 'Nome do projeto',
	'topbar/projectName/placeholder': 'Projeto sem título',
	'topbar/new': 'Novo',
	'topbar/new/title': 'Começar um projeto novo, com a cena vazia',
	'topbar/open': 'Abrir',
	'topbar/open/title': 'Abrir um projeto salvo no computador (.json)',
	'topbar/save': 'Salvar',
	'topbar/save/title': 'Baixar o projeto para o computador (.json)',
	'topbar/undo': 'Desfazer',
	'topbar/undo/title': 'Desfazer a última ação (Ctrl+Z)',
	'topbar/redo': 'Refazer',
	'topbar/redo/title': 'Refazer a ação desfeita (Ctrl+Shift+Z)',
	'topbar/mode': 'Modo',
	'topbar/mode/simple': 'Simples',
	'topbar/mode/advanced': 'Avançado',
	'topbar/mode/title': 'Alternar entre o Modo Simples e o Modo Avançado (editor completo)',
	'topbar/saving': 'Salvo no navegador',

	// painel esquerdo

	'objects/title': 'Adicionar objetos',
	'objects/hint': 'Clique para colocar na cena',
	'objects/cube': 'Cubo',
	'objects/sphere': 'Esfera',
	'objects/cylinder': 'Cilindro',
	'objects/plane': 'Plano',
	'objects/add/title': 'Adicionar %s à cena',
	'objects/list/title': 'Objetos na cena',
	'objects/list/empty': 'A cena ainda está vazia. Adicione um objeto acima.',
	'objects/list/item/title': 'Selecionar %s',
	'objects/unnamed': 'Objeto sem nome',

	// ferramentas da área central

	'tools/label': 'Ferramentas',
	'tools/select': 'Selecionar',
	'tools/select/title': 'Selecionar: clique em um objeto para escolhê-lo',
	'tools/translate': 'Mover',
	'tools/translate/title': 'Mover: arraste as setas coloridas (W)',
	'tools/rotate': 'Girar',
	'tools/rotate/title': 'Girar: arraste os anéis coloridos (E)',
	'tools/scale': 'Redimensionar',
	'tools/scale/title': 'Redimensionar: arraste os cubinhos coloridos (R)',
	'tools/focus': 'Enquadrar',
	'tools/focus/title': 'Aproximar a câmera do objeto selecionado (F)',
	'tools/emptyHint': 'Comece adicionando um objeto pelo painel à esquerda.',

	// ajuda

	'help/button': 'Como navegar',
	'help/button/title': 'Mostrar ou esconder dicas de navegação',
	'help/title': 'Dicas rápidas',
	'help/orbit': '<b>Girar a vista:</b> arraste com o botão esquerdo do mouse em uma área vazia.',
	'help/pan': '<b>Deslocar a vista:</b> arraste com o botão direito do mouse.',
	'help/zoom': '<b>Aproximar/afastar:</b> use a rodinha do mouse.',
	'help/select': '<b>Selecionar:</b> clique sobre um objeto. Clique em uma área vazia para desmarcar.',
	'help/transform': '<b>Transformar:</b> escolha Mover, Girar ou Redimensionar e arraste as alças coloridas do objeto.',
	'help/focus': '<b>Enquadrar:</b> clique duas vezes em um objeto ou use o botão Enquadrar.',
	'help/close': 'Fechar dicas',

	// painel direito

	'properties/title': 'Propriedades',
	'properties/empty/title': 'Nenhum objeto selecionado',
	'properties/empty/text': 'Clique em um objeto na cena ou na lista à esquerda para ver e alterar suas propriedades.',
	'properties/name': 'Nome',
	'properties/position': 'Posição',
	'properties/rotation': 'Rotação (graus)',
	'properties/scale': 'Tamanho (escala)',
	'properties/color': 'Cor',
	'properties/color/unavailable': 'A cor deste objeto não pode ser alterada aqui. Use o Modo Avançado.',
	'properties/actions': 'Ações',
	'properties/duplicate': 'Duplicar',
	'properties/duplicate/title': 'Criar uma cópia do objeto selecionado',
	'properties/delete': 'Excluir',
	'properties/delete/title': 'Remover o objeto selecionado da cena (Delete)',
	'properties/copySuffix': '(cópia)',
	'properties/axis/x': 'X',
	'properties/axis/y': 'Y',
	'properties/axis/z': 'Z',
	'properties/axis/title': '%s no eixo %s. Arraste para cima/baixo ou digite um valor.',

	// mensagens

	'message/added': '%s adicionado à cena.',
	'message/duplicated': 'Cópia criada.',
	'message/deleted': 'Objeto excluído. Use Desfazer para recuperá-lo.',
	'message/nothingSelected': 'Selecione um objeto primeiro.',
	'message/cannotEdit': 'Este item não pode ser alterado no Modo Simples.',
	'message/nothingToUndo': 'Não há nada para desfazer.',
	'message/nothingToRedo': 'Não há nada para refazer.',
	'message/saved': 'Projeto baixado como "%s".',
	'message/opened': 'Projeto "%s" aberto.',
	'message/newProject': 'Novo projeto iniciado.',
	'message/openError': 'Não foi possível abrir o arquivo. Verifique se é um projeto salvo por este editor (.json).',
	'message/saveError': 'Não foi possível salvar o projeto.',
	'message/historyLocked': 'Desfazer/refazer está indisponível enquanto a cena estiver em reprodução.',

	'confirm/new': 'Começar um projeto novo? Os objetos da cena atual serão removidos.\n\nDica: use "Salvar" antes para guardar uma cópia no computador.',
	'confirm/open': 'Abrir outro projeto? A cena atual será substituída.\n\nDica: use "Salvar" antes para guardar uma cópia no computador.',

	// alternância de modo no Modo Avançado

	'advanced/toSimple': '◧ Modo Simples',
	'advanced/toSimple/title': 'Voltar para a interface simplificada'

};

function getSimpleString( key, ...values ) {

	let text = SimpleModeStrings[ key ];

	if ( text === undefined ) return key;

	for ( const value of values ) text = text.replace( '%s', value );

	return text;

}

export { getSimpleString };
