# LUMA

<p align="center">
  <strong>A lightweight, local-first photo editor built for personal desktop workflows.</strong><br>
  <strong>Trình chỉnh ảnh nhẹ, ưu tiên xử lý cục bộ cho nhu cầu cá nhân trên máy tính.</strong>
</p>

<p align="center">
  <img alt="Version 2.0.0" src="https://img.shields.io/badge/version-2.0.0-0284c7">
  <img alt="Desktop optimized" src="https://img.shields.io/badge/optimized_for-desktop-2563eb">
  <img alt="Local-first" src="https://img.shields.io/badge/privacy-local--first-0891b2">
  <img alt="WebGL 2" src="https://img.shields.io/badge/rendering-WebGL_2-0369a1">
</p>

<p align="center">
  <a href="#tiếng-việt">Tiếng Việt</a> ·
  <a href="#english">English</a> ·
  <a href="https://luma-photo-editor.pages.dev/">Mở ứng dụng / Open app</a>
</p>

---

## Tiếng Việt

### Tổng quan

LUMA là trình chỉnh màu ảnh lấy cảm hứng từ Lightroom, được thiết kế cho **người dùng cá nhân muốn chỉnh ảnh nhanh trên máy tính** mà không cần cài một bộ phần mềm nặng.

Ứng dụng chạy trong Chrome hoặc Edge, sử dụng WebGL 2 để xử lý ảnh bằng GPU. Ảnh, lịch sử chỉnh sửa và preset được xử lý cục bộ trên thiết bị; LUMA không yêu cầu tài khoản, máy chủ xử lý ảnh hay gói thuê bao.

> **Nhẹ và riêng tư:** mã nguồn dùng JavaScript thuần, không framework giao diện và không có dependency runtime. Bạn có thể chạy LUMA hoàn toàn cục bộ, kể cả khi không có Internet.

### Vì sao chọn LUMA?

- **Dành cho nhu cầu cá nhân:** mở ảnh, chỉnh màu, so sánh trước/sau và xuất file trong một quy trình gọn gàng.
- **Tối ưu cho máy tính:** giao diện desktop, phím tắt, filmstrip nhiều ảnh, chế độ toàn màn hình và thao tác chuột chính xác.
- **Nhẹ:** không cần cài đặt phần mềm chỉnh ảnh lớn; bản local chỉ cần Node.js hoặc Python để phục vụ file tĩnh.
- **Xử lý cục bộ:** ảnh không được gửi tới dịch vụ xử lý bên ngoài.
- **Tận dụng GPU:** pipeline WebGL 2 cho xem trước màu theo thời gian thực và xuất ảnh theo từng ô để hỗ trợ ảnh kích thước lớn.
- **Không phá huỷ ảnh gốc:** các thiết lập được lưu riêng và chỉ áp dụng khi xuất file.

### Tính năng chính

#### Chỉnh màu

- Phơi sáng, tương phản, vùng sáng, vùng tối, điểm trắng và điểm đen.
- Nhiệt độ màu, sắc thái, độ rực và độ bão hòa.
- Đường cong tông tổng và từng kênh RGB.
- HSL cho 8 dải màu; phân màu vùng tối, trung tính, vùng sáng và toàn cục.
- Kết cấu, độ nét cục bộ, khử sương, tối góc, hạt phim, làm nét và giảm nhiễu.
- Tự động cân bằng tông và công cụ chấm cân bằng trắng.

#### Quy trình nhiều ảnh

- Nhập nhiều ảnh JPG, PNG hoặc WebP cùng lúc.
- Filmstrip ở cạnh dưới để chọn, chuyển và quản lý ảnh.
- Sao chép, dán hoặc đồng bộ thiết lập sang nhiều ảnh đã chọn.
- Lệnh **Ảnh trước** để áp dụng thiết lập từ ảnh liền trước.
- Hoàn tác bằng `Ctrl+Z`, làm lại bằng `Ctrl+Shift+Z`; mỗi ảnh có lịch sử riêng.
- Tự lưu phiên làm việc vào IndexedDB để có thể tiếp tục sau khi tải lại trang.

#### Mask và chỉnh sửa cục bộ

- Nhận diện vùng trời tự động.
- Cọ vùng với kích thước, độ mềm, lưu lượng và chế độ tẩy.
- Mask Gradient và Oval có thể di chuyển, đổi kích thước, xoay và điều chỉnh độ mềm.
- Tối đa 8 mask trên mỗi ảnh; hỗ trợ đảo vùng, nhân bản, ẩn/hiện và lớp phủ mask.

#### Preset và xuất ảnh

- Nhập preset Lightroom `.xmp`, `.lrtemplate` và preset LUMA `.json`.
- Xem trước preset khi rê chuột và điều chỉnh cường độ từ 0–150%.
- Lưu, đổi tên, xóa và xuất preset LUMA hoặc XMP.
- Xuất hàng loạt JPEG, PNG hoặc WebP; giới hạn cạnh dài hoặc giữ nguyên kích thước.
- Tải từng file, chọn thư mục lưu hoặc đóng gói thành ZIP.
- Giữ EXIF cho JPEG và mặc định loại bỏ dữ liệu vị trí GPS.

