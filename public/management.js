document.addEventListener('DOMContentLoaded', () => {  
    // Get token from URL: /manage/:token  
    const pathParts = window.location.pathname.split('/');  
    const token = pathParts[pathParts.length - 1];  
    
    // Globals  
    let groupData = null;  
    let originalGroupData = null;  
    let groupId = null;  
    let expiresAt = null;  
    
    // Initialize the page  
    initPage();  
    
    // Functions  
    async function initPage() {  
        try {  
            // Validate token  
            const validation = await validateToken(token);  
            
            if (!validation.valid) {  
                showError(validation.message || 'Token inválido ou expirado');  
                return;  
            }  
            
            // Set header info  
            document.getElementById('user-name').textContent = validation.authorName;  
            document.getElementById('user-number').textContent = formatPhoneNumber(validation.requestNumber);  
            document.getElementById('group-name').textContent = validation.groupName;  
            
            // Set expiration time  
            expiresAt = new Date(validation.expiresAt);  
            updateExpirationTime();  
            setInterval(updateExpirationTime, 60000); // Update every minute  
            
            // Get group data  
            groupId = validation.groupId;  
            await loadGroupData(groupId);  
            
            // Hide loading, show form  
            document.getElementById('loading-container').classList.add('hidden');  
            document.getElementById('group-form-container').classList.remove('hidden');  
            
            // Setup form events  
            setupFormEvents();  
            
        } catch (error) {  
            console.error('Error initializing page:', error);  
            showError('Ocorreu um erro ao inicializar a página. Por favor, tente novamente.');  
        }  
    }  

    /**
     * Sanitizes a URL or username into a clean channel handle.
     * @param {string} inputString - The URL or username to sanitize.
     * @param {string} platform - 'twitch', 'kick', or 'youtube' (default: 'twitch').
     */
    function sanitizePlatformChannelName(inputString, platform = 'twitch') {
      if (typeof inputString !== 'string') {
        return "";
      }

      // Configuration for each platform's URL patterns and allowed characters
      const platformRules = {
        twitch: {
          // Removes twitch.tv/
          urlPattern: /^(https?:\/\/)?(www\.)?twitch\.tv\//i, 
          // Twitch only allows alphanumeric and underscores
          illegalChars: /[^a-z0-9_]/g 
        },
        kick: {
          // Removes kick.com/
          urlPattern: /^(https?:\/\/)?(www\.)?kick\.com\//i,
          // Kick follows same rules as Twitch (alphanumeric + underscore)
          illegalChars: /[^a-z0-9_]/g 
        },
        youtube: {
          // Removes youtube.com, youtu.be, and handle prefixes like /@, /c/, /user/
          urlPattern: /^(https?:\/\/)?(www\.)?(youtube\.com\/(c\/|user\/|@|channel\/)?|youtu\.be\/)/i,
          // YouTube handles allow hyphens (-) and dots (.)
          illegalChars: /[^a-z0-9_\-\.]/g 
        }
      };

      // Get rules for the requested platform (fallback to twitch if invalid platform passed)
      const rules = platformRules[platform.toLowerCase()] || platformRules.twitch;

      // 1. Remove the URL domain/protocol
      let cleaned = inputString.replace(rules.urlPattern, "");

      // 2. Lowercase everything (Standardizes input)
      cleaned = cleaned.toLowerCase();

      // 3. Remove any characters that are not allowed on that specific platform
      const sanitized = cleaned.replace(rules.illegalChars, "");

      return sanitized ?? "";
    }
    
    async function validateToken(token) {  
        const response = await fetch(`/api/validate-token?token=${token}`);  
        return await response.json();  
    }  
    
    async function loadGroupData(id) {  
        try {  
            const response = await fetch(`/api/group?id=${id}&token=${token}`);  
            
            if (!response.ok) {  
                const error = await response.json();  
                throw new Error(error.message || 'Failed to load group data');  
            }  
            
            groupData = await response.json();  
            originalGroupData = JSON.parse(JSON.stringify(groupData)); // Deep clone  
            
            // Populate form with group data  
            populateForm(groupData);  
        } catch (error) {  
            console.error('Error loading group data:', error);  
            showError('Erro ao carregar os dados do grupo. Por favor, tente novamente.');  
        }  
    }  
    
    function populateForm(data) {
        console.log(data);
        // Basic fields  
        document.getElementById('group-id').value = data.id || '';  
        document.getElementById('group-created-at').value = formatDate(data.createdAt) || '';  
        document.getElementById('group-name-input').value = data.name || '';  
        
        // Check if greetings and farewells exist
        if (data.greetings && data.greetings.text) {
            document.getElementById('group-greet-message').value = data.greetings.text;
        } else {
            document.getElementById('group-greet-message').value = '';
        }
        
        if (data.farewells && data.farewells.text) {
            document.getElementById('group-farewell-message').value = data.farewells.text;
        } else {
            document.getElementById('group-farewell-message').value = '';
        }
        
        // Checkboxes  
        document.getElementById('group-isNSFW').checked = data.filters && data.filters.nsfw === true;
        document.getElementById('group-deleteLinks').checked = data.filters && data.filters.links === true;
        document.getElementById('group-isActive').checked = data.isActive !== false; // Default to true  
        document.getElementById('group-autoTranscribe').checked = data.autoStt === true;  
        
        // Text filters  
        const textFiltersContainer = document.getElementById('text-filters-container');  
        textFiltersContainer.innerHTML = '';  
        
        if (data.filters && data.filters.words && Array.isArray(data.filters.words)) {  
            data.filters.words.forEach(filter => {  
                addTagToContainer(textFiltersContainer, filter, () => {  
                    // Remove from data  
                    groupData.filters.words = groupData.filters.words.filter(f => f !== filter);  
                });  
            });  
        }  
        
        // People filters
        const peopleFiltersContainer = document.getElementById('people-filters-container');
        peopleFiltersContainer.innerHTML = '';
        
        if (data.filters && data.filters.people && Array.isArray(data.filters.people)) {
            data.filters.people.forEach(filter => {
                addTagToContainer(peopleFiltersContainer, filter, () => {
                    // Remove from data
                    groupData.filters.people = groupData.filters.people.filter(f => f !== filter);
                });
            });
        }
        
        // Nicks  
        const nicksContainer = document.getElementById('nicks-container');  
        nicksContainer.innerHTML = '';  
        
        if (data.nicks && Array.isArray(data.nicks)) {  
            data.nicks.forEach(nick => {  
                addNickEntry(nicksContainer, nick.numero, nick.apelido);  
            });  
        }  
        
        // Media sections - Setup for each platform
        setupStreamPlatforms();
    }  
    
    function setupStreamPlatforms() {
        // Setup Twitch
        setupPlatformSection('twitch');
        
        // Setup YouTube
        setupPlatformSection('youtube');
        
        // Setup Kick
        setupPlatformSection('kick');
    }
    
    function setupPlatformSection(platform) {
        const container = document.getElementById(`${platform}-container`);
        container.innerHTML = '';
        
        // Check if platform data exists
        if (!groupData[platform] || !Array.isArray(groupData[platform]) || groupData[platform].length === 0) {
            container.innerHTML = `
                <p class="empty-media-message">Nenhum canal de ${getPlatformDisplayName(platform)} configurado.</p>
                <button type="button" id="add-${platform}-channel" class="btn btn-secondary">
                    <i class="fas fa-plus"></i> Adicionar Canal '${platform}'
                </button>
            `;
            
            // Add event listener for adding a new channel
            document.getElementById(`add-${platform}-channel`).addEventListener('click', () => {
                showAddChannelModal(platform);
            });
            
            return;
        }
        
        // For each channel in the platform
        groupData[platform].forEach((channelConfig, index) => {
            const channelSection = document.createElement('div');
            channelSection.className = 'channel-section';
            channelSection.dataset.platform = platform;
            channelSection.dataset.channel = channelConfig.channel;
            channelSection.dataset.index = index;
            
            // Channel header
            const channelHeader = document.createElement('div');
            channelHeader.className = 'channel-header';
            channelHeader.innerHTML = `
                <h4>${channelConfig.channel}</h4>
                <div class="channel-actions">
                    <button type="button" class="btn btn-secondary btn-restore-defaults" title="Restaurar Padrões">
                        <i class="fas fa-undo"></i> Restaurar Padrões
                    </button>
                    <button type="button" class="btn btn-secondary btn-remove-channel" title="Remover Canal">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            // Channel options
            const channelOptions = document.createElement('div');
            channelOptions.className = 'channel-options';
            channelOptions.innerHTML = `
                <div class="form-group checkbox-group">
                    <input type="checkbox" id="${platform}-${index}-change-title" ${channelConfig.changeTitleOnEvent ? 'checked' : ''}>
                    <label for="${platform}-${index}-change-title">Alterar título do grupo</label>
                </div>
                ${platform !== 'youtube' ? `
                <div class="form-group checkbox-group">
                    <input type="checkbox" id="${platform}-${index}-use-thumbnail" ${channelConfig.useThumbnail ? 'checked' : ''}>
                    <label for="${platform}-${index}-use-thumbnail">Usar thumbnail</label>
                </div>` : ''}
                <div class="form-group checkbox-group">
                    <input type="checkbox" id="${platform}-${index}-use-ai" ${channelConfig.useAI ? 'checked' : ''}>
                    <label for="${platform}-${index}-use-ai">Usar IA</label>
                </div>
            `;
            
            // Title inputs (shown only when changeTitleOnEvent is checked)
            const titleInputs = document.createElement('div');
            titleInputs.className = 'title-inputs';
            titleInputs.id = `${platform}-${index}-title-inputs`;
            titleInputs.style.display = channelConfig.changeTitleOnEvent ? 'block' : 'none';
            titleInputs.innerHTML = `
                <div class="form-group">
                    <label for="${platform}-${index}-online-title">Título quando online:</label>
                    <input type="text" id="${platform}-${index}-online-title" 
                           placeholder="Título quando online (opcional)" 
                           value="${channelConfig.onlineTitle || ''}"
                           minlength="2" maxlength="100">
                </div>
                <div class="form-group">
                    <label for="${platform}-${index}-offline-title">Título quando offline:</label>
                    <input type="text" id="${platform}-${index}-offline-title" 
                           placeholder="Título quando offline (opcional)" 
                           value="${channelConfig.offlineTitle || ''}"
                           minlength="2" maxlength="100">
                </div>
            `;
            
            // Media sections for online and offline
            const mediaContainer = document.createElement('div');
            mediaContainer.className = 'channel-media-container';
            
            // Online media
            const onlineMedia = document.createElement('div');
            onlineMedia.className = 'media-event-section';
            onlineMedia.innerHTML = `<h5>Quando ${platform === 'youtube' ? 'novo vídeo' : 'online'}</h5>`;
            
            const onlineMediaList = document.createElement('div');
            onlineMediaList.className = 'media-list';
            onlineMediaList.dataset.platform = platform;
            onlineMediaList.dataset.channel = channelConfig.channel;
            onlineMediaList.dataset.event = 'on';
            
            // Add online media items
            if (channelConfig.onConfig && channelConfig.onConfig.media && Array.isArray(channelConfig.onConfig.media)) {
                channelConfig.onConfig.media.forEach((media, mediaIndex) => {
                    const mediaItem = createMediaItem(platform, channelConfig.channel, 'on', media, mediaIndex);
                    onlineMediaList.appendChild(mediaItem);
                });
            }
            
            // Add button to add new media
            const addOnlineMediaBtn = document.createElement('button');
            addOnlineMediaBtn.type = 'button';
            addOnlineMediaBtn.className = 'btn btn-secondary btn-add-media';
            addOnlineMediaBtn.innerHTML = '<i class="fas fa-plus"></i> Adicionar Mídia';
            addOnlineMediaBtn.dataset.platform = platform;
            addOnlineMediaBtn.dataset.channel = channelConfig.channel;
            addOnlineMediaBtn.dataset.event = 'on';
            
            onlineMedia.appendChild(onlineMediaList);
            onlineMedia.appendChild(addOnlineMediaBtn);
            
            // Offline media
            const offlineMedia = document.createElement('div');
            offlineMedia.className = 'media-event-section';
            offlineMedia.innerHTML = `<h5>Quando offline</h5>`;
            
            const offlineMediaList = document.createElement('div');
            offlineMediaList.className = 'media-list';
            offlineMediaList.dataset.platform = platform;
            offlineMediaList.dataset.channel = channelConfig.channel;
            offlineMediaList.dataset.event = 'off';
            
            // Add offline media items
            if (channelConfig.offConfig && channelConfig.offConfig.media && Array.isArray(channelConfig.offConfig.media)) {
                channelConfig.offConfig.media.forEach((media, mediaIndex) => {
                    const mediaItem = createMediaItem(platform, channelConfig.channel, 'off', media, mediaIndex);
                    offlineMediaList.appendChild(mediaItem);
                });
            }
            
            // Add button to add new media
            const addOfflineMediaBtn = document.createElement('button');
            addOfflineMediaBtn.type = 'button';
            addOfflineMediaBtn.className = 'btn btn-secondary btn-add-media';
            addOfflineMediaBtn.innerHTML = '<i class="fas fa-plus"></i> Adicionar Mídia';
            addOfflineMediaBtn.dataset.platform = platform;
            addOfflineMediaBtn.dataset.channel = channelConfig.channel;
            addOfflineMediaBtn.dataset.event = 'off';
            
            offlineMedia.appendChild(offlineMediaList);
            offlineMedia.appendChild(addOfflineMediaBtn);
            
            // Assemble the channel section
            mediaContainer.appendChild(onlineMedia);
            mediaContainer.appendChild(offlineMedia);
            
            channelSection.appendChild(channelHeader);
            channelSection.appendChild(channelOptions);
            channelSection.appendChild(titleInputs);
            channelSection.appendChild(mediaContainer);
            
            container.appendChild(channelSection);
            
            // Add event listeners
            addChannelEventListeners(channelSection);
        });
        
        // Add button to add a new channel
        const addChannelBtn = document.createElement('button');
        addChannelBtn.type = 'button';
        addChannelBtn.id = `add-${platform}-channel`;
        addChannelBtn.className = 'btn btn-secondary';
        addChannelBtn.innerHTML = `<i class="fas fa-plus"></i> Adicionar Canal '${platform}'`;
        
        container.appendChild(addChannelBtn);
        
        // Add event listener for adding a new channel
        document.getElementById(`add-${platform}-channel`).addEventListener('click', () => {
            showAddChannelModal(platform);
        });
    }
    
    function createMediaItem(platform, channel, event, media, index) {
        const mediaItem = document.createElement('div');
        mediaItem.className = 'media-item';
        mediaItem.dataset.platform = platform;
        mediaItem.dataset.channel = channel;
        mediaItem.dataset.event = event;
        mediaItem.dataset.index = index;
        mediaItem.dataset.type = media.type;
        
        // Media type icon
        let typeIcon = '';
        switch (media.type) {
            case 'text': typeIcon = '💬'; break;
            case 'image': typeIcon = '🖼'; break;
            case 'sound': typeIcon = '🔉'; break;
            case 'video': typeIcon = '📼'; break;
            case 'sticker': typeIcon = '🩻'; break;
            default: typeIcon = '📄';
        }
        
        // Media content preview
        let contentPreview = '';
        if (media.type === 'text') {
            // Truncate text if too long
            const truncatedContent = media.content.length > 50 
                ? media.content.substring(0, 50) + '...' 
                : media.content;
            contentPreview = `<div class="media-content">${truncatedContent}</div>`;
        } else if (media.content) {
            const mediaLink = `/media/${platform}/${channel}/${event}/${media.type}?token=${token}`;
            contentPreview = `<div class="media-content" onclick="window.open('${mediaLink}','_new')" target="_new">Arquivo: ${media.content}</div>`;
        } else {
            contentPreview = `<div class="media-content">Sem conteúdo</div>`;
        }
        
        mediaItem.innerHTML = `
            <div class="media-item-header">
                <div class="media-type-icon">${typeIcon}</div>
                <div class="media-item-type">${getMediaTypeDisplayName(media.type)}</div>
                <div class="media-item-actions">
                    <button type="button" class="btn-edit-media" title="Editar mídia">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="btn-delete-media" title="Excluir mídia">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            ${contentPreview}
        `;
        
        // Add event listeners
        mediaItem.querySelector('.btn-edit-media').addEventListener('click', () => {
            editMedia(platform, channel, event, index);
        });
        
        mediaItem.querySelector('.btn-delete-media').addEventListener('click', () => {
            deleteMedia(platform, channel, event, index);
        });
        
        return mediaItem;
    }
    
    function addChannelEventListeners(channelSection) {
        const platform = channelSection.dataset.platform;
        const channel = channelSection.dataset.channel;
        const index = parseInt(channelSection.dataset.index);
        
        // Restore defaults button
        channelSection.querySelector('.btn-restore-defaults').addEventListener('click', () => {
            showRestoreDefaultsModal(platform, channel, index);
        });
        
        // Remove channel button
        channelSection.querySelector('.btn-remove-channel').addEventListener('click', () => {
            if (confirm(`Tem certeza que deseja remover o canal ${channel}?`)) {
                removeChannel(platform, index);
            }
        });
        
        // Add media buttons
        channelSection.querySelectorAll('.btn-add-media').forEach(btn => {
            btn.addEventListener('click', () => {
                const event = btn.dataset.event;
                showAddMediaModal(platform, channel, event);
            });
        });
        
        // Channel options checkboxes
        const changeTitleCheckbox = channelSection.querySelector(`#${platform}-${index}-change-title`);
        if (changeTitleCheckbox) {
            changeTitleCheckbox.addEventListener('change', () => {
                groupData[platform][index].changeTitleOnEvent = changeTitleCheckbox.checked;
                
                // Show/hide title inputs based on checkbox state
                const titleInputs = document.getElementById(`${platform}-${index}-title-inputs`);
                if (titleInputs) {
                    titleInputs.style.display = changeTitleCheckbox.checked ? 'block' : 'none';
                }
            });
        }
        
        const useThumbnailCheckbox = channelSection.querySelector(`#${platform}-${index}-use-thumbnail`);
        if (useThumbnailCheckbox) {
            useThumbnailCheckbox.addEventListener('change', () => {
                groupData[platform][index].useThumbnail = useThumbnailCheckbox.checked;
            });
        }
        
        const useAICheckbox = channelSection.querySelector(`#${platform}-${index}-use-ai`);
        if (useAICheckbox) {
            useAICheckbox.addEventListener('change', () => {
                groupData[platform][index].useAI = useAICheckbox.checked;
            });
        }
    }
    
    function showAddChannelModal(platform) {
        // Create a simple prompt for the channel name
        const channelInput = prompt(`Digite o nome do canal de ${getPlatformDisplayName(platform)}:`);
        const channelName = sanitizePlatformChannelName(channelInput, platform);
        
        if (!channelName || channelName.trim() === '') {
            return;
        }
        
        // Create default configuration for the new channel
        const defaultConfig = createDefaultChannelConfig(platform, channelName.trim());
        
        // Add to group data
        if (!groupData[platform]) {
            groupData[platform] = [];
        }
        
        groupData[platform].push(defaultConfig);
        
        // Refresh the UI
        setupPlatformSection(platform);
    }
    
    function createDefaultChannelConfig(platform, channelName) {
        // Create default text content based on platform
        let defaultText = '';
        
        let changeTitle = true;
        if (platform === 'youtube') {
            defaultText = `*⚠️ Vídeo novo! ⚠️*\n\n*{author}:* *{title}* \n{link}`;
            changeTitle = false;
        } else {
            defaultText = `⚠️ ATENÇÃO!⚠️\n\n🌟 *${channelName}* ✨ está *online* streamando *{jogo}*!\n_{titulo}_\n\nhttps://${platform}.tv/${channelName}`;
        }
        
        return {
            channel: channelName,
            onConfig: {
                media: [{
                    type: "text",
                    content: defaultText
                }]
            },
            offConfig: {
                media: []
            },
            changeTitleOnEvent: changeTitle,
            useThumbnail: true,
            useAI: false
        };
    }
    
    function showAddMediaModal(platform, channel, event) {
        // Reset the modal
        document.getElementById('media-platform').value = platform;
        document.getElementById('media-channel').value = channel;
        document.getElementById('media-event').value = event;
        document.getElementById('media-type').value = 'text';
        document.getElementById('text-content').value = '';
        document.getElementById('media-file').value = '';
        document.getElementById('media-preview-container').classList.add('hidden');
        
        // Show text content, hide file upload
        document.getElementById('text-content-group').classList.remove('hidden');
        document.getElementById('media-file-group').classList.add('hidden');
        
        // Update modal title
        const modalTitle = `Adicionar Mídia - ${getPlatformDisplayName(platform)} (${channel})`;
        document.querySelector('#media-upload-modal .modal-header h2').textContent = modalTitle;
        
        // Show the modal
        document.getElementById('media-upload-modal').classList.remove('hidden');
        
        // Add event listener for media type change
        document.getElementById('media-type').addEventListener('change', handleMediaTypeChange);
        
        // Add event listener for file input change
        document.getElementById('media-file').addEventListener('change', handleFileInputChange);
        
        // Add event listener for add button
        document.getElementById('add-media').onclick = () => {
            addMedia(platform, channel, event);
        };
    }
    
    function handleMediaTypeChange() {
        const mediaType = document.getElementById('media-type').value;
        
        if (mediaType === 'text') {
            document.getElementById('text-content-group').classList.remove('hidden');
            document.getElementById('media-file-group').classList.add('hidden');
        } else {
            document.getElementById('text-content-group').classList.add('hidden');
            document.getElementById('media-file-group').classList.remove('hidden');
        }
    }
    
    function handleFileInputChange() {
        const fileInput = document.getElementById('media-file');
        const previewContainer = document.getElementById('media-preview-container');
        const preview = document.getElementById('media-preview');
        
        if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            
            // Check file size
            if (file.size > 5 * 1024 * 1024) { // 5MB
                alert('O arquivo é muito grande. O tamanho máximo permitido é 5MB.');
                fileInput.value = '';
                previewContainer.classList.add('hidden');
                return;
            }
            
            // Show preview for images
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    preview.src = e.target.result;
                    previewContainer.classList.remove('hidden');
                };
                
                reader.readAsDataURL(file);
            } else {
                // For non-image files, just show the file name
                previewContainer.classList.add('hidden');
            }
        } else {
            previewContainer.classList.add('hidden');
        }
    }
    
    function addMedia(platform, channel, event) {
        const mediaType = document.getElementById('media-type').value;
        let mediaContent = '';
        
        // Get the channel index
        const channelIndex = groupData[platform].findIndex(c => c.channel === channel);
        
        if (channelIndex === -1) {
            alert('Canal não encontrado.');
            return;
        }
        
        if (mediaType === 'text') {
            mediaContent = document.getElementById('text-content').value.trim();
            
            if (!mediaContent) {
                alert('Por favor, informe o conteúdo do texto.');
                return;
            }
            
            // Add the text media directly
            const newMedia = {
                type: 'text',
                content: mediaContent
            };
            
            // Add to the appropriate config
            if (event === 'on') {
                if (!groupData[platform][channelIndex].onConfig.media) {
                    groupData[platform][channelIndex].onConfig.media = [];
                }
                groupData[platform][channelIndex].onConfig.media.push(newMedia);
            } else {
                if (!groupData[platform][channelIndex].offConfig.media) {
                    groupData[platform][channelIndex].offConfig.media = [];
                }
                groupData[platform][channelIndex].offConfig.media.push(newMedia);
            }
            
            // Hide the modal
            document.getElementById('media-upload-modal').classList.add('hidden');
            
            // Refresh the UI
            setupPlatformSection(platform);
            
        } else {
            // For file uploads, we need to handle the upload process
            const fileInput = document.getElementById('media-file');
            
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Por favor, selecione um arquivo.');
                return;
            }
            
            const file = fileInput.files[0];
            
            // Create a FormData object to send the file
            const formData = new FormData();
            formData.append('file', file);
            formData.append('token', token);
            formData.append('groupId', groupId);
            formData.append('type', mediaType);
            formData.append('name', `${platform}_${channel}_${event}_${Date.now()}`);
            
            // Show loading state
            document.getElementById('add-media').disabled = true;
            document.getElementById('add-media').textContent = 'Enviando...';
            
            // Upload the file
            fetch('/api/upload-media', {
                method: 'POST',
                body: formData
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(error => {
                        throw new Error(error.message || 'Erro ao enviar arquivo');
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    // Add the media to the group data
                    const newMedia = {
                        type: mediaType,
                        content: data.fileName
                    };
                    
                    // Add to the appropriate config
                    if (event === 'on') {
                        if (!groupData[platform][channelIndex].onConfig.media) {
                            groupData[platform][channelIndex].onConfig.media = [];
                        }
                        groupData[platform][channelIndex].onConfig.media.push(newMedia);
                    } else {
                        if (!groupData[platform][channelIndex].offConfig.media) {
                            groupData[platform][channelIndex].offConfig.media = [];
                        }
                        groupData[platform][channelIndex].offConfig.media.push(newMedia);
                    }
                    
                    // Hide the modal
                    document.getElementById('media-upload-modal').classList.add('hidden');
                    
                    // Refresh the UI
                    setupPlatformSection(platform);
                } else {
                    alert('Erro ao enviar arquivo: ' + (data.message || 'Erro desconhecido'));
                }
            })
            .catch(error => {
                alert('Erro ao enviar arquivo: ' + error.message);
            })
            .finally(() => {
                // Reset loading state
                document.getElementById('add-media').disabled = false;
                document.getElementById('add-media').textContent = 'Adicionar';
            });
        }
    }
    
    function editMedia(platform, channel, event, index) {
        // Get the channel index
        const channelIndex = groupData[platform].findIndex(c => c.channel === channel);
        
        if (channelIndex === -1) {
            alert('Canal não encontrado.');
            return;
        }
        
        // Get the media
        const mediaConfig = event === 'on' 
            ? groupData[platform][channelIndex].onConfig.media
            : groupData[platform][channelIndex].offConfig.media;
        
        if (!mediaConfig || !mediaConfig[index]) {
            alert('Mídia não encontrada.');
            return;
        }
        
        const media = mediaConfig[index];
        
        // Reset the modal
        document.getElementById('media-platform').value = platform;
        document.getElementById('media-channel').value = channel;
        document.getElementById('media-event').value = event;
        document.getElementById('media-type').value = media.type;
        
        // Set content based on media type
        if (media.type === 'text') {
            document.getElementById('text-content').value = media.content || '';
            document.getElementById('text-content-group').classList.remove('hidden');
            document.getElementById('media-file-group').classList.add('hidden');
        } else {
            document.getElementById('text-content-group').classList.add('hidden');
            document.getElementById('media-file-group').classList.remove('hidden');
            
            // Show file name if available
            if (media.content) {
                document.getElementById('media-file-group').innerHTML = `
                    <label>Arquivo atual:</label>
                    <div class="media-content">${media.content}</div>
                    <label for="media-file">Substituir arquivo (max 5MB):</label>
                    <input type="file" id="media-file" accept="image/*,video/*,audio/*">
                    <div id="media-preview-container" class="hidden">
                        <img id="media-preview" class="media-preview">
                    </div>
                `;
            } else {
                document.getElementById('media-file-group').innerHTML = `
                    <label for="media-file">Arquivo (max 5MB):</label>
                    <input type="file" id="media-file" accept="image/*,video/*,audio/*">
                    <div id="media-preview-container" class="hidden">
                        <img id="media-preview" class="media-preview">
                    </div>
                `;
            }
            
            // Add event listener for file input change
            document.getElementById('media-file').addEventListener('change', handleFileInputChange);
        }
        
        // Update modal title
        const modalTitle = `Editar Mídia - ${getPlatformDisplayName(platform)} (${channel})`;
        document.querySelector('#media-upload-modal .modal-header h2').textContent = modalTitle;
        
        // Show the modal
        document.getElementById('media-upload-modal').classList.remove('hidden');
        
        // Add event listener for media type change
        document.getElementById('media-type').addEventListener('change', handleMediaTypeChange);
        
        // Add event listener for add button
        document.getElementById('add-media').textContent = 'Salvar';
        document.getElementById('add-media').onclick = () => {
            updateMedia(platform, channel, event, index);
        };
    }
    
    function updateMedia(platform, channel, event, index) {
        const mediaType = document.getElementById('media-type').value;
        
        // Get the channel index
        const channelIndex = groupData[platform].findIndex(c => c.channel === channel);
        
        if (channelIndex === -1) {
            alert('Canal não encontrado.');
            return;
        }
        
        // Get the media config
        const mediaConfig = event === 'on' 
            ? groupData[platform][channelIndex].onConfig.media
            : groupData[platform][channelIndex].offConfig.media;
        
        if (!mediaConfig || !mediaConfig[index]) {
            alert('Mídia não encontrada.');
            return;
        }
        
        if (mediaType === 'text') {
            const content = document.getElementById('text-content').value.trim();
            
            if (!content) {
                alert('Por favor, informe o conteúdo do texto.');
                return;
            }
            
            // Update the media
            mediaConfig[index] = {
                type: 'text',
                content: content
            };
            
            // Hide the modal
            document.getElementById('media-upload-modal').classList.add('hidden');
            
            // Refresh the UI
            setupPlatformSection(platform);
            
        } else {
            // For file uploads, check if a new file was selected
            const fileInput = document.getElementById('media-file');
            
            if (!fileInput.files || fileInput.files.length === 0) {
                // No new file, just close the modal
                document.getElementById('media-upload-modal').classList.add('hidden');
                return;
            }
            
            const file = fileInput.files[0];
            
            // Create a FormData object to send the file
            const formData = new FormData();
            formData.append('file', file);
            formData.append('token', token);
            formData.append('groupId', groupId);
            formData.append('type', mediaType);
            formData.append('name', `${platform}_${channel}_${event}_${Date.now()}`);
            
            // Show loading state
            document.getElementById('add-media').disabled = true;
            document.getElementById('add-media').textContent = 'Enviando...';
            
            // Upload the file
            fetch('/api/upload-media', {
                method: 'POST',
                body: formData
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(error => {
                        throw new Error(error.message || 'Erro ao enviar arquivo');
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    // Update the media
                    mediaConfig[index] = {
                        type: mediaType,
                        content: data.fileName
                    };
                    
                    // Hide the modal
                    document.getElementById('media-upload-modal').classList.add('hidden');
                    
                    // Refresh the UI
                    setupPlatformSection(platform);
                } else {
                    alert('Erro ao enviar arquivo: ' + (data.message || 'Erro desconhecido'));
                }
            })
            .catch(error => {
                alert('Erro ao enviar arquivo: ' + error.message);
            })
            .finally(() => {
                // Reset loading state
                document.getElementById('add-media').disabled = false;
                document.getElementById('add-media').textContent = 'Salvar';
            });
        }
    }
    
    function deleteMedia(platform, channel, event, index) {
        if (!confirm('Tem certeza que deseja excluir esta mídia?')) {
            return;
        }
        
        // Get the channel index
        const channelIndex = groupData[platform].findIndex(c => c.channel === channel);
        
        if (channelIndex === -1) {
            alert('Canal não encontrado.');
            return;
        }
        
        // Get the media config
        const mediaConfig = event === 'on' 
            ? groupData[platform][channelIndex].onConfig.media
            : groupData[platform][channelIndex].offConfig.media;
        
        if (!mediaConfig || !mediaConfig[index]) {
            alert('Mídia não encontrada.');
            return;
        }
        
        // Remove the media
        mediaConfig.splice(index, 1);
        
        // Refresh the UI
        setupPlatformSection(platform);
    }
    
    function removeChannel(platform, index) {
        // Remove the channel from group data
        groupData[platform].splice(index, 1);
        
        // If no more channels, remove the platform array
        if (groupData[platform].length === 0) {
            delete groupData[platform];
        }
        
        // Refresh the UI
        setupPlatformSection(platform);
    }
    
    function showRestoreDefaultsModal(platform, channel, index) {
        // Set the current platform and channel for the restore action
        document.getElementById('restore-defaults-modal').dataset.platform = platform;
        document.getElementById('restore-defaults-modal').dataset.channel = channel;
        document.getElementById('restore-defaults-modal').dataset.index = index;
        
        // Show the modal
        document.getElementById('restore-defaults-modal').classList.remove('hidden');
        
        // Add event listeners
        document.getElementById('cancel-restore').onclick = () => {
            document.getElementById('restore-defaults-modal').classList.add('hidden');
        };
        
        document.getElementById('confirm-restore').onclick = () => {
            restoreDefaults(platform, channel, index);
            document.getElementById('restore-defaults-modal').classList.add('hidden');
        };
    }
    
    function restoreDefaults(platform, channel, index) {
        // Create default configuration
        const defaultConfig = createDefaultChannelConfig(platform, channel);
        
        // Replace the current configuration
        groupData[platform][index] = defaultConfig;
        
        // Refresh the UI
        setupPlatformSection(platform);
    }
    
    function setupFormEvents() {  
        // Add text filter  
        document.getElementById('add-text-filter').addEventListener('click', () => {  
            const input = document.getElementById('text-filter-input');  
            const filter = input.value.trim();  
            
            if (!filter) return;  
            
            if (!groupData.filters) {
                groupData.filters = {};
            }
            
            if (!groupData.filters.words) {  
                groupData.filters.words = [];  
            }  
            
            if (!groupData.filters.words.includes(filter)) {  
                groupData.filters.words.push(filter);  
                addTagToContainer(document.getElementById('text-filters-container'), filter, () => {  
                    groupData.filters.words = groupData.filters.words.filter(f => f !== filter);  
                });  
            }  
            
            input.value = '';  
        });  
        
        // Add people filter
        document.getElementById('add-people-filter').addEventListener('click', () => {
            const input = document.getElementById('people-filter-input');
            const filter = input.value.trim();
            
            if (!filter) return;
            
            if (!groupData.filters) {
                groupData.filters = {};
            }
            
            if (!groupData.filters.people) {
                groupData.filters.people = [];
            }
            
            if (!groupData.filters.people.includes(filter)) {
                groupData.filters.people.push(filter);
                addTagToContainer(document.getElementById('people-filters-container'), filter, () => {
                    groupData.filters.people = groupData.filters.people.filter(f => f !== filter);
                });
            }
            
            input.value = '';
        });
        
        // Add nick  
        document.getElementById('add-nick').addEventListener('click', () => {  
            const nicksContainer = document.getElementById('nicks-container');  
            addNickEntry(nicksContainer, '', '');  
        });  
        
        // Close modals when clicking X or outside  
        document.querySelectorAll('.close-modal').forEach(button => {  
            button.addEventListener('click', () => {  
                document.getElementById('confirm-modal').classList.add('hidden');  
                document.getElementById('media-upload-modal').classList.add('hidden');  
                document.getElementById('restore-defaults-modal').classList.add('hidden');
            });  
        });  
         
        const cancelMediaButton = document.querySelector("#cancel-media");
        cancelMediaButton.addEventListener('click', () => {  
            document.getElementById('confirm-modal').classList.add('hidden');  
            document.getElementById('media-upload-modal').classList.add('hidden');  
            document.getElementById('restore-defaults-modal').classList.add('hidden');
        });  
  

        
        // Save button  
        document.getElementById('save-button').addEventListener('click', () => {  
            // Update groupData with form values  
            updateGroupDataFromForm();  
            
            // Calculate changes  
            const changes = calculateChanges(originalGroupData, groupData);  
            
            if (Object.keys(changes).length === 0) {  
                alert('Nenhuma alteração detectada.');  
                return;  
            }  
            
            // Show confirmation modal  
            showConfirmationModal(changes);  
        });  
        
        // Confirmation modal events  
        document.getElementById('confirm-changes').addEventListener('click', () => saveChanges());  
        document.getElementById('cancel-changes').addEventListener('click', () => hideConfirmationModal());  
    }  
    
    function updateGroupDataFromForm() {  
        // Basic fields  
        groupData.name = document.getElementById('group-name-input').value;  
        
        // Ensure greetings and farewells objects exist
        if (!groupData.greetings) {
            groupData.greetings = {};
        }
        
        if (!groupData.farewells) {
            groupData.farewells = {};
        }
        
        groupData.greetings.text = document.getElementById('group-greet-message').value;  
        groupData.farewells.text = document.getElementById('group-farewell-message').value;  
        
        // Ensure filters object exists
        if (!groupData.filters) {
            groupData.filters = {};
        }
        
        // Checkboxes  
        groupData.filters.nsfw = document.getElementById('group-isNSFW').checked;  
        groupData.filters.links = document.getElementById('group-deleteLinks').checked;
        groupData.isActive = document.getElementById('group-isActive').checked;  
        groupData.autoStt = document.getElementById('group-autoTranscribe').checked;  
        
        // Channel title inputs
        // For each platform (twitch, youtube, kick)
        ['twitch', 'youtube', 'kick'].forEach(platform => {
            if (groupData[platform] && Array.isArray(groupData[platform])) {
                groupData[platform].forEach((channelConfig, index) => {
                    // Only process if changeTitleOnEvent is true
                    if (channelConfig.changeTitleOnEvent) {
                        const onlineTitleInput = document.getElementById(`${platform}-${index}-online-title`);
                        const offlineTitleInput = document.getElementById(`${platform}-${index}-offline-title`);
                        
                        if (onlineTitleInput) {
                            const onlineTitle = onlineTitleInput.value.trim();
                            // If the title is empty or doesn't meet min length, set to undefined
                            channelConfig.onlineTitle = (onlineTitle.length >= 2) ? onlineTitle : undefined;
                        }
                        
                        if (offlineTitleInput) {
                            const offlineTitle = offlineTitleInput.value.trim();
                            // If the title is empty or doesn't meet min length, set to undefined
                            channelConfig.offlineTitle = (offlineTitle.length >= 2) ? offlineTitle : undefined;
                        }
                    } else {
                        // If changeTitleOnEvent is false, set titles to undefined
                        channelConfig.onlineTitle = undefined;
                        channelConfig.offlineTitle = undefined;
                    }
                });
            }
        });
        
        // Nicks  
        groupData.nicks = [];  
        
        document.querySelectorAll('.nick-entry').forEach(entry => {  
            const numberInput = entry.querySelector('.nick-input');  
            const nameInput = entry.querySelector('.nick-value');  
            
            const number = numberInput.value.trim();  
            const name = nameInput.value.trim();  
            
            if (number && name) {  
                // Ensure it has the correct format  
                let formattedNumber = number;  
                if (!formattedNumber.includes('@c.us')) {  
                    formattedNumber = formattedNumber.endsWith('@c.us') ? formattedNumber : `${formattedNumber}@c.us`;  
                }  
                
                groupData.nicks.push({
                    numero: formattedNumber,
                    apelido: name
                });  
            }  
        });  
    }  
    
    function addTagToContainer(container, text, onRemove) {  
        const tag = document.createElement('div');  
        tag.className = 'tag';  
        tag.innerHTML = `  
        ${text}  
        <span class="remove-tag">×</span>  
        `;  
        
        tag.querySelector('.remove-tag').addEventListener('click', () => {  
            container.removeChild(tag);  
            if (onRemove) onRemove();  
        });  
        
        container.appendChild(tag);  
    }  
    
    function addNickEntry(container, number, name) {  
        const entry = document.createElement('div');  
        entry.className = 'nick-entry';  
        
        // Format number without @c.us for display  
        const displayNumber = number.replace('@c.us', '');  
        
        entry.innerHTML = `  
        <input type="text" class="nick-input" placeholder="Número (ex: 55119999)" value="${displayNumber}">  
        <input type="text" class="nick-value" placeholder="Nome/Nick" value="${name}">  
        <button type="button" class="btn btn-remove nick-remove">  
        <i class="fas fa-times"></i>  
        </button>  
        `;  
        
        entry.querySelector('.nick-remove').addEventListener('click', () => {  
            container.removeChild(entry);  
        });  
        
        container.appendChild(entry);  
    }  
    
    function calculateChanges(original, current) {  
        const changes = {};  
        
        // Helper function to check if two values are different  
        const isDifferent = (a, b) => {  
            if (Array.isArray(a) && Array.isArray(b)) {  
                return JSON.stringify(a.sort()) !== JSON.stringify(b.sort());  
            }  
            
            if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {  
                return JSON.stringify(a) !== JSON.stringify(b);  
            }  
            
            return a !== b;  
        };  
        
        // Check all properties in current  
        for (const [key, value] of Object.entries(current)) {  
            // Skip non-editable fields  
            if (['id', 'createdAt', 'addedBy', 'removedBy'].includes(key)) {  
                continue;  
            }  
            
            // Check if property exists in original  
            if (!(key in original) || isDifferent(original[key], value)) {  
                changes[key] = value;  
            }  
        }  
        
        // Check for properties in original that were removed in current  
        for (const key of Object.keys(original)) {  
            if (!(key in current) && !['id', 'createdAt', 'addedBy', 'removedBy'].includes(key)) {  
                changes[key] = null; // Mark as removed  
            }  
        }  
        
        return changes;  
    }  
    
    function showConfirmationModal(changes) {  
        // Format changes as HTML
        const formattedChanges = document.getElementById('changes-formatted');
        formattedChanges.innerHTML = '';
        
        Object.entries(changes).forEach(([key, value]) => {
            const changeItem = document.createElement('div');
            changeItem.className = 'change-item';
            
            let displayValue = '';
            if (value === null) {
                displayValue = '<em>(removido)</em>';
            } else if (typeof value === 'object') {
                // Format object nicely
                displayValue = formatObjectForDisplay(value);
            } else if (typeof value === 'boolean') {
                displayValue = value ? 'Sim' : 'Não';
            } else {
                displayValue = value.toString();
            }
            
            changeItem.innerHTML = `
                <div class="change-field">${formatKeyName(key)}:</div>
                <div class="change-value">${displayValue}</div>
            `;
            
            formattedChanges.appendChild(changeItem);
        });
        
        // Show raw JSON for debug
        document.getElementById('changes-raw').textContent = JSON.stringify(changes, null, 2);
        
        // Show the modal
        document.getElementById('confirm-modal').classList.remove('hidden');
    }
    
    function formatObjectForDisplay(obj) {
        if (Array.isArray(obj)) {
            if (obj.length === 0) return '<em>(lista vazia)</em>';
            
            return `<ul>${obj.map(item => `<li>${typeof item === 'object' ? formatObjectForDisplay(item) : item}</li>`).join('')}</ul>`;
        }
        
        const entries = Object.entries(obj);
        if (entries.length === 0) return '<em>(objeto vazio)</em>';
        
        return `<ul>${entries.map(([k, v]) => `<li><strong>${formatKeyName(k)}:</strong> ${typeof v === 'object' ? formatObjectForDisplay(v) : v}</li>`).join('')}</ul>`;
    }
    
    function formatKeyName(key) {
        // Map of key names to display names
        const keyNames = {
            'name': 'Nome',
            'greetings': 'Boas-vindas',
            'farewells': 'Despedidas',
            'filters': 'Filtros',
            'isActive': 'Bot Ativo',
            'autoStt': 'Auto Transcrição',
            'nicks': 'Apelidos',
            'twitch': 'Twitch',
            'youtube': 'YouTube',
            'kick': 'Kick',
            'words': 'Palavras',
            'people': 'Pessoas',
            'nsfw': 'Filtro NSFW',
            'links': 'Filtro de Links',
            'text': 'Texto',
            'channel': 'Canal',
            'onConfig': 'Configuração Online',
            'offConfig': 'Configuração Offline',
            'media': 'Mídia',
            'changeTitleOnEvent': 'Alterar Título',
            'useThumbnail': 'Usar Thumbnail',
            'useAI': 'Usar IA'
        };
        
        return keyNames[key] || key;
    }
    
    function hideConfirmationModal() {  
        document.getElementById('confirm-modal').classList.add('hidden');  
    }  
    
    async function saveChanges() {  
        try {  
            // Get changes  
            const changes = calculateChanges(originalGroupData, groupData);  
            
            const response = await fetch('/api/update-group', {  
                method: 'POST',  
                headers: {  
                    'Content-Type': 'application/json'  
                },  
                body: JSON.stringify({  
                    token,  
                    groupId,  
                    changes  
                })  
            });  
            
            if (!response.ok) {  
                const error = await response.json();  
                throw new Error(error.message || 'Failed to save changes');  
            }  
            
            // Hide modal  
            hideConfirmationModal();  
            
            // Show success message  
            alert('Alterações salvas com sucesso!');  
            
            // Reload group data  
            await loadGroupData(groupId);  
            
        } catch (error) {  
            console.error('Error saving changes:', error);  
            alert(`Erro ao salvar alterações: ${error.message}`);  
            hideConfirmationModal();  
        }  
    }  
    
    function showError(message) {  
        document.getElementById('loading-container').classList.add('hidden');  
        document.getElementById('error-container').classList.remove('hidden');  
        document.getElementById('error-message').textContent = message;  
        
        document.getElementById('retry-button').addEventListener('click', () => {  
            window.location.reload();  
        });  
    }  
    
    function updateExpirationTime() {  
        const now = new Date();  
        const remainingMs = expiresAt - now;  
        
        if (remainingMs <= 0) {  
            document.getElementById('expiration-time').textContent = 'Sessão expirada';  
            document.getElementById('session-info').title = 'Sua sessão expirou. Por favor, gere um novo link.';  
            
            // Show error if we're on the form page  
            if (!document.getElementById('group-form-container').classList.contains('hidden')) {  
                showError('Sua sessão expirou. Por favor, gere um novo link.');  
            }  
            
            return;  
        }  
        
        // Format the date  
        const formattedTime = expiresAt.toLocaleTimeString('pt-BR', {  
            hour: '2-digit',  
            minute: '2-digit'  
        });  
        
        const formattedDate = expiresAt.toLocaleDateString('pt-BR', {  
            day: '2-digit',  
            month: '2-digit',  
            year: 'numeric'  
        });  
        
        document.getElementById('expiration-time').textContent = `${formattedDate} ${formattedTime}`;  
        
        // Format remaining time for tooltip  
        const remainingMinutes = Math.floor(remainingMs / 60000);  
        const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);  
        
        document.getElementById('session-info').title = `Tempo restante: ${remainingMinutes}m ${remainingSeconds}s`;  
    }  
    
    // Helper functions  
    function formatDate(dateString) {  
        if (!dateString) return '';  
        
        const date = new Date(dateString);  
        return date.toLocaleString('pt-BR');  
    }  
    
    function formatPhoneNumber(number) {  
        if (!number) return '';  
        
        // Remove @c.us if present  
        let cleaned = number.replace('@c.us', '');  
        
        // Format as country code + area code + number  
        if (cleaned.length >= 12) {  
            return `+${cleaned.substring(0, 2)} (${cleaned.substring(2, 4)}) ${cleaned.substring(4, 9)}-${cleaned.substring(9)}`;  
        }  
        
        return cleaned;  
    }
    
    function getPlatformDisplayName(platform) {
        switch (platform) {
            case 'twitch': return 'Twitch';
            case 'youtube': return 'YouTube';
            case 'kick': return 'Kick';
            default: return platform;
        }
    }
    
    function getMediaTypeDisplayName(type) {
        switch (type) {
            case 'text': return 'Texto';
            case 'image': return 'Imagem';
            case 'sound': return 'Som';
            case 'video': return 'Vídeo';
            case 'sticker': return 'Sticker';
            default: return type;
        }
    }
});