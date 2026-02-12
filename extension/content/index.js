/**
 * WATA CONTENT SCRIPT - VERSION 1.0 (Robust UI Injection)
 */

import { MESSAGE_TYPES } from '../shared/message.types.js';
import { MeetUI } from './ui.js';

console.log('🚀 [Wata] Content script loaded');

let ui = null;

// Hàm khởi tạo UI an toàn
function setupUI() {
    if (ui) return; // Đã init rồi

    if (document.body && document.head) {
        console.log('🏗️ [Wata] Body & Head ready, injecting UI...');
        try {
            ui = new MeetUI();
            ui.init();
            console.log('✅ [Wata] UI injected successfully');
        } catch (e) {
            console.error('❌ [Wata] UI Injection failed:', e);
        }
    } else {
        // Nếu chưa có body, dùng MutationObserver để chờ
        const observer = new MutationObserver(() => {
            if (document.body && document.head) {
                observer.disconnect();
                setupUI();
            }
        });
        observer.observe(document.documentElement, { childList: true });
    }
}

// Bắt đầu quá trình inject
if (window.location.hostname.includes('meet.google.com')) {
    setupUI();
}

// 1. Inject WebRTC Interceptor
function injectWebRTC() {
    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/injector.js');
        script.onload = function () { this.remove(); };
        (document.head || document.documentElement).appendChild(script);
        console.log('🧬 [Wata] WebRTC Interceptor injected');
    } catch (e) {
        console.error('❌ [Wata] WebRTC Injection failed:', e);
    }
}

injectWebRTC();

// 2. Caption Scraping
let transcriptObserver = null;
let lastCapturedText = "";

function startCapturingCaptions() {
    console.warn('📝 [Wata] Bắt đầu theo dõi Caption...');
    if (ui) ui.updateRecordingStatus(true);

    const selectors = ['.iTTPOb.VbkSUe', '.KTv9Qe', '.a44Uue', '.VfPpkd-Bz112c-LgbsSe'];

    const findContainer = () => {
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && el.innerText.trim().length > 0) return el;
        }
        return document.querySelector('div[aria-live="polite"]');
    };

    const runObserver = () => {
        const container = findContainer();
        if (!container) {
            console.log('⌛ Đang chờ Google Meet bật Caption...');
            return false;
        }

        if (transcriptObserver) transcriptObserver.disconnect();

        transcriptObserver = new MutationObserver((mutations) => {
            const currentText = container.innerText.trim();

            if (currentText && currentText !== lastCapturedText) {
                let newPart = "";
                if (currentText.startsWith(lastCapturedText)) {
                    newPart = currentText.substring(lastCapturedText.length).trim();
                } else {
                    newPart = currentText;
                }

                if (newPart.length > 2) {
                    if (ui) ui.addTranscript(newPart);
                    chrome.runtime.sendMessage({
                        type: MESSAGE_TYPES.TRANSCRIPT_UPDATE,
                        text: newPart
                    }).catch(() => { });
                }
                lastCapturedText = currentText;
            }
        });

        transcriptObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true
        });
        console.warn('✅ Đã kết nối Caption Scraper!');
        return true;
    };

    if (!runObserver()) {
        const retryInterval = setInterval(() => {
            if (runObserver()) clearInterval(retryInterval);
        }, 3000);
        setTimeout(() => clearInterval(retryInterval), 30000);
    }
}

function stopCapturingCaptions() {
    if (transcriptObserver) {
        transcriptObserver.disconnect();
        transcriptObserver = null;
    }
    lastCapturedText = "";
    if (ui) ui.updateRecordingStatus(false);
    console.log('🛑 Đã dừng Caption Scraper.');
}

// 3. Communications
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.START_RECORDING) {
        startCapturingCaptions();
        sendResponse({ success: true });
    } else if (message.type === MESSAGE_TYPES.STOP_RECORDING) {
        stopCapturingCaptions();
        sendResponse({ success: true });
    } else if (message.type === MESSAGE_TYPES.TRANSCRIPT_UPDATE) {
        // Update UI if transcript comes from other parts of the extension
        if (ui) ui.addTranscript(message.text);
    }
    return true;
});

// Tự động dừng khi người dùng thoát cuộc họp hoặc đóng tab
window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_RECORDING }).catch(() => { });
});

// Phát hiện khi URL thay đổi (với Google Meet là SPA)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        console.log('🌐 [Wata] URL changed to:', url);
        // Nếu quay về màn hình home của Meet, coi như kết thúc họp
        if (url === 'https://meet.google.com/' || url.includes('?authuser')) {
            chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_RECORDING }).catch(() => { });
        }
    }
}).observe(document, { subtree: true, childList: true });
