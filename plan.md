# Smart Inventory System - Database Synchronization Plan

## 1. Mục tiêu

Chuyển kiến trúc từ trạng thái hiện tại:

```text
IPCSIM -> SQLite local
Simulation/Hardware -> Serial -> IPCSIM
```

sang kiến trúc đích:

```text
Server PostgreSQL
    = Source of Truth
          |
         MQTT
          |
IPC MQTT Client -> Sync Service -> IPC SQLite local database
                                      |
                                    Serial
                                      |
                                  Hardware
```

Mục tiêu chính:

- Server PostgreSQL quản lý master data và inventory.
- IPC giữ SQLite local để hoạt động offline và làm read model.
- MQTT chỉ là transport; business logic đồng bộ nằm trong Sync Service.
- Đồng bộ phải transaction-safe, idempotent và có thể phục hồi sau reconnect.
- Phạm vi phù hợp với đồ án: dễ hiểu, dễ debug, không dùng Kafka, Redis, event sourcing hoặc distributed transaction.

---

## 2. Hiện trạng code

### 2.1. Nhánh `IPC/`

Nhánh [`IPC/`](IPC) hiện không có database.

- [`IPC/serial_client/esp32_serial.py`](IPC/serial_client/esp32_serial.py) đọc dữ liệu serial.
- [`IPC/services/rack_manager.py`](IPC/services/rack_manager.py) giữ rack state trong RAM.
- [`IPC/models/rack_state.py`](IPC/models/rack_state.py) chứa nhiệt độ, độ ẩm, gas, smoke, vị trí và history.
- History dùng `deque(maxlen=50)` và mất khi process restart.
- Không có SQLAlchemy, SQLite, repository, migration hoặc MQTT.

Luồng hiện tại:

```text
ESP32 / Hardware
    ↓ Serial
ESP32SerialClient
    ↓
RackManager
    ↓
RackState trong RAM
    ↓
Console hoặc Flask API
```

### 2.2. Nhánh `IPCSIM/`

`IPCSIM` là backend FastAPI có database local.

- Engine: SQLite.
- ORM: SQLAlchemy.
- Database file: `IPCSIM/data/ipc.db`.
- Cấu hình tại [`IPCSIM/app/core/config.py`](IPCSIM/app/core/config.py).
- Engine/session tại [`IPCSIM/app/database/database.py`](IPCSIM/app/database/database.py).
- Startup tại [`IPCSIM/app/startup.py`](IPCSIM/app/startup.py).
- FastAPI lifespan tại [`IPCSIM/main.py`](IPCSIM/main.py).

Khởi tạo database:

```text
IPCSIM/main.py
    ↓
FastAPI lifespan
    ↓
initialize_database()
    ↓
ensure_schema()
    ↓
Base.metadata.create_all()
```

Database dùng SQLite WAL, `busy_timeout=30000` và `check_same_thread=False`.

Hiện chưa có Alembic hoặc migration history. `ensure_schema()` chỉ có một số `ALTER TABLE` thủ công cho `environment_snapshots`.

### 2.3. Các bảng runtime hiện có

#### Master/inventory data

- `cabinets`: `id`, `cabinet_code`, `cabinet_name`, `status`.
- `racks`: `id`, `cabinet_id`, `rack_code`, `rack_name`.
- `shelves`: `id`, `rack_id`, `shelf_code`, `shelf_name`, `level_no`.
- `bins`: `id`, `shelf_id`, `bin_code`, `bin_name`, `capacity`.
- `items`: `id`, `item_code`, `item_name`, `unit`, `min_qty`, `max_qty`.
- `item_locations`: `id`, `item_id`, `bin_id`, `quantity`, `updated_at`.
- `inventory_transactions`: `id`, `item_id`, `transaction_type`, `quantity`, `reference_no`, `user_id`, `created_at`.

Quan hệ hiện tại:

```text
Cabinet 1 -> N Rack
Rack 1 -> N Shelf
Shelf 1 -> N Bin
Item N <-> N Bin thông qua ItemLocation
Item 1 -> N InventoryTransaction
```

Các model nằm tại [`IPCSIM/app/database/models/inventory.py`](IPCSIM/app/database/models/inventory.py).

#### System/auth data

