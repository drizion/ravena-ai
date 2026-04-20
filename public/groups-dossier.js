document.addEventListener('DOMContentLoaded', () => {
    const groupsContainer = document.getElementById('groups-container');
    const loadingContainer = document.getElementById('loading-container');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    const dashboardContent = document.getElementById('dashboard-content');
    const retryButton = document.getElementById('retry-button');

    async function fetchDossiers() {
        loadingContainer.classList.remove('hidden');
        dashboardContent.classList.add('hidden');
        errorContainer.classList.add('hidden');

        try {
            const response = await fetch('/api/groups-dossier');
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Não autorizado. Verifique suas credenciais.');
                }
                throw new Error('Erro ao buscar dados da API');
            }

            const data = await response.json();
            renderGroups(data);

            loadingContainer.classList.add('hidden');
            dashboardContent.classList.remove('hidden');
        } catch (error) {
            loadingContainer.classList.add('hidden');
            errorContainer.classList.remove('hidden');
            errorMessage.textContent = error.message;
        }
    }

    function getScoreClass(score) {
        if (score >= 7) return 'score-high';
        if (score >= 4) return 'score-medium';
        return 'score-low';
    }

    function renderGroups(groups) {
        groupsContainer.innerHTML = '';

        if (groups.length === 0) {
            groupsContainer.innerHTML = '<div class="alert alert-info">Nenhum grupo com histórico encontrado.</div>';
            return;
        }

        groups.forEach(group => {
            const section = document.createElement('div');
            section.className = 'group-section';

            const scoreClass = getScoreClass(group.problematic_score);

            section.innerHTML = `
                <div class="group-header">
                    <div class="group-info">
                        <span class="group-name">${group.name}</span>
                        <span class="bot-badge">${group.bot_id}</span>
                        <span class="group-score ${scoreClass}">Nota: ${group.problematic_score}</span>
                        <span class="stats-badge">${group.total_chars.toLocaleString()} chars totais | ${group.pending_chars.toLocaleString()} pnd</span>
                    </div>
                    <div class="toggle-icon"><i class="fas fa-chevron-down"></i></div>
                </div>
                <div class="group-content">
                    <div class="dossier-grid">
                        <div class="dossier-item">
                            <div class="dossier-label">Tipo de Conteúdo</div>
                            <div class="dossier-value"><i class="fas fa-tag"></i> ${group.type}</div>
                        </div>
                        <div class="dossier-item">
                            <div class="dossier-label">Resumo das Discussões</div>
                            <div class="dossier-value">${group.summary}</div>
                        </div>
                    </div>
                    <div style="margin-top: 15px; font-size: 0.75em; color: #666;">
                        ID: ${group.id}
                    </div>
                </div>
            `;

            const header = section.querySelector('.group-header');
            header.addEventListener('click', () => {
                section.classList.toggle('active');
            });

            groupsContainer.appendChild(section);
        });
    }

    retryButton.addEventListener('click', fetchDossiers);

    // Initial fetch
    fetchDossiers();
});
