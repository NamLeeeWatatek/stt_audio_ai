/**
 * SCRIBERR WebRTC AUDIO INTERCEPTOR
 * Hooks into WebRTC streams to capture audio from Google Meet, Zoom, Teams, etc.
 * Version: 3.0 (Structured)
 */

(function () {
    'use strict';

    console.log('🎤 [Scriberr] WebRTC Interceptor loaded');

    const remoteAudioStreams = new Map();
    let audioContext = null;
    let mixedDestination = null;
    let mixerNode = null;

    const OriginalRTCPeerConnection = window.RTCPeerConnection;

    window.RTCPeerConnection = function (...args) {
        console.log('🔌 [Scriberr] New RTCPeerConnection created');
        const pc = new OriginalRTCPeerConnection(...args);

        pc.addEventListener('track', (event) => {
            console.log('📡 [Scriberr] New track detected:', event.track.kind);
            if (event.track.kind === 'audio') {
                const stream = event.streams[0];
                if (stream) {
                    console.log('🎵 [Scriberr] Audio stream captured, ID:', stream.id);
                    handleRemoteAudioStream(stream);
                }
            }
        });

        const originalOnAddStream = pc.onaddstream;
        pc.onaddstream = function (event) {
            console.log('📡 [Scriberr] Legacy onaddstream event');
            if (event.stream) {
                const audioTracks = event.stream.getAudioTracks();
                if (audioTracks.length > 0) {
                    handleRemoteAudioStream(event.stream);
                }
            }
            if (originalOnAddStream) {
                return originalOnAddStream.apply(this, arguments);
            }
        };

        return pc;
    };

    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);

    function handleRemoteAudioStream(stream) {
        const streamId = stream.id;
        if (remoteAudioStreams.has(streamId)) return;

        console.log('✅ [Scriberr] Registering new remote audio stream:', streamId);
        remoteAudioStreams.set(streamId, stream);

        // CREATE ANCHOR: This is a critical fix.
        // Chrome's tabCapture often misses WebRTC audio unless it's explicitly played in the DOM.
        // We create a hidden audio element for each incoming stream.
        try {
            const anchor = document.createElement('audio');
            anchor.id = 'scriberr-anchor-' + streamId;
            anchor.srcObject = stream;
            anchor.className = 'scriberr-audio-anchor';
            anchor.muted = false; // Must be unmuted to be captured
            anchor.volume = 0.01; // Tiny volume is enough to wake up tabCapture
            anchor.style.cssText = 'display:none; position:fixed; top:-99px; left:-99px; width:1px; height:1px; opacity:0; pointer-events:none;';
            document.body.appendChild(anchor);
            anchor.play().catch(e => console.warn('🔇 [Scriberr] Anchor play blocked:', e));
            console.log('⚓ [Scriberr] Remote stream anchored to DOM');
        } catch (err) {
            console.error('❌ [Scriberr] Failed to anchor stream:', err);
        }

        if (!audioContext) initializeAudioMixer();

        try {
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(mixerNode);

            stream.getAudioTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    console.log('🚮 [Scriberr] Remote track ended:', streamId);
                    remoteAudioStreams.delete(streamId);
                    const anchor = document.getElementById('scriberr-anchor-' + streamId);
                    if (anchor) anchor.remove();
                    source.disconnect();
                });
            });
        } catch (error) {
            console.error('❌ [Scriberr] Failed to add stream to mixer:', error);
        }

        notifyExtension();
    }

    function initializeAudioMixer() {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
        });

        mixerNode = audioContext.createGain();
        mixerNode.gain.value = 1.0;

        mixedDestination = audioContext.createMediaStreamDestination();
        mixerNode.connect(mixedDestination);
    }

    function notifyExtension() {
        window.postMessage({
            type: 'SCRIBERR_WEBRTC_AUDIO_AVAILABLE',
            streamCount: remoteAudioStreams.size,
            timestamp: Date.now()
        }, '*');
    }

    window.__SCRIBERR_GET_WEBRTC_AUDIO__ = function () {
        return (mixedDestination && mixedDestination.stream) ? mixedDestination.stream : null;
    };

    window.__SCRIBERR_WEBRTC_STATUS__ = function () {
        return {
            initialized: !!audioContext,
            streamCount: remoteAudioStreams.size,
            hasAudio: mixedDestination && mixedDestination.stream &&
                mixedDestination.stream.getAudioTracks().length > 0
        };
    };

    console.log('✅ [Scriberr] WebRTC Interceptor ready');
})();
