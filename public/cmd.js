document.addEventListener('DOMContentLoaded', () => {
    const commandList = document.getElementById('command-list');
    const loading = document.getElementById('loading');
    const toast = document.getElementById('toast');
    const tooltip = document.getElementById('tooltip');
    
    // Help data from help.js (expected to be loaded)
    // Structure: const helpCommands = { 'command': { usage: '...', desc: '...', example: '...' } }
    
    let lastTap = 0;
    let activeTooltip = null;

    async function fetchCommands() {
        try {
            const response = await fetch('/api/public-commands');
            if (!response.ok) throw new Error('Falha ao carregar comandos');
            const data = await response.json();
            renderCommands(data);
        } catch (error) {
            loading.innerHTML = `<p style="color: var(--danger-color)">Erro: ${error.message}</p>`;
        }
    }

    function renderCommands(data) {
        loading.remove();
        
        // Render Fixed Commands Categories
        data.categories.forEach((category, index) => {
            const section = createCategorySection(category, index === 0);
            commandList.appendChild(section);
        });

        // Render Management Commands
        if (data.management && Object.keys(data.management).length > 0) {
            const mgmtSection = createManagementSection(data.management);
            commandList.appendChild(mgmtSection);
        }
    }

    function createCategorySection(category, isOpen) {
        const section = document.createElement('div');
        section.className = `category-section ${isOpen ? 'active' : ''}`;
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <div class="category-title">${category.emoji} ${category.name}</div>
            <i class="fas fa-chevron-down arrow"></i>
        `;
        
        header.addEventListener('click', () => {
            section.classList.toggle('active');
        });

        const content = document.createElement('div');
        content.className = 'category-content';
        
        const list = document.createElement('ul');
        list.className = 'command-list';
        
        category.commands.forEach(cmd => {
            const item = createCommandItem(cmd);
            list.appendChild(item);
        });

        content.appendChild(list);
        section.appendChild(header);
        section.appendChild(content);

        return section;
    }

    function createManagementSection(mgmtCommands) {
        const section = document.createElement('div');
        section.className = 'category-section';
        
        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <div class="category-title">⚙️ Gerenciamento</div>
            <i class="fas fa-chevron-down arrow"></i>
        `;
        
        header.addEventListener('click', () => {
            section.classList.toggle('active');
        });

        const content = document.createElement('div');
        content.className = 'category-content';
        
        const list = document.createElement('ul');
        list.className = 'command-list';
        
        // Convert object to array and sort
        const commands = Object.entries(mgmtCommands).map(([name, data]) => ({
            name: `g-${name}`,
            description: data.description,
            isManagement: true
        }));
        
        commands.forEach(cmd => {
            const item = createCommandItem(cmd);
            list.appendChild(item);
        });

        content.appendChild(list);
        section.appendChild(header);
        section.appendChild(content);

        return section;
    }

    function createCommandItem(cmd) {
        const li = document.createElement('li');
        li.className = 'command-item';
        
        // Handle aliases formatting
        let aliasesHtml = '';
        if (cmd.aliases && cmd.aliases.length > 0) {
            aliasesHtml = `<span class="cmd-aliases">(!${cmd.aliases.join(', !')})</span>`;
        }

        // Handle reaction
        let reactionHtml = '';
        if (cmd.reaction) {
            reactionHtml = `
                <div class="cmd-emoji-container">
                    <span class="cmd-reaction">${cmd.reaction}</span>
                </div>
            `;
        }

        li.innerHTML = `
            <div class="cmd-main-info">
                <div class="cmd-name-line">
                    <span class="cmd-name">!${cmd.name}</span>
                    ${aliasesHtml}
                </div>
                <div class="cmd-desc">${cmd.description || 'Sem descrição.'}</div>
            </div>
            ${reactionHtml}
        `;

        // Tooltip logic
        // Try to get help data from help.js if available
        let helpData = null;
        if (typeof helpCommands !== 'undefined') {
            const key = cmd.name.replace('g-', ''); // Adjust key for mgmt commands if needed
            helpData = helpCommands[key] || helpCommands[cmd.name];
        }

        // Events
        li.addEventListener('click', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            
            if (tapLength < 500 && tapLength > 0) {
                // Double tap
                copyToClipboard(`!${cmd.name}`);
                e.preventDefault();
            } else {
                // Single tap - Show tooltip on mobile or click behavior
                // For simplicity, we just toggle tooltip if available
                if (helpData || cmd.description) {
                    showTooltip(li, cmd, helpData);
                }
            }
            lastTap = currentTime;
        });

        li.addEventListener('mouseenter', () => {
             if (helpData || cmd.description) {
                showTooltip(li, cmd, helpData);
            }
        });

        li.addEventListener('mouseleave', () => {
            hideTooltip();
        });

        return li;
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast();
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }

    function showToast() {
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 2000);
    }

    function showTooltip(element, cmd, helpData) {
        if (!helpData && !cmd.description) return;

        const rect = element.getBoundingClientRect();
        
        let content = `<div class="tooltip-title">!${cmd.name}</div>`;
        
        if (helpData && helpData.usage) {
             content += `<span class="tooltip-usage">Uso: ${helpData.usage}</span>`;
        }
        
        content += `<div>${helpData?.desc || cmd.description}</div>`;
        
        if (helpData && helpData.example) {
            content += `<div style="margin-top:5px; font-style:italic; font-size:0.8em; color:var(--primary-color)">Ex: ${helpData.example}</div>`;
        }

        tooltip.innerHTML = content;
        tooltip.classList.add('visible');
        
        // Position logic
        const tooltipHeight = tooltip.offsetHeight;
        let top = rect.top - tooltipHeight - 10;
        let left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
        
        // Prevent top overflow
        if (top < 0) {
            top = rect.bottom + 10;
        }

        // Prevent horizontal overflow
        if (left < 10) left = 10;
        if (left + tooltip.offsetWidth > window.innerWidth) {
            left = window.innerWidth - tooltip.offsetWidth - 10;
        }

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    function hideTooltip() {
        tooltip.classList.remove('visible');
    }

    fetchCommands();
});