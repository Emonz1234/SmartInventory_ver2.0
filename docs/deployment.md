# Triển khai và sử dụng Smart Inventory

## 1. Chuẩn bị môi trường

Các lệnh chạy tại root bằng PowerShell. Linux thay `.venv/Scripts/python` bằng
`.venv/bin/python`. Cài Python 3.12, Node 22.12+/24, Docker kèm Compose; nếu không
dùng Docker thì cài PostgreSQL 16 và Mosquitto 2 native. Simulation PyQt6 cần môi
trường đồ họa; IPC/IPCSIM phục vụ React bằng FastAPI, mở bằng trình duyệt.

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pip install -r IPCSIM/requirements.txt -r Simulation/requirements.txt
```

Không seed hoặc xóa database cũ. Backup/import theo [runbook](runbook.md).
Mỗi device dùng SQLite mới, migration tự chạy khi khởi động; PostgreSQL dùng
migration Django. Không mở file SQLite của device khác hoặc dùng chung DB_PATH.

## 2. Chạy Server bằng Compose trên một máy

```powershell
.venv/Scripts/python tools/configure_deployment.py --host localhost
.venv/Scripts/python tools/create_mqtt_certificates.py --host localhost
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser
```

Script tạo secret ngẫu nhiên, `.env` và broker password hash; từ chối ghi đè cấu
hình cũ. Công cụ certificate cần OpenSSL trong PATH, tạo CA và certificate SAN cho
hostname cùng tên nội bộ `mqtt`. Giữ ca.key/server.key tại Server, chỉ cấp ca.crt
cho edge. Certificate có hạn 365 ngày, cần quản lý gia hạn. Trên Linux, cấp quyền
đọc server.key/passwords cho user Mosquitto của container mà không mở public các key.

Mở `http://localhost:8080`. Nginx phục vụ React và proxy `/api`, `/admin` về Django;
API cùng origin nên không cần CORS wildcard. Compose chạy migration trước Server
và worker, lưu DB/MQTT vào volume. PostgreSQL không publish port ra host.

## 3. Chạy Server máy 1, IPCSIM/Simulation máy 2

1. Chọn hostname hoặc IP LAN của máy 1 mà máy 2 truy cập được. Tạo cấu hình và
   certificate lần đầu bằng hai lệnh ở trên, thay `localhost` bằng hostname/IP này.
2. Trong `deploy/.env`, đặt `BIND_ADDRESS=0.0.0.0`. Đây là địa chỉ **bind**, không phải
   địa chỉ client. `DJANGO_ALLOWED_HOSTS` chứa hostname/IP không kèm scheme/port;
   `DJANGO_CSRF_TRUSTED_ORIGINS` chứa origin đầy đủ `http://<may-1>:8080`.
3. Firewall máy 1 cho máy 2/subnet LAN truy cập TCP 8080 và 8883. Không tắt firewall
   hoặc mở PostgreSQL 5432. Compose không yêu cầu edge truy cập database Server.
4. Máy 2 đặt MQTT_HOST là hostname/IP máy 1, MQTT_PORT=8883, MQTT_TLS=true và MQTT_CA
   là đường dẫn bản copy ca.crt. Host phải trùng SAN. SERVER_URL là
   `http://<may-1>:8080`. Không dùng localhost của máy 2 để chỉ máy 1.
5. Browser máy 2 mở cùng URL web máy 1. React dùng `/api`, không phải build lại khi
   đổi IP. API edge bind 127.0.0.1; trình duyệt tại máy 2 mở `/ui/` trên port edge.

```powershell
Test-NetConnection <may-1> -Port 8080
Test-NetConnection <may-1> -Port 8883
.venv/Scripts/python tools/check_configuration.py --env IPCSIM/.env --network
```

Thay placeholder `<may-1>` trước khi chạy. Preflight chỉ xác minh cấu hình/TCP/TLS,
không chứng minh MQTT login hay sync ACK. Không cần sửa source khi đổi mạng.