- `users`: `id`, `username`, `password_hash`, `full_name`, `is_active`.
- `devices`: `id`, `device_code`, `device_name`, `serial_port`, `status`.

Các model nằm tại:

- [`IPCSIM/app/database/models/auth.py`](IPCSIM/app/database/models/auth.py)
- [`IPCSIM/app/database/models/system.py`](IPCSIM/app/database/models/system.py)

#### Runtime state

- `environment_snapshots`: sensor telemetry theo rack.
- `operation_snapshots`: trạng thái chuyển động rack.
- `breakdown_snapshots`: trạng thái lỗi rack.

Các model nằm tại:

- [`IPCSIM/app/database/models/environment.py`](IPCSIM/app/database/models/environment.py)
- [`IPCSIM/app/database/models/runtime.py`](IPCSIM/app/database/models/runtime.py)

Runtime snapshot hiện được ghi append-only bởi:

- [`IPCSIM/app/serial/handlers/telemetry_handler.py`](IPCSIM/app/serial/handlers/telemetry_handler.py)
- [`IPCSIM/app/serial/handlers/event_handler.py`](IPCSIM/app/serial/handlers/event_handler.py)

### 2.4. Dữ liệu đang tạo thủ công

- [`IPCSIM/scripts/seed_cabinets.py`](IPCSIM/scripts/seed_cabinets.py) tạo 21 cabinet, mỗi cabinet 6 rack.
- [`IPCSIM/scripts/seed_items_inventory.py`](IPCSIM/scripts/seed_items_inventory.py) tạo item, bin và stock mẫu.
- `LocationRepository.get_default_shelf()` tự tạo cabinet/rack/shelf mặc định nếu thiếu.
- `ensure_schema()` thực hiện thay đổi schema bằng `ALTER TABLE` thủ công.
- [`IPCSIM/data/IPC_db.sql`](IPCSIM/data/IPC_db.sql) và [`IPCSIM/data/IPC_db_SQLite.sql`](IPCSIM/data/IPC_db_SQLite.sql) là schema draft cũ, không phải runtime migration.

### 2.5. MQTT hiện tại

Hiện chưa có MQTT implementation.

Các module sau đang là placeholder hoặc rỗng:

- [`IPCSIM/app/api/sync.py`](IPCSIM/app/api/sync.py)
- [`IPCSIM/app/services/sync/sync_service.py`](IPCSIM/app/services/sync/sync_service.py)
- [`IPCSIM/app/database/models/communication.py`](IPCSIM/app/database/models/communication.py)
- [`IPCSIM/app/schemas/communication.py`](IPCSIM/app/schemas/communication.py)

Chưa có:

- MQTT client.
- Broker configuration.
- Publish/subscribe.
- QoS hoặc retained message.
- Revision tracking.
- Sync request/response/ACK.

`server_synced` trong [`IPCSIM/main.py`](IPCSIM/main.py) hiện đang trả cứng `True`, không phải trạng thái đồng bộ thực tế.

---

## 3. Phân loại ownership dữ liệu

| Dữ liệu | Source of Truth | IPC local | Hướng đồng bộ | IPC được sửa? |
|---|---|---:|---|---|
| Cabinet/rack/shelf/bin | Server | Read model | Server -> IPC | Không |
| Item catalog | Server | Read model | Server -> IPC | Không |
| Min/max quantity | Server | Read model | Server -> IPC | Không |
| Inventory quantity | Server | Cache/read model | Server -> IPC | Không trực tiếp |
| Pick/put request | Server nghiệp vụ | Queue/event nếu cần | IPC -> Server | Chỉ gửi request |
| User/role/permission | Server | Cache tối thiểu | Server -> IPC | Không |
| Serial/device config | Server | Applied local config | Server -> IPC | Không |
| Environment telemetry | IPC/hardware | Có | IPC -> Server tùy nhu cầu | Có |
| Operation state | IPC/hardware | Có | IPC -> Server tùy nhu cầu | Có |
| Breakdown state | IPC/hardware | Có | IPC -> Server tùy nhu cầu | Có |
| Sync metadata | IPC | Có | MQTT protocol | Có |
| MQTT connection state | IPC | Có | Không cần sync | Có |

Nguyên tắc: IPC không tự thay đổi master data hoặc inventory rồi coi đó là kết quả cuối cùng. Mọi thay đổi nghiệp vụ cần được Server xác nhận hoặc quản lý.

