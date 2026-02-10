# RULES CHUẨN ĐỂ EXTENSION / AI TƯƠNG TÁC VÀ LẤY ÂM THANH ĐÚNG TỪ GOOGLE MEET

## Mục tiêu chính
- Khi người dùng nhấn "Start" trong extension popup → phải thu được **âm thanh hai chiều**:
  - Âm thanh từ tab Google Meet (giọng nói của mọi người khác trong phòng họp)
  - Âm thanh từ microphone của người dùng (giọng nói của chính mình)
- Không chỉ dựa vào live captions (vì captions không phải lúc nào cũng chính xác hoặc có sẵn).
- Phải tuân thủ các quy tắc bảo mật và API của Chrome để tránh lỗi permission hoặc bị chặn.

## Quy tắc bắt buộc (phải làm đúng thứ tự)

1. **Kiểm tra điều kiện trước khi capture**
   - Tab hiện tại PHẢI là https://meet.google.com/*
   - Extension đang chạy trong context của tab Google Meet (content script phải inject được)
   - Người dùng đã tương tác (click button Start) → đây là điều kiện bắt buộc của chrome.tabCapture

2. **Permissions cần thiết (phải khai báo trong manifest.json)**
   - "tabCapture"
   - "activeTab"
   - "storage" (nếu cần lưu trạng thái)
   - "offscreen" (khuyến nghị nếu dùng offscreen document để recording ổn định hơn)

3. **Quy trình capture âm thanh đúng cách (bắt buộc mix hai nguồn)**
   Bước 1: Capture âm thanh từ TAB (system audio của Meet)
   - Sử dụng: chrome.tabCapture.capture({ audio: true, video: false })
   - Phải gọi từ **background script** (service worker)
   - Chỉ hoạt động sau khi user tương tác (click button)

   Bước 2: Capture âm thanh từ MICROPHONE (mic của người dùng)
   - Sử dụng: navigator.mediaDevices.getUserMedia({ audio: true })
   - Phải gọi từ **content script** hoặc background (nhưng thường từ content script để hỏi permission mic)
   - Người dùng sẽ thấy popup xin quyền microphone → phải chấp nhận

   Bước 3: Mix hai stream lại thành một stream duy nhất
   - Sử dụng Web Audio API:
     - Tạo AudioContext
     - Tạo MediaStreamSource từ tab stream
     - Tạo MediaStreamSource từ mic stream
     - Kết nối cả hai vào một MediaStreamDestination
     - Lấy stream cuối cùng từ destination.stream

   Bước 4: Ghi âm hoặc xử lý stream đã mix
   - Sử dụng MediaRecorder trên stream đã mix
   - Ghi theo chunk (ví dụ: start(1000) → mỗi 1 giây nhận blob)
   - Gửi các audio chunk này đến:
     - Server để transcribe (Whisper, Google STT, Deepgram, v.v.)
     - Hoặc xử lý local nếu có model nhẹ (nhưng ít khả thi)

4. **Quy tắc xử lý lỗi phổ biến**
   - Nếu chrome.tabCapture.capture trả về null hoặc lỗi → thông báo: "Không thể capture âm thanh tab. Hãy đảm bảo bạn đang ở tab Google Meet và đã tương tác với extension."
   - Nếu getUserMedia bị từ chối → thông báo: "Cần quyền truy cập microphone để ghi âm thanh của bạn."
   - Nếu không mix được → fallback chỉ ghi tab audio và cảnh báo người dùng rằng "chỉ ghi được âm thanh từ người khác"
   - Nếu stream bị stop đột ngột → tự động reconnect hoặc thông báo người dùng start lại

5. **Quy tắc dừng capture (Stop)**
   - Dừng MediaRecorder
   - Gọi .stop() trên tất cả tracks của cả hai stream (tabStream và micStream)
   - Đóng AudioContext nếu có
   - Giải phóng tài nguyên để tránh memory leak

6. **Không được làm**
   - Không tự động capture mà không có tương tác người dùng (vi phạm chính sách Chrome)
   - Không cố capture audio khi tab không phải Google Meet
   - Không dùng chrome.desktopCapture (dành cho screen sharing, phức tạp và cần quyền cao hơn)
   - Không dựa hoàn toàn vào live captions nếu mục tiêu là lấy audio thô

7. **Trạng thái và feedback cho người dùng**
   - Khi start thành công → hiển thị trạng thái: "Đang ghi âm thanh hai chiều..."
   - Khi có lỗi → hiển thị thông báo rõ ràng trong popup
   - Khi stop → hiển thị: "Đã dừng. Transcript / ghi chú đã lưu."

8. **Khuyến nghị bổ sung (tùy chọn nhưng rất hữu ích)**
   - Cho phép người dùng chọn: "Ghi cả hai phía" / "Chỉ ghi âm thanh meeting" / "Chỉ ghi mic của tôi"
   - Hỗ trợ pause/resume nếu có thể
   - Lưu timestamp mỗi chunk để đồng bộ với ghi chú
   - Nếu tích hợp live captions → dùng như fallback hoặc nguồn text song song

## Tóm tắt thứ tự logic cần tuân thủ
1. User click Start → popup gửi message
2. Content script xác nhận tab là Meet → chuyển tiếp message đến background
3. Background:
   - chrome.tabCapture.capture() → lấy tab audio
   - getUserMedia() → lấy mic audio (hoặc yêu cầu content script làm)
   - Mix hai stream bằng Web Audio API
   - Bắt đầu MediaRecorder trên stream mix
4. Xử lý audio chunks → transcribe / lưu note
5. User click Stop → dừng tất cả và giải phóng

Áp dụng đúng các rules trên thì extension sẽ lấy được âm thanh **từ cả hai phía** một cách ổn định và tuân thủ chính sách Chrome.