document.addEventListener('DOMContentLoaded', () => {
    const pathParts = window.location.pathname.split('/');
    const token = pathParts[pathParts.length - 1];
    
    // State
    let groupData = null;
    let originalGroupData = null;
    let customCommands = [];
    let groupId = null;
    let expiresAt = null;
    let isDirty = false;
    let currentStream = null; // { platform, index, data }
    let pickerMode = 'variable'; // 'variable' or 'language'
    let lastFocusedInput = null;

    // Constants
    const API_BASE = '/api';

    const AVAILABLE_LANGUAGES = [
        { code: 'English (EN)', desc: 'Inglês' },
        { code: 'Spanish (ES)', desc: 'Espanhol' },
        { code: 'Russian (RU)', desc: 'Russo' },
        { code: 'Portuguese (PT)', desc: 'Português' },
        { code: 'French (FR)', desc: 'Francês' },
        { code: 'German (DE)', desc: 'Alemão' },
        { code: 'Italian (IT)', desc: 'Italiano' },
        { code: 'Japanese (JA)', desc: 'Japonês' },
        { code: 'Chinese (ZH)', desc: 'Chinês' },
        { code: 'Korean (KO)', desc: 'Coreano' },
        { code: 'Arabic (AR)', desc: 'Árabe' },
        { code: 'Hindi (HI)', desc: 'Hindi' },
        { code: 'Turkish (TR)', desc: 'Turco' },
        { code: 'Dutch (NL)', desc: 'Holandês' },
        { code: 'Polish (PL)', desc: 'Polonês' },
        { code: 'Indonesian (ID)', desc: 'Indonésio' },
        { code: 'Vietnamese (VI)', desc: 'Vietnamita' },
        { code: 'Thai (TH)', desc: 'Tailandês' }
    ];

    const AVAILABLE_VARIABLES = [
        { code: '{day}', desc: 'Dia da semana (ex: Segunda-feira)' },
        { code: '{date}', desc: 'Data atual (ex: 12/01/2026)' },
        { code: '{time}', desc: 'Hora atual (ex: 14:30:00)' },
        { code: '{data-hora}', desc: 'Hora (HH)' },
        { code: '{data-minuto}', desc: 'Minuto (MM)' },
        { code: '{data-segundo}', desc: 'Segundo (SS)' },
        { code: '{data-dia}', desc: 'Dia (DD)' },
        { code: '{data-mes}', desc: 'Mês (MM)' },
        { code: '{data-ano}', desc: 'Ano (YYYY)' },
        { code: '{randomPequeno}', desc: 'Número aleatório 1-10' },
        { code: '{randomMedio}', desc: 'Número aleatório 1-100' },
        { code: '{randomGrande}', desc: 'Número aleatório 1-1000' },
        { code: '{randomMuitoGrande}', desc: 'Número aleatório 1-10000' },
        { code: '{rndDado-6}', desc: 'Dado de 6 lados (exemplo)' },
        { code: '{rndDadoRange-1-100}', desc: 'Número entre 1 e 100 (exemplo)' },
        { code: '{somaRandoms}', desc: 'Soma dos números gerados anteriormente' },
        { code: '{pessoa}', desc: 'Nome de quem enviou a mensagem' },
        { code: '{group}', desc: 'Nome do grupo' },
        { code: '{contador}', desc: 'Vezes que o comando foi usado' },
        { code: '{membroRandom}', desc: 'Nome de um membro aleatório' },
        { code: '{mention}', desc: 'Menciona usuário (autor/mencionado/aleatório)' },
        { code: '{singleMention}', desc: 'Mesma menção repetida' },
        { code: '{mentionOuEu}', desc: 'Menciona usuário ou autor' },
        { code: '{reddit-memes}', desc: 'Post aleatório do r/memes (exemplo)' },
        { code: '{weather:São Paulo}', desc: 'Clima de São Paulo (exemplo)' },
        { code: '{cmd-!outrocomando}', desc: 'Executa outro comando' },
        { code: '{nomeCanal}', desc: 'Stream: Nome do canal' },
        { code: '{titulo}', desc: 'Stream: Título da live' },
        { code: '{jogo}', desc: 'Stream: Jogo/Categoria' },
        { code: '{author}', desc: 'YouTube: Autor do vídeo' },
        { code: '{title}', desc: 'YouTube: Título do vídeo' },
        { code: '{link}', desc: 'YouTube: Link do vídeo' }
    ];

    const COMMON_EMOJIS = [
        '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇',
        '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '😋', '😛', '😜', '🤪', '😝',
        '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😶‍🌫️', '😏', '😒',
        '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
        '🤧', '🥵', '🥶', '🥴', '😵', '😵‍💫', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕',
        '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥',
        '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠',
        '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖',
        '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
        '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏',
        '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦶', '👂',
        '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁', '👅', '👄', '🫦', '👶',
        '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👨‍🦰', '👨‍🦱', '👨‍🦳', '👨‍🦲', '👩', '👩‍🦰',
        '🧑‍🦰', '👩‍🦱', '🧑‍🦱', '👩‍🦳', '🧑‍🦳', '👩‍🦲', '🧑‍🦲', '👱‍♀️', '👱‍♂️', '🧓', '👴', '👵',
        '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️',
        '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️',
        '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈️', '♉️', '♊️', '♋️', '♋️', '♌️', '♍️',
        '♎️', '♏️', '♐️', '♑️', '♒️', '♓️', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳',
        '🈶', '🈚️', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵',
        '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕️', '🛑', '⛔️', '📛',
        '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗️', '❕',
        '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️',
        '✅', '🈯️', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾',
        '♿️', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧', '🚻',
        '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒',
        '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣',
        '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸', '⏯', '⏹', '⏺', '⏭', '⏮', '⏩',
        '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️',
        '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵',
        '🎶', '➕', '➖', '➗', '✖️', '♾', '💲', '💱', '™️', '©️', '®️', '👁‍🗨', '🔚',
        '🔙', '🔛', '🔝', '🔜', '〰️', '➰', '➿', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡',
        '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳',
        '🔲', '▪️', '▫️', '◾️', '◽️', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪',
        '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁‍🗨', '💬',
        '💭', '🗯', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄️', '🕐', '🕑', '🕒', '🕓',
        '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠',
        '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'
    ];

    // UI Elements
    const els = {
        loading: document.getElementById('loading-container'),
        error: document.getElementById('error-container'),
        errorMsg: document.getElementById('error-message'),
        dashboard: document.getElementById('dashboard-content'),
        userName: document.getElementById('user-name'),
        groupName: document.getElementById('group-name'),
        expirationTime: document.getElementById('expiration-time'),
        retryBtn: document.getElementById('retry-button'),
        accordions: document.querySelectorAll('.accordion-item'),
        subAccordions: document.querySelectorAll('.sub-accordion'),
        
        // Modals
        cmdModal: document.getElementById('command-modal'),
        streamModal: document.getElementById('stream-modal'),
        uploadModal: document.getElementById('upload-modal'),
        variableModal: document.getElementById('variable-modal'),
        emojiModal: document.getElementById('emoji-modal'),
        customDialogModal: document.getElementById('custom-dialog-modal'),
        
        closeModalBtns: document.querySelectorAll('.close-modal, .close-modal-btn, .close-stream-modal, .close-variable-modal, .close-emoji-modal, .close-dialog'),
        closeUploadBtns: document.querySelectorAll('.close-upload'),
        
        // Sticky Footer
        stickySaveBar: document.getElementById('sticky-save-bar'),
        btnGlobalSave: document.getElementById('btn-global-save'),

        // Command Form
        cmdTrigger: document.getElementById('cmd-trigger'),
        cmdActive: document.getElementById('cmd-active'),
        cmdInteract: document.getElementById('cmd-interact'),
        cmdReplyQuote: document.getElementById('cmd-reply-quote'),
        cmdSendAll: document.getElementById('cmd-send-all'),
        cmdEmoji: document.getElementById('cmd-emoji'),
        cmdResponsesList: document.getElementById('cmd-responses-list'),
        btnSaveCmd: document.getElementById('btn-save-cmd'),
        btnDeleteCmd: document.getElementById('btn-delete-cmd'),
        cmdMetadata: document.getElementById('cmd-metadata'),
        modalTitle: document.getElementById('modal-title'),

        // Stream Form
        streamModalTitle: document.getElementById('stream-modal-title'),
        streamChannel: document.getElementById('stream-channel'),
        streamMention: document.getElementById('stream-mention'),
        streamChangeTitle: document.getElementById('stream-change-title'),
        streamAI: document.getElementById('stream-ai'),
        streamTitlesGroup: document.getElementById('stream-titles-group'),
        streamTitleOn: document.getElementById('stream-title-on'),
        streamTitleOff: document.getElementById('stream-title-off'),
        streamOnMediaList: document.getElementById('stream-on-media-list'),
        streamOffMediaList: document.getElementById('stream-off-media-list'),
        btnSaveStream: document.getElementById('btn-save-stream'),
        btnDeleteStream: document.getElementById('btn-delete-stream'),
        streamHint: document.getElementById('stream-hint'),

        // Upload Form
        mediaFileInput: document.getElementById('media-file-input'),
        mediaCaption: document.getElementById('media-caption'),
        convertSticker: document.getElementById('convert-sticker'),
        btnConfirmUpload: document.getElementById('btn-confirm-upload'),
        uploadType: document.getElementById('upload-type'), 
        uploadContext: document.getElementById('upload-context'),
        captionGroup: document.getElementById('caption-group'),
        asStickerGroup: document.getElementById('as-sticker-group'),
        uploadStatus: document.getElementById('upload-status'),

        // Dialog
        dialogTitle: document.getElementById('dialog-title'),
        dialogMessage: document.getElementById('dialog-message'),
        dialogInput: document.getElementById('dialog-input'),
        dialogBtnCancel: document.getElementById('dialog-btn-cancel'),
        dialogBtnOk: document.getElementById('dialog-btn-ok')
    };

    // --- Custom Dialogs ---

    function showCustomAlert(message, title = 'Aviso') {
        return new Promise((resolve) => {
            els.dialogTitle.textContent = title;
            els.dialogMessage.innerHTML = message;
            els.dialogInput.classList.add('hidden');
            els.dialogBtnCancel.classList.add('hidden');
            els.dialogBtnOk.textContent = 'OK';
            
            els.customDialogModal.classList.remove('hidden');
            
            const handleOk = () => {
                els.customDialogModal.classList.add('hidden');
                els.dialogBtnOk.removeEventListener('click', handleOk);
                resolve();
            };
            
            els.dialogBtnOk.onclick = handleOk;
        });
    }

    function showCustomConfirm(message, title = 'Confirmação') {
        return new Promise((resolve) => {
            els.dialogTitle.textContent = title;
            els.dialogMessage.innerHTML = message;
            els.dialogInput.classList.add('hidden');
            els.dialogBtnCancel.classList.remove('hidden');
            els.dialogBtnOk.textContent = 'Sim';
            
            els.customDialogModal.classList.remove('hidden');
            
            const handleOk = () => {
                els.customDialogModal.classList.add('hidden');
                cleanup();
                resolve(true);
            };
            
            const handleCancel = () => {
                els.customDialogModal.classList.add('hidden');
                cleanup();
                resolve(false);
            };

            const cleanup = () => {
                els.dialogBtnOk.removeEventListener('click', handleOk);
                els.dialogBtnCancel.removeEventListener('click', handleCancel);
            };
            
            els.dialogBtnOk.onclick = handleOk;
            els.dialogBtnCancel.onclick = handleCancel;
        });
    }

    function showCustomPrompt(message, defaultValue = '', title = 'Entrada') {
        return new Promise((resolve) => {
            els.dialogTitle.textContent = title;
            els.dialogMessage.textContent = message;
            els.dialogInput.value = defaultValue;
            els.dialogInput.classList.remove('hidden');
            els.dialogBtnCancel.classList.remove('hidden');
            els.dialogBtnOk.textContent = 'OK';
            
            els.customDialogModal.classList.remove('hidden');
            els.dialogInput.focus();
            
            const handleOk = () => {
                const val = els.dialogInput.value;
                els.customDialogModal.classList.add('hidden');
                cleanup();
                resolve(val);
            };
            
            const handleCancel = () => {
                els.customDialogModal.classList.add('hidden');
                cleanup();
                resolve(null);
            };

            const cleanup = () => {
                els.dialogBtnOk.removeEventListener('click', handleOk);
                els.dialogBtnCancel.removeEventListener('click', handleCancel);
            };
            
            els.dialogBtnOk.onclick = handleOk;
            els.dialogBtnCancel.onclick = handleCancel;
        });
    }

    // --- Initialization ---

    async function init() {
        try {
            const validation = await fetch(`${API_BASE}/validate-token?token=${token}`).then(r => r.json());
            
            if (!validation.valid) {
                showError(validation.message || 'Sessão inválida ou expirada');
                return;
            }

            groupId = validation.groupId;
            els.userName.textContent = validation.authorName;
            els.groupName.textContent = validation.groupName;
            expiresAt = new Date(validation.expiresAt);
            startTimer();

            await loadData();
            
            els.loading.classList.add('hidden');
            els.dashboard.classList.remove('hidden');

            setupEventListeners();
            setupDirtyTracking();

        } catch (e) {
            console.error(e);
            showError('Erro de conexão ao inicializar');
        }
    }

    async function loadData() {
        try {
            const resGroup = await fetch(`${API_BASE}/group?id=${groupId}&token=${token}`);
            if (!resGroup.ok) throw new Error('Falha ao carregar grupo');
            groupData = await resGroup.json();
            originalGroupData = JSON.parse(JSON.stringify(groupData)); 
            
            const resCmds = await fetch(`${API_BASE}/custom-commands/${groupId}?token=${token}`);
            if (resCmds.ok) {
                customCommands = await resCmds.json();
            } else {
                console.warn('Falha ao carregar comandos personalizados');
                customCommands = [];
            }

            populateFields();
            renderCommandsTable();
            setDirty(false);

        } catch (e) {
            console.error(e);
            showError('Erro ao carregar dados: ' + e.message);
        }
    }

    function showError(msg) {
        els.loading.classList.add('hidden');
        els.dashboard.classList.add('hidden');
        els.error.classList.remove('hidden');
        els.errorMsg.textContent = msg;
    }

    function startTimer() {
        setInterval(() => {
            const now = new Date();
            const diff = expiresAt - now;
            if (diff <= 0) {
                els.expirationTime.textContent = 'Expirado';
                window.location.reload();
            } else {
                const min = Math.floor(diff / 60000);
                const sec = Math.floor((diff % 60000) / 1000);
                els.expirationTime.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    // --- Dirty State & Save Logic ---

    function setDirty(state) {
        isDirty = state;
        if (isDirty) {
            els.stickySaveBar.classList.remove('hidden');
        } else {
            els.stickySaveBar.classList.add('hidden');
        }
    }

    function calculateChanges(original, current) {
        const changes = {};
        
        const isDifferent = (a, b) => {
            if (Array.isArray(a) && Array.isArray(b)) {
                return JSON.stringify(a) !== JSON.stringify(b);
            }
            if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
                return JSON.stringify(a) !== JSON.stringify(b);
            }
            return a !== b;
        };

        for (const [key, value] of Object.entries(current)) {
            if (['id', 'createdAt', 'addedBy', 'removedBy', 'lastUpdated'].includes(key)) continue;
            if (!original.hasOwnProperty(key) || isDifferent(original[key], value)) {
                changes[key] = value;
            }
        }
        
        return changes;
    }

    function formatChanges(changes) {
        let html = '<ul style="text-align: left; max-height: 300px; overflow-y: auto;">';
        for (const [key, value] of Object.entries(changes)) {
            let valDisplay = '';
            if (typeof value === 'object') {
                if (['greetings', 'farewells', 'twitch', 'kick', 'youtube'].includes(key)) {
                    valDisplay = '<em>(Mídia/Configuração Complexa Atualizada)</em>';
                } else {
                    valDisplay = JSON.stringify(value).substring(0, 100) + (JSON.stringify(value).length > 100 ? '...' : '');
                }
            } else {
                valDisplay = String(value).substring(0, 100);
            }
            
            const keyMap = {
                'name': 'Nome do Grupo', 'prefix': 'Prefixo', 'paused': 'Bot Pausado',
                'customAIPrompt': 'Personalidade IA', 'customIgnoresPrefix': 'Ignorar Prefixo',
                'ignoredNumbers': 'Números Ignorados', 'filters': 'Filtros',
                'autoStt': 'Auto Transcrição', 'interact': 'Interação Automática',
                'autoTranslateTo': 'Auto Tradução', 'greetings': 'Boas Vindas', 'farewells': 'Despedidas',
                'mutedStrings': 'Comandos Ignorados', 'additionalAdmins': 'Admins Adicionais',
                'twitch': 'Config Twitch', 'kick': 'Config Kick', 'youtube': 'Config YouTube'
            };
            
            html += `<li><strong>${keyMap[key] || key}:</strong> ${valDisplay}</li>`;
        }
        html += '</ul>';
        return html;
    }

    function setupDirtyTracking() {
        document.querySelectorAll('#dashboard-content input, #dashboard-content textarea').forEach(el => {
            el.addEventListener('input', () => setDirty(true));
            el.addEventListener('change', () => setDirty(true));
        });

        window.onbeforeunload = function(e) {
            if (isDirty) {
                const msg = 'Você tem alterações não salvas. Deseja sair?';
                e.returnValue = msg;
                return msg;
            }
        };
        
        window.onkeyup = function(e) {
            if (e.key === 'Escape') {
                els.cmdModal.classList.add('hidden');
                els.streamModal.classList.add('hidden');
                els.uploadModal.classList.add('hidden');
                els.variableModal.classList.add('hidden');
                els.emojiModal.classList.add('hidden');
                els.customDialogModal.classList.add('hidden');
            }
        };
        
        els.btnGlobalSave.onclick = async () => {
            await saveAllChanges();
        };
    }

    async function saveAllChanges() {
        try {
            updateGroupDataFromForm();
            const changes = calculateChanges(originalGroupData, groupData);
            
            if (Object.keys(changes).length === 0) {
                await showCustomAlert('Nenhuma alteração detectada.');
                setDirty(false);
                return;
            }

            const confirmed = await showCustomConfirm(
                `As seguintes alterações serão salvas:<br><br>${formatChanges(changes)}`,
                'Confirmar Alterações'
            );

            if (!confirmed) return;

            els.btnGlobalSave.textContent = 'Salvando...';
            els.btnGlobalSave.disabled = true;

            const res = await fetch(`${API_BASE}/update-group`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    token,
                    groupId,
                    changes: groupData
                })
            });

            if(!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Falha ao salvar');
            }

            originalGroupData = JSON.parse(JSON.stringify(groupData));
            setDirty(false);
            await showCustomAlert('Todas as alterações foram salvas!', 'Sucesso');
            
        } catch(e) {
            await showCustomAlert('Erro ao salvar: ' + e.message, 'Erro');
        } finally {
            els.btnGlobalSave.innerHTML = '<i class="fas fa-save"></i> Salvar Tudo';
            els.btnGlobalSave.disabled = false;
        }
    }

    function updateGroupDataFromForm() {
        groupData.name = document.getElementById('group-name-input').value;
        groupData.prefix = document.getElementById('group-prefix').value;
        groupData.paused = !document.getElementById('bot-enabled').checked;
        groupData.customAIPrompt = document.getElementById('bot-personality').value;
        groupData.customIgnoresPrefix = document.getElementById('custom-ignores-prefix').checked;

        if(!groupData.filters) groupData.filters = {};
        groupData.filters.links = document.getElementById('delete-links').checked;
        groupData.filters.nsfw = document.getElementById('delete-nsfw').checked;

        groupData.autoStt = document.getElementById('auto-stt').checked;
        if(!groupData.interact) groupData.interact = {};
        groupData.interact.enabled = document.getElementById('auto-interaction').checked;
        groupData.interact.chance = parseInt(document.getElementById('interaction-chance').value);
        groupData.interact.cooldown = parseInt(document.getElementById('interaction-cooldown').value);
        
        const autoTranslate = document.getElementById('auto-translate').checked;
        const translateLang = document.getElementById('translate-lang').value.trim();
        
        if (autoTranslate && translateLang.length < 5) {
            throw new Error('O idioma de tradução deve ter pelo menos 5 caracteres (Ex: "English (EN)").');
        }
        
        groupData.autoTranslateTo = autoTranslate ? translateLang : false;
    }

    function populateFields() {
        document.getElementById('group-id').value = groupData.id;
        document.getElementById('group-created-at').value = new Date(groupData.createdAt).toLocaleDateString();
        document.getElementById('group-name-input').value = groupData.name || '';
        document.getElementById('group-prefix').value = groupData.prefix || '';
        document.getElementById('bot-enabled').checked = !groupData.paused;
        document.getElementById('bot-personality').value = groupData.customAIPrompt || '';
        document.getElementById('personality-count').textContent = (groupData.customAIPrompt || '').length;
        document.getElementById('custom-ignores-prefix').checked = !!groupData.customIgnoresPrefix;

        renderTags('ignored-numbers-list', groupData.ignoredNumbers || [], (list) => { groupData.ignoredNumbers = list; setDirty(true); });
        
        document.getElementById('delete-links').checked = groupData.filters?.links || false;
        document.getElementById('delete-nsfw').checked = groupData.filters?.nsfw || false;

        renderTags('forbidden-words-list', groupData.filters?.words || [], (list) => { 
            if(!groupData.filters) groupData.filters = {};
            groupData.filters.words = list; setDirty(true);
        });

        renderTags('forbidden-users-list', groupData.filters?.people || [], (list) => { 
            if(!groupData.filters) groupData.filters = {};
            groupData.filters.people = list; setDirty(true);
        });

        renderTags('ignored-cmds-list', groupData.mutedStrings || [], (list) => { groupData.mutedStrings = list; setDirty(true); });
        renderTags('additional-admins-list', groupData.additionalAdmins || [], (list) => { groupData.additionalAdmins = list; setDirty(true); });

        const categories = ["geral","grupo","utilidades","midia","ia","downloaders","jogos","cultura","áudio","tts","busca","listas","arquivos","general","diversao","info","imagens","zoeira"];
        const mutedList = document.getElementById('muted-categories-list');
        mutedList.innerHTML = '';
        const muted = groupData.mutedCategories || [];
        categories.forEach(cat => {
            const div = document.createElement('div');
            div.className = 'checkbox-group';
            div.innerHTML = `
                <input type="checkbox" id="mute-cat-${cat}" ${muted.includes(cat) ? 'checked' : ''}>
                <label for="mute-cat-${cat}">${cat}</label>
            `;
            div.querySelector('input').addEventListener('change', (e) => {
                if(e.target.checked) {
                    if(!groupData.mutedCategories) groupData.mutedCategories = [];
                    if(!groupData.mutedCategories.includes(cat)) groupData.mutedCategories.push(cat);
                } else {
                    if(groupData.mutedCategories) groupData.mutedCategories = groupData.mutedCategories.filter(c => c !== cat);
                }
                setDirty(true);
            });
            mutedList.appendChild(div);
        });

        document.getElementById('auto-stt').checked = !!groupData.autoStt;
        
        const interact = groupData.interact || {};
        document.getElementById('auto-interaction').checked = !!interact.enabled;
        
        const chanceVal = interact.chance || 1;
        document.getElementById('interaction-chance').value = chanceVal; 
        document.getElementById('chance-val').textContent = (chanceVal / 100).toFixed(2);
        document.getElementById('interaction-chance').max = 1000;

        document.getElementById('interaction-cooldown').value = interact.cooldown || 5;
        document.getElementById('cooldown-val').textContent = interact.cooldown || 5;

        toggleInteractionSettings(!!interact.enabled);

        renderMediaList('greetings-list', groupData.greetings || {}, 'greetings');
        renderMediaList('farewells-list', groupData.farewells || {}, 'farewells');

        document.getElementById('auto-translate').checked = !!groupData.autoTranslateTo;
        document.getElementById('translate-lang').value = typeof groupData.autoTranslateTo === 'string' ? groupData.autoTranslateTo : '';
        toggleTranslateSettings(!!groupData.autoTranslateTo);

        renderStreamSection('twitch');
        renderStreamSection('kick');
        renderStreamSection('youtube');
    }

    function renderTags(containerId, dataList, updateCallback) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        dataList.forEach(item => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.innerHTML = `${item} <span class="remove">&times;</span>`;
            tag.querySelector('.remove').onclick = () => {
                const newList = dataList.filter(i => i !== item);
                updateCallback(newList);
                renderTags(containerId, newList, updateCallback);
            };
            container.appendChild(tag);
        });
    }

    function renderMediaList(containerId, mediaObj, type) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        Object.entries(mediaObj).forEach(([key, value]) => {
            if(!value) return;
            const div = document.createElement('div');
            div.className = 'media-item';
            
            let display = key;
            if(key === 'text') {
                const textVal = typeof value === 'string' ? value : String(value || '');
                display = `📝 Texto: ${textVal.substring(0, 30)}...`;
            } else {
                const mediaLink = `/media-direct/${value.file}?token=${token}`;
                const captionVal = typeof value.caption === 'string' ? value.caption : '';
                const captionDisplay = captionVal ? `(${captionVal.substring(0, 10)}...)` : '';
                display = `${getIcon(key)} ${key}: <a href="${mediaLink}" target="_blank" class="media-link">Clique para Visualizar</a> ${captionDisplay}`;
            }

            div.innerHTML = `
                <div class="media-item-content">${display}</div>
                <button class="btn btn-xs btn-danger"><i class="fas fa-trash"></i></button>
            `;
            div.querySelector('button').onclick = async () => {
                if(await showCustomConfirm('Remover este item?')) {
                    delete mediaObj[key];
                    setDirty(true);
                    renderMediaList(containerId, mediaObj, type);
                }
            };
            container.appendChild(div);
        });
    }

    function getIcon(type) {
        const map = { image: '🖼️', video: '📹', audio: '🎵', sticker: '🏷️', text: '📝' };
        return map[type] || '📁';
    }

    // --- Accordion Logic ---

    els.accordions.forEach(acc => {
        acc.querySelector('.accordion-header').addEventListener('click', () => {
            const currentActive = document.querySelector('.accordion-item.active');
            if(currentActive && currentActive !== acc) {
                currentActive.classList.remove('active');
            }
            acc.classList.toggle('active');
        });
    });

    els.subAccordions.forEach(sub => {
        sub.querySelector('.sub-accordion-header').addEventListener('click', () => {
            sub.classList.toggle('active');
        });
    });

    function toggleInteractionSettings(show) {
        document.getElementById('interaction-settings').classList.toggle('hidden', !show);
    }

    function toggleTranslateSettings(show) {
        document.getElementById('translate-settings').classList.toggle('hidden', !show);
    }

    function setupListAdder(btnId, inputId, dataPath) {
        document.getElementById(btnId).addEventListener('click', () => {
            const input = document.getElementById(inputId);
            const val = input.value.trim();
            if(!val) return;

            const parts = dataPath.split('.');
            let target = groupData;
            for(let i=0; i<parts.length-1; i++) {
                if(!target[parts[i]]) target[parts[i]] = {};
                target = target[parts[i]];
            }
            const lastKey = parts[parts.length-1];
            if(!target[lastKey]) target[lastKey] = [];
            
            if(!target[lastKey].includes(val)) {
                target[lastKey].push(val);
                setDirty(true);
                if(inputId.includes('number')) renderTags('ignored-numbers-list', groupData.ignoredNumbers, (l)=>groupData.ignoredNumbers=l);
                else if(inputId.includes('word')) renderTags('forbidden-words-list', groupData.filters.words, (l)=>groupData.filters.words=l);
                else if(inputId.includes('forbidden-user')) renderTags('forbidden-users-list', groupData.filters.people, (l)=>groupData.filters.people=l);
                else if(inputId.includes('cmd')) renderTags('ignored-cmds-list', groupData.mutedStrings, (l)=>groupData.mutedStrings=l);
                else if(inputId.includes('admin')) renderTags('additional-admins-list', groupData.additionalAdmins, (l)=>groupData.additionalAdmins=l);
            }
            input.value = '';
        });
    }

    document.querySelectorAll('.btn-save-section').forEach(btn => {
        btn.addEventListener('click', () => saveAllChanges());
    });


    // --- Stream Logic ---

    const DEFAULT_MSG = {
        twitch: "⚠️ ATENÇÃO!⚠️\n\n🌟 *{nomeCanal}* ✨ está *online* streamando *{jogo}*!\n_{titulo}_\n\nhttps://twitch.tv/{nomeCanal}",
        kick: "⚠️ ATENÇÃO!⚠️\n\n🌟 *{nomeCanal}* ✨ está *online* streamando *{jogo}*!\n_{titulo}_\n\nhttps://kick.com/{nomeCanal}",
        youtube: "*⚠️ Vídeo novo! ⚠️*\n\n*{author}:* *{title}* \n{link}"
    };

    function renderStreamSection(platform) {
        const tbody = document.querySelector(`#${platform}-table tbody`);
        const noMsg = document.getElementById(`no-${platform}-msg`);
        tbody.innerHTML = '';
        
        const list = groupData[platform] || [];
        
        if (list.length === 0) {
            noMsg.classList.remove('hidden');
        } else {
            noMsg.classList.add('hidden');
            list.forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.channel}</td>
                    <td>
                        <button class="btn btn-xs btn-primary btn-edit-stream" data-platform="${platform}" data-index="${index}"><i class="fas fa-edit"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            document.querySelectorAll(`.btn-edit-stream[data-platform="${platform}"]`).forEach(btn => {
                btn.addEventListener('click', () => openStreamModal(platform, btn.dataset.index));
            });
        }
    }

    document.querySelectorAll('.btn-add-stream').forEach(btn => {
        btn.addEventListener('click', () => openStreamModal(btn.dataset.platform, null));
    });

    function openStreamModal(platform, index) {
        currentStream = { platform, index, data: null };
        const isEdit = index !== null;
        
        els.streamModalTitle.textContent = isEdit ? `Editar ${platform.charAt(0).toUpperCase() + platform.slice(1)}` : `Adicionar ${platform.charAt(0).toUpperCase() + platform.slice(1)}`;
        els.btnDeleteStream.classList.toggle('hidden', !isEdit);
        els.streamHint.textContent = platform === 'youtube' ? 'ID do canal ou Handle (@nome).' : 'Apenas o nome de usuário, sem URL.';
        
        if (isEdit) {
            const data = groupData[platform][index];
            currentStream.data = JSON.parse(JSON.stringify(data));
        } else {
            currentStream.data = {
                channel: '',
                mentionAllMembers: false,
                changeTitleOnEvent: false,
                onlineTitle: '',
                offlineTitle: '',
                useAI: false,
                onConfig: { media: [{ type: 'text', content: DEFAULT_MSG[platform] }] },
                offConfig: { media: [] }
            };
        }

        const d = currentStream.data;
        els.streamChannel.value = d.channel;
        els.streamMention.checked = d.mentionAllMembers;
        els.streamChangeTitle.checked = d.changeTitleOnEvent;
        els.streamAI.checked = d.useAI;
        els.streamTitleOn.value = d.onlineTitle || '';
        els.streamTitleOff.value = d.offlineTitle || '';
        
        toggleStreamTitles(d.changeTitleOnEvent);
        renderStreamMediaList('stream-on-media-list', d.onConfig?.media || []);
        renderStreamMediaList('stream-off-media-list', d.offConfig?.media || []);

        els.streamModal.classList.remove('hidden');
    }

    function toggleStreamTitles(show) {
        els.streamTitlesGroup.classList.toggle('hidden', !show);
    }

    function renderStreamMediaList(containerId, mediaArray) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        
        mediaArray.forEach((media, index) => {
            const div = document.createElement('div');
            div.className = 'media-item';
            
            let display = media.type;
            if(media.type === 'text') {
                const textVal = typeof media.content === 'string' ? media.content : String(media.content || '');
                display = `📝 Texto: ${textVal.substring(0, 30)}...`;
            } else {
                const mediaLink = `/media-direct/${media.content}?token=${token}`;
                const captionVal = typeof media.caption === 'string' ? media.caption : '';
                const captionDisplay = captionVal ? `(${captionVal.substring(0, 10)}...)` : '';
                display = `${getIcon(media.type)} ${media.type}: <a href="${mediaLink}" target="_blank" class="media-link">Clique para Visualizar</a> ${captionDisplay}`;
            }

            div.innerHTML = `
                <div class="media-item-content">${display}</div>
                <div class="btn-group">
                    <button class="btn btn-xs btn-danger btn-remove-media-item"><i class="fas fa-trash"></i></button>
                </div>
            `;
            
            div.querySelector('.btn-remove-media-item').onclick = async () => {
                if(await showCustomConfirm('Remover este item?')) {
                    mediaArray.splice(index, 1);
                    renderStreamMediaList(containerId, mediaArray);
                }
            };

            container.appendChild(div);
        });
    }

    window.addStreamMedia = async function(context, type) {
        const targetArray = context === 'on' ? currentStream.data.onConfig.media : currentStream.data.offConfig.media;
        
        if (type === 'text') {
            const text = await showCustomPrompt("Digite o texto:");
            if (text) {
                const existingIdx = targetArray.findIndex(m => m.type === 'text');
                if(existingIdx !== -1) targetArray.splice(existingIdx, 1);
                
                targetArray.push({ type: 'text', content: text });
                renderStreamMediaList(`stream-${context}-media-list`, targetArray);
            }
        } else {
            els.uploadType.value = type;
            els.uploadContext.value = `stream-${context}`;
            els.mediaFileInput.value = '';
            els.mediaCaption.value = '';
            
            els.captionGroup.classList.remove('hidden');
            els.asStickerGroup.classList.add('hidden');
            if(type === 'image' || type === 'video') els.asStickerGroup.classList.remove('hidden');
            
            const existingVarBtn = els.captionGroup.querySelector('.btn-insert-var');
            if(existingVarBtn) existingVarBtn.remove();
            if(type === 'image' || type === 'video') {
                const varBtn = document.createElement('button');
                varBtn.type = 'button';
                varBtn.className = 'btn-insert-var';
                varBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Variável';
                varBtn.onclick = () => openVariableModal(els.mediaCaption);
                els.captionGroup.appendChild(varBtn);
            }

            els.uploadModal.classList.remove('hidden');
        }
    }

    window.addDirectMedia = async function(context, type) {
        if (type === 'text') {
            const text = await showCustomPrompt("Digite a mensagem:");
            if(text) {
                if(!groupData[context]) groupData[context] = {};
                groupData[context].text = text;
                renderMediaList(`${context}-list`, groupData[context], context);
                setDirty(true);
            }
        } else {
            els.uploadType.value = type;
            els.uploadContext.value = context;
            els.mediaFileInput.value = '';
            els.mediaCaption.value = '';
            
            els.captionGroup.classList.remove('hidden');
            els.asStickerGroup.classList.add('hidden');
            if(type === 'image' || type === 'video') els.asStickerGroup.classList.remove('hidden');
            
            const existingVarBtn = els.captionGroup.querySelector('.btn-insert-var');
            if(existingVarBtn) existingVarBtn.remove();
            if(type === 'image' || type === 'video') {
                const varBtn = document.createElement('button');
                varBtn.type = 'button';
                varBtn.className = 'btn-insert-var';
                varBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Variável';
                varBtn.onclick = () => openVariableModal(els.mediaCaption);
                els.captionGroup.appendChild(varBtn);
            }

            els.uploadModal.classList.remove('hidden');
        }
    };

    els.btnSaveStream.onclick = async () => {
        const channel = els.streamChannel.value.trim();
        if (!channel) return await showCustomAlert('Nome do canal obrigatório.');
        
        const platform = currentStream.platform;
        if (platform === 'twitch' || platform === 'kick') {
            if (channel.includes('/') || channel.includes('http')) return await showCustomAlert('Digite apenas o usuário, não a URL.');
            if (!/^[a-zA-Z0-9_]{2,50}$/.test(channel)) return await showCustomAlert('Nome de usuário inválido.');
        }

        const d = currentStream.data;
        d.channel = channel;
        d.mentionAllMembers = els.streamMention.checked;
        d.changeTitleOnEvent = els.streamChangeTitle.checked;
        d.useAI = els.streamAI.checked;
        d.onlineTitle = els.streamTitleOn.value;
        d.offlineTitle = els.streamTitleOff.value;

        if (!groupData[platform]) groupData[platform] = [];
        
        if (currentStream.index !== null) {
            groupData[platform][currentStream.index] = d;
        } else {
            groupData[platform].push(d);
        }

        setDirty(true);
        renderStreamSection(platform);
        els.streamModal.classList.add('hidden');
    };

    els.btnDeleteStream.onclick = async () => {
        if(!await showCustomConfirm('Tem certeza que deseja remover este canal?')) return;
        const { platform, index } = currentStream;
        groupData[platform].splice(index, 1);
        setDirty(true);
        renderStreamSection(platform);
        els.streamModal.classList.add('hidden');
    };


    // --- Custom Commands CRUD ---

    function renderCommandsTable() {
        const tbody = document.querySelector('#commands-table tbody');
        tbody.innerHTML = '';
        const activeCmds = customCommands.filter(c => !c.deleted);
        
        if (activeCmds.length === 0) {
            document.getElementById('no-commands-msg').classList.remove('hidden');
            return;
        } else {
            document.getElementById('no-commands-msg').classList.add('hidden');
        }

        activeCmds.forEach(cmd => {
            const tr = document.createElement('tr');
            
            const responsesCount = cmd.responses ? cmd.responses.length : 0;
            const firstResp = responsesCount > 0 ? cmd.responses[0] : '';
            let respPreview = firstResp;
            if (firstResp.startsWith('{')) {
                const end = firstResp.indexOf('}');
                const meta = firstResp.substring(1, end).split('-');
                let type = meta[0];
                if (type === 'stickerGif') type = 'sticker';
                respPreview = `${getIcon(type)} Mídia (${type})`;
            } else {
                if (respPreview.length > 30) respPreview = respPreview.substring(0, 30) + '...';
            }
            if (responsesCount > 1) respPreview += ` (+${responsesCount-1})`;

            tr.innerHTML = `
                <td>
                    <button class="btn btn-xs btn-primary btn-edit-cmd"><i class="fas fa-edit"></i></button>
                </td>
                <td>${cmd.startsWith} ${!cmd.active ? '(Desativado)' : ''}</td>
                <td>${respPreview}</td>
            `;
            
            tr.querySelector('.btn-edit-cmd').onclick = () => openCommandModal(cmd);
            tbody.appendChild(tr);
        });
    }

    document.getElementById('btn-add-command').onclick = () => openCommandModal(null);

    let currentEditingCmd = null;

    function openCommandModal(cmd) {
        currentEditingCmd = cmd;
        els.modalTitle.textContent = cmd ? 'Editar Comando' : 'Novo Comando';
        els.btnDeleteCmd.classList.toggle('hidden', !cmd);
        els.cmdResponsesList.innerHTML = '';

        if (cmd) {
            els.cmdTrigger.value = cmd.startsWith;
            els.cmdActive.checked = cmd.active;
            els.cmdInteract.checked = !cmd.ignoreInteract;
            els.cmdReplyQuote.checked = cmd.reply !== false; 
            els.cmdSendAll.checked = !!cmd.sendAllResponses;
            els.cmdEmoji.value = cmd.react || '';
            
            if (cmd.responses) {
                cmd.responses.forEach(r => addResponseInput('text', r));
            }
            
            els.cmdMetadata.innerHTML = `Criado por: ${cmd.metadata?.createdBy || '?'} em ${new Date(cmd.metadata?.createdAt || Date.now()).toLocaleString()}<br>Usado ${cmd.count || 0} vezes.`;
        } else {
            els.cmdTrigger.value = '';
            els.cmdActive.checked = true;
            els.cmdInteract.checked = true;
            els.cmdReplyQuote.checked = true;
            els.cmdSendAll.checked = false;
            els.cmdEmoji.value = '';
            addResponseInput('text', '');
            els.cmdMetadata.innerHTML = '';
        }

        els.cmdModal.classList.remove('hidden');
    }

    function renderEmojiGrid() {
        const container = document.getElementById('emoji-list');
        container.innerHTML = '';
        COMMON_EMOJIS.forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.className = 'emoji-item';
            span.onclick = () => insertEmoji(emoji);
            container.appendChild(span);
        });
    }

    function insertEmoji(emoji) {
        els.cmdEmoji.value = emoji;
        setDirty(true);
        els.emojiModal.classList.add('hidden');
    }

    function renderVariables(filter = '') {
        const container = document.getElementById('variable-list');
        container.innerHTML = '';
        
        const filtered = AVAILABLE_VARIABLES.filter(v => 
            v.code.toLowerCase().includes(filter.toLowerCase()) || 
            v.desc.toLowerCase().includes(filter.toLowerCase())
        );

        filtered.forEach(v => {
            const div = document.createElement('div');
            div.className = 'variable-item';
            div.innerHTML = `
                <div class="variable-code">${v.code}</div>
                <div class="variable-desc">${v.desc}</div>
            `;
            div.onclick = () => insertVariable(v.code);
            container.appendChild(div);
        });
    }

    function openVariableModal(targetInput) {
        lastFocusedInput = targetInput;
        document.getElementById('variable-modal-title').textContent = 'Variáveis Disponíveis';
        document.getElementById('variable-search').value = '';
        document.getElementById('variable-search').placeholder = 'Buscar variável...';
        
        pickerMode = 'variable';
        renderVariables();
        els.variableModal.classList.remove('hidden');
        document.getElementById('variable-search').focus();
    }

    function insertVariable(code) {
        if (lastFocusedInput) {
            const start = lastFocusedInput.selectionStart;
            const end = lastFocusedInput.selectionEnd;
            const text = lastFocusedInput.value;
            
            lastFocusedInput.value = text.substring(0, start) + code + text.substring(end);
            lastFocusedInput.selectionStart = lastFocusedInput.selectionEnd = start + code.length;
            lastFocusedInput.focus();
            lastFocusedInput.dispatchEvent(new Event('input')); 
        }
        els.variableModal.classList.add('hidden');
    }

    window.addResponseInput = function(type, value = '') {
        const div = document.createElement('div');
        div.className = 'response-item-row';
        
        let isMedia = value && value.startsWith && value.startsWith('{');
        let mediaType = type;
        let mediaContent = value;
        let mediaCaption = '';

        if (isMedia) {
            const end = value.indexOf('}');
            const meta = value.substring(1, end).split('-');
            mediaType = meta[0]; 
            mediaContent = meta[1]; 
            mediaCaption = value.substring(end+1).trim();
        }

        if (mediaType === 'text') {
             div.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column;">
                    <input type="text" class="form-control cmd-response-input" value="${value && !isMedia ? value : ''}" placeholder="Texto da resposta">
                    <button type="button" class="btn-insert-var"><i class="fas fa-plus-circle"></i> Variável</button>
                </div>
                <button type="button" class="btn btn-xs btn-danger remove-resp" style="align-self: flex-start; margin-top: 5px;"><i class="fas fa-trash"></i></button>
            `;
            const input = div.querySelector('input');
            div.querySelector('.btn-insert-var').onclick = () => openVariableModal(input);
        } else {
            const mediaLink = `/media-direct/${mediaContent}?token=${token}`;
            div.innerHTML = `
                <div class="media-preview form-control">
                    ${getIcon(mediaType)} ${mediaType}: <a href="${mediaLink}" target="_blank" class="media-link">Clique para Visualizar</a> 
                    ${mediaCaption ? `(${mediaCaption})` : ''}
                </div>
                <input type="hidden" class="cmd-response-input" value="${value}">
                <button type="button" class="btn btn-xs btn-danger remove-resp"><i class="fas fa-trash"></i></button>
            `;
        }

        div.querySelector('.remove-resp').onclick = () => div.remove();
        els.cmdResponsesList.appendChild(div);
    }

    window.openMediaUpload = function(type) {
        els.uploadType.value = type;
        els.uploadContext.value = 'command';
        els.mediaFileInput.value = '';
        els.mediaCaption.value = '';
        
        els.captionGroup.classList.remove('hidden');
        els.asStickerGroup.classList.add('hidden');
        
        const existingVarBtn = els.captionGroup.querySelector('.btn-insert-var');
        if(existingVarBtn) existingVarBtn.remove();

        if(type === 'sticker') els.captionGroup.classList.add('hidden');
        if(type === 'image' || type === 'video') {
            els.asStickerGroup.classList.remove('hidden');
            const varBtn = document.createElement('button');
            varBtn.type = 'button';
            varBtn.className = 'btn-insert-var';
            varBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Variável';
            varBtn.onclick = () => openVariableModal(els.mediaCaption);
            els.captionGroup.appendChild(varBtn);
        }

        els.uploadModal.classList.remove('hidden');
    }

    // --- Upload Logic ---

    els.btnConfirmUpload.addEventListener('click', () => {
        const file = els.mediaFileInput.files[0];
        if (!file) return showCustomAlert('Selecione um arquivo');
        
        const type = els.uploadType.value;
        const context = els.uploadContext.value;
        const caption = els.mediaCaption.value;
        const asSticker = document.getElementById('convert-sticker').checked;
        const finalType = asSticker ? 'sticker' : type;
        const name = `${Date.now()}-${file.name}`;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('token', token);
        formData.append('groupId', groupId);
        formData.append('type', finalType); 
        formData.append('name', name);
        formData.append('caption', caption);

        els.btnConfirmUpload.disabled = true;
        els.btnConfirmUpload.innerHTML = 'Enviando... 0%';
        
        els.uploadStatus.innerHTML = '<span class="text-warning"><i class="fas fa-spinner fa-spin"></i> Aguarde! Não feche enquanto o arquivo está sendo enviado.</span>';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/upload-media`, true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                els.btnConfirmUpload.innerHTML = `Enviando... ${percent}%`;
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                if (data.success) {
                    if (context === 'command') {
                        const formatted = `{${finalType}-${data.fileName}} ${caption}`;
                        addResponseInput(finalType, formatted);
                    } else if (['greetings', 'farewells'].includes(context)) {
                        if (!groupData[context]) groupData[context] = {};
                        groupData[context][finalType] = { file: data.fileName, caption: caption };
                        renderMediaList(`${context}-list`, groupData[context], context);
                        setDirty(true);
                    } else if (context === 'stream-on') {
                        const existingIdx = currentStream.data.onConfig.media.findIndex(m => m.type === finalType);
                        if(existingIdx !== -1) currentStream.data.onConfig.media.splice(existingIdx, 1);
                        currentStream.data.onConfig.media.push({ type: finalType, content: data.fileName, caption });
                        renderStreamMediaList('stream-on-media-list', currentStream.data.onConfig.media);
                    } else if (context === 'stream-off') {
                        const existingIdx = currentStream.data.offConfig.media.findIndex(m => m.type === finalType);
                        if(existingIdx !== -1) currentStream.data.offConfig.media.splice(existingIdx, 1);
                        currentStream.data.offConfig.media.push({ type: finalType, content: data.fileName, caption });
                        renderStreamMediaList('stream-off-media-list', currentStream.data.offConfig.media);
                    }
                    els.uploadModal.classList.add('hidden');
                } else {
                    showCustomAlert('Erro: ' + data.message);
                }
            } else {
                showCustomAlert('Erro no upload');
            }
            cleanup();
        };

        xhr.onerror = () => {
            showCustomAlert('Erro de rede');
            cleanup();
        };

        function cleanup() {
            els.btnConfirmUpload.disabled = false;
            els.btnConfirmUpload.innerHTML = 'Upload';
            els.uploadStatus.innerHTML = '';
        }

        xhr.send(formData);
    });

    els.btnSaveCmd.addEventListener('click', async () => {
        const trigger = els.cmdTrigger.value.trim().toLowerCase();
        if (!trigger) return await showCustomAlert('O comando precisa de um gatilho');

        const inputs = document.querySelectorAll('.cmd-response-input');
        const responses = Array.from(inputs).map(i => i.value).filter(v => v.trim() !== '');
        
        if (responses.length === 0) return await showCustomAlert('Adicione pelo menos uma resposta');

        const newCmd = {
            startsWith: trigger, responses: responses, active: els.cmdActive.checked,
            ignoreInteract: !els.cmdInteract.checked, reply: els.cmdReplyQuote.checked,
            sendAllResponses: els.cmdSendAll.checked, react: els.cmdEmoji.value.trim() || null,
            count: currentEditingCmd ? currentEditingCmd.count : 0,
            metadata: currentEditingCmd ? currentEditingCmd.metadata : { createdBy: 'Painel Web', createdAt: Date.now() }
        };

        els.btnSaveCmd.textContent = 'Salvando...';
        els.btnSaveCmd.disabled = true;

        try {
            let url = `${API_BASE}/custom-commands/${groupId}`;
            let method = 'POST';
            if (currentEditingCmd) {
                url += `/${encodeURIComponent(currentEditingCmd.startsWith)}`;
                method = 'PUT';
            }

            const res = await fetch(url, {
                method: method,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token, command: newCmd })
            });

            if (res.ok) {
                await loadData();
                els.cmdModal.classList.add('hidden');
            } else {
                const err = await res.json();
                await showCustomAlert('Erro ao salvar comando: ' + err.message);
            }
        } catch (e) {
            await showCustomAlert('Erro: ' + e.message);
        } finally {
            els.btnSaveCmd.textContent = 'Salvar';
            els.btnSaveCmd.disabled = false;
        }
    });

    els.btnDeleteCmd.addEventListener('click', async () => {
        if(!await showCustomConfirm('Tem certeza?')) return;
        try {
            const url = `${API_BASE}/custom-commands/${groupId}/${encodeURIComponent(currentEditingCmd.startsWith)}?token=${token}`;
            const res = await fetch(url, { method: 'DELETE' });
            if (res.ok) {
                await loadData();
                els.cmdModal.classList.add('hidden');
            } else {
                await showCustomAlert('Erro ao deletar');
            }
        } catch (e) {
            await showCustomAlert('Erro: ' + e.message);
        }
    });

    function setupEventListeners() {
        els.retryBtn.addEventListener('click', () => window.location.reload());
        
        if (document.getElementById('btn-emoji-picker')) {
            document.getElementById('btn-emoji-picker').addEventListener('click', () => {
                renderEmojiGrid();
                els.emojiModal.classList.remove('hidden');
            });
        }

        if (document.getElementById('btn-lang-picker')) {
            document.getElementById('btn-lang-picker').addEventListener('click', () => {
                document.getElementById('variable-modal-title').textContent = 'Idiomas Disponíveis';
                document.getElementById('variable-search').value = '';
                document.getElementById('variable-search').placeholder = 'Buscar idioma...';
                pickerMode = 'language';
                renderLanguages();
                els.variableModal.classList.remove('hidden');
                document.getElementById('variable-search').focus();
            });
        }

        document.getElementById('variable-search').addEventListener('input', (e) => {
            if (pickerMode === 'variable') {
                renderVariables(e.target.value);
            } else {
                renderLanguages(e.target.value);
            }
        });

        document.querySelectorAll('.close-modal, .close-modal-btn, .close-stream-modal, .close-variable-modal, .close-emoji-modal, .close-dialog').forEach(b => {
            b.onclick = () => {
                els.cmdModal.classList.add('hidden');
                els.streamModal.classList.add('hidden');
                els.variableModal.classList.add('hidden');
                els.emojiModal.classList.add('hidden');
                els.customDialogModal.classList.add('hidden');
            };
        });
        els.closeUploadBtns.forEach(b => b.onclick = () => els.uploadModal.classList.add('hidden'));
    }

    init();
});