---

## 4. Kiến trúc database đích

### 4.1. IPC nên giữ SQLite local

Khuyến nghị giữ SQLite local dưới dạng:

1. **Materialized configuration/read model** cho cabinet, rack, shelf, bin, item và mapping cần thiết.
2. **Runtime store** cho telemetry, operation và breakdown.
3. **Sync state store** cho revision, trạng thái đồng bộ và lỗi gần nhất.

Không nên giữ một bản sao đầy đủ có quyền ghi độc lập cho toàn bộ nghiệp vụ Server.

### 4.2. Bảng nên giữ

- `cabinets`
- `racks`
- `shelves`
- `bins`
- `items`
- `item_locations` hoặc một read model inventory tương đương
- `environment_snapshots`
- `operation_snapshots`
- `breakdown_snapshots`
- `devices` nếu IPC cần cấu hình local

### 4.3. Bảng cần thêm

```text
sync_metadata
-------------
id
ipc_id
schema_version
server_revision
local_revision
last_sync_at
sync_status
last_error
```

Có thể thêm bảng chống duplicate trong phase sau:

```text
processed_sync_messages
-----------------------
message_id PRIMARY KEY
sync_id
revision
processed_at
```

Ở phase đầu, có thể chỉ dùng revision monotonic và upsert idempotent để giảm độ phức tạp.

### 4.4. Bảng không nên là source of truth tại IPC

- Master data.
- User/role/permission.
- Inventory quantity chính thức.
- Configuration chính thức.

Các bảng này chỉ là local read model/cache nếu IPC cần đọc khi offline.

---

## 5. Synchronization design

### 5.1. Revision

Dùng một `server_revision` tăng dần trên Server cho dataset configuration.

Ví dụ:

```text
revision 101: CREATE cabinet
revision 102: UPDATE rack
revision 103: DELETE bin
```

IPC lưu `local_revision` hoặc `last_applied_revision`.

Không cần version độc lập cho từng column ở giai đoạn đầu.

### 5.2. Full synchronization

Dùng trong các trường hợp:

- IPC mới cài đặt.
- Local database chưa có dữ liệu.
- Local database mất hoặc corrupt.
- Revision bị thiếu.
- Schema không tương thích.
- Server không còn giữ incremental history cần thiết.

Flow:

```text
IPC connect MQTT
    ↓
IPC gửi SYNC_REQUEST(local_revision=0 hoặc revision hiện tại)
    ↓
Server tạo sync_id
    ↓
Server gửi FULL_SYNC_BEGIN
    ↓
Server gửi dữ liệu theo batch
    ↓
IPC validate toàn bộ payload
    ↓
IPC BEGIN TRANSACTION
    ↓
Replace/upsert local data
    ↓
Update sync_metadata
    ↓
COMMIT
    ↓
IPC gửi SYNC_ACK
```

Không xóa dữ liệu cũ trước khi payload được validate.

### 5.3. Incremental synchronization

Trong trạng thái bình thường:

```text
IPC local_revision = 100
Server có revision 101..105
    ↓
Server gửi các thay đổi 101..105
    ↓
IPC kiểm tra thứ tự
    ↓
Apply từng revision trong transaction
    ↓
local_revision = 105
```

Nếu IPC nhận revision 103 khi đang ở 100:

- Không apply ngay.
- Gửi lại `SYNC_REQUEST(local_revision=100)`.
- Server gửi missing revisions hoặc yêu cầu full sync.

### 5.4. Quy tắc kết hợp

```text
First installation       -> Full Sync
Normal operation         -> Incremental Sync
Revision gap             -> Incremental retry hoặc Full Sync
Database corruption      -> Full Sync
Schema incompatibility   -> Migration rồi Full Sync
```

---

## 6. MQTT protocol đề xuất

Hiện chưa có protocol MQTT trong code. Topic đề xuất:

```text
smartinventory/v1/ipc/{ipc_id}/sync/request
smartinventory/v1/ipc/{ipc_id}/sync/response
smartinventory/v1/ipc/{ipc_id}/sync/ack
smartinventory/v1/ipc/{ipc_id}/sync/error
smartinventory/v1/ipc/{ipc_id}/runtime/event
smartinventory/v1/ipc/{ipc_id}/command
smartinventory/v1/ipc/{ipc_id}/command/ack
```

