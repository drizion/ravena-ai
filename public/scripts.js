// Variáveis globais
let lastHealthData = null;
let isAdminMode = false;
let selectedBots = [];
let activePeriod = 'today';

// Função para formatar a hora
function formatTime(timestamp) {
    if (!timestamp) return 'Nunca';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('pt-BR');
}

// Função para calcular tempo desde a última mensagem
function getTimeSinceLastMessage(timestamp) {
    if (!timestamp) return Infinity;
    
    const now = Date.now();
    const diff = now - timestamp;
    return Math.floor(diff / 1000 / 60); // Minutos
}

// Função para determinar status baseado no tempo
function getStatusEmoji(minutes, connected, banned) {
    if (banned) return '🚨'; // banida
    if (!connected) return '⚫'; // Desconectado
    
    if (minutes < 2) return '🟢';
    if (minutes < 5) return '🟡';
    if (minutes < 15) return '🟠';
    return '🔴';
}

// Função para obter descrição do status
function getStatusDescription(minutes, connected) {
    if (!connected) return 'Desconectado';
    
    if (minutes < 2) return 'Ativo';
    if (minutes < 5) return 'Alerta';
    if (minutes < 15) return 'Atenção';
    return 'Inativo';
}

// Função para classificar o nível de atividade de mensagens
function getMessageActivityClass(msgsHr) {
    if (msgsHr === 0) return 'msgs-badge-low';
    if (msgsHr > 50) return 'msgs-badge-high';
    return '';
}

// Função para classificar o tempo de resposta
function getResponseTimeClass(seconds) {
    if (seconds < 5) return 'response-normal';
    if (seconds < 30) return 'response-warning';
    return 'response-danger';
}

// Função para obter emoji baseado no tempo de resposta
function getResponseTimeEmoji(seconds) {
    if (seconds < 5) return '⚡';
    if (seconds < 30) return '🕐';
    return '🐢';
}

// Função para formatar o tempo desde a última mensagem
function formatTimeSince(minutes) {
    if (minutes === Infinity) return 'Nunca';
    
    if (minutes < 1) return 'Agora mesmo';
    if (minutes === 1) return '1 minuto atrás';
    if (minutes < 60) return `${minutes} minutos atrás`;
    
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hora atrás';
    if (hours < 24) return `${hours} horas atrás`;
    
    const days = Math.floor(hours / 24);
    if (days === 1) return '1 dia atrás';
    return `${days} dias atrás`;
}

// Função para formatar número de telefone para URL do WhatsApp
function formatWhatsAppUrl(phoneNumber) {
    // Remove todos os caracteres não numéricos
    const cleanNumber = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
    return `https://wa.me/${cleanNumber}`;
}

// Função para extrair número de telefone do bot ID
function extractPhoneFromBotId(botId, bots) {
    // Primeiro, verifica se podemos obter o número a partir dos metadados do bot
    for (const bot of bots) {
        if (bot.id === botId && bot.phoneNumber) {
            return bot.phoneNumber;
        }
    }
    
    // Se não tiver nos metadados, tenta extrair do ID usando expressão regular
    const phoneMatch = botId.match(/(\d{10,15})/);
    if (phoneMatch) {
        return phoneMatch[1];
    }
    
    // Se não conseguir extrair do ID, verifica se temos um mapeamento explícito
    const botPhoneMap = {
        'ravena-testes': '555596424307', // Exemplo
    };
    
    return botPhoneMap[botId] || '';
}

// Função para verificar se estamos em modo admin
function checkAdminMode() {
    const urlParams = new URLSearchParams(window.location.search);
    isAdminMode = urlParams.has('admin');
}

