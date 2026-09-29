# Hợp đồng tích hợp Hardware

IPC mặc định `HARDWARE_ENABLED=false`: không mở Serial hoặc gửi lệnh đến phần cứng.
Thư mục `esp32_master_serial/` chứa mã thử nghiệm riêng; chưa xem đó là tích hợp
end-to-end đã được nghiệm thu với Server và IPC.

Điểm tích hợp: `ipc_core/adapters.py::HardwareAdapter`,
`ipc_core/app/serial/serial_manager.py`, `Runtime.send_checked` và journal
`Store.execute`. JSON adapter giữ định dạng prototype để tham chiếu,
chưa phải hợp đồng firmware đã được xác nhận.

Trước khi bật điều khiển REAL, đối chiếu address, đơn vị cảm biến, command_id,
ACK tiếp nhận, ACK kết quả, truy vấn trạng thái operation, interlock và dừng khẩn cấp.
Kiểm tra mất nguồn sau Serial write; không replay chuyển động chỉ vì thiếu ACK.
`sent` không chứng minh phần cứng hoặc thao tác kho đã hoàn tất.

Cài đặt và vận hành: [lần đầu](../docs/first-time-setup.md),
[các lần sau](../docs/startup.md).
