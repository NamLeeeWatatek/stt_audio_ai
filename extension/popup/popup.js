import { MESSAGE_TYPES, STORAGE_KEYS } from '../shared/message.types.js';
import { ChromeBrowserAdapter } from '../platforms/chrome/browser.adapter.js';
import { ChromeStorageAdapter } from '../platforms/chrome/storage.adapter.js';
import { ChromeAuthAdapter } from '../platforms/chrome/auth.adapter.js';
import { CONFIG } from '../shared/config.js';

const browser = new ChromeBrowserAdapter();
const storage = new ChromeStorageAdapter();
const auth = new ChromeAuthAdapter();

let timerInterval = null;
let recordingStartTime = null;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 [Scriberr] Popup DOM Loaded');

    // Auto refresh auth on focus
    window.addEventListener('focus', refreshAuth);

    const elements = {
        recordBtn: document.getElementById('record-btn'),
        btnText: document.getElementById('btn-text'),
        visualizer: document.getElementById('visualizer'),
        transcriptContent: document.getElementById('transcript-content'),
        captureName: document.getElementById('capture-name'),
        loginLinkBtn: document.getElementById('login-link-btn'),
        appMainContent: document.getElementById('app-main-content'),
        loginOverlay: document.getElementById('login-overlay'),
        userPill: document.getElementById('user-pill'),
        userAvatar: document.getElementById('user-avatar'),
        userName: document.getElementById('user-name'),
        logoutBtn: document.getElementById('logout-btn'),
        timer: document.getElementById('recording-timer'),
        vBars: []
    };

    // 0. Nhắm đúng Tab đã mở Extension (Fix lỗi permission)
    const urlParams = new URLSearchParams(window.location.search);
    const targetTabId = urlParams.get('targetTabId') ? parseInt(urlParams.get('targetTabId')) : null;

    // 1. Initial State
    const isAuth = await auth.isAuthenticated();
    updateAuthUI(isAuth);

    let isRecording = await storage.get(STORAGE_KEYS.IS_RECORDING) || false;
    setUIState(isRecording);

    // Tự động khôi phục Tab ID nếu đang ghi âm
    const savedTabId = await storage.get(STORAGE_KEYS.RECORDING_TAB);
    const recordingTabId = isRecording ? (savedTabId || targetTabId) : targetTabId;

    if (isRecording) {
        recordingStartTime = await storage.get('RECORDING_START_TIME');
        if (recordingStartTime) startTimerUI();
    }

    // 3. Initialize Visualizer
    if (elements.visualizer) {
        elements.visualizer.innerHTML = '';
        for (let i = 0; i < 15; i++) {
            const bar = document.createElement('div');
            bar.className = 'v-bar';
            elements.visualizer.appendChild(bar);
            elements.vBars.push(bar);
        }
    }

    // 4. Click Events
    elements.loginLinkBtn?.addEventListener('click', () => {
        chrome.tabs.create({ url: `${CONFIG.PORTAL_BASE_URL}/dashboard?from_extension=true` });
    });

    elements.logoutBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm("Logout from Scriberr?")) {
            await auth.clearAuth();
            updateAuthUI(false);
        }
    });

    elements.userPill?.addEventListener('click', () => {
        const logout = elements.logoutBtn;
        if (logout) {
            logout.style.display = logout.style.display === 'none' ? 'flex' : 'none';
        }
    });

    elements.recordBtn?.addEventListener('click', async () => {
        try {
            if (!isRecording) {
                const name = elements.captureName?.value?.trim() || `Meeting ${new Date().toLocaleTimeString()}`;

                // Sử dụng tab mục tiêu từ URL hoặc tìm tab active nếu không có
                let tabId = targetTabId;
                if (!tabId) {
                    const activeTab = await browser.getActiveTab();
                    tabId = activeTab?.id;
                }

                if (!tabId) return alert("Please focus on the meeting tab and try again.");

                // Gửi lệnh START lên background.
                const response = await browser.sendMessage({
                    type: MESSAGE_TYPES.START_RECORDING,
                    targetTabId: tabId,
                    meetingName: name
                });

                if (response?.success) {
                    recordingStartTime = Date.now();
                    await storage.set('RECORDING_START_TIME', recordingStartTime);
                    setUIState(true);
                    startTimerUI();
                } else alert("Failed: " + (response?.error || "?"));
            } else {
                elements.recordBtn.disabled = true;
                if (elements.btnText) elements.btnText.innerText = "Saving...";

                const response = await browser.sendMessage({ type: MESSAGE_TYPES.STOP_RECORDING });
                elements.recordBtn.disabled = false;

                if (response?.success) {
                    setUIState(false);
                    stopTimerUI();
                    await storage.remove('RECORDING_START_TIME');
                }
            }
        } catch (err) {
            alert("Error: " + err.message);
        }
    });

    // --- Helper Functions ---

    async function refreshAuth() {
        const status = await auth.isAuthenticated();
        updateAuthUI(status);
    }

    function updateAuthUI(isAuth) {
        if (isAuth) {
            if (elements.loginOverlay) elements.loginOverlay.style.display = 'none';
            if (elements.appMainContent) elements.appMainContent.style.display = 'flex';

            auth.getUserInfo().then(info => {
                if (elements.userPill) {
                    elements.userPill.style.display = 'flex';
                    if (info) {
                        const name = info.full_name || info.username || 'User';
                        if (elements.userAvatar) {
                            elements.userAvatar.src = info.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4F6EF7&color=fff`;
                        }
                        if (elements.userName) elements.userName.innerText = name;
                    } else {
                        if (elements.userName) elements.userName.innerText = 'Authenticated';
                    }
                }
            });
        } else {
            if (elements.loginOverlay) elements.loginOverlay.style.display = 'flex';
            if (elements.appMainContent) elements.appMainContent.style.display = 'none';
            if (elements.userPill) elements.userPill.style.display = 'none';
        }
    }

    function setUIState(recording) {
        isRecording = recording;
        if (elements.recordBtn) {
            if (recording) {
                elements.recordBtn.classList.add('recording');
                if (elements.btnText) elements.btnText.innerText = "Stop and Save Meeting";
                if (elements.timer) elements.timer.style.display = 'block';
            } else {
                elements.recordBtn.classList.remove('recording');
                if (elements.btnText) elements.btnText.innerText = "Connect Audio Source";
                if (elements.timer) elements.timer.style.display = 'none';
                elements.vBars.forEach(b => b.style.height = '3px');
            }
        }
    }

    function startTimerUI() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (!recordingStartTime) return;
            const diff = Date.now() - recordingStartTime;
            const secs = Math.floor(diff / 1000) % 60;
            const mins = Math.floor(diff / 60000);
            if (elements.timer) {
                elements.timer.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    function stopTimerUI() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (elements.timer) elements.timer.innerText = '00:00';
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'AUTH_UPDATED') updateAuthUI(msg.isAuthenticated);
        if (msg.type === MESSAGE_TYPES.VOLUME_UPDATE && isRecording) {
            msg.volumes?.forEach((v, i) => {
                if (elements.vBars[i]) elements.vBars[i].style.height = `${Math.max(3, (v / 255) * 30)}px`;
            });
        }
        if (msg.type === MESSAGE_TYPES.TRANSCRIPT_UPDATE) {
            const list = elements.transcriptContent;
            if (list) {
                const placeholder = list.querySelector('p[style*="color: var(--text-dim)"]');
                if (placeholder) placeholder.remove();

                const p = document.createElement('p');
                p.innerText = msg.text;
                p.style.marginBottom = '10px';
                list.appendChild(p);
                list.scrollTop = list.scrollHeight;
            }
        }
        if (msg.type === MESSAGE_TYPES.STOP_RECORDING) {
            setUIState(false);
            stopTimerUI();
        }
    });
});