// Função para buscar dados de saúde dos bots
async function fetchHealthData() {
    try {
        const response = await fetch('/health');
        
        if (!response.ok) {
            throw new Error(`Erro ao obter dados: ${response.status}`);
        }
        
        const data = await response.json();
        lastHealthData = data;
        renderBots(data);
        
        // Atualiza timestamp da última atualização
        const lastUpdatedElement = document.getElementById('lastUpdated');
        lastUpdatedElement.textContent = `Última atualização: ${new Date().toLocaleString('pt-BR')}`;
        
        return data;
    } catch (error) {
        console.error('Erro ao buscar dados de saúde:', error);
        
        // Exibe mensagem de erro
        const botContainer = document.getElementById('botContainer');
        botContainer.innerHTML = `
            <div style="text-align: center; padding: 30px;">
                <p style="color: #ff5555; font-size: 1.2rem;">❌ Erro ao carregar dados</p>
                <p>${error.message}</p>
                <button id="retryButton" class="refresh-button" style="margin-top: 20px;">
                    🔄 Tentar Novamente
                </button>
            </div>
        `;
        
        document.getElementById('retryButton').addEventListener('click', fetchHealthData);
    }
}

function formatPhoneNumber(number) {
  if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) {
    return 'Número inválido';
  }

  if (number.length >= 12 && number.startsWith('55')) {
    const countryCode = number.substring(0, 2);
    const areaCode = number.substring(2, 4);
    const prefix = number.substring(4, 9);
    const suffix = number.substring(9);
    
    return `+${countryCode} (${areaCode}) 9${prefix}-${suffix}`;
  } 
  
  return number;
}

// Função para buscar e renderizar top doações
async function fetchTopDonates() {
    try {
        const response = await fetch('/top-donates');
        if (!response.ok) {
            throw new Error('Erro ao buscar doações');
        }
        let donations = await response.json();
        const donatesTextElement = document.getElementById('topDonatesText');

        if (donations.length > 0) {
            // Ordena por valor e pega os top 15
            donations = donations
                .sort((a, b) => b.valor - a.valor)
                .slice(0, 15);

            const text = donations
                .map(d => `${d.nome}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(d.valor)}`)
                .join('  •  ');
            
            // Repete o texto para garantir o preenchimento do banner
            donatesTextElement.textContent = `🏆 TOP DONATES:  •  ${text}  •  `.repeat(5);
        } else {
            donatesTextElement.textContent = '🏆 TOP DONATES: Nenhuma doação registrada ainda.';
        }
    } catch (error) {
        console.error('Erro ao carregar top doações:', error);
        const donatesTextElement = document.getElementById('topDonatesText');
        donatesTextElement.textContent = '🏆 TOP DONATES: Erro ao carregar.';
    }
}

// Função para renderizar os bots
function renderBots(data) {
    const botContainer = document.getElementById('botContainer');
    botContainer.innerHTML = '';
    
    if (!data.bots || data.bots.length === 0) {
        botContainer.innerHTML = '<p style="text-align: center; padding: 20px;">Nenhum bot encontrado</p>';
        return;
    }
    
    // Atualiza os filtros de bots para os gráficos
    updateBotFilters(data.bots);
    
    // Calcula o total de mensagens/hora de todos os bots
    let totalMsgsHr = 0;
    data.bots.forEach(bot => {
        totalMsgsHr += Math.round(bot.msgsHr || 0);
    });
    
    // Cria o contador de mensagens total
    const msgsCounterDiv = document.getElementById('msgsCounter');
    if (msgsCounterDiv) {
        msgsCounterDiv.innerHTML = `
            <span>Processando no momento</span>
            <span class="count">${totalMsgsHr} msgs/h</span>
        `;
    }
    
    // Ordena os bots: Normais, comunitarios, VIP
    const botsNormais = data.bots.filter(b => !b.comunitario && !b.vip);
    const botsComunitarios = data.bots.filter(b => b.comunitario);
    const botsVips = data.bots.filter(b =>  b.vip);


    console.log({botsNormais, botsComunitarios, botsVips});

    // Renderiza os cards de bot
    const tituloNormais = document.createElement('h2');
    tituloNormais.className = 'titulo-tipo-bots';
    tituloNormais.innerHTML = '🐦‍⬛ ravenas';
    botContainer.appendChild(tituloNormais);

    const normalInfoText = document.createElement('p');
    normalInfoText.className = 'normal-info-text';
    normalInfoText.innerHTML = 'As ravenas <b>normais</b>, que você sempre usou! Os chips são comprados e mantidos por mim através das doações.<br><b>Apenas eu, o criador,</b> tenho acesso ao fluxo de dados deste bots.';
    botContainer.appendChild(normalInfoText);
    botsNormais.forEach(bot => {
        renderBotCard(botContainer, data, bot);
    });
    const separator = document.createElement('hr');
    separator.className = 'bot-separator';
    botContainer.appendChild(separator);

    if(botsComunitarios.length > 0){
        const tituloComunitaria = document.createElement('h2');
        tituloComunitaria.className = 'titulo-tipo-bots';
        tituloComunitaria.innerHTML = '🐓 ravenas comunitárias ☭';
        botContainer.appendChild(tituloComunitaria);
        const comInfoText = document.createElement('p');
        comInfoText.className = 'com-info-text';
        comInfoText.innerHTML = 'Estas ravenas são iniciativas de membros que doam seus chips e celulares para rodar a ravena.<br><b>O dono deste chip terá acesso às mensagens e fluxo de dados deste bot, se você não concorda com isso, pode remover o bot livremente.</b>';
        botContainer.appendChild(comInfoText);
        botsComunitarios.forEach(bot => {
            renderBotCard(botContainer, data, bot);
        });
        const separator = document.createElement('hr');
        separator.className = 'bot-separator';
        botContainer.appendChild(separator);
    }

    if(botsVips.length > 0){
        const tituloVip = document.createElement('h2');
        tituloVip.className = 'titulo-tipo-bots';
        tituloVip.innerHTML = '💎 ravenas vip';
        botContainer.appendChild(tituloVip);
        const vipInfoText = document.createElement('p');
        vipInfoText.className = 'vip-info-text';
        vipInfoText.innerHTML = 'Estas são ravenas que hospedo em agradecimento aos primeiros donates que ajudaram a solidificar a ravena, não estão mais disponíveis - estão aqui apenas para que os membros acompanhem o status.<br>⚠️ Os bots <i>vips</i> não recebem convites e nem respondem mensagens no pv!<br><br>';
        botContainer.appendChild(vipInfoText);
        botsVips.forEach(bot => {
            renderBotCard(botContainer, data, bot);
        });
        const separator = document.createElement('hr');
        separator.className = 'bot-separator';
        botContainer.appendChild(separator);
    }
}

