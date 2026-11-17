import { erc20Abi, parseAbi } from "viem";

export { erc20Abi };

export const oracleAbi = parseAbi([
  "function latest() view returns (uint256 priceE6, uint256 version, uint256 updatedAt)",
  "function owner() view returns (address)",
  "function setPrice(uint256 priceE6)",
  "event PriceUpdated(uint256 indexed version, uint256 priceE6, uint256 updatedAt)",
  "error ZeroPrice()",
  "error OwnableUnauthorizedAccount(address account)",
]);

export const vaultAbi = parseAbi([
  "struct Position { uint256 collateral; uint256 debt; uint256 reserve; uint256 triggerPriceE6; uint256 maxRepayAmount; uint256 configVersion; bool open; bool enabled; }",
  "function positionOf(address borrower) view returns (Position)",
  "function liquidity() view returns (uint256)",
  "function openPosition(uint256 collateralAmount, uint256 borrowAmount)",
  "function fundReserve(uint256 amount)",
  "function withdrawReserve(uint256 amount)",
  "function configureProtection(uint256 triggerPriceE6, uint256 maxRepayAmount, bool enabled)",
  "function repay(uint256 amount)",
  "function closePosition()",
  "event ReceiverSet(address receiver)",
  "event LiquiditySeeded(address indexed from, uint256 amount, uint256 liquidity)",
  "event PositionOpened(address indexed borrower, uint256 collateral, uint256 debt, uint256 configVersion)",
  "event PositionClosed(address indexed borrower, uint256 collateralReturned, uint256 reserveReturned)",
  "event ReserveFunded(address indexed borrower, uint256 amount, uint256 reserve)",
  "event ReserveWithdrawn(address indexed borrower, uint256 amount, uint256 reserve)",
  "event ProtectionConfigured(address indexed borrower, uint256 triggerPriceE6, uint256 maxRepayAmount, bool enabled, uint256 configVersion)",
  "event Repaid(address indexed borrower, uint256 amount, uint256 debt)",
  "event AutoRepaid(address indexed borrower, bytes32 indexed originTxHash, uint256 indexed oracleVersion, uint256 priceE6, uint256 amount, uint256 debtBefore, uint256 debtAfter, uint256 reserveBefore, uint256 reserveAfter)",
  "event CallbackSkipped(address indexed borrower, bytes32 indexed originTxHash, uint256 indexed oracleVersion, uint8 reason)",
  "error ZeroAmount()",
  "error PositionAlreadyOpen()",
  "error NoOpenPosition()",
  "error InsufficientLiquidity(uint256 requested, uint256 available)",
  "error StalePrice(uint256 updatedAt)",
  "error RatioTooLow(uint256 ratioBps)",
  "error AmountExceedsReserve(uint256 amount, uint256 reserve)",
  "error AmountExceedsDebt(uint256 amount, uint256 debt)",
  "error DebtOutstanding(uint256 debt)",
  "error InvalidConfiguration()",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
]);

export const reactiveAbi = parseAbi([
  "function triggerPriceE6() view returns (uint256)",
  "function subscribed() view returns (bool)",
  "event RepayRequested(bytes32 indexed originTxHash, uint256 indexed oracleVersion, address indexed borrower, uint256 priceE6, address recipient)",
]);

/** LendingVault.SkipReason, in enum order. */
export const SKIP_REASONS = [
  "no open position",
  "protection is off",
  "price is older than 15 minutes",
  "price is above the vault trigger",
  "a newer oracle version exists",
  "already paid for this version",
  "the rule changed after this version",
  "debt is at or under the 150% target",
  "reserve is empty",
] as const;
/** Index of the vault check (in RunSteps' list of 10) that each SkipReason fails. */
export const SKIP_CHECK_INDEX = [2, 3, 4, 5, 6, 7, 8, 9, 9];
