// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test, Vm } from "forge-std/Test.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { TestToken } from "../src/TestToken.sol";
import { MockOracle } from "../src/MockOracle.sol";
import { LendingVault } from "../src/LendingVault.sol";
import { ReactiveRepay } from "../src/ReactiveRepay.sol";
import { RepayReceiver } from "../src/RepayReceiver.sol";
import { MockSystemContract } from "../src/mocks/MockSystemContract.sol";
import { MockCallbackProxy } from "../src/mocks/MockCallbackProxy.sol";

/// @notice The whole loop on one EVM: oracle → (mock system) → ReactiveRepay → (mock proxy) → receiver → vault.
contract XlmflowTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    uint256 constant BASE_SEPOLIA = 84532;
    uint256 constant E6 = 1e6;
    uint256 constant TRIGGER = 1_350 * E6;

    TestToken col;
    TestToken musd;
    MockOracle oracle;
    LendingVault vault;
    ReactiveRepay reactive;
    RepayReceiver receiver;
    MockSystemContract sys;
    MockCallbackProxy proxy;

    address borrower = makeAddr("borrower");
    address other = makeAddr("other");
    uint256 delivered; // callbacks already handed to the proxy

    function setUp() public {
        vm.warp(1_760_000_000);
        col = new TestToken("Mock Collateral", "mCOL", 18, address(this));
        musd = new TestToken("Mock USD", "mUSD", 6, address(this));
        oracle = new MockOracle(address(this));
        vault = new LendingVault(col, musd, oracle, address(this));

        vm.etch(SYSTEM, type(MockSystemContract).runtimeCode);
        sys = MockSystemContract(payable(SYSTEM));
        proxy = new MockCallbackProxy();

        reactive = new ReactiveRepay(BASE_SEPOLIA, address(oracle), BASE_SEPOLIA, borrower, TRIGGER, 600_000);
        receiver = new RepayReceiver(address(proxy), address(reactive), vault, borrower);
        vault.setReceiver(address(receiver));
        reactive.setRecipient(address(receiver));
        reactive.subscribe();

        musd.mint(address(this), 10_000 * E6);
        musd.approve(address(vault), type(uint256).max);
        vault.seedLiquidity(10_000 * E6);
        col.mint(borrower, 5e18);
        musd.mint(borrower, 1_000 * E6);
        col.mint(other, 5e18);
        musd.mint(other, 1_000 * E6);
        vm.startPrank(borrower);
        col.approve(address(vault), type(uint256).max);
        musd.approve(address(vault), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(other);
        col.approve(address(vault), type(uint256).max);
        musd.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    /* ───────── helpers ───────── */

    /// Posts a price and returns the oracle log exactly as the system contract would hand it to react().
    function _price(uint256 priceE6) internal returns (IReactive.LogRecord memory log) {
        vm.recordLogs();
        oracle.setPrice(priceE6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory l = logs[0];
        log = IReactive.LogRecord({
            chainId: BASE_SEPOLIA,
            contractAddress: l.emitter,
            topic0: uint256(l.topics[0]),
            topic1: uint256(l.topics[1]),
            topic2: 0,
            topic3: 0,
            data: l.data,
            blockNumber: block.number,
            opCode: l.topics.length,
            blockHash: uint256(blockhash(block.number)),
            txHash: uint256(keccak256(abi.encode("tx", oracle.version()))),
            logIndex: 0
        });
    }

    function _react(IReactive.LogRecord memory log) internal {
        sys.deliver(reactive, log);
    }

    /// Hands the next requested callback to the proxy, which injects ReactiveRepay's address.
    function _deliverNext() internal returns (bool ok) {
        ISystemContract.CallbackConfiguration_V_1_0 memory c = sys.callbackAt(delivered++);
        assertEq(c.chainId, BASE_SEPOLIA);
        assertEq(c.recipient, address(receiver));
        assertGe(c.gasLimit, 100_000);
        (ok,) = proxy.deliver(c.recipient, c.payload, address(reactive));
    }

    function _priceAndRun(uint256 priceE6) internal {
        _react(_price(priceE6));
    }

    /// Setup of the acceptance scenario: $1,800, 1 mCOL, 1,000 mUSD, 150 reserve, 120 limit, protection on.
    function _setup() internal {
        _priceAndRun(1_800 * E6);
        vm.startPrank(borrower);
        vault.openPosition(1e18, 1_000 * E6);
        vault.fundReserve(150 * E6);
        vault.configureProtection(TRIGGER, 120 * E6, true);
        vm.stopPrank();
    }

    function _pos() internal view returns (LendingVault.Position memory) {
        return vault.positionOf(borrower);
    }

    function _assertBooks() internal view {
        assertEq(musd.balanceOf(address(vault)), vault.liquidity() + vault.totalReserves(), "vault books");
    }

    /* ───────── acceptance scenario ───────── */

    function test_AcceptanceScenario() public {
        _setup();
        assertEq(vault.ratioBps(borrower), 18_000);
        assertEq(_pos().reserve, 150 * E6);
        assertEq(sys.subscriptionCount(), 1);

        _priceAndRun(1_400 * E6);
        assertEq(vault.ratioBps(borrower), 14_000);
        assertEq(_pos().debt, 1_000 * E6);
        assertEq(sys.callbackCount(), 0, "no request above the trigger");

        IReactive.LogRecord memory log = _price(1_350 * E6);
        vm.expectEmit(true, true, true, true, address(reactive));
        emit ReactiveRepay.RepayRequested(bytes32(log.txHash), 3, borrower, 1_350 * E6, address(receiver));
        _react(log);
        assertEq(sys.callbackCount(), 1);

        vm.expectEmit(true, true, true, true, address(vault));
        emit LendingVault.AutoRepaid(
            borrower, bytes32(log.txHash), 3, 1_350 * E6, 100 * E6, 1_000 * E6, 900 * E6, 150 * E6, 50 * E6
        );
        assertTrue(_deliverNext());
        assertEq(_pos().debt, 900 * E6);
        assertEq(_pos().reserve, 50 * E6);
        assertEq(vault.ratioBps(borrower), 15_000);
        assertTrue(vault.paid(borrower, 3));
        _assertBooks();
    }

    /* ───────── trigger and route validation ───────── */

    function test_TriggerBoundary() public {
        _setup();
        _priceAndRun(TRIGGER + 1);
        assertEq(sys.callbackCount(), 0, "one micro-dollar above: no request");
        _priceAndRun(TRIGGER);
        assertEq(sys.callbackCount(), 1, "at the trigger: request");
        _priceAndRun(TRIGGER - 1);
        assertEq(sys.callbackCount(), 2, "below the trigger: request");
    }

    function test_ReactIgnoresForeignLogs() public {
        _setup();
        IReactive.LogRecord memory log = _price(1_300 * E6);

        IReactive.LogRecord memory wrongChain = log;
        wrongChain.chainId = 11155111;
        _react(wrongChain);
        IReactive.LogRecord memory wrongOracle = _clone(log);
        wrongOracle.contractAddress = other;
        _react(wrongOracle);
        IReactive.LogRecord memory wrongTopic = _clone(log);
        wrongTopic.topic0 = uint256(keccak256("Transfer(address,address,uint256)"));
        _react(wrongTopic);
        IReactive.LogRecord memory wrongShape = _clone(log);
        wrongShape.opCode = 3;
        _react(wrongShape);
        IReactive.LogRecord memory shortData = _clone(log);
        shortData.data = abi.encode(uint256(1_300 * E6));
        _react(shortData);
        assertEq(sys.callbackCount(), 0);

        log.chainId = BASE_SEPOLIA;
        _react(_clone(log));
        assertEq(sys.callbackCount(), 1, "the genuine log still works");
    }

    function _clone(IReactive.LogRecord memory l) internal pure returns (IReactive.LogRecord memory c) {
        c = IReactive.LogRecord(
            BASE_SEPOLIA, l.contractAddress, l.topic0, l.topic1, l.topic2, l.topic3, l.data, l.blockNumber, l.opCode,
            l.blockHash, l.txHash, l.logIndex
        );
    }

    function test_ReactOnlySystem() public {
        IReactive.LogRecord memory log = _price(1_300 * E6);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, other, SYSTEM));
        reactive.react(log);
    }

    function test_DuplicateRequestIgnored() public {
        _setup();
        IReactive.LogRecord memory log = _price(1_300 * E6);
        _react(log);
        _react(log);
        assertEq(sys.callbackCount(), 1);
    }

    function test_WiringIsOneShot() public {
        vm.expectRevert(ReactiveRepay.RecipientAlreadySet.selector);
        reactive.setRecipient(other);
        vm.expectRevert(ReactiveRepay.AlreadySubscribed.selector);
        reactive.subscribe();
        vm.expectRevert(LendingVault.ReceiverAlreadySet.selector);
        vault.setReceiver(other);
        vm.prank(other);
        vm.expectRevert(ReactiveRepay.NotOwner.selector);
        reactive.withdraw(payable(other), 0);
    }

    /* ───────── callback authentication ───────── */

    function test_ReceiverRejectsWrongProxy() public {
        _setup();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, other, address(proxy)));
        receiver.executeRepay(address(reactive), 1, bytes32(0));
    }

    function test_ReceiverRejectsWrongInjectedSender() public {
        _setup();
        _priceAndRun(1_300 * E6);
        ISystemContract.CallbackConfiguration_V_1_0 memory c = sys.callbackAt(0);
        (bool ok, bytes memory ret) = proxy.deliver(c.recipient, c.payload, other);
        assertFalse(ok);
        assertEq(ret, abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, other, address(reactive)));
        assertEq(_pos().debt, 1_000 * E6);
    }

    function test_VaultOnlyReceiver() public {
        _setup();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(LendingVault.NotReceiver.selector, other));
        vault.autoRepay(borrower, 1, bytes32(0));
    }

    /* ───────── vault guards ───────── */

    function _expectSkip(uint256 version, LendingVault.SkipReason reason) internal {
        vm.expectEmit(true, false, true, true, address(vault));
        emit LendingVault.CallbackSkipped(borrower, bytes32(0), version, reason);
    }

    function test_DuplicateCallbackSkipped() public {
        _setup();
        _priceAndRun(1_300 * E6); // v2
        ISystemContract.CallbackConfiguration_V_1_0 memory c = sys.callbackAt(0);
        proxy.deliver(c.recipient, c.payload, address(reactive));
        uint256 debt = _pos().debt;
        _expectSkip(2, LendingVault.SkipReason.AlreadyPaid);
        proxy.deliver(c.recipient, c.payload, address(reactive));
        assertEq(_pos().debt, debt);
    }

    function test_OutOfOrderCallbackSkipped() public {
        _setup();
        _priceAndRun(1_300 * E6); // v2
        _priceAndRun(1_250 * E6); // v3
        _expectSkip(2, LendingVault.SkipReason.NotLatestVersion);
        _deliverNext();
        assertEq(_pos().debt, 1_000 * E6, "late callback leaves debt alone");
        _deliverNext();
        assertLt(_pos().debt, 1_000 * E6, "latest callback repays");
    }

    function test_StalePriceSkipped() public {
        _setup();
        _priceAndRun(1_300 * E6);
        vm.warp(block.timestamp + 15 minutes + 1);
        _expectSkip(2, LendingVault.SkipReason.StalePrice);
        _deliverNext();
        assertEq(_pos().debt, 1_000 * E6);
    }

    function test_ProtectionDisabledSkipped() public {
        _setup();
        vm.prank(borrower);
        vault.configureProtection(TRIGGER, 120 * E6, false);
        _priceAndRun(1_300 * E6);
        _expectSkip(2, LendingVault.SkipReason.ProtectionDisabled);
        _deliverNext();
    }

    function test_VaultTriggerHasFinalSay() public {
        _setup();
        vm.prank(borrower);
        vault.configureProtection(1_200 * E6, 120 * E6, true); // vault trigger lower than the route's
        _priceAndRun(1_300 * E6);
        _expectSkip(2, LendingVault.SkipReason.AboveTrigger);
        _deliverNext();
    }

    function test_ReconfigureInvalidatesPendingCallback() public {
        _setup();
        _priceAndRun(1_300 * E6); // v2 requested
        vm.prank(borrower);
        vault.configureProtection(TRIGGER, 100 * E6, true); // configVersion = 2
        _expectSkip(2, LendingVault.SkipReason.ConfiguredAfterVersion);
        _deliverNext();
        assertEq(_pos().debt, 1_000 * E6);
    }

    function test_ReopenedPositionIgnoresOldCallback() public {
        _setup();
        _priceAndRun(1_300 * E6); // v2 requested, not delivered yet
        vm.startPrank(borrower);
        vault.repay(1_000 * E6);
        vault.closePosition();
        musd.approve(address(vault), type(uint256).max);
        vault.openPosition(1e18, 500 * E6); // reopened at v2
        vault.fundReserve(100 * E6);
        vault.configureProtection(TRIGGER, 120 * E6, true);
        vm.stopPrank();
        _expectSkip(2, LendingVault.SkipReason.ConfiguredAfterVersion);
        _deliverNext();
        assertEq(_pos().debt, 500 * E6);
    }

    function test_NoPositionSkipped() public {
        _setup();
        _priceAndRun(1_300 * E6);
        vm.startPrank(borrower);
        vault.repay(1_000 * E6);
        vault.closePosition();
        vm.stopPrank();
        _expectSkip(2, LendingVault.SkipReason.NoPosition);
        _deliverNext();
    }

    function test_ZeroDebtNothingToRepay() public {
        _setup();
        vm.prank(borrower);
        vault.repay(1_000 * E6);
        assertEq(vault.ratioBps(borrower), type(uint256).max, "No debt");
        _priceAndRun(1_300 * E6);
        _expectSkip(2, LendingVault.SkipReason.NothingToRepay);
        _deliverNext();
    }

    function test_LimitCapsRepay() public {
        _setup();
        vm.prank(borrower);
        vault.configureProtection(TRIGGER, 40 * E6, true);
        _priceAndRun(1_350 * E6);
        _deliverNext();
        assertEq(_pos().debt, 960 * E6, "gap is 100, limit 40");
        assertEq(_pos().reserve, 110 * E6);
    }

    function test_ReserveCapsRepayThenRunsDry() public {
        _setup();
        _priceAndRun(1_200 * E6); // target 800, gap 200, limit 120, reserve 150 -> 120
        _deliverNext();
        assertEq(_pos().debt, 880 * E6);
        assertEq(_pos().reserve, 30 * E6);
        _priceAndRun(1_100 * E6); // gap 880 - 733.333333 -> capped by the 30 left
        _deliverNext();
        assertEq(_pos().debt, 850 * E6);
        assertEq(_pos().reserve, 0);
        _priceAndRun(1_000 * E6);
        _expectSkip(4, LendingVault.SkipReason.ReserveEmpty);
        _deliverNext();
        _assertBooks();
    }

    /* ───────── reserve, decimals, books ───────── */

    function test_ReserveIsolation() public {
        _setup();
        vm.startPrank(other);
        vault.fundReserve(10 * E6);
        vm.expectRevert(abi.encodeWithSelector(LendingVault.AmountExceedsReserve.selector, 20 * E6, 10 * E6));
        vault.withdrawReserve(20 * E6);
        vault.withdrawReserve(10 * E6);
        vm.stopPrank();
        assertEq(_pos().reserve, 150 * E6, "borrower's reserve untouched");
    }

    function test_DecimalsRoundDown() public {
        _priceAndRun(1_433_333_333); // $1,433.333333, above the route trigger so nothing is requested yet
        vm.startPrank(borrower);
        vault.openPosition(1.5e18, 1_000 * E6); // value 2,149.9999995 -> 2,149.999999 (floor)
        vault.fundReserve(500 * E6);
        vault.configureProtection(1_400 * E6, 500 * E6, true);
        vm.stopPrank();
        assertEq(sys.callbackCount(), 0);
        assertEq(vault.collateralValueE6(1.5e18, 1_433_333_333), 2_149_999_999);
        assertEq(vault.ratioBps(borrower), 21_499);
        _priceAndRun(950_000_001); // value 1,425.0000015 -> 1,425.000001; target floor(1425000001*10000/15000)=950000000
        _deliverNext();
        assertEq(_pos().debt, 950_000_000);
        assertEq(_pos().reserve, 450 * E6);
        _assertBooks();
    }

    function test_DebtDropsByExactlyReserveUsed() public {
        _setup();
        uint256 liquidityBefore = vault.liquidity();
        _priceAndRun(1_250 * E6);
        _deliverNext();
        uint256 used = 150 * E6 - _pos().reserve;
        assertEq(1_000 * E6 - _pos().debt, used);
        assertEq(vault.liquidity() - liquidityBefore, used);
        _assertBooks();
    }

    function test_CloseReturnsCollateralAndReserve() public {
        _setup();
        uint256 colBefore = col.balanceOf(borrower);
        uint256 musdBefore = musd.balanceOf(borrower);
        vm.startPrank(borrower);
        vm.expectRevert(abi.encodeWithSelector(LendingVault.DebtOutstanding.selector, 1_000 * E6));
        vault.closePosition();
        vault.repay(1_000 * E6);
        vault.closePosition();
        vm.stopPrank();
        assertEq(col.balanceOf(borrower), colBefore + 1e18);
        assertEq(musd.balanceOf(borrower), musdBefore - 1_000 * E6 + 150 * E6);
        assertFalse(_pos().open);
        assertFalse(_pos().enabled);
        _assertBooks();
    }

    function test_OpenRequirements() public {
        vm.startPrank(borrower);
        vm.expectRevert(abi.encodeWithSelector(LendingVault.StalePrice.selector, 0));
        vault.openPosition(1e18, 100 * E6);
        vm.stopPrank();

        _priceAndRun(1_800 * E6);
        vm.startPrank(borrower);
        vm.expectRevert(LendingVault.ZeroAmount.selector);
        vault.openPosition(0, 100 * E6);
        vm.expectRevert(abi.encodeWithSelector(LendingVault.RatioTooLow.selector, 15_929));
        vault.openPosition(1e18, 1_130 * E6);
        vm.expectRevert(abi.encodeWithSelector(LendingVault.InsufficientLiquidity.selector, 20_000 * E6, 10_000 * E6));
        vault.openPosition(5e18, 20_000 * E6);
        vault.openPosition(1e18, 1_125 * E6); // exactly 160%
        vm.expectRevert(LendingVault.PositionAlreadyOpen.selector);
        vault.openPosition(1e18, 1 * E6);
        vm.stopPrank();

        vm.warp(block.timestamp + 16 minutes);
        vm.prank(other);
        vm.expectRevert();
        vault.openPosition(1e18, 100 * E6);
    }

    function test_OracleGuards() public {
        vm.expectRevert(MockOracle.ZeroPrice.selector);
        oracle.setPrice(0);
        vm.prank(other);
        vm.expectRevert();
        oracle.setPrice(1);
        oracle.setPrice(1);
        oracle.setPrice(2);
        (uint256 p, uint256 v, uint256 t) = oracle.latest();
        assertEq(p, 2);
        assertEq(v, 2);
        assertEq(t, block.timestamp);
    }

    /// Any price at or under the trigger: the repay never exceeds the gap, the reserve or the limit, and lands at or
    /// above 150% whenever neither cap binds.
    function testFuzz_RepayBounds(uint256 priceE6) public {
        _setup();
        priceE6 = bound(priceE6, 500 * E6, TRIGGER);
        _priceAndRun(priceE6);
        _deliverNext();
        LendingVault.Position memory p = _pos();
        uint256 used = 1_000 * E6 - p.debt;
        uint256 target = vault.collateralValueE6(1e18, priceE6) * 10_000 / 15_000;
        assertLe(used, 120 * E6);
        assertEq(p.reserve, 150 * E6 - used);
        if (1_000 * E6 > target) assertLe(used, 1_000 * E6 - target);
        if (used < 120 * E6) assertEq(p.debt, target);
        _assertBooks();
    }
}
