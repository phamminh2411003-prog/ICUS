# Ghi chú sửa lỗi website ICUS

Bản sửa đang chạy thử tại: **https://fixicus.netlify.app** (nhánh `claude/peaceful-archimedes-v81ws7`).
Bản gốc trước khi sửa đã được backup đầy đủ (commit `1d653f3`), có thể khôi phục bất cứ lúc nào.

Hai file trang web:
- `icus-landing-page/index.html`: **bản chính** (có chatbot, ảnh nằm cùng thư mục). Netlify nên đặt *Publish directory* = `icus-landing-page`.
- `index.html` (thư mục gốc): bản cũ hơn, không có chatbot. Đã sửa giống bản chính để không bị lỗi nếu vẫn deploy từ thư mục gốc.

Mọi chỗ sửa trong code đều có ghi chú `[Sửa lỗi]` ngay tại vị trí đó, tìm bằng Ctrl+F.

---

## Đợt 1: Form đặt lịch không gửi được đơn / không có mail báo đơn

| Vị trí | Lỗi cũ | Đã sửa |
|---|---|---|
| Form `#icus-booking-form` (dòng ~952, cả 2 file) | Web **luôn báo "đã nhận được yêu cầu"** dù đơn có gửi đi hay không, nên đơn mất mà không ai biết | Gửi đơn tới Netlify và **chờ kết quả thật**. Thành công mới báo xanh. Lỗi thì báo đỏ, giữ nguyên thông tin khách đã nhập, kèm nội dung soạn sẵn để khách nhắn Zalo |
| Form | Không có chống spam | Thêm ô ẩn `bot-field` (honeypot) để lọc bot |
| Script cuối trang (`ICUS_GOOGLE_SCRIPT_URL`) | Bản Google Sheets cũ dùng `no-cors` nên không biết lỗi, và đã bị xoá ở commit "chat box" | Thêm đường dự phòng: nếu dán link Google Apps Script vào biến này thì mỗi đơn được lưu vào Google Sheets và gửi Gmail |
| `google-apps-script/Code.gs` (file mới) | — | Script Google: lưu đơn vào Sheet và gửi mail báo đơn. Hướng dẫn cài nằm ở đầu file |

**Đã test thật trên Netlify:** đơn "đại gia Nhật" được nhận trong mục Forms. Để có mail: Netlify → Forms → **Submission notifications** → Add notification → Email → chọn form `icus-booking`.

## Đợt 2: Lỗi giao diện, chatbot, nội dung

| # | Vị trí | Lỗi cũ | Đã sửa |
|---|---|---|---|
| 1 | `tailwind.config` (dòng ~46) | Class `border-3`, `border-y-3`, `border-b-3`, `border-t-3` (44 chỗ) không có trong Tailwind nên **viền dày bị mất** ở thẻ, nút, header, footer. `decoration-3`, `scale-102` cũng không chạy | Khai báo thêm `borderWidth: 3px`, `textDecorationThickness: 3px`, `scale: 1.02`. Không phải sửa từng chỗ trong HTML |
| 2 | Thanh chữ chạy đầu trang (dòng ~105) | Class `animate-marquee` chưa được định nghĩa nên **chữ đứng yên** và bị cắt mất trên điện thoại | Thêm hiệu ứng chạy chữ, nhân đôi dãy chữ để chạy vòng liên tục không giật. Tự dừng nếu thiết bị bật "giảm chuyển động" |
| 3 | Chatbot: `toWords`, `INTENT_RULES`, `parseUserIntent` (dòng ~1297–1340, chỉ trong `icus-landing-page/index.html`) | Bot **hiểu nhầm câu hỏi**: "Bạn ơi giá bao nhiêu?" bị trả lời về vệ sinh, "Giao nhận thế nào?" bị trả lời bảng giá, "Tình trạng túi bị ố" bị trả lời về giao nhận, "Túi Dior bị mốc" bị trả lời về sneaker. Nguyên nhân: so khớp chữ con ("gia" khớp "giày", "ban" khớp "bạn") | So khớp **nguyên từ**. Các từ dễ nhầm ("bẩn", "giá", "tỉnh", "sơn") chỉ khớp khi khách gõ có dấu. Gom từ khoá vào bảng `INTENT_RULES`, thứ tự trong bảng là thứ tự ưu tiên. Đã thử 22 câu hỏi mẫu, đều trả lời đúng chủ đề |
| 4 | Thẻ meta description (dòng 7) | Hotline sai `0987.940.0077` (thừa số 0), Google hiển thị số này trong kết quả tìm kiếm | Sửa thành `0987.940.077` |
| 5 | Ô chọn dịch vụ trong form (dòng ~996) | Giá trị gửi đi là mã `tui-xach`, `giay-sneaker`... nên mail báo đơn khó đọc | Đổi thành chữ rõ ràng: "Túi xách hàng hiệu", "Giày sneaker cao cấp"... |
| 6 | Footer, mục Cam kết (dòng ~1100) | Lỗi chính tả "Saphire từ PHáp" | "Saphir từ Pháp" |
| 7 | `index.html` thư mục gốc (ảnh ở dòng 148, 299, 659, 682, 1047) | Trỏ ảnh tới `assets/` nhưng ảnh nằm trong `icus-landing-page/assets/` nên **cả 5 ảnh hỏng** khi deploy từ thư mục gốc | Sửa đường dẫn thành `icus-landing-page/assets/...` |
| 8 | `icus-landing-page/tunnel.log` | File log để **lộ IP mạng nội bộ và IPv6** của máy chạy thử | Xoá file, thêm `.gitignore` để log và `cloudflared.exe` không bị đưa lên Git nữa |