function renderBotCard(botContainer, data, bot){
    const minutesSinceLastMessage = getTimeSinceLastMessage(bot.lastMessageReceived);
    const statusEmoji = getStatusEmoji(minutesSinceLastMessage, bot.connected, bot.banido);
    const statusDesc = getStatusDescription(minutesSinceLastMessage, bot.connected);
    const phoneNumber = formatPhoneNumber(extractPhoneFromBotId(bot.id, data.bots)).replace("+55","").trim();
    const whatsappUrl = formatWhatsAppUrl(phoneNumber);
    const msgsHr = Math.round(bot.msgsHr || 0);
    const msgActivityClass = getMessageActivityClass(msgsHr);
    
    const avgResponseTime = bot.responseTime ? bot.responseTime.avg || 0 : 0;
    const maxResponseTime = bot.responseTime ? bot.responseTime.max || 0 : 0;
    const responseTimeClass = getResponseTimeClass(avgResponseTime);
    const responseTimeEmoji = getResponseTimeEmoji(avgResponseTime);
    
    const botCard = document.createElement('div');
    botCard.className = 'bot-card';
    if (bot.vip) {
        botCard.classList.add('vip');
    }
    if (bot.comunitario) {
        botCard.classList.add('comunitario');
    }
    
    let buttonsHtml = '';
    if (isAdminMode) {
        buttonsHtml = `
            <div class="detail-item" style="margin-top: 15px; justify-content: center; gap: 10px;">
                <button class="restart-button" data-bot-id="${bot.id}">
                    🔄 Reiniciar
                </button>
                <button class="qr-button" data-bot-id="${bot.id}">
                    🔳 QRCode
                </button>
            </div>
        `;
    }
    
    // 
    let detalhes = "";
    if(bot.semPV || bot.semConvites){
        const txtDetalhes = [bot.semPV && "PV Desabilitado", bot.semConvites && "Não recebe convites"].filter(Boolean).join(", ");
        detalhes = `<div class="detail-item">
                <span class="detail-label" style="width: 100%; text-align: center; color: #a2a20d">${txtDetalhes}</span>
            </div>`;
    }

    let divResponsavel = "";

    if(bot.numeroResponsavel){
        const phoneNumberResponsavel = formatPhoneNumber(extractPhoneFromBotId(bot.numeroResponsavel, [])).replace("+55","").trim();
        divResponsavel = `             <div class="detail-item">
                <span class="detail-label">Responsável:</span>
                <span class="detail-value">${phoneNumberResponsavel}</span>
            </div>`;
    }
    
    let divMsgs = `<div class="detail-item"><span class="detail-label label-desconectado">Desconectado</span></div>`;
    if(bot.banido){
        divMsgs = `<div class="detail-item"><span class="detail-label label-banida">BANIDA</span></div>`;
    }
    if(bot.connected && !bot.banido){
        divMsgs = `<div class="detail-item">
                <span class="detail-label">Última mensagem:</span>
                <span class="detail-value tooltip-container">
                    ${formatTimeSince(minutesSinceLastMessage)}
                    <span class="tooltip-text">Recebida em: ${formatTime(bot.lastMessageReceived)}</span>
                </span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Msgs/hora:</span>
                <span class="detail-value-highlight">
                    ${msgsHr}
                    <span class="msgs-badge ${msgActivityClass}">
                        ${msgsHr === 0 ? '💤' : msgsHr > 100 ? '🔥' : msgsHr > 50 ? '📊' : '📝'}
                    </span>
                </span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Delay médio:</span>
                <span class="detail-value-highlight tooltip-container">
                    ${avgResponseTime.toFixed(1)}s
                    <span class="response-badge ${responseTimeClass}">
                        ${responseTimeEmoji}
                    </span>
                    <span class="tooltip-text">Delay máximo: ${maxResponseTime}s</span>
                </span>
            </div>`;
    }

    botCard.innerHTML = `
        <div class="bot-header">
            <div class="bot-title">
                <a href="${whatsappUrl}" target="_blank" title="Abrir chat no WhatsApp">
                    <img src="whatsapp.png" alt="WhatsApp" class="whatsapp-icon">
                </a>
                <div class="bot-name">${bot.id}</div>
            </div>
            <div class="status-indicator" title="${statusDesc}">${statusEmoji}</div>
        </div>
        <div class="bot-details">
            <div class="detail-item">
                <span class="detail-label">Telefone:</span>
                <span class="detail-value">${phoneNumber || 'Não disponível'}</span>
            </div>
            ${divResponsavel}
            ${divMsgs}
            ${detalhes}
            ${buttonsHtml}
        </div>
    `;
    
    botContainer.appendChild(botCard);
    
    if (isAdminMode) {
        const restartButton = botCard.querySelector('.restart-button');
        restartButton.addEventListener('click', () => openRestartModal(bot.id));
        const qrButton = botCard.querySelector('.qr-button');
        qrButton.addEventListener('click', () => openQRModal(bot.id));
    }
}

