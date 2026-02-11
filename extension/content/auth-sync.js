// Cache to prevent redundant syncing
let lastSyncedToken = null;

function syncToken() {
    // 1. Kiểm tra trong localStorage của trang web
    const appData = localStorage.getItem('auth-storage');

    if (appData) {
        try {
            const parsed = JSON.parse(appData);
            const token = parsed.state?.token || parsed.token;
            const user = parsed.state?.user || parsed.user;

            if (token && token !== lastSyncedToken) {
                console.log('🔑 [Scriberr] New token detected, syncing...');
                chrome.runtime.sendMessage({
                    type: 'AUTH_SYNC_TOKEN',
                    token: token,
                    user: user
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('❌ [Scriberr] Runtime error:', chrome.runtime.lastError);
                    } else {
                        console.log('✅ [Scriberr] Token synced successfully');
                        lastSyncedToken = token;

                        // Stop polling if we found a valid token
                        if (pollInterval) {
                            clearInterval(pollInterval);
                            pollInterval = null;
                            console.log('🛑 [Scriberr] Polling stopped (token synced).');
                        }
                    }
                });
            }
        } catch (e) {
            console.error('❌ [Scriberr] Sync parse failed:', e);
        }
    }
}

// Chạy ngay khi load
syncToken();

// Polling ngắn hạn để bắt được khoảnh khắc user vừa login xong
let pollCount = 0;
let pollInterval = setInterval(() => {
    syncToken();
    pollCount++;
    if (pollCount > 30) { // Thử trong 30 giây
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
            console.log('🛑 [Scriberr] Polling stopped (timeout).');
        }
    }
}, 2000); // 2 seconds interval

// Vẫn giữ storage event để bắt thay đổi
window.addEventListener('storage', (e) => {
    if (e.key === 'auth-storage') syncToken();
});
