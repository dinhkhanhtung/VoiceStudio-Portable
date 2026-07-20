# PROMPT TÍCH HỢP & NÂNG CẤP APP VOICESTUDIO_PORTABLE

Sao chép toàn bộ nội dung dưới đây và dán vào ô chat của phiên làm việc mới để AI tiếp tục thực hiện lập trình tích hợp:

```markdown
Chào bạn, tôi muốn bạn tiếp tục phát triển ứng dụng VoiceStudio_Portable (mã nguồn tại `D:\Dev\Projects\Github\VoiceStudio_Portable\repo`). 

Mục tiêu chính của chúng ta trong phiên làm việc này là **tích hợp các tính năng tự động hóa video từ dự án SimpleVoiceEdit** (nằm tại `D:\Dev\Projects\Python\SimpleVoiceEdit`) và bổ sung **5 tính năng nâng cấp Premium** để biến VoiceStudio thành một bộ công cụ sản xuất nội dung AI hoàn chỉnh.

### 1. Thông tin trạng thái hiện tại của dự án:
- Thư mục làm việc: `D:\Dev\Projects\Github\VoiceStudio_Portable\repo`
- **Frontend**: Next.js (TypeScript) tại `frontend_src`, biên dịch xuất ra `frontend/dist`.
- **Backend**: Node.js Express server + Electron wrapper (`electron_main.js` & `backend/server.js`), giao tiếp với Python CLI (`backend/desktop_setup.js` & `backend/tts_cli.py`).
- Phiên bản PyTorch đã được hạ xuống `2.5.1` để sửa lỗi `[WinError 126]`.
- Nút Donate trên giao diện tĩnh hiện đang hiển thị pop-up tài khoản BIDV của tôi (Đinh Khánh Tùng - 0982581222).

### 2. Các tính năng cần tích hợp từ dự án SimpleVoiceEdit:
- **Tự động hóa Tạo Video Minh họa**: Khi người dùng viết văn bản và tạo giọng đọc AI thành công, hệ thống sẽ sử dụng Pexels API để tự động tải các video ngắn liên quan đến từ khóa của văn bản, tự động cắt và ghép nối chúng khớp với thời lượng của file âm thanh vừa tạo để sinh ra video nháp `.mp4`.
- **Xuất Timeline EDL cho DaVinci Resolve**: Đồng thời sinh ra tệp `.edl` để người dùng dễ dàng Import dự án vào DaVinci Resolve hoặc Premiere Pro để tiếp tục chỉnh sửa.
- **Phân tích Cảm xúc Âm thanh**: Phân loại giọng đọc (`high_energy`, `calm`, `default`) dựa trên âm lượng `dBFS` để tự động chọn lọc stock video có vibe phù hợp.
- **Tự động trích xuất từ khóa**: Sử dụng cấu trúc lọc từ khóa chủ đề (hoặc KeyBERT như trong `audio_processor.py`) trực tiếp từ văn bản đầu vào để tìm kiếm video trên Pexels.

### 3. Năm (5) tính năng nâng cấp Premium cần phát triển:
1. **Trình Cắt Âm Thanh Trực Quan (Waveform Trimmer) + Khử Nhiễu**:
   - Ở tab "Giọng của bạn" (Voice Cloning), tích hợp thư viện `wavesurfer.js` vào giao diện để hiển thị sóng âm khi người dùng tải lên file âm thanh mẫu. Cho phép người dùng kéo chọn đoạn 10 - 15 giây tốt nhất để clone.
   - Thêm nút gạt **"Khử nhiễu nền"** trước khi gửi file âm thanh mẫu đi clone (áp dụng các bộ lọc FFmpeg highpass/lowpass hoặc noise reduction chạy ngầm tại backend).
2. **Chế độ Hội thoại Nhiều giọng đọc (Multi-speaker Script)**:
   - Cho phép viết kịch bản dạng hội thoại (nhiều đoạn thoại, mỗi đoạn gán một Speaker/giọng đọc khác nhau).
   - Backend sẽ sinh file âm thanh cho từng đoạn thoại rồi nối lại với nhau một cách mượt mà, chèn khoảng nghỉ (pause) tự nhiên giữa các câu thoại theo đúng cấu hình.
3. **Bộ lọc Âm thanh Studio (Post-processing Filters)**:
   - Thêm tùy chọn **"Giọng đọc Studio"**. Khi bật, sau khi tạo giọng đọc xong, backend sẽ dùng FFmpeg áp dụng EQ tăng bass/treble, tăng độ ấm và thêm hiệu ứng Reverb (tiếng vang nhẹ phòng thu chuyên dụng) giúp giọng đọc nghe cuốn hút, chuyên nghiệp hơn.
4. **Xuất kèm Phụ đề (.srt)**:
   - Sinh file `.srt` khớp chuẩn thời gian dựa trên các câu văn bản đầu vào và thời lượng đọc thực tế.
5. **Quản lý Dự án Sách nói (Project Workspace)**:
   - Cho phép người dùng tạo các dự án sách nói lớn, chia thành nhiều chương độc lập, chỉnh sửa và gộp tất cả thành 1 file MP3 dài hoàn chỉnh.

### Yêu cầu thực hiện:
- Phân tích mã nguồn của cả hai dự án để đề xuất một **Kế hoạch triển khai kiến trúc (Architecture & Task list)** rõ ràng trong file `implementation_plan.md` và `task.md`.
- Viết mã nguồn Next.js sạch sẽ, áp dụng thiết kế UX Premium theo phong cách hiện đại và nhất quán, tuân thủ các quy tắc trong Agentic rules.
- Tự động cài đặt các thư viện bổ sung cần thiết (như `wavesurfer.js`, các thư viện python).
- Hãy bắt đầu bằng cách kiểm tra cấu trúc mã nguồn của cả hai dự án và phác thảo giải pháp trong tệp `implementation_plan.md`.
```
