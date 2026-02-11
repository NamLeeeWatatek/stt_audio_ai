export class ChromeBrowserAdapter {
    async getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }

    async getMediaStreamId(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(streamId);
                }
            });
        });
    }

    async chooseDesktopMedia(tab) {
        return new Promise((resolve, reject) => {
            // Request audio source as well
            const sources = ["screen", "window", "tab", "audio"];

            const callback = (streamId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!streamId) {
                    reject(new Error("Permission denied or cancelled"));
                } else {
                    resolve(streamId);
                }
            };

            // If tab is provided, grants permission to that tab.
            // If NOT provided, grants permission to the extension (for offscreen/background use).
            if (tab) {
                chrome.desktopCapture.chooseDesktopMedia(sources, tab, callback);
            } else {
                chrome.desktopCapture.chooseDesktopMedia(sources, callback);
            }
        });
    }

    async sendMessage(message, warn = false) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    // Receiver might not exist or error occurred
                    warn && console.warn("sendMessage error:", chrome.runtime.lastError.message);
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        });
    }

    async sendMessageToTab(tabId, message) {
        try {
            await chrome.tabs.sendMessage(tabId, message);
        } catch (e) {
            // Tab might be closed or content script not loaded
            console.warn(`Could not send message to tab ${tabId}:`, e.message);
        }
    }

    async createOffscreenDocument(url, reasons, justification) {
        await chrome.offscreen.createDocument({
            url,
            reasons,
            justification
        });
    }

    async closeOffscreenDocument() {
        await chrome.offscreen.closeDocument();
    }

    async hasOffscreenDocument() {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        return contexts.length > 0;
    }
}