Profile không TLS chỉ dành LAN/VPN tin cậy: khi tạo cấu hình mới dùng
`configure_deployment.py --host <may-1> --lan`; broker dùng mosquitto.lan.conf,
MQTT_TLS=0, bind mạng, vẫn port 8883. Edge phải đặt MQTT_TLS=false tương ứng.
Không đưa profile này ra Internet. Internet cần VPN hoặc MQTT TLS và HTTPS reverse
proxy cho web. HTTPS public proxy chưa được đóng gói trong Compose; không mở trực
tiếp web HTTP ra Internet. Khi có HTTPS, đặt DJANGO_SECURE_COOKIES=1, trusted origins
theo URL HTTPS và cấu hình proxy đúng scheme.

## 4. Đăng ký device, tài khoản và dữ liệu

Đăng nhập Control Center bằng superuser. Tạo device ID duy nhất, loại IPCSIM.
Lưu device_secret trả về vào file `.env` của đúng device. Khóa ký này khác mật khẩu
MQTT và EDGE_API_TOKEN. Không đăng ký `inventory-server` làm device.

Tạo MQTT username trùng device ID; công cụ sau hỏi password tương tác:

```powershell
docker run --rm -it -v "${PWD}/deploy/secrets:/secrets" eclipse-mosquitto:2 mosquitto_passwd /secrets/passwords <device_id>
docker compose --env-file deploy/.env -f deploy/compose.yaml restart mqtt
```

Không thêm `-c` khi thêm device, vì sẽ ghi đè password file. ACL cho mỗi device ghi
`inventory/v1/<id>/up/+`, đọc `inventory/v1/<id>/down/+`; server dùng quyền ngược lại.
Command không retained. Application kiểm tra thêm registry/type/chữ ký/scope.

Với topology chuẩn, chạy `bootstrap_inventory` theo [hướng dẫn dữ liệu nền](react-bootstrap.md)
để tạo IPC1/6 tủ và IPCSIM/21 nhóm × 6 rack, không tạo tồn kho. Nếu `.env` hiện dùng
`DEVICE_ID=IPCSIM1`, truyền `--sim-device-id IPCSIM1`; không đổi ID của SQLite đã dùng.
Rack **address Serial** nhóm 1 là 1–6, nhóm 2 là 7–12; database rack ID có thể khác
address. Không trùng address trong một device, không assign chéo domain.

`/admin/` quản lý Django user/group/permission. Người vận hành cần các quyền đọc
device, topology, item, stock, operation và `add_operation`; người xác nhận cần
`change_operation`. Quản trị danh mục có quyền add/change/delete tương ứng.
Dùng tài khoản riêng từng người; UI không thay thế kiểm tra quyền backend.

## 5. IPC/IPCSIM và cấu hình instance

```powershell
Copy-Item IPCSIM/.env.example IPCSIM/.env
```

| Biến | Ý nghĩa |
|---|---|
| DEVICE_ID / DEVICE_TYPE | Identity/type đã đăng ký; launcher yêu cầu đúng type |
| DEVICE_SECRET | Khóa ký Server cấp, tối thiểu 32 ký tự |
| DB_PATH | SQLite riêng; đường dẫn tương đối tính từ thư mục `.env` khi dùng launcher |
| EDGE_API_TOKEN | Token ngẫu nhiên cho API local, không phải password người dùng |
| EDGE_API_HOST / EDGE_API_PORT | Bind local mặc định 127.0.0.1:8000 |
| MQTT_HOST / MQTT_PORT | Broker máy 1, mặc định TLS port 8883 |
| MQTT_PASSWORD | Password broker của DEVICE_ID |
| MQTT_TLS / MQTT_CA | Bật TLS và CA kiểm tra hostname |
| SERIAL_PORT / SERIAL_BAUDRATE | Đầu COM phía IPCSIM, baudrate 9600 |
| SERIAL_GROUP_PORTS | JSON map nhóm→cổng để chạy nhiều nhóm, khi dùng phải để SERIAL_PORT rỗng |
| SERVER_URL | Origin Server để gateway FastAPI đăng nhập/thao tác bằng tài khoản Django |
| HARDWARE_ENABLED | IPC mặc định false; chỉ chuẩn bị tích hợp tương lai |