### 6.1. SYNC_REQUEST

```json
{
  "message_id": "uuid",
  "ipc_id": "ipc-001",
  "type": "SYNC_REQUEST",
  "local_revision": 100,
  "schema_version": 1,
  "requested_at": "2026-09-19T10:00:00Z"
}
```

### 6.2. FULL_SYNC_BEGIN

```json
{
  "message_id": "uuid",
  "sync_id": "uuid",
  "type": "FULL_SYNC_BEGIN",
  "target_revision": 120,
  "schema_version": 1,
  "entities": ["cabinet", "rack", "shelf", "bin", "item", "item_location"]
}
```

### 6.3. SYNC_UPDATE

```json
{
  "message_id": "uuid",
  "sync_id": "uuid",
  "type": "SYNC_UPDATE",
  "revision": 121,
  "entity": "rack",
  "operation": "UPDATE",
  "entity_id": 5,
  "data": {
    "id": 5,
    "cabinet_id": 1,
    "rack_code": "R05",
    "rack_name": "Rack 5"
  }
}
```

### 6.4. SYNC_DELETE

```json
{
  "message_id": "uuid",
  "sync_id": "uuid",
  "type": "SYNC_DELETE",
  "revision": 122,
  "entity": "bin",
  "entity_id": 12
}
```

### 6.5. SYNC_ACK

```json
{
  "message_id": "uuid",
  "sync_id": "uuid",
  "type": "SYNC_ACK",
  "status": "APPLIED",
  "applied_revision": 122,
  "acknowledged_at": "2026-09-19T10:01:00Z"
}
```

### 6.6. SYNC_ERROR

```json
{
  "message_id": "uuid",
  "sync_id": "uuid",
  "type": "SYNC_ERROR",
  "code": "REVISION_GAP",
  "detail": "Full synchronization required",
  "last_applied_revision": 100
}
```

---

## 7. Reliability and transaction rules

### 7.1. MQTT settings

Khuyến nghị:

- QoS 1 cho sync request, sync response và ACK.
- QoS 0 cho telemetry không quan trọng.
- Chưa cần QoS 2.
- Reconnect sau mất kết nối.
- Sau reconnect luôn gửi `SYNC_REQUEST`.
- Không phụ thuộc hoàn toàn vào retained message.
- Retained message chỉ phù hợp cho trạng thái nhỏ, không dùng để chứa toàn bộ database.

### 7.2. Idempotency

Mỗi message cần có:

- `message_id` UUID.
- `sync_id` cho một phiên full sync.
- `revision` monotonic.
- Entity identifier ổn định.

Quy tắc:

- `revision <= local_revision`: stale hoặc duplicate, không apply.
- `CREATE/UPDATE`: upsert theo ID hoặc business key.
- `DELETE` entity không tồn tại: coi là idempotent thành công.
- Không để duplicate message tạo duplicate row.

### 7.3. Transaction

```text
Receive message
    ↓
Parse JSON
    ↓
Validate schema/entity/revision
    ↓
Check duplicate/stale
    ↓
BEGIN TRANSACTION
    ↓
Upsert/delete entity
    ↓
Update sync_metadata
    ↓
COMMIT
    ↓
Publish ACK
```

Nếu lỗi:

```text
ROLLBACK
    ↓
Không gửi APPLIED ACK
    ↓
Gửi SYNC_ERROR hoặc retry
    ↓
Request lại incremental/full sync
```

ACK thành công chỉ được gửi sau `COMMIT`.

---

## 8. Failure scenarios

| Trường hợp | Detection | Action | Recovery |
|---|---|---|---|
| IPC mất mạng khi Server publish | MQTT disconnect hoặc thiếu ACK | Không commit thêm | Reconnect và request từ local revision |
| IPC reconnect | MQTT connected callback | Gửi SYNC_REQUEST | Incremental hoặc full sync |
| Duplicate message | `message_id` hoặc `revision <= local_revision` | Bỏ qua, ACK lại | Không tạo duplicate |
| Message cũ | Revision thấp hơn local | Bỏ qua | Giữ dữ liệu hiện tại |
| Message mới nhưng thiếu message trước | Revision gap | Không apply | Request missing range/full sync |
| Crash giữa transaction | Process restart | SQLite rollback transaction chưa commit | Retry sync |
| Server restart | MQTT reconnect | IPC request sync lại | Server trả revision hiện tại |
| Broker restart | MQTT disconnect | Reconnect client | Sync lại sau reconnect |
| Local DB corrupt | SQLite error/health check fail | Bootstrap mode | Tạo DB mới rồi full sync |
| IPC mới cài đặt | Không có sync metadata | Request revision 0 | Full sync |
| Server thay đổi khi IPC offline | IPC revision cũ | Request lại sau reconnect | Incremental hoặc full sync |

