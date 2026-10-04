# Reset database development

Lệnh reset xóa schema `public` của PostgreSQL `inventory` và SQLite development của IPC/IPCSIM, sau đó dựng baseline và seed lại demo. **Không dùng trên production.** File trong `backups/` được giữ nguyên.

1. Dừng IPCSIM, IPC và Simulation bằng Ctrl+C.
2. Chạy PowerShell tại thư mục dự án:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
tools/reset_development.ps1 -ConfirmDevelopmentReset
```

3. Tạo tài khoản Server nếu cần:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser
```

Script chỉ chấp nhận cấu hình loopback/database local và dừng nếu API edge còn chạy. Dữ liệu mẫu gồm:

- 2 device: IPC01, IPCSIM01
- 23 cabinet: 1 REAL và 22 SIMULATION; 138 rack
- 7 category, 20 product, 34 stocked locations
- 43 inventory movements, 6 operations, 1 pending sync và 1 conflict

Seed in mật khẩu ngẫu nhiên một lần cho `demo-admin`, `demo-supervisor` và `demo-operator`; lưu lại nếu cần kiểm thử đăng nhập. Không có mật khẩu demo cố định trong source.
Seed chạy lại không tạo trùng. Seed v3 lưu `cabinet_index` theo device và `rack_index` theo cabinet; không dùng ID database để đánh số hiển thị.

| Device | Nguồn API | Cabinet index | Rack index trong từng cabinet | Tổng rack |
|---|---|---|---|---|
| IPC01 | REAL | 1 | 1–6 | 6 |
| IPCSIM01 | SIMULATION | 1–22 | 1–6 | 132 |

Code vị trí: `REAL-C01-R01` và `SIM-C01-R01` … `SIM-C22-R06`. PK cabinet/rack vẫn unique toàn database: IPCSIM Cabinet 01 có thể có `id=2`, Rack 01 có thể có `id=7`; đó là ID kỹ thuật hợp lệ, không phải chỉ số hiển thị.

Simulator hiện dùng Serial address 1–132 để định tuyến đến 22 cổng/nhóm. Địa chỉ 7 là **SIM Cabinet 02 / Rack 01**, không phải local Rack 07. Protocol MQTT giữ `device_type=IPC/IPCSIM`; API vị trí trả `device_type=REAL/SIMULATION`.

Các constraint mới: `unique(device_id, cabinet_index)`, `unique(cabinet_id, rack_index)`, `rack_index` bắt buộc 1–6; cabinet đã gán vào IPC chỉ có index 1, IPCSIM có index 1–22. Cabinet unassigned của công cụ import legacy vẫn được giữ để đối soát, không được đưa vào cây runtime. Migration `0002_local_location_indices` backfill chỉ số theo parent và giữ nguyên FK, stock, lịch sử, địa chỉ Serial; không xóa dữ liệu vận hành. Snapshot mới mang cả metadata và ID kỹ thuật. Trường `rack_code` trong snapshot/rack API edge được giữ dạng Serial address để tương thích; dùng `rack_identity_code` cho code vị trí và `rack_index` cho hiển thị. Inventory API trả `rack_code` là code vị trí, kèm `serial_address` riêng.

Sau reset, script tự chạy validation. Có thể kiểm tra lại:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py validate_locations --demo-topology
```

Với database vận hành cần nâng schema nhưng **không reset**, chạy migrate rồi tạo snapshot mới:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm migrate
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py validate_locations --refresh-sync
```

Ví dụ metadata vị trí trong Inventory API:

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

Hiển thị: `IPCSIM01 / Cabinet 02 / Rack 01`.

IPCSIM01 Online/Synced sau khi khởi động và nhận snapshot theo [hướng dẫn](startup.md). IPC01 chỉ Online khi edge IPC01 thực sự gửi heartbeat; seed không giả trạng thái thiết bị.
Seed tạo `demo-admin`, `demo-supervisor` và `demo-operator`, đồng thời in mật khẩu ngẫu nhiên một lần trong output reset; hãy lưu lại khi chạy lệnh.
