Dicas para comandos:

# !g-painel
É possível criar, editar e apagar comandos usando o painel web - geralmente mais fácil que digitando no whatsapp
Envie !g-painel dentro do grupo para receber um link de gerenciamento

# "Editar" comandos fixos, workaround
Se o usuário quer configurar algo um comando já existente, como o de pesca, isto só é possível usando um alias
Exemplo:
- O usuário quer usar !g-cmd-setHoras pesca
- 'pesca' é um comando fixo do bot e não pode ter suas propriedades alteradas

O usuário deve:

1. Criar um comando com nome similar que invoque o comando desejado, com a variavel {cmd-xxxx}
- !g-addCmd peska {cmd-pesca}

2. Silenciar o comando original
- !g-mute pesca

Agora ele pode usar os comandos !g-cmd-xxx para alterar as propriedades do mesmo
- !g-cmd-setHoras peska 00:00 07:00