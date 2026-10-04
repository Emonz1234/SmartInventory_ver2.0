# Khởi chạy

Chạy PowerShell tại thư mục dự án. Docker Desktop phải đang hoạt động.

## Bật

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps -a
```

Mở hai terminal riêng:

```powershell
.venv/Scripts/python Simulation/main.py
```

```powershell
.venv/Scripts/python IPCSIM/main.py
```

Chọn COM và bấm **Start** trong Simulation. Chỉ chạy một IPCSIM cho mỗi `DEVICE_ID`.

Để chạy thêm IPC01 đã cấu hình và hardware-disabled, mở terminal thứ ba:

```powershell
.venv/Scripts/python IPC/main.py
```

Để nhận dữ liệu firmware ESP32 hiện tại, cấu hình USB Serial 115200 baud và `HARDWARE_ENABLED=true` theo [IPC với ESP32](ipc-esp32.md). Firmware hiện chỉ gửi telemetry; IPC chặn các lệnh điều khiển chưa được hỗ trợ.

## Kiểm tra

- Server: http://localhost:8080
- IPCSIM: http://127.0.0.1:8000/ui/
- IPCSIM cần báo `Server online`, `revision synchronized` và `Serial connected`.
- Trong Server console, chọn nguồn **SIMULATION** hoặc **ALL**.

## Dừng và cập nhật

Nhấn Ctrl+C tại IPCSIM và Simulation, sau đó dừng Docker:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml stop
```

Sau khi sửa code Server, chạy `up -d --build`. Không dùng `down -v` để dừng.

## MQTT chưa đồng bộ

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --since 5m --tail 80 mqtt worker server
```

Kiểm tra `DEVICE_ID`, MQTT password, CA, hostname và `revision`/`acknowledged_revision`. `session taken over` thường có nghĩa là đang chạy nhiều instance cùng `DEVICE_ID`.

## Đọc log vị trí Serial

`PARSED (Serial)` giữ nguyên địa chỉ nhận từ Simulation. `[MAP]` và `[DB]` ghi riêng `cabinet_index`, `rack_index`, `serial_address` và `db_rack_id`.

Ví dụ `BRKSTT|1|0|0|0` thuộc IPCSIM Cabinet 01 / Rack 01, địa chỉ Serial 1. Sau seed, rack đó có thể có ID database 7:

```text
PARSED (Serial) msg_type=event payload={'rack_id': 1, ...}
[MAP] device=IPCSIM01 cabinet_index=1 rack_index=1 serial_address=1 db_rack_id=7
[DB] Saved breakdown snapshot: device=IPCSIM01 cabinet_index=1 rack_index=1 serial_address=1 db_rack_id=7
```

Snapshot lưu ID database để liên kết đúng với rack/inventory. `db_rack_id=7` không phải local Rack 07; không đổi PK/FK thành địa chỉ Serial. Sau khi cập nhật code listener, dừng và khởi động lại IPCSIM để nạp log mới.
