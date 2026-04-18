# Variáveis para Comandos Personalizados

As variáveis abaixo podem ser usadas em comandos personalizados (`!g-addCmd`) e em mensagens de boas-vindas/despedida.

### 🚪 Boas vindas/despedidas
- `{pessoa}`: Nome(s) da(s) pessoa(s) adicionada(s) no grupo
- `{tituloGrupo}`: Título do grupo no whatsApp
- `{nomeGrupo}`: ID do grupo na ravena

### 🕐 Variáveis de Sistema
- `{day}`: Nome do dia atual (ex: Segunda-feira)
- `{date}`: Data atual
- `{time}`: Hora atual
- `{data-hora}`: Hora atual (apenas o número)
- `{data-minuto}`: Minuto atual (apenas o número)
- `{data-segundo}`: Segundo atual (apenas o número)
- `{data-dia}`: Dia atual (apenas o número)
- `{data-mes}`: Mês atual (apenas o número)
- `{data-ano}`: Ano atual (apenas o número)

### 🎲 Variáveis de Números Aleatórios
- `{randomPequeno}`: Número aleatório de 1 a 10
- `{randomMedio}`: Número aleatório de 1 a 100
- `{randomGrande}`: Número aleatório de 1 a 1000
- `{randomMuitoGrande}`: Número aleatório de 1 a 10000
- `{rndDado-X}`: Simula dado de X lados (substitua X pelo número)
- `{rndDadoRange-X-Y}`: Número aleatório entre X e Y (substitua X e Y)
- `{somaRandoms}`: Soma dos números aleatórios anteriores na mensagem

### 👤 Variáveis de Contexto
- `{pessoa}`: Nome do autor da mensagem
- `{nomeAutor}`: Nome do autor da mensagem (mesmo que {pessoa})
- `{group}`: Nome do grupo
- `{nomeCanal}`: Nome do grupo (mesmo que {group})
- `{nomeGrupo}`: Nome do grupo (mesmo que {group})
- `{contador}`: Número de vezes que o comando foi executado
- `{mention}`: Marca a pessoa mencionada (na própria mensage, na mensagem resposta ou alguém aleatório). A cada ocorrência pega um mention diferente
- `{singleMention}`: Igual ao {mention}, mas troca todas as ocorrências da variável pra mesma ao invés de escolher outro membro aleatório
- `{mentionOuEu}`: Igual ao {singleMention}, mas ao invés de escolher um membro aleatório caso não exista mention, marca quem enviou a mensagem
- `{mention-5511999999999@c.us}`: Menciona usuário específico

### 🌐 Variáveis de API
- `{reddit-XXXX}`: Busca mídia em um subreddit
- `{API#GET#TEXT#url}`: Faz uma requisição GET e retorna o texto
- `{API#GET#JSON#url\ntemplate}`: Faz uma requisição GET e formata o JSON
- `{API#POST#TEXT#url?param=valor}`: Faz uma requisição POST com parâmetros

### 📁 Variáveis de Arquivo
- `{file-nomeArquivo}`: Envia arquivo da pasta 'data/media/'
- `{file-pasta/}`: Envia até 5 arquivos da pasta 'data/media/pasta/'

### 🔗 Variáveis de Comando
- `{cmd-comando arg1 arg2}`: Executa outro comando (criando um alias)

