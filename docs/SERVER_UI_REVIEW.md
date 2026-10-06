# Giao diện vận hành Server

## Thay đổi

- Dashboard: sức khỏe hệ thống, IPC online/offline, cabinet/rack khả dụng, lỗi đang hoạt động, bản ghi chờ đồng bộ, cảnh báo tồn kho; thao tác nhanh và liên kết tới đúng cảnh báo/thiết bị/giao dịch/sản phẩm.
- Sidebar: Tổng quan → Kho hàng → Thiết bị → Giám sát → Quản trị. Menu và hành động theo grant/scope hiện có; không suy đoán quyền từ tên role.
- Thiết bị: cây IPC → Cabinet → Rack, trang Racks riêng, trạng thái dễ hiểu, chi tiết bằng drawer, thông tin kỹ thuật thu gọn. Cabinet đầu tiên và cabinet có lỗi được mở để giảm chiều dài trang.
- Hàng hóa: lọc ngang, REAL trước SIMULATION, tên cabinet/rack và thao tác nghiệp vụ. Drawer giữ context danh sách; chọn mặt hàng mô phỏng chuyển wizard sang đúng nguồn.
- Nhập/xuất: wizard sáu bước dùng PUT/PICK hiện có. Chờ `execution_state=completed`, yêu cầu kiểm đếm và ghi nhận bằng chứng trước khi gọi API xác nhận. Popup thành công có sản phẩm, số lượng, vị trí và thời gian.
- Cảnh báo, đồng bộ, lịch sử, vị trí kho, môi trường và quản trị dùng cùng kiểu bảng, badge, button, empty/loading/error state. Hành động cảnh báo hiện trực tiếp, thay vì chỉ nằm trong menu dấu ba chấm.

## File và component

- `Server/frontend/src/main.jsx`: điều hướng, quyền, các trang thiết bị/cảnh báo/đồng bộ/lịch sử/quản trị và drawer vị trí kho.
- `Server/frontend/src/ui.jsx`: `DetailDrawer`, `TechnicalDetails`, header có mô tả, bảng và badge dùng chung.
- `Server/frontend/src/OperationsDashboard.jsx`: Dashboard vận hành mới.
- `Server/frontend/src/DeviceViews.jsx`: `DeviceTree` và hàm đọc trạng thái thiết bị từ dữ liệu thật.
- `Server/frontend/src/StockWizard.jsx`: wizard nhập/xuất, checkpoint trong sessionStorage theo người dùng, request key và command ID ổn định.
- `Server/frontend/src/Inventory.jsx`, `RackCommands.jsx`, `style.css`, `locales/messages.json`: danh sách/drawer hàng hóa, quyền điều khiển, thiết kế đồng nhất và nhãn trạng thái song ngữ.
- `Server/inventory/console.py`, `overview.py`: bổ sung **chỉ đọc** hai trường `active_errors`, `pending_sync` trong GET `/api/ipcs`. Không có quyền `alarm.view`/`inventory.view` tương ứng thì trả `null`.
- `Server/inventory/test_console.py`, `tests/server_operator_ui_browser.cjs`, `tests/server_commands_browser.cjs`: kiểm tra API thống kê/phân quyền và UI nghiệp vụ.

## Logic được giữ nguyên

- Không thay schema, migration, tồn kho, MQTT payload, đồng bộ, authentication hoặc cơ chế grant/scope.
- Gửi PUT/PICK qua POST `/api/operations`; xác nhận qua POST `/api/operations/{id}/confirm`, giữ nguyên kiểm tra backend và idempotency.
- Không tự xác nhận hàng hóa khi chỉ gửi lệnh; không tự reset, resume, đóng cabinet hoặc hủy command đang chạy.
- Tải lại trang giữ command/request ID, loại giao dịch, sản phẩm, số lượng, nguồn và vị trí. Khi kết quả gửi không rõ, đối soát dùng cùng request key.
- Luồng ghi nhận thủ công, chuyển/mượn/trả và điều chỉnh tồn vẫn giữ API hiện có; ghi nhận thủ công nằm trong mục thu gọn ở lịch sử giao dịch.

## Kiểm tra

- Build frontend Server và IPCSIM thành công; kiểm tra i18n 30 case đạt.
- 17 kiểm tra Django về overview/console/tồn kho/phân quyền đạt, bao gồm thống kê IPC không thay dữ liệu và không lộ số liệu ngoài quyền.
- Kiểm tra tích hợp MQTT cô lập đạt: Server → MQTT TCP → IPC runtime → Simulation; OPEN/CLOSE, phản hồi thực, gửi trùng, lỗi, mất Serial và timeout.
- Kiểm tra trình duyệt với fixture API cô lập: toàn bộ trang Server, drawer, REAL/SIMULATION, nhãn tiếng Việt/Anh, liên kết cảnh báo, PUT/PICK sáu bước, lỗi khóa xác nhận, refresh không gửi lại lệnh, double-click gửi/xác nhận, quyền hạn chế và không tràn ngang ở 1366×768, 1920×1080, 1280×720, 768×1024.
- Ảnh kiểm tra: `test-results/server-operator/`.

