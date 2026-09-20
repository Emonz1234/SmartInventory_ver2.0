# Simulation dashboard

## Khởi chạy và kết nối

```powershell
.venv/Scripts/python -m pip install -r Simulation/requirements.txt
.venv/Scripts/python Simulation/main.py
```

Cũng có thể chạy `python main.py` từ thư mục Simulation hoặc
`python -m Simulation.main` từ root. Giao diện dùng PyQt6 và QPainter hiện có;
không cần thư viện đồ thị, web server hay database mới.

- Chọn **Standalone (no IPC connection)** để thử mô phỏng tại chỗ. Start khởi tạo
  sáu giá thuộc nhóm; các nút Open/Close/Ventilate/Light tác động lên giá đang chọn.
- Để nối IPCSIM, nhập/chọn đầu cổng virtual COM tại Simulation. Đầu còn lại là
  `SERIAL_PORT` của IPCSIM, cùng baudrate 9600. Lệnh vận hành đến từ IPCSIM;
  các nút vận hành tại chỗ bị khóa, nút mô phỏng lỗi vẫn hoạt động.
- Có thể đặt sẵn `SIMULATION_SERIAL_PORT_<group-index>` (index 0–20), hoặc
  `SIMULATION_SERIAL_PORT` cho một nhóm. Không tự chọn cổng phần cứng. Mỗi nhóm
  hoạt động đồng thời cần cổng riêng; giao diện chặn trùng cổng.
- Lỗi mở/mất Serial được báo bằng badge đỏ; rê chuột lên trạng thái kết nối để
  xem chi tiết. Sửa cổng rồi Start lại. Không tự reconnect hoặc replay lệnh cũ.
- Chọn lỗi rồi **Apply / clear faults** để áp dụng cho giá đang chọn. Bỏ chọn và
  nhấn lại để xóa lỗi. Giá lỗi tạm dừng tại vị trí hiện tại; xóa lỗi sẽ tiếp tục
  chuyển động đang chờ. Những giá khác và dữ liệu môi trường vẫn chạy.

## Bố cục và nguồn dữ liệu

Sidebar có 21 nhóm, cuộn riêng, có màu trạng thái phiên/lỗi. Sáu giá trên canvas
có thể nhấn để chọn, đồng bộ với dãy nút Rack. Vị trí, trạng thái chuyển động,
khóa và lỗi lấy từ dữ liệu controller; trước Start hiển thị chưa có dữ liệu.

Các thẻ ENV giữ nguyên giá trị mô phỏng: nhiệt độ °C, khối lượng kg, độ ẩm % RH,
Smoke CLEAR/DETECTED, Light OFF/ON, Hard Locked UNLOCKED/LOCKED. Light lấy từ
biến `lights` của controller, kể cả khi bật đèn trong lúc chuyển động. Không suy
diễn trạng thái kết nối IPC từ việc có dữ liệu giả lập: Standalone ghi rõ không
kết nối IPC; “Serial connected” chỉ xác nhận mở được cổng, không phải MQTT/Server ACK.

Canvas là hình vector co giãn, giữ sáu khoang tủ, nhãn và tay nắm; khe mở phản ánh
độ dịch chuyển trong phạm vi một khoang. Không thay đổi mô hình chuyển động hay
giới hạn displacement 64 của simulator. Các giá trị speed/displacement được giữ
nguyên, hiển thị theo quy ước m/s và m của yêu cầu; không có phép đổi đơn vị.

## Biểu đồ và vòng đời phiên

- Hai đồ thị riêng Speed và Displacement, trục Y độc lập, chung trục X tính bằng
  giây đã trôi qua. Timestamp lấy bằng `time.monotonic()` ngay tại `_publish`,
  trước khi Serial write; không lấy thời điểm UI xử lý tín hiệu, không dùng chỉ số mẫu.
- Metadata timestamp và Light chỉ đi qua hàng đợi/tín hiệu nội bộ. Các frame
  `ENVSTT`, `OPRSTT`, `BRKSTT` và lệnh `0|rack_id|action` không đổi.
- Mỗi giá có deque riêng, tối đa 600 mẫu và 60 giây gần nhất theo timestamp nhận.
  Hai đồ thị dùng cùng cửa sổ thời gian trượt. Timer 200 ms chỉ yêu cầu vẽ lại
  biểu đồ đang hiển thị, không thêm dữ liệu. Nếu không có OPRSTT mới, không nội suy
  thêm mẫu hoặc tự tạo số 0 để lấp đồ thị.
- Chỉ nhận mẫu hữu hạn, không âm, đúng rack/phạm vi và đúng thứ tự timestamp.
  Chuyển Rack/Group hoặc resize không xóa/trộn lịch sử.
- Stop/mất Serial dừng đồng hồ biểu đồ, giữ dữ liệu cuối cùng; không ghi một mẫu
  tốc độ 0 giả. Badge phiên cho biết dữ liệu đang được giữ từ phiên đã dừng.
- Start lại mở phiên mới: reset trạng thái cả sáu giá và toàn bộ buffer của nhóm,
  mốc thời gian mới t = 0. Không giữ lệnh đang chờ từ phiên cũ.

Giao thức Serial cũ không mang command_id. Lệnh trùng khi đang chạy không tạo thêm
chuyển động, lệnh ngược chiều khi chưa xong bị bỏ qua; không có bảo đảm chống replay
một lệnh mới sau khi chuyển động đã hoàn tất. Journal của IPC chịu trách nhiệm retry
nghiệp vụ theo thiết kế hệ thống.

## Tổ chức mã và kiểm tra

- `Simulation/simulation_scroll.py`: layout, palette, sidebar và các nhóm panel.
  Đây là mã được bảo trì trực tiếp, không còn là output của Qt Designer.
- `Simulation/dashboard_widgets.py`: MetricCard, RackCanvas, OperationChart.
- `Simulation/main.py`: nối sự kiện, cache theo nhóm/giá, quản lý QThread, chọn giá.
- `Simulation/virtual_serial/virtual_master_controller.py`: state mô phỏng,
  Serial và metadata thời điểm phát mẫu. Một thread sở hữu Serial cho mỗi nhóm.

```powershell
.venv/Scripts/python -m pytest tests IPCSIM/tests -q
.venv/Scripts/python tools/render_simulation.py
```

Kiểm tra GUI dùng QApplication/QThread thật với Qt offscreen; kiểm tra kết nối
dùng SerialWire hai chiều và pyserial `loop://`, không cần cổng COM vật lý.
Bao gồm 21 nhóm, chọn giá, nhiều giá chuyển động, lỗi/xóa lỗi, cổng sai/mất kết nối,
Stop/Restart, shutdown, timestamp không đều, giới hạn bộ nhớ và giữ lịch sử khi đổi
giá/nhóm/resize. Kiểm tra layout ở 1920×1080, 1440×900, 1280×720, 1024×768;
800×600 có cuộn nội dung để không mất nút chức năng. Ảnh chụp thực tế nằm trong
`test-results/simulation/` (không đưa vào Git).

Chưa xác nhận qua cặp virtual COM/ESP32 thật trên máy người dùng. Những kiểm tra
trên không thay thế bài kiểm tra kết nối vật lý hoặc cấu hình driver COM thực tế.
