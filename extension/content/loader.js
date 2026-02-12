console.log('📦 [Wata] Loader starting...');
(async () => {
    try {
        const src = chrome.runtime.getURL('content/index.js');
        await import(src);
        console.log('✅ [Wata] Core content script imported via loader');
    } catch (e) {
        console.error('❌ [Wata] Loader failed to import content script:', e);
    }
})();
