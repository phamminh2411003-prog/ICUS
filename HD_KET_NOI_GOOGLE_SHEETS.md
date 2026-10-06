# HƯỚNG DẪN KẾT NỐI FORM KHẢO SÁT ICUS VỚI GOOGLE SHEETS

Website ICUS đã được tích hợp sẵn 3 phương án kết nối linh hoạt, không cần cài đặt server backend phức tạp. Dưới đây là hướng dẫn chi tiết từng cách:

---

## 🌟 CÁCH 1: Dùng Google Apps Script (Khuyên Dùng - Hoàn Toàn Miễn Phí & Chuyên Nghiệp)
Dữ liệu từ Form khảo sát trên web sẽ tự động thêm từng dòng mới vào file Google Sheets của bạn ngay lập tức, không giới hạn số lượng và không tốn chi phí bên thứ 3.

### Bước 1: Tạo Google Sheet mới
1. Mở [Google Sheets (Trang tính)](https://sheets.google.com) và tạo 1 bảng tính mới, đặt tên ví dụ: `ICUS - Danh Sách Khách Hàng Khảo Sát`.
2. Ở hàng đầu tiên (Dòng 1), đặt tiêu đề cho các cột:
   - Cột A: `Thời Gian`
   - Cột B: `Họ Và Tên`
   - Cột C: `Số Điện Thoại / Zalo`
   - Cột D: `Loại Đồ Cần Chăm Sóc`
   - Cột E: `Tình Trạng Sản Phẩm`
   - Cột F: `Kênh Nhận Tư Vấn`
   - Cột G: `Khung Giờ Thuận Tiện`
   - Cột H: `Chi Nhánh`
   - Cột I: `Ghi Chú Chi Tiết`

### Bước 2: Dán mã Google Apps Script
1. Trên thanh menu của Google Sheets, chọn **Tiện ích mở rộng (Extensions)** ➔ **Apps Script**.
2. Xóa toàn bộ mã mặc định trong khung soạn thảo và dán đoạn mã sau vào:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // Thêm một dòng mới vào Google Sheets
    sheet.appendRow([
      new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), // Thời gian gửi
      data.customer_name || "",
      data.phone || "",
      data.item_type || "",
      data.conditions || "",
      data.contact_channel || "",
      data.preferred_time || "",
      data.branch || "",
      data.note || ""
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", message: "Đã lưu vào Google Sheets!" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### Bước 3: Triển khai (Deploy) Web App
1. Ở góc trên bên phải, bấm nút xanh **Triển khai (Deploy)** ➔ chọn **Tùy chọn triển khai mới (New deployment)**.
2. Bấm vào biểu tượng bánh răng ⚙️ bên cạnh "Chọn loại", chọn **Ứng dụng web (Web app)**.
3. Điền cấu hình như sau:
   - **Mô tả:** Nhận form khảo sát ICUS
   - **Thực thi dưới dạng (Execute as):** `Tôi (Email của bạn)`
   - **Ai có quyền truy cập (Who has access):** `Bất kỳ ai (Anyone)` *(Quan trọng: phải chọn Anyone để form từ web gửi data vào được)*
4. Bấm **Triển khai (Deploy)**. Nếu Google yêu cầu cấp quyền truy cập, bấm *Ủy quyền truy cập* ➔ chọn tài khoản Google của bạn ➔ bấm *Nâng cao (Advanced)* ➔ bấm *Đi tới ... (Không an toàn)* ➔ bấm *Cho phép (Allow)*.
5. Sao chép đường link **URL của ứng dụng web** (có dạng `https://script.google.com/macros/s/AKfycb.../exec`).

### Bước 4: Dán URL vào website
Mở file `index.html`, tìm dòng biến cấu hình `ICUS_CONFIG` ở cuối trang:
```javascript
const ICUS_CONFIG = {
  SUBMIT_MODE: 'google_script', // Để nguyên google_script
  GOOGLE_SCRIPT_URL: 'DÁN_LINK_WEB_APP_CỦA_BẠN_VÀO_ĐÂY',
  ...
};
```
👉 Lưu file là xong! Mỗi khi khách gửi form, bảng tính Google Sheet sẽ tự động nhảy số!

---

## 🚀 CÁCH 2: Dùng Formspree.io
1. Vào [Formspree.io](https://formspree.io/) đăng ký tài khoản miễn phí.
2. Bấm **+ New Form**, đặt tên form (ví dụ: `ICUS Survey`).
3. Formspree sẽ cấp cho bạn 1 mã form endpoint có dạng: `https://formspree.io/f/xbjnopqr`.
4. Trong Formspree, vào tab **Settings** hoặc **Integrations** ➔ Bật kết nối **Google Sheets** (đăng nhập Google là xong).
5. Mở file `index.html`, đổi cấu hình:
```javascript
const ICUS_CONFIG = {
  SUBMIT_MODE: 'formspree',
  FORMSPREE_ENDPOINT: 'https://formspree.io/f/xbjnopqr', // Dán link formspree của bạn
  ...
};
```

---

## 📋 CÁCH 3: Nhúng Google Form Iframe Trực Tiếp
Nếu bạn đã tạo sẵn 1 Google Form:
1. Mở Google Form của bạn ➔ Bấm nút **Gửi (Send)** ở góc trên bên phải.
2. Chọn biểu tượng tab mã nhúng `< >` (Nhúng HTML).
3. Sao chép đường link bên trong thuộc tính `src="..."` (hoặc copy nguyên mã iframe).
4. Mở file `index.html`, tìm khung iframe và dán link vào:
```html
<iframe id="google-form-iframe" src="LINK_GOOGLE_FORM_CỦA_BẠN" ...></iframe>
```
Trên website đã có sẵn tab **"Nhúng Google Form"** để khách có thể điền trực tiếp trong iframe!
