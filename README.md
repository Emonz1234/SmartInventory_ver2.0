# Smart Inventory System

Architecture: **Server ↔ IPC/IPCSIM ↔ Hardware/Simulation**.

Server quản lý kho tập trung; IPC/IPCSIM đồng bộ qua MQTT, giữ database cục bộ và giao tiếp thiết bị qua Serial. Dữ liệu REAL và SIMULATION được phân biệt trong hệ thống.

## First installation

Xem [docs/FIRST_TIME_CONFIG.md](docs/FIRST_TIME_CONFIG.md).

## Normal startup

Xem [docs/START_UP.md](docs/START_UP.md).

## Main components

- `Server/`: Django/PostgreSQL, React console, MQTT worker.
- `ipc_core/`: runtime, SQLite, API, offline/sync và Serial dùng chung.
- `IPC/`: launcher cho Hardware; `IPCSIM/`: launcher và React UI cho edge.
- `Simulation/`: PyQt simulator, 22 nhóm × 6 rack.
- `Hardware/`, `esp32_master_serial/`: adapter contract và firmware ESP32.
- `deploy/`: Docker Compose, Nginx, Mosquitto ACL/TLS.

ESP32 hiện hỗ trợ telemetry USB Serial; điều khiển REAL vẫn bị khóa theo khả năng adapter.
