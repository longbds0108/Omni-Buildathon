// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MockOracle } from "./MockOracle.sol";

/// @title Simulated collateralized loan with a borrower-funded repay reserve.
/// @notice Zero interest, one collateral token, one stablecoin (mUSD). There is no liquidation: the 120% line is for
///         display only. A registered receiver may call `autoRepay`, which pays debt from the borrower's reserve.
/// @dev Lendable liquidity and borrower reserves are booked separately. The vault's mUSD balance always equals
///      `liquidity + totalReserves` (outstanding debt is mUSD that left the vault).
contract LendingVault is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant OPEN_MIN_BPS = 16_000; // 160% to open
    uint256 public constant TARGET_BPS = 15_000; // a repay restores 150%
    uint256 public constant LIQUIDATION_BPS = 12_000; // Simulated liquidation line, display only
    uint256 public constant PRICE_FRESHNESS = 15 minutes;

    enum SkipReason {
        NoPosition,
        ProtectionDisabled,
        StalePrice,
        AboveTrigger,
        NotLatestVersion,
        AlreadyPaid,
        ConfiguredAfterVersion,
        NothingToRepay,
        ReserveEmpty
    }

    struct Position {
        uint256 collateral; // 18 decimals
        uint256 debt; // 6 decimals
        uint256 reserve; // 6 decimals
        uint256 triggerPriceE6;
        uint256 maxRepayAmount;
        uint256 configVersion; // oracle version at the last open or configuration
        bool open;
        bool enabled;
    }

    IERC20 public immutable collateralToken;
    IERC20 public immutable musd;
    MockOracle public immutable oracle;

    address public receiver;
    uint256 public liquidity;
    uint256 public totalReserves;

    mapping(address => Position) private _positions;
    mapping(address => mapping(uint256 => bool)) public paid;

    event ReceiverSet(address receiver);
    event LiquiditySeeded(address indexed from, uint256 amount, uint256 liquidity);
    event PositionOpened(address indexed borrower, uint256 collateral, uint256 debt, uint256 configVersion);
    event PositionClosed(address indexed borrower, uint256 collateralReturned, uint256 reserveReturned);
    event ReserveFunded(address indexed borrower, uint256 amount, uint256 reserve);
    event ReserveWithdrawn(address indexed borrower, uint256 amount, uint256 reserve);
    event ProtectionConfigured(
        address indexed borrower, uint256 triggerPriceE6, uint256 maxRepayAmount, bool enabled, uint256 configVersion
    );
    event Repaid(address indexed borrower, uint256 amount, uint256 debt);
    event AutoRepaid(
        address indexed borrower,
        bytes32 indexed originTxHash,
        uint256 indexed oracleVersion,
        uint256 priceE6,
        uint256 amount,
        uint256 debtBefore,
        uint256 debtAfter,
        uint256 reserveBefore,
        uint256 reserveAfter
    );
    event CallbackSkipped(
        address indexed borrower, bytes32 indexed originTxHash, uint256 indexed oracleVersion, SkipReason reason
    );

    error ZeroAmount();
    error ZeroAddress();
    error ReceiverAlreadySet();
    error NotReceiver(address caller);
    error PositionAlreadyOpen();
    error NoOpenPosition();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error StalePrice(uint256 updatedAt);
    error RatioTooLow(uint256 ratioBps);
    error AmountExceedsReserve(uint256 amount, uint256 reserve);
    error AmountExceedsDebt(uint256 amount, uint256 debt);
    error DebtOutstanding(uint256 debt);
    error InvalidConfiguration();

    constructor(IERC20 collateralToken_, IERC20 musd_, MockOracle oracle_, address owner_) Ownable(owner_) {
        collateralToken = collateralToken_;
        musd = musd_;
        oracle = oracle_;
    }

    /* ───────── Operator ───────── */

    /// @notice Registers the callback receiver once.
    function setReceiver(address receiver_) external onlyOwner {
        if (receiver_ == address(0)) revert ZeroAddress();
        if (receiver != address(0)) revert ReceiverAlreadySet();
        receiver = receiver_;
        emit ReceiverSet(receiver_);
    }

    /// @notice Moves real mUSD into the vault as lendable liquidity.
    function seedLiquidity(uint256 amount_) external onlyOwner {
        if (amount_ == 0) revert ZeroAmount();
        musd.safeTransferFrom(msg.sender, address(this), amount_);
        liquidity += amount_;
        emit LiquiditySeeded(msg.sender, amount_, liquidity);
    }

    /* ───────── Borrower ───────── */

    function openPosition(uint256 collateralAmount_, uint256 borrowAmount_) external {
        Position storage p = _positions[msg.sender];
        if (p.open) revert PositionAlreadyOpen();
        if (collateralAmount_ == 0 || borrowAmount_ == 0) revert ZeroAmount();
        if (borrowAmount_ > liquidity) revert InsufficientLiquidity(borrowAmount_, liquidity);
        (uint256 priceE6, uint256 version, uint256 updatedAt) = oracle.latest();
        if (version == 0 || block.timestamp > updatedAt + PRICE_FRESHNESS) revert StalePrice(updatedAt);
        uint256 ratio = Math.mulDiv(collateralValueE6(collateralAmount_, priceE6), BPS, borrowAmount_);
        if (ratio < OPEN_MIN_BPS) revert RatioTooLow(ratio);

        p.collateral = collateralAmount_;
        p.debt = borrowAmount_;
        p.open = true;
        p.configVersion = Math.max(p.configVersion, version);
        liquidity -= borrowAmount_;

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralAmount_);
        musd.safeTransfer(msg.sender, borrowAmount_);
        emit PositionOpened(msg.sender, collateralAmount_, borrowAmount_, p.configVersion);
    }

    function fundReserve(uint256 amount_) external {
        if (amount_ == 0) revert ZeroAmount();
        Position storage p = _positions[msg.sender];
        musd.safeTransferFrom(msg.sender, address(this), amount_);
        p.reserve += amount_;
        totalReserves += amount_;
        emit ReserveFunded(msg.sender, amount_, p.reserve);
    }

    /// @notice Only the borrower can take out their own reserve.
    function withdrawReserve(uint256 amount_) external {
        if (amount_ == 0) revert ZeroAmount();
        Position storage p = _positions[msg.sender];
        if (amount_ > p.reserve) revert AmountExceedsReserve(amount_, p.reserve);
        p.reserve -= amount_;
        totalReserves -= amount_;
        musd.safeTransfer(msg.sender, amount_);
        emit ReserveWithdrawn(msg.sender, amount_, p.reserve);
    }

    /// @notice Sets the repay rule. Records the current oracle version so older callbacks can't act on the new rule.
    function configureProtection(uint256 triggerPriceE6_, uint256 maxRepayAmount_, bool enabled_) external {
        Position storage p = _positions[msg.sender];
        if (!p.open) revert NoOpenPosition();
        if (triggerPriceE6_ == 0 || (enabled_ && maxRepayAmount_ == 0)) revert InvalidConfiguration();
        p.triggerPriceE6 = triggerPriceE6_;
        p.maxRepayAmount = maxRepayAmount_;
        p.enabled = enabled_;
        p.configVersion = Math.max(p.configVersion, oracle.version());
        emit ProtectionConfigured(msg.sender, triggerPriceE6_, maxRepayAmount_, enabled_, p.configVersion);
    }

    function repay(uint256 amount_) external {
        if (amount_ == 0) revert ZeroAmount();
        Position storage p = _positions[msg.sender];
        if (!p.open) revert NoOpenPosition();
        if (amount_ > p.debt) revert AmountExceedsDebt(amount_, p.debt);
        musd.safeTransferFrom(msg.sender, address(this), amount_);
        p.debt -= amount_;
        liquidity += amount_;
        emit Repaid(msg.sender, amount_, p.debt);
    }

    /// @notice With zero debt: returns collateral and leftover reserve and switches protection off.
    function closePosition() external {
        Position storage p = _positions[msg.sender];
        if (!p.open) revert NoOpenPosition();
        if (p.debt != 0) revert DebtOutstanding(p.debt);
        uint256 collateral = p.collateral;
        uint256 reserve = p.reserve;
        uint256 configVersion = Math.max(p.configVersion, oracle.version());
        delete _positions[msg.sender];
        _positions[msg.sender].configVersion = configVersion;
        totalReserves -= reserve;
        collateralToken.safeTransfer(msg.sender, collateral);
        if (reserve > 0) musd.safeTransfer(msg.sender, reserve);
        emit PositionClosed(msg.sender, collateral, reserve);
    }

    /* ───────── Callback path ───────── */

    /// @notice Pays part of `borrower_`'s debt from their reserve. Valid but inapplicable callbacks are skipped with a
    ///         reason, never reverted, so the dashboard can tell a landed callback from a repaid debt.
    /// @return repaid_ True when debt was reduced.
    function autoRepay(address borrower_, uint256 oracleVersion_, bytes32 originTxHash_) external returns (bool repaid_) {
        if (msg.sender != receiver || receiver == address(0)) revert NotReceiver(msg.sender);
        (bool skip, SkipReason reason, uint256 priceE6, uint256 targetDebt) = _check(borrower_, oracleVersion_);
        if (skip) {
            emit CallbackSkipped(borrower_, originTxHash_, oracleVersion_, reason);
            return false;
        }
        _applyRepay(borrower_, oracleVersion_, originTxHash_, priceE6, targetDebt);
        return true;
    }

    /// @dev The vault's checks, in order. The first that fails is the skip reason.
    function _check(address borrower_, uint256 oracleVersion_)
        internal
        view
        returns (bool skip_, SkipReason reason_, uint256 priceE6_, uint256 targetDebt_)
    {
        Position storage p = _positions[borrower_];
        uint256 version;
        uint256 updatedAt;
        (priceE6_, version, updatedAt) = oracle.latest();
        skip_ = true;
        if (!p.open) reason_ = SkipReason.NoPosition;
        else if (!p.enabled) reason_ = SkipReason.ProtectionDisabled;
        else if (block.timestamp > updatedAt + PRICE_FRESHNESS) reason_ = SkipReason.StalePrice;
        else if (priceE6_ > p.triggerPriceE6) reason_ = SkipReason.AboveTrigger;
        else if (oracleVersion_ != version) reason_ = SkipReason.NotLatestVersion;
        else if (paid[borrower_][oracleVersion_]) reason_ = SkipReason.AlreadyPaid;
        else if (oracleVersion_ <= p.configVersion) reason_ = SkipReason.ConfiguredAfterVersion;
        else {
            targetDebt_ = Math.mulDiv(collateralValueE6(p.collateral, priceE6_), BPS, TARGET_BPS);
            if (p.debt <= targetDebt_) reason_ = SkipReason.NothingToRepay;
            else if (p.reserve == 0) reason_ = SkipReason.ReserveEmpty;
            else skip_ = false;
        }
    }

    /// @dev amount = min(debt − targetDebt, reserve, maxRepayAmount). Reserve moves back into lendable liquidity.
    function _applyRepay(
        address borrower_,
        uint256 oracleVersion_,
        bytes32 originTxHash_,
        uint256 priceE6_,
        uint256 targetDebt_
    ) internal {
        Position storage p = _positions[borrower_];
        uint256 debtBefore = p.debt;
        uint256 reserveBefore = p.reserve;
        uint256 amount = Math.min(Math.min(debtBefore - targetDebt_, reserveBefore), p.maxRepayAmount);
        p.debt = debtBefore - amount;
        p.reserve = reserveBefore - amount;
        totalReserves -= amount;
        liquidity += amount;
        paid[borrower_][oracleVersion_] = true;
        emit AutoRepaid(
            borrower_, originTxHash_, oracleVersion_, priceE6_, amount, debtBefore, p.debt, reserveBefore, p.reserve
        );
    }

    /* ───────── Views ───────── */

    function positionOf(address borrower_) external view returns (Position memory) {
        return _positions[borrower_];
    }

    function collateralValueE6(uint256 collateralAmount_, uint256 priceE6_) public pure returns (uint256) {
        return Math.mulDiv(collateralAmount_, priceE6_, 1e18);
    }

    /// @return ratioBps_ Collateral ratio in basis points at the latest price, or type(uint256).max with no debt.
    function ratioBps(address borrower_) external view returns (uint256 ratioBps_) {
        Position storage p = _positions[borrower_];
        if (p.debt == 0) return type(uint256).max;
        return Math.mulDiv(collateralValueE6(p.collateral, oracle.priceE6()), BPS, p.debt);
    }
}
