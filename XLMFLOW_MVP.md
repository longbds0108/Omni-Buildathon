# xlmflow — MVP build prompt

## Nhiệm vụ

Bạn là coding agent. Build một MVP chạy được để tham dự **Reactive Omni Buildathon — Every Second Counts**. Viết contract, test, script triển khai, dashboard và README. Ưu tiên hoàn thành một luồng có thể kiểm chứng trên chain.

Người dùng mở một khoản vay mô phỏng với tài sản thế chấp, gửi stablecoin thử nghiệm vào quỹ dự phòng và đặt hạn mức tự trả nợ. Khi giá giảm xuống ngưỡng quy định, một reactive contract trên Lasna nhận log giá từ Base Sepolia và yêu cầu callback về Base Sepolia. Lending vault dùng quỹ dự phòng để trả một phần nợ. Dashboard cho thấy điều kiện kích hoạt, số nợ trước và sau, bằng chứng giao dịch và thời gian thực thi.

## Phạm vi và stack

- Base Sepolia (84532) cho oracle, token thử nghiệm, vault và callback receiver. Reactive Lasna (5318007) cho reactive contract Omni.
- Solidity 0.8.29 và Foundry. Dùng OpenZeppelin ERC20, SafeERC20 và Math.mulDiv khi phù hợp. Pin phiên bản dependencies. Frontend React + TypeScript + Vite + viem, kết nối ví EIP-1193 để ký giao dịch.
- Một thị trường vay, một tài sản thế chấp thử nghiệm, một stablecoin mock tên **mUSD**, một vị thế demo trên dashboard. Có thể lưu state theo borrower để test hai tài khoản và chứng minh cô lập quỹ. Vault mô phỏng khoản vay có thế chấp, lãi suất bằng 0. Hiển thị vạch thanh lý tham chiếu 120% bằng nhãn *Simulated liquidation line*. Phần triển khai gồm oracle giá thủ công và automatic repay.
- Dùng hệ thống Omni hiện hành. Đối chiếu ABI và ghi phiên bản hoặc commit của SDK trong README. Trên Omni, subscribe thông qua system contract, bảo vệ `react` bằng `onlySystem`, yêu cầu callback bằng `requestCallbackV_1_0`. Xác thực callback bằng cả địa chỉ proxy Base Sepolia và địa chỉ reactive contract được proxy chèn vào tham số đầu tiên.

| Thành phần | Giá trị theo tài liệu Omni |
|---|---|
| Lasna RPC | `https://lasna-rpc.rnk.dev/` |
| Lasna system contract | `0x8888888888888888888888888888888888888888` |
| Base Sepolia callback proxy | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` |
| Explorer | `https://sepolia.basescan.org` và `https://lasna.reactscan.net` |

Xác nhận lại địa chỉ và bytecode trên đúng chain trước khi deploy. Dùng test ETH cho callback Base Sepolia và test REACT cho reactive contract. mUSD chỉ dùng để mô phỏng khoản vay và quỹ trả nợ.

## Contract và luồng giao dịch

### 1. MockOracle và token

- Mock collateral ERC20 có 18 decimals. mUSD ERC20 có 6 decimals. Quyền mint thuộc deployer demo. Mint mUSD cho thanh khoản vault và quỹ thử nghiệm theo script.
- MockOracle chỉ cho oracle operator cập nhật giá dương. Lưu `priceE6`, `version` tăng một đơn vị theo từng cập nhật và `updatedAt` bằng timestamp. Phát `PriceUpdated(uint256 indexed version, uint256 priceE6, uint256 updatedAt)`. Cung cấp getter cho snapshot mới nhất.

### 2. LendingVault

