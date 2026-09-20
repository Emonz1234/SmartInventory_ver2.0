# Vận hành và kiểm thử

## 1. Server

Copy `Server/.env.example` thành `Server/.env`, đặt secret Django ngẫu nhiên, database
PostgreSQL và credential MQTT. Django đọc file này. PostgreSQL 12 không tương thích
Django 5.2; không dùng database có sẵn chưa được xác nhận là dành cho dự án.

```powershell
.venv/Scripts/python Server/manage.py migrate
.venv/Scripts/python Server/manage.py createsuperuser
.venv/Scripts/python Server/manage.py runserver 127.0.0.1:8001
```

Terminal khác: `.venv/Scripts/python Server/manage.py mqtt_worker` (một worker).
UI: `cd Server/frontend`, `npm ci`, `npm run dev` -> http://127.0.0.1:3100.
API/UI dùng session Django + CSRF. Tạo nhóm/permission bằng Django auth admin;
người vận hành cần view_device/view_stock/view_operation/add_operation;
người xác nhận cần change_operation. Superuser dùng để cấu hình ban đầu.

UI: tạo item -> cabinet (domain) -> rack (Serial address) -> shelf -> bin;
đăng ký device (lưu secret trả về một lần), provision MQTT password và phân công.
Mỗi Serial address chỉ thuộc một rack trong cùng device. Một group là metadata
của cabinet; gán nhiều cabinet cùng group cho device theo nhu cầu.

## 2. MQTT

`deploy/mosquitto.conf` và `deploy/acl` là cấu hình production mẫu. Tạo TLS cert,
private key, CA và password file trong `deploy/secrets/` (gitignored). Username
Server là `inventory-server`, username edge bằng đúng device_id; cấm dùng tài khoản
Server cho edge. `mosquitto_passwd` tạo credential, không gửi password qua chat/log.
`docker compose -f deploy/compose.yaml up -d` chạy PostgreSQL/Mosquitto sau khi
provision file secrets. Compose không tự phát hành certificate/credential.

Deploy web production sau reverse proxy HTTPS; serve UI build và `/api` cùng origin.
Dùng WSGI server (ví dụ Waitress trên Windows) cho `Server.wsgi:application` thay
runserver. Cấu hình ALLOWED_HOSTS, HTTPS/session cookies và backup PostgreSQL.

## 3. Edge instance

Copy file mẫu vào `IPC/.env` hoặc `IPCSIM/.env`, đặt identity đúng registry,
DB_PATH mới, token API, Serial port, MQTT host/password, DEVICE_SECRET và CA.
Chạy từ thư mục instance để `.env` được đọc:

```powershell
cd IPCSIM
../.venv/Scripts/python -m uvicorn main:app --host 127.0.0.1 --port 8000
# Instance phần cứng: cd IPC; cùng lệnh, port API khác nếu cùng máy.
```

Không dùng `--workers` nhiều process: một instance chỉ có một chủ sở hữu Serial.
Nếu chạy hai instance cùng máy, DB_PATH và port API/Serial phải riêng.
IPCSIM/frontend: `npm ci; npm run dev`, nhập EDGE_API_TOKEN. Có thể cấu hình
VITE_EDGE_API_URL và VITE_SERVER_UI_URL cho màn hình theo dõi và link Control Center.
Các endpoint đọc vẫn chạy offline. Mutation qua Server; token edge không cấp quyền
thay đổi master/inventory. Để SERIAL_PORT trống khi chỉ kiểm tra API/MQTT.

Simulation: install `Simulation/requirements.txt`, then run
`.venv/Scripts/python Simulation/main.py` from the repository root. Select a Serial
port per group, or use the explicitly labeled Standalone mode without IPC.
Configuration, lifecycle, chart policy and validation:
[Simulation dashboard](simulation-dashboard.md).

## 4. Inventory

