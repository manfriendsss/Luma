# LUMA Photo Editor

LUMA là trình chỉnh màu ảnh local-first lấy cảm hứng từ Lightroom, chạy trực tiếp trong Chrome hoặc Edge bằng WebGL 2. Ảnh được xử lý và lưu ngay trên thiết bị, không tải lên dịch vụ bên ngoài.

**Production:** https://luma-photo-editor.pages.dev/

## Chạy ứng dụng

Trên Windows, nhấp đúp shortcut `Luma` hoặc `Luma.bat` (dùng Node.js nếu có, nếu không thì dùng Python).

Từ repository:

```powershell
npm start
```

Sau đó mở `http://127.0.0.1:4173` (đổi cổng: `PORT=5000 npm start`).

## Tính năng

**Quy trình nhiều ảnh**
- Chọn hoặc kéo thả nhiều ảnh JPG, PNG, WebP; ảnh EXIF xoay được dựng đúng chiều.
- Mỗi ảnh có thiết lập, vùng chọn và lịch sử riêng (hoàn tác `Ctrl+Z`, làm lại `Ctrl+Shift+Z`).
- **Tự lưu phiên** vào IndexedDB của trình duyệt: tải lại trang vẫn tiếp tục được.
- Filmstrip: chọn ảnh để xuất/đồng bộ, bỏ ảnh khỏi phiên (có hoàn tác), `←`/`→` để chuyển ảnh.
- Sao chép ảnh trước, **Sao chép / Dán / Đồng bộ** thiết lập theo nhóm sang các ảnh đã chọn.

**Chỉnh màu**
- Tông sáng (Phơi sáng, Tương phản, Vùng sáng/tối, Điểm trắng/đen) + **Tự động**.
- Cân bằng màu với **chấm trắng** (`W`) và tự động cân bằng trắng; Độ rực, Bão hòa.
- **Đường cong tông** RGB và từng kênh R/G/B.
- Bộ trộn HSL 8 dải màu.
- **Phân màu (Color grading)**: vòng màu Vùng tối / Trung tính / Vùng sáng / Toàn cục, Hoà trộn, Cân bằng.
- Kết cấu, Độ nét cục bộ, Khử sương, Tối góc, Hạt phim; Làm nét, Giảm nhiễu sáng/màu.

**Điều chỉnh cục bộ** – tối đa 8 vùng chọn mỗi ảnh: Bầu trời (tự nhận diện), Cọ vùng (cỡ, độ mềm, lưu lượng, tẩy bằng `Alt`), Gradient, Oval (kéo tay nắm để di chuyển, đổi cỡ, xoay; độ mềm). Đảo vùng, tạm tắt, nhân bản, lớp phủ (`O`).

**Cắt & xoay** (`R`) – không phá huỷ: tỉ lệ cố định, nắn thẳng (tự thu khung nằm trong ảnh), xoay 90°, lật ngang.

**Xem** – histogram có cảnh báo cháy sáng/mất chi tiết (`J`), zoom thật tới 1:1 và hơn (cuộn chuột, `Z`, `Space` + kéo), so sánh Trước / Sau / Tách đôi có đường chia kéo được, giữ `\` để xem ảnh gốc, toàn màn hình `F`, bảng phím tắt `?`.

**Preset**
- Ngăn preset bên trái, xem trước bằng chính bộ xử lý ảnh khi rê chuột, **thanh Cường độ** 0–150%.
- Lưu thiết lập hiện tại thành preset, đổi tên, xoá; xuất preset ra JSON (LUMA) hoặc XMP (Lightroom / Camera Raw).
- Nhập preset `.xmp`, `.lrtemplate` và JSON (có thể kéo thả file preset vào cửa sổ).

**Xuất ảnh** – JPEG, PNG, WebP ở kích thước đầy đủ hoặc giới hạn cạnh dài; render theo từng ô nên ảnh rất lớn vẫn xuất đúng kích thước; chọn thư mục lưu, gói ZIP hoặc tải từng file; tên file không bao giờ ghi đè; giữ EXIF cho JPEG (Orientation đặt lại = 1, bỏ thumbnail cũ, mặc định xoá vị trí GPS); thanh tiến trình và nút Dừng.

## Lightroom preset mapping

LUMA đọc: `Exposure2012`, `Contrast2012`, `Highlights2012`, `Shadows2012`, `Whites2012`, `Blacks2012`, `IncrementalTemperature`/`Temperature`, `IncrementalTint`/`Tint`, `Saturation`, `Vibrance`, `Texture`, `Clarity2012`, `Dehaze`, `PostCropVignetteAmount`, `GrainAmount`, `GrainSize`, `Sharpness`, `LuminanceSmoothing`, `ColorNoiseReduction`, HSL (`HueAdjustment*`, `SaturationAdjustment*`, `LuminanceAdjustment*`), `ToneCurvePV2012` (+ Red/Green/Blue), đường cong tham số (`Parametric*`), `ColorGrade*` và Split Toning cũ.

Quy ước dấu giống Lightroom (Tối góc âm = làm tối viền). Các trường của mask cục bộ trong preset (`Local*`) và công cụ không có tương đương được bỏ qua an toàn.

## Phát triển

```powershell
npm run build      # src/ → dist/ (xoá dist cũ trước)
npm run check      # kiểm tra cú pháp toàn bộ JS
npm test           # smoke + unit test (không cần cài gói)
npm run test:e2e   # kiểm thử trong Chromium – cần: npm i -D playwright; npx playwright install chromium
codegraph sync .
```

Mã nguồn nằm trong `src/` (ES modules, không cần bundler):

| File | Vai trò |
| --- | --- |
| `src/js/main.js` | Trạng thái, giao diện, thao tác chuột, lịch sử, xuất ảnh |
| `src/js/renderer.js` | Shader WebGL 2: pipeline màu, mask, crop, render theo ô |
| `src/js/geometry.js` | Toán cắt/xoay/lật |
| `src/js/presets.js` | Đọc/ghi preset Lightroom và LUMA |
| `src/js/curve.js`, `color.js` | Đường cong tông, cân bằng trắng, Auto Tone |
| `src/js/widgets.js`, `controls.js` | Histogram, trình chỉnh đường cong, vòng màu, thanh trượt |
| `src/js/zip.js`, `jpeg-meta.js` | Đóng gói ZIP, giữ EXIF |
| `src/js/storage.js` | Tự lưu phiên vào IndexedDB |

`dist/` là bản build sinh ra, không commit (đã có trong `.gitignore`).

## Deploy Cloudflare Pages

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`

Hoặc deploy thủ công:

```powershell
npm run build
wrangler pages deploy dist --project-name luma-photo-editor --branch main
```
