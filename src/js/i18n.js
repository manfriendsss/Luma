// Giao diện tiếng Anh. Mã nguồn viết bằng tiếng Việt; khi chọn EN, bộ dịch thay chữ trên DOM
// (kể cả nội dung sinh ra sau này: toast, lịch sử, thông báo) và khôi phục nguyên bản khi về VI.
import { el, safeLocalStorage } from "./core.js";

const EXACT = {
  // Thanh công cụ & chung
  "TRÌNH CHỈNH ẢNH": "PHOTO EDITOR", "Trình chỉnh ảnh LUMA": "LUMA photo editor", "LUMA — Chỉnh màu ảnh": "LUMA — Photo color editor",
  "LUMA — chỉnh màu ảnh cục bộ, trực quan và riêng tư.": "LUMA — local, visual and private photo color editing.",
  "+ Thêm ảnh": "+ Add photos", "Thêm ảnh (hoặc kéo thả vào cửa sổ)": "Add photos (or drag them into the window)",
  "Mở thư mục": "Open folder", "Mở cả thư mục – thiết lập được lưu cạnh ảnh dạng .luma.json": "Open a whole folder – settings are saved next to each photo as .luma.json",
  "Hoàn tác": "Undo", "Hoàn tác (Ctrl+Z)": "Undo (Ctrl+Z)", "Làm lại": "Redo", "Làm lại (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
  "Thiết lập": "Settings", "Toàn màn hình": "Fullscreen", "Toàn màn hình (F)": "Fullscreen (F)", "Thoát toàn màn hình": "Exit fullscreen",
  "Phím tắt": "Keyboard shortcuts", "Phím tắt (?)": "Keyboard shortcuts (?)", "Xuất ảnh": "Export", "Xuất ảnh (Ctrl+Shift+E)": "Export (Ctrl+Shift+E)",
  "Sao chép từ ảnh trước": "Copy from previous photo", "Sao chép thiết lập…": "Copy settings…", "Dán thiết lập": "Paste settings",
  "Đồng bộ sang ảnh đã chọn…": "Sync to selected photos…", "Tạo bản sao ảo": "Create virtual copy", "Đặt lại ảnh đang xem": "Reset this photo",
  "Sẵn sàng": "Ready", "Ảnh được xử lý cục bộ": "Photos are processed locally", "Đang giải mã ảnh…": "Decoding photo…",
  "Đang khôi phục phiên trước…": "Restoring previous session…", "Chưa có ảnh": "No photo", "Chưa có ảnh.": "No photo yet.",
  "Huỷ": "Cancel", "Đóng": "Close", "Lưu": "Save", "Xong": "Done", "Tiếp tục": "Continue", "Dừng": "Stop", "Đặt lại": "Reset",
  "Tự động": "Auto", "Không": "None", "Tất cả": "All", "Lọc": "Filter", "Chọn tất cả": "Select all", "Bỏ chọn tất cả": "Deselect all",
  "Bỏ chọn": "Deselect", "Đã huỷ": "Cancelled",
  // Ngăn preset
  "Bảng bộ lọc màu": "Preset panel", "HỒ SƠ MÀU": "COLOR PROFILES", "BỘ LỌC MÀU": "PRESETS", "Đóng bảng preset": "Close preset panel",
  "Mở bảng preset (Shift+T)": "Open preset panel (Shift+T)", "Đóng bảng preset (Shift+T)": "Close preset panel (Shift+T)",
  "Rê chuột lên preset để xem trước ngay trên ảnh, bấm để áp dụng.": "Hover a preset to preview it on the photo, click to apply.",
  "Đang dùng": "In use", "Thiết lập riêng": "Custom settings", "Cường độ": "Amount",
  "Lưu thiết lập hiện tại thành preset": "Save current settings as preset", "Nhập preset Lightroom": "Import Lightroom presets",
  "Hỗ trợ XMP, LRTEMPLATE và JSON · có thể kéo thả file preset vào cửa sổ": "Supports XMP, LRTEMPLATE and JSON · you can drop preset files into the window",
  "CỦA BẠN": "YOURS", "ĐÃ NHẬP": "IMPORTED", "Xuất JSON (LUMA)": "Export JSON (LUMA)", "Xuất XMP (Lightroom)": "Export XMP (Lightroom)",
  "Đổi tên": "Rename", "Xoá preset": "Delete preset", "Lưu preset": "Save preset", "Đổi tên preset": "Rename preset", "Tên preset": "Preset name",
  "TỰ NHIÊN": "NATURAL", "THU ÂU": "EUROPEAN AUTUMN", "PHAI NHẸ": "SOFT FADE", "ĐEN TRẮNG CỔ ĐIỂN": "CLASSIC B&W", "PRESET CỦA TÔI": "MY PRESET",
  "Không thể lưu preset vào bộ nhớ trình duyệt.": "Could not save presets to browser storage.",
  // Khung xem
  "Khu vực xem trước": "Preview area", "So sánh trước và sau": "Before/after comparison", "Sau": "After", "Trước": "Before",
  "Tách đôi": "Split", "Tách đôi (Y) – kéo đường chia để so sánh": "Split (Y) – drag the divider to compare", "TRƯỚC": "BEFORE", "SAU": "AFTER",
  "Điều khiển xem": "View controls", "Cắt & xoay": "Crop & rotate", "Cắt & xoay (R)": "Crop & rotate (R)", "Cắt": "Crop",
  "Cảnh báo cháy": "Clipping", "Cảnh báo vùng cháy sáng / mất chi tiết tối (J)": "Show clipped highlights / shadows (J)",
  "Thu nhỏ": "Zoom out", "Thu nhỏ (-)": "Zoom out (-)", "Phóng to": "Zoom in", "Phóng to (+)": "Zoom in (+)", "Vừa khung": "Fit",
  "Vừa khung (Z để chuyển Vừa khung / 1:1)": "Fit (Z toggles Fit / 1:1)", "Xem 1:1 – mỗi pixel ảnh bằng một pixel màn hình": "View 1:1 – one image pixel per screen pixel",
  "Ảnh đang chỉnh": "Photo being edited", "ẢNH GỐC": "ORIGINAL", "Thoát chỉnh vùng chọn (Esc)": "Stop editing mask (Esc)",
  "Tỉ lệ": "Aspect", "Đổi khung dọc / ngang": "Swap portrait / landscape", "Đổi khung dọc / ngang (X)": "Swap portrait / landscape (X)",
  "Nắn thẳng": "Straighten", "Lưới": "Grid", "Một phần ba": "Thirds", "Tỉ lệ vàng": "Golden ratio", "Đường chéo": "Diagonals", "Không lưới": "No grid",
  "Xoay trái 90°": "Rotate left 90°", "Xoay phải 90°": "Rotate right 90°", "Lật ngang": "Flip horizontal", "Tự do": "Free", "Như ảnh gốc": "Original",
  "Khung cắt: dọc": "Crop frame: portrait", "Khung cắt: ngang": "Crop frame: landscape",
  "Kéo góc/cạnh để cắt · kéo ngoài khung để xoay · X đổi dọc/ngang · O đổi lưới · Enter xong · Esc huỷ": "Drag corners/edges to crop · drag outside to rotate · X swaps orientation · O cycles grid · Enter done · Esc cancel",
  "Bấm vào vùng trắng hoặc xám trung tính trên ảnh để cân bằng trắng · Esc để huỷ": "Click a neutral white or gray area to set white balance · Esc to cancel",
  "Bấm vào màu cần chọn trên ảnh · Esc để huỷ": "Click the color to select on the photo · Esc to cancel",
  "Thả nhiều ảnh vào đây": "Drop photos here", "Chọn cùng lúc nhiều file JPG, PNG hoặc WebP.": "Pick several JPG, PNG or WebP files at once.",
  "Chọn ảnh": "Choose photos", "Dùng ảnh mẫu": "Use sample photo", "Phiên làm việc trước": "Previous session", "Bỏ phiên cũ": "Discard session",
  "Ảnh chỉ được xử lý và lưu trên máy — không tải lên mạng.": "Photos are processed and stored on this device only — never uploaded.",
  "Thả để thêm ảnh hoặc preset": "Drop to add photos or presets",
  // Filmstrip
  "Danh sách ảnh": "Photo list", "Lưu .luma.json": "Save .luma.json", "★ trở lên": "★ and up", "★★ trở lên": "★★ and up",
  "★★★ trở lên": "★★★ and up", "★★★★ trở lên": "★★★★ and up", "Được chọn (cờ)": "Picked (flag)", "Không bị loại": "Not rejected",
  "Bị loại": "Rejected", "Được chọn": "Picked", "Đã chỉnh": "Edited", "Chưa chỉnh": "Unedited", "Đang chọn (✓)": "Selected (✓)",
  "Không có ảnh nào khớp bộ lọc.": "No photos match the filter.", "Đã chỉnh sửa": "Edited", "Chọn để xuất / đồng bộ": "Select for export / sync",
  "Bỏ ảnh khỏi phiên làm việc": "Remove photo from session", "Thiết lập được lưu vào file .luma.json cạnh từng ảnh": "Settings are saved to a .luma.json file next to each photo",
  "Thư mục chỉ đọc – thiết lập chỉ được lưu trong trình duyệt": "Read-only folder – settings are only saved in the browser",
  "sao ·": "stars ·", "cờ ·": "flags ·", "bảng điều chỉnh ·": "adjust panel ·", "ảnh gốc ·": "original ·", "phím tắt": "shortcuts",
  // Bảng điều chỉnh
  "Bảng điều chỉnh": "Adjustments panel", "ĐIỀU CHỈNH": "ADJUST", "Bảng chỉnh ảnh": "Develop", "Một nhóm": "Solo", "Thu gọn": "Collapse",
  "Thu gọn tất cả nhóm": "Collapse all sections", "Mở một nhóm thì tự đóng các nhóm khác (Alt + bấm tiêu đề cũng vậy)": "Opening a section closes the others (Alt + click a header does the same)",
  "Đóng bảng điều chỉnh": "Close adjustments panel", "Mở bảng điều chỉnh (T)": "Open adjustments panel (T)", "Đóng bảng điều chỉnh (T)": "Close adjustments panel (T)",
  "Mở một ảnh để bắt đầu chỉnh – các thanh trượt sẽ hoạt động khi có ảnh.": "Open a photo to start editing – sliders become active once a photo is loaded.",
  "Biểu đồ histogram": "Histogram", "Cảnh báo mất chi tiết vùng tối": "Shadow clipping warning", "Cảnh báo cháy sáng": "Highlight clipping warning",
  "Vùng tối bị mất chi tiết (J)": "Shadows are clipped (J)", "Vùng sáng bị cháy (J)": "Highlights are clipped (J)",
  "Chế độ một nhóm: mở nhóm này sẽ tự đóng nhóm khác.": "Solo mode: opening a section closes the others.", "Đã tắt chế độ một nhóm.": "Solo mode off.",
  "Nhóm đang tắt – bấm để bật lại": "Section is off – click to turn it back on", "Tạm tắt nhóm này để so sánh": "Temporarily turn this section off to compare",
  "ÁNH SÁNG": "LIGHT", "Tông sáng": "Light", "Tự động căn sáng dựa trên histogram": "Auto-adjust tone from the histogram",
  "MÀU SẮC": "COLOR", "Cân bằng màu": "Color balance", "Chấm trắng": "WB picker", "Chấm vào vùng xám/trắng trung tính trên ảnh (W)": "Click a neutral gray/white area on the photo (W)",
  "Tự động cân bằng trắng": "Auto white balance", "TÔNG MÀU": "TONE", "Đường cong tông": "Tone curve", "Kênh đường cong": "Curve channel",
  "Đỏ": "Red", "Lục": "Green", "Lam": "Blue", "Đường cong tông: bấm để thêm điểm, kéo để chỉnh, nhấp đúp hoặc kéo ra ngoài để xoá": "Tone curve: click to add a point, drag to adjust, double-click or drag out to remove",
  "Bấm để thêm điểm · kéo ra ngoài hoặc nhấp đúp để xoá · phím mũi tên để chỉnh tinh.": "Click to add points · drag out or double-click to remove · arrow keys to fine-tune.",
  "BỘ TRỘN MÀU": "COLOR MIXER", "Thuộc tính HSL": "HSL property", "Sắc độ": "Hue", "Bão hòa": "Saturation", "Độ sáng": "Luminance",
  "PHÂN MÀU": "COLOR GRADING", "Phân màu": "Color grading", "Vùng tối": "Shadows", "Trung tính": "Midtones", "Vùng sáng": "Highlights", "Toàn cục": "Global",
  "Hoà trộn": "Blending", "Cân bằng": "Balance", "HIỆU ỨNG": "EFFECTS", "Hiện diện & hoàn thiện": "Presence & finishing", "Hiệu ứng": "Effects",
  "CHI TIẾT": "DETAIL", "Làm nét & giảm nhiễu": "Sharpening & noise", "Chi tiết": "Detail", "ỐNG KÍNH": "LENS", "Méo hình & viền màu": "Distortion & fringing",
  "Ống kính": "Lens", "Méo hình dương sửa ảnh bị phình (góc rộng), âm sửa ảnh bị thắt (tele).": "Positive distortion fixes barrel (wide-angle), negative fixes pincushion (tele).",
  "Phơi sáng": "Exposure", "Tương phản": "Contrast", "Điểm trắng": "Whites", "Điểm đen": "Blacks", "Nhiệt độ": "Temperature", "Sắc thái": "Tint",
  "Độ rực": "Vibrance", "Kết cấu": "Texture", "Độ nét cục bộ": "Clarity", "Khử sương": "Dehaze", "Tối góc": "Vignette", "Hạt phim": "Grain",
  "Cỡ hạt": "Grain size", "Làm nét": "Sharpening", "Giảm nhiễu sáng": "Luminance noise", "Giảm nhiễu màu": "Color noise", "Méo hình": "Distortion",
  "Khử viền tím/lục": "Defringe purple/green", "Độ sắc nét": "Sharpness", "Giảm nhiễu": "Noise reduction", "Giảm moiré màu": "Color moiré",
  "Nhấp đúp để đặt lại": "Double-click to reset",
  "Cam": "Orange", "Vàng": "Yellow", "Xanh ngọc": "Aqua", "Xanh dương": "Blue", "Tím": "Purple", "Hồng tím": "Magenta",
  "Tạm tắt nhóm Tông sáng": "Turn Light off", "Tạm tắt nhóm Cân bằng màu": "Turn Color balance off", "Tạm tắt nhóm Đường cong tông": "Turn Tone curve off",
  "Tạm tắt nhóm HSL": "Turn HSL off", "Tạm tắt nhóm Phân màu": "Turn Color grading off", "Tạm tắt nhóm Hiệu ứng": "Turn Effects off",
  "Tạm tắt nhóm Chi tiết": "Turn Detail off", "Tạm tắt nhóm Ống kính": "Turn Lens off", "Tạm tắt tất cả vùng chọn": "Turn all masks off",
  // Vùng chọn
  "ĐIỀU CHỈNH CỤC BỘ": "LOCAL ADJUSTMENTS", "Vùng chọn": "Masks", "Thêm vùng chọn": "Add mask", "+ Bầu trời": "+ Sky", "+ Cọ vùng": "+ Brush",
  "+ Dải sáng": "+ Luminance", "+ Dải màu": "+ Color", "Các vùng chọn": "Masks", "Bầu trời": "Sky", "Cọ vùng": "Brush", "Dải sáng": "Luminance range",
  "Dải màu": "Color range", "Trời": "Sky", "Cọ": "Brush",
  "Thêm vùng chọn để chỉnh sáng, màu và chi tiết cục bộ. Tối đa 8 vùng.": "Add a mask to adjust light, color and detail locally. Up to 8 masks.",
  "Chọn một vùng trong danh sách để chỉnh.": "Select a mask in the list to edit it.", "Hiện lớp phủ": "Show overlay", "Đảo vùng": "Invert",
  "Xoá nét cọ": "Clear strokes", "Cỡ cọ": "Size", "Độ mềm": "Feather", "Lưu lượng": "Flow", "Tẩy (giữ Alt)": "Erase (hold Alt)", "Xoay": "Rotation",
  "Giới hạn theo": "Refine by", "Trừ dải này": "Subtract range", "Chọn màu": "Pick color", "Bấm rồi chọn màu trên ảnh": "Click, then pick a color on the photo",
  "Từ (tối)": "From (dark)", "Đến (sáng)": "To (bright)", "Dung sai màu": "Color tolerance", "Bật vùng chọn": "Enable mask", "Tạm tắt vùng chọn": "Disable mask",
  "Nhân bản": "Duplicate", "Xoá vùng chọn (Delete)": "Delete mask (Delete)", "∩ sáng": "∩ luma", "∩ màu": "∩ color", "đảo": "inverted",
  "Vùng trời được nhận diện tự động theo màu và vị trí. Chỉ chỉnh màu – không thay hay ghép trời.": "The sky is detected automatically from color and position. Color only – the sky is never replaced.",
  "Tô trực tiếp trên ảnh. Giữ Alt để tẩy, phím [ ] đổi cỡ cọ.": "Paint directly on the photo. Hold Alt to erase, [ ] to change brush size.",
  "Kéo trên ảnh để vẽ gradient mới; kéo tay nắm để chỉnh, kéo đường giữa để di chuyển.": "Drag on the photo to draw a new gradient; drag handles to adjust, drag the middle line to move.",
  "Kéo trên ảnh để vẽ oval mới (Shift: tròn đều); kéo tâm để di chuyển, tay nắm để đổi cỡ hoặc xoay.": "Drag on the photo to draw a new oval (Shift: circle); drag the center to move, handles to resize or rotate.",
  "Chọn vùng theo độ sáng của ảnh gốc. Chỉnh khoảng Từ – Đến bên dưới.": "Selects by brightness of the original photo. Adjust the From – To range below.",
  "Chọn vùng theo màu. Bấm “Chọn màu” rồi bấm vào ảnh.": "Selects by color. Click “Pick color”, then click the photo.",
  "Màu này gần như xám – hãy chọn vùng có màu rõ hơn, hoặc dùng Dải sáng.": "This color is almost gray – pick a more colorful area, or use Luminance range.",
  "Đã xoá vùng chọn.": "Mask deleted.", "Đã xoá nét cọ.": "Brush strokes cleared.",
  // Lịch sử
  "LỊCH SỬ": "HISTORY", "Lịch sử & snapshot": "History & snapshots", "Lưu trạng thái hiện tại thành mốc có tên": "Save the current state as a named snapshot",
  "Snapshot": "Snapshots", "Các bước": "Steps", "Các bước chỉnh sửa": "Editing steps", "Trạng thái đầu": "Initial state", "Tạo snapshot": "Create snapshot",
  "Tên snapshot": "Snapshot name", "Xoá snapshot": "Delete snapshot",
  "Chưa có snapshot. Tạo snapshot để lưu các phiên bản chỉnh và quay lại bất cứ lúc nào.": "No snapshots yet. Create one to keep a version of your edit and return to it any time.",
  "Chỉnh sửa": "Edit", "Đặt lại ảnh": "Reset photo", "Đặt lại đường cong": "Reset curve", "Đặt lại phân màu": "Reset color grading",
  "Tự động tông sáng": "Auto tone", "Chấm cân bằng trắng": "White balance picker", "Độ mềm vùng chọn": "Mask feather", "Xoay vùng chọn": "Mask rotation",
  "Đã đặt lại ảnh đang xem.": "This photo was reset.", "Đã tự động căn tông sáng.": "Tone adjusted automatically.",
  // Hộp thoại
  "XUẤT FILE": "EXPORT", "Preset xuất": "Export preset", "Tuỳ chỉnh": "Custom", "Lưu các tuỳ chọn hiện tại thành preset xuất": "Save these options as an export preset",
  "Xoá preset xuất": "Delete export preset", "Phạm vi": "Scope", "Các ảnh đã chọn (✓)": "Selected photos (✓)", "Chỉ ảnh đang xem": "Current photo only",
  "Ảnh đang hiện theo bộ lọc": "Photos shown by the filter", "Định dạng": "Format", "Chất lượng": "Quality", "Kích thước": "Size",
  "Kích thước đầy đủ": "Full size", "Giới hạn cạnh dài": "Limit long edge", "Cạnh dài (px)": "Long edge (px)", "Làm nét khi xuất": "Output sharpening",
  "Màn hình · nhẹ": "Screen · low", "Màn hình · chuẩn": "Screen · standard", "Màn hình · mạnh": "Screen · high", "Lưu file": "Save to",
  "Tên file": "File name", "Chèn biến vào tên file": "Insert a token into the file name", "Tên ảnh gốc": "Original file name", "Ngày xuất": "Export date",
  "Giờ xuất": "Export time", "Số thứ tự 001, 002…": "Sequence 001, 002…", "Kích thước xuất": "Export size", "Số sao": "Rating", "Tên preset đang dùng": "Preset in use",
  "Giữ thông tin máy ảnh (EXIF) khi xuất JPEG": "Keep camera info (EXIF) in JPEG", "Giữ cả vị trí GPS": "Also keep GPS location", "Số lượng": "Photos",
  "Đang chuẩn bị…": "Preparing…", "Xuất ngay": "Export now", "Chọn thư mục lưu": "Choose a folder", "Gói thành một file ZIP": "Pack into one ZIP file",
  "Tải từng file về thư mục Tải xuống": "Download each file to Downloads", "Tải về thư mục Tải xuống": "Download to Downloads", "Đang đóng gói ZIP…": "Packing ZIP…",
  "Đầy đủ · JPEG 95%": "Full · JPEG 95%", "Mạng xã hội · 2048px": "Social media · 2048px", "In ấn · PNG đầy đủ": "Print · full PNG",
  "Lưu preset xuất": "Save export preset", "Tên preset xuất": "Export preset name", "Preset xuất của tôi": "My export preset",
  "Không mở được thư mục, sẽ tải file về thư mục Tải xuống.": "Could not open the folder, files will go to Downloads.",
  "THIẾT LẬP": "SETTINGS", "SAO CHÉP": "COPY", "ĐỒNG BỘ": "SYNC", "Sao chép thiết lập": "Copy settings", "Đồng bộ thiết lập": "Sync settings", "Sao chép": "Copy",
  "Ánh sáng": "Light", "Bộ trộn HSL": "HSL mixer", "Vùng chọn (trừ cọ)": "Masks (except brush)",
  "Hãy chọn thêm ảnh trong filmstrip (ô ✓ hoặc Ctrl + bấm) để đồng bộ.": "Select more photos in the filmstrip (✓ box or Ctrl + click) to sync.",
  "Đã dán thiết lập.": "Settings pasted.", "Dán thiết lập": "Paste settings", "ĐẶT TÊN": "NAME", "TRỢ GIÚP": "HELP",
  // Phím tắt
  "(giữ)": "(hold)", "Xem nhanh ảnh gốc": "Peek at the original", "Bật/tắt so sánh tách đôi": "Toggle split comparison",
  "Mở/đóng bảng điều chỉnh / bảng preset": "Toggle adjustments panel / preset panel", "Cắt & xoay ·": "Crop & rotate ·", "đổi dọc/ngang ·": "swap orientation ·",
  "đổi lưới ·": "cycle grid ·", "xong ·": "done ·", "huỷ": "cancel", "Đặt lại ảnh đang xem.": "This photo was reset.",
  "Cảnh báo cháy sáng / mất chi tiết tối": "Highlight / shadow clipping warning", "Hiện lớp phủ vùng chọn": "Show mask overlay",
  "Thoát chỉnh vùng chọn / xoá vùng chọn đang chọn": "Stop editing mask / delete the selected mask", "Gắn sao cho ảnh đang xem": "Rate the current photo",
  "Cờ chọn / loại / bỏ cờ": "Pick / reject / unflag", "Chuyển Vừa khung ↔ 1:1": "Toggle Fit ↔ 1:1", "· cuộn chuột": "· mouse wheel",
  "Phóng to / thu nhỏ": "Zoom in / out", "+ kéo": "+ drag", "Di chuyển ảnh khi đang phóng to": "Pan while zoomed in", "Ảnh trước / sau (theo bộ lọc)": "Previous / next photo (by filter)",
  "Ctrl / Shift + bấm ảnh": "Ctrl / Shift + click photo", "Chọn thêm / chọn một dãy trong filmstrip": "Add to selection / select a range in the filmstrip",
  "Sao chép / dán thiết lập": "Copy / paste settings", "Đồng bộ sang ảnh đã chọn": "Sync to selected photos", "Thanh trượt": "Sliders",
  "Nhấp đúp nhãn/thanh để đặt lại ·": "Double-click label/slider to reset ·", "+ kéo để chỉnh tinh ·": "+ drag for fine control ·",
  "+ mũi tên bước ×10 · cuộn chuột khi đang chọn": "+ arrows step ×10 · mouse wheel when focused", "Tiêu đề nhóm": "Section headers",
  "+ bấm: chỉ mở nhóm đó · nút con mắt: tạm tắt nhóm để so sánh": "+ click: open only that section · eye button: turn a section off to compare",
  "Giữ": "Hold", "để tẩy ·": "to erase ·", "đổi cỡ cọ": "brush size",
  // Thông báo
  "Vui lòng chọn ảnh JPG, PNG hoặc WebP.": "Please choose JPG, PNG or WebP photos.", "Không thể mở ảnh mẫu.": "Could not open the sample photo.",
  "Trình duyệt không cho phép toàn màn hình.": "The browser does not allow fullscreen.", "Không thể khởi động LUMA": "LUMA could not start",
  "Hãy mở bằng Chrome hoặc Edge phiên bản mới (cần WebGL 2).": "Please use a recent Chrome or Edge (WebGL 2 required).",
  "Trình duyệt này chưa hỗ trợ WebGL 2.": "This browser does not support WebGL 2.",
  "GPU bị mất kết nối — hãy tải lại trang. Phiên làm việc đã được tự lưu.": "The GPU connection was lost — please reload. Your session was autosaved.",
  "Trình duyệt này chưa hỗ trợ mở thư mục. Hãy dùng Chrome hoặc Edge.": "This browser cannot open folders. Please use Chrome or Edge.",
  "Không mở được thư mục.": "Could not open the folder.", "Không còn dữ liệu phiên.": "No session data left.", "Không thể khôi phục phiên.": "Could not restore the session.",
  "Đã bỏ phiên cũ.": "Previous session discarded.", "Không thể tự lưu phiên (bộ nhớ trình duyệt bị chặn).": "Could not autosave (browser storage is blocked).",
  "Bộ nhớ trình duyệt đã đầy – không tự lưu được phiên. Hãy bỏ bớt ảnh hoặc dùng “Mở thư mục” để không phải chép ảnh vào trình duyệt.": "Browser storage is full – the session cannot be autosaved. Remove some photos or use “Open folder” so photos aren't copied into the browser.",
  "Không ghi được file .luma.json vào thư mục – thiết lập vẫn được lưu trong trình duyệt.": "Could not write .luma.json to the folder – settings are still saved in the browser.",
  "Không thể biên dịch shader.": "Could not compile the shader.", "Không thể khởi tạo bộ xử lý ảnh.": "Could not initialize the image processor.",
  "Đã gắn cờ chọn": "Flagged as picked", "Đã đánh dấu loại": "Marked as rejected", "Đã bỏ cờ": "Flag removed",
};