- `openPosition(collateralAmount, borrowAmount)` chuyển collateral thực sự vào vault và chuyển mUSD từ thanh khoản của vault đến người vay. Revert nếu vị thế đang mở, thiếu thanh khoản, input bằng 0, giá hết hạn hoặc tỷ lệ ban đầu dưới 160%.
- `fundReserve(amount)`, `withdrawReserve(amount)`, `configureProtection(triggerPriceE6, maxRepayAmount, enabled)`, `repay(amount)` và `closePosition()`. Quỹ, cấu hình và tài sản thế chấp gắn với borrower. Reserve chỉ rút được bởi chính borrower. Khi đóng vị thế với nợ bằng 0, trả collateral và reserve còn lại, vô hiệu hóa quy tắc bảo vệ. Giữ version cấu hình tăng đơn điệu qua các vòng mở/đóng để callback cũ không áp dụng lên vị thế mới. Thêm `seedLiquidity(amount)` cho operator chuyển mUSD thực sự vào vault và tăng thanh khoản có thể cho vay. Tách hạch toán thanh khoản có thể cho vay khỏi tổng reserve. Khi dùng reserve để giảm nợ, giảm reserve và cộng đúng số tiền đó lại vào thanh khoản.
- Luồng demo dùng giá kích hoạt cố định `$1.350` và tỷ lệ mục tiêu `150%`. Tính `collateralValueE6 = collateralAmountE18 × priceE6 / 1e18`. Tính `ratioBps = collateralValueE6 × 10_000 / debtE6`. Với debt bằng 0, frontend hiển thị *No debt*. Khi repay, tính `targetDebt = floor(collateralValueE6 × 10_000 / 15_000)`, rồi `amount = min(debt - targetDebt, reserve, maxRepayAmount)` nếu debt lớn hơn targetDebt. Làm tròn xuống và dùng BigInt trong frontend.
- Chỉ receiver đã đăng ký mới được gọi `autoRepay(borrower, oracleVersion, originTxHash)`. Kiểm tra vị thế tồn tại, bảo vệ được bật, giá còn mới và đang ở hoặc dưới trigger. Chỉ xử lý callback khớp **oracle version mới nhất**, chưa thanh toán cho cùng cặp borrower/oracle version, và `oracleVersion` lớn hơn version hiện tại tại thời điểm cấu hình lại hoặc mở lại vị thế. Bỏ qua giao dịch hợp lệ đến muộn, bị lặp, hết reserve hoặc số trả nợ bằng 0. Với call thiếu quyền, revert. Đặt freshness mặc định 15 phút và ghi rõ trong README.
- Phát `AutoRepaid` với borrower, origin tx hash, oracle version, giá, số tiền trả, debt trước/sau, reserve trước/sau để frontend dựng chính xác từng lần thực thi. Nếu callback được xác thực nhưng bị bỏ qua, phát `CallbackSkipped` có lý do để debug. Phân biệt callback thành công về mặt giao dịch và nợ đã giảm.

### 3. ReactiveRepay (Lasna) và RepayReceiver (Base Sepolia)

- ReactiveRepay theo dõi đúng `PriceUpdated` từ oracle Base Sepolia. Validate chain ID, địa chỉ, topic sự kiện, cấu trúc log. Khi giá trên $1.350 thì không request callback. Khi giá ở hoặc dưới ngưỡng, gọi system contract yêu cầu callback về receiver. Chống request trùng cho cùng oracle version. Phát `RepayRequested` mang origin tx hash và oracle version để liên kết tx trên Lasna. MVP triển khai một reactive route gắn với một borrower, một ngưỡng và một vault. Đặt ngưỡng route khớp với ngưỡng ở vault, rồi dùng cấu hình on-chain của vault để kiểm tra lần cuối. Dashboard hiển thị cả hai ngưỡng. Với phiên bản này, chỉ chỉnh hạn mức, reserve và bật/tắt sau cài đặt, còn đổi ngưỡng của route thực hiện qua triển khai mới.
- ABI payload có dạng `executeRepay(address reactiveSender, uint256 oracleVersion, bytes32 originTxHash)`. Khi encode, tham số đầu là `address(0)`. Proxy thay placeholder bằng địa chỉ ReactiveRepay. Receiver ràng buộc immutable proxy, reactive sender, borrower và vault. Receiver gọi `autoRepay` sau khi xác thực cả `msg.sender` lẫn `reactiveSender`.
- Deploy token/oracle/vault trên Base Sepolia, deploy ReactiveRepay trên Lasna rồi deploy receiver trên Base Sepolia. Dùng setter owner-only, cài một lần cho receiver trên vault và recipient trên ReactiveRepay. Đăng ký subscription một lần sau khi wiring và nạp dự trữ gas cho cả hai đầu bằng `depositTo(address)` theo tài liệu. In toàn bộ chain ID, địa chỉ, tx hash triển khai và funding trong manifest. Tách khóa triển khai khỏi frontend, nhận khóa qua Foundry keystore hoặc biến môi trường cục bộ.

## Dashboard và demo

