# LUMA Photo Editor

LUMA là trình chỉnh màu ảnh local-first lấy cảm hứng từ Lightroom, chạy trực tiếp trong Chrome hoặc Edge bằng WebGL 2. Ảnh được xử lý trên thiết bị và không tải lên dịch vụ bên ngoài.

## Chạy ứng dụng

Trên Windows, nhấp đúp shortcut `Luma` hoặc `Luma.bat` trên Desktop.

Để chạy từ repository:

```powershell
npm start
```

Sau đó mở `http://127.0.0.1:4173`.

## Tính năng

- Chọn nhiều ảnh JPG, PNG hoặc WebP và chuyển ảnh bằng filmstrip.
- Mỗi ảnh giữ thông số chỉnh màu, mask và lịch sử riêng.
- Phơi sáng, Tương phản, Vùng sáng, Vùng tối, Điểm trắng và Điểm đen.
- Nhiệt độ, Sắc thái, Bão hòa, Độ rực, Độ nét cục bộ, Khử sương, Tối góc và Hạt phim.
- Bộ trộn HSL riêng cho 8 dải màu với Sắc độ, Bão hòa và Độ sáng.
- Drawer preset bên trái mở bằng handler bám mép, xem trước khi rê chuột và áp dụng khi bấm.
- Import Lightroom preset dạng `.xmp`, `.lrtemplate` và JSON tương thích LUMA.
- Nút `Sao chép ảnh trước` sao chép thiết lập từ ảnh ngay trước sang ảnh đang mở.
- `Ctrl+Z` hoàn tác preset, slider, reset, mask và nét cọ vừa thực hiện.
- Vùng chọn bầu trời (thử nghiệm) và cọ thủ công, kèm đầy đủ thanh chỉnh sáng, màu và chi tiết cục bộ.
- So sánh Trước, Sau hoặc Tách đôi; giữ `\` để xem nhanh ảnh gốc.
- Chế độ toàn màn hình bằng nút trên thanh công cụ hoặc phím `F`.
- Chọn ảnh trong filmstrip và xuất JPEG, PNG hoặc WebP hàng loạt ở kích thước gốc.

## Lightroom preset mapping

LUMA đọc các trường phổ biến như `Exposure2012`, `Contrast2012`, `Highlights2012`, `Shadows2012`, `Whites2012`, `Blacks2012`, `Temperature`, `Tint`, `Saturation`, `Vibrance`, `Clarity2012`, `Dehaze`, `PostCropVignetteAmount` và `GrainAmount`.

Các công cụ độc quyền khác của Lightroom không có tương đương trực tiếp sẽ được bỏ qua an toàn.

## Dành cho AI agents và contributor

Repository có `AGENTS.md`, smoke test không cần dependency và CodeGraph index.

```powershell
codegraph explore "preset import and undo flow"
npm run build
npm run check
npm test
codegraph sync .
```

Mã nguồn chính nằm trong `src/`; `npm run build` tạo bản chạy tĩnh trong `dist/`. Giao diện dùng nền xám dịu mắt với điểm nhấn xanh nước biển và hiển thị hoàn toàn bằng tiếng Việt.
