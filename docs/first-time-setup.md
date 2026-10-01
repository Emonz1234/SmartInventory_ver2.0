# Cài đặt lần đầu

Cài Docker Desktop, Python 3.12, Node.js/npm và driver COM ảo. Mở Docker Desktop, rồi chạy PowerShell tại thư mục dự án.

## 1. Dependencies và cấu hình Server

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -r Simulation/requirements.txt
npm.cmd ci --prefix IPCSIM/frontend
npm.cmd run build --prefix IPCSIM/frontend
.venv/Scripts/python tools/configure_deployment.py --host localhost
.venv/Scripts/python tools/create_mqtt_certificates.py --host localhost
```

Hai lệnh cấu hình chỉ tạo file mới, không ghi đè cấu hình hiện có.

## 2. MQTT và edge

Tạo user broker và nhập mật khẩu MQTT IPCSIM01:

```powershell
docker run --rm -it -v "${PWD}/deploy/secrets:/secrets" eclipse-mosquitto:2 mosquitto_passwd /secrets/passwords IPCSIM01
docker run --rm -v "${PWD}/deploy/secrets:/secrets" --user 0:0 --entrypoint /bin/sh eclipse-mosquitto:2 -c "chmod 644 /secrets/passwords"
Copy-Item IPCSIM/.env.example IPCSIM/.env
notepad IPCSIM/.env
```

Đặt `EDGE_API_TOKEN`, `MQTT_PASSWORD`, `MQTT_HOST=localhost` và `MQTT_CA=../deploy/secrets/ca.crt`. File mẫu đã có `DEVICE_ID=IPCSIM01`, `DEVICE_TYPE=IPCSIM` và `DB_PATH`.
Đặt `SERIAL_PORT` hoặc `SERIAL_GROUP_PORTS` theo cổng COM của máy.

## 3. Tạo database demo

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
tools/reset_development.ps1 -ConfirmDevelopmentReset
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser
```

Reset xóa dữ liệu development. Không chạy trên production. Chi tiết ở [reset database](sample-databases.md).

Sau đó chạy Simulation và IPCSIM theo [hướng dẫn khởi chạy](startup.md). IPC01 cần cấu hình MQTT, Serial và hardware riêng trước khi sử dụng.
