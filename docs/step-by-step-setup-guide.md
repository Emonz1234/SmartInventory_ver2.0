# Hướng dẫn cài đặt, khởi chạy và quản lý Smart Inventory System

Tài liệu này mô tả cách vận hành hệ thống theo đúng cấu trúc thực tế của project hiện tại: Server quản lý tập trung, IPC và IPCSIM là các thiết bị độc lập, cùng dùng chung core, kết nối qua MQTT, và Serial liên kết với Simulation/Hardware.

Đây là hướng dẫn thực tế dựa trên mã nguồn hiện tại trong:
- [Server/settings.py](../Server/settings.py)
- [deploy/compose.yaml](../deploy/compose.yaml)
- [Server/inventory/mqtt.py](../Server/inventory/mqtt.py)
- [ipc_core/runtime.py](../ipc_core/runtime.py)
- [ipc_core/launcher.py](../ipc_core/launcher.py)
- [IPC/main.py](../IPC/main.py)
- [IPCSIM/main.py](../IPCSIM/main.py)
- [Simulation/main.py](../Simulation/main.py)

---

## 1. Tổng quan kiến trúc

Hệ thống hiện tại có 5 phần chính:

1. Server
   - Dùng Django + PostgreSQL
   - Là nguồn dữ liệu trung tâm
   - Quản lý device, rack, bin, item, stock, operation, ledger
   - Cung cấp UI quản trị và API cho các thiết bị

2. IPC1
   - Là thiết bị vật lý thực tế
   - Mục tiêu quản lý 6 tủ, ID từ 1 đến 6
   - Chưa có hardware thật, chỉ chuẩn bị interface sẵn
   - Có thể chạy local UI và kết nối Server qua MQTT

3. IPCSIM
   - Là thiết bị mô phỏng
   - Quản lý 21 giá tủ theo cấu trúc simulation hiện có
   - Dùng chung core với IPC
   - Kết nối qua MQTT và Serial với Simulation

4. Simulation
   - Thành phần mô phỏng phần cứng hoặc tủ rack
   - Kết nối Serial với IPCSIM
   - Hiển thị trạng thái, lỗi, mode vận hành và môi trường

5. Hardware
   - Chưa triển khai phần cứng thật
   - Chỉ giữ sẵn interface và chuẩn tích hợp
   - Không giả định phần cứng đang hoạt động

---

## 2. Mỗi phần mềm dùng để làm gì

### 2.1 Python
Dùng để chạy:
- Django Server
- MQTT worker
- Shared IPC core
- IPCSIM runtime
- Simulation
- Kiểm thử và tiện ích script

Yêu cầu: Python 3.12

### 2.2 Node.js / npm
Dùng khi cần:
- Build hoặc chạy frontend React của Server
- Build hoặc chạy frontend IPCSIM nếu cần theo dõi local

Yêu cầu: Node 22.12+ hoặc 24

### 2.3 PostgreSQL
Dùng làm database chính của Server.

Vai trò:
- Lưu device registry
- Lưu cabinet, rack, shelf, bin
- Lưu item catalog và stock
- Lưu operation, ledger, log, outbox

Project đặt Server dùng PostgreSQL, không dùng SQLite làm DB chính trong deployment mực đích.

### 2.4 Docker + Docker Compose
Dùng để chạy nhanh các service nền:
- PostgreSQL
- Mosquitto MQTT broker
- Server
- worker
- web frontend

Cấu hình nằm ở [deploy/compose.yaml](../deploy/compose.yaml).

### 2.5 Mosquitto
Dùng làm MQTT broker.

Vai trò:
- Server nhận event từ mọi IPC
- IPC và IPCSIM publish trạng thái lên topic
- Server gửi lệnh xuống thiết bị
- Broker chịu trách nhiệm giao tiếp theo thiết bị và topic

### 2.6 OpenSSL
Dùng để tạo certificate TLS cho MQTT broker.

Vai trò:
- Tạo CA và certificate cho broker
- Hỗ trợ Kết nối TLS giữa IPC/IPCSIM và Server
- Dùng trong config bảo mật khi triển khai mạng LAN/Internet

### 2.7 PySide6
Dùng cho giao diện người vận hành trên IPC/IPCSIM.

Vai trò:
- Hiển thị rack, trạng thái, lệnh, pending operation, stack event
- Đăng nhập Server để thực hiện thao tác
- Không thay thế Server làm trung tâm quyền lực

### 2.8 PyQt6 / Simulation GUI
Dùng cho mô phỏng rack và môi trường.

