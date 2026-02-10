/**
 * SCRIBERR OFFSCREEN ENGINE - VERSION 3.4 (GOOGLE MEET SPECIALIST)
 * Khắc phục lỗi im tiếng trên Google Meet bằng chiêu thức "Audio Monitoring".
 * Ép trình duyệt phải duy trì luồng âm thanh WebRTC.
 */

const activeSessions = new Map();
let visualizerInterval = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'START_RECORDING') {
        startRecording(message.streamId, message.mode, message.meetingName);
    } else if (message.type === 'STOP_RECORDING') {
        stopAllSessions();
    }
});

async function startRecording(streamId, mode, meetingName) {
    if (activeSessions.has(streamId)) return;

    const sessionID = 'live_' + Date.now();
    let ws = null;
    let usingWebSocket = false;

    // 1. WebSocket Setup (Keep as is for live transcription)
    try {
        ws = new WebSocket('ws://localhost:8081/api/v1/ws/transcription');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject('WS Timeout'), 2000);
            ws.onopen = () => {
                clearTimeout(timeout);
                usingWebSocket = true;
                ws.send(JSON.stringify({ type: 'config', payload: { session_id: sessionID, meeting_name: meetingName } }));
                resolve();
            };
            ws.onerror = (e) => reject(e);
        });
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript') {
                chrome.runtime.sendMessage({ type: 'TRANSCRIPT_UPDATE', text: msg.text });
            }
        };
    } catch (e) {
        usingWebSocket = false;
    }

    try {
        console.warn('🎙️ [Rules Applied] Capturing Tab and Microphone audio...');

        // Step 1: Capture Tab Audio (System audio)
        const tabStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        // Step 2: Capture Microphone Audio
        let micStream = null;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (micErr) {
            console.warn('⚠️ Microphone access failed (this is expected if not allowed in popup):', micErr);
            chrome.runtime.sendMessage({ type: 'RECORDING_WARNING', error: "Microphone not available. Recording only tab audio." });
        }

        // Step 3: Mix streams using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        if (audioContext.state === 'suspended') await audioContext.resume();

        // Use a GainNode as a mixer hub
        const mixer = audioContext.createGain();
        const dest = audioContext.createMediaStreamDestination();

        // Connect mixer to destination (for recording)
        mixer.connect(dest);

        // Connect Tab Audio (only if tracks exist)
        if (tabStream && tabStream.getAudioTracks().length > 0) {
            const sourceTab = audioContext.createMediaStreamSource(tabStream);
            sourceTab.connect(mixer);
        } else {
            console.error('❌ Tab audio stream has no tracks');
            throw new Error('Tab audio stream is empty');
        }

        // Connect Mic Audio (only if tracks exist)
        if (micStream && micStream.getAudioTracks().length > 0) {
            const sourceMic = audioContext.createMediaStreamSource(micStream);
            sourceMic.connect(mixer);
        }

        // Analyser for UI Visualizer (connect to mixer)
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        mixer.connect(analyser);

        // Optional: Audio Monitoring (keep it for stability but muted)
        const monitor = document.createElement('audio');
        monitor.srcObject = dest.stream;
        monitor.muted = true;
        monitor.autoplay = true;
        document.body.appendChild(monitor);

        // Step 4: Record Mixed Stream
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
        const chunks = [];

        let lastSendTime = Date.now();
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                if (usingWebSocket && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(e.data);
                } else {
                    chunks.push(e.data);
                    // Every 5 seconds, send accumulated chunks if not using WebSocket
                    if (Date.now() - lastSendTime > 5000) {
                        const blob = new Blob(chunks, { type: mime });
                        chunks.length = 0; // Clear chunks
                        sendChunkToServer(blob, sessionID, meetingName);
                        lastSendTime = Date.now();
                    }
                }
            }
        };

        recorder.onstop = () => {
            if (chunks.length > 0) {
                const blob = new Blob(chunks, { type: mime });
                sendChunkToServer(blob, sessionID, meetingName);
            }
        };

        // Start recording in chunks
        recorder.start(1000);

        activeSessions.set(streamId, {
            sessionID,
            meetingName,
            tabStream,
            micStream,
            audioContext,
            analyser,
            monitor,
            ws,
            recorder
        });

        startVisualizerLoop();

    } catch (err) {
        console.error('❌ Recording Failed:', err);
        chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: `Failed to start recording: ${err.message}` });
        stopAllSessions();
    }
}

function startVisualizerLoop() {
    if (visualizerInterval) return;
    visualizerInterval = setInterval(() => {
        let session = null;
        for (const s of activeSessions.values()) { session = s; break; }
        if (session && session.analyser) {
            const data = new Uint8Array(session.analyser.frequencyBinCount);
            session.analyser.getByteFrequencyData(data);
            chrome.runtime.sendMessage({ type: 'VOLUME_UPDATE', volumes: Array.from(data.slice(0, 15)) }).catch(() => { });
        }
    }, 100);
}

function stopAllSessions() {
    if (visualizerInterval) { clearInterval(visualizerInterval); visualizerInterval = null; }
    for (const [id, session] of activeSessions.entries()) {
        try {
            // Step 5: Stop everything and release resources
            if (session.recorder && session.recorder.state !== 'inactive') {
                session.recorder.stop();
            }

            if (session.tabStream) session.tabStream.getTracks().forEach(t => t.stop());
            if (session.micStream) session.micStream.getTracks().forEach(t => t.stop());

            if (session.monitor) session.monitor.remove();

            if (session.audioContext) {
                session.audioContext.close();
            }

            if (session.ws) {
                session.ws.close();
            }

            fetch(`http://localhost:8081/api/v1/transcription/quick/${session.sessionID}/finalize`, { method: 'POST' }).catch(() => { });
        } catch (e) {
            console.error('Error stopping session:', e);
        }
        activeSessions.delete(id);
    }
}

async function sendChunkToServer(blob, sessionID, title) {
    const formData = new FormData();
    formData.append('audio', blob, 'chunk.webm');
    formData.append('parameters', JSON.stringify({ model: 'base', diarize: true }));
    formData.append('session_id', sessionID);
    formData.append('title', title);
    formData.append('save_to_portal', 'false');
    try {
        const res = await fetch('http://localhost:8081/api/v1/transcription/quick', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.transcript?.text) {
            chrome.runtime.sendMessage({ type: 'TRANSCRIPT_UPDATE', text: data.transcript.text });
        }
    } catch (err) { }
}