Đợi device online và revision == acknowledged_revision. Tạo PUT/PICK/ADJUST hoặc
OPEN/CLOSE/VENTILATE/LIGHT ở UI Server. Chờ result `sent`/`uncertain`; kiểm tra tình
trạng rack và lượng hàng thực tế, ghi evidence rồi xác nhận. `sent` không khẳng định
hardware đã hoàn tất. Hủy bằng kết quả không thực hiện chỉ sau khi đã đối chiếu.
Không tạo lệnh mới để thử lại operation uncertain. Reconnect sẽ trả trạng thái lệnh
cũ; operator phải giải quyết trước khi device nhận operation mới.

## 5. Backup/migration

```powershell
.venv/Scripts/python tools/backup_legacy.py IPCSIM/data/ipc.db backups/manual.sqlite3
.venv/Scripts/python Server/manage.py import_legacy IPCSIM/data/ipc.db --domain IPCSIM --prefix legacy-
# Sau khi kiểm tra report, thêm --apply để import vào Server đích.
```

Mỗi lệnh import tạo backup mới, check integrity và row counts. Dry run là mặc định.
Nếu rack_code là nhãn như `R-1`, dùng `--rack-address-map addresses.json`, một JSON
object `{"<legacy rack id>": <Serial address>}` đã đối chiếu với giao thức đang dùng.
Database hiện có chỉ khác tại rack 1: code `R-1`, còn lệnh mở/đóng cũ dùng ID 1.
Mapping đã kiểm chứng khi import vào database test nằm trong
`backups/legacy-rack-address-map.json`; cần kiểm tra lại trước dùng với hardware.

Import dùng một transaction, mapping ID mới, cabinet chưa phân công, giữ toàn bộ
rows cũ trong LegacyImport.archive. Không replay 39 transaction cũ. Prefix tránh
đụng catalog hiện có; nội dung trùng đã import không ghi lại. Không import cùng dữ
liệu mô phỏng vào domain IPC. Non-numeric rack_code cần mapping explicit trước import.
Sau import, kiểm tra số lượng, tạo device và assign; edge mới nhận full snapshot.

## 6. Recovery

* MQTT mất mạng: journal/outbox giữ lại; reconnect yêu cầu full snapshot.
* Gap/checksum lỗi: cache cũ giữ nguyên; request full với sync_id mới.
* Crash apply: SQLite rollback cả projection/revision/ACK. Restart nhận lại batch.
* Crash quanh Serial write: journal uncertain; không replay lệnh vật lý.
* DB hỏng: dừng instance; giữ bản gốc/WAL, restore backup đã kiểm tra. Không xóa
  database rồi chạy lại khi còn pending operations: mất journal có thể tạo replay.
* Reassignment: giải quyết pending operations, đổi assignment, full snapshot thu hồi
  cache cũ. Offline device không có lease để chạy lệnh mới.
* Theo dõi dung lượng: runtime, receipts, outbox đã ACK và staging được giữ để audit.
  Chưa bật retention tự động; lưu trữ/backup trước khi chủ động dọn dữ liệu.

## 7. Tests

```powershell
.venv/Scripts/python -m pytest tests -q
$env:SERVER_TEST_SQLITE='1'
.venv/Scripts/python Server/manage.py test Server.inventory
npm install --prefix .tools/mqtt aedes@0.51.3 --no-audit --no-fund
$env:MQTT_INTEGRATION='1'
.venv/Scripts/python Server/manage.py test Server.inventory
```

Để chạy PostgreSQL: bỏ SERVER_TEST_SQLITE, đặt POSTGRES_* cho cluster test riêng;
Django tạo và xóa database `test_<POSTGRES_DB>`. Tài khoản test cần CREATEDB.
Integration test mở broker local tại port tự chọn và ba edge database tạm; không
kết nối COM/hardware thật. Aedes chỉ là dependency test, không dùng production.

Nếu đổi tài khoản Windows/sandbox khiến pytest cache cũ không truy cập được, dùng
`-p no:cacheprovider --basetemp .tools/pytest-<tên-mới>` để tạo thư mục test riêng;
không cần sửa ACL hoặc xóa temp của tài khoản khác.

UI smoke: cài `npm install --prefix .tools/ui playwright`, chạy Server test riêng
và Vite, rồi `node tests/ui_smoke.cjs`. `tools/ui_test_server.py` tạo database
`ui_test_*` trên cluster test 127.0.0.1:55440; không dùng với database production.