Vai trò:
- Mô phỏng trạng thái thực của tủ
- Chạy Serial bridge tới IPCSIM
- Giảm thiểu cần phần cứng thật trong kiểm thử

---

## 3. Yêu cầu môi trường

Cài đặt các phần mềm sau:

### 3.1 Trên máy 1 (Server)
- Python 3.12
- Node.js 22.12+ hoặc 24
- Docker Desktop hoặc Docker Engine
- Docker Compose
- PostgreSQL 16 (nếu không dùng Docker)
- OpenSSL
- Git

### 3.2 Trên máy 2 (IPC / IPCSIM)
- Python 3.12
- Optional: Node nếu cần chạy web monitor
- PySide6
- Serial driver / cặp COM ảo nếu dùng Simulation
- Cổng serial thực hoặc cặp COM ảo

---

## 4. Tạo môi trường làm việc

## Bước 1: Clone project

```powershell
git clone <repo-url>
cd SmartInventory
```

## Bước 2: Tạo virtual environment

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
```

## Bước 3: Cài đặt dependency chính

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
```

## Bước 4: Cài đặt dependency cho IPCSIM và Simulation

```powershell
.venv\Scripts\python -m pip install -r IPCSIM\requirements.txt -r Simulation\requirements.txt
```

Nếu muốn dùng desktop UI cho IPC/IPCSIM, cài thêm:

```powershell
.venv\Scripts\python -m pip install -r IPC\requirements.txt
```

Nội dung này tuân theo repo hiện tại, nơi IPC core và desktop console chia sẻ chung.

---

## 5. Cấu hình Server với Docker

Project có Docker Compose sẵn trong [deploy/compose.yaml](../deploy/compose.yaml).

### Bước 5.1: Tạo file cấu hình deploy

```powershell
.venv\Scripts\python tools\configure_deployment.py --host localhost
```

Nếu chạy trên mạng nội bộ dùng IP/LAN thay vì localhost:

```powershell
.venv\Scripts\python tools\configure_deployment.py --host 192.168.1.20
```

Lưu ý:
- `--host` phải là IP/hostname mà device khác có thể truy cập
- Không dùng `0.0.0.0` trong host nhập
- Script tạo file `deploy/.env` và password broker

### Bước 5.2: Tạo certificate MQTT

```powershell
.venv\Scripts\python tools\create_mqtt_certificates.py --host localhost
```

Nếu trên mạng LAN:

```powershell
.venv\Scripts\python tools\create_mqtt_certificates.py --host 192.168.1.20
```

Nó sẽ tạo certificate và cấu hình SAN theo hostname/IP.

### Bước 5.3: Khởi động Docker services

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

Đây sẽ chạy:
- PostgreSQL container
- Mosquitto container
- Django migrate job
- Server app
- worker MQTT
- web frontend

### Bước 5.4: Tạo superuser

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser
```

Sau đó đăng nhập vào admin hoặc control center.

### Bước 5.5: Mở website

Mở trình duyệt:

```text
http://localhost:8080
```

Nếu chạy trên LAN, dùng:

```text
http://<IP_SERVER>:8080
```

---

## 6. Cách PostgreSQL hoạt động trong hệ thống

### 6.1 Role và chức năng
PostgreSQL là database quản lý trung tâm, được cấu hình trong [Server/settings.py](../Server/settings.py).

Các biến được đọc từ environment:
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_HOST`
- `POSTGRES_PORT`

Ví dụ cấu hình:

