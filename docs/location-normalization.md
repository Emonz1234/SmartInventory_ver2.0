# Chuẩn hóa vị trí IPC / IPCSIM

Đã reset development Docker local và SQLite IPCSIM ngày 2026-10-02 sau khi người dùng phê duyệt. Trước reset đã xác minh marker `smart-inventory-demo-v2`, đúng hai device và không có stock thuộc sản phẩm ngoài demo. Chỉ reset schema `public` trong database Compose `inventory` và các SQLite development trong workspace; không thao tác database production. Seed mới dùng marker v3.

## Nguyên nhân

Database PK của IPCSIM bắt đầu sau IPC thật là bình thường: Cabinet 01 có thể có `id=2`, Rack 01 có thể có `id=7`. Lỗi là dùng ID đó làm chỉ số hiển thị (`Tủ {id}`), dùng địa chỉ Serial làm rack number, và schema không có chỉ số local riêng. Bootstrap đặt tên `Rack 7` từ địa chỉ Serial; seed dùng tên/code thay cho chỉ số nghiệp vụ. Inventory UI Server còn gom cabinet theo tên thay vì parent ID.

Simulator dùng địa chỉ Serial 1–132 để định tuyến các nhóm; đây là transport mapping nội bộ của IPCSIM, không nối tiếp địa chỉ của IPC thật. Giữ protocol hiện tại để không đổi luồng vận hành, tách rõ `address` với `rack_index` và ownership theo FK.

## Kết quả thực tế

| Device | Nguồn API | Cabinet index | Rack index trong từng cabinet | Số cabinet / rack |
|---|---|---|---|---|
| IPC01 | REAL | 1 | 1–6 | 1 / 6 |
| IPCSIM01 | SIMULATION | 1–22 | 1–6 | 22 / 132 |

- Tổng 23 cabinet, 138 rack, 20 product, 34 stocked locations, 43 inventory transactions và 6 operations demo.
- Demo được phân bổ trên cả hai nguồn và nhiều cabinet SIM; các transaction/operation/reference cũ được xóa theo reset schema, sau đó seed lại đúng hierarchy.
- Các mẫu pending/conflict mới là fixture có vị trí hợp lệ, không giữ bản ghi mapping sai cũ.
- IPCSIM đã khởi động lại, nhận đủ snapshot 22/132 và Online/Synced. IPC thật không được giả heartbeat hoặc khởi động để thao tác hardware.
- Mật khẩu demo mới nằm trong `.tools/location-demo-logins.json`; log reset tại `.tools/location-reset.log`. Hai file được Git ignore.

## Code đã sửa

- `Server/inventory/models.py`: `Cabinet.cabinet_index`, `Rack.rack_index`, `Rack.code`; cấp chỉ số theo parent khi tương thích dữ liệu cũ.
- Migrations `0002_local_location_indices` và `0003_assigned_cabinet_bounds`: backfill giữ PK/FK, tồn kho và lịch sử; thêm unique theo device/cabinet, rack index 1–6 và giới hạn cabinet đã assigned theo loại device.
- `seed_demo_data.py`, `bootstrap_inventory.py`: code REAL/SIM riêng, rack name local; chạy lại bootstrap không tạo thêm cây từ global ID.
- `location.py`, `services.py`, `console.py`, `overview.py`, `views.py`: metadata vị trí, snapshot và kiểm tra assignment theo parent; cho phép khai báo index tường minh.
- `ipc_core`: schema/projection SQLite, Cabinet/Inventory API, local transaction/command metadata. Projection từ chối metadata sai device/domain hoặc index ngoài phạm vi.
- UI IPCSIM: Cabinet Detail, Inventory, Transactions, Operation, RackOperationPanel dùng local index; tham chiếu kỹ thuật cũ được ghi rõ là ID. UI Server gom cabinet bằng `cabinet_id`.
- `validate_locations.py`, `tools/reset_development.ps1`: validation hierarchy, serial mapping, inventory/operation/transaction ownership sau seed.

Cabinet unassigned trong luồng import legacy được giữ để đối soát; không được đưa vào cây runtime. Validation phát hiện cabinet chưa có ownership. Không xóa/đổi FK production trong migration.

Ví dụ Inventory API đã xác minh trên hệ thống đang chạy:

```json
{
  "device_code": "IPCSIM01",
  "device_type": "SIMULATION",
  "cabinet_code": "SIM-C02",
  "cabinet_index": 2,
  "rack_code": "SIM-C02-R01",
  "rack_index": 1,
  "serial_address": 7
}
```

UI: `IPCSIM01 / Cabinet 02 / Rack 01`. Snapshot/rack API edge giữ `rack_code` dạng Serial address để tương thích; code vị trí ở `rack_identity_code`. MQTT device type vẫn là `IPC`/`IPCSIM`; nguồn Inventory API là `REAL`/`SIMULATION`.

## Lệnh và validation

```powershell
tools/reset_development.ps1 -ConfirmDevelopmentReset
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py validate_locations --demo-topology
```

Seed độc lập chỉ dùng với database development rỗng, hoặc chạy lại seed v3 đã có để kiểm tra idempotency:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps -e DJANGO_DEBUG=1 server python Server/manage.py seed_demo_data --allow-demo --queue-sync
```

Đã chạy:

- Django tests: location identity, migration giữ FK/stock, bootstrap, overview, console, offline và import legacy.
- Docker PostgreSQL tests: location/migration/bootstrap/concurrency; lần kiểm tra constraint cuối cùng đạt 7/7 tests.
- Pytest edge/projection/API/Serial: 26/26 tests đạt.
- Browser: regression global PK/Serial offset; monitoring, inventory và toàn bộ chuỗi cabinet operation trên desktop/mobile đều đạt, không có browser errors.
- Build cả hai frontend và Docker images đạt; `makemigrations --check --dry-run` không có drift, `git diff --check` sạch.
- Validation trên database Docker thật đạt; SQLite runtime có đủ 22/132, local indices 1–6 và `PRAGMA foreign_key_check` không có lỗi.

Trong lần chạy thêm `tests/test_gap_simulation.py`, một test cũ coi action 5 là không hợp lệ đã thất bại: action này hiện là `LIGHT_OFF`. Không sửa protocol/test đó trong đợt chuẩn hóa database; browser regression LIGHT/LIGHT_OFF vẫn đạt.