// Mẫu có biến: {0}, {1}… (giá trị biến cũng được dịch nếu có trong từ điển)
const PATTERNS = [
  ["{0} × {1} (gốc {2} × {3})", "{0} × {1} (original {2} × {3})"],
  ["{0} × {1} · {2} EV · {3} vùng chọn", "{0} × {1} · {2} EV · {3} masks"],
  ["{0} (bản sao {1})", "{0} (virtual copy {1})"],
  ["Tắt nhóm {0}", "Turn off {0}"], ["Bật nhóm {0}", "Turn on {0}"],
  ["{0}: không thể nhập.", "{0}: could not import."], ["{0}: không thể đọc ảnh.", "{0}: could not read the photo."],
  ["{0}: định dạng không được hỗ trợ.", "{0}: unsupported format."], ["{0}: ảnh {1}×{2} vượt giới hạn {3}px của GPU trên máy này.", "{0}: {1}×{2} exceeds this GPU's {3}px limit."],
  ["{0}: JSON không hợp lệ.", "{0}: invalid JSON."], ["{0}: không tìm thấy thông số màu.", "{0}: no color settings found."],
  ["{0}: preset không có thông số tương thích.", "{0}: the preset has no compatible settings."],
  ["{0} Bấm chỗ trống hoặc Esc để thoát · Delete để xoá.", "{0} Click empty space or press Esc to finish · Delete to remove."],
  ["{0} cho {1} ảnh.", "{0} for {1} photo(s)."], ["Bật {0}", "Enable {0}"], ["Tắt {0}", "Disable {0}"],
  ["{0}: {1}×{2} vượt giới hạn canvas của trình duyệt. Hãy giảm kích thước xuất.", "{0}: {1}×{2} exceeds the browser canvas limit. Reduce the export size."],
  ["{0}: không thể mã hoá file xuất.", "{0}: could not encode the export."], ["{0}: không đủ bộ nhớ để tạo ảnh {1}×{2}.", "{0}: not enough memory for a {1}×{2} image."],
  ["{0}: xuất thất bại.", "{0}: export failed."], ["{0}\nCtrl + bấm: chọn thêm · Shift + bấm: chọn một dãy", "{0}\nCtrl + click: add to selection · Shift + click: select a range"],
  ["{0} (SỬA)", "{0} (EDIT)"], ["{0} được chọn", "{0} selected"], ["{0} ảnh · lưu lúc {1}", "{0} photo(s) · saved {1}"], ["{0}/{1} ảnh", "{0}/{1} photos"], ["{0} ảnh", "{0} photo(s)"],
  ["{0}: sắc độ {1}°, bão hòa {2}", "{0}: hue {1}°, saturation {2}"],
  ["Bỏ {0} khỏi phiên làm việc", "Remove {0} from the session"], ["Chỉnh {0}", "Edit {0}"], ["Chọn {0} để xuất / đồng bộ", "Select {0} for export / sync"],
  ["Chọn màu cho {0}", "Pick color for {0}"],
  ["Chọn nhóm thiết lập cần sao chép từ “{0}”. Sau đó dùng Dán (Ctrl+Shift+V) trên ảnh khác.", "Choose which settings to copy from “{0}”. Then use Paste (Ctrl+Shift+V) on another photo."],
  ["Cân bằng trắng: nhiệt độ {0}, sắc thái {1}.", "White balance: temperature {0}, tint {1}."], ["Cường độ {0}", "Amount {0}"],
  ["Dung lượng trình duyệt đã dùng {0}% hạn mức", "Browser storage used: {0}% of quota"], ["Giá trị {0}", "{0} value"], ["Giới hạn {0}", "Refine {0}"],
  ["Mở ảnh {0}: {1}", "Open photo {0}: {1}"], ["Nhân bản {0}", "Duplicate {0}"], ["Phiên: {0}", "Session: {0}"], ["Phân màu {0}", "Color grading {0}"],
  ["Quay lại {0} bước", "Go back {0} step(s)"], ["Tiến tới {0} bước", "Go forward {0} step(s)"], ["Sao chép từ {0}", "Copy from {0}"], ["Sắc độ {0}°", "Hue {0}°"],
  ["Thêm {0}", "Add {0}"], ["Thêm vùng chọn để chỉnh sáng, màu và chi tiết cục bộ. Tối đa {0} vùng.", "Add a mask to adjust light, color and detail locally. Up to {0} masks."],
  ["Thư mục “{0}” không có ảnh JPG, PNG hoặc WebP.", "Folder “{0}” has no JPG, PNG or WebP photos."], ["Trừ dải {0}", "Subtract range {0}"],
  ["Tô {0}", "Paint {0}"], ["Tẩy {0}", "Erase {0}"], ["Tối đa {0} vùng chọn cho mỗi ảnh.", "Up to {0} masks per photo."],
  ["Tự động cân bằng trắng: nhiệt độ {0}, sắc thái {1}.", "Auto white balance: temperature {0}, tint {1}."], ["Ví dụ: {0}", "Example: {0}"],
  ["Vòng màu {0}", "{0} color wheel"], ["Vẽ {0}", "Draw {0}"], ["Vừa · {0}%", "Fit · {0}%"], ["XEM TRƯỚC · {0}", "PREVIEW · {0}"], ["Xoá nét {0}", "Clear strokes {0}"],
  ["Xoá snapshot {0}", "Delete snapshot {0}"], ["Xoá {0}", "Delete {0}"], ["Áp dụng snapshot · tạo lúc {0}", "Apply snapshot · created {0}"],
  ["Áp thiết lập của “{0}” sang {1} ảnh đã chọn khác.", "Apply the settings of “{0}” to {1} other selected photo(s)."],
  ["Đang chỉnh: {0} · lớp phủ", "Editing: {0} · overlay"], ["Đang chỉnh: {0}", "Editing: {0}"], ["Đang mở {0}/{1} ảnh…", "Opening {0}/{1} photos…"], ["Đang mở {0} ảnh…", "Opening {0} photo(s)…"],
  ["Đang xuất {0}/{1}…", "Exporting {0}/{1}…"], ["Đang xử lý {0}/{1}: {2}", "Processing {0}/{1}: {2}"], ["Đã bật lại nhóm {0}.", "{0} turned back on."],
  ["Đã bỏ {0} khỏi phiên.", "Removed {0} from the session."], ["Đã bỏ sao cho {0} ảnh.", "Rating cleared for {0} photo(s)."], ["Đã dừng xuất ({0} ảnh đã xong).", "Export stopped ({0} photo(s) done)."],
  ["Đã gắn {0} cho {1} ảnh.", "Rated {0} for {1} photo(s)."], ["Đã hoàn tác: {0}.", "Undone: {0}."], ["Đã làm lại: {0}.", "Redone: {0}."],
  ["Đã khôi phục {0} ảnh · {1} ảnh không tìm thấy (chưa cấp quyền thư mục).", "Restored {0} photo(s) · {1} not found (folder permission not granted)."],
  ["Đã khôi phục {0} ảnh · {1} ảnh không tìm thấy.", "Restored {0} photo(s) · {1} not found."], ["Đã khôi phục {0} ảnh.", "Restored {0} photo(s)."],
  ["Đã lưu preset xuất “{0}”.", "Saved export preset “{0}”."], ["Đã lưu preset “{0}”.", "Saved preset “{0}”."],
  ["Đã mở {0} ảnh từ “{1}” · khôi phục thiết lập của {2} ảnh.", "Opened {0} photo(s) from “{1}” · restored settings for {2}."], ["Đã mở {0} ảnh từ “{1}”.", "Opened {0} photo(s) from “{1}”."],
  ["Đã nhập {0} preset Lightroom.", "Imported {0} Lightroom preset(s)."], ["Đã nhập {0} preset · {1} file lỗi: {2}", "Imported {0} preset(s) · {1} file(s) failed: {2}"],
  ["Đã sao chép {0} nhóm thiết lập.", "Copied {0} setting group(s)."], ["Đã sao chép thiết lập từ {0}.", "Copied settings from {0}."],
  ["Đã thêm {0} ảnh, {1} ảnh không mở được.", "Added {0} photo(s), {1} could not be opened."], ["Đã thêm {0} ảnh.", "Added {0} photo(s)."],
  ["Đã tạm tắt nhóm {0} (áp dụng cả khi xuất).", "{0} turned off (also applies to export)."], ["Đã tạo bản sao ảo của {0}.", "Created a virtual copy of {0}."],
  ["Đã tạo snapshot “{0}”.", "Created snapshot “{0}”."], ["Đã xong {0}/{1}", "Done {0}/{1}"], ["Đã xoá preset “{0}”.", "Deleted preset “{0}”."],
  ["Đã xuất {0} ảnh thành công.", "Exported {0} photo(s)."], ["Đã xuất {0} ảnh · {1} lỗi: {2}", "Exported {0} photo(s) · {1} error(s): {2}"],
  ["Đã áp dụng snapshot “{0}”.", "Applied snapshot “{0}”."], ["Đã đồng bộ sang {0} ảnh.", "Synced to {0} photo(s)."], ["Đảo {0}", "Invert {0}"],
  ["Đồng bộ {0} ảnh", "Sync {0} photo(s)"], ["Đồng bộ từ {0}", "Synced from {0}"], ["Độ sáng {0} · nhấp đúp để đặt lại", "{0} luminance · double-click to reset"],
  ["Độ sáng {0}", "{0} luminance"], ["Snapshot: {0}", "Snapshot: {0}"], ["Preset {0}", "Preset {0}"],
];

