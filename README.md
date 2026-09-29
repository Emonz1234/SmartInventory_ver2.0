# Smart Inventory

Server Django/React/PostgreSQL quản lý IPC1 và IPCSIM qua MQTT. Hai loại thiết bị
sử dụng chung core, API và nghiệp vụ; dữ liệu thiết bị và tồn kho phân theo REAL/SIMULATION.
Simulation nối IPCSIM qua Serial; mỗi edge có SQLite và cấu hình riêng.

## Hướng dẫn

1. **[Cài đặt lần đầu](docs/first-time-setup.md)** — cấu hình Docker Compose cho Server,
   PostgreSQL/MQTT, bootstrap database, backup và cấu hình edge.
2. **[Khởi chạy từ lần thứ hai](docs/startup.md)** — lệnh Docker bật/tắt Server và
   khởi chạy Simulation, IPCSIM, IPC1 sau khi setup.

## Cấu trúc chính

| Thư mục | Vai trò |
|---|---|
| `Server/` | Backend Django, React, dữ liệu trung tâm và MQTT worker |
| `ipc_core/` | Runtime, API, đồng bộ, SQLite và Serial dùng chung |
| `IPC/`, `IPCSIM/` | Launcher và cấu hình riêng cho từng instance |
| `IPCSIM/frontend/` | UI React local dùng chung cho IPC/IPCSIM |
| `Simulation/` | Mô phỏng rack và GUI PyQt6 |
| `deploy/`, `tools/`, `tests/` | Đóng gói, tiện ích cấu hình và kiểm thử |
| `Hardware/` | Ghi chú hợp đồng tích hợp phần cứng |
| `legacy/` | Mã lịch sử để đối chiếu |

Bootstrap mới tạo IPC1 1 group × 6 rack và IPCSIM 22 group × 6 rack.
Simulator hiện hỗ trợ 21 group; group thứ 22 chờ tích hợp. Điều khiển REAL vẫn bị
khóa mặc định cho đến khi phần cứng được kiểm tra. Xem [ghi chú Hardware](Hardware/README.md).
