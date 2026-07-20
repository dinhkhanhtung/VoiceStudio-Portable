# BÁO CÁO PHÂN TÍCH DỰ ÁN SIMPLEVOICEEDIT & ĐỀ XUẤT TÍCH HỢP VÀO VOICESTUDIO

Báo cáo này phân tích cấu trúc, tính năng của dự án `SimpleVoiceEdit` (tại `D:\Dev\Projects\Python\SimpleVoiceEdit`) và đề xuất các giải pháp tích hợp các tính năng này cùng 5 tính năng nâng cấp premium vào ứng dụng **VoiceStudio_Portable**.

---

## I. Phân Tích Dự Án SimpleVoiceEdit

`SimpleVoiceEdit` là một ứng dụng Python (Tkinter GUI) chuyên dụng cho việc **tự động hóa sản xuất video từ file âm thanh giọng nói**. Nó giải quyết bài toán: *Làm thế nào để tạo nhanh một video minh họa (chèn stock footage, phụ đề, timeline) từ một file audio thuyết minh có sẵn.*

### Các tệp cốt lõi và chức năng tương ứng:
1. **`SimpleVoiceEdit.py` & `main.py`**: Điểm chạy chính của ứng dụng và giao diện người dùng dựa trên Tkinter.
2. **`audio_processor.py`**:
   - **Đo thời lượng & Tính toán tối ưu**: Đề xuất số lượng clip và thời lượng dựa trên tổng thời lượng audio.
   - **Phân tích cảm xúc (Emotion Analysis)**: Sử dụng thư viện `pydub` đo lường âm lượng trung bình (`dBFS`). Nếu `dBFS > -20dB` phân loại là `high_energy` (năng động), dưới `-30dB` là `calm` (nhẹ nhàng), còn lại là `default` (mặc định).
   - **Phát hiện khoảng lặng (Audio Segmentation)**: Sử dụng `pydub.silence.detect_nonsilent` để xác định các câu nói và các khoảng lặng để cắt ghép video/phụ đề.
   - **Tạo phụ đề (Whisper)**: Gọi mô hình `openai-whisper` (bản `small`, nhận diện tiếng Việt) để chuyển giọng nói thành văn bản `.srt` với mốc thời gian chuẩn.
   - **Trích xuất từ khóa (Keyword Extraction)**: Phân tích văn bản bằng từ điển chủ đề tiếng Việt hoặc dùng thư viện `KeyBERT` để trích xuất 5 từ khóa cốt lõi của đoạn nói.
3. **`video_processor.py`**:
   - **Phân loại Footage**: Đọc tag từ metadata hoặc phân loại video cục bộ theo tên thư mục/file (ví dụ video trong thư mục chứa chữ "slow", "relax" sẽ gán vào nhóm `calm`).
   - **Tải Stock Video (Pexels API)**: Tự động dùng API Key tải các video ngắn chất lượng cao từ Pexels phù hợp với từ khóa đã trích xuất.
   - **Biên tập & Render Video (FFmpeg)**: Cắt ghép, ghép nối các video clip ngẫu nhiên tương ứng với cảm xúc và từ khóa để phủ kín thời lượng audio thuyết minh.
   - **Xuất file EDL (Edit Decision List)**: Sinh file `.edl` chứa thông tin timeline chi tiết (tên file video, source in/out, record in/out) để người dùng có thể nhập (Import) thẳng vào **DaVinci Resolve** hoặc **Premiere Pro** nhằm tiếp tục chỉnh sửa chuyên nghiệp.
4. **`video_tags.py`**: Quản lý thẻ tag video và lưu trữ dưới dạng JSON.

---

## II. Đề Xuất Các Tính Năng Tích Hợp Vào VoiceStudio_Portable

Việc kết hợp thế mạnh tạo giọng đọc chất lượng cao của **VoiceStudio** và khả năng tự động hóa dựng video của **SimpleVoiceEdit** sẽ tạo nên một **Bộ công cụ AI sản xuất nội dung video ngắn (TikTok/Reels/Shorts) trọn gói**.