function openQRModal(botId){
    window.open(`/qrcode/${botId}`,"_new");
}

function openRestartModal(botId) {
    const modal = document.getElementById('restartModal');
    const modalBotId = document.getElementById('modalBotId');
    
    modalBotId.textContent = botId;
    modal.style.display = 'flex';
}

function closeRestartModal() {
    const modal = document.getElementById('restartModal');
    modal.style.display = 'none';
    
    document.getElementById('reason').value = '';
    document.getElementById('apiUser').value = '';
    document.getElementById('apiPassword').value = '';
}

async function restartBot() {
    const botId = document.getElementById('modalBotId').textContent;
    const reason = document.getElementById('reason').value || 'Reinicialização pelo painel web';
    const apiUser = document.getElementById('apiUser').value;
    const apiPassword = document.getElementById('apiPassword').value;
    
    if (!apiUser || !apiPassword) {
        alert('Por favor, informe as credenciais de API');
        return;
    }
    
    try {
        const authHeader = 'Basic ' + btoa(`${apiUser}:${apiPassword}`);
        
        const response = await fetch(`/restart/${botId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify({ reason })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erro ${response.status}`);
        }
        
        const result = await response.json();
        alert(`Bot ${botId} está sendo reiniciado. ${result.message}`);
        
        closeRestartModal();
        setTimeout(fetchHealthData, 5000);
    } catch (error) {
        console.error('Erro ao reiniciar bot:', error);
        alert(`Erro ao reiniciar bot: ${error.message}`);
    }
}

