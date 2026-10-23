# Cấu hình lần đầu — Smart Inventory System

Cho máy Windows mới, dùng PowerShell. Kiến trúc: **Server ↔ IPC/IPCSIM ↔ Hardware/Simulation**. Chạy command từ root repository, trừ nơi ghi rõ. Các lần sau dùng [START_UP.md](START_UP.md).

## 1. Prerequisites

| Thành phần | Yêu cầu |
|---|---|
| Git | Clone và checkout branch |
| Python | Python 3.12, 64-bit; launcher `py` và pip |
| Node.js/npm | Node.js 22.12+ tương thích engine trong lockfile; npm đi kèm Node |
| Docker Desktop | Linux containers, Docker Compose v2; WSL2/virtualization nếu Docker yêu cầu |
| PostgreSQL | PostgreSQL 16 trong Compose; không cần database riêng |
| MQTT Broker | Eclipse Mosquitto 2 trong Compose, cổng 8883, TLS |
| OpenSSL | Lệnh `openssl` trong PATH để sinh certificate |
| Simulation GUI | PyQt6 cài từ `Simulation/requirements.txt` |
| Virtual Serial | Driver cặp COM ảo hoạt động trên Windows, ví dụ com0com; thấy hai đầu trong Device Manager |
| Hardware | Driver USB Serial phù hợp ESP32; PlatformIO nếu build/nạp firmware |

Mở Docker Desktop, chờ engine running:

```powershell
git --version
py -3.12 --version
node --version
npm.cmd --version
docker version
docker compose version
openssl version
```

## 2. Clone project

```powershell
git clone --branch version/latest-full https://github.com/Emonz1234/SmartInventory_ver2.0.git
cd SmartInventory_ver2.0
```

Nếu đã clone, dùng thư mục hiện có. Venv, dependencies, database và secrets tạo riêng trên từng máy.

## 3. Python environment

```powershell
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt -r Simulation/requirements.txt
```

Requirements root dùng chung Server/IPC/IPCSIM. `IPC/requirements.txt` và `IPCSIM/requirements.txt` trỏ danh sách chung; không cần cài lặp. Simulation bổ sung PyQt6; Dockerfile Server cài thêm Gunicorn. `requirements.lock.txt` giữ snapshot dependency hiện có, không cần nâng major package.

Các command còn lại dùng `.venv/Scripts/python.exe`, không bắt buộc activate mỗi terminal. Nếu `No Python at ...`, cài Python 3.12 và tạo lại venv local; không dùng venv chuyển từ máy khác.

## 4. Frontend environment

```powershell
npm.cmd ci --prefix Server/frontend
npm.cmd ci --prefix IPCSIM/frontend
npm.cmd run build --prefix Server/frontend
npm.cmd run build --prefix IPCSIM/frontend
```

`npm ci` dùng đúng lockfile. Docker build và Nginx phục vụ console Server; IPC/IPCSIM dùng chung `IPCSIM/frontend/dist` tại `/ui/`. Không cần frontend riêng trong IPC.

## 5. Environment variables

### Server qua Docker Compose

Tạo `deploy/.env` từ mẫu và sinh secrets:

```powershell
.venv/Scripts/python.exe tools/configure_deployment.py --host localhost
.venv/Scripts/python.exe tools/create_mqtt_certificates.py --host localhost
```

Công cụ sinh Django secret, PostgreSQL password, MQTT password ngẫu nhiên và broker account `inventory-server`. Certificate có SAN localhost, 127.0.0.1 và Docker hostname `mqtt`. Công cụ từ chối ghi đè file/secrets đã có; giữ cấu hình hiện tại nếu máy đã thiết lập.

| Biến | Ý nghĩa profile local |
|---|---|
| `BIND_ADDRESS`, `WEB_PORT` | Web bind `127.0.0.1:8080` |
| `DJANGO_SECRET_KEY` | Secret Django |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | Host/origin browser được phép |
| `DJANGO_DEBUG`, `DJANGO_SECURE_COOKIES` | Mặc định 0; secure cookies cần HTTPS |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database/user `inventory`, password được sinh |
| `POSTGRES_HOST`, `POSTGRES_PORT` | Compose dùng `postgres:5432` |
| `MQTT_CONFIG`, `MQTT_PUBLIC_PORT` | `mosquitto.conf`, port công khai 8883 |
| `MQTT_USERNAME`, `MQTT_SERVER_CLIENT_ID` | Worker dùng `inventory-server`; chỉ một worker |
| `MQTT_TLS`, `MQTT_CA` | TLS bật, CA worker `/certs/ca.crt` qua volume |
| `MQTT_HOST`, `MQTT_PORT` | Compose ghi đè worker thành `mqtt:8883` |