Điền file rồi chạy:

```powershell
.venv/Scripts/python tools/check_configuration.py --env IPCSIM/.env --network
npm ci --prefix IPCSIM/frontend
npm run build --prefix IPCSIM/frontend
.venv/Scripts/python IPCSIM/main.py
# Mở http://127.0.0.1:8000/ui/ và nhập EDGE_API_TOKEN
# Instance riêng:
.venv/Scripts/python IPCSIM/main.py --env D:/inventory/edge-b.env
```

Chỉ chạy một launcher cho một instance. FastAPI/MQTT/Serial cùng một process;
đóng browser không dừng service, dùng Ctrl+C tại terminal. Nhiều instance cần ID,
DB_PATH, API port và Serial port khác nhau. IPC dùng `IPC/main.py` tương tự nhưng
Hardware chưa tồn tại, điều khiển bị khóa tại UI/Server/Serial.

React hiển thị cabinet/rack, stock cache, pending operation, runtime và backlog outbox.
Mở Inventory/Operation rồi đăng nhập tài khoản Django; OPEN/CLOSE/VENTILATE/LIGHT
và PUT/PICK/ADJUST qua FastAPI gọi REST Server, rồi Server gửi MQTT xuống edge. Chọn đúng rack/item/bin
và quantity; backend kiểm tra scope, quyền, revision, online và Serial.
Khi HTTP timeout, kiểm tra pending trên Server trước khi thao tác lại; không tự retry
lệnh. Xác nhận kết quả thực tế kèm bằng chứng để cập nhật tồn kho chính thức.

## 6. Simulation và Serial

```powershell
.venv/Scripts/python Simulation/main.py
```

Chuẩn bị cặp virtual COM bằng driver phù hợp hệ điều hành. Simulation mở một đầu,
IPCSIM SERIAL_PORT mở đầu còn lại. Không mở cùng cổng. Start đúng nhóm; chờ MQTT
online, Serial connected và revision ACK rồi gửi lệnh từ React.
Một IPCSIM có thể dùng `SERIAL_GROUP_PORTS={"1":"COM2","2":"COM4"}` với
`SERIAL_PORT=`: Start group 1 tại đầu đối diện COM2, group 2 tại đầu đối diện COM4.
Mỗi nhóm có listener/reconnect độc lập; địa chỉ global 1–126 giữ nguyên, không remap.
Không khai báo cùng cổng cho hai nhóm. Chế độ Standalone không tự nối IPCSIM.
`SERIAL_PORT` đơn vẫn hỗ trợ cấu hình cũ; chỉ điều khiển nhóm nối vào cổng đó.

Xem [Simulation dashboard](simulation-dashboard.md) về timestamp, đồ thị, lỗi và
reset phiên. Serial-over-TCP socket:// chỉ là transport dùng kiểm thử tự động.

## 7. Native development không có Docker

Cài PostgreSQL/Mosquitto native, tạo database và tài khoản riêng bằng psql hoặc GUI
PostgreSQL. Cấu hình password/ACL/TLS theo deploy/, thay đường dẫn broker thành đường
dẫn thật trên máy. Copy `Server/.env.example` thành `.env`, điền DB/MQTT/SECRET_KEY.

```powershell
.venv/Scripts/python Server/manage.py migrate
.venv/Scripts/python Server/manage.py createsuperuser
.venv/Scripts/python Server/manage.py runserver 127.0.0.1:8001
# Terminal thứ hai:
.venv/Scripts/python Server/manage.py mqtt_worker
# Terminal thứ ba:
cd Server/frontend
npm ci
npm run dev
```

