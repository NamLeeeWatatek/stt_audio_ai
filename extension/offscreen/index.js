import { MESSAGE_TYPES, STORAGE_KEYS } from '../shared/message.types.js';
import { CONFIG } from '../shared/config.js';

const activeSessions = new Map();
let visualizerInterval = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    if (message.type === MESSAGE_TYPES.START_RECORDING) {
        startRecording(message.streamId, message.mode, message.meetingName);
    } else if (message.type === MESSAGE_TYPES.STOP_RECORDING) {
        stopAllSessions()
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Keep channel open
    }
});

async function getAuthHeader() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, (response) => {
            if (response?.token) {
                resolve({ 'Authorization': `Bearer ${response.token}` });
            } else {
                resolve({});
            }
        });
    });
}

async function startRecording(streamId, mode, meetingName) {
    if (activeSessions.has(streamId)) return;

    const sessionID = 'live_' + Date.now();
    let ws = null;
    let usingWebSocket = false;

    // WebSocket Setup with Token Authentication
    try {
        const authRes = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, r));
        const token = authRes?.token;
        const wsUrl = new URL(`${CONFIG.WS_BASE_URL}/api/v1/ws/transcription`);
        if (token) wsUrl.searchParams.set('token', token);

        console.log('🔌 Connecting to WebSocket...', wsUrl.toString());
        ws = new WebSocket(wsUrl.toString());
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject('WS Timeout'), 3000);
            ws.onopen = () => {
                clearTimeout(timeout);
                console.log('✅ WebSocket connected!');
                usingWebSocket = true;
                ws.send(JSON.stringify({ type: 'config', payload: { session_id: sessionID, meeting_name: meetingName } }));
                resolve();
            };
            ws.onerror = (e) => {
                console.warn('❌ WebSocket Error:', e);
                reject(e);
            };
        });
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcript') {
                chrome.runtime.sendMessage({ type: MESSAGE_TYPES.TRANSCRIPT_UPDATE, text: msg.text });
            }
        };
    } catch (e) {
        usingWebSocket = false;
    }

    try {
        const audioConstraints = {
            mandatory: {
                chromeMediaSource: mode === 'desktop' ? 'desktop' : 'tab',
                chromeMediaSourceId: streamId
            },
            optional: [
                { echoCancellation: false },
                { googEchoCancellation: false },
                { googAutoGainControl: false },
                { googNoiseSuppression: false },
                { googHighpassFilter: false }
            ]
        };

        const constraints = {
            audio: audioConstraints,
            video: {
                mandatory: {
                    chromeMediaSource: mode === 'desktop' ? 'desktop' : 'tab',
                    chromeMediaSourceId: streamId
                }
            }
        };
        console.log(`🎙️ Starting capture (Mode: ${mode}, StreamId: ${streamId})...`);
        const tabStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('✅ Tab capture successful', tabStream.getAudioTracks().length, 'audio tracks');

        // For desktop capture, we get a video track even if we only want audio.
        // We can disable or stop the video track if we don't plan to use it visuals,
        // BUT for 'desktop' we usually need to keep it alive or the audio might stop?
        // Actually, stopping video track on tabCapture stops audio too. Same for desktop.
        // So we keep it but don't process it.

        let micStream = null;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (micErr) {
            chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RECORDING_WARNING, error: "Microphone not available." });
        }

        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        if (audioContext.state === 'suspended') await audioContext.resume();

        const mixer = audioContext.createGain();
        const dest = audioContext.createMediaStreamDestination();
        mixer.connect(dest);

        if (tabStream) {
            console.log('🔈 Found tab audio tracks:', tabStream.getAudioTracks().length);
            // 1. Play Tab Audio to Speakers (Fix: "Audio cut" issue)
            if (mode === 'tab' || (mode === 'desktop' && tabStream.getVideoTracks().length > 0)) {
                // For 'tab', we MUST play it back because tabCapture mutes the tab.
                // For 'desktop', if they selected a 'Tab' in the picker, it might also be muted? 
                // Usually desktop capture doesn't mute, but let's be safe if it's a tab.
                const tabAudio = document.createElement('audio');
                tabAudio.id = 'monitor-' + sessionID;
                tabAudio.srcObject = tabStream;
                tabAudio.autoplay = true;
                document.body.appendChild(tabAudio);
                console.log('🔊 Monitor audio element added to body');
            }

            // 2. Also connect to mixer for recording
            const tabSource = audioContext.createMediaStreamSource(tabStream);
            tabSource.connect(mixer);
        }

        if (micStream) {
            console.log('🎤 Found mic audio tracks:', micStream.getAudioTracks().length);
            const micSource = audioContext.createMediaStreamSource(micStream);
            micSource.connect(mixer);
        }

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        mixer.connect(analyser);

        // Monitor the MIX (Silent, just for the recorder/analyser graph to work effectively if needed)
        // Actually we don't need a monitor audio element for the mix unless we want to debug.
        // But removing it is fine.

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
                    if (Date.now() - lastSendTime > 5000) {
                        const blob = new Blob(chunks, { type: mime });
                        chunks.length = 0;
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

        recorder.start(1000);
        console.log('⏺️ MediaRecorder started');

        const monitor = document.getElementById('monitor-' + sessionID);
        activeSessions.set(streamId, { sessionID, meetingName, tabStream, micStream, audioContext, analyser, ws, recorder, monitor });
        startVisualizerLoop();
    } catch (err) {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RECORDING_ERROR, error: err.message });
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
            chrome.runtime.sendMessage({ type: MESSAGE_TYPES.VOLUME_UPDATE, volumes: Array.from(data.slice(0, 15)) }).catch(() => { });
        }
    }, 100);
}

