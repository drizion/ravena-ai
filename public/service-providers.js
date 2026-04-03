document.addEventListener('DOMContentLoaded', () => {
    const loadingContainer = document.getElementById('loading-container');
    const errorContainer = document.getElementById('error-container');
    const dashboardContent = document.getElementById('dashboard-content');
    const categoriesContainer = document.getElementById('categories-container');
    const providerModal = document.getElementById('provider-modal');
    const btnSaveAll = document.getElementById('btn-save-all');
    
    let config = {};
    const categories = ['llm', 'whisper', 'comfyui', 'sdwebui', 'alltalk'];
    const categoryNames = {
        'llm': 'Inteligência Artificial (LLM)',
        'whisper': 'Transcrição de Áudio (Whisper)',
        'comfyui': 'Geração de Imagens (ComfyUI)',
        'sdwebui': 'Geração de Imagens (SD WebUI)',
        'alltalk': 'Conversão de Texto em Fala (AllTalk TTS)'
    };

    // Basic auth is handled by the browser since the page itself is protected.
    // The browser will automatically send the credentials for all subsequent fetch requests to the same origin.

    async function fetchData() {
        showLoading(true);
        try {
            const response = await fetch('/api/service-providers');
            if (!response.ok) throw new Error('Não autorizado ou erro no servidor');
            config = await response.json();
            renderCategories();
            showLoading(false);
        } catch (err) {
            showError(err.message);
        }
    }

    function renderCategories() {
        categoriesContainer.innerHTML = '';
        categories.forEach(cat => {
            const section = document.createElement('div');
            section.className = 'category-section';
            
            const providers = config[cat] || [];
            
            section.innerHTML = `
                <div class="category-header">
                    <h3><i class="fas fa-server"></i> ${categoryNames[cat]}</h3>
                    <button class="btn-add" onclick="openModal('${cat}')"><i class="fas fa-plus"></i> Adicionar</button>
                </div>
                <div class="provider-list" id="list-${cat}">
                    ${providers.map((p, index) => renderProviderCard(cat, p, index)).join('')}
                </div>
            `;
            categoriesContainer.appendChild(section);
        });
    }

    function renderProviderCard(cat, p, index) {
        const isEnabled = p.enabled !== false;
        
        // Determinar status (Verde para o primeiro habilitado, Amarelo para os demais habilitados)
        let statusHtml = '';
        if (isEnabled) {
            const enabledProviders = config[cat].filter(prov => prov.enabled !== false);
            const isFirst = config[cat].findIndex(prov => prov.enabled !== false) === index;
            if (isFirst) {
                statusHtml = '<span class="status-badge status-main">Principal</span>';
            } else {
                statusHtml = '<span class="status-badge status-backup">Backup</span>';
            }
        }

        return `
            <div class="provider-card ${isEnabled ? '' : 'disabled'}">
                <div class="provider-info">
                    <div class="provider-name">${p.name} ${statusHtml}</div>
                    <div class="provider-type">${p.url} ${p.model ? `(${p.model})` : ''}</div>
                </div>
                <div>
                  <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleProvider('${cat}', ${index})"> Ativo
                </div>
                <div class="provider-actions">
                    <button class="btn btn-sm btn-info" onclick="openModal('${cat}', ${index})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-danger" onclick="deleteProvider('${cat}', ${index})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    }

    window.openModal = (category, index = -1) => {
        document.getElementById('edit-category').value = category;
        document.getElementById('edit-index').value = index;
        
        const isEdit = index !== -1;
        document.getElementById('modal-title').innerText = isEdit ? 'Editar Provedor' : 'Adicionar Provedor';
        document.getElementById('btn-save-prov').innerText = isEdit ? 'Salvar' : 'Adicionar';
        document.getElementById('btn-delete-prov').classList.toggle('hidden', !isEdit);
        
        const llmFields = document.getElementById('llm-extra-fields');
        llmFields.classList.toggle('hidden', category !== 'llm');

        if (isEdit) {
            const p = config[category][index];
            document.getElementById('prov-name').value = p.name || '';
            document.getElementById('prov-url').value = p.url || '';
            document.getElementById('prov-enabled').checked = p.enabled !== false;
            
            if (category === 'llm') {
                document.getElementById('prov-type').value = p.type || 'ollama';
                document.getElementById('prov-model').value = p.model || '';
                document.getElementById('prov-timeout').value = p.timeout_multiplier || '';
                document.getElementById('prov-ignore-video').checked = !!p.ignoreVideo;
            }
        } else {
            document.getElementById('prov-name').value = '';
            document.getElementById('prov-url').value = '';
            document.getElementById('prov-enabled').checked = true;
            document.getElementById('prov-type').value = 'ollama';
            document.getElementById('prov-model').value = '';
            document.getElementById('prov-timeout').value = '';
            document.getElementById('prov-ignore-video').checked = false;
        }

        providerModal.classList.remove('hidden');
    };

    window.toggleProvider = (category, index) => {
        config[category][index].enabled = !config[category][index].enabled;
        renderCategories();
    };

    window.deleteProvider = (category, index) => {
        if (confirm('Tem certeza que deseja remover este provedor?')) {
            config[category].splice(index, 1);
            renderCategories();
        }
    };

    document.getElementById('btn-save-prov').onclick = () => {
        const category = document.getElementById('edit-category').value;
        const index = parseInt(document.getElementById('edit-index').value);
        
        const provider = {
            name: document.getElementById('prov-name').value,
            url: document.getElementById('prov-url').value,
            enabled: document.getElementById('prov-enabled').checked
        };

        if (category === 'llm') {
            provider.type = document.getElementById('prov-type').value;
            provider.model = document.getElementById('prov-model').value;
            const timeout = parseFloat(document.getElementById('prov-timeout').value);
            if (!isNaN(timeout)) provider.timeout_multiplier = timeout;
            provider.ignoreVideo = document.getElementById('prov-ignore-video').checked;
        }

        if (index === -1) {
            if (!config[category]) config[category] = [];
            config[category].push(provider);
        } else {
            config[category][index] = provider;
        }

        providerModal.classList.add('hidden');
        renderCategories();
    };

    btnSaveAll.onclick = async () => {
        btnSaveAll.disabled = true;
        btnSaveAll.innerHTML = '<i class="fas fa-spinner fa-spin"></i> SALVANDO...';
        
        try {
            const response = await fetch('/api/service-providers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            const result = await response.json();
            if (result.status === 'ok') {
                alert('Configurações salvas com sucesso!');
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            alert('Erro ao salvar: ' + err.message);
        } finally {
            btnSaveAll.disabled = false;
            btnSaveAll.innerHTML = '<i class="fas fa-save"></i> SALVAR TODAS AS ALTERAÇÕES';
        }
    };

    // UI helpers
    function showLoading(show) {
        loadingContainer.classList.toggle('hidden', !show);
        dashboardContent.classList.toggle('hidden', show);
    }

    function showError(msg) {
        showLoading(false);
        errorContainer.classList.remove('hidden');
        document.getElementById('error-message').innerText = msg;
    }

    // NEW: Queue and Stats logic
    async function fetchQueue() {
        try {
            const response = await fetch('/api/llm/queue');
            if (!response.ok) return;
            const data = await response.json();
            renderQueue(data);
            document.getElementById('queue-last-update').innerText = 'Última atualização: ' + new Date().toLocaleTimeString();
        } catch (err) {
            console.error('Erro ao buscar fila:', err);
        }
    }

    function renderQueue(data) {
        const body = document.getElementById('llm-queue-body');
        body.innerHTML = '';
        
        // Priorities are usually 0, 1, 2, 3
        const priorities = Object.keys(data.queues).sort();
        
        priorities.forEach(p => {
            const q = data.queues[p];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>Prioridade ${p}</td>
                <td>${q.pending}</td>
                <td>${q.processing}</td>
                <td>${q.fulfilled}</td>
            `;
            body.appendChild(tr);
        });

        if (priorities.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="text-center">Nenhuma requisição na fila</td></tr>';
        }
    }

    async function fetchStats() {
        try {
            const response = await fetch('/api/llm/stats?timeframe=3600000');
            if (!response.ok) return;
            const data = await response.json();
            renderStats(data);
            document.getElementById('stats-last-update').innerText = 'Última atualização: ' + new Date().toLocaleTimeString();
        } catch (err) {
            console.error('Erro ao buscar estatísticas:', err);
        }
    }

    function renderStats(data) {
        document.getElementById('stat-total-req').innerText = data.total_requests || 0;
        document.getElementById('stat-total-in').innerText = (data.total_input_tokens || 0).toLocaleString();
        document.getElementById('stat-total-out').innerText = (data.total_output_tokens || 0).toLocaleString();

        const body = document.getElementById('llm-stats-body');
        body.innerHTML = '';

        const providers = Object.keys(data.by_provider);
        if (providers.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="text-center">Nenhuma requisição na última hora</td></tr>';
            return;
        }

        providers.forEach(prov => {
            const pData = data.by_provider[prov];
            const types = Object.keys(pData.by_type);
            
            types.forEach((type, index) => {
                const tData = pData.by_type[type];
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    ${index === 0 ? `<td rowspan="${types.length}" style="vertical-align: middle; font-weight: bold;">${prov}</td>` : ''}
                    <td><span class="status-badge" style="background: #444;">${type}</span></td>
                    <td>${tData.requests}</td>
                    <td>${tData.input_tokens.toLocaleString()}</td>
                    <td>${tData.output_tokens.toLocaleString()}</td>
                `;
                body.appendChild(tr);
            });
        });
    }

    // Auto-refresh stats and queue every 30 seconds
    setInterval(() => {
        fetchQueue();
        fetchStats();
    }, 30000);

    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.onclick = () => providerModal.classList.add('hidden');
    });

    document.getElementById('retry-button').onclick = fetchData;

    fetchData();
    fetchQueue();
    fetchStats();
});
