const OFFSCREEN_PATH = 'offscreen.html';

// Khi bấm vào icon, lấy tabId hiện tại và truyền vào popup
chrome.action.onClicked.addListener((tab) => {
    chrome.system.display.getInfo((displays) => {
        const primary = displays.find(d => d.isPrimary) || displays[0];
        const width = 380;
        const height = 640;
        const left = Math.round(primary.bounds.left + (primary.bounds.width - width) / 2);
        const top = Math.round(primary.bounds.top + (primary.bounds.height - height) / 2);

        // Truyền tabId qua URL để popup biết cần quay tab nào
        chrome.windows.create({
            url: `popup.html?targetTabId=${tab.id}`,
            type: 'popup',
            width: width,
            height: height,
            left: left,
            top: top,
            focused: true
        });
    });
});

async function setupOffscreen() {
    const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_PATH,
            reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
            justification: 'Capture and process meeting audio'
        });
        await new Promise(r => setTimeout(r, 800));
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
        setupOffscreen().then(() => {
            chrome.runtime.sendMessage({ ...message, target: 'offscreen' });

            // Gửi tới đúng Tab ID đã yêu cầu
            if (message.targetTabId) {
                chrome.tabs.sendMessage(parseInt(message.targetTabId), { type: 'START_RECORDING' }).catch(() => { });
            }

            sendResponse({ success: true });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (message.type === 'STOP_RECORDING') {
        chrome.runtime.sendMessage({ ...message, target: 'offscreen' });

        // Gửi lệnh dừng tới tab đang ghi âm
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(t => {
                chrome.tabs.sendMessage(t.id, { type: 'STOP_RECORDING' }).catch(() => { });
            });
        });

        // Close offscreen document after a brief delay to allow final chunk processing
        setTimeout(async () => {
            const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
            if (existingContexts.length > 0) {
                chrome.offscreen.closeDocument();
            }
        }, 1000);

        sendResponse({ success: true });
        return true;
    }

    return true;
});
