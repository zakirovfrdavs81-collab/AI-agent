document.addEventListener('DOMContentLoaded', () => {
    // A fresh page load always starts the visual boot sequence, including when
    // Live Server reuses an existing browser tab.
    if (window.performance && performance.getEntriesByType('navigation')[0]?.type === 'reload') {
        document.documentElement.classList.add('fresh-live-server-load');
    }
    const API_BASE = window.NAVO_CONFIG?.API_BASE_URL || window.location.origin;
    const bootScreen = document.getElementById('boot-screen');
    const authScreen = document.getElementById('auth-screen');
    const authForm = document.getElementById('auth-form');
    const authIdentity = document.getElementById('auth-identity');
    const authPassword = document.getElementById('auth-password');
    const authNickname = document.getElementById('auth-nickname');
    const nicknameField = document.getElementById('nickname-field');
    const authCode = document.getElementById('auth-code');
    const codeField = document.getElementById('code-field');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authSubmit = document.querySelector('.auth-submit');
    const authError = document.getElementById('auth-error');
    const authLoader = document.getElementById('auth-loader');
    const googleLogin = document.getElementById('google-login');
    const authTabs = document.querySelectorAll('.auth-tab');
    const forgotPassword = document.getElementById('forgot-password');
    let authMode = 'register';
    let verificationTarget = '';
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menu-toggle');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const welcomeScreen = document.getElementById('welcome-screen');
    const chatHistory = document.getElementById('chat-history');
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const filePreview = document.getElementById('file-preview');
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const logoutBtn = document.getElementById('logout-btn');
    const profileModal = document.getElementById('profile-modal');
    const profileClose = document.getElementById('profile-close');
    const profileNickname = document.getElementById('profile-nickname');
    const profileAvatarInput = document.getElementById('profile-avatar-input');
    const profileAvatarPreview = document.getElementById('profile-avatar-preview');
    const profileSave = document.getElementById('profile-save');
    const profileMessage = document.getElementById('profile-message');
    const appContainer = document.querySelector('.app-container');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsNote = document.getElementById('settings-note');
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');
    let selectedFile = null;
    let isSending = false;
    let currentTheme = 'dark';

    try {
        currentTheme = localStorage.getItem('navo-theme') === 'light' ? 'light' : 'dark';
    } catch {
        settingsNote.textContent = 'Brauzer sozlamalarni saqlashga ruxsat bermadi.';
    }

    function updateTheme() {
        const light = currentTheme === 'light';
        document.body.classList.toggle('light-theme', light);
        themeToggle.setAttribute('aria-pressed', String(light));
        themeLabel.textContent = light ? "Yorug‘" : "Qorong‘i";
        themeToggle.querySelector('.material-symbols-outlined').textContent = light ? 'light_mode' : 'dark_mode';
    }

    updateTheme();

    codeField.hidden = true;
    authCode.required = false;
    nicknameField.hidden = false;
    authNickname.required = true;

    const revealApp = () => {
        appContainer.classList.add('page-ready');
        if (!bootScreen) return;
        bootScreen.classList.add('is-closing');
        window.setTimeout(() => { bootScreen.hidden = true; }, 500);
    };

    const bootStartedAt = performance.now();
    const sessionCheck = Promise.race([
        checkSession(),
        new Promise((resolve) => window.setTimeout(resolve, 1800))
    ]);
    sessionCheck.finally(() => {
        const remaining = Math.max(0, 1500 - (performance.now() - bootStartedAt));
        window.setTimeout(revealApp, remaining);
    });
    authTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            authMode = tab.dataset.mode;
            authTitle.textContent = authMode === 'login' ? 'Hisobingizga kiring' : "Ro'yxatdan o'ting";
            authSubtitle.textContent = authMode === 'login'
                ? 'Chatdan foydalanish uchun tizimga kiring.'
                : 'Email yoki telefon raqamingiz bilan hisob yarating.';
            authSubmit.textContent = authMode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish";
            forgotPassword.hidden = authMode !== 'login';
            nicknameField.hidden = authMode !== 'register';
            authNickname.required = authMode === 'register';
            codeField.hidden = true;
            authCode.required = false;
            authError.textContent = '';
            authTabs.forEach((item) => item.classList.toggle('active', item === tab));
        });
    });
    forgotPassword.addEventListener('click', async () => {
        const destination = authIdentity.value.trim();
        if (!destination) return showAuthError('Avval email yoki telefon raqamini kiriting.');
        await authRequest('/api/auth/forgot', { destination, code: '000000', purpose: 'reset' }, 'Tiklash kodi yuborildi.');
        codeField.hidden = false;
        authCode.hidden = false;
        authMode = 'reset';
        authSubmit.textContent = 'Parolni yangilash';
        verificationTarget = destination;
    });
    authForm.addEventListener('submit', handleAuth);
    googleLogin.addEventListener('click', () => {
        authLoader.hidden = false;
        window.location.href = `${API_BASE}/api/auth/google`;
    });

    async function checkSession() {
        try {
            const response = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
            const data = await response.json();
            authScreen.hidden = data.authenticated;
            if (data.authenticated) renderUser(data.user);
        } catch {
            authScreen.hidden = false;
            showAuthError("Server ishga tushmagan. `run.bat` orqali serverni ishga tushiring.");
        }
    }

    async function handleAuth(event) {
        event.preventDefault();
        const identity = authIdentity.value.trim();
        const password = authPassword.value;
        if (authMode === 'reset') {
            const result = await authRequest('/api/auth/reset', { destination: verificationTarget, code: authCode.value, purpose: 'reset', password }, 'Parol yangilandi.');
            if (result) { authMode = 'login'; codeField.hidden = true; authCode.hidden = true; }
            return;
        }
        if (authMode === 'register' && !codeField.hidden) {
            const response = await authRequest('/api/auth/verify', { destination: verificationTarget, code: authCode.value, purpose: 'register' });
            if (response) { authScreen.hidden = true; renderUser(response.user); }
            return;
        }
        if (authMode === 'register') {
            verificationTarget = identity;
            const result = await authRequest('/api/auth/register', { email: identity.includes('@') ? identity : null, phone: identity.includes('@') ? null : identity, password, nickname: authNickname.value.trim() }, 'Kod yuborildi. SMS kodini kiriting.');
            if (result) { codeField.hidden = false; authCode.hidden = false; authCode.required = true; authSubmit.textContent = 'Tasdiqlash'; }
            return;
        }
        const result = await authRequest('/api/auth/login', { identity, password });
        if (result) { authScreen.hidden = true; renderUser(result.user); }
    }

    async function authRequest(url, body, successMessage) {
        setAuthBusy(true);
        try {
            const response = await fetch(`${API_BASE}${url}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(formatApiError(data.detail) || `Server xatosi (${response.status}). Backend ishlayotganini tekshiring.`);
            }
            authError.textContent = data.demo_code
                ? `${data.message} Kod: ${data.demo_code}`
                : (data.message || successMessage);
            return data;
        } catch (error) {
            showAuthError(error.message);
            return null;
        } finally { setAuthBusy(false); }
    }

    function formatApiError(detail) {
        if (typeof detail === 'string') return detail;
        if (Array.isArray(detail)) {
            return detail.map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item.msg === 'string') return item.msg;
                return JSON.stringify(item);
            }).join(', ');
        }
        if (detail && typeof detail === 'object') {
            if (typeof detail.message === 'string') return detail.message;
            if (typeof detail.msg === 'string') return detail.msg;
            return JSON.stringify(detail);
        }
        return '';
    }

    function showAuthError(message) { authError.textContent = message; }
    function setAuthBusy(busy) { authLoader.hidden = !busy; authSubmit.disabled = busy; }

    function renderUser(user) {
        const name = user.nickname || user.name || 'Foydalanuvchi';
        userName.textContent = name;
        userAvatar.textContent = user.avatar ? '' : name.slice(0, 1).toUpperCase();
        userAvatar.style.backgroundImage = user.avatar ? `url("${user.avatar}")` : '';
        userAvatar.style.backgroundSize = 'cover';
        profileNickname.value = name;
        profileAvatarPreview.src = user.avatar || '';
    }

    userAvatar.addEventListener('click', () => { profileModal.hidden = false; });
    userName.addEventListener('click', () => { profileModal.hidden = false; });
    profileClose.addEventListener('click', () => { profileModal.hidden = true; });
    profileAvatarInput.addEventListener('change', () => {
        const file = profileAvatarInput.files[0];
        if (!file || !file.type.startsWith('image/') || file.size > 500000) {
            profileMessage.textContent = "Rasm 500 KB dan kichik bo‘lishi kerak.";
            return;
        }
        const reader = new FileReader();
        reader.onload = () => { profileAvatarPreview.src = String(reader.result); };
        reader.readAsDataURL(file);
    });
    profileSave.addEventListener('click', async () => {
        profileSave.disabled = true;
        try {
            const response = await fetch(`${API_BASE}/api/profile`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname: profileNickname.value.trim(), avatar: profileAvatarPreview.src || null })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(formatApiError(data.detail) || "Profilni saqlab bo‘lmadi.");
            renderUser(data.user);
            profileMessage.textContent = data.message;
            setTimeout(() => { profileModal.hidden = true; }, 700);
        } catch (error) {
            profileMessage.textContent = error.message;
        } finally { profileSave.disabled = false; }
    });
    logoutBtn.addEventListener('click', async () => {
        await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
        window.location.reload();
    });
    
    // Auto-resize textarea
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        // Show/hide send button based on input
        if (this.value.trim().length > 0) {
            sendBtn.classList.add('active');
        } else {
            sendBtn.classList.remove('active');
        }
    });

    // Handle Enter key for submission (but allow Shift+Enter for new line)
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (promptInput.value.trim().length > 0 || selectedFile) {
                handleSend();
            }
        }
    });

    // Toggle Sidebar
    menuToggle.addEventListener('click', () => {
        // Toggle mobile vs desktop class
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('open');
        } else {
            sidebar.classList.toggle('collapsed');
        }
    });

    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Handle suggestion cards click
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const text = card.querySelector('p').innerText;
            promptInput.value = text;
            promptInput.style.height = 'auto';
            sendBtn.classList.add('active');
            promptInput.focus();
        });
    });

    // Send Button Click
    sendBtn.addEventListener('click', handleSend);
    attachBtn.addEventListener('click', () => fileInput.click());
    document.getElementById('image-upload-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) setSelectedFile(file);
    });
    filePreview.addEventListener('click', (event) => {
        if (event.target.closest('.remove-file')) {
            selectedFile = null;
            fileInput.value = '';
            filePreview.hidden = true;
            filePreview.innerHTML = '';
        }
    });
    ['dragenter', 'dragover'].forEach((eventName) => {
        document.querySelector('.input-box').addEventListener(eventName, (event) => {
            event.preventDefault();
            document.querySelector('.input-box').classList.add('drop-active');
        });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
        document.querySelector('.input-box').addEventListener(eventName, (event) => {
            event.preventDefault();
            document.querySelector('.input-box').classList.remove('drop-active');
        });
    });
    document.querySelector('.input-box').addEventListener('drop', (event) => {
        const file = event.dataTransfer.files[0];
        if (file) setSelectedFile(file);
    });

    async function handleSend() {
        const text = promptInput.value.trim() || (selectedFile ? "Ushbu faylni tahlil qiling." : "");
        if (!text || isSending) return;
        isSending = true;
        sendBtn.disabled = true;

        // Hide welcome screen, show chat history
        welcomeScreen.style.display = 'none';
        chatHistory.style.display = 'flex';

        // Add user message to UI
        appendMessage(text, 'user');

        // Clear input
        promptInput.value = '';
        promptInput.style.height = 'auto';
        sendBtn.classList.remove('active');

        // Scroll to bottom
        scrollToBottom();

        // Add loading indicator for bot
        const loadingId = appendLoading();
        scrollToBottom();

        try {
            // Call API from api.js
            // fetchGeminiResponse is defined in js/api.js
            const attachment = selectedFile ? await readFile(selectedFile) : null;
            const response = await fetchGeminiResponse(text, attachment);
            
            // Remove loading indicator
            removeElement(loadingId);
            
            // Formats markdown lightly (e.g. bold text)
            const formattedText = formatMarkdown(response.text);
            
            // Add bot message
            appendMessage(formattedText, 'bot');
            scrollToBottom();
            selectedFile = null;
            fileInput.value = '';
            filePreview.hidden = true;
            filePreview.innerHTML = '';
            
        } catch (error) {
            removeElement(loadingId);
            appendMessage(`Xatolik: ${escapeHtml(error.message || "Qaytadan urinib ko'ring.")}`, 'bot');
            scrollToBottom();
        } finally {
            isSending = false;
            sendBtn.disabled = false;
        }
    }

    function setSelectedFile(file) {
        const maxSize = 10 * 1024 * 1024;
        const supportedTypes = file.type.startsWith('image/') ||
            ['application/pdf', 'application/json', 'text/plain', 'text/markdown', 'text/csv'].includes(file.type);
        if (!supportedTypes) {
            appendMessage("Bu fayl turi qo'llab-quvvatlanmaydi. Rasm, PDF, TXT, MD, CSV yoki JSON yuboring.", 'bot');
            return;
        }
        if (file.size > maxSize) {
            appendMessage("Fayl hajmi 10 MB dan oshmasligi kerak.", 'bot');
            return;
        }
        selectedFile = file;
        sendBtn.classList.add('active');
        filePreview.hidden = false;
        filePreview.innerHTML = `
            <span class="material-symbols-outlined file-icon">description</span>
            <span class="file-info"><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
            <button class="remove-file" type="button" title="Faylni olib tashlash">
                <span class="material-symbols-outlined">close</span>
            </button>
        `;
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result);
                resolve({ type: file.type || 'application/octet-stream', data: result.split(',')[1] || result });
            };
            reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
            reader.readAsDataURL(file);
        });
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function escapeHtml(text) {
        return text.replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[char]));
    }


    function appendMessage(content, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        
        if (sender === 'bot') {
            msgDiv.innerHTML = `
                <div class="bot-icon">
                    <span class="material-symbols-outlined"></span>
                </div>
                <div class="msg-content">${content}</div>
            `;
        } else {
            msgDiv.innerHTML = `
                <div class="msg-content">${content}</div>
            `;
        }
        
        chatHistory.appendChild(msgDiv);
    }

    function appendLoading() {
        const id = 'loading-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = `message bot`;
        msgDiv.id = id;
        
        msgDiv.innerHTML = `
            <div class="bot-icon">
                <span class="material-symbols-outlined"></span>
            </div>
            <div class="msg-content">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        chatHistory.appendChild(msgDiv);
        return id;
    }

    function removeElement(id) {
        const el = document.getElementById(id);
        if (el) {
            el.remove();
        }
    }

    function scrollToBottom() {
        const chatContainer = document.querySelector('.chat-container');
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    // Basic Markdown to HTML (bold and line breaks)
    function formatMarkdown(text) {
        let html = text.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        // Convert **text** to <strong>text</strong>
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Convert *text* to <em>text</em>
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Convert newlines to <br>
        html = html.replace(/\n/g, '<br>');
        return html;
    }
    
    // New chat functionality
    document.querySelector('.new-chat').addEventListener('click', () => {
        chatHistory.innerHTML = '';
        chatHistory.style.display = 'none';
        welcomeScreen.style.display = 'block';
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('open');
        }
    });

    function openSettings(message = '') {
        settingsNote.textContent = message;
        settingsOverlay.hidden = false;
        document.getElementById('settings-close').focus();
    }

    function closeSettings() {
        settingsOverlay.hidden = true;
        document.getElementById('settings-header-open').focus();
    }

    document.getElementById('settings-open').addEventListener('click', () => openSettings());
    document.getElementById('settings-header-open').addEventListener('click', () => openSettings());
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('settings-done').addEventListener('click', closeSettings);
    document.getElementById('help-btn').addEventListener('click', () => {
        openSettings('Gemini API kalitini serverdagi .env faylida GEMINI_API_KEY qatoriga yozing.');
    });
    settingsOverlay.addEventListener('click', (event) => {
        if (event.target === settingsOverlay) closeSettings();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !settingsOverlay.hidden) closeSettings();
    });
    themeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        updateTheme();
        try {
            localStorage.setItem('navo-theme', currentTheme);
            settingsNote.textContent = "Ko‘rinish sozlamasi saqlandi.";
        } catch {
            settingsNote.textContent = 'Brauzer sozlamani saqlay olmadi.';
        }
    });

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const voiceButton = document.getElementById('voice-btn');
    if (!SpeechRecognition) {
        voiceButton.title = 'Ovozli kiritish Chrome yoki Edge brauzerida ishlaydi';
        voiceButton.addEventListener('click', () => window.alert('Ovozli kiritish uchun Chrome yoki Edge brauzeridan foydalaning.'));
    } else {
        const recognition = new SpeechRecognition();
        recognition.lang = 'uz-UZ';
        recognition.interimResults = true;
        let listening = false;
        voiceButton.addEventListener('click', () => {
            if (listening) recognition.stop();
            else recognition.start();
        });
        recognition.onstart = () => {
            listening = true;
            voiceButton.classList.add('voice-listening');
            promptInput.placeholder = 'Tinglayapman…';
        };
        recognition.onresult = (event) => {
            promptInput.value = Array.from(event.results).map((result) => result[0].transcript).join('');
            promptInput.dispatchEvent(new Event('input'));
        };
        recognition.onerror = () => {
            promptInput.placeholder = 'Shu yerga yozing...';
        };
        recognition.onend = () => {
            listening = false;
            voiceButton.classList.remove('voice-listening');
            promptInput.placeholder = 'Shu yerga yozing...';
        };
    }
});
