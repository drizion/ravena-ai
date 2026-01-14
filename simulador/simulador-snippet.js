/**
 * MODELO DE ESTRUTURA DE MENSAGENS PARA O SIMULADOR DE WHATSAPP
 *
 * Este objeto contém exemplos de todos os tipos possíveis de mensagens
 * que podem ser configuradas no simulador, com comentários explicativos.
 */

const exemploDeMensagens = [
	/**
	 * MENSAGEM DE TEXTO BÁSICA (REMETENTE)
	 * id: identificador único da mensagem (obrigatório)
	 * origem: quem envia a mensagem - "remetente" (ravenabot) ou "destinatario" (usuário)
	 * mensagem: conteúdo de texto da mensagem
	 * delay: tempo em ms para aparecer após a mensagem anterior (padrão: 500ms)
	 */
	{
		id: 1,
		origem: "remetente",
		mensagem: "Olá! Eu sou o ravenabot. Como posso te ajudar hoje?",
		delay: 1000
	},

	/**
	 * MENSAGEM DE TEXTO BÁSICA (DESTINATÁRIO)
	 * As mensagens do destinatário (usuário) não têm simulação de digitação
	 */
	{
		id: 2,
		origem: "destinatario",
		mensagem: "Preciso de ajuda com meu pedido",
		delay: 1500
	},

	/**
	 * MENSAGEM COM RESPOSTA (REPLY)
	 * replyId: ID da mensagem à qual esta é uma resposta
	 * Mostra um pequeno preview da mensagem original acima
	 */
	{
		id: 3,
		origem: "remetente",
		mensagem: "Claro! Por favor, me informe o número do seu pedido",
		delay: 2000,
		replyId: 2 // Esta mensagem é uma resposta à mensagem com ID 2
	},

	/**
	 * ÁUDIO
	 * tipo: define que esta mensagem é do tipo "audio"
	 * duracao: string com a duração do áudio (ex: "0:12")
	 * O sistema simulará o clique no botão de microfone
	 */
	{
		id: 4,
		origem: "remetente",
		tipo: "audio",
		duracao: "0:37", // Formato: "minutos:segundos"
		delay: 2000
	},

	/**
	 * IMAGEM
	 * tipo: define que esta mensagem é do tipo "imagem"
	 * legenda: texto opcional que aparece abaixo da imagem (opcional)
	 * O sistema simulará o clique no botão de câmera
	 */
	{
		id: 5,
		origem: "destinatario",
		tipo: "imagem",
		legenda: "Veja como está o produto que recebi", // Opcional
		delay: 3000
	},

	/**
	 * VÍDEO
	 * tipo: define que esta mensagem é do tipo "video"
	 * legenda: texto opcional que aparece abaixo do vídeo (opcional)
	 * O sistema simulará o clique no botão de câmera
	 */
	{
		id: 6,
		origem: "remetente",
		tipo: "video",
		legenda: "Aqui está um tutorial de como resolver", // Opcional
		delay: 2500
	},

	/**
	 * IMAGEM SEM LEGENDA
	 * A legenda é opcional, você pode enviar apenas a imagem
	 */
	{
		id: 7,
		origem: "destinatario",
		tipo: "imagem",
		delay: 2000
	},

	/**
	 * COMBINAÇÕES AVANÇADAS
	 * Você pode combinar características como reply com imagens ou áudios
	 */
	{
		id: 8,
		origem: "remetente",
		tipo: "imagem",
		legenda: "Este é o status atualizado do seu pedido",
		delay: 2000,
		replyId: 2 // Resposta à mensagem 2 com uma imagem
	},

	/**
	 * MENSAGEM DE TEXTO COMUM (com delay personalizado)
	 * Controle o tempo de aparecimento de cada mensagem
	 */
	{
		id: 9,
		origem: "destinatario",
		mensagem: "Obrigado pela ajuda!",
		delay: 3500 // Aparece 3,5 segundos após a mensagem anterior
	}

	// Você pode adicionar quantas mensagens quiser seguindo os formatos acima
];

/**
 * RESUMO DOS PARÂMETROS POSSÍVEIS:
 *
 * Parâmetros obrigatórios:
 * - id: number (identificador único)
 * - origem: string ("remetente" ou "destinatario")
 *
 * Parâmetros condicionais (pelo menos um destes deve estar presente):
 * - mensagem: string (para mensagens de texto)
 * - tipo: string ("audio", "imagem" ou "video")
 *
 * Parâmetros opcionais:
 * - delay: number (tempo em ms, padrão: 500)
 * - replyId: number (ID da mensagem respondida)
 * - duracao: string (formato "0:00" para áudios)
 * - legenda: string (para imagens/vídeos)
 */
