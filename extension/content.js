/**
 * SCRIBERR CONTENT SCRIPT - VERSION 2.2 (DUAL-MODE STABILITY)
 * Kết hợp WebRTC Hook, Audio Capture và Caption Scraping (Method 2).
 */

console.log('🚀 [Scriberr] Content script loaded');

// 1. Inject WebRTC Interceptor
const script = document.createElement('script');
script.src = chrome.runtime.getURL('webrtc-injector.js');
script.onload = function () { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// 2. Method 2: Live Caption Scraping (Google's Verified Method)
let transcriptObserver = null;
let lastCapturedText = "";

function startCapturingCaptions() {
    console.warn('📝 [Scriberr] Bắt đầu theo dõi Caption...');

    // Các selector phổ biến của Google Meet
    const selectors = ['.iTTPOb.VbkSUe', '.KTv9Qe', '.a44Uue', '.VfPpkd-Bz112c-LgbsSe'];

    const findContainer = () => {
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && el.innerText.trim().length > 0) return el;
        }
        // Trường hợp đặc biệt: Tìm div có chứa text đang nhảy
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
            // Lấy toàn bộ text hiện có trong box caption
            const currentText = container.innerText.trim();

            if (currentText && currentText !== lastCapturedText) {
                // Chỉ lấy phần text mới xuất hiện (Delta)
                let newPart = "";
                if (currentText.startsWith(lastCapturedText)) {
                    newPart = currentText.substring(lastCapturedText.length).trim();
                } else {
                    newPart = currentText; // Box bị reset, lấy mới hoàn toàn
                }

                if (newPart.length > 2) { // Bỏ qua các ký tự rác nhỏ
                    chrome.runtime.sendMessage({
                        type: 'TRANSCRIPT_UPDATE',
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

    // Thử chạy ngay, nếu không thấy thì thử lại sau vài giây
    if (!runObserver()) {
        const retryInterval = setInterval(() => {
            if (runObserver()) clearInterval(retryInterval);
        }, 3000);
        // Tự dừng sau 30s nếu ko thấy caption
        setTimeout(() => clearInterval(retryInterval), 30000);
    }
}

function stopCapturingCaptions() {
    if (transcriptObserver) {
        transcriptObserver.disconnect();
        transcriptObserver = null;
    }
    lastCapturedText = "";
    console.log('🛑 Đã dừng Caption Scraper.');
}

// 3. Communications
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
        startCapturingCaptions();
        sendResponse({ success: true });
    } else if (message.type === 'STOP_RECORDING') {
        stopCapturingCaptions();
        sendResponse({ success: true });
    } else if (message.type === 'CHECK_WEBRTC_STATUS') {
        const status = window.__SCRIBERR_WEBRTC_STATUS__?.() || { initialized: false };
        sendResponse(status);
    }
    return true;
});

// Platform check
if (window.location.hostname.includes('meet.google.com')) {
    chrome.runtime.sendMessage({ type: 'MEETING_PLATFORM_DETECTED', platform: 'Google Meet' }).catch(() => { });
}