```text
POSTGRES_DB=inventory
POSTGRES_USER=inventory
POSTGRES_PASSWORD=********
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

### 6.2 Khi chạy bằng Docker
PostgreSQL service trong compose sẽ tự tạo database:
- database: `inventory`
- user: `inventory`
- password: lấy từ `.env`

Docker service `postgres` không public port ra ngoài mặc định, nên các thiết bị client khác không kết nối trực tiếp DB qua PostgreSQL từ bên ngoài. Server và worker nối tới service `postgres` nội bộ trong network Docker.

### 6.3 Khi chạy native không dùng Docker
Bạn cần cài PostgreSQL local và cấu hình tương tự. Sau đó chạy:

```powershell
.venv\Scripts\python Server\manage.py migrate
.venv\Scripts\python Server\manage.py createsuperuser
.venv\Scripts\python Server\manage.py runserver 127.0.0.1:8001
```

---

## 7. Cách MQTT hoạt động trong hệ thống

MQTT là đường truyền điều khiển và đồng bộ giữa Server và các thiết bị.

### 7.1 Cấu hình broker
- Service `mqtt` trong [deploy/compose.yaml](../deploy/compose.yaml)
- Broker là Mosquitto
- Port publish mặc định: 8883
- Config nằm trong `deploy/mosquitto.conf` và `deploy/acl`

### 7.2 Topic cơ bản
Dựa trên shared protocol trong [ipc_core/protocol.py](../ipc_core/protocol.py), topic theo mẫu:

```text
inventory/v1/{device_id}/{up|down}/{channel}
```

Ví dụ:
- `inventory/v1/IPCSIM-01/up/status`
- `inventory/v1/IPCSIM-01/down/command`
- `inventory/v1/IPCSIM-01/up/sync`

### 7.3 Server và worker
Worker MQTT được chạy trong [Server/inventory/mqtt.py](../Server/inventory/mqtt.py).

Vai trò:
- Subscribe lên topic thiết bị
- Verify signature
- Validate identity
- Update device state
- Send command/ack/status xuống device
- Xử lý outbox/retry

### 7.4 Khi thiết bị không chạy
- Device giữ local cache SQLite
- Outbox lưu lệnh và event chưa gửi
- Khi reconnect, hệ thống gửi lại và kiểm tra ACK

---

## 8. Cách Setup thiết bị IPC / IPCSIM

Mỗi device cần có identity riêng và không được dùng chung DB hoặc device ID.

### Bước 8.1 Tạo file .env cho IPCSIM

```powershell
Copy-Item IPCSIM\.env.example IPCSIM\.env
```

Sau đó điền các biến có ý nghĩa:

- `DEVICE_ID`: định danh thiết bị duy nhất, ví dụ `IPCSIM-01`
- `DEVICE_TYPE`: `IPCSIM` hoặc `IPC`
- `DEVICE_SECRET`: khóa bí mật của device, phải dài và riêng
- `DB_PATH`: đường dẫn SQLite local riêng của device
- `EDGE_API_TOKEN`: token gọi API local
- `MQTT_HOST`: IP/hostname của Server
- `MQTT_PORT`: 8883
- `MQTT_PASSWORD`: password device trên broker
- `MQTT_TLS`: bật TLS nếu dùng certificate
- `SERIAL_PORT`: cổng Serial kết nối Simulation
- `SERVER_URL`: URL Server để UI đăng nhập
- `HARDWARE_ENABLED`: mặc định `false` cho IPC

### Bước 8.2 Chạy IPCSIM

```powershell
.venv\Scripts\python IPCSIM\main.py
```

Chạy headless nếu không cần desktop:

```powershell
.venv\Scripts\python IPCSIM\main.py --headless
```

### Bước 8.3 Chạy IPC

```powershell
.venv\Scripts\python IPC\main.py
```

Lưu ý:
- IPC không nên giả lập phần cứng
- `HARDWARE_ENABLED` phải tắt nếu chưa có hardware
- giao diện local vẫn chạy và hiển thị trạng thái “Hardware chưa kết nối” như thiết kế

---

## 9. Cách chạy Simulation

Simulation là môi trường mô phỏng rack và Serial interface.

### Bước 9.1 Chạy Simulation

```powershell
.venv\Scripts\python Simulation\main.py
```

### Bước 9.2 Nối Serial

Simulation sẽ dùng một đầu COM; IPCSIM mở đầu còn lại.

Cách nối:
- Mỗi đầu cổng phải là một nửa của một cặp virtual COM
- Không mở cùng 1 COM cho nhiều process
- IPCSIM `SERIAL_PORT` phải trỏ tới đầu còn lại

Khi chạy đúng:
- IPCSIM gửi lệnh qua Serial
- Simulation nhận và phản hồi lại trạng thái
- IPCSIM publish telemetry về Server qua MQTT

---

## 10. Luồng vận hành thực tế

## Server → IPC/IPCSIM

1. Server tạo operation hoặc cập nhật dữ liệu master
2. Server ghi vào outbox
3. Server publish MQTT message lên topic `down`
4. IPCSIM/IPC nhận lệnh
5. IPCSIM/IPC kiểm tra quyền, state, revision
6. Nếu hợp lệ, thực hiện Serial hoặc local logic
7. Trả về result / telemetry / state qua MQTT
8. Server ghi lại ACK và cập nhật stock / operation

## IPCSIM → Simulation

1. IPCSIM gửi command qua Serial
2. Simulation parse lệnh
3. Simulation viết trạng thái rack / nhiệt độ / smoke / lỗi
4. Simulation trả về telemetry / trạng thái bằng Serial
5. IPCSIM tổng hợp và publish lên MQTT
6. Server cập nhật tình trạng thực tế

---

## 11. Cách quản lý thiết bị và tủ

### 11.1 Tạo thiết bị trong Server
Truy cập giao diện Server, tạo Device với:
- `device_id`
- `device_type` (`IPC` hoặc `IPCSIM`)
- `name`
- `secret`
- `enabled`

### 11.2 Tạo cabinet / rack / shelf / bin
Server quản lý master data:
- Cabinet: domain root
- Rack: địa chỉ rack và tên
- Shelf: tầng chứa
- Bin: vị trí chứa hàng
- Item: mã hàng hóa

### 11.3 Gán thiết bị cho cabinet
Mỗi tủ / giá tủ phải thuộc đúng device.

Đừng để cùng một rack thuộc 2 device khác nhau.

### 11.4 Định danh rack và phạm vi
- IPC1: 6 tủ thực tế, ID 1–6
- IPCSIM: 21 giá tủ mô phỏng
- Device ID và rack ID phải được quản lý độc lập

Không dùng “ID rack rời rạc” làm khóa toàn cục nếu có thể trùng giữa device khác nhau.

---

## 12. Cách đăng nhập và điều khiển từ UI

### 12.1 Trên Server
- Mở http://localhost:8080
- Đăng nhập bằng superuser hoặc account có quyền
- Tạo item, cabinet, rack, shelf, bin
- Gán device và quyền
- Theo dõi trạng thái online/offline

### 12.2 Trên IPC/IPCSIM Desktop UI
- Đăng nhập bằng tài khoản Server
- Chọn rack / item / bin / quantity
- Gửi lệnh như OPEN, CLOSE, VENTILATE, LIGHT, PUT, PICK, ADJUST
- Xác nhận với bằng chứng thực tế nếu cần

Lưu ý:
- UI không được coi là thao tác thành công chỉ vì lệnh đã gửi đi
- `sent` chỉ là “đã gửi” qua Serial, không phải “hardware đã hoàn tất”

---

## 13. Mạng LAN / hai máy tính

Khi chạy Server trên máy 1 và IPCSIM/IPC trên máy 2:

### Bước 13.1 Chọn IP thực của máy 1
Ví dụ:

```text
192.168.1.20
```

### Bước 13.2 Cấu hình .env máy 1

```powershell
.venv\Scripts\python tools\configure_deployment.py --host 192.168.1.20
```

### Bước 13.3 Trong máy 2
Cài đặt đúng:
- `MQTT_HOST=192.168.1.20`
- `MQTT_PORT=8883`
- `MQTT_TLS=true`
- `MQTT_CA` trỏ tới CA file tương ứng
- `SERVER_URL=http://192.168.1.20:8080`

