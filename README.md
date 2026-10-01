# Smart Inventory

Server Django/PostgreSQL quản lý IPC01 và IPCSIM01 qua MQTT. IPC và IPCSIM dùng chung runtime, API và nghiệp vụ; dữ liệu được phân theo `REAL` và `SIMULATION`.

## Hướng dẫn

- [Cài đặt lần đầu](docs/first-time-setup.md)
- [Khởi chạy và dừng](docs/startup.md)
- [Reset database development và seed demo](docs/sample-databases.md)
- [Sử dụng Inventory](docs/server-inventory.md)

## Thành phần

- `Server/`: Django API, PostgreSQL, web console và MQTT worker.
- `ipc_core/`: runtime, đồng bộ, SQLite và Serial dùng chung.
- `IPC/`, `IPCSIM/`: cấu hình và launcher từng edge.
- `Simulation/`: GUI mô phỏng Serial.
- `deploy/`: Docker Compose, MQTT ACL/TLS và secrets.

Điều khiển REAL bị khóa mặc định cho đến khi phần cứng được kiểm tra. Simulator hỗ trợ group 1–21.
