#!/bin/bash

# Uso esse script pra dumpar os dados da Evolution, testar os webhooks

# Define a porta (Padrão: 8080) e o Modo (Padrão: 0)
PORTA=${1:-8080}
MODO=${2:-0} # 0 = Apenas contar, 1 = Imprimir corpo da requisição

# Cria o nome do arquivo temporário para o manipulador
HANDLER="/tmp/socat_handler_$$.sh"

echo "--- HTTP LISTENER ---"
echo "Porta: $PORTA"
echo "Modo: $([ "$MODO" -eq 1 ] && echo "Imprimir Body" || echo "Apenas Contador")"
echo "------------------------------------"
echo "Aguardando requisições..."

# Escreve a lógica interna no arquivo temporário
# Usamos 'timeout 1' para garantir compatibilidade e evitar travamentos
cat << 'EOF' > "$HANDLER"
#!/bin/bash

# 1. LER REQUISIÇÃO (com timeout de 1s para não travar)
# Se a variável de ambiente PRINT_MODE for 1, imprime no terminal (/dev/tty)
if [ "$PRINT_MODE" -eq 1 ]; then
    timeout 1 cat | tee /dev/tty > /dev/null
else
    timeout 1 cat > /dev/null
fi

# 2. ENVIAR RESPOSTA (HTTP 200 Padrão)
# Enviamos para STDOUT, o socat redireciona de volta para o cliente.
# (Os cabeçalhos HTTP devem permanecer em inglês pelo protocolo)
printf "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"

# 3. SINALIZAR (Para o contador)
# Escreve em STDERR para o script principal contar
echo "REC" >&2
EOF

# Torna o manipulador executável
chmod +x "$HANDLER"

# Garante que o arquivo temporário seja apagado ao sair (Ctrl+C)
trap "rm -f $HANDLER" EXIT

export PRINT_MODE=$MODO

# Explicação do socat:
# -T 3: Timeout de segurança global de 3s
# SYSTEM: Executa nosso script limpo
# 2>&1: Captura o sinal "REC" do stderr
# grep: Filtra apenas o nosso sinal
# awk: Conta e força a atualização imediata da tela (fflush)
socat -T 3 TCP-LISTEN:$PORTA,fork,reuseaddr SYSTEM:"$HANDLER" 2>&1 \
| grep --line-buffered "REC" \
| awk '{print "Requisição #" NR; fflush()}'