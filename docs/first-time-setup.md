# Cài đặt lần đầu bằng Docker Compose

Hướng dẫn này dùng Docker Compose cho toàn bộ Server, PostgreSQL và MQTT; không cài
PostgreSQL/Mosquitto native trên máy Server. IPC/IPCSIM và Simulation vẫn chạy native
trên máy có cổng COM. Chạy PowerShell từ thư mục gốc repository. Thay `<...>` bằng
giá trị của máy bạn.

```text
Browser → Web :8080 → Django → PostgreSQL (volume bền vững)
                         ↕ MQTT worker
                    Mosquitto :8883 ↔ IPC/IPCSIM → Serial → Simulation/Hardware
```

Server là nguồn dữ liệu chính. IPCSIM nhận bản sao read-model qua MQTT và lưu trong
SQLite riêng. Bootstrap tạo topology, không tự tạo hàng tồn/giao dịch. Topology mặc
định: IPC1 có 1 nhóm × 6 rack; IPCSIM có 22 nhóm × 6 rack. Simulator hiện chạy tối đa
21 nhóm; nhóm 22 vẫn có trong database nhưng chưa điều khiển được.

## 1. Yêu cầu

- Docker Desktop chạy Linux containers; `docker compose version` phải thành công.
- Python 3.12 để chạy tiện ích cấu hình và IPC/IPCSIM; Node.js/npm để build UI edge.
- Máy chạy Simulation cần driver virtual COM và dependency PyQt6.
- OpenSSL trong PATH để tạo certificate MQTT mặc định.

Không cần cài PostgreSQL hoặc Mosquitto trên Windows. Máy Server không cần mở port
5432 ra host; PostgreSQL chỉ nằm trong mạng Docker.

```powershell
docker version
docker compose version
python --version
node --version
npm.cmd --version
openssl version
```

## 2. Tạo cấu hình Docker

Chọn hostname mà edge sẽ dùng để tới Server. Dùng `localhost` nếu IPCSIM cùng máy;
dùng IP/hostname thật, ví dụ `192.168.1.20`, nếu edge ở máy khác.

```powershell
python tools/configure_deployment.py --host localhost
python tools/create_mqtt_certificates.py --host localhost
```

Hai tiện ích từ chối ghi đè cấu hình/secret đã có. Nếu `deploy/.env` hoặc
`deploy/secrets/passwords` tồn tại, giữ nguyên; không chạy lại để “reset” mật khẩu.
Chứng chỉ mặc định có TLS. Chỉ phân phối `deploy/secrets/ca.crt` cho edge, không chép
`ca.key` hoặc `server.key` sang máy IPC.

Thêm tài khoản MQTT cho IPCSIM; username phải trùng `DEVICE_ID`. Nhập mật khẩu broker
riêng khi Docker hỏi, rồi đặt cùng mật khẩu vào `IPCSIM/.env` ở mục 5.

```powershell
docker run --rm -it -v "${PWD}/deploy/secrets:/secrets" eclipse-mosquitto:2 mosquitto_passwd /secrets/passwords IPCSIM
docker run --rm -v "${PWD}/deploy/secrets:/secrets" --user 0:0 --entrypoint /bin/sh eclipse-mosquitto:2 -c "chmod 644 /secrets/passwords"
```

Nếu dùng IPC1, thêm tài khoản tương tự với username `IPC1`. Lệnh `chmod` cần thiết
để Mosquitto trong container đọc được password file do lệnh trên tạo.

Với LAN, sinh cấu hình bằng IP/hostname client truy cập được, ví dụ:

```powershell
python tools/configure_deployment.py --host 192.168.1.20
python tools/create_mqtt_certificates.py --host 192.168.1.20
```

Đặt `BIND_ADDRESS=0.0.0.0` trong `deploy/.env` chỉ khi cần cho máy khác truy cập;
mở firewall cho TCP 8080 và 8883, không mở 5432. Certificate phải chứa đúng IP/hostname.

## 3. Khởi động Server và khởi tạo database

Kiểm tra cấu hình, build và khởi động các container:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 80 migrate server worker mqtt
```

`migrate` tạo/cập nhật schema Django khi khởi động; exit code 0 rồi container dừng là
bình thường. Tạo tài khoản quản trị Server:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser
```

### Database mới

Chạy dry-run trước. Kết quả mong đợi gồm IPC1 `6 racks`, IPCSIM `22 groups/132 racks`,
`stock_created: 0` và `transactions_created: 0`.

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py bootstrap_inventory --dry-run
```

Khi đã kiểm tra kết quả, áp dụng một lần và xuất credential của thiết bị vào file mới:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py bootstrap_inventory --credentials-file /tmp/device-credentials-20260928.json
New-Item -ItemType Directory -Force backups | Out-Null
docker compose --env-file deploy/.env -f deploy/compose.yaml cp server:/tmp/device-credentials-20260928.json backups/device-credentials-20260928.json
```

Giữ file này an toàn; `DEVICE_SECRET` không thể xem lại từ UI. Không ghi đè file
credential cũ. Nếu `DEVICE_ID` khác mặc định, dùng cùng ID ở lệnh bootstrap, broker và
file `.env` của edge.

### Database đã có IPCSIM nhưng thiếu topology

Nếu registry đã có IPCSIM và chỉ cần bổ sung các nhóm/rack cho thiết bị đó, dùng
`--sim-only` để không tạo thêm IPC1. Dry-run phải báo chỉ thêm 22 cabinet và 132 rack:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py bootstrap_inventory --sim-only --dry-run
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py bootstrap_inventory --sim-only
```

Không chạy bootstrap mỗi lần khởi động. Với database cũ có topology, stock hoặc history,
backup và đối chiếu trước; bootstrap sẽ dừng nếu phát hiện xung đột assignment.

Website Server: `http://localhost:8080` hoặc `http://<IP_SERVER>:8080`.