### 13.4 Firewall
Trên Server, mở:
- TCP 8080 cho web
- TCP 8883 cho MQTT

Không cần mở PostgreSQL ra Internet nếu không cần.

### 13.5 Kiểm tra kết nối

```powershell
Test-NetConnection 192.168.1.20 -Port 8080
Test-NetConnection 192.168.1.20 -Port 8883
```

Lưu ý: không dùng `localhost` của máy 2 để giả là máy 1.

---

## 14. Cách khởi chạy trên 2 máy đúng chuẩn

### Máy 1: Server
```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

### Máy 2: IPCSIM / Simulation
```powershell
.venv\Scripts\python Simulation\main.py
.venv\Scripts\python IPCSIM\main.py
```

Nếu dùng IPC vật lý:
```powershell
.venv\Scripts\python IPC\main.py
```

---

## 15. Hướng dẫn kiểm thử cơ bản

### Kịch bản 1: Server + IPCSIM + Simulation
1. Khởi động Server
2. Khởi động MQTT broker
3. Khởi động Simulation
4. Khởi động IPCSIM
5. Kiểm tra server nhận device ID
6. Kiểm tra 21 giá tủ hiện ra trong UI
7. Gửi một command từ Server
8. Kiểm tra dây chuyền:
   - Server → MQTT → IPCSIM → Serial → Simulation → Serial → IPCSIM → MQTT → Server

### Kịch bản 2: IPC không có hardware
1. Khởi động IPC
2. Kiểm tra UI
3. Xác nhận quyền điều khiển bị chặn nếu không có hardware hoặc không có server online
4. Xác nhận hệ thống không giả lập hardware đang hoạt động

### Kịch bản 3: Hai thiết bị cùng chạy
1. Chạy IPCSIM và IPC đồng thời
2. Mỗi thiết bị có device ID khác nhau
3. Gửi lệnh tới IPCSIM, không được ảnh hưởng IPC
4. Gửi lệnh tới IPC, không được ảnh hưởng IPCSIM

### Kịch bản 4: Mất kết nối và phục hồi
- MQTT mất kết nối
- Server tạm thời ngừng
- IPCSIM mất mạng và reconnect
- Kết quả: outbox giữ dữ liệu, không replay không kiểm soát, trạng thái vẫn đúng

---

## 16. Xử lý sự cố thông dụng

### 16.1 Server không lên
Kiểm tra:
- Docker đang chạy
- `.env` đúng
- PostgreSQL và Mosquitto container đang sống

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f
```