const MASK_LABEL = /^(Bầu trời|Cọ vùng|Gradient|Oval|Dải sáng|Dải màu) (\d+)$/;

const compiled = PATTERNS.map(([vi, en]) => {
  const parts = vi.split(/(\{\d\})/);
  const order = [];
  const source = parts.map((p) => {
    const m = /^\{(\d)\}$/.exec(p);
    if (m) { order.push(Number(m[1])); return "([\\s\\S]+?)"; }
    return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { regex: new RegExp(`^${source}$`), order, en, weight: vi.replace(/\{\d\}/g, "").length };
}).sort((a, b) => b.weight - a.weight);

function translateCore(text) {
  if (Object.prototype.hasOwnProperty.call(EXACT, text)) return EXACT[text];
  const mask = MASK_LABEL.exec(text);
  if (mask) return `${EXACT[mask[1]] || mask[1]} ${mask[2]}`;
  for (const p of compiled) {
    const m = p.regex.exec(text);
    if (!m) continue;
    const values = [];
    p.order.forEach((index, i) => { values[index] = m[i + 1]; });
    return p.en.replace(/\{(\d)\}/g, (_, i) => translateCore(values[i] ?? "") ?? values[i] ?? "");
  }
  // "Nhãn: giá trị" (ví dụ bước lịch sử "Oval 1: Phơi sáng")
  const colon = text.indexOf(": ");
  if (colon > 0) {
    const a = translateCore(text.slice(0, colon)), b = translateCore(text.slice(colon + 2));
    if (a !== null || b !== null) return `${a ?? text.slice(0, colon)}: ${b ?? text.slice(colon + 2)}`;
  }
  return null;
}

export function translate(text) {
  if (!text) return null;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const core = text.trim();
  if (!core) return null;
  const out = translateCore(core);
  return out === null ? null : `${lead}${out}${trail}`;
}

/* ---------- Áp dụng lên DOM ---------- */

const ATTRS = ["title", "aria-label", "placeholder", "aria-valuetext", "alt"];
const textOriginals = new Map(); // node → bản tiếng Việt
const attrOriginals = new Map(); // element → { attr: bản tiếng Việt }
let lang = "vi";
let observer = null;
let applying = false;

function translateTextNode(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest("script, style, [data-no-i18n]")) return;
  const current = node.nodeValue;
  const tr = translate(current);
  if (tr === null || tr === current) return;
  textOriginals.set(node, current);
  node.nodeValue = tr;
}

function translateAttrs(element) {
  if (element.closest?.("[data-no-i18n]")) return;
  for (const attr of ATTRS) {
    const value = element.getAttribute?.(attr);
    if (!value) continue;
    const tr = translate(value);
    if (tr === null || tr === value) continue;
    const saved = attrOriginals.get(element) || {};
    saved[attr] = value;
    attrOriginals.set(element, saved);
    element.setAttribute(attr, tr);
  }
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    else translateAttrs(node);
    node = walker.nextNode();
  }
}