#### Công cụ xem và bố cục

- So sánh Trước/Sau, chế độ tách đôi và giữ `\` để xem ảnh gốc.
- Histogram với cảnh báo cháy sáng hoặc mất chi tiết.
- Zoom 1:1 và lớn hơn, kéo ảnh, toàn màn hình và bảng phím tắt.
- Cắt, nắn thẳng, xoay 90° và lật ảnh theo cách không phá huỷ.
- Tự đọc EXIF Orientation để hiển thị ảnh đúng chiều.

### Dùng ngay

Mở bản web tại **[luma-photo-editor.pages.dev](https://luma-photo-editor.pages.dev/)**. Toàn bộ thao tác chỉnh ảnh vẫn diễn ra trong trình duyệt trên thiết bị của bạn.

### Chạy trên máy tính

#### Windows

Nhấp đúp `Luma.bat`. Script sẽ ưu tiên Node.js và tự chuyển sang Python nếu Node.js chưa được cài.

#### Chạy từ terminal

Yêu cầu: Node.js 18 trở lên.

```powershell
git clone https://github.com/manfriendsss/Luma.git
cd Luma
npm start
```

Mở `http://127.0.0.1:4173`. Không cần chạy `npm install` cho chế độ sử dụng thông thường vì ứng dụng không có dependency runtime.

### Phím tắt hữu ích

| Phím | Chức năng |
| --- | --- |
| `Ctrl+Z` | Hoàn tác |
| `Ctrl+Shift+Z` | Làm lại |
| `F` | Bật/tắt toàn màn hình |
| `\` | Giữ để xem ảnh gốc |
| `Z` | Chuyển mức zoom |
| `W` | Chấm cân bằng trắng |
| `R` | Cắt và xoay |
| `O` | Bật/tắt lớp phủ mask |
| `J` | Cảnh báo vùng sáng/tối bị cắt |
| `←` / `→` | Chuyển ảnh |
| `?` | Mở bảng phím tắt |

### Phát triển và kiểm thử

```powershell
npm run build      # Tạo dist/ từ src/
npm run check      # Kiểm tra cú pháp JavaScript
npm test           # Smoke test và unit test
npm run test:e2e   # E2E bằng Chromium; cần cài Playwright
codegraph sync .   # Cập nhật chỉ mục CodeGraph
```

Cài Playwright nếu cần chạy E2E:

```powershell
npm install --save-dev playwright
npx playwright install chromium
npm run test:e2e
```

### Cấu trúc dự án

| Đường dẫn | Vai trò |
| --- | --- |
| `src/` | Mã nguồn ứng dụng và giao diện |
| `src/js/main.js` | Trạng thái, lịch sử, tương tác và quy trình xuất ảnh |
| `src/js/renderer.js` | Pipeline màu, mask, crop và tiled rendering bằng WebGL 2 |
| `src/js/presets.js` | Đọc và ghi preset Lightroom/LUMA |
| `src/js/curve.js` | Đường cong tông và LUT |
| `src/js/storage.js` | Tự lưu phiên làm việc bằng IndexedDB |
| `dist/` | Bản build có thể deploy dưới dạng website tĩnh |
| `test/` | Smoke test, unit test, E2E và fixture |

### Deploy Cloudflare Pages

| Thiết lập | Giá trị |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |

Deploy thủ công:

```powershell
npm run build
wrangler pages deploy dist --project-name luma-photo-editor --branch main
```

### Lưu ý về preset Lightroom

LUMA hỗ trợ các thông số phổ biến như Exposure, Contrast, Highlights, Shadows, Whites, Blacks, White Balance, Saturation, Vibrance, Texture, Clarity, Dehaze, Vignette, Grain, Detail, HSL, Tone Curve, Color Grading và Split Toning.

Preset có thể chứa công cụ độc quyền của Lightroom mà trình duyệt không có tương đương. Những trường không được hỗ trợ sẽ được bỏ qua an toàn, vì vậy kết quả có thể không giống Lightroom tuyệt đối.

---

## English

### Overview

LUMA is a Lightroom-inspired photo editor designed for **personal desktop photography workflows**. It provides the essential tools needed to edit, compare, organize, and export photos without installing a large creative suite.

The app runs in Chrome or Edge and uses WebGL 2 for GPU-accelerated image processing. Photos, edit history, and presets are handled locally on the device; LUMA does not require an account, a remote image-processing service, or a subscription.

> **Lightweight and private:** LUMA uses vanilla JavaScript, no UI framework, and no runtime dependencies. It can run entirely on your computer, including offline use.

### Why LUMA?

- **Made for personal use:** a focused workflow for opening photos, grading color, comparing results, and exporting finished files.
- **Desktop optimized:** precise mouse controls, keyboard shortcuts, a multi-image filmstrip, and fullscreen editing.
- **Lightweight:** no heavyweight editor installation; the local version only needs Node.js or Python to serve static files.
- **Local-first:** photos are not uploaded to an external processing service.
- **GPU accelerated:** WebGL 2 provides real-time previews, while tiled rendering supports large export sizes.
- **Non-destructive:** adjustments stay separate from the original and are only baked in during export.

### Highlights

#### Color editing

- Exposure, contrast, highlights, shadows, whites, and blacks.
- Temperature, tint, vibrance, and saturation.
- Master and per-channel RGB tone curves.
- Eight-channel HSL mixer and color grading for shadows, midtones, highlights, and global color.
- Texture, clarity, dehaze, vignette, film grain, sharpening, and noise reduction.
- Automatic tone adjustment and a white-balance picker.

#### Multi-image workflow

- Import multiple JPG, PNG, or WebP images at once.
- Use the bottom filmstrip to select, navigate, and manage photos.
- Copy, paste, or synchronize selected adjustment groups across multiple photos.
- Apply the previous photo's settings with the **Previous** action.
- Undo with `Ctrl+Z` and redo with `Ctrl+Shift+Z`; every photo has its own history.
- Resume work after a reload with automatic IndexedDB session storage.

#### Masks and local adjustments

- Automatic sky selection.
- Brush masks with size, feather, flow, and erase controls.
- Draggable Gradient and Oval masks with resize, rotation, and feather controls.
- Up to eight masks per image, with invert, duplicate, visibility, and overlay options.

#### Presets and export

- Import Lightroom `.xmp`, `.lrtemplate`, and LUMA `.json` presets.
- Preview presets on hover and adjust their strength from 0–150%.
- Save, rename, delete, and export presets as LUMA JSON or XMP.
- Batch-export JPEG, PNG, or WebP at full size or with a maximum long edge.
- Download individual files, write to a selected folder, or package results as ZIP.
- Preserve JPEG EXIF metadata while removing GPS location data by default.

#### Viewing and geometry tools

- Before/After, split comparison, and hold `\` to view the original.
- Histogram with highlight and shadow clipping warnings.
- True 1:1 zoom and beyond, pan, fullscreen mode, and a shortcut reference.
- Non-destructive crop, straighten, 90° rotation, and flip.
- EXIF Orientation support for correctly displayed source images.

### Try it online

Open **[luma-photo-editor.pages.dev](https://luma-photo-editor.pages.dev/)**. Image processing still happens locally inside your browser.

### Run locally

#### Windows

Double-click `Luma.bat`. The launcher prefers Node.js and falls back to Python when Node.js is unavailable.

#### From a terminal

Requirement: Node.js 18 or newer.

```powershell
git clone https://github.com/manfriendsss/Luma.git
cd Luma
npm start
```

Open `http://127.0.0.1:4173`. A normal local run does not require `npm install` because the application has no runtime dependencies.