### 16.2 Không nhận được MQTT message
Kiểm tra:
- `MQTT_HOST`
- `MQTT_PORT`
- `MQTT_PASSWORD`
- `MQTT_TLS`
- CA cert đúng
- Hostname/SAN khớp

### 16.3 IPCSIM không hiển thị UI/cấu hình
Kiểm tra:
- `DEVICE_ID` đúng với registry
- `DEVICE_SECRET` khớp
- `DB_PATH` là file mới, không dùng DB cũ
- `SERIAL_PORT` hợp lệ

### 16.4 Simulation không nhận lệnh
Kiểm tra:
- Virtual COM đã được tạo
- IPCSIM và Simulation mở 2 đầu khác nhau của cùng cặp port
- Baudrate phù hợp

### 16.5 Hardware chưa triển khai
Đây là trạng thái mong đợi. Không tự giả lập phần cứng đã chạy. Hệ thống phải chịu trạng thái chưa kết nối rõ ràng.

---

## 17. Kết luận nhanh

Hệ thống đang có cấu trúc đúng cho yêu cầu:
- Server là trung tâm
- IPC và IPCSIM là thiết bị tách biệt, dùng chung core
- MQTT là kênh điều khiển đồng bộ
- Serial là kênh giao tiếp thiết bị mô phỏng / hardware
- PySide6 là giao diện desktop của device
- Hardware chưa triển khai, nhưng đã được chuẩn bị interface rõ ràng

Với hướng dẫn trên, bạn có thể:
1. cài đặt môi trường,
2. chạy Server,
3. chạy MQTT/PostgreSQL,
4. chạy IPCSIM / IPC / Simulation,
5. kết nối qua mạng LAN,
6. quản lý device, rack, stock và operation theo đúng kiến trúc thực tế của project.

---

## 18. Bảng tóm tắt nhanh

| Thành phần | Công dụng | Cách chạy |
|---|---|---|
| Server | Quản trị tổng, DB, MQTT worker | Docker compose hoặc Django manage.py |
| PostgreSQL | DB chính | Docker service postgres hoặc native |
| Mosquitto | MQTT broker | Docker service mqtt |
| IPC | Device vật lý | `python IPC/main.py` |
| IPCSIM | Device mô phỏng | `python IPCSIM/main.py` |
| Simulation | Rack simulator | `python Simulation/main.py` |
| PySide6 | UI local device | Tích hợp trong launcher |
| Docker | Chạy nền | `docker compose up -d --build` |

---

## 19. Gợi ý chạy nhanh cho người mới

Nếu bạn muốn chạy ngay 1 phiên bản tối thiểu để test:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install -r IPCSIM\requirements.txt -r Simulation\requirements.txt
.venv\Scripts\python tools\configure_deployment.py --host localhost
.venv\Scripts\python tools\create_mqtt_certificates.py --host localhost
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
.venv\Scripts\python Simulation\main.py
.venv\Scripts\python IPCSIM\main.py
```

Sau đó mở:

```text
http://localhost:8080
```

---

## 20. Mục tiêu cuối cùng

Đây là một hệ thống quản lý kho thông minh theo mô hình:

```text
Server (Django + PostgreSQL) -> MQTT -> IPC/IPCSIM -> Serial -> Simulation/Hardware
```

với hai nguyên tắc cốt lõi:
- Server là nguồn sự thật
- IPC/IPCSIM là device độc lập, không chia sẻ runtime/database local cục bộ chung

Đó là cách hệ thống được thiết kế và hoạt động theo đúng mã nguồn hiện tại.