function withApplying(fn) {
  applying = true;
  try { fn(); } finally { observer?.takeRecords(); applying = false; }
}

function prune() {
  for (const node of textOriginals.keys()) if (!node.isConnected) textOriginals.delete(node);
  for (const element of attrOriginals.keys()) if (!element.isConnected) attrOriginals.delete(element);
}

function onMutations(records) {
  if (applying || lang !== "en") return;
  if (textOriginals.size > 3000) prune();
  withApplying(() => {
    for (const r of records) {
      if (r.type === "characterData") translateTextNode(r.target);
      else if (r.type === "attributes") translateAttrs(r.target);
      else r.addedNodes.forEach(translateTree);
    }
  });
}

function restoreAll() {
  withApplying(() => {
    for (const [node, original] of textOriginals) if (node.isConnected) node.nodeValue = original;
    for (const [element, saved] of attrOriginals) {
      if (!element.isConnected) continue;
      for (const [attr, value] of Object.entries(saved)) element.setAttribute(attr, value);
    }
    textOriginals.clear();
    attrOriginals.clear();
  });
}

const VI_TITLE = "LUMA — Chỉnh màu ảnh";

export function setLanguage(next) {
  lang = next === "en" ? "en" : "vi";
  document.documentElement.lang = lang;
  safeLocalStorage(() => localStorage.setItem("luma.lang", lang));
  if (lang === "en") {
    withApplying(() => translateTree(document.body));
    document.title = translate(VI_TITLE);
  } else {
    restoreAll();
    document.title = VI_TITLE;
  }
  el.langToggle.textContent = lang === "en" ? "VI" : "EN";
  el.langToggle.setAttribute("aria-label", lang === "en" ? "Chuyển sang tiếng Việt" : "Switch to English");
  el.langToggle.title = lang === "en" ? "Chuyển sang tiếng Việt" : "Switch to English";
}

export const currentLanguage = () => lang;
export const toggleLanguage = () => setLanguage(lang === "en" ? "vi" : "en");

export function initI18n() {
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const saved = safeLocalStorage(() => localStorage.getItem("luma.lang"), null);
  const preferred = saved || "vi";
  if (preferred === "en") setLanguage("en");
}
