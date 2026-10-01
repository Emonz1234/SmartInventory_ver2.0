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

Chỉ bật `HARDWARE_ENABLED=true` sau khi tích hợp phần cứng được nghiệm thu.

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