## Đợt 3: Chatbot trả lời lạc đề

Chỉ sửa trong `icus-landing-page/index.html`, phần `SOP_RESPONSES` (dòng ~1223–1300) và `INTENT_RULES` / `parseUserIntent` (dòng ~1325–1380).

| # | Lỗi cũ | Đã sửa |
|---|---|---|
| 1 | Khách gõ "vệ sinh giày", bot mở đầu "Hoàn toàn không bạn nha..." (đoạn này vốn để trả lời câu "có bị phai màu không?") và chỉ nói về túi, không có giá giày. Các câu phục hồi màu, dán đế, tẩy ố sneaker cũng bị mở đầu kiểu đáp câu hỏi khác | Viết lại 4 câu trả lời theo kiểu đi thẳng vào dịch vụ: **giá, cách làm, thời gian**. Toàn bộ giá, thời gian, quy trình **giữ nguyên số liệu trong kịch bản cũ**, không thêm thông tin mới |
| 2 | Vệ sinh giày và vệ sinh túi dùng chung một câu | Tách thành `ve_sinh_giay` (giá giày sneaker, tẩy ố, giày da, dép Hermès) và `ve_sinh_tui` (giá túi xách). Câu chỉ nói tình trạng ("giày bị bẩn", "túi bị mốc") cũng ra đúng loại đồ |
| 3 | Câu lo lắng "giặt có bay form không?", "phục hồi màu có bị cứng không?" không có câu trả lời riêng | Thêm chủ đề `lo_hu_hong`: trấn an + cam kết bồi thường (lấy từ kịch bản cũ). Chỉ kích hoạt khi khách **hỏi** ("có... không"). "Túi bị phai màu" (khách kể tình trạng) vẫn ra phục hồi màu |
| 4 | "Xin chào", "hi" bị trả lời "Trường hợp này ICUS cần kiểm tra tình trạng..." | Thêm chủ đề `chao` đáp lời chào. Chỉ dùng khi câu không hỏi gì khác, nên "Shop ơi cho hỏi giá" vẫn ra bảng giá |

Đã thử 38 câu hỏi mẫu, đều ra đúng chủ đề.

**Giới hạn còn lại:** chatbot vẫn là bot dò từ khóa với khoảng 18 câu trả lời viết sẵn, không phải AI. Nó không hiểu ngữ cảnh, không nhớ câu trước, và câu hỏi nằm ngoài kịch bản sẽ được hướng sang gửi ảnh/Zalo. Muốn bot hiểu như người thì cần chuyển sang chatbot AI (cần tài khoản API, có phí theo lượt chat).

---

## Chưa sửa: cần chủ tiệm xác nhận

1. **Ưu đãi 1 tặng 1:** trang ghi "món tiếp theo bất kỳ (giá bằng hoặc thấp hơn)", chatbot ghi "gửi túi thì tặng vệ sinh 1 đôi giày". Chính sách đúng là cái nào?
2. **Miễn phí giao nhận:** trang ghi "đơn từ 2 món", chatbot ghi "đơn trên 3.000.000đ". Cái nào đúng?
3. **Thời gian vệ sinh:** FAQ ghi 2–3 ngày, phần quy trình ghi 2–5 ngày, chatbot ghi 3–5 ngày. Ngoài ra trong chatbot, dán đế chỗ ghi 1–2 ngày, chỗ ghi 3–4 ngày.
4. **Mã xác minh Zalo:** thẻ meta trong `index.html` gốc là `...HqIdp0e...` (số 0), còn file xác minh là `...HqIdpOe...` (chữ O). Kiểm tra trong trang quản trị Zalo xem mã nào đúng.
5. **"Thợ trên 5 năm tay nghề"** nhưng logo ghi "EST. 2026": nên chỉnh cho thống nhất.
6. **Dọn repo:** 2 file `icus-landing-page.zip` (21MB, chứa `cloudflared.exe` 55MB) và `icus-landing-page (2).zip`, cùng các file trùng `index.html.html`, `index_netlify_form_fixed.html`. Nên xoá cho gọn khi chủ tiệm đồng ý.
7. **`serve.ps1` / `launch.ps1`:** chỉ dùng để chạy thử trên máy Windows, không ảnh hưởng web trên Netlify. `serve.ps1` có khả năng bị lỗi "no Runspace" khi có người truy cập. Nếu không còn dùng thì nên xoá.
