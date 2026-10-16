/**
 * Netlify Function: submission-created Event & Webhook Handler
 * Xử lý khi có lượt đăng ký form sofa mới (icus-booking) từ website ICUS Craft Studio.
 *
 * Nhiệm vụ:
 * 1. Nhận sự kiện từ Netlify (hỗ trợ cả Native Event Trigger submission-created lẫn Outgoing Webhook).
 * 2. Lấy và chuẩn hóa dữ liệu: customer_name, phone, email, service, address, note, branch, submission_id.
 * 3. Đồng bộ khách hàng vào Google Sheets (bảng CUSTOMERS) và CRM Admin:
 *    - Xác minh schema bảng CUSTOMERS qua Apps Script action get_customers và save_customer.
 *    - Chống xử lý trùng: nếu khách đã tồn tại theo số điện thoại hoặc email, không tạo bản ghi mới trùng lặp,
 *      đồng thời không tự ý sửa đổi/ghi đè thông tin cũ của khách hàng.
 * 4. Gửi thông báo đăng ký mới đến Telegram Bot hoặc nhóm ICUS (qua Telegram Bot API):
 *    - Sử dụng biến môi trường TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID an toàn.
 *    - Không in token hoặc secret ra log.
 * 5. KHÔNG gửi email tự động qua Resend (đã loại bỏ hoàn toàn logic email).
 * 6. KHÔNG tạo đơn hàng hoặc kích hoạt thanh toán SePay từ form này.
 */

// Helper che giấu email trong log
function maskEmail(emailStr) {
  if (!emailStr || !emailStr.includes("@")) return "***";
  const [user, domain] = emailStr.split("@");
  const maskedUser = user ? user[0] + "***" : "***";
  return `${maskedUser}@${domain}`;
}

// Helper che giấu số điện thoại trong log
function maskPhone(phoneStr) {
  const clean = String(phoneStr || "").trim();
  if (clean.length < 4) return "***";
  return clean.slice(0, 3) + "***" + clean.slice(-3);
}

// Helper khử dữ liệu nhạy cảm trong log (tránh in token, secret hay URL nhạy cảm)
function sanitizeLog(text) {
  if (!text) return "";
  let clean = String(text);
  const tgToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (tgToken && clean.includes(tgToken)) {
    clean = clean.replaceAll(tgToken, "tg_bot_***");
  }
  const tgChat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (tgChat && clean.includes(tgChat)) {
    clean = clean.replaceAll(tgChat, "chat_***");
  }
  const appsUrl = (process.env.APPS_SCRIPT_URL || "").trim();
  if (appsUrl && clean.includes(appsUrl)) {
    clean = clean.replaceAll(appsUrl, "https://script.google.com/.../exec");
  }
  const adminKey = (process.env.CRM_ADMIN_KEY || process.env.ADMIN_KEY || "").trim();
  if (adminKey && clean.includes(adminKey)) {
    clean = clean.replaceAll(adminKey, "admin_key_***");
  }
  return clean.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, (m) => maskEmail(m));
}

// Bảng ánh xạ mã dịch vụ sang tên tiếng Việt hiển thị
const SERVICE_LABELS = {
  "sofa-da-ve-sinh-phuc-hoi": "Sofa da thật (Vệ sinh / Dưỡng ẩm / Phục hồi màu da)",
  "sofa-da-cong-nghiep": "Sofa da công nghiệp / Da microfiber",
  "sofa-vai-ni-nhung": "Sofa vải, nỉ, nhung (Giặt sâu / Khử mùi / Diệt khuẩn)",
  "sofa-sua-chua-boc-lai": "Sửa chữa, thay mút nệm xẹp, bọc lại mới",
  "sofa-khao-sat-tu-van": "Khác / Cần chuyên viên khảo sát & báo giá tận nhà",
};

