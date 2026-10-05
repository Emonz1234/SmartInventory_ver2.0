# Ngôn ngữ giao diện Server và IPCSIM

Đã bổ sung bộ chọn Tiếng Việt / English ở màn hình đăng nhập và phần đầu giao diện chính. Mặc định là Tiếng Việt; lựa chọn lưu trong `localStorage` với khóa `smartInventory.language`, riêng theo origin của mỗi UI. Chuyển ngôn ngữ cập nhật React tại chỗ, không tải lại trang và không dùng ngôn ngữ làm khóa component, khóa truy vấn hay dependency của thao tác thiết bị.

Danh mục dùng chung nằm tại `Server/frontend/src/locales/messages.json`. Mỗi mục gồm `[tiếng Việt, English]`; mẫu thông báo động sử dụng `{0}`, `{1}`. Hai UI dùng cùng `core.js` và có adapter React riêng. IPCSIM sử dụng thêm locale có sẵn của MUI cho các thành phần thư viện. Cấu hình Vite chỉ cho phép đọc thêm thư mục tài nguyên ngôn ngữ dùng chung khi phát triển; bản production đóng gói tài nguyên vào bundle.

Chỉ dịch nhãn giao diện, mã trạng thái và nội dung lỗi khi hiển thị. Tên người dùng, tên sản phẩm/tủ, SKU, mã vị trí, ghi chú, đơn vị nghiệp vụ, giá trị option và payload lệnh giữ nguyên. Không sửa backend Python, firmware, giao thức, schema hay luồng điều khiển.

Lỗi HTTP giữ đối tượng lỗi và response gốc trong state hiển thị. Bộ đệm chẩn đoán `getErrorDiagnostics()` trong `core.js` giữ tối đa 100 lỗi gần nhất trong bộ nhớ; không ghi vào `localStorage`. Các chuỗi lỗi nội bộ/firmware được giữ nguyên và dịch bằng ánh xạ chuỗi/mẫu ở lớp hiển thị. Lỗi chưa biết hiển thị thông báo dự phòng theo ngôn ngữ chọn cùng mã lỗi, hoặc HTTP status nếu không có mã riêng. Trạng thái chưa biết cũng có nhãn dự phòng và mã gốc. Validation native, validation cấu trúc FastAPI và chuỗi danh sách lỗi mật khẩu Django được dịch mà giữ nguyên ràng buộc validation.

Các file bổ sung hoặc sửa:

| Khu vực | File |
| --- | --- |
| Tài nguyên dùng chung | `Server/frontend/src/locales/messages.json`, `core.js`, `core.d.ts` |
| Server | `Server/frontend/src/i18n.jsx`, `main.jsx`, `Inventory.jsx`, `ui.jsx`, `style.css`; `Server/frontend/index.html` |
| IPCSIM khởi tạo/API/style | `IPCSIM/frontend/src/i18n.tsx`, `App.tsx`, `main.tsx`, `api/client.ts`, `index.css`; `IPCSIM/frontend/vite.config.ts`, `index.html` |
| IPCSIM layout | `IPCSIM/frontend/src/components/Layout/Header.tsx`, `Layout.tsx`, `Sidebar.tsx` |
| IPCSIM thành phần | `IPCSIM/frontend/src/components/OperatorLogin.tsx`, `PageHeader.tsx`, `StatusCard.tsx`, `OperationModal.tsx`, `RackOperationPanel.tsx`; `components/Workflows/PickWorkflow.tsx`, `PutWorkflow.tsx` |
| IPCSIM trang | `IPCSIM/frontend/src/pages/Dashboard.tsx`, `Inventory.tsx`, `InventoryWorkspace.tsx`, `Cabinets.tsx`, `CabinetDetail.tsx`, `Transactions.tsx`, `Breakdown.tsx`, `Environment.tsx`, `Operation.tsx`, `System.tsx`, `Maintenance.tsx` |
| Kiểm tra/báo cáo | `tools/test-i18n.mjs`, `tools/test-ui-localization.cjs`, `docs/ui-language.md` |

Kiểm tra ngày 05/10/2026:

