# Khởi động hệ thống

Cho máy đã hoàn tất [FIRST_TIME_CONFIG.md](FIRST_TIME_CONFIG.md). PowerShell: `cd <thư-mục-clone>/SmartInventory_ver2.0`. Mọi command chạy tại root; Docker Desktop cần engine running.

## 1. PostgreSQL → MQTT → Server backend → Server frontend

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d postgres mqtt
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d server worker web
docker compose --env-file deploy/.env -f deploy/compose.yaml ps -a
```

Compose đợi PostgreSQL healthy, chạy migration rồi backend. Migrate exit 0 là bình thường; service dài hạn cần running.

| Thành phần | Port / URL | Thành công |
|---|---|---|
| PostgreSQL | 5432 nội bộ Docker | healthy, accepting connections |
| Mosquitto | localhost:8883 TLS | broker chạy, worker/edge kết nối |
| Django | 8001 nội bộ Docker | `/api/session` trả JSON |
| Worker | Không có UI/HTTP port | revision/heartbeat cập nhật |
| Nginx + React | http://localhost:8080 | console login thành công |

## 2. Chọn mode

### REAL: Server → MQTT → IPC → Hardware

Kết nối Hardware đã cấu hình, đóng Serial Monitor và bật nguồn. Terminal riêng tại root:

```powershell
.venv/Scripts/python.exe IPC/main.py
```

UI: http://127.0.0.1:8002/ui/. Dùng token IPC và tài khoản Server cấp quyền. Kiểm Server online/revision synchronized; nếu HARDWARE_ENABLED=true, USB COM đúng/baud 115200, kiểm Serial connected/telemetry. ESP32 hiện chỉ telemetry; điều khiển REAL vẫn khóa theo adapter.

### SIMULATION: Server → MQTT → IPCSIM → Virtual Serial → Simulation

Terminal riêng tại root:

```powershell
.venv/Scripts/python.exe IPCSIM/main.py
```

Terminal thứ hai tại root:

```powershell
.venv/Scripts/python.exe Simulation/main.py
```

Chọn COM đối diện từng cặp, **Start** group cần dùng. Baud IPCSIM mặc định 9600; listener thử kết nối lại nếu edge khởi động trước Simulation.

UI: http://127.0.0.1:8000/ui/. Dùng token IPCSIM/tài khoản/quyền đã sync. Kiểm Server online, revision synchronized, Serial connected, Simulation online. Server chọn SIMULATION/ALL; REAL dành IPC. Một instance cho mỗi device ID.

## 3. Quick Health Check

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec postgres pg_isready -U inventory -d inventory
Invoke-RestMethod http://localhost:8080/api/session
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --since 5m --tail 60 mqtt worker server
```

- Server session JSON trước login có authenticated=false; sau login device Online, revision/acknowledged revision khớp.
- Edge → System: Server connected, database healthy, server_synced=true, đúng identity. `/api/system/health` cần `Authorization: Bearer <EDGE_API_TOKEN>`; thiếu token trả 401 là đúng.
- Serial: `/api/serial/status` connected; nhiều cổng cần group đang dùng connected.
- Cabinet/Rack: đúng index/telemetry mới; Cabinet 02 / Rack 01 có Serial address 7, khác database PK.
- Inventory: REAL/SIMULATION đúng nguồn; quá 45 giây không heartbeat sẽ Offline. Cabinet chưa nối Serial không phải đang vận hành.
- Fault: xử lý nguyên nhân, chờ snapshot mới rồi Resume/Abort/Home UI cho phép; không xóa operation/reset DB để bỏ khóa.

## 4. Common Startup Errors

| Lỗi | Xử lý |
|---|---|
| docker không có / engine unavailable | Docker Desktop, terminal mới sau cài, chờ engine |
| Docker build lỗi | `docker compose --progress plain --env-file deploy/.env -f deploy/compose.yaml build server worker web migrate`; đọc lỗi build phía trên wrapper |
| Port already in use | Dừng instance cũ, kiểm 8080/8883/8000/8002 |
| PostgreSQL connection failed | Postgres healthy, credential khớp volume; đổi `.env` không tự đổi password DB cũ |
| MQTT/certificate lỗi | Username=device ID, password, hostname/SAN, CA, TLS hai phía; broker đọc secrets |
| session taken over | Dừng device ID/worker client ID trùng |
| COM unavailable | Hai đầu COM riêng, baud đúng, đóng Serial Monitor, Start Simulation |
| Frontend không nối / edge UI 503 | Backend chạy/build IPCSIM frontend; Vite proxy đúng port |
| Edge offline / chưa sync | Registry/assignment/enabled đúng, worker chạy, MQTT/revision sync |
| Edge login lỗi | Token đúng edge, tài khoản/quyền sync, SERVER_URL đúng |
| No Python at ... | Tạo lại venv theo FIRST_TIME_CONFIG |

## 5. Dừng và cập nhật

Dừng thao tác theo workflow; Ctrl+C edge, đóng Simulation rồi:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml stop
```

Sau sửa Server/frontend Server:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build server worker web
```

Sau sửa frontend edge: `npm.cmd run build --prefix IPCSIM/frontend`; sau sửa ipc_core/cấu hình, restart edge. Không reset development/down -v để dừng bình thường vì có thể xóa dữ liệu.


## 6. Sự cố và cảnh báo bảo trì IPCSIM

Trang **Sự cố** ưu tiên trạng thái an toàn, các lỗi đang tồn tại, cảnh báo bảo trì và lịch sử từng lần lỗi. Chọn **Kiểm tra cabinet** để mở workflow phục hồi hiện có; trang Sự cố không reset hay gửi lệnh chuyển động.

Có thể thêm vào `IPCSIM/.env` và khởi động lại IPCSIM:

```dotenv
REPEATED_FAULT_THRESHOLD=3
REPEATED_FAULT_WINDOW_MINUTES=30
```

Một rack liên tục báo lỗi chỉ tính một occurrence, kể cả nhiều bản tin hoặc nhiều mã lỗi. Clear rồi lỗi lại mới tính lần tiếp theo. Mất kết nối không tạo occurrence, không xác nhận lỗi đã clear. Lịch sử có sẵn được đọc từ các snapshot đã đối chiếu; không dựng lỗi từ trạng thái giao tiếp.

Ngưỡng mặc định là **3 lần/rack trong 30 phút**, áp dụng cửa sổ thời gian trượt. Cảnh báo còn sau khi lỗi clear và hết khi không còn đủ occurrence trong cửa sổ. **Xác nhận đã xem** lưu operator/thời gian, không xóa lịch sử, không xác nhận đã bảo trì và không tự khóa giao dịch. Một lần lỗi mới làm cảnh báo cần kiểm tra trở lại.

Severity được chuẩn hóa tại `ipc_core/fault_service.py`: giữ severity hệ thống nếu có; nếu chưa có, policy backend xếp lỗi interlock vật cản/độ lệch/quá tải, mất tham chiếu và trạng thái cơ khí không khớp vào CRITICAL; lỗi còn lại vào ERROR. UI dùng INFO/WARNING/ERROR/CRITICAL từ backend.
