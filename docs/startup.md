# Khởi chạy từ lần thứ hai

Dành cho hệ thống đã hoàn tất [cài đặt lần đầu](first-time-setup.md). Server, PostgreSQL
và MQTT chạy bằng Docker Compose; IPC/IPCSIM và Simulation chạy native để dùng cổng COM.
Chạy PowerShell từ thư mục gốc repository.

## Khởi động Server

Mở Docker Desktop, chờ Docker engine sẵn sàng, sau đó chạy:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Website: `http://localhost:8080` hoặc `http://<IP_SERVER>:8080`.
Compose tự kiểm tra PostgreSQL, chạy migration còn thiếu rồi khởi động Server/worker.
Không chạy lại bootstrap trong các lần khởi động thông thường.

### MQTT broker có cần mở lại mỗi lần không?

MQTT broker (Mosquitto, service `mqtt`) phải chạy để Server và IPC/IPCSIM trao đổi dữ liệu.
Lệnh `up -d` ở trên đã khởi động cả broker; không cần mở Mosquitto riêng trên Windows.
Chỉ mở repository, Simulation hoặc IPC/IPCSIM không tự khởi động broker.

- Nếu broker vẫn đang chạy, không cần khởi động lại khi mở lại IPC/IPCSIM.
- Sau khi đã chạy `docker compose ... stop` hoặc `down`, cần chạy lại lệnh `up -d`
  ở trên trước khi mở IPC/IPCSIM.
- Service `mqtt` có `restart: unless-stopped`: Docker có thể tự chạy lại container
  khi engine khởi động nếu container chưa bị dừng thủ công. Vẫn kiểm tra trạng thái
  mỗi phiên; Docker Desktop/engine phải đang chạy.

Nếu các service khác đã chạy nhưng broker đang dừng, bật riêng broker và kiểm tra:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d mqtt
docker compose --env-file deploy/.env -f deploy/compose.yaml ps -a mqtt
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 80 mqtt
Test-NetConnection 127.0.0.1 -Port 8883
```

Mong đợi service `mqtt` ở trạng thái `Up` và `TcpTestSucceeded: True`.
Nếu `Exited` hoặc `Restarting`, xem log để xử lý lỗi cấu hình, certificate hoặc quyền
đọc password file theo [hướng dẫn cài đặt](first-time-setup.md#6-lỗi-thường-gặp).
Nếu PowerShell không nhận lệnh `docker`, kiểm tra Docker Desktop đã được cài và Docker
CLI có trong PATH, rồi mở lại terminal; nếu không kết nối được engine, mở Docker Desktop
và chờ engine sẵn sàng.

## Khởi động IPCSIM

Chạy Simulation và IPCSIM, mỗi ứng dụng một terminal:

```powershell
.venv/Scripts/python Simulation/main.py
.venv/Scripts/python IPCSIM/main.py
```

Chọn cổng COM và bấm **Start** cho group cần mô phỏng. UI IPCSIM mặc định là
`http://127.0.0.1:8000/ui/`. Giữ một launcher IPCSIM cho mỗi SQLite/COM.
IPC1 là tùy chọn và dùng `.venv/Scripts/python IPC/main.py` cùng UI port 8002.

## Kiểm tra kết nối

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 80 server worker mqtt
Test-NetConnection 127.0.0.1 -Port 8883
.venv/Scripts/python -m serial.tools.list_ports
```

Trong UI edge, kiểm tra MQTT/Server online, revision synchronized và Serial connected.
`Test-NetConnection` chỉ kiểm tra cổng TCP, chưa xác nhận đăng nhập MQTT/TLS thành công.
Cổng mặc định là 8883 (TLS); nếu đổi `MQTT_PUBLIC_PORT` trong `deploy/.env`, kiểm tra
cổng đã cấu hình. Nếu edge ở máy khác, thay `127.0.0.1` bằng IP/hostname của Server.
Server mặc định lọc REAL; chọn SIMULATION hoặc ALL để thấy IPCSIM.

### Broker đã kết nối nhưng Server vẫn offline

`Broker connected` chỉ xác nhận kết nối MQTT. IPC/IPCSIM chỉ báo Server online khi
nhận được `status.lease` còn hiệu lực từ worker; heartbeat quá 45 giây không được
dùng để xác nhận online. Nếu broker kết nối nhưng Server offline hoặc chưa đồng bộ,
kiểm tra log `worker` và hàng đợi, không chỉ kiểm tra cổng 8883.

Sau khi cập nhật mã xử lý MQTT, dừng IPC/IPCSIM bằng **Ctrl+C** rồi cập nhật worker:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build --no-deps worker
```

Mở lại IPC/IPCSIM bằng lệnh ở trên để nạp mã mới. Bản sửa hàng đợi ưu tiên heartbeat,
ACK và đồng bộ, giữ heartbeat mới nhất, giãn lần gửi lại và tái sử dụng ACK cho cùng
tin nhắn. Tin nghiệp vụ tồn đọng được tiếp tục xử lý; không xóa SQLite hoặc Docker
volume để giải phóng hàng đợi. Xác nhận UI báo Server online và revision synchronized.

## Dừng hệ thống

Đối soát operation đang chờ; dừng IPC/IPCSIM bằng **Ctrl+C**, sau đó Stop/đóng Simulation.
Dừng Server nhưng giữ nguyên database:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml stop
```

Không dùng `docker compose down -v`: tùy chọn `-v` xóa PostgreSQL volume và dữ liệu.
Không tạo lại `.env`, secret, database, user hoặc topology mỗi phiên.