Một trang tiếng Anh dành cho giám khảo. Hiển thị giá, timestamp cập nhật, nợ, giá trị collateral, tỷ lệ thế chấp, reserve, trigger, hạn mức và trạng thái bảo vệ. Có thao tác kết nối ví, approve, mở vị thế demo, nạp/rút reserve, bật/tắt bảo vệ và nút đổi giá dành cho operator. Hỗ trợ đọc dashboard khi chưa kết nối ví. Khi ví sai chain, hiển thị hành động chuyển Base Sepolia. Dùng manifest deploy để tạo explorer links và fetch lịch sử từ block deploy.

Với mỗi cập nhật, hiển thị các bước **Price update → Reactive request → Callback** bằng log thật. Nối các bước qua `originTxHash` và `oracleVersion`. Các trạng thái gồm *Above trigger*, *Waiting for reaction*, *Callback requested*, *Debt repaid* và *Callback skipped*. Nếu thiếu dữ liệu, hiển thị trạng thái đang chờ hoặc chưa quan sát được. Tính độ trễ toàn luồng bằng timestamp block callback trừ timestamp block cập nhật giá trên cùng chain Base Sepolia. Ghi rõ độ phân giải của block timestamp. Có thể bổ sung thời gian quan sát trên đồng hồ local, ghi nhãn riêng. Dùng cập nhật giả lập chỉ khi bật chế độ local và gắn nhãn *Local simulation*.

### Kịch bản nghiệm thu

| Bước | Thao tác | Kết quả |
|---|---|---|
| Setup | Giá $1.800, thế chấp 1 token, vay 1.000 mUSD, nạp reserve 150 mUSD, giới hạn một lần 120 mUSD, bật bảo vệ | Tỷ lệ 180%, reserve 150 mUSD |
| Trên ngưỡng | Cập nhật giá $1.400 | Tỷ lệ 140%, nợ vẫn 1.000 mUSD, không có callback request |
| Chạm ngưỡng | Cập nhật giá $1.350 | Lasna request callback. Callback trả 100 mUSD, nợ còn 900 mUSD, reserve còn 50 mUSD, tỷ lệ lên 150% |
| Kiểm chứng | Mở các giao dịch và đối chiếu dashboard | Có origin tx hash, Lasna tx hash, callback tx hash, số đo độ trễ và các số dư khớp log |

## Test và bàn giao

- Test cả luồng với system và proxy giả lập. Proxy mock mô phỏng việc chèn reactive sender vào payload. Cần test giá trên/ngang/dưới ngưỡng, sai chain/topic/oracle, caller trái phép ở `react`, sai callback proxy hoặc injected sender, duplicate, out-of-order, stale price, bảo vệ tắt, cấu hình lại và vị thế mở lại.
- Test nợ bằng 0, giới hạn thấp hơn số cần trả, reserve cạn, truy cập reserve của borrower khác và độ chính xác decimals. Kiểm tra giảm nợ đúng bằng reserve đã dùng, giữ cân đối thanh khoản và cho phép đóng vị thế rồi rút collateral.
- Chạy `forge test` và `npm run build`. Tạo script local tái hiện kịch bản, script deploy, manifest ví dụ, `.env.example` và README tiếng Anh với cách chạy, kiến trúc và explorer links.
- Khi có ví testnet đủ gas, deploy và xác minh vòng lặp thật trên Base Sepolia → Lasna → Base Sepolia. Lưu tx hashes và độ trễ đo được vào README. Nếu testnet chưa chạy được, ghi chính xác bước đang vướng và giữ bằng chứng local dưới nhãn mô phỏng.
- Chuẩn bị hồ sơ gồm repo public mã nguồn mở, địa chỉ đã deploy, tx hashes cho toàn vòng và video dưới 3 phút. Video mở bằng bài toán của người vay rồi đi thẳng qua hai lần hạ giá và các giao dịch chứng minh callback.

## Tài liệu chính thức

- [Reactive Omni Buildathon — yêu cầu và tiêu chí](https://blog.reactive.network/reactive-omni-buildathon-thirty-days-to-find-out-what-one-second-buys/)
- [Reactive contracts](https://dev.reactive.network/reactive-contracts)
- [Callback contracts](https://dev.reactive.network/callback-contracts)
- [Origins & Destinations](https://dev.reactive.network/origins-and-destinations)
- [Funding và debugging](https://dev.reactive.network/debugging)
