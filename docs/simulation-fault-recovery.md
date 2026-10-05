# Phục hồi lỗi Simulation ↔ IPCSIM

Simulation là nguồn trạng thái cơ khí thực tế; IPCSIM giữ journal, hiển thị và quyết định recovery. Clear fault không reset cabinet, không trả về home và không mặc định coi lệnh đã hoàn tất.

## Trạng thái và context

```text
OPENING / CLOSING / MOVING
  → ERROR (dừng tại vị trí lỗi)
  → RECOVERING (lỗi đã hết, chưa chạy tiếp)
  → resume cùng command, cùng step, cùng progress
  → OPEN / IDLE / VENTILATED
```

Snapshot dùng `IDLE`, `OPENING`, `OPEN`, `CLOSING`, `MOVING`, `STOPPED`, `ERROR`, `RECOVERING` và giữ `VENTILATED`. IPCSIM thêm `COMMUNICATION_LOST` khi thiếu snapshot đáng tin. Closed là trạng thái tiếp cận rack; cabinet hoàn tất CLOSE trở về IDLE. OPEN trong mô hình GAP nghĩa là mở khe tiếp cận giữa các rack di động; chưa có trục di chuyển toàn cabinet hay cánh rack riêng.

Controller giữ command, current step, các bước còn lại, start position, target, direction và step progress. Chỉ queue lệnh chưa thực thi bị loại bỏ khi lỗi. Fault context gồm `fault_id`, rack gây lỗi/rack đang di chuyển, command ID, trạng thái trước lỗi, current/target position, progress, error code, classification, position trusted, timestamp và snapshot tại thời điểm lỗi.

SQLite có `simulation_state`, `simulation_history` và `simulation_event_receipts`, độc lập với master projection. Fault sống qua refresh UI và restart IPCSIM; sau restart, cache chỉ là dữ liệu offline cho tới khi nhận snapshot phiên mới. ABORT giữ context ở STOPPED; fault kết thúc khi command hoặc recovery/homing hoàn tất.

`rack_id` trong protocol Simulation là địa chỉ Serial, `cabinet_index` là chỉ số group, không phải PK. Snapshot mới dùng **mm** của GAP; OPRSTT cũ vẫn giữ scale wire 0–64. Current position trong fault context là vị trí lúc lỗi, còn `racks` phản ánh vị trí mới nhất lúc resume.

## Protocol v2 và tương thích

Khung `0|address|action`, ENVSTT, OPRSTT và BRKSTT vẫn được nhận. IPCSIM mới gửi control JSON có newline:

```json
{"protocol_version":2,"cabinet_index":3,"peer_session":"edge-session","request_id":"request-uuid","operation":"EXECUTE","address":18,"action":"OPEN","command_id":"stable-operation-id"}
```

Operation mở rộng: `REQUEST_STATE`, `EXECUTE`, `STOP`, `RESUME`, `ABORT`, `HOME`. Recovery thêm `fault_id`, `confirmed`. RESUME tiếp tục kế hoạch hiện tại, không gửi lại OPEN/CLOSE. Simulator nhận lại command ID cũ không thực thi lặp; payload khác cùng ID bị từ chối.

Snapshot truyền bằng `SIMSTT|<base64(zlib(JSON))>\n` để giảm lưu lượng trên đường baud thấp. JSON gồm type `simulation_state`, cabinet index, boot ID, sequence, peer session, event, system state, racks, current/last command ID, fault context, sensors và history gần nhất. Decoder giới hạn giải nén 65536 byte; frame Serial vẫn giới hạn 8192 byte.

IPCSIM yêu cầu snapshot khoảng 2 giây/lần; Simulation phát định kỳ khoảng 2 giây và khi đổi trạng thái. OPRSTT tiến trình giới hạn khoảng 0,2 giây/lần; controller vẫn cập nhật khoảng 0,1 giây. Đây là chu kỳ lập lịch mục tiêu, không phải cam kết real-time cứng.

IPCSIM kiểm assignment, session, sequence, đủ 6 rack, số hữu hạn, phạm vi vị trí và khoảng cách rack. Snapshot cũ hoặc sai phiên không xóa fault. Khi Simulation khởi động lại với boot_id mới, snapshot xác nhận IDLE, không lỗi, reference tin cậy, không chuyển động/lệnh chờ và sáu rack ở HOME (0–500 mm, gap bên phải R6), IPCSIM nhận trạng thái ban đầu này và UI xóa thao tác cũ. Lệnh tồn đọng được hủy, lưu lịch sử `simulation_restarted`, không commit tồn kho hoặc phát lại. Snapshot của boot đã kết thúc bị từ chối. Restart không đáp ứng HOME hợp lệ khi có lệnh dang dở vẫn khóa ở `STATE_MISMATCH`.

