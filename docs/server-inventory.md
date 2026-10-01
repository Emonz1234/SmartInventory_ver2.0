# Sử dụng Inventory tại Server

**Luồng:** chọn nguồn → tìm sản phẩm/vị trí → xem chi tiết → đối soát nếu cần.

## Demo và thực tế

| Khái niệm | Ý nghĩa |
|---|---|
| Database demo | Dữ liệu seed để kiểm thử UI; không phải hàng thực |
| Database vận hành | Dữ liệu sử dụng với IPC/IPCSIM qua MQTT |
| REAL | Nguồn IPC được cấu hình là thiết bị thực |
| SIMULATION | Nguồn IPCSIM mô phỏng |

**REAL trong database demo vẫn là dữ liệu mẫu.** REAL và SIMULATION không cộng chung số lượng.

## Tìm hàng

- **By Product:** tìm theo tên/SKU/barcode; xem total, available, số vị trí và trạng thái.
- **By Location:** xem cây IPC → Cabinet → Rack → Product, kể cả rack trống.
- Lọc theo nguồn, IPC, Cabinet, Category, Stock Status, Sync Status.
- Mặc định REAL; bật **Show Simulation Data** để xem thêm SIMULATION.
- Filter IPC/Cabinet tìm sản phẩm phù hợp; tổng và drawer vẫn gồm mọi vị trí trong nguồn đó.

## Chi tiết và điều chỉnh

Click sản phẩm để xem thông tin, các location và Transactions (100 dòng/trang).
Chọn location → **Inventory Adjustment** → nhập New Quantity và Reason → kiểm tra Difference → xác nhận.

Server lấy User từ session, lưu timestamp và audit before/after.
Từ chối nếu số lượng đã đổi hoặc vượt capacity. Không sửa Stock.quantity bằng CRUD.

## Đọc trạng thái

| Trạng thái | Cách hiểu |
|---|---|
| Normal / Low Stock / Out of Stock | Tính theo tổng từng nguồn và Min Stock |
| Available Quantity | Loại trừ vị trí reserved, BUSY, hard-locked, FAULT hoặc đang có operation chờ |
| FULL | Hết chỗ chứa; vẫn có thể lấy hàng |
| Synced / Pending | IPC đã/chưa xác nhận dataset hiện tại; không phải biên nhận riêng từng transaction |
| Failed (sync) | Giao dịch offline xung đột cần đối soát, chưa được cộng vào tồn Server |
| ONLINE / OFFLINE | Dựa trên heartbeat nhận được; hết 45 giây không nhận sẽ OFFLINE |

Dashboard tách tồn REAL/SIMULATION, hiển thị cảnh báo tồn kho, đồng bộ và trạng thái IPC.
Server quản lý/tổng hợp; vận hành cabinet tại IPC/IPCSIM.

**Chạy hệ thống:** [Startup](startup.md). **Reset dữ liệu demo:** [Reset database development](sample-databases.md).
