/**
 * SCRIBERR OFFSCREEN ENGINE - VERSION 2026.14 (WebRTC SUPPORT)
 * Enhanced to support WebRTC audio capture from meeting platforms
 */

const activeSessions = new Map();

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'START_RECORDING') {
        startRecording(message.streamId, message.mode, message.meetingName, message.tabId);
    } else if (message.type === 'STOP_RECORDING') {
        stopAllSessions();
    }
});

async function startRecording(streamId, mode, meetingName, tabId) {
    if (activeSessions.has(streamId)) return;

    const sessionID = 'live_' + Date.now();
    let ws = null;
    let usingWebSocket = false;

    // Try connecting to WebSocket
    try {
        ws = new WebSocket('ws://localhost:8081/api/v1/ws/transcription');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject('WS Timeout'), 2000);
            ws.onopen = () => {
                clearTimeout(timeout);
                usingWebSocket = true;
                ws.send(JSON.stringify({
                    type: 'config',
                    payload: { session_id: sessionID, meeting_name: meetingName }
                }));
                console.log('>>> WebSocket Connected!');
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
        console.warn('>>> WebSocket failed, falling back to HTTP Chunking:', e);
        usingWebSocket = false;
        ws = null;
    }

    try {
        // ENHANCED CONSTRAINTS for WebRTC Support
        // Request both audio AND video (Chrome requires video for proper tab capture)
        const constraints = {
            audio: {
                mandatory: {
                    chromeMediaSource: mode === 'tab' ? 'tab' : 'desktop',
                    chromeMediaSourceId: streamId
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: mode === 'tab' ? 'tab' : 'desktop',
                    chromeMediaSourceId: streamId
                }
            }
        };

        console.log('>>> Requesting stream with constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('>>> Stream obtained. Audio tracks:', stream.getAudioTracks().length, 'Video tracks:', stream.getVideoTracks().length);

        // CRITICAL: Check if we actually got audio
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn('⚠️ No audio track in captured stream.');
            // Don't throw error - we might get WebRTC audio later
        }

        // Log audio track settings for debugging
        audioTracks.forEach((track, idx) => {
            console.log(`>>> Audio Track ${idx}:`, {
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState,
                settings: track.getSettings()
            });
        });

        // Create AudioContext with proper setup
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
        });
        await audioContext.resume();
        console.log('>>> AudioContext state:', audioContext.state);

        // Create a mixer to combine multiple audio sources
        const mixer = audioContext.createGain();
        mixer.gain.value = 1.0;

        // If we have tab audio, add it to mixer
        if (audioTracks.length > 0) {
            const audioStream = new MediaStream(stream.getAudioTracks());
            const tabSource = audioContext.createMediaStreamSource(audioStream);
            tabSource.connect(mixer);
            console.log('✅ Tab audio connected to mixer');
        }

        // FOR WEBRTC PLATFORMS: Try to get WebRTC audio from content script
        // This is a workaround since tab capture doesn't capture WebRTC by default
        if (tabId && mode === 'tab') {
            try {
                console.log('🔍 Checking for WebRTC audio in tab:', tabId);

                // Poll for WebRTC status
                setTimeout(async () => {
                    try {
                        const response = await chrome.tabs.sendMessage(tabId, {
                            type: 'CHECK_WEBRTC_STATUS'
                        });
                        console.log('📊 WebRTC Status:', response);

                        if (response && response.hasAudio) {
                            console.log('✅ WebRTC audio detected! Note: Cannot directly capture in offscreen context.');
                            console.log('💡 Recommendation: Use Desktop Capture mode for meeting platforms.');
                        }
                    } catch (err) {
                        console.log('ℹ️ No WebRTC interceptor in this tab (might not be a meeting platform)');
                    }
                }, 2000);
            } catch (err) {
                console.log('Could not check WebRTC status:', err);
            }
        }

        // Create loopback for audio monitoring (optional)
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.8; // Slightly reduce to prevent feedback
        mixer.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Set up analyser for visualization
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        mixer.connect(analyser);

        // Create a destination stream from the mixer
        const destination = audioContext.createMediaStreamDestination();
        mixer.connect(destination);
        const finalStream = destination.stream;

        console.log('>>> Final mixed stream tracks:', finalStream.getAudioTracks().length);

        // Test if audio is flowing
        const testData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(testData);
        const hasInitialAudio = testData.some(v => v > 0);
        console.log('>>> Initial audio check:', hasInitialAudio ? 'AUDIO DETECTED' : 'SILENT (may start when someone speaks)');

        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        console.log('>>> Using MIME type:', mime);

        const startNewRecorder = () => {
            if (!activeSessions.has(streamId)) return;

            const chunkDuration = usingWebSocket ? 1000 : 5000;

            const recorder = new MediaRecorder(finalStream, {
                mimeType: mime,
                audioBitsPerSecond: 128000
            });
            const chunks = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    if (usingWebSocket && ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(e.data);
                    } else {
                        chunks.push(e.data);
                    }
                }
            };

            recorder.onstop = () => {
                if (!usingWebSocket && chunks.length > 0) {
                    const fullBlob = new Blob(chunks, { type: mime });
                    sendChunkToServer(fullBlob, sessionID, meetingName);
                }

                if (activeSessions.has(streamId)) {
                    setTimeout(startNewRecorder, 200);
                }
            };

            recorder.start(usingWebSocket ? 1000 : undefined);

            if (!usingWebSocket) {
                setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 5000);
            }

            const session = activeSessions.get(streamId);
            if (session) session.recorder = recorder;
        };

        activeSessions.set(streamId, {
            sessionID,
            meetingName,
            stream,
            audioContext,
            analyser,
            mixer,
            ws,
            tabId
        });

        startNewRecorder();
        startVisualizerLoop();

    } catch (err) {
        console.error('❌ Offscreen Fail:', err.name, err.message, err);

        // Show helpful message for WebRTC platforms
        if (mode === 'tab') {
            console.log('💡 TIP: If you are trying to capture from Google Meet or similar platforms,');
            console.log('    try using "Desktop Capture" mode instead for better compatibility.');
        }
    }
}