UI có nút **Kiểm tra lỗi** gửi `POST /api/operator/simulation-check`, yêu cầu `REQUEST_STATE` qua Serial. Đây không phải lệnh xóa lỗi: UI cập nhật từ phản hồi được kiểm tra và polling mỗi 2 giây. Lỗi còn tồn tại vẫn khóa thao tác; lỗi đã clear hiển thị lựa chọn Resume/Abort/Home theo phân loại. Lỗi tạm thời RECOVERABLE tự tiếp tục, lỗi cần xác nhận dùng Resume operation. Trạng thái khỏe hiển thị **Không có lỗi**.

## Phân loại và an toàn

| Classification | Hành động sau clear và reconcile |
|---|---|
| RECOVERABLE | Có thể auto resume nếu thiết bị dừng, không còn fault, vị trí tin cậy |
| REQUIRES_CONFIRMATION | Người vận hành xác nhận RESUME; có thể ABORT/HOME |
| REQUIRES_HOME | Không RESUME; homing sau kiểm tra reference |
| FATAL | Khóa vận hành và recovery thông thường |

Vật cản, lệch và quá tải mặc định yêu cầu xác nhận. Không phát lệnh mới khi cabinet có fault, recovering, stopped, mất kết nối, command active hoặc queue cơ khí. Interlock breakdown và quyền sở hữu journal hiện hữu vẫn được giữ. Lỗi nghiêm trọng hơn có thể nâng cấp classification nhưng không làm mất vị trí ban đầu.

UI chỉ hiện action backend cho phép. RESUME/HOME cần xác nhận kiểm tra vật cản, limit sensor và reference. Đây là xác nhận trong mô phỏng, không thay thế cảm biến phần cứng thật. ABORT dừng tại chỗ và bắt buộc HOME trước lệnh mới. HOME lập đường đi từ vị trí hiện tại, không gán rack về tọa độ ban đầu.

## Mất kết nối, timeout và PUT/PICK

Lỗi đọc/ghi Serial dừng command tại vị trí hiện tại; Simulation giữ controller và tự thử mở lại cổng. Với phiên v2, thiếu yêu cầu trạng thái quá khoảng 8 giây cũng gây COMMUNICATION_LOST khi đang di chuyển. Nếu driver không báo lỗi, có độ trễ watchdog; không tuyên bố dừng tức thời tuyệt đối.

IPCSIM giữ journal đang EXECUTING ở UNCERTAIN. Reconnect yêu cầu snapshot mới rồi mới cho recovery. Nếu lệnh đã hoàn tất khi mất kết nối, chỉ snapshot đúng command ID và trạng thái cuối phù hợp mới giải quyết journal cũ. Backend theo dõi command, quá khoảng 90 giây chưa hoàn tất yêu cầu STOP/SENSOR_TIMEOUT; UI có yêu cầu STOP tương ứng. Không dùng timeout để reset.

Resume PUT/PICK giữ transaction ID, phase và quantity, không dispatch lại lệnh. CLOSE thành công commit tồn một lần; endpoint lặp không cộng/trừ thêm. ABORT/HOME hủy journal dang dở của cabinet; người vận hành phải đối soát hàng thực tế, không tự suy ra tồn từ thao tác bị gián đoạn.

## Kiểm tra thủ công

1. Chạy hệ thống theo [startup.md](startup.md), chọn đúng Serial pair/group.
2. Mở rack từ IPCSIM; khi đang di chuyển, bật checkbox lỗi và **Apply / clear faults** ở Simulation.
3. Kiểm ERROR, vị trí giữ nguyên và command/current/target trên IPCSIM. Refresh trang: fault phải còn.
4. Bỏ checkbox rồi Apply: thiết bị phải chuyển RECOVERING. Chọn **Resume operation**, kiểm tra rồi xác nhận.
5. Combo nâng cao: chọn loại và **Inject fault**; sau xử lý dùng **Fault fixed**. Temporary stop có thể auto resume; reference lost chỉ cho HOME/ABORT; fatal khóa.
6. Standalone dùng **Resume (standalone)** sau clear. Nút này không bypass lỗi cần home/fatal; khi nối Serial, quyết định recovery thuộc IPCSIM.

Danh sách cabinet hiển thị lỗi, rack và current/target; trang chi tiết hiển thị vị trí thật trên sơ đồ và history backend. Không có nút reset fault cục bộ.

```powershell
.venv/Scripts/python -m pytest tests/test_simulation_recovery.py tests/test_gap_controller.py tests/test_gap_simulation.py tests/test_serial_transport.py tests/test_simulation_gui.py -q
npm.cmd --prefix IPCSIM/frontend run build
node tests/simulation_recovery_browser.cjs
```

Browser test dùng server tạm và API mock, không ghi database đang chạy. Các test kiểm lỗi tại 40% khi mở/đóng/thông gió/home, reconnect, mất reference, abort, cache restart, timeout, chống snapshot cũ và inventory commit một lần. COM thật và độ trễ driver cần được đo trong môi trường triển khai.
