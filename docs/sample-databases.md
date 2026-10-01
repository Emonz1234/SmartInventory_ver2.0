# Reset database development

Lệnh reset xóa schema `public` của PostgreSQL `inventory` và SQLite development của IPC/IPCSIM, sau đó dựng baseline và seed lại demo. **Không dùng trên production.** File trong `backups/` được giữ nguyên.

1. Dừng IPCSIM, IPC và Simulation bằng Ctrl+C.
2. Chạy PowerShell tại thư mục dự án:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
tools/reset_development.ps1 -ConfirmDevelopmentReset
```

3. Tạo tài khoản Server nếu cần:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml exec server python Server/manage.py createsuperuser
```

Script chỉ chấp nhận cấu hình loopback/database local và dừng nếu API edge còn chạy. Dữ liệu mẫu gồm:

- 2 device: IPC01, IPCSIM01
- 23 cabinet: 1 REAL và 22 SIMULATION; 138 rack
- 7 category, 20 product, 29 stocked locations
- 43 inventory movements, 6 operations, 1 pending sync và 1 conflict

Seed in mật khẩu ngẫu nhiên một lần cho `demo-admin`, `demo-supervisor` và `demo-operator`; lưu lại nếu cần kiểm thử đăng nhập. Không có mật khẩu demo cố định trong source.
Seed chạy lại không tạo trùng. IPCSIM01 Online/Synced sau khi khởi động và nhận snapshot theo [hướng dẫn](startup.md). IPC01 chỉ Online khi edge IPC01 thực sự gửi heartbeat; seed không giả trạng thái thiết bị.
Seed tạo `demo-admin`, `demo-supervisor` và `demo-operator`, đồng thời in mật khẩu ngẫu nhiên một lần trong output reset; hãy lưu lại khi chạy lệnh.