Service PostgreSQL hiện cố định database/user `inventory`; giữ `.env` khớp service. Compose ghi đè PostgreSQL host của Server/worker/migrate. Backend 8001 và PostgreSQL 5432 không publish ra host; browser qua Nginx 8080.

`Server/.env.example` dành cho Django trực tiếp với PostgreSQL tự quản lý. Không cần tạo `Server/.env` khi dùng Compose. Nếu chạy trực tiếp, copy mẫu, điền credential/host rồi chạy `python Server/manage.py runserver 127.0.0.1:8001`; MQTT worker là process riêng.

### IPC và IPCSIM

Chỉ copy mẫu cho instance chưa có `.env`:

```powershell
Copy-Item IPCSIM/.env.example IPCSIM/.env
Copy-Item IPC/.env.example IPC/.env
notepad IPCSIM/.env
notepad IPC/.env
```

Sinh token riêng cho từng edge rồi điền `EDGE_API_TOKEN`:

```powershell
.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

| Biến | IPCSIM | IPC |
|---|---|---|
| `DEVICE_ID` / `DEVICE_TYPE` | `IPCSIM01` / `IPCSIM` | `IPC01` / `IPC` |
| `DB_PATH` | `runtime/IPCSIM01.sqlite3` | `runtime/IPC01.sqlite3` |
| `EDGE_API_HOST` / `EDGE_API_PORT` | `127.0.0.1` / `8000` | `127.0.0.1` / `8002` |
| `SERVER_URL` | `http://localhost:8080` | `http://localhost:8080` |
| `MQTT_HOST` / `MQTT_PORT` | `localhost` / `8883` | `localhost` / `8883` |
| `MQTT_TLS` / `MQTT_CA` | `true` / `../deploy/secrets/ca.crt` | `true` / `../deploy/secrets/ca.crt` |
| `MQTT_PASSWORD` | Password account `IPCSIM01` | Password account `IPC01` |
| `SERIAL_BAUDRATE` | `9600` | `115200` với ESP32 hiện tại |
| `HARDWARE_ENABLED` | Không bật Hardware REAL | `false` ban đầu; `true` để nhận telemetry |

Identity khớp registry Server/username broker. Mỗi instance cần database, token và port riêng. Đường dẫn tương đối giải từ thư mục chứa `.env`; launcher hỗ trợ `--env <path>`. `APP_NAME` là tên ứng dụng.

Frontend dev tùy chọn: copy mẫu trong `Server/frontend` hoặc `IPCSIM/frontend` thành `.env` cùng thư mục. `SERVER_API_URL`/`EDGE_API_URL` là proxy backend; `VITE_BIND_HOST` là host Vite; `VITE_EDGE_API_URL=/api` giữ API cùng origin; `VITE_SERVER_UI_URL` trỏ console. UI IPC cần proxy edge port 8002. Không đặt secrets vào `VITE_*` vì chúng nằm trong browser bundle.

## 6. PostgreSQL, migration và dữ liệu ban đầu

```powershell
docker compose --progress plain --env-file deploy/.env -f deploy/compose.yaml build server worker web migrate
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d postgres
docker compose --env-file deploy/.env -f deploy/compose.yaml exec postgres pg_isready -U inventory -d inventory
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm migrate
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps server python Server/manage.py bootstrap_inventory
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps server python Server/manage.py createsuperuser
```

PostgreSQL tạo database/user khi volume mới khởi tạo bằng password `.env`. Migration nâng schema hiện có. Bootstrap đăng ký IPC01/IPCSIM01/topology, không tạo tồn kho thật. Trong console cấu hình sản phẩm, vị trí chứa, người dùng/quyền và assignment. Edge nhận master data/quyền qua MQTT, không seed SQLite thủ công.

