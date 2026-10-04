# Tiệm Bill – hướng dẫn cài đặt

App tính tiền theo dịch vụ, in bill ra máy in **ZyWell Zy-Q822 (80mm)**, xem thống kê cuối tháng.
Dùng **iPhone** để tick dịch vụ và bấm in; **một máy tính ở quầy** (cắm USB vào máy in) làm "cầu nối".
Không tốn phí, không cần internet (chỉ cần WiFi nội bộ).

```
iPhone ──WiFi──► Máy tính ở quầy (chạy Tiệm Bill) ──USB──► Máy in Zy-Q822
```

Dữ liệu (dịch vụ, bill, doanh thu) lưu **trên máy tính ở quầy**, không nằm trong iPhone nên đổi/mất điện thoại cũng không mất dữ liệu.

---

## Phần 1. Cài một lần trên máy tính ở quầy (~15 phút)

Máy này nên là laptop/PC Windows cũ cũng được, **bật suốt giờ bán hàng** và dùng chung WiFi với iPhone.

1. **Cài Node.js**: vào <https://nodejs.org>, tải bản **LTS**, cài bình thường (Next → Next → Finish).
2. **Chép thư mục `tiem-bill`** vào máy, ví dụ `C:\tiem-bill` (giải nén nếu nhận file .zip).
3. **Cắm USB máy in và bật nguồn.** Windows phải thấy máy in (Cài đặt → Bluetooth & thiết bị → Máy in & máy quét).
   - Nếu máy này đã từng in bằng KiotViet thì máy in đã có sẵn, bỏ qua bước này.
   - Nếu chưa thấy, cài driver Zy-Q822 theo đĩa/nhà bán; thiếu driver thì dùng tạm "Generic / Text Only".
4. **Bấm đúp `start.bat`.** Hiện cửa sổ đen có dòng "TIỆM BILL đang chạy" và các địa chỉ dạng `http://192.168.x.x:3000`.
   - Windows hỏi tường lửa (Firewall) → chọn **Cho phép (Allow)**, tích **Mạng riêng tư (Private)**.
   - **Đừng tắt cửa sổ đen** khi đang bán hàng (thu nhỏ xuống thanh taskbar là được).
5. Mở trình duyệt **trên chính máy này**: `http://localhost:3000`
6. Vào **Cài đặt**:
   - Mục **Dịch vụ & giá**: sửa/thêm dịch vụ (đã có sẵn Sơn 50k, Đắp bột 100k, Cắt da 30k).
   - Mục **Thông tin in trên bill**: nhập tên tiệm, địa chỉ, số điện thoại, lời cảm ơn.
   - Mục **Máy in**: để "Cắm USB vào máy tính Windows" → bấm **Tìm máy in trên máy tính này** → chọn tên máy in (ví dụ *Zy-Q822*) trong ô tên → bấm **In thử một bill**.
   - Bill in thử phải ra đủ chữ tiếng Việt có dấu và không bị cụt hai bên.

## Phần 2. Dùng trên iPhone (~3 phút)

1. iPhone nối **cùng WiFi** với máy ở quầy.
2. Mở **Safari**, gõ địa chỉ `http://192.168.x.x:3000` (địa chỉ nằm trong cửa sổ đen, hoặc ở **Cài đặt → Mở app trên iPhone**).
3. Bấm nút **Chia sẻ** (hình vuông có mũi tên) → **Thêm vào Màn hình chính** → Thêm.
4. Từ giờ mở app bằng icon "Tiệm Bill" như app thường.

**Cách dùng hàng ngày**
- Tab **Tính tiền**: chạm vào dịch vụ để tick (chạm lần nữa để bỏ), bấm ＋/− nếu làm nhiều lượt, ghi tên khách nếu muốn → **Lưu & In bill**.
- Khoản phát sinh ngoài danh sách: **＋ Thêm khoản khác**.
- Tab **Lịch sử**: xem bill từng ngày, **in lại** hoặc **xoá** bill nhập nhầm.
- Tab **Thống kê**: số khách, doanh thu, dịch vụ nào bán nhiều, doanh thu từng ngày; có nút tải bảng Excel (CSV) của tháng.

## Phần 3. Làm cho ổn định

**Cố định địa chỉ máy tính ở quầy** (để link trên iPhone không bị đổi): vào trang quản trị modem/router (thường `192.168.1.1`), tìm mục **DHCP Reservation / Gán IP tĩnh** và gán một IP cố định cho máy tính ở quầy. Không rành thì nhờ thợ mạng làm giúp 5 phút.

**Tự chạy khi bật máy tính**: bấm `Win + R`, gõ `shell:startup`, Enter. Chuột phải file `start.bat` → *Tạo lối tắt (Create shortcut)* → kéo lối tắt đó vào thư mục vừa mở.

**Không cho máy ngủ**: Cài đặt → Hệ thống → Nguồn → đặt "Ngủ khi cắm điện" = **Không bao giờ**.

**Sao lưu**: app tự chép dữ liệu mỗi ngày vào `tiem-bill\data\backup`. Nên thỉnh thoảng (cuối tháng) vào **Cài đặt → Tải file sao lưu** để lưu một bản ra điện thoại/Google Drive.
Muốn chuyển sang máy tính khác: chép nguyên thư mục `tiem-bill` (có cả `data`) sang máy mới.

## Nếu in bằng dây mạng (LAN) thay vì USB

Cắm dây mạng từ máy in vào modem. Để biết IP máy in: tắt máy in, giữ nút **FEED**, bật nguồn, thả tay → máy in ra tờ tự kiểm tra có dòng IP. Trong **Cài đặt → Máy in** chọn "Cắm dây mạng (LAN)", nhập IP, cổng `9100`, bấm In thử. (Máy này cũng nên được gán IP cố định trong modem.)

## Máy Mac

Dùng `start.command` thay cho `start.bat`. Trong Cài đặt → Máy in chọn "Máy Mac / Linux (CUPS)" và nhập đúng tên máy in (bấm Tìm máy in).

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| iPhone báo không kết nối được | Kiểm tra máy tính còn bật, cửa sổ đen còn chạy, iPhone cùng WiFi; địa chỉ IP có đổi không (xem lại trong cửa sổ đen). |
| Báo "Chưa in được" nhưng bill đã lưu | Bill vẫn nằm trong Lịch sử. Kiểm tra máy in bật, còn giấy, dây USB; rồi bấm **Thử in lại**. |
| "Không mở được máy in" | Tên máy in trong Cài đặt chưa đúng. Bấm **Tìm máy in** và chọn lại. |
| In ra chữ cụt hai bên / dư lề trắng | Cài đặt → Máy in → **Khổ giấy**: thử lần lượt các mức (576 → 512 → 640) rồi In thử. |
| Bill không tự cắt giấy | Tắt tích "Tự cắt giấy" (máy chỉ cần xé tay), hoặc tăng số dòng đẩy giấy. |
| Chữ in nhạt | Giấy nhiệt cũ/xấu, hoặc chỉnh độ đậm bằng công cụ của máy in (không chỉnh được trong app). |
| Báo "Cổng 3000 đang được dùng" | App đã chạy ở cửa sổ khác rồi. Đóng cửa sổ cũ rồi chạy lại. |
| Mất dữ liệu / nhập nhầm | **Cài đặt → Khôi phục từ file** bằng file sao lưu, hoặc lấy bản trong `data\backup`. |

## Ngưng KiotViet

Chạy song song vài ngày, so tổng tiền hai bên khớp rồi mới ngưng. Trước khi hết hạn, xuất dữ liệu cũ từ KiotViet ra Excel để giữ sổ sách.
