# Tiến độ theo phase

> Nhật ký các phase trước. Kết quả kiểm thử và thay đổi React/bootstrap mới nhất
> được ghi tại [system-audit](system-audit.md) và [react-bootstrap](react-bootstrap.md).

## Phase 1 — audit và thiết kế

Thêm `docs/architecture.md`, ghi nhận các module rỗng, hai Serial protocol, các API
thực sự mount, lỗi ownership/ACK cũ; giữ `plan.md` gốc. Backup và integrity check
database IPCSIM thành công; row counts ghi trong manifest backup.

## Phase 2 — shared core và Serial

Chuyển `IPCSIM/app` sang `ipc_core/app`; thêm shim import cũ. IPC/IPCSIM main dùng
chung application. Archive physical prototype. Thêm hardware JSON và simulation
pipe adapters, journal/identity riêng mỗi database, migration history, cấu hình
environment, lifecycle shutdown/reconnect, đọc Serial ngoài event loop. Giữ
telemetry/gas/breakdown/history/read APIs; chuyển mutation sang Server.

Kiểm thử: shared launcher/API, parser cũ, actual simulator open/close/environment/
breakdown, độc lập database và identity. Chưa chạy ESP32 hoặc cặp COM thật.

## Phase 3 — Server và React

Thêm Django settings/migrations, registry/assignment, catalog/topology, stock,
operation/ledger, auth session/CSRF và permission. React Control Center có login,
registry, assignment, master forms, inventory theo domain, command/confirmation,
runtime và ledger. Frontend IPCSIM có token login, cấu hình API và link Server.
Hai frontend build được; bundle IPCSIM cũ lớn (~957 kB trước gzip), không chặn build.

## Phase 4 — MQTT

Thêm signed envelope v1, ACL deployment, MQTT worker, shared edge client, lease và
persistent outboxes. Identity được kiểm tra bằng registry, chữ ký và topic. Kiểm
thử qua Aedes broker TCP với ba device. Mosquitto TLS config đã cung cấp nhưng
chưa chạy production certificate/ACL end-to-end trên Mosquitto.

## Phase 5 — Sync

Full snapshot materialized, batches/checksum/staging/atomic projection, delta với
base revision và tombstones, duplicate/stale/gap, reconnect/full recovery, ACK sau
commit. Tests gồm rollback và kill process giữa apply rồi mở lại SQLite. Scope
reassignment bị chặn khi còn operation; full snapshot thu hồi dữ liệu cũ.

## Phase 6 — Inventory/hardware

Server tạo operation và outbox cùng transaction. Edge ghi intent trước Serial;
duplicate hoặc crash không tự chạy lại. Breakdown interlock giữ lại. Explicit
operator confirmation vì protocol hiện tại không xác nhận lượng hàng. PostgreSQL
row locks + OneToOne ledger chống ghi trùng; test concurrent confirmation đạt.
Hardware command result là `sent`/`uncertain`/`expired`, không giả hardware success.
Sau xác nhận, Server gửi `command.finalize`; edge ghi trạng thái cuối trước
`ack.command`. Journal giữ lại tombstone để lệnh cũ không chạy lại sau hoàn tất.

## Phase 7 — migration, tests và vận hành

Backup/import CLI có dry run, atomic apply, namespace prefix, content dedup và
archive đầy đủ history; không đụng database nguồn và không replay transactions.
Thêm PostgreSQL/Mosquitto Compose, env examples, recovery và launch runbook.

Kết quả đã chạy:

* `pytest tests IPCSIM/tests`: 18 passed (gồm repair read model tại cùng revision).
* Django trên PostgreSQL 16.13 + broker integration: 11 passed (có concurrent test).
* Django system check và makemigrations --check: sạch.
* Server frontend build và IPCSIM frontend build: thành công.
* Chrome headless: login/CSRF, đăng ký device, tạo item, desktop/mobile, không có
  lỗi JavaScript. Ảnh kiểm tra lưu ở `test-results/`.
* Đã import thử database IPCSIM thực vào PostgreSQL test riêng: 21 tủ, 126 rack,
  stock/master giữ đủ; 39 transaction cũ nằm trong archive. Rack 1 có nhãn `R-1`,
  nên bổ sung CLI `--rack-address-map`; mapping theo địa chỉ ID mà code Serial cũ
  sử dụng. Nguồn SQLite giữ nguyên checksum qua các bản backup.

Giới hạn triển khai thực tế:

* Chưa có firmware ESP32 trong repo; chưa kiểm thử COM vật lý/ESP32 toàn luồng.
  Simulation GUI đã được kiểm thử bằng Qt offscreen, SerialWire và pyserial loopback;
  xem [dashboard và kiểm thử](simulation-dashboard.md).
* Chưa provision broker account/TLS hoặc cấu hình thiết bị production.
* Database cũ được backup; không import vào database production chưa xác định.
* Retention runtime/receipts/outbox chưa tự dọn; cần policy lưu trữ theo vận hành.
* Edge mutation API cũ trả 409; client ghi dữ liệu phải chuyển sang Server. Các
  endpoint không được triển khai từ trước (maintenance/auth local...) không được
  trình bày là tính năng đã hoạt động.