## 4. Cách database được sử dụng

- PostgreSQL trong service `postgres` là database trung tâm. Tên database là `inventory`,
  user là `inventory`; mật khẩu nằm trong `deploy/.env` (`POSTGRES_PASSWORD`). Không gửi
  file `.env` hoặc secret qua chat/commit Git.
- Compose lưu PostgreSQL trong named volume `deploy_postgres_data`; restart, rebuild và
  `docker compose stop` không xóa dữ liệu. **Không chạy `docker compose down -v` hoặc
  `docker volume prune`** nếu chưa chủ ý xóa database.
- Django tự chạy migration khi `up`. Bootstrap chỉ tạo device/topology/role cơ bản; không
  tạo stock, category mẫu hoặc giao dịch trừ khi bật rõ tùy chọn demo.
- Dùng UI/API Server cho thay đổi nghiệp vụ. Không sửa PostgreSQL hoặc SQLite edge trực
  tiếp để cập nhật tồn kho; IPC SQLite là cache đồng bộ một chiều từ Server.
- Kiểm tra số nhóm/rack trực tiếp qua Django trong container:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py shell -c "from Server.inventory.models import Device,Cabinet,Rack; d=Device.objects.get(pk='IPCSIM'); print({'groups':Cabinet.objects.filter(device=d).count(),'racks':Rack.objects.filter(cabinet__device=d).count(),'revision':d.revision,'acknowledged_revision':d.acknowledged_revision})"
```

### Backup PostgreSQL

Tạo backup trước bootstrap database cũ, nâng cấp hoặc import dữ liệu. Dump được tạo
trong container PostgreSQL rồi copy ra host để tránh redirect file nhị phân qua PowerShell.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose --env-file deploy/.env -f deploy/compose.yaml exec postgres pg_dump -U inventory -d inventory -Fc -f /tmp/inventory-before-change.dump
docker compose --env-file deploy/.env -f deploy/compose.yaml cp postgres:/tmp/inventory-before-change.dump backups/inventory-before-change.dump
```

Đổi tên file cho mỗi lần backup và lưu ngoài máy Server. Khi restore, dừng các tác vụ
ghi, xác định database đích và kiểm tra file dump trước khi chạy `pg_restore`; không
restore đè database đang vận hành theo lệnh mẫu chưa được xem xét.

## 5. Cấu hình IPCSIM và build UI

Tạo file cấu hình nếu chưa có; giữ file cũ nếu thiết bị đã được provision:

```powershell
if (-not (Test-Path IPCSIM/.env)) { Copy-Item IPCSIM/.env.example IPCSIM/.env }
npm.cmd ci --prefix IPCSIM/frontend
npm.cmd run build --prefix IPCSIM/frontend
```

Trong `IPCSIM/.env`, dùng `DEVICE_SECRET` trong file bootstrap, mật khẩu MQTT đã tạo,
token EDGE_API_TOKEN riêng và các địa chỉ sau nếu IPCSIM chạy trên cùng máy Docker:

```dotenv
DEVICE_ID=IPCSIM
DEVICE_TYPE=IPCSIM
SERVER_URL=http://localhost:8080
EDGE_API_HOST=127.0.0.1
EDGE_API_PORT=8000
DB_PATH=runtime/simulation-edge.sqlite3
MQTT_HOST=localhost
MQTT_PORT=8883
MQTT_TLS=true
MQTT_CA=../deploy/secrets/ca.crt
MQTT_PASSWORD=<mat-khau-mqtt-IPCSIM>
SERIAL_PORT=
SERIAL_GROUP_PORTS={"1":"COM2"}
SERIAL_BAUDRATE=9600
```

Nếu IPCSIM ở máy khác, đổi `SERVER_URL` và `MQTT_HOST` thành IP/hostname Server và
copy `ca.crt` sang edge. Không dùng `localhost` để trỏ tới máy Server từ edge từ xa.
`SERIAL_GROUP_PORTS` đánh số group từ 1 đến 21; map chỉ các COM đang sử dụng.

Root `.venv` cần các dependency của edge/Simulation:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -r Simulation/requirements.txt
```

Nếu `.venv` đã có, bỏ hai lệnh tạo/cài môi trường. Chạy Simulation rồi IPCSIM bằng
các lệnh trong [startup.md](startup.md). Lần đầu mở UI IPCSIM, đăng nhập bằng
EDGE_API_TOKEN và tài khoản operator Server.

## 6. Lỗi thường gặp

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 100 postgres mqtt worker
Test-NetConnection localhost -Port 8883
```

- Mosquitto restart hoặc báo không đọc được `passwords`: kiểm tra file có tài khoản
  `inventory-server` và `IPCSIM`, quyền đọc file, rồi xem log service `mqtt`.
- TLS lỗi: dùng đúng `ca.crt`, hostname phải khớp certificate và giờ máy phải đúng.
- Server có topology nhưng IPCSIM chưa có: kiểm tra MQTT worker/broker, DEVICE_ID,
  MQTT password và DEVICE_SECRET; edge phải báo Server online và revision synchronized.
- Group 22 có dữ liệu nhưng không điều khiển: Simulator hiện chỉ hỗ trợ 21 group.
- Không xóa volume để chữa lỗi đồng bộ; backup và đối soát outbox trước khi can thiệp SQLite.

Khi cài đặt xong, dùng [hướng dẫn khởi chạy](startup.md). Không tạo lại database,
secret, user hay topology trong mỗi phiên làm việc.