// -----------------------------------------------------------------------------
// 1. ĐỒNG BỘ GOOGLE SHEETS (BẢNG CUSTOMERS / CRM ADMIN)
// -----------------------------------------------------------------------------
async function syncCustomerToGoogleSheets({ customerName, phone, email, submissionId }) {
  const appsScriptUrl = (
    process.env.APPS_SCRIPT_URL ||
    "https://script.google.com/macros/s/AKfycbxgENpxTE71byOBt7lIrVL9ZKnlppTWC0KK-vezI6dZ4806CVcaX-_wL3tDmrtNUn5mmA/exec"
  ).trim();

  if (!appsScriptUrl) {
    console.log("[submission-created] Chưa cấu hình APPS_SCRIPT_URL, bỏ qua đồng bộ Google Sheets.");
    return { synced: false, reason: "missing_apps_script_url" };
  }

  const adminToken = (process.env.CRM_ADMIN_KEY || process.env.ADMIN_KEY || "").trim();

  try {
    // A. Kiểm tra danh sách khách hàng hiện có (Chống tạo trùng lặp & bảo toàn dữ liệu cũ)
    let isExistingCustomer = false;
    let existingCustomerId = 0;

    try {
      const sep = appsScriptUrl.includes("?") ? "&" : "?";
      let getUrl = `${appsScriptUrl}${sep}action=get_customers`;
      if (adminToken) {
        getUrl += `&admin_token=${encodeURIComponent(adminToken)}`;
      }

      const getRes = await fetch(getUrl);
      const getData = await getRes.json();

      if (getData && getData.success && Array.isArray(getData.data)) {
        const cleanPhone = String(phone || "").replace(/[\s\.\-\(\)]/g, "");
        const cleanEmail = String(email || "").toLowerCase().trim();

        const match = getData.data.find((c) => {
          const cPhone = String(c.phone || "").replace(/[\s\.\-\(\)]/g, "");
          const cEmail = String(c.email || "").toLowerCase().trim();
          return (
            (cleanPhone && cPhone && cleanPhone === cPhone) ||
            (cleanEmail && cEmail && cleanEmail === cEmail)
          );
        });

        if (match && match.id) {
          isExistingCustomer = true;
          existingCustomerId = Number(match.id);
        }
      }
    } catch (getErr) {
      console.warn("[submission-created] Không thể kiểm tra get_customers cũ:", sanitizeLog(getErr.message));
    }

    // B. Xử lý lưu dữ liệu:
    // - Nếu khách hàng ĐÃ TỒN TẠI: Không tạo bản ghi trùng lặp và không tự ý ghi đè làm thay đổi dữ liệu cũ.
    // - Nếu khách hàng MỚI: Gọi action save_customer để lưu vào sheet CUSTOMERS.
    if (isExistingCustomer) {
      console.log(`[submission-created] Khách hàng đã tồn tại trong CRM (ID: ${existingCustomerId}). Giữ nguyên dữ liệu cũ, không tạo bản ghi trùng lặp.`);
      return { synced: true, isNew: false, customerId: existingCustomerId };
    }

    const savePayload = {
      action: "save_customer",
      name: customerName,
      phone: phone,
      email: email,
    };
    if (adminToken) {
      savePayload.admin_token = adminToken;
    }

    const postRes = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(savePayload),
    });

    const postData = await postRes.json();
    if (postData && postData.success) {
      console.log(`[submission-created] Đã lưu khách hàng mới vào Google Sheets CUSTOMERS (ID: ${postData.id || "N/A"}).`);
      return { synced: true, isNew: true, customerId: postData.id };
    } else {
      console.warn(`[submission-created] Apps Script phản hồi không thành công:`, sanitizeLog(JSON.stringify(postData)));
      return { synced: false, error: postData };
    }
  } catch (err) {
    console.error(`[submission-created] Lỗi kết nối Google Apps Script:`, sanitizeLog(err.message));
    return { synced: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// 2. GỬI THÔNG BÁO TELEGRAM BOT API
// -----------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegramNotification({
  customerName,
  phone,
  email,
  service,
  branch,
  address,
  note,
  submissionId,
  isNewCustomer,
  customerId,
}) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();

  if (!botToken || !chatId) {
    console.warn("[submission-created] CẢNH BÁO: Chưa thiết lập TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trên biến môi trường. Bỏ qua gửi thông báo Telegram.");
    return { sent: false, reason: "missing_credentials" };
  }

  const cleanPhone = String(phone || "").replace(/[\s\.\-\(\)]/g, "");
  const serviceText = SERVICE_LABELS[service] || service || "Chưa xác định";
  const customerStatus = isNewCustomer
    ? "✨ Khách hàng mới"
    : `🔁 Khách hàng cũ (CRM ID: #${customerId || "N/A"})`;

  const timeString = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });

  const messageText = [
    `🛋️ <b>[ICUS CRAFT STUDIO] ĐĂNG KÝ KHẢO SÁT SOFA MỚI!</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Khách hàng:</b> ${escapeHtml(customerName)} (<i>${customerStatus}</i>)`,
    `📞 <b>Số điện thoại:</b> <code>${escapeHtml(phone)}</code> | <a href="https://zalo.me/${cleanPhone}">Mở Zalo</a>`,
    `📧 <b>Email:</b> ${escapeHtml(email || "Không có")}`,
    `🛋️ <b>Dịch vụ quan tâm:</b> ${escapeHtml(serviceText)}`,
    `🏠 <b>Địa chỉ khảo sát:</b> ${escapeHtml(address || "Chưa cung cấp")}`,
    `📝 <b>Ghi chú tình trạng:</b> ${escapeHtml(note || "Không có ghi chú")}`,
    `📍 <b>Xưởng phụ trách:</b> ${escapeHtml(branch || "Chi nhánh 1")}`,
    `🆔 <b>Mã Submission:</b> <code>${escapeHtml(submissionId)}</code>`,
    `⏰ <b>Thời gian tiếp nhận:</b> ${escapeHtml(timeString)}`,
  ].join("\n");

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const resJson = await res.json();
    if (resJson && resJson.ok) {
      console.log(`[submission-created] Đã gửi thông báo Telegram thành công (Msg ID: ${resJson.result && resJson.result.message_id}).`);
      return { sent: true };
    } else {
      console.warn(`[submission-created] Telegram API trả về lỗi:`, sanitizeLog(JSON.stringify(resJson)));
      return { sent: false, error: resJson };
    }
  } catch (err) {
    console.error(`[submission-created] Lỗi kết nối Telegram API:`, sanitizeLog(err.message));
    return { sent: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// 3. HANDLER CHÍNH: NETLIFY EVENT & OUTGOING WEBHOOK
// -----------------------------------------------------------------------------
export const handler = async (event, context) => {
  // Chỉ hỗ trợ phương thức POST (từ Netlify Form Event hoặc Netlify Webhook)
  if (event.httpMethod && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    // Trích xuất linh hoạt payload (tương thích cả Netlify Background Event, Outgoing Webhook JSON và URL-encoded)
    let body = {};
    if (typeof event.body === "string") {
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        const params = new URLSearchParams(event.body || "");
        body = Object.fromEntries(params.entries());
      }
    } else if (event.body && typeof event.body === "object") {
      body = event.body;
    }

    const payload = body.payload || body;
    const data = payload.data || body.data || payload;
    const formName = (payload.form_name || data["form-name"] || data["form_name"] || "").trim();
    const submissionId = String(payload.id || body.id || `sub_${Date.now()}`).trim();

    // Chỉ xử lý form đặt lịch "icus-booking"
    if (formName && formName !== "icus-booking") {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Bỏ qua form không phải icus-booking" }),
      };
    }

    // Trích xuất các trường dữ liệu người dùng
    const customerName = (data.customer_name || payload.name || "").trim();
    const phone = (data.phone || payload.phone || "").trim();
    const email = (data.email || payload.email || "").trim();
    const service = (data.service || "").trim();
    const branch = (data.branch || "").trim();
    const address = (data.address || "").trim();
    const note = (data.note || "").trim();

    // Ràng buộc dữ liệu tối thiểu
    if (!customerName || (!phone && !email)) {
      console.log(`[submission-created] Bỏ qua submission (${submissionId}): Thiếu họ tên hoặc thông tin liên hệ.`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Thiếu họ tên hoặc thông tin liên hệ" }),
      };
    }

    console.log(
      `[submission-created] Tiếp nhận submission (${submissionId}): Khách ${customerName} | SĐT: ${maskPhone(phone)} | Email: ${maskEmail(email)} | Dịch vụ: ${service || "N/A"}`
    );

    // 1. Đồng bộ sang Google Sheets CUSTOMERS / CRM Admin
    const syncResult = await syncCustomerToGoogleSheets({
      customerName,
      phone,
      email,
      submissionId,
    });

    // 2. Gửi thông báo đến Telegram Bot / Nhóm ICUS
    await sendTelegramNotification({
      customerName,
      phone,
      email,
      service,
      branch,
      address,
      note,
      submissionId,
      isNewCustomer: syncResult.isNew !== false,
      customerId: syncResult.customerId,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Xử lý form sofa thành công",
        submission_id: submissionId,
      }),
    };
  } catch (unexpectedErr) {
    const sanitizedMsg = sanitizeLog(unexpectedErr.message || String(unexpectedErr));
    console.error(`[submission-created] Lỗi xử lý ngoại lệ: ${sanitizedMsg}`);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: sanitizedMsg }),
    };
  }
};
