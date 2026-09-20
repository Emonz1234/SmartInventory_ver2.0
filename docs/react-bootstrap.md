# React và dữ liệu nền tập trung

Frontend cũ `IPCSIM/frontend` được tái sử dụng cho cả IPC và IPCSIM: Dashboard,
Cabinets, môi trường, breakdown, log; trang Inventory/Operation dùng cùng workspace
đăng nhập Django qua FastAPI. React không gọi PostgreSQL, MQTT hoặc Serial trực tiếp.
FastAPI phục vụ build tại `/ui/`, API yêu cầu EDGE_API_TOKEN; quyền vận hành được
Django kiểm tra thêm qua tài khoản Admin/Operator/Viewer.

## Bootstrap

Backup PostgreSQL bằng pg_dump trước nâng cấp. Nâng cấp core edge (migration SQLite
bổ sung cột, không xóa journal), chạy migration Django rồi bootstrap tường minh:

```powershell
.venv/Scripts/python Server/manage.py migrate
.venv/Scripts/python Server/manage.py bootstrap_inventory --demo-catalog --demo-locations --dry-run
.venv/Scripts/python Server/manage.py bootstrap_inventory --demo-catalog --demo-locations --credentials-file backups/bootstrap-devices.json
```

Lần chạy lại bỏ `--credentials-file` hoặc dùng tên file mới. Không ghi đè file
secret, không in secret ra console; lấy DEVICE_SECRET đúng device từ file này,
MQTT_PASSWORD phải provision riêng trong broker. Khi đã có registry, giữ nguyên
secret và DEVICE_ID. Ví dụ cấu hình hiện có IPCSIM1 thì thêm
`--sim-device-id IPCSIM1` vào cả lệnh dry-run và lệnh thực thi.

Bootstrap không chạy lúc khởi động. Lặp lại giữ tên/mô tả và thông tin Admin đã
chỉnh sửa; xung đột mapping hoặc cabinet đang thuộc device khác làm rollback toàn bộ.
Không sửa tồn kho, không tạo operation/ledger; không seed độc lập tại IPC.
Không chọn database legacy có dữ liệu làm DB_PATH edge mới; xem runbook import.

## Topology

IPC1 có các mã tủ **1, 2, 3, 4, 5, 6**, tên mặc định `IPC1 - Cabinet N`, trạng thái
`pending_hardware`. Chưa có đặc tả rack/address/ô chứa nên để rỗng, không tạo hardware
hoặc trả phản hồi thành công giả. Mã tủ là ID logic; khóa database là global PK.

Simulation hiện có **21 group, mỗi group 6 rack**, không phải 21 rack đơn.
Nguồn định nghĩa: `Simulation/topology.py` và controller mô phỏng.

| Group | Địa chỉ Serial rack |
|---|---|
| 1 | 1–6 |
| 2 | 7–12 |
| 3 | 13–18 |
| 4 | 19–24 |
| 5 | 25–30 |
| 6 | 31–36 |
| 7 | 37–42 |
| 8 | 43–48 |
| 9 | 49–54 |
| 10 | 55–60 |
| 11 | 61–66 |
| 12 | 67–72 |
| 13 | 73–78 |
| 14 | 79–84 |
| 15 | 85–90 |
| 16 | 91–96 |
| 17 | 97–102 |
| 18 | 103–108 |
| 19 | 109–114 |
| 20 | 115–120 |
| 21 | 121–126 |

Simulation không định nghĩa ô chứa vật tư. Database/seed cũ chỉ có shelf
`A-R01-S01`, ba bin `A-R01-S01-B01..03` capacity 100 tại rack address 1.
`--demo-locations` tạo đúng ba vị trí này; không nhân cấu trúc giả cho 126 rack.
Admin có thể khai báo shelf/bin logic qua Server trong phạm vi đã được đặc tả.

`--demo-catalog` tạo 2 loại MECHANICAL/ELECTRICAL và 5 item đánh dấu `is_demo`:
A1001 Motor Bearing (pcs), B2002 Coupling Assembly (pcs), C3003 Hydraulic Seal (pcs),
D4004 Sensor Cable (m), E5005 Control Board (pcs). Số lượng ban đầu không được tạo.

## Schema và quản trị

Migration Django 0005 bổ sung Category, Item.category/description/is_active/is_demo,
Cabinet.description/configuration_status/topology_locked và AuditLog. SQLite migration
4 bổ sung các cột read model tương ứng, giữ runtime/pending/outbox. Cabinet nằm trong
domain IPC hoặc IPCSIM, gán device; rack address duy nhất trong scope device.

Control Center → Danh mục cho phép chọn item/category/cabinet/rack/shelf/bin,
thêm hoặc chọn bản ghi để sửa; `is_active=false` vô hiệu hóa item mới cho operations.
Cabinet bootstrap khóa code/group; rack address và quan hệ topology không đổi tùy ý.
Backend PROTECT cấm xóa các vị trí/item có tham chiếu tồn kho/lịch sử.
Nhật ký hiển thị audit before/after, actor và thời điểm. Tồn kho không có API sửa số
lượng trực tiếp; ADJUST phải qua operation, xác nhận bằng chứng và ledger.

Bootstrap tạo nhóm Viewer (đọc), Operator (đọc + tạo/xác nhận operation), Admin
(quyền inventory). Gán user vào nhóm tại Django `/admin/`; không tự tạo user/password.
Giao diện khóa các form theo permission, backend vẫn kiểm tra độc lập.

Sau commit, `refresh` so sánh snapshot scope và phát delta qua persistent outbox.
Đổi item/category được phân phối cho các device dùng catalog chung; đổi cabinet chỉ
làm tăng revision device liên quan. Full sync vẫn staging/checksum/atomic apply;
ACK sau commit, duplicate không ghi nhận thêm. Offline đọc cache và lưu telemetry;
thay đổi inventory yêu cầu online và revision đã xác nhận.

## Lưu ý môi trường hiện tại

Database cấu hình tại Server/.env (localhost:5432) chưa kết nối được trong lần kiểm
tra này; bootstrap đã chạy trên database test riêng, chưa áp dụng vào database đó.
IPCSIM/.env hiện dùng IPCSIM1 và MQTT_HOST=IPCSIM1: hostname này phải phân giải tới
máy broker thực tế. Không tự đổi identity/secret/đường dẫn của database hiện hữu.
Virtualenv hiện tham chiếu một Python312 không còn ở đường dẫn cũ: tạo venv mới
(ví dụ `.venv-react`) bằng Python 3.12 đang cài và cài requirements, không xóa venv cũ.
