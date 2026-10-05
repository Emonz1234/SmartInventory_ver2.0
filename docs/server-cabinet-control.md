# Điều khiển tủ/rack từ Server

## Luồng hiện có

Nút OPEN/CLOSE/VENTILATE gọi `POST /api/racks/{database_id}/commands` với `command` và `request_key`. Server kiểm tra session/CSRF, quyền `cabinet.control` theo nguồn REAL/SIMULATION, heartbeat, revision, Serial, nhóm tủ và operation chưa được xử lý. Lệnh được ghi bền vào Operation/Outbox.

MQTT worker gửi `command.execute` QoS 1 trên `inventory/v1/{device_id}/down/command`. IPC kiểm tra revision, rack trong dataset, địa chỉ Serial và interlock trước khi ghi intent rồi gửi Serial. IPCSIM dùng cơ chế EXECUTE của RecoveryService và bộ điều khiển Simulation hiện có. Không đổi giao thức MQTT hoặc Serial.

`events.command_result.state=sent` chỉ xác nhận đã gửi tới Serial. Snapshot Simulation được đối chiếu bởi RecoveryService, có cùng command ID, đúng cabinet/address/action và bằng chứng cơ khí cuối mới phát `execution_state=completed`. Server giữ trạng thái xác nhận nghiệp vụ riêng: người vận hành vẫn cần ghi chú xác nhận kết quả trong bảng lệnh trước khi gửi lệnh tiếp theo. Timeout hoặc giao hàng không chắc chắn không được tự coi là thất bại không có tác động.

## Bằng chứng môi trường ngày 2026-10-05

Kiểm tra chỉ đọc container và `/api/system/health`:

- Container mqtt, worker, server, web đang chạy; các port 8883, 8080, 8000 đang nghe.
- Server: IPCSIM01 online, revision 2, acknowledged_revision 2; serial_connected=false.
- IPCSIM: server_online=true, server_synced=true, serial_connected=false, simulation_online=false, serial_groups={}, simulation_states=[].
- IPC01: offline, acknowledged_revision=0; không phát lệnh tới IPC vật lý.
- Operation IPCSIM `5d8f3b7f-f65d-4d55-91d3-177b8d96a8ee` có state=uncertain, execution_state=timeout; không có command Outbox trong lần kiểm tra.

Kết luận: liên lạc và đồng bộ MQTT đã hoạt động; chưa có đường Serial tới Simulation trong môi trường đang chạy. Không có bằng chứng một lệnh OPEN/CLOSE từ Server đã được thực hiện trong môi trường này. Operation chưa xử lý cũng chặn lệnh mới theo đúng nghiệp vụ.

## Cần thực hiện để dùng bản sửa

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build server worker web
```

Dừng rồi chạy lại IPCSIM để nạp bản sửa `ipc_core`:

```powershell
.venv/Scripts/python Simulation/main.py
.venv/Scripts/python IPCSIM/main.py
```

Chọn đúng đầu COM của Simulation và bấm Start; đầu COM còn lại phải khớp cấu hình IPCSIM (`SERIAL_PORT=COM2`, baud 9600 trong lần kiểm tra). Xác nhận Serial connected và Simulation online; với nhiều nhóm, dùng SERIAL_GROUP_PORTS theo cấu hình dự án. Chỉ vận hành nhóm đã thực sự kết nối, không bật hardware vật lý để thử.

Chọn SIMULATION trên Server. Kiểm tra operation timeout nêu trên bằng chứng thực tế rồi ghi nhận kết quả trong bảng lệnh MQTT. Không xóa operation, tự xác nhận thành công hay bỏ khóa để gửi được lệnh mới.

Theo dõi cùng operation ID ở log `command.create`, `command.publish`, `command.receive`, `command.result`, `command.execution`. Log chỉ chứa ID, rack/address/action/trạng thái; không ghi mật khẩu, token hoặc payload xác thực.

## Kiểm chứng

Test tích hợp mới dùng Django HTTP test client, MQTT TCP cô lập, IPC Runtime/RecoveryService và MasterCom/GapMovementController thật. Đường Serial trong test là callback truyền frame tới Simulation trong bộ nhớ, không dùng COM hoặc thiết bị vật lý. Test chạy mở/đóng thực sự trong controller, chờ bằng chứng hoàn thành, chống lệnh trùng, kiểm tra interlock từ chối, offline, Serial mất kết nối và timeout. Timeout được tạo bằng cách dịch thời hạn trong database test, không đợi thời gian thực của môi trường sản xuất.

```powershell
npm.cmd install --prefix .tools/mqtt --cache .tools/npm-cache aedes@0.51.3 --no-audit --no-fund
$env:SERVER_TEST_SQLITE='1'
$env:MQTT_INTEGRATION='1'
.venv/Scripts/python Server/manage.py test Server.inventory.test_server_commands --noinput
```

Đã đạt: test tích hợp trên, 20 test Server inventory/console, 87 test edge/GAP/recovery, build Server và test UI bằng API giả lập. Test UI xác nhận payload, khóa lệnh chờ, phân biệt gửi/hoàn thành, timeout và lỗi Serial. Chưa triển khai lại Docker hoặc kiểm chứng COM/Simulation GUI đang chạy; chưa thử firmware vật lý.
