// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";

/// @title Reactive contract on Reactive Lasna: one route, one borrower, one trigger, one vault.
/// @notice Watches `PriceUpdated` from the MockOracle on Base Sepolia. At or under the trigger it asks the system
///         contract for a callback to the RepayReceiver, at most once per oracle version.
/// @dev Changing the trigger means deploying a new route. The vault's own configuration has the final word.
contract ReactiveRepay is AbstractReactive {
    uint256 public constant PRICE_UPDATED_TOPIC = uint256(keccak256("PriceUpdated(uint256,uint256,uint256)"));

    address public immutable owner;
    uint256 public immutable originChainId;
    address public immutable oracle;
    uint256 public immutable destinationChainId;
    address public immutable borrower;
    uint256 public immutable triggerPriceE6;
    uint64 public immutable callbackGasLimit;

    address public recipient;
    bool public subscribed;
    mapping(uint256 => bool) public requested;

    event RecipientSet(address recipient);
    event Subscribed(uint256 originChainId, address oracle, uint256 topic0);
    event RepayRequested(
        bytes32 indexed originTxHash, uint256 indexed oracleVersion, address indexed borrower, uint256 priceE6, address recipient
    );

    error NotOwner();
    error ZeroAddress();
    error RecipientAlreadySet();
    error RecipientNotSet();
    error AlreadySubscribed();
    error GasLimitTooLow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        uint256 originChainId_,
        address oracle_,
        uint256 destinationChainId_,
        address borrower_,
        uint256 triggerPriceE6_,
        uint64 callbackGasLimit_
    ) payable {
        if (oracle_ == address(0) || borrower_ == address(0)) revert ZeroAddress();
        if (callbackGasLimit_ < 100_000) revert GasLimitTooLow(); // the network ignores callbacks under 100,000 gas
        owner = msg.sender;
        originChainId = originChainId_;
        oracle = oracle_;
        destinationChainId = destinationChainId_;
        borrower = borrower_;
        triggerPriceE6 = triggerPriceE6_;
        callbackGasLimit = callbackGasLimit_;
    }

    /// @notice Wires the RepayReceiver on Base Sepolia, once.
    function setRecipient(address recipient_) external onlyOwner {
        if (recipient_ == address(0)) revert ZeroAddress();
        if (recipient != address(0)) revert RecipientAlreadySet();
        recipient = recipient_;
        emit RecipientSet(recipient_);
    }

    /// @notice Registers the single subscription, once, after wiring and funding.
    function subscribe() external onlyOwner {
        if (recipient == address(0)) revert RecipientNotSet();
        if (subscribed) revert AlreadySubscribed();
        subscribed = true;
        SYSTEM.subscribe(originChainId, oracle, PRICE_UPDATED_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        emit Subscribed(originChainId, oracle, PRICE_UPDATED_TOPIC);
    }

    /// @notice Called by the system contract for every PriceUpdated log from the oracle.
    /// @dev Logs that don't match are ignored rather than reverted: a reverted react() is still charged.
    function react(LogRecord calldata log_) external onlySystem {
        if (
            log_.chainId != originChainId || log_.contractAddress != oracle || log_.topic0 != PRICE_UPDATED_TOPIC
                || log_.opCode != 2 || log_.data.length != 64
        ) return;
        address to = recipient;
        if (to == address(0)) return;

        uint256 version = log_.topic1;
        (uint256 priceE6,) = abi.decode(log_.data, (uint256, uint256));
        if (priceE6 == 0 || priceE6 > triggerPriceE6) return; // above the trigger: no callback
        if (requested[version]) return; // one request per oracle version
        requested[version] = true;

        bytes32 originTxHash = bytes32(log_.txHash);
        // The first argument is a placeholder: the callback proxy overwrites it with this contract's address.
        bytes memory payload =
            abi.encodeWithSignature("executeRepay(address,uint256,bytes32)", address(0), version, originTxHash);
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: destinationChainId, recipient: to, gasLimit: callbackGasLimit, payload: payload
            })
        );
        emit RepayRequested(originTxHash, version, borrower, priceE6, to);
    }

    /// @notice Pays any outstanding debt to the system contract from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    function withdraw(address payable to_, uint256 amount_) external onlyOwner {
        _pay(to_, amount_);
    }
}