---

## 9. File/module cần thay đổi

### Ưu tiên cao

| File/module | Vai trò hiện tại | Thay đổi cần làm |
|---|---|---|
| `IPCSIM/app/database/database.py` | SQLite engine/schema | Thêm schema version, transaction helper và sync metadata migration |
| `IPCSIM/app/startup.py` | Startup DB/serial | Khởi động MQTT client và Sync Service |
| `IPCSIM/main.py` | FastAPI lifespan/health | Thay `server_synced=True` bằng trạng thái thực |
| `IPCSIM/app/core/config.py` | DB/serial config | Thêm IPC ID, broker, QoS, reconnect config |
| `IPCSIM/app/services/sync/sync_service.py` | Placeholder | Full sync, incremental sync, revision, retry, ACK |
| `IPCSIM/app/api/sync.py` | Placeholder | Sync status và manual sync endpoint |
| `IPCSIM/app/schemas/communication.py` | Placeholder | Pydantic schemas cho sync payload |
| `IPCSIM/app/database/models/communication.py` | Placeholder | `SyncMetadata` model |
| `IPCSIM/app/database/models/inventory.py` | Master/inventory ORM | Chuẩn hóa read model, relationships và ownership |
| `IPCSIM/app/api/inventory.py` | CRUD local | Giới hạn local master CRUD; chuyển ownership về Server |
| `IPCSIM/app/services/inventory/transaction_service.py` | Pick/put/adjust | Xác định flow request/ack với Server |
| `IPCSIM/app/repositories/inventory_repository.py` | CRUD/commit | Đưa transaction boundary lên service layer |

### File/module mới

```text
IPCSIM/app/mqtt/client.py
IPCSIM/app/mqtt/topics.py
IPCSIM/app/mqtt/handlers.py
IPCSIM/app/sync/validator.py
IPCSIM/app/sync/state.py
IPCSIM/app/sync/retry.py
```

Mục tiêu là tách:

```text
MQTT transport
    ≠
Synchronization business logic
```

### Ưu tiên trung bình

- [`IPCSIM/app/serial/handlers/ack_handler.py`](IPCSIM/app/serial/handlers/ack_handler.py): ghép ACK với command ID.
- [`IPCSIM/app/serial/handlers/telemetry_handler.py`](IPCSIM/app/serial/handlers/telemetry_handler.py): giữ local runtime persistence và optional publish runtime event.
- [`IPCSIM/app/serial/handlers/event_handler.py`](IPCSIM/app/serial/handlers/event_handler.py): giữ runtime history và optional publish.

### Development-only

- [`IPCSIM/scripts/seed_cabinets.py`](IPCSIM/scripts/seed_cabinets.py): chỉ giữ cho test/demo local.
- [`IPCSIM/scripts/seed_items_inventory.py`](IPCSIM/scripts/seed_items_inventory.py): không chạy trong production bootstrap.

---

## 10. Migration plan

### 10.1. Chuẩn bị

1. Backup `IPCSIM/data/ipc.db`.
2. Kiểm kê các record hiện có.
3. Phân loại dữ liệu seed và dữ liệu thật.
4. Chuẩn hóa code/id giữa SQLite và Server.
5. Xác định dữ liệu cần import lên PostgreSQL.

### 10.2. Import Server

Import các dữ liệu cần thiết:

- Cabinet/rack/shelf/bin.
- Item catalog.
- Item location/inventory sau khi đối chiếu.
- Device/IPC registration.
- Configuration.

Không import mù dữ liệu seed hoặc record bị trùng code.

### 10.3. Bootstrap IPC

