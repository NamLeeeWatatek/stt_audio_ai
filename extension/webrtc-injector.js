/**
 * SCRIBERR WebRTC AUDIO INTERCEPTOR
 * Hooks into WebRTC streams to capture audio from Google Meet, Zoom, Teams, etc.
 * Version: 2026.1
 */

(function () {
    'use strict';

    console.log('🎤 [Scriberr] WebRTC Interceptor loaded');

    // Store all remote audio streams
    const remoteAudioStreams = new Map();
    let audioContext = null;
    let mixedDestination = null;
    let mixerNode = null;

    // Hook into RTCPeerConnection to intercept remote streams
    const OriginalRTCPeerConnection = window.RTCPeerConnection;

    window.RTCPeerConnection = function (...args) {
        console.log('🔌 [Scriberr] New RTCPeerConnection created');
        const pc = new OriginalRTCPeerConnection(...args);

        // Intercept ontrack event (modern way)
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

        // Also intercept onaddstream (legacy support for older platforms)
        const originalOnAddStream = pc.onaddstream;
        pc.onaddstream = function (event) {
            console.log('📡 [Scriberr] Legacy onaddstream event');
            if (event.stream) {
                const audioTracks = event.stream.getAudioTracks();
                if (audioTracks.length > 0) {
                    console.log('🎵 [Scriberr] Audio tracks found:', audioTracks.length);
                    handleRemoteAudioStream(event.stream);
                }
            }
            if (originalOnAddStream) {
                return originalOnAddStream.apply(this, arguments);
            }
        };

        return pc;
    };

    // Copy static properties
    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);

    function handleRemoteAudioStream(stream) {
        const streamId = stream.id;

        if (remoteAudioStreams.has(streamId)) {
            console.log('⚠️ [Scriberr] Stream already tracked:', streamId);
            return;
        }

        console.log('✅ [Scriberr] Registering new remote audio stream:', streamId);
        remoteAudioStreams.set(streamId, stream);

        // Initialize audio context if needed
        if (!audioContext) {
            initializeAudioMixer();
        }

        // Add this stream to the mixer
        try {
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(mixerNode);
            console.log('🔊 [Scriberr] Stream connected to mixer');

            // Clean up when stream ends
            stream.getAudioTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    console.log('🛑 [Scriberr] Audio track ended:', streamId);
                    remoteAudioStreams.delete(streamId);
                    source.disconnect();
                });
            });
        } catch (error) {
            console.error('❌ [Scriberr] Failed to add stream to mixer:', error);
        }

        // Notify extension that we have audio
        notifyExtension();
    }

    function initializeAudioMixer() {
        console.log('🎚️ [Scriberr] Initializing audio mixer');

        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
        });

        // Create a destination that we can capture later
        mixerNode = audioContext.createGain();
        mixerNode.gain.value = 1.0;

        // Create a MediaStreamDestination to get a capturable stream
        mixedDestination = audioContext.createMediaStreamDestination();
        mixerNode.connect(mixedDestination);

        console.log('✅ [Scriberr] Audio mixer ready');
    }

    function notifyExtension() {
        // Send message to background/content script that we have WebRTC audio
        window.postMessage({
            type: 'SCRIBERR_WEBRTC_AUDIO_AVAILABLE',
            streamCount: remoteAudioStreams.size,
            timestamp: Date.now()
        }, '*');
    }

    // Expose a method to get the mixed audio stream
    window.__SCRIBERR_GET_WEBRTC_AUDIO__ = function () {
        if (mixedDestination && mixedDestination.stream) {
            console.log('🎁 [Scriberr] Providing mixed WebRTC audio stream');
            return mixedDestination.stream;
        }
        console.warn('⚠️ [Scriberr] No WebRTC audio available yet');
        return null;
    };

    // Status check function
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
