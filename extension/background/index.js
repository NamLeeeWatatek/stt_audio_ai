import { ChromeBrowserAdapter } from '../platforms/chrome/browser.adapter.js';
import { ChromeStorageAdapter } from '../platforms/chrome/storage.adapter.js';
import { ChromeAuthAdapter } from '../platforms/chrome/auth.adapter.js';
import { CONFIG } from '../shared/config.js';
import { startRecordingUseCase } from '../core/usecases/startRecording.uc.js';
import { stopRecordingUseCase } from '../core/usecases/stopRecording.uc.js';
import { MESSAGE_TYPES, STORAGE_KEYS } from '../shared/message.types.js';

const browser = new ChromeBrowserAdapter();
const storage = new ChromeStorageAdapter();
const auth = new ChromeAuthAdapter();

const deps = { browser, storage, auth };

// 1. Handle Action Click (Open Popup)
chrome.action.onClicked.addListener((tab) => {
    chrome.system.display.getInfo((displays) => {
        const primary = displays.find(d => d.isPrimary) || displays[0];
        const width = 380;
        const height = 640;
        const left = Math.round(primary.bounds.left + (primary.bounds.width - width) / 2);
        const top = Math.round(primary.bounds.top + (primary.bounds.height - height) / 2);

        chrome.windows.create({
            url: `popup/popup.html?targetTabId=${tab.id}`,
            type: 'popup',
            width: width,
            height: height,
            left: left,
            top: top,
            focused: true
        });
    });
});

// 2. Tự động dừng ghi âm khi tab cuộc họp bị đóng
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const recordingTabId = await storage.get(STORAGE_KEYS.RECORDING_TAB);
    if (recordingTabId && parseInt(recordingTabId) === tabId) {
        console.log(`🎬 Tab ${tabId} bị đóng. Đang dừng ghi âm...`);
        await stopRecordingUseCase(deps);
    }
});

// Helper to fetch user info from server
async function fetchUserInfo(token) {
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/api/v1/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            return data.user || data;
        }
    } catch (e) {
        console.error('❌ Failed to fetch user info:', e);
    }
    return null;
}

// 3. Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Xử lý đồng bộ Auth từ Web
    if (message.type === 'AUTH_SYNC_TOKEN') {
        const handleSync = async () => {
            await auth.setAccessToken(message.token);
            let userInfo = message.user;
            if (!userInfo) {
                userInfo = await fetchUserInfo(message.token);
            }
            if (userInfo) await auth.setUserInfo(userInfo);
            chrome.runtime.sendMessage({ type: 'AUTH_UPDATED', isAuthenticated: true });
        };
        handleSync();
        sendResponse({ success: true });
        return true;
    }
    if (message.type === 'GET_AUTH_TOKEN') {
        auth.getAccessToken().then(token => sendResponse({ token }));
        return true;
    }

    // Xử lý các Use Case chính
    if (message.type === MESSAGE_TYPES.START_RECORDING) {
        const start = async () => {
            let streamId = message.streamId;
            let mode = message.mode || 'tab';

            // Nếu chưa có streamId, thực hiện cấp quyền capture
            if (!streamId) {
                try {
                    const targetTabId = parseInt(message.targetTabId);
                    const tab = await chrome.tabs.get(targetTabId);

                    if (!tab) throw new Error("Target tab not found");

                    // Ưu tiên 1: Thử dùng Tab Capture (Không hiện dialog, mượt hơn cho Meet)
                    try {
                        streamId = await browser.getMediaStreamId(targetTabId);
                        mode = 'tab';
                        console.log("✅ Using Tab Capture stream");
                    } catch (tabErr) {
                        // Ưu tiên 2: Fallback sang Desktop Capture (Hiện dialog chọn Screen/Window/Tab)
                        console.log("🔄 Tab Capture failed, falling back to Desktop Picker...", tabErr.message);
                        streamId = await browser.chooseDesktopMedia(tab);
                        mode = 'desktop';
                        console.log("✅ Using Desktop Capture stream");
                    }
                } catch (e) {
                    console.error("❌ Audio capture initiation failed:", e);
                    return { success: false, error: "Capture Error: " + e.message };
                }
            }

            return await startRecordingUseCase(deps, { ...message, streamId, mode });
        };

        start()
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.type === MESSAGE_TYPES.STOP_RECORDING) {
        stopRecordingUseCase(deps)
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // Forwarding logic
    if (message.type === MESSAGE_TYPES.TRANSCRIPT_UPDATE ||
        message.type === MESSAGE_TYPES.VOLUME_UPDATE ||
        message.type === MESSAGE_TYPES.RECORDING_ERROR) {

        storage.get(STORAGE_KEYS.RECORDING_TAB).then(tabId => {
            if (tabId) {
                chrome.tabs.sendMessage(parseInt(tabId), message).catch(() => { });
            }
        });
    }

    return true;
});
