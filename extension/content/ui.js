/**
 * WATA CONTENT UI - VERSION 1.0
 */

export class MeetUI {
    constructor() {
        this.container = null;
        this.dot = null;
        this.panel = null;
        this.isPanelOpen = false;
        this.isRecording = false;
        this.observer = null;
    }

    init() {
        // Tạo container ẩn để không bị ảnh hưởng bởi CSS của Meet
        this.container = document.createElement('div');
        this.container.id = 'wata-ui-root';
        this.container.style.cssText = 'all: initial;';
        document.body.appendChild(this.container);

        this.injectGlobalStyles();
        this.createSidePanel();

        // Bắt đầu quan sát để chèn nút vào toolbar
        this.startObserveToolbar();
    }

    injectGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #scriberr-toolbar-btn {
                position: fixed !important;
                bottom: 100px !important;
                left: 20px !important;
                width: 52px !important;
                height: 52px !important;
                background: linear-gradient(135deg, #FFAB40 0%, #FF3D00 100%) !important;
                border: 2px solid rgba(255,255,255,0.2) !important;
                border-radius: 16px !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                z-index: 9999999 !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.1) !important;
                transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            }
            #scriberr-toolbar-btn:hover {
                transform: scale(1.1) translateY(-5px) !important;
                box-shadow: 0 12px 40px rgba(255, 171, 64, 0.5) !important;
                background: linear-gradient(135deg, #FFB74D 0%, #FF6D00 100%) !important;
            }
            #scriberr-toolbar-btn:active {
                transform: scale(0.9) !important;
            }
            #scriberr-toolbar-btn img {
                width: 32px !important;
                height: 32px !important;
                pointer-events: none !important;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)) !important;
            }
            #scriberr-toolbar-btn.recording {
                background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%) !important;
                animation: scriberr-fab-pulse 2s infinite !important;
            }
            @keyframes scriberr-fab-pulse {
                0% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.7); }
                70% { box-shadow: 0 0 0 15px rgba(244, 63, 94, 0); }
                100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
            }
            
            #scriberr-side-panel {
                position: fixed;
                top: 0;
                right: -350px;
                width: 340px;
                height: 100vh;
                background: rgba(18, 20, 32, 0.95);
                backdrop-filter: blur(10px);
                color: white;
                z-index: 1000000;
                box-shadow: -10px 0 40px rgba(0,0,0,0.6);
                transition: right 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
                font-family: 'Inter', system-ui, -apple-system, sans-serif;
                border-left: 1px solid rgba(255,255,255,0.05);
            }
            #scriberr-side-panel.open {
                right: 0;
            }
            .scriberr-panel-header {
                padding: 20px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .scriberr-transcript-area {
                flex: 1;
                padding: 20px;
                overflow-y: auto;
                font-size: 14px;
                line-height: 1.6;
            }
            .scriberr-transcript-item {
                margin-bottom: 12px;
                padding-bottom: 12px;
                border-bottom: 1px solid rgba(255,255,255,0.05);
            }
            .scriberr-guide-box {
                background: rgba(255, 171, 64, 0.08);
                border: 1px solid rgba(255, 171, 64, 0.3);
                padding: 18px;
                border-radius: 12px;
                margin-top: 10px;
                font-size: 13px;
                color: #cbd5e1;
                line-height: 1.5;
            }
        `;
        document.head.appendChild(style);
    }

    startObserveToolbar() {
        // Không cần observe toolbar nữa, ta chèn trực tiếp vào body như một FAB
        const inject = () => {
            if (document.getElementById('scriberr-toolbar-btn')) return;
            this.createToolbarButton();
            document.body.appendChild(this.dot);
            console.log('✅ [Wata] FAB Injected at bottom left');
        };

        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            inject();
        } else {
            window.addEventListener('DOMContentLoaded', inject);
        }

        // Backup nếu Meet render trễ
        setTimeout(inject, 2000);
        setTimeout(inject, 5000);
    }

    createToolbarButton() {
        this.dot = document.createElement('button');
        this.dot.id = 'scriberr-toolbar-btn';
        this.dot.title = 'Wata Meeting Notes Assistant';

        const iconUrl = chrome.runtime.getURL('assets/icons/icon128.png');

        const img = document.createElement('img');
        img.src = iconUrl;
        img.onerror = () => {
            img.style.display = 'none';
            this.dot.innerHTML = '<span style="color:white; font-weight:900; font-size:24px;">S</span>';
        };

        this.dot.appendChild(img);

        this.dot.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePanel();
        };
    }

    createSidePanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'scriberr-side-panel';
        this.panel.innerHTML = `
            <div class="scriberr-panel-header">
                <span style="font-weight: 700;">Wata Meeting Notes Guide</span>
                <button id="scriberr-close-panel" style="background:none; border:none; color: #94a3b8; cursor:pointer;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="scriberr-transcript-area" id="scriberr-transcript-list">
                <div class="scriberr-guide-box">
                    <p style="color: white; font-weight: 600; margin-bottom: 8px;">🚀 Hướng dẫn khởi động:</p>
                    <ol style="padding-left: 15px; display: flex; flex-direction: column; gap: 8px;">
                        <li>Nhấp vào biểu tượng <b>Wata</b> trên thanh công cụ của trình duyệt (góc trên bên phải).</li>
                        <li>Đặt tên cuộc họp và nhấn <b>"Connect Audio Source"</b>.</li>
                        <li>Nội dung sẽ tự động xuất hiện tại đây sau khi bắt đầu.</li>
                        <li style="color: #fbbf24; font-size: 11px;">💡 Lưu ý: Khi chọn màn hình/cửa sổ, hãy nhớ tích vào ô <b>"Share audio"</b> để bắt được tiếng người khác.</li>
                    </ol>
                </div>
                <div id="live-transcript-container" style="margin-top: 20px;">
                    <!-- Transcript will appear here -->
                </div>
            </div>
        `;
        this.container.appendChild(this.panel);

        this.panel.querySelector('#scriberr-close-panel').onclick = () => this.togglePanel();
    }

    togglePanel() {
        this.isPanelOpen = !this.isPanelOpen;
        if (this.isPanelOpen) {
            this.panel.classList.add('open');
        } else {
            this.panel.classList.remove('open');
        }
    }

    updateRecordingStatus(isRecording) {
        this.isRecording = isRecording;
        if (this.dot) {
            if (isRecording) {
                this.dot.classList.add('recording');
            } else {
                this.dot.classList.remove('recording');
            }
        }
    }

    addTranscript(text) {
        const list = this.panel.querySelector('#live-transcript-container');
        const item = document.createElement('div');
        item.className = 'scriberr-transcript-item';
        item.innerText = text;
        list.appendChild(item);
        list.scrollTop = list.scrollHeight;
    }
}
