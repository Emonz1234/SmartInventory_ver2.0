# IPC với firmware ESP32 hiện tại

IPC dùng chung backend `ipc_core`, database cache, đồng bộ MQTT và giao diện trong `IPCSIM/frontend`. Adapter phần cứng đọc giao thức của `esp32_master_serial/src/main.cpp`; không cần sao chép ứng dụng IPCSIM.

## Kết nối và khởi chạy

Firmware đang gửi bằng `Serial.println(payload)` qua USB ở **115200 baud**. `Serial2.println(payload)` bị comment nên chân UART RX16/TX17 chưa gửi dữ liệu. Đóng Serial Monitor trước khi IPC mở cùng cổng COM.

Trong `IPC/.env`, đặt cổng USB thực tế:

```dotenv
DEVICE_TYPE=IPC
HARDWARE_ENABLED=true
SERIAL_PORT=COM9
SERIAL_BAUDRATE=115200
EDGE_API_PORT=8002
```

Giữ `DEVICE_ID`, `DB_PATH`, API token và thông tin MQTT riêng cho IPC. `HARDWARE_ENABLED=true` cho phép kết nối nhận telemetry. Firmware chưa nhận lệnh, nên IPC vẫn chặn gửi OPEN/CLOSE/VENTILATE/LIGHT/HOME và báo `hardware_commands_supported=false`, `local_operation_available=false` trong `/api/system/health`.

```powershell
.venv/Scripts/python IPC/main.py
```

Mở `http://127.0.0.1:8002/ui/`. Trên Server, gán rack có địa chỉ Serial **1** cho IPC tương ứng và chờ đồng bộ database. Firmware cố định `RACK_ID=1`; đây là địa chỉ giao tiếp, không phải khóa chính database. Listener tra `Rack.rack_code` để lưu snapshot đúng rack. Địa chỉ chưa được gán sẽ không tạo snapshot hoặc gửi telemetry lên Server.

## Ánh xạ dữ liệu

Ví dụ firmware gửi một dòng JSON kết thúc bằng newline:

```json
{"rack_id":1,"temperature":28.5,"humidity":65,"gas":2100,"gas_alert":true}
```

| ESP32 | IPC / Server | Ý nghĩa |
|---|---|---|
| `rack_id` | Địa chỉ Serial → rack database | Giữ địa chỉ gốc trong bản tin MQTT |
| `temperature` | `temperature` | °C từ DHT11 |
| `humidity` | `humidity` | % từ DHT11 |
| `gas` | `gas` | ADC MQ2 0–4095; chưa quy đổi ppm |
| `gas_alert` | `gas_alert` và `smoke` 0/1 | Dùng cờ firmware cho luồng cảnh báo hiện có |

Firmware bật cảnh báo khi `gas > 2000`, gửi mỗi 5 giây bình thường hoặc 2 giây khi cảnh báo. Cờ `smoke` trong hệ thống biểu diễn cảnh báo MQ2 của firmware, không phải phép đo khói riêng. Không suy ra cảnh báo từ việc ADC khác 0. Firmware không gửi cân nặng, trạng thái motor, breakdown hoặc ACK; các giá trị đó không được tạo giả.

`START SYSTEM` và `DHT ERROR` được nhận diện là dòng chẩn đoán, không lưu thành telemetry. Khi DHT lỗi, firmware bỏ qua mẫu; IPC không tạo mẫu thay thế. Adapter kiểm tra địa chỉ, giá trị số hữu hạn, miền ADC và kiểu boolean của `gas_alert`. Serial manager giữ các đoạn JSON bị chia bởi timeout cho tới khi nhận newline.

## Kiểm tra

Log cần có `Serial Connected`, `PARSED (Serial) msg_type=telemetry`, `[MAP]` và `[DB] Saved environment snapshot`. Server nhận `telemetry.sample` với địa chỉ rack gốc và cờ cảnh báo đã ánh xạ. Kiểm tra nguồn **PHYSICAL** hoặc **ALL** trên Server.

```powershell
.venv/Scripts/python -m pytest tests/test_esp32_adapter.py tests/test_serial_transport.py tests/test_serial_location.py tests/test_edge.py -q
```
