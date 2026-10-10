/**
 * ICUS - Nhận đơn đặt lịch từ website: lưu vào Google Sheets + gửi mail báo đơn qua Gmail.
 *
 * Cài đặt:
 * 1. Tạo 1 Google Sheet mới -> menu Tiện ích mở rộng (Extensions) -> Apps Script.
 * 2. Xoá code mẫu, dán toàn bộ file này vào, bấm Lưu.
 * 3. Chọn hàm testSendMail -> Chạy (Run) -> cấp quyền -> kiểm tra hộp thư đã nhận mail test chưa.
 * 4. Triển khai (Deploy) -> Tùy chọn triển khai mới (New deployment) -> loại: Ứng dụng web (Web app)
 *      Thực thi với tư cách (Execute as): Tôi (Me)
 *      Người có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 * 5. Copy link Web app (đuôi /exec) dán vào ICUS_GOOGLE_SCRIPT_URL trong index.html.
 * LƯU Ý: Mỗi lần sửa code phải vào Deploy -> Manage deployments -> Edit -> Version: New version,
 *        nếu không web vẫn chạy code cũ.
 */

// Email nhận báo đơn, cách nhau dấu phẩy. Để trống = gửi về Gmail của chủ script.
const NOTIFY_EMAILS = "";
const SHEET_NAME = "Don dat lich";

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p["bot-field"]) return json_({ result: "success" }); // bot spam, bỏ qua

  const order = {
    time: Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss"),
    name: String(p.customer_name || "").slice(0, 200),
    phone: String(p.phone || "").slice(0, 50),
    service: String(p.service || "").slice(0, 200),
    branch: String(p.branch || "").slice(0, 300)
  };
  if (!order.name || !order.phone) return json_({ result: "error", message: "Thiếu tên hoặc số điện thoại" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet_().appendRow([order.time, order.name, "'" + order.phone, order.service, order.branch]);
  } finally {
    lock.releaseLock();
  }

  sendMail_(order);
  return json_({ result: "success" });
}

function doGet() {
  return json_({ result: "ok", message: "ICUS booking endpoint đang hoạt động" });
}

function sendMail_(o) {
  const to = NOTIFY_EMAILS || Session.getEffectiveUser().getEmail();
  const rows = [["Thời gian", o.time], ["Khách hàng", o.name], ["Số điện thoại", o.phone],
                ["Dịch vụ", o.service], ["Chi nhánh", o.branch]];
  const html = '<h2 style="color:#FF5722">🔥 ICUS - Có đơn đặt lịch mới</h2><table cellpadding="6" style="border-collapse:collapse">' +
    rows.map(function (r) {
      return '<tr><td style="border:1px solid #ddd"><b>' + r[0] + '</b></td><td style="border:1px solid #ddd">' + escape_(r[1]) + '</td></tr>';
    }).join("") +
    '</table><p><a href="https://zalo.me/' + encodeURIComponent(o.phone.replace(/\D/g, "")) + '">Nhắn Zalo cho khách</a></p>';
  MailApp.sendEmail({
    to: to,
    subject: "[ICUS] Đơn mới: " + o.name + " - " + o.phone,
    htmlBody: html,
    body: rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n")
  });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["Thời gian", "Họ tên", "Số điện thoại", "Dịch vụ", "Chi nhánh"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function escape_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Chạy thử trong trình soạn thảo Apps Script để kiểm tra mail + quyền.
function testSendMail() {
  doPost({ parameter: { customer_name: "Khách test", phone: "0900000000", service: "tui-xach", branch: "CN 1" } });
}
