# Chạy IPC

IPC và IPCSIM hiện dùng chung `ipc_core.api`. Prototype Flask đã lưu trong `legacy/physical_prototype` để đối chiếu.

1. Cài dependency tại root: `.venv/Scripts/python -m pip install -r requirements.lock.txt`.
2. Copy `IPC/.env.example` thành `IPC/.env`, cấu hình device đã đăng ký, DB_PATH mới, Serial và MQTT.
3. Từ `IPC/`: `../.venv/Scripts/python -m uvicorn main:app --host 127.0.0.1 --port 8002`.
4. Dùng token edge để đọc API. Nhập/xuất và điều khiển rack thực hiện tại Server Control Center.

Xem [runbook](../docs/runbook.md) và [kiến trúc](../docs/architecture.md).