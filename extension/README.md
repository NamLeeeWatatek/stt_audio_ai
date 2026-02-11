# STT Audio AI Extension

Chrome Extension giúp lấy audio từ Google Meet và xử lý chuyển đổi âm thanh thành văn bản.

## Kiến Trúc Dự Án

Dự án tuân thủ kiến trúc Clean Architecture để đảm bảo khả năng mở rộng và bảo trì dễ dàng.

Chi tiết về kiến trúc xem tại: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Cấu Trúc Thư Mục

- `core/`: Chứa mã nguồn logic xử lý chính, hoàn toàn độc lập với môi trường trình duyệt.
- `platforms/`: Chứa mã nguồn thực thi cụ thể cho từng trình duyệt (Chrome, Firefox).
- `background/`: Chạy ngầm để quản lý trạng thái và điều phối message.
- `content/`: Chạy trong context của trang web (Google Meet).
- `popup/`: Giao diện người dùng khi click vào icon extension.
- `offscreen/`: Xử lý các tác vụ yêu cầu DOM API nhưng chạy ngầm như ghi âm WebRTC.
- `shared/`: Các định nghĩa dùng chung.

## Cách Cài Đặt (Development)

1. Mở Chrome và truy cập `chrome://extensions/`.
2. Bật "Developer mode".
3. Nhấp vào "Load unpacked".
4. Chọn thư mục `extension/`.

## Các Quy Tắc Code

Vui lòng tuân thủ các quy tắc trong `docs/ARCHITECTURE.md` khi phát triển tính năng mới.