### 1. Tự Động Tạo Video Minh Họa & Xuất EDL (Từ SimpleVoiceEdit)
- **Cơ chế**: Khi người dùng nhập văn bản và tạo giọng đọc thành công trong VoiceStudio:
  - Hệ thống sẽ dùng chính văn bản đầu vào để phân tích từ khóa (không cần Whisper chạy nặng nề) hoặc dùng Whisper nếu người dùng tải file audio ngoài lên.
  - Tự động gọi API Pexels hoặc sử dụng kho video có sẵn của người dùng để sinh ra một file video nháp `.mp4` ghép với giọng nói vừa tạo.
  - **Đặc biệt**: Xuất kèm file `.edl` để người dùng Import vào DaVinci Resolve nhằm tinh chỉnh lại timeline chỉ trong 1 cú click.

### 2. Trình Cắt Âm Thanh Trực Quan (Waveform Trimmer) & Khử Nhiễu (Đề xuất thêm)
- **Cơ chế**: Ở tab "Giọng của bạn" (Voice Cloning):
  - Khi người dùng tải lên file âm thanh mẫu để clone, giao diện Next.js sử dụng thư viện `wavesurfer.js` để dựng biểu đồ sóng âm trực quan.
  - Người dùng có thể kéo chọn trực tiếp vùng âm thanh tốt nhất (độ dài lý tưởng 10 - 15 giây).
  - Tích hợp nút gạt **"Khử nhiễu nền"**: Dùng bộ lọc FFmpeg (`highpass`, `lowpass`, hoặc thư viện Python `noisereduce` chạy ngầm ở backend) để loại bỏ tiếng ồn máy lạnh, tiếng gió trước khi đưa vào mô hình Clone.

### 3. Chế Độ Hội Thoại Nhiều Giọng Đọc (Multi-speaker Script) (Đề xuất thêm)
- **Cơ chế**: Trong giao diện viết kịch bản:
  - Cho phép thêm nhiều khối thoại (Block). Mỗi khối thoại cho phép chọn một giọng đọc khác nhau trong thư viện.
  - Khi nhấn tạo, backend sẽ tổng hợp âm thanh cho từng đoạn, chèn khoảng nghỉ (pause) tự nhiên giữa các câu thoại theo cấu hình của người dùng, rồi ghép nối (concatenate) chúng thành một file audio hội thoại duy nhất.

### 4. Hiệu Ứng Studio & Bộ Lọc Âm Thanh (Post-processing) (Đề xuất thêm)
- **Cơ chế**: Sau khi giọng đọc AI được tạo ra, người dùng có thể bật tùy chọn **"Giọng đọc Studio"**:
  - Backend sử dụng FFmpeg Audio Filters để xử lý:
    - **EQ / Bass Boost**: Tăng tần số trầm giúp giọng đọc nghe ấm, dày và truyền cảm hơn.
    - **Reverb**: Thêm hiệu ứng vang phòng thu nhẹ (`aecho` hoặc `sox` reverb filter) tạo cảm giác không gian chuyên nghiệp.
    - **Limiter/Normalizer**: Đảm bảo âm lượng đồng đều giữa các đoạn, tránh bị rè âm thanh.

### 5. Xuất Phụ Đề Chuẩn Xác (.srt) (Từ cả hai dự án)
- **Cơ chế**: Vì VoiceStudio tự tạo giọng nói từ text, chúng ta có thể lưu vết chính xác thời lượng phát âm của từng từ hoặc câu thông qua dữ liệu mô hình.
- Xuất trực tiếp file phụ đề `.srt` đi kèm file âm thanh để người dùng ghép nhanh vào các phần mềm dựng video khác.

### 6. Quản Lý Dự Án Sách Nói / Podcast (Project Workspace) (Đề xuất thêm)
- **Cơ chế**: Cho phép người dùng tạo một "Dự án". Trong dự án có thể chia thành nhiều phân đoạn/chương nhỏ.
- Người dùng có thể chỉnh sửa, nghe thử từng chương độc lập và cuối cùng bấm "Xuất toàn bộ dự án" để gộp tất cả thành một file MP3/WAV hoàn chỉnh kèm mục lục thời gian.

---

## III. Kế Hoạch Triển Khai Kỹ Thuật (Architecture)

- **Ngôn ngữ & Công nghệ sử dụng**:
  - **Frontend**: Next.js (TypeScript) + React WaveSurfer để xử lý hiển thị cắt âm thanh.
  - **Backend**: Express.js (Node.js) nhận lệnh, quản lý file và điều phối.
  - **Core Processors**: Python Script (gọi Whisper, Pexels API, phân tích cảm xúc) & FFmpeg (xử lý âm thanh/video siêu tốc).
