I. CHUẨN CẤU TRÚC THƯ MỤC (FINAL)
extension/
├── core/                          # ❗ PURE LOGIC – không browser API
│   ├── domain/
│   │   ├── session.domain.js
│   │   ├── stream.domain.js
│   │   └── permission.domain.js
│   │
│   ├── usecases/
│   │   ├── startRecording.uc.js
│   │   ├── stopRecording.uc.js
│   │   └── initSession.uc.js
│   │
│   ├── ports/                     # Interface ONLY
│   │   ├── browser.port.js
│   │   ├── storage.port.js
│   │   └── messaging.port.js
│   │
│   └── core.config.js

├── platforms/                     # ❗ adapter theo nền tảng
│   ├── chrome/
│   │   ├── browser.adapter.js
│   │   ├── storage.adapter.js
│   │   └── messaging.adapter.js
│   │
│   ├── firefox/
│   │   └── browser.adapter.js
│   │
│   └── web/
│       └── browser.adapter.js

├── background/
│   ├── index.js                   # composition root
│   └── message.router.js

├── content/
│   ├── index.js
│   └── injector.js

├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js

├── offscreen/
│   ├── offscreen.html
│   ├── index.js
│   └── webrtc.js

├── shared/
│   ├── constants.js
│   ├── message.types.js
│   └── schema.js

├── assets/
│   └── icons/

├── manifests/
│   ├── manifest.chrome.json
│   └── manifest.firefox.json

└── README.md

II. RULES CỨNG – AI PHẢI TUÂN (CỰC QUAN TRỌNG)

👉 Bạn có thể copy nguyên block này để dán cho AI

🚫 RULE 1 – Core tuyệt đối sạch
- core/ KHÔNG import:
  chrome.*, browser.*, window, document
- core/ KHÔNG biết đang chạy ở extension
- core/ chỉ dùng JS thuần + interface (ports)

🚫 RULE 2 – Không gọi browser API ngoài adapter
- Chỉ platforms/* được phép gọi chrome.*, browser.*
- background / popup / content
  → chỉ giao tiếp qua adapter

🚫 RULE 3 – Một chiều import
core        ❌ import platforms
platforms  ❌ import background / popup
UI         ❌ import core trực tiếp


Luồng đúng:

UI → background → usecase → port → adapter

🚫 RULE 4 – Không business logic trong UI
popup.js:
- ❌ không xử lý nghiệp vụ
- ❌ không state phức tạp
- ✅ chỉ gửi message

🚫 RULE 5 – Message luôn có schema
{
  type: "RECORDING_START",
  payload: { source: "tab" },
  meta: { from: "popup" }
}


❌ Không gửi object tự do

III. CODE STYLE CHUẨN – TRÁNH LỖI NGU
1. File naming
*.domain.js     → business rule
*.uc.js         → use case
*.port.js       → interface
*.adapter.js    → platform-specific

2. Function rule
- 1 function = 1 việc
- Không function > 80 dòng
- Không side effect trong domain

3. Async rule
- core/usecases luôn return Promise
- adapter chịu trách nhiệm async thực tế

4. Error handling
throw new DomainError("PERMISSION_DENIED");


❌ không throw string
❌ không console.log trong core

IV. TEMPLATE CODE CHUẨN (AI RẤT DỄ FOLLOW)
core/ports/browser.port.js
export class BrowserPort {
  getActiveTab() {
    throw new Error("Not implemented");
  }

  sendMessage(tabId, message) {
    throw new Error("Not implemented");
  }
}

core/usecases/startRecording.uc.js
export async function startRecording({ browser, storage }) {
  const tab = await browser.getActiveTab();
  await storage.save("recordingTab", tab.id);
}

platforms/chrome/browser.adapter.js
export class ChromeBrowserAdapter {
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    return tab;
  }
}

V. PROMPT CHUẨN – DÁN CHO AI CODE (CỰC QUAN TRỌNG)

👉 Copy nguyên đoạn này

You must follow this architecture strictly:

- Use CLEAN / HEXAGONAL architecture
- core/ is pure JavaScript, no browser APIs
- browser APIs are only allowed inside platforms/*
- All business logic must be in core/usecases
- Communication is message-based with typed schema
- Do not invent folders or break structure
- Do not write code outside specified layer
- Use ES modules only
- If a rule conflicts, STOP and explain

Generate code that fits exactly into this structure.

VI. CÁCH KIỂM SOÁT AI KHÔNG PHÁ KIẾN TRÚC

🔥 Mẹo rất thực tế:

Mỗi lần chỉ cho AI code 1 layer

Không bao giờ nói: “code full extension”

Bắt AI viết:

domain → ok

rồi usecase

rồi adapter

cuối cùng mới UI