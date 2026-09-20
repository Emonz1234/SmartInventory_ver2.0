# Báo cáo thiết kế Backend và Frontend cho hệ thống IPCSIM

## 1. Mục đích báo cáo

Báo cáo này trình bày thiết kế kiến trúc, công nghệ triển khai và các luồng vận hành của hệ thống IPCSIM ở hai tầng chính:
- Backend: xử lý nghiệp vụ, API, kết nối serial và lưu trữ dữ liệu.
- Frontend: cung cấp giao diện người dùng để thao tác inventory, rack, telemetry và logs.

Mục tiêu của báo cáo là làm rõ:
1. Cấu trúc hệ thống hiện tại.
2. Công nghệ được sử dụng ở từng tầng.
3. Các module chính và trách nhiệm của từng module.
4. Luồng dữ liệu từ người dùng tới backend, serial bridge và simulation.
5. Các ràng buộc vận hành, mở rộng và nâng cấp trong tương lai.

---

## 2. Tổng quan hệ thống

IPCSIM là một hệ thống mô phỏng và quản lý kho rack, tích hợp các chức năng:
- Quản lý inventory và vị trí hàng hóa.
- Điều khiển rack mở/đóng.
- Theo dõi telemetry môi trường và vận hành.
- Cảnh báo breakdown và lỗi vận hành.
- Giao tiếp với simulation thông qua cổng serial.

### 2.1 Kiến trúc tổng thể

Hệ thống được tổ chức theo mô hình phân tầng:
- Tầng giao diện người dùng: Frontend React/TypeScript.
- Tầng API và nghiệp vụ: Backend FastAPI.
- Tầng kết nối thiết bị: Serial bridge.
- Tầng lưu trữ: Database SQLite qua SQLAlchemy.
- Tầng mô phỏng: Simulation/virtual controller.

### 2.2 Mối quan hệ giữa các tầng

```text
Người dùng -> Frontend -> Backend API -> Serial Bridge -> Simulation
                                     |                 |
                                     v                 v
                                Database          Telemetry/Events
```

---

## 3. Công nghệ thực hiện

### 3.1 Backend

Backend được xây dựng bằng các công nghệ sau:
- Python 3.x
- FastAPI: xây dựng REST API nhanh, rõ cấu trúc, hỗ trợ async.
- SQLAlchemy: ORM để thao tác database.
- SQLite: hệ quản trị cơ sở dữ liệu nhẹ, phù hợp hệ thống local/demo.
- PySerial: giao tiếp qua cổng serial với simulation.
- Uvicorn: server ASGI để chạy API.
- Pydantic: validate request/response model.

### 3.2 Frontend

Frontend được triển khai bằng:
- React 18
- TypeScript
- Vite: công cụ build và dev server nhanh.
- Material UI: giao diện hiện đại, component chuẩn.
- Axios: gọi API từ frontend.
- React Query: quản lý dữ liệu server state, cache, polling.
- React Router: điều hướng giữa các trang.

### 3.3 Công nghệ hỗ trợ khác
- Mermaid / Markdown: tài liệu kỹ thuật.
- REST API: chuẩn trao đổi dữ liệu giữa frontend và backend.
- Serial protocol: định dạng lệnh và message giao tiếp với simulation.

---

## 4. Thiết kế Backend

### 4.1 Mục tiêu của Backend

Backend có nhiệm vụ:
- Tiếp nhận request từ frontend.
- Kiểm tra điều kiện nghiệp vụ trước khi thực hiện thao tác.
- Gửi lệnh điều khiển tới simulation qua serial.
- Nhận phản hồi từ simulation.
- Lưu dữ liệu telemetry, vận hành, breakdown vào database.
- Cung cấp API cho frontend đọc trạng thái và lịch sử.

### 4.2 Cấu trúc module Backend

Backend được chia thành các module chính như sau:

1. API layer
   - Chịu trách nhiệm định nghĩa route và xử lý request/response.
   - Các module chính: inventory, cabinet, telemetry, dashboard, bins.

2. Service layer
   - Chứa logic nghiệp vụ.
   - Ví dụ: command service dùng để tạo và gửi lệnh tới rack.

3. Serial layer
   - Chịu trách nhiệm kết nối cổng COM và truyền nhận dữ liệu.
   - Bao gồm serial manager, listener, parser, builder.

4. Handler layer
   - Xử lý dữ liệu nhận được từ simulation.
   - Phân loại telemetry, event, acknowledgement.

