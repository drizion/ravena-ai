document.addEventListener('DOMContentLoaded', () => {
    const commandList = document.getElementById('command-list');
    const loading = document.getElementById('loading');
    const toast = document.getElementById('toast');
    const tooltip = document.getElementById('tooltip');
    
    // Search elements
    const searchInput = document.getElementById('command-search');
    const noResults = document.getElementById('no-results');
    const searchTermSpan = document.getElementById('search-term');

    // Help data from help.js (expected to be loaded)
    // Structure: const helpCommands = { 'command': { usage: '...', desc: '...', example: '...' } }
    
    let lastTap = 0;
    let allCommands = []; // To store all loaded commands for random placeholder

    async function fetchCommands() {
        try {
            const response = await fetch('/api/public-commands');
            if (!response.ok) throw new Error('Falha ao carregar comandos');
            const data = await response.json();
            renderCommands(data);
            startRandomPlaceholder();
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
            // Collect command names for placeholder
            category.commands.forEach(cmd => allCommands.push(cmd.name));
        });

        // Render Management Commands
        if (data.management && Object.keys(data.management).length > 0) {
            const mgmtSection = createManagementSection(data.management);
            commandList.appendChild(mgmtSection);
             // Collect management command names
            Object.keys(data.management).forEach(name => allCommands.push(`g-${name}`));
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
        // Add data attributes for search
        li.dataset.name = cmd.name.toLowerCase();
        li.dataset.aliases = (cmd.aliases || []).join(',').toLowerCase();
        li.dataset.desc = (cmd.description || '').toLowerCase();
        
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

    // Search Logic
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        let hasGlobalResults = false;

        const categories = document.querySelectorAll('.category-section');
        
        categories.forEach(category => {
            const commands = category.querySelectorAll('.command-item');
            let hasVisibleCommands = false;

            commands.forEach(cmd => {
                const name = cmd.dataset.name;
                const aliases = cmd.dataset.aliases;
                const desc = cmd.dataset.desc;

                if (name.includes(term) || aliases.includes(term) || desc.includes(term)) {
                    cmd.classList.remove('hidden');
                    hasVisibleCommands = true;
                    hasGlobalResults = true;
                } else {
                    cmd.classList.add('hidden');
                }
            });

            if (hasVisibleCommands) {
                category.classList.remove('hidden');
                if (term.length > 0) {
                     category.classList.add('active'); // Expand if searching
                }
            } else {
                category.classList.add('hidden');
            }
        });

        if (!hasGlobalResults && term.length > 0) {
            noResults.classList.remove('hidden');
            searchTermSpan.textContent = term;
        } else {
            noResults.classList.add('hidden');
        }
    });

    // Focus on keypress
    document.addEventListener('keydown', (e) => {
        // Ignore if Ctrl/Alt/Meta is pressed or if already focused on input
        if (e.ctrlKey || e.altKey || e.metaKey || e.target === searchInput) return;
        
        // Ignore specific keys that shouldn't trigger search
        if (e.key.length > 1 && e.key !== 'Backspace') return; 

        searchInput.focus();
    });

    // Random Placeholder
    function startRandomPlaceholder() {
        if (allCommands.length === 0) return;
        
        setInterval(() => {
            if (document.activeElement !== searchInput && searchInput.value === '') {
                const randomCmd = allCommands[Math.floor(Math.random() * allCommands.length)];
                searchInput.setAttribute('placeholder', `Buscar comando... ex: !${randomCmd}`);
            }
        }, 3000);
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