# Smart Inventory System

Server Django + React + PostgreSQL quản lý nhiều IPC/IPCSIM qua MQTT. IPC/IPCSIM
dùng chung Python core, FastAPI, React, SQLite và journal lệnh. IPCSIM nối Simulation
PyQt6 qua Serial. Hardware chưa phát triển và bị khóa mặc định.

```text
Người vận hành edge: React → FastAPI → Django (session + CSRF)
Thiết bị:       Django worker ↔ MQTT broker ↔ IPC/IPCSIM ↔ Serial ↔ Simulation
Database:      PostgreSQL tại Server       SQLite riêng từng device
```

React edge chỉ gọi FastAPI local; gateway FastAPI kiểm tra scope rồi gọi Django.
Sync, lệnh xuống thiết bị và phản hồi runtime luôn đi qua MQTT. Edge không kết nối
PostgreSQL. Tồn kho thực IPC và mô phỏng IPCSIM tách domain.

## Bắt đầu

Yêu cầu: Python 3.12, Node.js 22.12+ hoặc 24, PostgreSQL 16, Mosquitto 2.
Docker Compose dùng để đóng gói Server; IPCSIM/Simulation chạy native để dùng COM.
OpenSSL dùng khi tạo chứng chỉ. Đưa Python, Node và các công cụ vào PATH.

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pip install -r IPCSIM/requirements.txt -r Simulation/requirements.txt
```

Tiếp tục theo **[hướng dẫn triển khai một/hai máy](docs/deployment.md)**.
Không dùng SQLite cũ làm DB_PATH mới; không seed production tự động.

## Cấu trúc

| Thư mục | Trách nhiệm |
|---|---|
| `Server/`, `Server/frontend/` | Django, migration, REST, MQTT worker, React |
| `ipc_core/` | Database, sync, protocol, adapters, FastAPI và operator gateway dùng chung |
| `IPCSIM/frontend/` | React/MUI dùng chung cho IPC1 và IPCSIM, phục vụ tại `/ui/` |
| `IPC/`, `IPCSIM/` | Launcher và cấu hình từng loại instance |
| `Simulation/` | Controller mô phỏng, Serial, dashboard PyQt6 |
| `Hardware/` | Interface tương lai; chưa có firmware |
| `deploy/` | Compose, Dockerfiles, nginx, Mosquitto ACL/TLS |
| `tests/`, `tools/` | Kiểm thử, backup, cấu hình và công cụ kiểm tra |
| `legacy/` | Prototype/tài liệu lịch sử, không dùng triển khai |

## Tài liệu

- [Cài đặt, cấu hình, sử dụng và nghiệm thu hai máy](docs/deployment.md)
- [Kết quả rà soát và giới hạn kiểm thử](docs/system-audit.md)
- [Khôi phục React, bootstrap và danh sách topology](docs/react-bootstrap.md)
- [Simulation dashboard](docs/simulation-dashboard.md)
- [Kiến trúc và ownership](docs/architecture.md)
- [Migration dữ liệu cũ và recovery](docs/runbook.md)
- [Tích hợp Hardware](Hardware/README.md)

```powershell
.venv/Scripts/python -m pytest tests IPCSIM/tests -q
.venv/Scripts/python Server/manage.py test Server.inventory --noinput
```

Django cần database test riêng và tài khoản CREATEDB. Xem hướng dẫn để bật kiểm thử
MQTT/process. Test TCP không thay thế COM/ESP32 hoặc hai máy vật lý. Compose chưa
được chạy ở môi trường hiện tại vì chưa có Docker.