**Dữ liệu mẫu tùy chọn**, chỉ development local:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps -e DJANGO_DEBUG=1 server python Server/manage.py seed_demo_data --allow-demo --queue-sync
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps server python Server/manage.py validate_locations --demo-topology
```

Seed gồm 1 cabinet REAL + 22 cabinet SIMULATION, mỗi cabinet 6 rack. Account demo-admin/demo-supervisor/demo-operator có password ngẫu nhiên in một lần, lưu khi seed. REAL trong demo vẫn là dữ liệu mẫu; không seed database vận hành.

**Reset development tùy chọn:** dừng IPC/IPCSIM/Simulation rồi chạy `tools/reset_development.ps1 -ConfirmDevelopmentReset`. Lệnh xóa schema development và SQLite edge, migrate/seed lại; chỉ chấp nhận loopback/database inventory. Không dùng reset để khởi động bình thường. Log Compose cuối cùng tại `runtime/reset-development-compose.log`.

PK/FK database khác index hiển thị/Serial address. SIM Cabinet 02 / Rack 01 có address 7; không đổi PK/FK để khớp nhãn. `import_legacy`/`backup_legacy.py` giữ cho đối soát; import mặc định dry-run, xem `python Server/manage.py help import_legacy` trước khi dùng.

## 7. MQTT broker, account và TLS

Account Server đã tạo. Thêm account edge, nhập password rồi điền cùng password vào `.env` tương ứng:

```powershell
docker run --rm -it -v "${PWD}/deploy/secrets:/secrets" eclipse-mosquitto:2 mosquitto_passwd /secrets/passwords IPCSIM01
docker run --rm -it -v "${PWD}/deploy/secrets:/secrets" eclipse-mosquitto:2 mosquitto_passwd /secrets/passwords IPC01
docker run --rm -v "${PWD}/deploy/secrets:/secrets" --user 0:0 --entrypoint /bin/sh eclipse-mosquitto:2 -c "chmod 644 /secrets/passwords /secrets/ca.crt /secrets/server.crt /secrets/server.key"
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d mqtt
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 50 mqtt
```

Không dùng `mosquitto_passwd -c` khi thêm account: cờ đó ghi đè danh sách. ACL cho Server đọc uplink/ghi downlink; edge chỉ topic của chính device ID. Không đăng ký inventory-server làm edge. Topic/payload hiện có giữ nguyên.

Broker cần đọc passwords/CA/certificate/server key. Giữ `ca.key` trên Server, không đưa lên Git/máy edge; edge chỉ cần `ca.crt`. `.env` và secrets là dữ liệu local.

Edge khác máy: dùng hostname/IP Server có trong SAN, cập nhật MQTT_HOST/SERVER_URL, phân phối CA, cấu hình firewall/bind/allowed hosts/CSRF phù hợp. Profile `mosquitto.lan.conf` và `configure_deployment.py --lan` hiện có dùng plaintext cho LAN/VPN tin cậy, cần MQTT_TLS=0/false hai phía. Hướng dẫn này dùng TLS.

```powershell
.venv/Scripts/python.exe tools/check_configuration.py --env deploy/.env
.venv/Scripts/python.exe tools/check_configuration.py --env IPCSIM/.env --network
.venv/Scripts/python.exe tools/check_configuration.py --env IPC/.env --network
```

Preflight không in secrets; network kiểm TCP/TLS. Heartbeat và revision được xác nhận mới chứng minh sync MQTT đầy đủ.

## 8. IPC / IPCSIM và Serial/COM

**IPCSIM:** tạo cặp COM1↔COM2; Simulation chọn COM1 group 1, IPCSIM dùng SERIAL_PORT=COM2, SERIAL_GROUP_PORTS={}, baud 9600. Hai chương trình dùng hai đầu riêng.

Nhiều group cần cặp độc lập, ví dụ COM1↔COM2 group 1, COM3↔COM4 group 2:

```dotenv
SERIAL_PORT=
SERIAL_GROUP_PORTS={"1":"COM2","2":"COM4"}
SERIAL_BAUDRATE=9600
```

Map edge dùng group 1–22; chọn COM đối diện trong từng group GUI. Chỉ vận hành group đã kết nối. Address = `(cabinet_index - 1) * 6 + rack_index`. Không thêm bridge TCP/MySQL cũ.

**IPC:** mặc định HARDWARE_ENABLED=false. Nhận ESP32 hiện tại: HARDWARE_ENABLED=true, SERIAL_PORT là USB COM thực tế, baud 115200; đóng Serial Monitor. Firmware phát JSON newline qua **USB Serial**, UART2 RX16/TX17 chưa phát telemetry. RACK_ID=1 cần assignment address 1 trên Server; address chưa gán không tạo rack/snapshot giả.

ESP32 gửi DHT11 temperature/humidity, MQ2 ADC gas 0–4095 và gas_alert khi gas > 2000. Smoke là cờ cảnh báo tương thích, không phải phép đo khói riêng. Firmware chưa nhận lệnh điều khiển/chưa gửi ACK hay chuyển động; IPC giữ hardware_commands_supported=false. Bật Serial không mở khóa REAL.

Nạp firmware nếu cần: mở `esp32_master_serial/` bằng PlatformIO, chọn esp32dev/USB port thực tế. Không sửa protocol để thử Simulation.

## 9. Simulation

Simulation có 22 group × 6 rack. Chạy GUI, chọn COM rồi **Start** từng group cần dùng:

```powershell
.venv/Scripts/python.exe Simulation/main.py
```

Standalone chỉ mô phỏng tại chỗ. Có thể đặt COM mặc định trước khi mở GUI:

```powershell
$env:SIMULATION_SERIAL_PORT_0='COM1'
$env:SIMULATION_SERIAL_PORT_1='COM3'
.venv/Scripts/python.exe Simulation/main.py
```

Biến Simulation dùng index **0–21**, map edge **1–22**. SIMULATION_SERIAL_PORT là fallback; nhiều group dùng biến riêng/chọn GUI. `Simulation/.env.example` liệt kê biến nhưng chương trình không tự đọc `.env`; dùng process environment.

Fault giữ cơ khí/journal. Clear fault đưa RECOVERING; UI quyết định Resume/Abort/Home theo bằng chứng/phân loại, không reset tồn kho/tự phát lại lệnh. PUT/PICK commit theo workflow hiện có; sau restart chờ snapshot mới.

## 10. Verification

Khởi chạy theo [START_UP.md](START_UP.md):

- [ ] PostgreSQL connected: pg_isready accepting connections.
- [ ] Migration successful: migrate exit 0.
- [ ] Server backend running: `/api/session` trả JSON có authenticated.
- [ ] Server frontend running: http://localhost:8080 hiển thị login.
- [ ] MQTT connected: broker/worker chạy, edge Server online.
- [ ] IPC/IPCSIM connected: identity đúng, server_synced=true, revision được xác nhận.
- [ ] Simulation connected: group đã Start, serial_connected=true.
- [ ] Login successful: Server login; edge token riêng/tài khoản/quyền đã sync.
- [ ] REAL/SIMULATION data displayed correctly: đúng device/cabinet/rack, nguồn tách biệt.

IPC01 Online khi IPC thực gửi heartbeat, seed không giả trạng thái. Lệnh đã gửi chưa chứng minh hoàn tất cơ khí. Edge Inventory PUT/PICK theo quyền; Server Inventory Adjustment cần quantity/reason/đối soát. UI hỗ trợ Tiếng Việt/English; đổi ngôn ngữ không gửi lại lệnh.

### Development validation tùy chọn

```powershell
$env:SERVER_TEST_SQLITE='1'
.venv/Scripts/python.exe Server/manage.py test Server.inventory --noinput
.venv/Scripts/python.exe -m pytest tests IPCSIM/tests -q
node tools/test-i18n.mjs
Remove-Item Env:SERVER_TEST_SQLITE
```

SERVER_TEST_SQLITE chỉ dành test, không đặt trong deployment `.env`. PostgreSQL concurrency/process test cần database test riêng; MQTT integration opt-in cần broker Aedes local. Fixture/mock/regression test giữ để bảo vệ behavior, không phải entrypoint vận hành. `legacy/physical_prototype` là tham chiếu protocol cũ.