async function stopAllSessions() {
    if (visualizerInterval) { clearInterval(visualizerInterval); visualizerInterval = null; }
    const authHeader = await getAuthHeader();

    for (const [id, session] of activeSessions.entries()) {
        try {
            if (session.recorder && session.recorder.state !== 'inactive') {
                session.recorder.stop();
            }
            await new Promise(r => setTimeout(r, 500));
            if (session.tabStream) session.tabStream.getTracks().forEach(t => t.stop());
            if (session.micStream) session.micStream.getTracks().forEach(t => t.stop());
            if (session.monitor) session.monitor.remove();
            if (session.audioContext) session.audioContext.close();
            if (session.ws) session.ws.close();

            console.log(`🏁 Finalizing session: ${session.sessionID}...`);
            const finalizeRes = await fetch(`${CONFIG.API_BASE_URL}/api/v1/transcription/quick/${session.sessionID}/finalize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeader
                }
            });

            if (finalizeRes.ok) {
                const result = await finalizeRes.json();
                console.log('✅ Finalize success:', result);
            } else {
                const errText = await finalizeRes.text();
                console.error(`❌ Finalize failed (${finalizeRes.status}):`, errText);
            }
        } catch (e) {
            console.error('❌ Error during session cleanup:', e);
        }
        activeSessions.delete(id);
    }
}

async function sendChunkToServer(blob, sessionID, title) {
    const authHeader = await getAuthHeader();
    const formData = new FormData();
    formData.append('audio', blob, 'chunk.webm');
    formData.append('parameters', JSON.stringify({ model: 'base', diarize: true }));
    formData.append('session_id', sessionID);
    formData.append('title', title);
    formData.append('save_to_portal', 'true');

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/api/v1/transcription/quick`, {
            method: 'POST',
            body: formData,
            headers: { ...authHeader } // FormData handled by fetch, but we add Auth
        });
        const data = await res.json();
        if (data.transcript?.text) {
            chrome.runtime.sendMessage({ type: MESSAGE_TYPES.TRANSCRIPT_UPDATE, text: data.transcript.text });
        }
    } catch (err) {
        console.error('❌ Failed to send chunk:', err);
    }
}