5. Database layer
   - Quản lý models, schema và session kết nối database.

### 4.3 Các module backend chính

#### 4.3.1 API module
- Inventory API: quản lý hàng hóa, transaction pick/put/adjust.
- Cabinet API: quản lý cabinet và rack.
- Telemetry API: trả về dữ liệu môi trường, vận hành, breakdown.
- Dashboard API: tổng hợp trạng thái hệ thống.

#### 4.3.2 Command service
- Tạo lệnh điều khiển từ nghiệp vụ sang format serial.
- Ví dụ:
  - OPEN_RACK
  - CLOSE_RACK
  - VENTILATE_RACK

#### 4.3.3 Serial manager
- Mở kết nối với cổng serial.
- Ghi dữ liệu ra cổng.
- Đọc phản hồi từ simulation.

#### 4.3.4 Serial listener
- Chạy liên tục để nhận dữ liệu từ simulator.
- Chuyển dữ liệu tới parser và handler phù hợp.

#### 4.3.5 Protocol parser và builder
- Parser: chuyển raw string sang cấu trúc dữ liệu có thể xử lý.
- Builder: tạo message chuẩn trước khi gửi đi.

### 4.4 Cơ sở dữ liệu Backend

Database dùng ORM SQLAlchemy với các model chính:
- EnvironmentSnapshot: lưu dữ liệu môi trường như nhiệt độ, độ ẩm, trọng lượng, smoke.
- OperationSnapshot: lưu trạng thái vận hành rack như movement speed, displacement, endpoint, state.
- BreakdownSnapshot: lưu trục trặc như obstructed, skewed, overload motor.
- Rack, Cabinet, Inventory, Transaction: lưu dữ liệu nghiệp vụ kho.

### 4.5 Luồng xử lý Backend

#### 4.5.1 Khi nhận yêu cầu mở rack
1. Frontend gửi request tới API.
2. Backend kiểm tra rack tồn tại.
3. Backend kiểm tra breakdown active.
4. Nếu hợp lệ, backend tạo lệnh và gửi qua serial.
5. Backend nhận phản hồi từ simulator.
6. Backend lưu trạng thái vào database.
7. Frontend gọi lại API để cập nhật UI.

#### 4.5.2 Khi nhận telemetry từ simulator
1. Serial listener đọc dữ liệu từ cổng COM.
2. Parser phân tích dữ liệu.
3. Handler lưu dữ liệu vào database.
4. API đọc lại dữ liệu này để hiển thị cho frontend.

### 4.6 Yêu cầu phi chức năng Backend
- Độ ổn định khi kết nối serial không liên tục.
- Xử lý lỗi khi port không tồn tại hoặc bị khóa.
- Dễ mở rộng với các protocol mới.
- Có thể thay đổi database sang PostgreSQL trong tương lai.

---

## 5. Thiết kế Frontend

### 5.1 Mục tiêu Frontend

Frontend có nhiệm vụ:
- Cung cấp giao diện thao tác cho người dùng.
- Gửi request tới backend.
- Hiển thị dữ liệu telemetry, inventory, breakdown và status hệ thống.
- Cho phép người dùng theo dõi trạng thái rack theo thời gian thực hoặc polling.

### 5.2 Kiến trúc Frontend

Frontend được tổ chức theo các nhóm chính:
- Pages: các màn hình chính như Inventory, Cabinets, Operation, Logs, Breakdown.
- Components: các thành phần UI dùng lại như modal, sidebar, cards.
- API layer: module gọi backend.
- Hooks: wrapper cho logic truy vấn và mutations.
- Types: định nghĩa interface cho dữ liệu.

### 5.3 Cấu trúc màn hình chính

1. Dashboard
   - Tổng quan hệ thống.
   - Hiển thị số lượng rack, inventory, trạng thái serial.

2. Inventory
   - Tìm kiếm hàng hóa.
   - Thực hiện pick/put.
   - Theo dõi đợt mở/đóng rack.

3. Cabinets
   - Hiển thị danh sách cabinet và rack.

4. Cabinet Detail
   - Chi tiết từng rack.
   - Điều khiển mở/đóng rack, ventilation, clear breakdown.

5. Operation
   - Hiển thị dữ liệu vận hành rack.

6. Logs / Breakdown / Environment
   - Theo dõi lịch sử và trạng thái hệ thống.

### 5.4 Frontend state management