## Giới hạn và áp dụng

- Xử lý lỗi vật lý và resume vẫn diễn ra tại IPC/Simulation theo luồng hiện có; Server theo dõi phản hồi. Không thêm API điều khiển phục hồi mới.
- Wizard cần `inventory.view`, `inventory.move` và `cabinet.view` trong nguồn tương ứng; thiếu quyền theo dõi lệnh sẽ hiển thị hướng dẫn, không gửi lệnh không thể theo dõi.
- Không thử điều khiển thiết bị vật lý triển khai thực tế trong đợt kiểm tra này. Kiểm tra UI dùng fixture, kiểm tra MQTT dùng Simulation thật trong môi trường cô lập.
- Không cần migrate database. Rebuild/restart dịch vụ web Server theo tài liệu khởi động để áp dụng assets mới và hai trường thống kê chỉ đọc; sau đó tải lại trình duyệt.


## Navigation update — 2026-10-06

- Dashboard is a standalone first navigation item. Inventory, Devices, Monitoring and Administration use one expanded accordion at a time; page changes open the matching group.
- Desktop navigation collapses to icons with native tooltips and a submenu flyout. Small screens use an overlay drawer that closes after selection.
- A fixed top bar contains the navigation toggle, existing language selector, active alarm dropdown and account/logout menu. Breadcrumbs identify the current page independently of the sidebar.
- Alarm counts represent active alarms, not unread notifications: the existing API has no unread state. Alarm links preserve source scope and select the corresponding alarm ID. Account information uses the current session; no unsupported password-change action is added.
- Existing page selection, API contracts, authentication, grants, source scopes and business workflows remain in use. No backend or database changes.
- Verification: Server frontend build; 30 i18n checks; isolated Playwright suite covering all pages, accordion navigation, active menu, collapsed flyout, notification links, account information, language change, logout, inventory permissions, mobile drawer, viewport overflow and existing PUT/PICK workflows. Screenshots inspected for desktop collapse and mobile drawer. API fixtures only.


## Warehouse catalog update — 2026-10-06

- Warehouse navigation now includes Overview, Products, Categories, Receive/Issue, Transaction history and the existing Storage map.
- `CatalogManagement.jsx` provides WarehouseOverview, Categories, CategoryForm, ProductEditor, ProductActions and confirmation dialogs. Product metadata is shared across REAL/SIMULATION; stock remains separated by environment.
- Product forms group basic information, stock thresholds and barcode. Category names are selected with a dropdown; inline category creation preserves the product draft and selects the new category. Required/numeric fields show validation feedback; duplicate SKU and referenced-delete failures use operator language.
- Existing categories/items/goods CRUD, inventory-overview, inventory-transactions and audit-logs APIs are reused. Minimal backend additions: Category.is_active with migration 0004, rejection of newly assigned inactive categories, explicit duplicate SKU error, and optional resource/object_id filters for audit logs.
- Default product lists hide inactive products; inactive records remain accessible via status filtering. Bulk activation/deactivation/category moves and deletion reuse existing CRUD one product at a time, confirm affected names and report partial failures. Database PROTECT remains authoritative for safe deletion.
- Product detail keeps transaction/location history and existing stock operations; metadata changes do not edit quantity. Adjustment still uses ADJUST transactions with reason, expected quantity and an explicit confirmation.
- Shared catalog mutations still require existing inventory.create/update/delete permissions with ALL scope. Physical inventory actions retain environment scope; metadata audit history requires audit.view with ALL scope. No new permission names or authentication changes.
- Validation: frontend build, 30 localization checks, migration consistency check, 19 Django console/overview tests, and isolated browser coverage for category creation/edit/deactivation, product creation with inline category/draft retention, duplicate SKU/required fields, bulk deactivation/inactive filtering, permissions, responsive navigation and existing PUT/PICK flows. Screenshots: test-results/server-operator/catalog-product-form.png and catalog-categories.png.
- Existing schema has no supplier module, separate stock-tracking switch, category update timestamp, or distinct warning threshold apart from min/max stock. These fields are not fabricated. Export is not added because no existing export workflow is available. Category deactivation prevents new assignments and does not silently deactivate existing products.
- Deploy requires applying migration 0004 through the existing migrate service, then rebuilding server/worker/web. Live production data has not been changed by these fixture tests.
