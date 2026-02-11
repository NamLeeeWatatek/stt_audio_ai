console.log('📦 [Scriberr] Loader starting...');
(async () => {
    try {
        const src = chrome.runtime.getURL('content/index.js');
        await import(src);
        console.log('✅ [Scriberr] Core content script imported via loader');
    } catch (e) {
        console.error('❌ [Scriberr] Loader failed to import content script:', e);
    }
})();
