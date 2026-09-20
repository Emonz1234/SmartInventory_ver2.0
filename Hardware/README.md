# Hardware — chưa triển khai

Chưa có firmware/ESP32. IPC mặc định `HARDWARE_ENABLED=false`: không mở Serial
hoặc gửi lệnh đến phần cứng. Không coi mock test là bằng chứng hardware hoạt động.

Điểm tích hợp: `ipc_core/adapters.py::HardwareAdapter`,
`ipc_core/app/serial/serial_manager.py`, `Runtime.send_checked` và journal
`Store.execute`. JSON adapter đang giữ định dạng prototype để tham chiếu,
chưa phải hợp đồng firmware đã được xác nhận.

Trước khi cho phép tích hợp thực: chốt address, đơn vị cảm biến, command_id,
ACK tiếp nhận, ACK kết quả, truy vấn trạng thái operation, interlock và cơ chế
dừng khẩn cấp. Kiểm thử mất nguồn sau Serial write; không replay chuyển động chỉ
vì thiếu ACK. Khi có firmware thật mới bật HARDWARE_ENABLED sau kiểm thử an toàn.
