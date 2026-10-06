#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ICUS CRM Server (server.py)
Provides static file serving and RESTful API endpoints for CRM (brain.db).
Supports Products, Customers, Orders CRUD and stock deduction logic for physical goods.
"""

import os
import sys
import json
import sqlite3
import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

# Đảm bảo console Windows in tiếng Việt UTF-8 không bị crash bởi cp1252
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "brain.db")
APPS_SCRIPT_URL = os.environ.get(
    "APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbxgENpxTE71byOBt7lIrVL9ZKnlppTWC0KK-vezI6dZ4806CVcaX-_wL3tDmrtNUn5mmA/exec"
)
SEPAY_WEBHOOK_SECRET = os.environ.get("SEPAY_WEBHOOK_SECRET", "").strip()

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

class PreserveQueryParamsRedirectHandler(urllib.request.HTTPRedirectHandler):
    """
    Tự động giữ nguyên toàn bộ query parameters (đặc biệt là ?secret=...)
    khi follow redirect HTTP 301, 302, 303, 307, 308 sang URL mới (script.googleusercontent.com).
    """
    def __init__(self, original_query_params):
        super().__init__()
        self.original_query_params = original_query_params or {}

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req and self.original_query_params:
            parsed_new = urllib.parse.urlparse(new_req.full_url)
            new_params = urllib.parse.parse_qs(parsed_new.query, keep_blank_values=True)
            merged = {}
            for k, v in self.original_query_params.items():
                merged[k] = v
            for k, v in new_params.items():
                merged[k] = v
            new_query_str = urllib.parse.urlencode(merged, doseq=True)
            new_req.full_url = urllib.parse.urlunparse((
                parsed_new.scheme,
                parsed_new.netloc,
                parsed_new.path,
                parsed_new.params,
                new_query_str,
                parsed_new.fragment
            ))
        return new_req

class CRMHandler(BaseHTTPRequestHandler):

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def read_raw_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return b""
        return self.rfile.read(content_length)

    def read_json_body(self):
        raw = self.read_raw_body()
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def handle_sepay_webhook(self, raw_body, query_string=""):
        # 1. Kiểm tra SEPAY_WEBHOOK_SECRET từ biến môi trường
        secret = os.environ.get("SEPAY_WEBHOOK_SECRET", "").strip() or SEPAY_WEBHOOK_SECRET
        if not secret:
            print("[SePay Webhook Proxy] LỖI: SEPAY_WEBHOOK_SECRET chưa được cấu hình!", flush=True)
            return self.send_json({
                "success": False,
                "message": "SEPAY_WEBHOOK_SECRET chưa được cấu hình"
            }, status=200)

        # 2. Xây dựng target_url forward sang Google Apps Script: /exec?secret=<SEPAY_WEBHOOK_SECRET>
        parsed_base = urllib.parse.urlparse(APPS_SCRIPT_URL)
        combined_params = {"secret": secret}
        query_str = urllib.parse.urlencode(combined_params)

        target_url = urllib.parse.urlunparse((
            parsed_base.scheme,
            parsed_base.netloc,
            parsed_base.path,
            parsed_base.params,
            query_str,
            parsed_base.fragment
        ))

        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "ICUS-SePay-Proxy/1.0",
        }

        req = urllib.request.Request(
            target_url,
            data=raw_body,
            headers=headers,
            method="POST"
        )

        try:
            print(f"[SePay Webhook Proxy] Nhận payload ({len(raw_body)} bytes). Forward sang: {target_url.split('?')[0]}?secret=***", flush=True)
            # Dùng opener có PreserveQueryParamsRedirectHandler để đảm bảo ?secret=... luôn giữ nguyên qua redirect
            redirect_handler = PreserveQueryParamsRedirectHandler(combined_params)
            opener = urllib.request.build_opener(redirect_handler)

            with opener.open(req, timeout=20) as response:
                resp_text = response.read().decode("utf-8", errors="replace")
                status_code = response.status
                print(f"[SePay Webhook Proxy] Google Apps Script phản hồi (HTTP {status_code}): {resp_text[:150]}", flush=True)

                try:
                    upstream_data = json.loads(resp_text)
                except Exception:
                    upstream_data = {"raw": resp_text}

                return self.send_json({
                    "success": True,
                    "message": "Webhook đã được chuyển tiếp thành công sang Google Apps Script",
                    "upstream_status": status_code,
                    "upstream_response": upstream_data
                }, status=200)

        except urllib.error.HTTPError as http_err:
            err_text = http_err.read().decode("utf-8", errors="replace")
            print(f"[SePay Webhook Proxy] Lỗi HTTP từ Google Apps Script: {http_err.code} - {err_text}")
            return self.send_json({
                "success": False,
                "message": f"Google Apps Script trả về HTTP {http_err.code}",
                "error": err_text
            }, status=200)

        except Exception as e:
            print(f"[SePay Webhook Proxy] Lỗi chuyển tiếp webhook: {e}")
            return self.send_json({
                "success": False,
                "message": f"Lỗi chuyển tiếp webhook: {str(e)}"
            }, status=200)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # -----------------------------
        # API ROUTES
        # -----------------------------
        if path.startswith("/api/"):
            return self.handle_api_get(path)

        # -----------------------------
        # STATIC FILES
        # -----------------------------
        if path in ("/", "/index.html"):
            return self.serve_file(os.path.join(BASE_DIR, "index.html"), "text/html; charset=utf-8")
        elif path in ("/admin", "/admin/", "/admin.html"):
            return self.serve_file(os.path.join(BASE_DIR, "admin.html"), "text/html; charset=utf-8")
        else:
            rel_path = path.lstrip("/")
            file_path = os.path.abspath(os.path.join(BASE_DIR, rel_path))
            if not file_path.startswith(BASE_DIR):
                self.send_error(403, "Forbidden")
                return
            if os.path.isfile(file_path):
                ext = os.path.splitext(file_path)[1].lower()
                mime = MIME_TYPES.get(ext, "application/octet-stream")
                return self.serve_file(file_path, mime)
            else:
                self.send_error(404, "Not Found")

    def serve_file(self, file_path, content_type):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Internal Error: {e}")

    # =========================================================================
    # API: GET
    # =========================================================================
    def handle_api_get(self, path):
        conn = get_db()
        cursor = conn.cursor()
        try:
            if path == "/api/products":
                cursor.execute("SELECT * FROM products ORDER BY id DESC")
                items = [dict(r) for r in cursor.fetchall()]
                return self.send_json({"success": True, "data": items})

            elif path == "/api/customers":
                cursor.execute("SELECT * FROM customers ORDER BY id DESC")
                items = [dict(r) for r in cursor.fetchall()]
                return self.send_json({"success": True, "data": items})

            elif path == "/api/orders":
                # Join with customers and products for rich display
                cursor.execute("""
                    SELECT
                        o.id,
                        o.order_code,
                        o.customer_id,
                        c.name AS customer_name,
                        c.phone AS customer_phone,
                        o.product_id,
                        p.name AS product_name,
                        p.type AS product_type,
                        p.stock AS product_stock,
                        o.amount,
                        o.payment_status,
                        o.bank_transaction_id,
                        o.created_at
                    FROM orders o
                    LEFT JOIN customers c ON o.customer_id = c.id
                    LEFT JOIN products p ON o.product_id = p.id
                    ORDER BY o.id DESC
                """)
                items = [dict(r) for r in cursor.fetchall()]
                return self.send_json({"success": True, "data": items})

            elif path in ("/api/sepay-webhook", "/api/webhook/sepay"):
                curr_secret = os.environ.get("SEPAY_WEBHOOK_SECRET", "").strip() or SEPAY_WEBHOOK_SECRET
                is_configured = bool(curr_secret)
                return self.send_json({
                    "success": True,
                    "status": "ready" if is_configured else "warning",
                    "message": "SePay Webhook Proxy Endpoint đang hoạt động." if is_configured else "SEPAY_WEBHOOK_SECRET chưa được cấu hình",
                    "secret_configured": is_configured,
                    "target_apps_script_url": APPS_SCRIPT_URL
                })

            else:
                return self.send_json({"success": False, "message": "Endpoint not found"}, status=404)
        except Exception as e:
            return self.send_json({"success": False, "error": str(e)}, status=500)
        finally:
            conn.close()

    # =========================================================================
    # API: POST
    # =========================================================================
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")

        if not path.startswith("/api/"):
            return self.send_json({"success": False, "message": "Invalid API path"}, status=404)

        # --- POST /api/sepay-webhook (Proxy Webhook SePay -> Google Apps Script) ---
        if path in ("/api/sepay-webhook", "/api/webhook/sepay"):
            raw_body = self.read_raw_body()
            return self.handle_sepay_webhook(raw_body, parsed.query)

        try:
            body = self.read_json_body()
        except Exception as e:
            return self.send_json({"success": False, "message": f"Malformed JSON: {e}"}, status=400)

        conn = get_db()
        cursor = conn.cursor()

        try:
            # --- POST /api/products ---
            if path == "/api/products":
                name = (body.get("name") or "").strip()
                ptype = (body.get("type") or "service").strip().lower()
                price = float(body.get("price") or 0)
                stock = int(body.get("stock") or 0)

                if not name:
                    return self.send_json({"success": False, "message": "Tên sản phẩm không được trống"}, status=400)
                if ptype not in ("physical", "service", "digital"):
                    return self.send_json({"success": False, "message": "Loại sản phẩm không hợp lệ"}, status=400)

                cursor.execute(
                    "INSERT INTO products (name, type, price, stock) VALUES (?, ?, ?, ?)",
                    (name, ptype, price, stock)
                )
                conn.commit()
                new_id = cursor.lastrowid
                return self.send_json({"success": True, "id": new_id, "message": "Tạo sản phẩm thành công"}, status=201)

            # --- POST /api/customers ---
            elif path == "/api/customers":
                name = (body.get("name") or "").strip()
                phone = (body.get("phone") or "").strip()
                email = (body.get("email") or "").strip()

                if not name:
                    return self.send_json({"success": False, "message": "Tên khách hàng không được trống"}, status=400)

                cursor.execute(
                    "INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)",
                    (name, phone, email)
                )
                conn.commit()
                new_id = cursor.lastrowid
                return self.send_json({"success": True, "id": new_id, "message": "Tạo khách hàng thành công"}, status=201)

            # --- POST /api/orders/<id>/mark-success ---
            elif path.startswith("/api/orders/") and path.endswith("/mark-success"):
                parts = path.split("/")
                order_id = int(parts[3])

                # Lấy thông tin đơn hàng hiện tại
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                order = cursor.fetchone()
                if not order:
                    return self.send_json({"success": False, "message": "Không tìm thấy đơn hàng"}, status=404)

                current_status = (order["payment_status"] or "").lower()
                if current_status == "success":
                    return self.send_json({"success": True, "message": "Đơn hàng đã ở trạng thái success trước đó, không trừ kho lại"})

                product_id = order["product_id"]
                stock_deducted = False

                # Kiểm tra loại sản phẩm nếu có product_id
                if product_id:
                    cursor.execute("SELECT type, stock FROM products WHERE id = ?", (product_id,))
                    product = cursor.fetchone()
                    if product and product["type"] == "physical":
                        # Chỉ trừ stock 1 lần duy nhất cho sản phẩm physical
                        cursor.execute("UPDATE products SET stock = MAX(0, stock - 1) WHERE id = ?", (product_id,))
                        stock_deducted = True

                # Cập nhật trạng thái đơn thành success
                cursor.execute("UPDATE orders SET payment_status = 'success' WHERE id = ?", (order_id,))
                conn.commit()

                msg = "Đã cập nhật trạng thái đơn sang success"
                if stock_deducted:
                    msg += " và đã trừ 1 tồn kho của sản phẩm physical"
                else:
                    msg += " (sản phẩm service/digital không trừ tồn kho)"

                return self.send_json({"success": True, "message": msg, "stock_deducted": stock_deducted})

            # --- POST /api/orders ---
            elif path == "/api/orders":
                order_code = (body.get("order_code") or "").strip().upper()
                customer_id = body.get("customer_id")
                product_id = body.get("product_id")
                amount = float(body.get("amount") or 0)
                payment_status = (body.get("payment_status") or "pending").strip().lower()
                bank_transaction_id = (body.get("bank_transaction_id") or "").strip()

                if not order_code:
                    return self.send_json({"success": False, "message": "Mã đơn hàng không được trống"}, status=400)

                # Nếu tạo đơn với trạng thái success ngay từ đầu và là physical, trừ tồn kho
                stock_deducted = False
                if payment_status == "success" and product_id:
                    cursor.execute("SELECT type FROM products WHERE id = ?", (product_id,))
                    p = cursor.fetchone()
                    if p and p["type"] == "physical":
                        cursor.execute("UPDATE products SET stock = MAX(0, stock - 1) WHERE id = ?", (product_id,))
                        stock_deducted = True

                cursor.execute(
                    """
                    INSERT INTO orders (order_code, customer_id, product_id, amount, payment_status, bank_transaction_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (order_code, customer_id, product_id, amount, payment_status, bank_transaction_id)
                )
                conn.commit()
                new_id = cursor.lastrowid
                return self.send_json({
                    "success": True,
                    "id": new_id,
                    "message": "Tạo đơn hàng thành công",
                    "stock_deducted": stock_deducted
                }, status=201)

            else:
                return self.send_json({"success": False, "message": "Endpoint not found"}, status=404)

        except sqlite3.IntegrityError as e:
            return self.send_json({"success": False, "message": f"Dữ liệu không hợp lệ hoặc mã đơn đã tồn tại: {e}"}, status=400)
        except Exception as e:
            return self.send_json({"success": False, "error": str(e)}, status=500)
        finally:
            conn.close()

    # =========================================================================
    # API: PUT
    # =========================================================================
    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")

        if not path.startswith("/api/"):
            return self.send_json({"success": False, "message": "Invalid API path"}, status=404)

        try:
            body = self.read_json_body()
        except Exception as e:
            return self.send_json({"success": False, "message": f"Malformed JSON: {e}"}, status=400)

        parts = path.split("/")
        if len(parts) != 4:
            return self.send_json({"success": False, "message": "ID required"}, status=400)

        resource = parts[2]
        try:
            item_id = int(parts[3])
        except ValueError:
            return self.send_json({"success": False, "message": "Invalid ID"}, status=400)

        conn = get_db()
        cursor = conn.cursor()

        try:
            if resource == "products":
                name = (body.get("name") or "").strip()
                ptype = (body.get("type") or "service").strip().lower()
                price = float(body.get("price") or 0)
                stock = int(body.get("stock") or 0)

                if not name:
                    return self.send_json({"success": False, "message": "Tên sản phẩm không được trống"}, status=400)

                cursor.execute(
                    "UPDATE products SET name = ?, type = ?, price = ?, stock = ? WHERE id = ?",
                    (name, ptype, price, stock, item_id)
                )
                conn.commit()
                return self.send_json({"success": True, "message": "Cập nhật sản phẩm thành công"})

            elif resource == "customers":
                name = (body.get("name") or "").strip()
                phone = (body.get("phone") or "").strip()
                email = (body.get("email") or "").strip()

                if not name:
                    return self.send_json({"success": False, "message": "Tên khách hàng không được trống"}, status=400)

                cursor.execute(
                    "UPDATE customers SET name = ?, phone = ?, email = ? WHERE id = ?",
                    (name, phone, email, item_id)
                )
                conn.commit()
                return self.send_json({"success": True, "message": "Cập nhật khách hàng thành công"})

            elif resource == "orders":
                # Kiểm tra trạng thái cũ để xử lý trừ kho nếu chuyển sang success
                cursor.execute("SELECT payment_status, product_id FROM orders WHERE id = ?", (item_id,))
                existing_order = cursor.fetchone()
                if not existing_order:
                    return self.send_json({"success": False, "message": "Không tìm thấy đơn hàng"}, status=404)

                old_status = (existing_order["payment_status"] or "").lower()
                new_status = (body.get("payment_status") or old_status).strip().lower()
                product_id = body.get("product_id") or existing_order["product_id"]

                # Nếu chuyển từ pending sang success lần đầu, trừ tồn kho với physical
                if old_status != "success" and new_status == "success" and product_id:
                    cursor.execute("SELECT type FROM products WHERE id = ?", (product_id,))
                    p = cursor.fetchone()
                    if p and p["type"] == "physical":
                        cursor.execute("UPDATE products SET stock = MAX(0, stock - 1) WHERE id = ?", (product_id,))

                cursor.execute(
                    """
                    UPDATE orders
                    SET customer_id = ?, product_id = ?, amount = ?, payment_status = ?, bank_transaction_id = ?
                    WHERE id = ?
                    """,
                    (
                        body.get("customer_id"),
                        product_id,
                        float(body.get("amount") or 0),
                        new_status,
                        (body.get("bank_transaction_id") or "").strip(),
                        item_id
                    )
                )
                conn.commit()
                return self.send_json({"success": True, "message": "Cập nhật đơn hàng thành công"})

            else:
                return self.send_json({"success": False, "message": "Resource not supported"}, status=404)

        except Exception as e:
            return self.send_json({"success": False, "error": str(e)}, status=500)
        finally:
            conn.close()

    # =========================================================================
    # API: DELETE
    # =========================================================================
    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")

        parts = path.split("/")
        if len(parts) != 4 or not path.startswith("/api/"):
            return self.send_json({"success": False, "message": "Invalid DELETE path"}, status=400)

        resource = parts[2]
        try:
            item_id = int(parts[3])
        except ValueError:
            return self.send_json({"success": False, "message": "Invalid ID"}, status=400)

        conn = get_db()
        cursor = conn.cursor()

        try:
            if resource in ("products", "customers", "orders"):
                cursor.execute(f"DELETE FROM {resource} WHERE id = ?", (item_id,))
                conn.commit()
                return self.send_json({"success": True, "message": f"Đã xóa khỏi {resource}"})
            else:
                return self.send_json({"success": False, "message": "Resource not supported"}, status=404)
        except Exception as e:
            return self.send_json({"success": False, "error": str(e)}, status=500)
        finally:
            conn.close()


def run_server(port=PORT):
    server_address = ("127.0.0.1", port)
    httpd = HTTPServer(server_address, CRMHandler)
    print(f"ICUS Server is running at http://127.0.0.1:{port}/")
    print(f"Website: http://127.0.0.1:{port}/")
    print(f"CRM Admin: http://127.0.0.1:{port}/admin")
    print(f"SePay Webhook Proxy: http://127.0.0.1:{port}/api/sepay-webhook")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