Copy `Server/frontend/.env.example` thành `.env` để đặt SERVER_API_URL của proxy.
Development web port 3100; SERVER_URL của edge và DJANGO_CSRF_TRUSTED_ORIGINS phải
chứa URL web này. Khi thử LAN dev, VITE_BIND_HOST=0.0.0.0 và cấu hình Django host
tương ứng. Django runserver/Vite chỉ dùng development; production dùng Compose.

`IPCSIM/frontend` là frontend chính dùng chung: copy `.env.example`, npm ci, npm run dev;
EDGE_API_URL trỏ API local đúng instance; mở URL `/ui/` của Vite. Build production
được FastAPI phục vụ cùng origin. API sửa master data local vẫn trả 409;
thao tác được cấp quyền dùng `/api/operator/*`. Bảo trì Hardware chưa triển khai.

## 8. Offline, lỗi và phục hồi

- MQTT mất mạng: đọc cache, ghi runtime/outbox tại SQLite; reconnect request sync.
  Mutation inventory online-only. Không chạy physical command khi không có lease.
- Thiếu kết quả đúng hạn: operation **uncertain/timeout**, không tự kết luận chưa
  thực thi, không tự replay. Đối soát trước lệnh tiếp theo.
- `sent_to_serial` chỉ xác nhận Serial write. `completed` là quan sát Serial bảo thủ,
  không xác nhận số lượng hàng. Tồn kho chỉ đổi khi operator xác nhận.
- Serial mất kết nối: listener thử nối lại; journal chống gửi lại lệnh cũ. Breakdown
  chặn chuyển động đến khi có frame clear, không tự hết hạn theo thời gian.
- Sai registry/secret/ACL: kiểm tra log worker/edge, hostname SAN, CA và đồng hồ máy;
  không bỏ xác thực. Registry online cần heartbeat hợp lệ, Serial status do heartbeat báo.
- DB hỏng: dừng instance, giữ DB/WAL/SHM và backup trước sửa; không xóa pending journal.
- Log container: `docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f server worker mqtt`.
  Native xem console; React có lỗi kết nối, pending, runtime và outbox count.
- Dừng native bằng Ctrl+C. Dừng container bằng
  `docker compose --env-file deploy/.env -f deploy/compose.yaml down`.
  Không dùng `down -v` khi cần giữ dữ liệu. Backup PostgreSQL bằng pg_dump và secrets riêng.

## 9. Kiểm thử và nghiệm thu

```powershell
.venv/Scripts/python -m pytest tests IPCSIM/tests -q
npm install --prefix .tools/mqtt aedes@0.51.3 --no-audit --no-fund
$env:MQTT_INTEGRATION='1'
.venv/Scripts/python Server/manage.py test Server.inventory --noinput
```

Chỉ dùng cluster PostgreSQL test riêng, tài khoản có CREATEDB. Django tạo/xóa
`test_<POSTGRES_DB>`. SERVER_TEST_SQLITE=1 chạy được unit tests nhưng bỏ qua
process/concurrency test cần PostgreSQL. Aedes là broker test, không dùng production.

Process integration chạy HTTP, worker, broker, edge và controller Simulation độc lập;
pyserial socket:// vận chuyển frame thật. Kiểm tra full/delta sync, command/replay,
inventory confirmation, broker offline/outbox/recovery, mất Serial, restart edge/worker.

Trên hai máy vật lý: dùng domain IPCSIM thử; kiểm tra scope/revision; điều khiển một
rack và phản hồi ngược; ngắt mạng rồi kiểm tra cache/outbox; nối lại; restart; thêm
device khác để xác nhận không lẫn dữ liệu hoặc gửi lại chuyển động. Ghi driver COM,
IP/hostname, thời điểm và kết quả. Test process không chứng minh firewall/driver/LAN
vật lý đã hoạt động. Không có kiểm thử Hardware vì firmware chưa tồn tại.