// Funções para a seção de análise de dados
function updateBotFilters(bots) {
    const botFiltersContainer = document.getElementById('botFilters');
    botFiltersContainer.innerHTML = '';
    
    if (!bots || bots.length === 0) {
        botFiltersContainer.innerHTML = '<p>Nenhum bot disponível para filtrar</p>';
        return;
    }
    
    if (selectedBots.length === 0) {
        selectedBots = bots.map(bot => bot.id);
    }
    
    bots.forEach(bot => {
        const isChecked = selectedBots.includes(bot.id);
        
        const filterItem = document.createElement('div');
        filterItem.className = 'bot-filter';
        filterItem.innerHTML = `
            <input type="checkbox" id="filter-${bot.id}" data-bot-id="${bot.id}" ${isChecked ? 'checked' : ''}>
            <label for="filter-${bot.id}">${bot.id}</label>
        `;
        
        botFiltersContainer.appendChild(filterItem);
        
        const checkbox = filterItem.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                if (!selectedBots.includes(bot.id)) {
                    selectedBots.push(bot.id);
                }
            } else {
                const index = selectedBots.indexOf(bot.id);
                if (index !== -1) {
                    selectedBots.splice(index, 1);
                }
            }
            fetchAnalyticsData();
        });
    });
}

function processAnalyticsData(data) {
    if (!data || !data.daily || !data.weekly || !data.monthly || !data.yearly) {
        console.error('Dados incompletos ou inválidos');
        return {
            daily: { hours: [], series: [] },
            weekly: { days: [], series: [] },
            monthly: { days: [], series: [] },
            yearly: { dates: [], series: [] }
        };
    }
    
    const processedDaily = {
        hours: data.daily.hours || Array.from({ length: 24 }, (_, i) => i),
        series: data.daily.series || []
    };
    
    const processedWeekly = {
        days: data.weekly.days || ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
        series: data.weekly.series || []
    };
    
    const processedMonthly = {
        days: data.monthly.days || Array.from({ length: 31 }, (_, i) => i + 1),
        series: data.monthly.series || []
    };
    
    let yearlyDates = data.yearly.dates;
    if ((!yearlyDates || yearlyDates.length === 0) && data.yearly.series && data.yearly.series.length > 0) {
        const firstSeries = data.yearly.series[0];
        if (firstSeries && firstSeries.data) {
            const dataLength = firstSeries.data.length;
            yearlyDates = Array.from({ length: dataLength }, (_, i) => `Dia ${i+1}`);
        }
    }
    
    const processedYearly = {
        dates: yearlyDates || [],
        series: data.yearly.series || []
    };
    
    return {
        daily: processedDaily,
        weekly: processedWeekly,
        monthly: processedMonthly,
        yearly: processedYearly
    };
}

async function fetchAnalyticsData() {
    try {
        document.querySelectorAll('.chart-container').forEach(container => {
            container.innerHTML = `
                <h3 class="chart-title">${container.querySelector('.chart-title')?.textContent || 'Carregando...'}</h3>
                <div class="loading-container">
                    <div class="loader"></div>
                    <p>Carregando dados...</p>
                </div>
            `;
        });
        
        const params = new URLSearchParams();
        params.append('period', activePeriod);
        selectedBots.forEach(botId => {
            params.append('bots[]', botId);
        });
        
        let data;
        
        try {
            const response = await fetch(`/analytics?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Erro ao obter dados de análise: ${response.status}`);
            }
            data = await response.json();
        } catch (error) {
            console.error('Erro na chamada principal, tentando fallback:', error);
            const fallbackResponse = await fetch('/analytics_period=today.json');
            if (!fallbackResponse.ok) throw new Error('Arquivo de fallback não encontrado');
            data = await fallbackResponse.json();
            console.log('Usando dados de fallback para visualização');
        }
        
        if (!data) throw new Error('Nenhum dado recebido');
        
        const processedData = processAnalyticsData(data);
        renderCharts(processedData);
        
    } catch (error) {
        console.error('Erro ao buscar dados de análise:', error);
        document.querySelectorAll('.chart-container').forEach(container => {
            container.innerHTML = `
                <h3 class="chart-title">${container.querySelector('.chart-title')?.textContent || 'Erro'}</h3>
                <div style="text-align: center; padding: 30px;">
                    <p style="color: #ff5555; font-size: 1.2rem;">❌ Erro ao carregar dados</p>
                    <p>${error.message}</p>
                </div>
            `;
        });
    }
}