Frontend sử dụng:
- React Query để quản lý dữ liệu từ server.
- Local component state cho form và modal.
- Polling để cập nhật trạng thái vận hành theo thời gian thực.

### 5.5 Giao tiếp Frontend - Backend

Frontend gọi backend qua các API client như:
- cabinet API: mở/đóng rack, clear breakdown.
- system API: đọc telemetry, breakdown, operation.
- inventory API: thực hiện transaction.

### 5.6 UX và trải nghiệm người dùng

Giao diện cần đảm bảo:
- Hiển thị rõ lỗi nếu rack đang breakdown.
- Present trạng thái đang xử lý bằng thông báo hoặc modal.
- Cho phép người dùng biết rack đã mở xong hoặc đóng xong.
- Tạo trải nghiệm rõ ràng cho các thao tác pick/put.

### 5.7 Yêu cầu phi chức năng Frontend
- Giao diện phản hồi nhanh.
- Tương thích với màn hình desktop và tablet.
- Dễ mở rộng với thêm dashboard mới.
- Có thể tích hợp websocket hoặc realtime trong tương lai.

---

## 6. Luồng dữ liệu tổng thể

### 6.1 Luồng thao tác người dùng
1. Người dùng tương tác với UI.
2. Frontend gọi API tương ứng.
3. Backend kiểm tra và xử lý logic.
4. Backend gửi lệnh tới serial bridge.
5. Simulation thực thi hành động.
6. Simulation gửi phản hồi về backend.
7. Backend lưu trạng thái vào DB.
8. Frontend load lại dữ liệu và cập nhật UI.

### 6.2 Luồng dữ liệu telemetry
1. Simulation gửi telemetry qua serial.
2. Backend nhận và parse message.
3. Backend lưu snapshot vào database.
4. Frontend query API để hiển thị biểu đồ và bảng dữ liệu.

---

## 7. Bảo mật và quản trị lỗi

### 7.1 Bảo mật
- Backend nên bổ sung authentication/authorization trong tương lai.
- Cần kiểm soát quyền thao tác rack và inventory theo vai trò người dùng.
- Nên hạn chế lộ dữ liệu nhạy cảm qua API.

### 7.2 Xử lý lỗi
- Nếu rack không tồn tại, trả về lỗi 404.
- Nếu rack đang breakdown, chặn thao tác và báo cụ thể nguyên nhân.
- Nếu serial port không mở, backend phải phản hồi lỗi rõ ràng.
- Frontend cần hiển thị thông báo thân thiện cho người dùng.

---

## 8. Kiểm thử và đánh giá

### 8.1 Backend testing
- Kiểm thử API endpoint.
- Kiểm thử serial parsing và handler.
- Kiểm thử lưu dữ liệu và truy vấn database.
- Kiểm thử lỗi khi serial không hoạt động.

### 8.2 Frontend testing
- Kiểm thử UI flow cho inventory và rack control.
- Kiểm thử fetch API và error handling.
- Kiểm thử route navigation.
- Kiểm thử polling và cập nhật dữ liệu.

---

## 9. Triển khai đề xuất

### 9.1 Backend deployment
- Chạy bằng Uvicorn hoặc Gunicorn.
- Có thể triển khai trên máy chủ local hoặc VPS.
- Nên dùng môi trường ảo python riêng.

### 9.2 Frontend deployment
- Build bằng Vite.
- Có thể deploy trên static hosting hoặc reverse proxy.
- Nên cấu hình proxy cho API để tránh CORS.

---

## 10. Hướng phát triển trong tương lai

1. Bổ sung authentication và phân quyền.
2. Chuyển từ polling sang WebSocket hoặc SSE cho cập nhật thời gian thực.
3. Tách database sang PostgreSQL/MySQL cho production.
4. Thêm dashboard phân tích và báo cáo vận hành.
5. Tích hợp hệ thống log và monitoring chuyên sâu.
6. Thêm kiểm soát lỗi và rollback nghiệp vụ cho thao tác inventory.

---

## 11. Kết luận

Hệ thống IPCSIM được thiết kế theo mô hình phân tầng rõ ràng, với backend chịu trách nhiệm nghiệp vụ và giao tiếp thiết bị, còn frontend tập trung vào trải nghiệm người dùng và hiển thị dữ liệu. Việc kết hợp FastAPI, SQLAlchemy, PySerial, React, TypeScript, Vite, MUI và React Query tạo nên một kiến trúc vừa phù hợp cho mô phỏng, vừa có khả năng mở rộng cho sản phẩm thực tế.