### Useful shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `F` | Toggle fullscreen |
| `\` | Hold to view the original |
| `Z` | Change zoom level |
| `W` | White-balance picker |
| `R` | Crop and rotate |
| `O` | Toggle mask overlay |
| `J` | Toggle clipping warnings |
| `←` / `→` | Navigate photos |
| `?` | Open the shortcut guide |

### Development and testing

```powershell
npm run build      # Generate dist/ from src/
npm run check      # Validate JavaScript syntax
npm test           # Run smoke and unit tests
npm run test:e2e   # Run Chromium E2E tests; Playwright is required
codegraph sync .   # Refresh the CodeGraph index
```

Install Playwright when E2E coverage is needed:

```powershell
npm install --save-dev playwright
npx playwright install chromium
npm run test:e2e
```

### Project structure

| Path | Responsibility |
| --- | --- |
| `src/` | Application source and interface |
| `src/js/main.js` | State, history, interaction, and export workflow |
| `src/js/renderer.js` | WebGL 2 color pipeline, masks, crop, and tiled rendering |
| `src/js/presets.js` | Lightroom/LUMA preset import and export |
| `src/js/curve.js` | Tone curves and LUT generation |
| `src/js/storage.js` | IndexedDB session persistence |
| `dist/` | Static deployable build output |
| `test/` | Smoke, unit, E2E tests, and fixtures |

### Cloudflare Pages deployment

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |

Manual deployment:

```powershell
npm run build
wrangler pages deploy dist --project-name luma-photo-editor --branch main
```

### Lightroom preset compatibility

LUMA supports common settings including Exposure, Contrast, Highlights, Shadows, Whites, Blacks, White Balance, Saturation, Vibrance, Texture, Clarity, Dehaze, Vignette, Grain, Detail, HSL, Tone Curve, Color Grading, and legacy Split Toning.

Some presets include Lightroom-specific tools that have no browser equivalent. Unsupported fields are ignored safely, so results may not match Lightroom exactly.

---

<p align="center">
  Built for a fast, private, personal desktop editing workflow.<br>
  Được xây dựng cho quy trình chỉnh ảnh cá nhân nhanh, riêng tư trên máy tính.
</p>
