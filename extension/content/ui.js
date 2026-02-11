/**
 * SCRIBERR CONTENT UI - VERSION 3.5
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
        this.container.id = 'scriberr-ui-root';
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
            .scriberr-toolbar-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                background: rgba(60, 64, 67, 0.6);
                border-radius: 50%;
                cursor: pointer;
                margin-right: 12px;
                margin-left: 8px;
                transition: all 0.2s;
                border: none;
                padding: 0;
                vertical-align: middle;
                flex-shrink: 0;
                position: relative;
                z-index: 2147483647 !important;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            }
            .scriberr-toolbar-button:hover {
                background: rgba(95, 99, 104, 0.8);
                transform: scale(1.05);
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            }
            .scriberr-toolbar-button img {
                width: 24px;
                height: 24px;
                border-radius: 4px;
            }
            .scriberr-toolbar-button.recording {
                background: rgba(244, 63, 94, 0.2);
                border: 1px solid #f43f5e;
                animation: scriberr-pulse-border 1.5s infinite;
            }
            
            @keyframes scriberr-pulse-border {
                0% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(244, 63, 94, 0); }
                100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
            }

            #scriberr-side-panel {
                position: fixed;
                top: 0;
                right: -350px;
                width: 320px;
                height: 100vh;
                background: #121420;
                color: white;
                z-index: 1000000;
                box-shadow: -5px 0 25px rgba(0,0,0,0.5);
                transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                flex-direction: column;
                font-family: 'Inter', sans-serif;
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
                background: rgba(79, 110, 247, 0.1);
                border: 1px dashed #4F6EF7;
                padding: 15px;
                border-radius: 8px;
                margin-top: 10px;
                font-size: 12px;
                color: #94a3b8;
            }
        `;
        document.head.appendChild(style);
    }

    startObserveToolbar() {
        // Selector cho nút Mic của Google Meet (thường có data-is-muted)
        const micSelector = '[data-is-muted]';

        const inject = () => {
            if (document.getElementById('scriberr-toolbar-btn')) return;

            const micNode = document.querySelector(micSelector);
            if (micNode) {
                // Find nearest button-like container
                let targetWrapper = micNode.closest('button') || micNode.closest('[role="button"]');

                // Fallback using class name if closest fails
                if (!targetWrapper) {
                    targetWrapper = micNode.closest('.VfPpkd-Bz112c-LgbsSe');
                }

                if (targetWrapper && targetWrapper.parentElement) {
                    // Cấu trúc Meet: div(container) > div(wrapper) > button
                    // Ta muốn chèn vào trước wrapper của nút Mic để nó nằm ngang hàng bên trái
                    const insertionPoint = targetWrapper;

                    this.createToolbarButton();
                    insertionPoint.parentElement.insertBefore(this.dot, insertionPoint);
                    console.log('✅ [Scriberr] Button injected before Microphone');
                }
            }
        };

        inject();

        this.observer = new MutationObserver(inject);
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    createToolbarButton() {
        this.dot = document.createElement('button');
        this.dot.id = 'scriberr-toolbar-btn';
        this.dot.className = 'scriberr-toolbar-button';
        this.dot.title = 'Scriberr AI Helper';

        const iconUrl = chrome.runtime.getURL('assets/icons/icon48.png');
        this.dot.innerHTML = `<img src="${iconUrl}" alt="S">`;

        this.dot.onclick = (e) => {
            e.preventDefault();
            this.togglePanel();
        };
    }

    createSidePanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'scriberr-side-panel';
        this.panel.innerHTML = `
            <div class="scriberr-panel-header">
                <span style="font-weight: 700;">Scriberr AI Guide</span>
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
                        <li>Nhấp vào biểu tượng <b>Scriberr</b> trên thanh công cụ của trình duyệt (góc trên bên phải).</li>
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
