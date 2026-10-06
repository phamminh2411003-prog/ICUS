/**
 * SePay Webhook Proxy - Netlify Serverless Function
 *
 * Chức năng:
 * 1. Tiếp nhận Webhook HTTPS từ SePay Gateway tại /api/sepay-webhook.
 * 2. Xác thực yêu cầu từ SePay bằng API Key (Header Authorization hoặc query token).
 * 3. Đọc SEPAY_WEBHOOK_SECRET từ Netlify Environment Variables (an toàn tuyệt đối, không lộ vào git).
 * 4. Chuyển tiếp POST payload sang Google Apps Script Web App và tự động follow redirect 302.
 * 5. Chỉ trả về success: true khi Google Apps Script xác nhận thành công.
 * 6. Tuyệt đối không log Secret, API Key hoặc thông tin nhạy cảm ra hệ thống log.
 */

export default async (req, context) => {
  const url = new URL(req.url, "http://localhost");

  // --------------------------------------------------------------------------
  // 1. HEALTH-CHECK ENDPOINT (GET)
  // --------------------------------------------------------------------------
  if (req.method === "GET") {
    const hasGasSecret = Boolean(process.env.SEPAY_WEBHOOK_SECRET);
    const hasSepayApiKey = Boolean(process.env.SEPAY_API_KEY);

    return new Response(JSON.stringify({
      success: true,
      status: hasGasSecret ? "ready" : "warning",
      platform: "Netlify Functions",
      secret_configured: hasGasSecret,
      api_key_protection: hasSepayApiKey,
      message: hasGasSecret
        ? "SePay Webhook Proxy trên Netlify đang hoạt động sẵn sàng."
        : "SEPAY_WEBHOOK_SECRET chưa được cấu hình trên Netlify Environment Variables."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // Chỉ chấp nhận POST cho Webhook
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      success: false,
      message: "Phương thức không được hỗ trợ (chỉ chấp nhận POST)."
    }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // --------------------------------------------------------------------------
  // 2. XÁC THỰC YÊU CẦU TỪ SEPAY (NẾU CẤU HÌNH SEPAY_API_KEY)
  // --------------------------------------------------------------------------
  const sepayApiKey = (process.env.SEPAY_API_KEY || "").trim();
  if (sepayApiKey) {
    const authHeader = (req.headers.get("authorization") || req.headers.get("Authorization") || "").trim();
    const queryToken = (url.searchParams.get("token") || url.searchParams.get("api_key") || url.searchParams.get("apikey") || "").trim();

    const cleanAuth = authHeader.replace(/^(Apikey|Bearer)\s+/i, "").trim();
    const isMatch =
      cleanAuth === sepayApiKey ||
      authHeader === sepayApiKey ||
      queryToken === sepayApiKey;

    if (!isMatch) {
      console.warn("[SePay Webhook] Từ chối request: Header Authorization hoặc token không khớp.");
      return new Response(JSON.stringify({
        success: false,
        message: "Unauthorized: Yêu cầu Webhook không hợp lệ hoặc thiếu API Key hợp lệ từ SePay."
      }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  }

  // --------------------------------------------------------------------------
  // 3. KIỂM TRA SECRET ĐÍCH (GOOGLE APPS SCRIPT) TỪ BIẾN MÔI TRƯỜNG
  // --------------------------------------------------------------------------
  const gasSecret = (process.env.SEPAY_WEBHOOK_SECRET || "").trim();
  if (!gasSecret) {
    console.error("[SePay Webhook] LỖI: SEPAY_WEBHOOK_SECRET chưa được cấu hình trên Netlify!");
    return new Response(JSON.stringify({
      success: false,
      message: "Lỗi cấu hình server: SEPAY_WEBHOOK_SECRET chưa được thiết lập trên Netlify."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // --------------------------------------------------------------------------
  // 4. CHUYỂN TIẾP (FORWARD) SANG GOOGLE APPS SCRIPT & FOLLOW REDIRECT 302
  // --------------------------------------------------------------------------
  const appsScriptBase = process.env.APPS_SCRIPT_URL ||
    "https://script.google.com/macros/s/AKfycbxgENpxTE71byOBt7lIrVL9ZKnlppTWC0KK-vezI6dZ4806CVcaX-_wL3tDmrtNUn5mmA/exec";

  const targetUrl = new URL(appsScriptBase);
  targetUrl.searchParams.set("secret", gasSecret);

  try {
    const rawBody = await req.text();
    console.log(`[SePay Webhook] Nhận payload (${rawBody.length} bytes). Đang forward sang Google Apps Script...`);

    // fetch tự động theo dõi (follow) redirect HTTP 302 sang script.googleusercontent.com
    const response = await fetch(targetUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "ICUS-Netlify-Proxy/1.0"
      },
      body: rawBody,
      redirect: "follow"
    });

    const upstreamData = await response.json().catch(() => null);

    // ------------------------------------------------------------------------
    // 5. CHỈ TRẢ VỀ SUCCESS KHI GOOGLE APPS SCRIPT XÁC NHẬN THÀNH CÔNG
    // ------------------------------------------------------------------------
    if (response.ok && upstreamData && upstreamData.success === true) {
      console.log(`[SePay Webhook] Google Apps Script xử lý thành công (HTTP ${response.status}).`);
      return new Response(JSON.stringify({
        success: true,
        message: upstreamData.message || "Webhook đã được chuyển tiếp và xử lý thành công",
        upstream_status: response.status,
        upstream_response: upstreamData
      }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    } else {
      console.warn(`[SePay Webhook] Google Apps Script phản hồi thất bại (HTTP ${response.status}):`,
        (upstreamData && upstreamData.message) ? upstreamData.message : "Phản hồi không hợp lệ");

      return new Response(JSON.stringify({
        success: false,
        message: (upstreamData && upstreamData.message) || "Google Apps Script từ chối hoặc xử lý giao dịch thất bại",
        upstream_status: response.status,
        upstream_response: upstreamData
      }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

  } catch (error) {
    console.error("[SePay Webhook] Lỗi kết nối khi forward sang Google Apps Script:", error.message);
    return new Response(JSON.stringify({
      success: false,
      message: "Lỗi kết nối khi forward sang Google Apps Script: " + error.message
    }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};
