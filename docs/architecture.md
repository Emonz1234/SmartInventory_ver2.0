# Audit và kiến trúc

## Code ban đầu đã kiểm tra

Server trống. IPC là prototype console/Flask, JSON Serial, state trong RAM;
IPCSIM có FastAPI/SQLAlchemy/SQLite và React. Router đang gắn: cabinet, inventory,
bins, telemetry, dashboard. Auth, sync, scheduler và nhiều service là file rỗng.
Frontend dùng user giả và thông tin hệ thống tĩnh. Giao dịch PUT/PICK cập nhật
stock ngay sau gửi Serial, dùng các commit riêng; gửi Serial có thể thất bại im
lặng. Health luôn báo synchronized. Database không có migration history.

Simulation là PyQt, gửi ENVSTT/OPRSTT/BRKSTT, nhận `0|rack|action`; IPC prototype
nhận/gửi JSON. Firmware ESP32 không có trong repository, không được giả định đã
hỗ trợ command_id. ACK/endpoint không chứng minh người vận hành đã nhập/xuất hàng.

Backup nguồn `IPCSIM/data/ipc.db` tại `backups/ipcsim-baseline.sqlite3`:
21 cabinets, 126 racks, 5 items, 3 bins, 5 item_locations, 39 transactions,
2413 environment, 899 operation, 81 breakdown snapshots. Integrity: ok.
Nguồn không bị xóa hoặc chuyển đổi tại chỗ. `plan.md` gốc được giữ nguyên.

## Cấu trúc

| Thư mục | Trách nhiệm |
|---|---|
| Server | Django/PostgreSQL, registry, master, stock, ledger, REST, MQTT worker, React |
| ipc_core | FastAPI chung, SQLite, sync, journal, outbox, Serial adapters |
| IPC / IPCSIM | Launcher và cấu hình runtime độc lập |
| IPCSIM/frontend | Màn hình theo dõi edge hiện có; token thật, link sang Server |
| Simulation | PyQt simulator và giao thức cũ |
| legacy/physical_prototype | Code IPC cũ lưu đối chiếu; không còn là backend đang duy trì |
| tests / tools / deploy | Failure tests, backup/import, broker và PostgreSQL |

## Ownership và schema

Server là nguồn chính thức cho danh mục item, cabinet/rack/shelf/bin, phân công,
user/permission, stock, operation, ledger. Cabinet có domain IPC hoặc IPCSIM;
chỉ gán cho device cùng domain. Mỗi stock gắn bin -> cabinet -> domain. Catalog
item có thể dùng chung; tồn kho luôn cách ly. Serial address khác database ID.

Device giữ snapshot đã materialize, revision tăng đơn điệu và revision ACK.
Writer khóa device theo thứ tự ID trước khi ghi master/stock và tạo snapshot.
Outbox cùng transaction với thay đổi dữ liệu. Nhập liệu qua service/REST; Django
admin chỉ đọc dữ liệu nghiệp vụ để tránh bypass revision và ledger.

Edge SQLite gồm bảng read model cũ, migration history, `edge_identity`,
`edge_revision`, `edge_records`, `edge_staging`, `edge_outbox`, `edge_operations`,
`edge_runtime`. Identity ngăn hai thiết bị dùng chung database. Runtime/pending
không bị xóa khi full sync. Không có seed lúc startup. Edge không nhận credential
PostgreSQL hoặc password user trung tâm.

## MQTT v1

Topic: `inventory/v1/{device_id}/{up|down}/{sync|command|ack|telemetry|events|status}`.
Envelope: protocol_version, message_id, device_id, device_type, message_type,
timestamp UTC có timezone, payload; metadata sync_id, dataset_id, revision,
command_id, correlation_id tùy loại. Payload JSON canonical, ký HMAC-SHA256 riêng
cho mỗi thiết bị. Broker dùng tài khoản riêng, username=device_id, ACL theo `%u`;
Server kiểm tra thêm chữ ký, topic, registry type, enabled và dataset. Không tin
device_type tự khai báo. TLS mặc định bật; secret cấp ngoài MQTT.

Full sync: snapshot cố định ở revision, batch 200 records, staging bền vững,
checksum tổng, apply read model + revision + application ACK trong một transaction.
Delta: upsert/tombstone, base_revision và checksum. Gap yêu cầu full; duplicate
không ghi lại; stale không đè cache mới. Reassignment tạo full mới để thu hồi scope.
QoS 1 không thay application ACK; persistent outbox giữ cùng message ID đến ACK.

Online lease dựa heartbeat mới và phản hồi Server, giới hạn 35 giây. Khi không có
Server lease, edge không nhận lệnh mới. Telemetry vẫn ghi local và gửi lại sau reconnect.

## Operation và giả định nghiệp vụ

Server tạo UUID operation/command, kiểm tra lease, revision ACK, scope, stock;
ghi operation + outbox. Một operation chưa giải quyết trên mỗi device để tránh
đồng thời trên giao thức Serial không có correlation. Edge ghi `uncertain` trước
Serial; ghi `sent` sau write. Crash/partial write không tự gửi lại. Duplicate trả
state đã lưu. Hết hạn thì không chạy lệnh lần đầu, nhưng luôn trả state cũ nếu
lệnh đã được nhận trước đó.

`sent` chỉ là đã gửi Serial, không phải hardware success. Người có permission
Server xác nhận kết quả thực tế và ghi ghi chú. Transaction duy nhất khóa stock,
ghi ledger OneToOne với operation, cập nhật stock và refresh snapshot. Mô phỏng
không ghi vào stock domain IPC. Không tự suy luận PUT/PICK từ endpoint telemetry.

## API và tính tương thích

Giữ read API FastAPI: cabinet/rack, bins, items/inventory, environment, operation,
breakdown, dashboard. Import `IPCSIM/app` là shim sang shared core. API mutation
edge cũ trả 409 kèm hướng dẫn dùng Server; GET open/close cũng bị chặn. Đây là thay
đổi hợp đồng có chủ ý để thực hiện yêu cầu Server ownership/online-only. UI Server
cung cấp các luồng thay thế, không trả thành công giả cho client cũ.

Các endpoint Flask `/api/racks`, `/api/rack/{address}`, `/api/history/{address}`,
`/api/summary`, `/health` hiện đọc shared SQLite và yêu cầu token như các endpoint
edge khác. Giao diện Flask cũ lưu trong legacy; UI theo dõi dùng React hiện có.

## Tài liệu tham chiếu

[Django transactions](https://docs.djangoproject.com/en/5.2/topics/db/transactions/),
[Paho manual ACK](https://eclipse.dev/paho/files/paho.mqtt.python/html/client.html),
[Aedes test broker](https://github.com/moscajs/aedes).
