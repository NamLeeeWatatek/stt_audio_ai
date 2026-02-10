/**
 * SCRIBERR POPUP LOGIC - VERSION 2.5 (STABLE TAB TARGETING)
 */

document.addEventListener('DOMContentLoaded', () => {
  localize();
  let isRecording = false;
  let currentMode = 'tab';

  // Lấy targetTabId từ URL (được truyền từ background.js)
  const urlParams = new URLSearchParams(window.location.search);
  const targetTabIdFromApp = urlParams.get('targetTabId');

  chrome.storage.local.get(['isRecording'], (result) => {
    if (result.isRecording) setUIState(true);
  });

  const elements = {
    recordBtn: document.getElementById('record-btn'),
    btnText: document.getElementById('btn-text'),
    modeCards: document.querySelectorAll('.mode-card'),
    visualizer: document.getElementById('visualizer'),
    transcriptContent: document.getElementById('transcript-content'),
    captureName: document.getElementById('capture-name')
  };

  // Initialize Visualizer Bars
  if (elements.visualizer) {
    elements.visualizer.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const bar = document.createElement('div');
      bar.className = 'v-bar';
      elements.visualizer.appendChild(bar);
    }
  }
  const vBars = document.querySelectorAll('.v-bar');

  // Mode Switching
  elements.modeCards?.forEach(card => {
    card.addEventListener('click', () => {
      if (isRecording) return;
      elements.modeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentMode = card.dataset.mode || 'tab';
    });
  });

  elements.recordBtn?.addEventListener('click', async () => {
    try {
      if (!isRecording) {
        console.log("🟢 Requesting permissions and initiating capture...");

        // Step 1: Request Mic permission in Popup context
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.warn("⚠️ Mic permission denied:", e);
          if (!confirm("Could not access microphone. Continue recording ONLY tab audio?")) return;
        }

        const name = elements.captureName?.value?.trim() || `Meeting ${new Date().toLocaleTimeString()}`;

        // Hàm helper để bắt đầu capture
        const runCapture = (tid) => {
          if (!tid) {
            alert("No Tab ID found. Please try opening the extension again from the Google Meet tab.");
            return;
          }
          console.log(`🎬 Requesting capture for Tab: ${tid}`);
          chrome.tabCapture.getMediaStreamId({ targetTabId: tid }, (streamId) => {
            if (chrome.runtime.lastError || !streamId) {
              const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : "No stream ID";
              console.error("❌ TabCapture Error:", errMsg);
              alert("Wait! Could not get audio from tab. Make sure you clicked the extension icon while inside the Google Meet tab.");
              return;
            }

            chrome.runtime.sendMessage({
              type: 'START_RECORDING',
              streamId: streamId,
              targetTabId: tid,
              meetingName: name,
              mode: 'tab'
            }, (res) => {
              if (res?.success) {
                setUIState(true);
              } else {
                alert("Failed to start: " + (res?.error || "Unknown error"));
              }
            });
          });
        };

        // Lấy Tab ID từ nhiều nguồn khác nhau
        if (targetTabIdFromApp && targetTabIdFromApp !== 'null') {
          runCapture(parseInt(targetTabIdFromApp));
        } else {
          // Fallback cuối cùng: Tìm tab Meet đang active
          chrome.tabs.query({ active: true }, (tabs) => {
            const meetTab = tabs.find(t => t.url?.includes('meet.google.com')) || tabs[0];
            if (meetTab) runCapture(meetTab.id);
            else alert("Please go to your Google Meet tab first.");
          });
        }
      } else {
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
          if (res?.success) setUIState(false);
        });
      }
    } catch (err) {
      alert("Popup Error: " + err.message);
    }
  });

  function setUIState(recording) {
    isRecording = recording;
    chrome.storage.local.set({ isRecording: recording });
    if (elements.recordBtn) {
      if (recording) {
        elements.recordBtn.classList.add('recording');
        if (elements.btnText) elements.btnText.innerText = "Stop and Save";
      } else {
        elements.recordBtn.classList.remove('recording');
        if (elements.btnText) elements.btnText.innerText = "Connect Audio Source";
        vBars.forEach(b => b.style.height = '20%');
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'VOLUME_UPDATE' && isRecording) {
      msg.volumes?.forEach((v, i) => {
        if (vBars[i]) vBars[i].style.height = `${Math.max(20, (v / 255) * 100)}%`;
      });
    }
    if (msg.type === 'TRANSCRIPT_UPDATE') {
      const content = elements.transcriptContent;
      if (content) {
        content.querySelector('.placeholder')?.remove();
        const p = document.createElement('p');
        p.innerText = msg.text;
        content.appendChild(p);
        content.scrollTop = content.scrollHeight;
      }
    }
    if (msg.type === 'RECORDING_ERROR') {
      alert(`Error: ${msg.error}`);
      setUIState(false);
    }
    if (msg.type === 'RECORDING_WARNING') {
      console.warn("⚠️ Warning:", msg.error);
    }
  });

  function localize() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.innerText = msg;
    });
  }
});
