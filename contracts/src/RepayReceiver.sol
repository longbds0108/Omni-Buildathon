// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { LendingVault } from "./LendingVault.sol";

/// @title Callback receiver on Base Sepolia.
/// @notice Accepts `executeRepay` only from the Base Sepolia callback proxy and only when the injected first argument
///         is the ReactiveRepay contract on Lasna. Proxy, reactive sender, borrower and vault are immutable.
contract RepayReceiver is AbstractCallback {
    LendingVault public immutable vault;
    address public immutable borrower;
    address public immutable owner;

    event RepayCallback(
        address indexed reactiveSender, uint256 indexed oracleVersion, bytes32 indexed originTxHash, bool repaid
    );

    error NotOwner();

    constructor(address callbackProxy_, address reactiveRepay_, LendingVault vault_, address borrower_)
        payable
        AbstractCallback(IPayable(payable(callbackProxy_)), reactiveRepay_)
    {
        vault = vault_;
        borrower = borrower_;
        owner = msg.sender;
    }

    /// @param reactiveSender_ Injected by the callback proxy: the reactive contract that requested this callback.
    function executeRepay(address reactiveSender_, uint256 oracleVersion_, bytes32 originTxHash_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactiveSender_)
    {
        bool repaid = vault.autoRepay(borrower, oracleVersion_, originTxHash_);
        emit RepayCallback(reactiveSender_, oracleVersion_, originTxHash_, repaid);
    }

    /// @notice Pays any outstanding debt to the callback proxy from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    function withdraw(address payable to_, uint256 amount_) external {
        if (msg.sender != owner) revert NotOwner();
        _pay(to_, amount_);
    }
}
