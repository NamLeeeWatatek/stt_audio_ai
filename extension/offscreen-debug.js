const logDiv = document.getElementById('log');

function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });

    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Intercept console logs safely
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function (...args) {
    try {
        originalLog.apply(console, args);
        if (logDiv) {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ');
            if (msg.includes('>>>')) {
                addLog(msg.replace('>>>', ''), 'info');
            }
        }
    } catch (e) {
        // Ignore errors in offscreen context
    }
};

console.error = function (...args) {
    try {
        originalError.apply(console, args);
        if (logDiv) {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ');
            addLog('❌ ' + msg, 'error');
        }
    } catch (e) {
        // Ignore errors in offscreen context
    }
};

console.warn = function (...args) {
    try {
        originalWarn.apply(console, args);
        if (logDiv) {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ');
            addLog('⚠️ ' + msg, 'warning');
        }
    } catch (e) {
        // Ignore errors in offscreen context
    }
};

if (logDiv) {
    addLog('Debug console initialized', 'success');
}
