# Kịch bản video demo (dưới 3 phút)

Video nộp cho Reactive Omni Buildathon, hạng mục **Every Second Counts**. Ban giám khảo đọc tiếng Anh, nên chữ hiện trên màn hình (cột "Chữ trên màn hình") để bằng tiếng Anh. Phần lời đọc có thể bỏ, chỉ cần chèn chữ.

## Chuẩn bị trước khi quay

1. Mở dashboard: `http://127.0.0.1:5173/app/` (hoặc link công khai nếu đã có).
2. Kết nối MetaMask bằng ví `0xF964…6a57` trên mạng **Base Sepolia**. Ví này là operator nên bấm được **Push price**.
3. Kiểm tra số liệu hiện tại ở trang **Overview**. Lúc viết kịch bản (18/11/2026): giá $1,800 (v4), nợ 400 mUSD, reserve 50 mUSD, ngưỡng kích hoạt $1,350, mức giới hạn mỗi lần 120 mUSD.
4. Mở sẵn 2 tab trình duyệt: Basescan (sepolia.basescan.org) và Reactscan (lasna.reactscan.net).
5. Phần mềm quay màn hình: trên Mac bấm `Cmd + Shift + 5`, chọn quay toàn màn hình.

### Chọn mức giá cho cảnh chính

Vault chỉ trả nợ khi giá ≤ $1,350 **và** tỷ lệ tài sản thế chấp / nợ thấp hơn 150%. Với nợ 400 mUSD và 1 mCOL:

| Giá đẩy vào | Tỷ lệ | Kết quả |
|---|---|---|
| $1,300 | 325% | Reactive vẫn gọi callback, vault **bỏ qua** với lý do `NothingToRepay` (cảnh phụ, cho thấy vault tự kiểm tra) |
| **$550** | 137.5% | Vault **tự trả 33.33 mUSD**, nợ 400 → 366.67, tỷ lệ về đúng 150% (cảnh chính) |

Nếu nợ hoặc reserve đã khác, tính lại: giá cần đẩy < nợ × 1.5 và ≤ $1,350.

## Kịch bản

| Thời gian | Màn hình | Chữ trên màn hình |
|---|---|---|
| 0:00–0:15 | Trang chủ Repay Relay, cuộn qua sơ đồ | "Repay Relay: when the price drops, your loan repays itself. Base Sepolia → Reactive Lasna → Base Sepolia." |
| 0:15–0:40 | Dashboard, trang **Position**: nợ, reserve, đồng hồ tỷ lệ | "A borrower keeps a repay reserve and sets a trigger price. No bot, no keeper." |
| 0:40–0:55 | Trang **Protection**: ngưỡng $1,350, giới hạn 120 mUSD | "Protection: trigger $1,350, at most 120 mUSD per callback, target ratio 150%." |
| 0:55–1:30 | Bấm **Push price** → nhập `550` → xác nhận trên MetaMask → chờ toast thành công | "The oracle publishes a new price on Base Sepolia." |
| 1:30–2:00 | Trang **Overview** / **Activity**: lượt chạy mới chuyển sang "Debt repaid", đồng hồ tỷ lệ nhảy về 150% | "Reactive Lasna sees the log and calls back. The vault repays from the reserve." |
| 2:00–2:30 | Trang **Execution Details** của lượt mới: 3 giao dịch, 10 kiểm tra, độ trễ | "Full loop: origin → Lasna → callback. Latency measured from block timestamps." |
| 2:30–2:50 | Bấm từng link tx sang Basescan và Reactscan | "Every step is an on-chain transaction." |
| 2:50–3:00 | Quay lại Overview | "Open source, MIT. github.com/longbds0108/Omni-Buildathon" |

Nếu còn thời gian, chèn cảnh phụ $1,300 trước cảnh chính (khoảng 20 giây) để cho thấy vault từ chối trả khi không cần.

## Sau khi quay

1. Cắt video dưới 3:00.
2. Tải lên YouTube (chế độ **Unlisted** là đủ) hoặc Loom.
3. Gửi link cho Claude để dán vào mục "Demo video" trong README, rồi dán link đó vào form nộp bài trên DoraHacks.
4. Thêm tx hash của lượt chạy mới vào README nếu muốn có nhiều bằng chứng hơn.
