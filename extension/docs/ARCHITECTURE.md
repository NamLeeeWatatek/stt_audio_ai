# Kiến Trúc Extension (Clean / Hexagonal Architecture)

## I. CẤU TRÚC THƯ MỤC

```text
extension/
├── core/                          # ❗ PURE LOGIC – không browser API
│   ├── domain/                    # Business rules & entities
│   ├── usecases/                  # Nghiệp vụ (orchestration)
│   ├── ports/                     # Giao diện (interfaces)
│   └── core.config.js             # Cấu hình core
│
├── platforms/                     # ❗ Adapter theo nền tảng
│   ├── chrome/                    # Chrome specific implementation
│   ├── firefox/                   # Firefox specific implementation
│   └── web/                       # Web/Mock implementation
│
├── background/                    # Composition root & Message routing
├── content/                       # Content scripts (DOM interaction)
├── popup/                         # UI Popup
├── offscreen/                     # Offscreen document (Audio capture/WebRTC)
├── shared/                        # Shared types, constants, schemas
├── assets/                        # Icons, images
├── manifests/                     # Manifest files cho từng trình duyệt
└── README.md
```

## II. QUY TẮC CỨNG (RULES)

1.  **Core tuyệt đối sạch**: 
    - `core/` KHÔNG được import `chrome.*`, `browser.*`, `window`, `document`.
    - `core/` chỉ sử dụng JavaScript thuần túy và giao tiếp qua các `ports`.
2.  **Không gọi browser API ngoài adapter**:
    - Chỉ các file trong `platforms/*` mới được phép gọi trực tiếp API của trình duyệt.
    - `background`, `popup`, `content` phải thông qua `adapter` để thực hiện các tác vụ liên quan đến trình duyệt.
3.  **Import một chiều**:
    - Core ❌ KHÔNG import Platforms.
    - Platforms ❌ KHÔNG import Background/Popup.
    - UI ❌ KHÔNG import Core trực tiếp.
    - **Luồng đúng**: UI → Background → Usecase → Port → Adapter.
4.  **Không business logic trong UI**:
    - `popup.js` không xử lý nghiệp vụ, không quản lý state phức tạp. Chỉ gửi message đến background.
5.  **Message luôn có schema**:
    - Mọi liên lạc giữa các thành phần phải tuân theo format:
      ```json
      {
        "type": "MESSAGE_TYPE",
        "payload": {},
        "meta": { "from": "sender" }
      }
      ```

## III. QUY ƯỚC ĐẶT TÊN (CONVENTIONS)

- `*.domain.js`: Chứa các business rules hoặc entities.
- `*.uc.js`: Chứa các use cases (nghiệp vụ).
- `*.port.js`: Định nghĩa interface (abstract class/objects).
- `*.adapter.js`: Chứa code thực thi cụ thể cho từng platform.

## IV. QUY TRÌNH PHÁT TRIỂN

Mỗi khi thêm tính năng mới, hãy code theo thứ tự các layer:
1.  **Domain**: Xác định luật chơi và thực thể.
2.  **Usecase**: Xác định luồng xử lý.
3.  **Port**: Xác định các yêu cầu kỹ thuật cần từ môi trường.
4.  **Adapter**: Thực thi các port trên platform cụ thể.
5.  **UI/Background**: Kết nối các thành phần lại với nhau.