| Kiểm tra | Kết quả |
| --- | --- |
| Build Server: `npm.cmd --prefix Server/frontend run build` | Đạt |
| TypeScript và build IPCSIM: `npm.cmd --prefix IPCSIM/frontend run build` | Đạt; còn cảnh báo kích thước bundle lớn hơn 500 kB |
| `node tools/test-i18n.mjs` | Đạt 30 kiểm tra: mặc định, lưu lựa chọn, ánh xạ mã/chuỗi/mẫu, validation cấu trúc và Django, fallback, giữ nguyên payload, không nhầm mã giữa hai lỗi có cùng thông báo |
| `node tools/test-ui-localization.cjs` | Đạt trên Chrome headless: đăng nhập và 12 trang Server, 9 tuyến IPCSIM; chuyển Việt/Anh; bảng có sản phẩm/vị trí/sự cố; biểu đồ môi trường; không còn chữ Việt trong nội dung English của các fixture đã kiểm tra |
| Giữ trạng thái | Giữ username/password, tên vai trò, option `REAL`, số lượng/ghi chú điều chỉnh Server, số lượng PICK IPCSIM; giữ hộp thoại xác nhận và rack đang chờ; số lần gửi lệnh không tăng khi chuyển ngôn ngữ |
| Lưu lựa chọn và mobile | Reload giữ English trên cả hai UI; bộ chọn IPCSIM hiển thị và nằm trong viewport rộng 390 px |
| Lỗi thiết bị mô phỏng | Telemetry điểm cuối `state=-2`, các cờ vật cản/lệch rack/quá tải và lỗi API có `code=FW_UNKNOWN_42`: thông báo đổi ngôn ngữ, giữ mã và không tự gửi lại lệnh |
| `git diff --check` | Đạt |

Để chạy lại kiểm tra trình duyệt, mở Vite Server ở `127.0.0.1:3310` và IPCSIM ở `127.0.0.1:3300/ui/`. Script dùng Playwright có sẵn tại `.tools/ui/node_modules/playwright` và Chrome cài trên máy; chặn HTTP API để cấp fixture, không truy cập database hay thiết bị thật. Có thể khởi chạy bằng `npm.cmd --prefix Server/frontend run dev -- --port 3310` và `npm.cmd --prefix IPCSIM/frontend run dev -- --host 127.0.0.1 --port 3300`.

Thông báo chưa có ánh xạ trong fixture là `Unregistered firmware wording`, mã `FW_UNKNOWN_42`; đây là dữ liệu cố ý tạo để kiểm tra fallback. Chưa có corpus chuỗi lỗi từ firmware vật lý để xác nhận mọi biến thể. Chuỗi/mã ngoài danh mục, gồm các ngoại lệ hạ tầng động, sẽ dùng fallback và giữ bản gốc phục vụ chẩn đoán. Các trang legacy không có tuyến đang hoạt động được rà soát mã và build, chưa có kiểm thử trình duyệt riêng cho mọi nhánh của chúng.

Toàn bộ kiểm thử lỗi thiết bị ở trên sử dụng HTTP/telemetry mô phỏng. **Chưa kiểm tra phần cứng hoặc firmware thực tế.**

## Globe language menu

Both React adapters render the same globe button and menu appearance. The menu offers Tiếng Việt / English, marks the current language with a check, closes on selection, outside pointerdown, focus leaving the control, or Escape. Escape restores button focus; arrow keys and Home/End navigate options. Each button uses type="button" so selecting a language cannot submit an enclosing form.

The Server root subscribes through useLanguage() and renders LanguageSelector in the shared authenticated PageHeader and login/loading screens. IPCSIM uses the selector in Layout/Header and OperatorLogin. Language changes preserve mounted components and existing business state.

Validation: node tools/test-i18n.mjs; node tools/test-ui-localization.cjs against Server Vite on port 3310 and IPCSIM Vite on port 3300. Browser checks use mocked API/telemetry, cover Server's 12 pages and IPCSIM's 9 routes, both languages, dropdown check/outside/Escape/selection, saved preference, form values, dialogs and active rack commands. No physical firmware was exercised. Screenshots are saved to .tools/ui/artifacts by the browser test.

Files updated in the globe-menu pass: Server/frontend/src/i18n.jsx, style.css, Inventory.jsx; IPCSIM/frontend/src/i18n.tsx, index.css, pages/InventoryWorkspace.tsx, components/RackOperationPanel.tsx; tools/test-ui-localization.cjs; docs/ui-language.md. Existing translation work in the workspace was preserved. Modal and drawer headings include the same selector because modal focus and pointer isolation make the main header inaccessible while a modal is open.

Final verification (2026-10-05): both production builds passed (IPCSIM: TypeScript + Vite); 30 core i18n assertions passed; the browser suite passed all 12 Server pages and 9 IPCSIM routes with no page errors. Tests confirmed pointer/Escape/selection dismissal, checked language marker, persisted preference, 390px header visibility, retained login/role/quantity/note values, retained confirmation and active movement, unchanged command count, translated simulated firmware fault and unknown API code. IPCSIM build reports a bundle size warning only. Browser screenshots were inspected for Server and IPCSIM. Tests used local Vite frontends and mocked HTTP/telemetry, not deployed Docker or physical firmware.