function renderCharts(data) {
    const commonOptions = {
        chart: { backgroundColor: 'transparent', style: { fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif' } },
        title: { text: null },
        credits: { enabled: false },
        exporting: { enabled: true, buttons: { contextButton: { menuItems: ['downloadPNG', 'downloadJPEG', 'downloadPDF', 'downloadCSV'] } } },
        legend: { itemStyle: { color: '#b7b7c5' }, itemHoverStyle: { color: '#04a9f0' } },
        xAxis: { labels: { style: { color: '#b7b7c5' } }, lineColor: '#47486c', tickColor: '#47486c' },
        yAxis: { title: { text: 'Mensagens', style: { color: '#b7b7c5' } }, labels: { style: { color: '#b7b7c5' } }, gridLineColor: 'rgba(71, 72, 108, 0.3)' },
        plotOptions: { series: { marker: { enabled: false } } },
        colors: ['#04a9f0', '#3e0ea7', '#47486c', '#b7b7c5', '#6a0dad', '#1e90ff']
    };
    
    renderDailyChart(data.daily, commonOptions);
    renderWeeklyChart(data.weekly, commonOptions);
    renderMonthlyChart(data.monthly, commonOptions);
    renderYearlyChart(data.yearly, commonOptions);
}

function renderDailyChart(data, commonOptions) {
    const container = document.getElementById('dailyMessageChart');
    if (!data || !data.hours || !data.series || data.series.length === 0) {
        container.innerHTML = `<h3 class="chart-title">Média de Mensagens do Dia</h3><p style="text-align: center; padding: 30px; color: #b7b7c5;">Nenhum dado disponível</p>`;
        return;
    }
    Highcharts.chart(container, { ...commonOptions, chart: { ...commonOptions.chart, type: 'spline' }, xAxis: { ...commonOptions.xAxis, categories: data.hours, title: { text: 'Hora do Dia', style: { color: '#b7b7c5' } } }, tooltip: { formatter: function() { return `<b>${this.x}:00</b><br/>${this.series.name}: <b>${this.y}</b> msgs`; }, backgroundColor: 'rgba(35, 6, 109, 0.9)', style: { color: '#fff' }, borderWidth: 0 }, series: data.series });
}

function renderWeeklyChart(data, commonOptions) {
    const container = document.getElementById('weeklyMessageChart');
    if (!data || !data.days || !data.series || data.series.length === 0) {
        container.innerHTML = `<h3 class="chart-title">Média de Mensagens da Semana</h3><p style="text-align: center; padding: 30px; color: #b7b7c5;">Nenhum dado disponível</p>`;
        return;
    }
    Highcharts.chart(container, { ...commonOptions, chart: { ...commonOptions.chart, type: 'column' }, xAxis: { ...commonOptions.xAxis, categories: data.days, title: { text: 'Dia da Semana', style: { color: '#b7b7c5' } } }, tooltip: { formatter: function() { return `<b>${this.x}</b><br/>${this.series.name}: <b>${this.y}</b> msgs`; }, backgroundColor: 'rgba(35, 6, 109, 0.9)', style: { color: '#fff' }, borderWidth: 0 }, series: data.series });
}

function renderMonthlyChart(data, commonOptions) {
    const container = document.getElementById('monthlyMessageChart');
    if (!data || !data.days || !data.series || data.series.length === 0) {
        container.innerHTML = `<h3 class="chart-title">Média de Mensagens do Mês</h3><p style="text-align: center; padding: 30px; color: #b7b7c5;">Nenhum dado disponível</p>`;
        return;
    }
    Highcharts.chart(container, { ...commonOptions, chart: { ...commonOptions.chart, type: 'spline' }, xAxis: { ...commonOptions.xAxis, categories: data.days, title: { text: 'Dia do Mês', style: { color: '#b7b7c5' } } }, tooltip: { formatter: function() { return `<b>Dia ${this.x}</b><br/>${this.series.name}: <b>${this.y}</b> msgs`; }, backgroundColor: 'rgba(35, 6, 109, 0.9)', style: { color: '#fff' }, borderWidth: 0 }, series: data.series });
}

function renderYearlyChart(data, commonOptions) {
    const container = document.getElementById('yearlyMessageChart');
    if (!data || (!data.dates || data.dates.length === 0) || !data.series || data.series.length === 0) {
        container.innerHTML = `<h3 class="chart-title">Total de Mensagens por Dia do Ano</h3><p style="text-align: center; padding: 30px; color: #b7b7c5;">Nenhum dado disponível</p>`;
        return;
    }
    Highcharts.chart(container, { ...commonOptions, chart: { ...commonOptions.chart, type: 'areaspline', zoomType: 'x' }, xAxis: { ...commonOptions.xAxis, categories: data.dates, labels: { ...commonOptions.xAxis.labels, rotation: -45, step: Math.ceil(data.dates.length / 30) }, title: { text: 'Data', style: { color: '#b7b7c5' } } }, tooltip: { formatter: function() { return `<b>${this.x}</b><br/>${this.series.name}: <b>${this.y}</b> msgs`; }, backgroundColor: 'rgba(35, 6, 109, 0.9)', style: { color: '#fff' }, borderWidth: 0 }, series: data.series });
}

async function fetchBotDetailedStats() {
    try {
        const response = await fetch('/api/bot-stats');
        if (!response.ok) throw new Error('Erro ao buscar estatísticas');
        const data = await response.json();
        renderBotStatsTable(data);
    } catch (error) {
        console.error('Erro:', error);
        document.querySelector('#botStatsTable tbody').innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ff5555;">Erro ao carregar dados</td></tr>`;
    }
}

function renderBotStatsTable(data) {
    const tbody = document.querySelector('#botStatsTable tbody');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Nenhum dado disponível</td></tr>';
        return;
    }

    const formatNum = (num) => new Intl.NumberFormat('pt-BR').format(num);

    // Separar o total
    let totalRow = data.find(row => row.id === 'TOTAL');
    let botRows = data.filter(row => row.id !== 'TOTAL');

    // Ordenar bots por mensagens de hoje (day) decrescente
    botRows.sort((a, b) => (b.day || 0) - (a.day || 0));

    // Reintegrar total no final (ou inicio se preferir, mas geralmente total fica embaixo)
    const rowsToRender = [...botRows];
    if (totalRow) rowsToRender.push(totalRow);

    rowsToRender.forEach(row => {
        const tr = document.createElement('tr');
        if (row.id === 'TOTAL') {
            tr.style.fontWeight = 'bold';
            tr.classList.add('total-row');
        }
        
        tr.innerHTML = `
            <td>${row.id}</td>
            <td>${formatNum(row.groupsCount)}</td>
            <td>${formatNum(row.hour)}</td>
            <td>${formatNum(row.day)}</td>
            <td>${formatNum(row.week)}</td>
            <td>${formatNum(row.month)}</td>
            <td>${formatNum(row.year)}</td>
        `;
        tbody.appendChild(tr);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    checkAdminMode();
    fetchTopDonates();
    fetchHealthData();
    fetchBotDetailedStats();
    
    const timeFilters = document.querySelectorAll('.time-filter');
    timeFilters.forEach(filter => {
        filter.addEventListener('click', () => {
            timeFilters.forEach(f => f.classList.remove('active'));
            filter.classList.add('active');
            activePeriod = filter.dataset.period;
            fetchAnalyticsData();
        });
    });
    
    setTimeout(fetchAnalyticsData, 1500);
    
    const refreshButton = document.getElementById('refreshButton');
    if (refreshButton) {
        refreshButton.addEventListener('click', fetchHealthData);
    }
    
    const cancelButton = document.getElementById('cancelRestart');
    const confirmButton = document.getElementById('confirmRestart');
    if (cancelButton && confirmButton) {
        cancelButton.addEventListener('click', closeRestartModal);
        confirmButton.addEventListener('click', restartBot);
    }
    
    setInterval(fetchHealthData, 30000);
    setInterval(fetchTopDonates, 5 * 60 * 1000); // Atualiza doações a cada 5 minutos
});