```text
Backup ipc.db
    ↓
Thêm schema sync mới hoặc tạo DB mới
    ↓
Khởi động IPC ở bootstrap mode
    ↓
IPC gửi SYNC_REQUEST(local_revision=0)
    ↓
Server gửi FULL_SYNC
    ↓
IPC validate và apply trong một transaction
    ↓
IPC cập nhật sync_metadata
    ↓
IPC gửi SYNC_ACK
```

### 10.4. Khi nào reset database?

Reset database nếu:

- Chỉ chứa dữ liệu demo.
- Không có dữ liệu runtime cần giữ.
- Đã backup đầy đủ.
- Server đã có dữ liệu chuẩn.

Không reset nếu:

- Có inventory thực tế chưa import.
- Có lịch sử vận hành cần giữ.
- Chưa xác minh mapping ID/code.

---

## 11. Implementation phases

### Phase 1 - Refactor IPC database

- Chốt schema đích.
- Phân loại master/runtime/local metadata.
- Thêm `sync_metadata`.
- Chuẩn hóa migration/schema version.
- Giảm commit phân tán trong repository.

### Phase 2 - Define sync protocol

- Chốt topic.
- Chốt JSON schema.
- Chốt `message_id`, `sync_id`, `revision`.
- Chốt ACK/error code.
- Chốt full sync batch format.

### Phase 3 - Implement Server PostgreSQL

- Tạo PostgreSQL schema.
- Tạo master data repositories.
- Tạo revision tracking đơn giản.
- Tạo service tạo full/incremental dataset.

### Phase 4 - Implement Server MQTT

- Kết nối broker.
- Publish full sync.
- Publish incremental updates.
- Nhận và lưu ACK.
- Theo dõi revision của từng IPC.

### Phase 5 - Implement IPC MQTT client

- Kết nối broker.
- Subscribe topic IPC.
- Publish request/ACK/error.
- QoS 1 cho sync.
- Reconnect và request sync sau reconnect.

### Phase 6 - Implement IPC Sync Service

- Validate payload.
- Full sync transaction.
- Incremental sync transaction.
- Revision gap detection.
- Idempotent upsert/delete.
- Retry/error handling.
- Cập nhật health/status.

### Phase 7 - Migration

- Backup SQLite.
- Đối chiếu dữ liệu cũ.
- Import dữ liệu chuẩn lên Server.
- Bootstrap IPC bằng full sync.
- Ngừng seed production.

### Phase 8 - Failure/reconnect testing

Kiểm thử tối thiểu:

- IPC offline trong lúc publish.
- MQTT reconnect.
- Duplicate message.
- Message cũ.
- Revision gap.
- Crash giữa transaction.
- Server restart.
- Broker restart.
- Local database corrupt/mất.
- IPC mới cài đặt.
- Full sync sau mismatch.

---

## 12. Tiêu chí hoàn thành

Hệ thống được coi là đạt khi:

- Server PostgreSQL là source of truth.
- IPC local database không tự tạo master data production.
- IPC có `sync_metadata` và biết revision hiện tại.
- IPC tự request sync sau reconnect.
- Full sync hoạt động với database trống.
- Incremental sync phát hiện revision gap.
- Duplicate message không tạo duplicate/corruption.
- ACK chỉ gửi sau transaction commit.
- Crash giữa transaction không để DB ở trạng thái nửa chừng.
- `server_synced` phản ánh trạng thái thật.
- Runtime telemetry vẫn có thể lưu local khi Server/MQTT offline.
- Có test cho reconnect, duplicate, out-of-order và database recovery.

---

## 13. Quyết định kiến trúc cần xác nhận trước khi code

1. Inventory quantity có được cập nhật trực tiếp tại IPC hay mọi thay đổi phải qua Server?
2. Runtime telemetry có cần publish toàn bộ lên Server hay chỉ lưu local và gửi summary?
3. Server có giữ revision history đủ lâu để incremental sync hay luôn yêu cầu full sync sau một khoảng thời gian?
4. Có cần authentication/TLS MQTT trong phạm vi đồ án không?
5. Có giữ bảng `users` local hay chuyển hoàn toàn authentication về Server?
6. Có cần lưu `processed_sync_messages` hay chỉ dùng revision + idempotent upsert?

Sau khi chốt các điểm trên mới bắt đầu chỉnh sửa code.
