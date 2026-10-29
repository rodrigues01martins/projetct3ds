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
	'topbar/unit': 'Unidade',
	'topbar/unit/title': 'Unidade de medida exibida no projeto (não altera o tamanho dos objetos)',

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
	'objects/list/hint': 'Marque a caixa ao lado para incluir objetos no alinhamento. O objeto selecionado é a referência.',
	'objects/list/mark/title': 'Incluir %s no alinhamento e na distribuição',
	'objects/list/reference': 'Referência',
	'objects/list/reference/title': 'Objeto selecionado: fica parado e os outros se alinham a ele',
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
	'tools/measure': 'Medir distância',
	'tools/measure/title': 'Medir distância: clique em dois pontos da cena (Esc para sair)',
	'tools/emptyHint': 'Comece adicionando um objeto pelo painel à esquerda.',

	// régua de medição (EV-002)

	'measure/first': 'Clique no primeiro ponto (em um objeto ou no chão).',
	'measure/second': 'Agora clique no segundo ponto.',
	'measure/result': 'Distância:',
	'measure/clear': 'Limpar',
	'measure/clear/title': 'Apagar a medição atual e medir de novo',
	'measure/exit': 'Sair da medição (Esc)',

	// precisão e grade (EV-002)

	'precision/snap': 'Encaixe ao mover',
	'precision/snap/title': 'Precisão de movimento: as alças de Mover andam em passos deste tamanho. Valores digitados são aplicados exatamente.',
	'precision/grid': 'Grade',
	'precision/grid/title': 'Espaçamento dos quadrados da grade (apenas visual, independente do encaixe)',

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
	'properties/section/info': 'Informações do objeto',
	'properties/section/dimensions': 'Dimensões',
	'properties/section/appearance': 'Aparência',
	'properties/section/alignment': 'Alinhar e distribuir',
	'properties/position': 'Posição',
	'properties/rotation': 'Rotação (graus)',
	'properties/scale': 'Escala',
	'properties/scale/hint': 'Multiplicador do tamanho original (1 = tamanho original). Para medidas reais, use Dimensões.',
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
	'properties/axis/title': '%s no eixo %s. Digite um valor ou use as setas ↑ e ↓ do teclado.',

	// dimensões (EV-002)

	'dimensions/width': 'Largura',
	'dimensions/height': 'Altura',
	'dimensions/depth': 'Profundidade',
	'dimensions/length': 'Comprimento',
	'dimensions/thickness': 'Espessura',
	'dimensions/none': '—',
	'dimensions/noThickness': 'Este objeto não tem espessura neste eixo; a medida não pode ser editada.',
	'dimensions/keepProportions': 'Manter proporções',
	'dimensions/keepProportions/title': 'Ao alterar uma medida, as outras mudam na mesma proporção',
	'dimensions/hint/plane': 'Plano: superfície sem espessura. Largura e comprimento são medidos sobre a própria superfície.',
	'dimensions/hint/sphere': 'Esfera: desmarque "Manter proporções" para criar uma forma oval.',
	'dimensions/hint/group': 'Conjunto de objetos: as medidas só podem mudar proporcionalmente.',
	'dimensions/hint/imported': 'Modelos importados podem não estar em escala real (aqui, 1 unidade = 1 metro). Confira as medidas antes de usá-las.',
	'dimensions/hint/deformed': 'Medidas apenas informativas: objetos deformáveis ou repetidos não podem ser redimensionados aqui.',
	'dimensions/hint/animated': 'Medidas apenas informativas: objetos com animação não podem ser redimensionados aqui.',

	// alinhamento e distribuição (EV-002)

	'align/start': 'Início',
	'align/start/title': 'Alinhar pelo início (menor valor) no eixo %s',
	'align/center': 'Centro',
	'align/center/title': 'Alinhar pelo centro no eixo %s',
	'align/end': 'Fim',
	'align/end/title': 'Alinhar pelo fim (maior valor) no eixo %s',
	'align/distribute': 'Distribuir',
	'align/distribute/title': 'Distribuir no eixo %s: centros igualmente espaçados, objetos das pontas ficam parados (mínimo 3 objetos)',
	'align/hint': 'Usa os limites reais dos objetos. "Distribuir" iguala a distância entre os centros, não entre as superfícies.',
	'align/clearMarks': 'Desmarcar todos',
	'align/clearMarks/title': 'Remover todos os objetos marcados na lista',
	'align/reference': 'Referência (não se move):',
	'align/included': 'Serão movidos: %s',
	'align/markHint': 'Marque outros objetos na lista à esquerda para alinhá-los a este.',
	'align/noReference': 'Selecione o objeto de referência.',
	'align/nested': 'Objetos dentro de grupos não podem ser alinhados no Modo Simples.',

	// tipos de objeto

	'type/light': 'Luz',
	'type/camera': 'Câmera',
	'type/group': 'Grupo de objetos',
	'type/model': 'Modelo 3D',
	'type/other': 'Objeto',

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
	'message/unitChanged': 'Medidas exibidas em %s. O tamanho dos objetos não mudou.',
	'message/invalidNumber': 'Valor inválido. Digite um número, por exemplo 12,5.',
	'message/invalidDimension': 'Medida inválida. Digite um número maior que zero, por exemplo 120 ou 12,5.',
	'message/align/noReference': 'Selecione o objeto de referência (ele não se move).',
	'message/align/needTwo': 'Marque na lista pelo menos mais um objeto para alinhar à referência.',
	'message/align/needThree': 'Para distribuir são necessários pelo menos 3 objetos (selecionado + marcados).',
	'message/align/nothing': 'Os objetos já estão nessa posição.',
	'message/align/done': '%s objeto(s) movido(s). Use Desfazer para voltar.',
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
