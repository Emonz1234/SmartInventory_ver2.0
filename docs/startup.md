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
Server mặc định lọc REAL; chọn SIMULATION hoặc ALL để thấy IPCSIM.

## Dừng hệ thống

Đối soát operation đang chờ; dừng IPC/IPCSIM bằng **Ctrl+C**, sau đó Stop/đóng Simulation.
Dừng Server nhưng giữ nguyên database:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml stop
```

Không dùng `docker compose down -v`: tùy chọn `-v` xóa PostgreSQL volume và dữ liệu.
Không tạo lại `.env`, secret, database, user hoặc topology mỗi phiên.