function startVisualizerLoop() {
    if (animationId) return;
    const intervalId = setInterval(() => {
        let session = null;
        for (const s of activeSessions.values()) { session = s; break; }
        if (session && session.analyser) {
            const data = new Uint8Array(session.analyser.frequencyBinCount);
            session.analyser.getByteFrequencyData(data);

            const hasAudio = data.some(v => v > 0);
            if (hasAudio) {
                chrome.runtime.sendMessage({ type: 'VOLUME_UPDATE', volumes: Array.from(data.slice(0, 15)) }).catch(() => { });
            }
        }
    }, 100);

    animationId = intervalId;
}

let animationId = null;

function stopAllSessions() {
    if (animationId) { clearInterval(animationId); animationId = null; }
    for (const [id, session] of activeSessions.entries()) {
        try {
            fetch(`http://localhost:8081/api/v1/transcription/quick/${session.sessionID}/finalize`, {
                method: 'POST'
            }).catch(() => { });

            if (session.recorder) session.recorder.stop();
            session.stream.getTracks().forEach(t => t.stop());
            if (session.audioContext) session.audioContext.close();
            if (session.ws) session.ws.close();
        } catch (e) { }
        activeSessions.delete(id);
    }
}

async function sendChunkToServer(blob, sessionID, meetingName) {
    const formData = new FormData();
    formData.append('audio', blob, 'chunk.webm');

    const params = {
        model: 'base',
        diarize: true,
        vad_onset: 0.5,
        vad_offset: 0.363
    };
    formData.append('parameters', JSON.stringify(params));
    formData.append('session_id', sessionID);
    formData.append('title', meetingName);
    formData.append('save_to_portal', 'false');

    try {
        const response = await fetch('http://localhost:8081/api/v1/transcription/quick', {
            method: 'POST', body: formData
        });
        const result = await response.json();
        if (result.transcript && result.transcript.text) {
            chrome.runtime.sendMessage({ type: 'TRANSCRIPT_UPDATE', text: result.transcript.text });
        }
    } catch (err) {
        console.error('Upload Error:', err);
    }
}
