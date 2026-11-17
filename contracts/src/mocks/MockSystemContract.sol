// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";

/// @title Stand-in for the Reactive system contract, for tests and the labeled local simulation only.
/// @dev Placed at 0x8888…8888 with vm.etch / anvil_setCode. Records subscriptions and callback requests, and lets a
///      relayer deliver logs to a reactive contract as the system would.
contract MockSystemContract {
    struct Subscription {
        address subscriber;
        uint256 chainId;
        address contractAddress;
        uint256 topic0;
    }

    Subscription[] public subscriptions;
    ISystemContract.CallbackConfiguration_V_1_0[] internal _callbacks;

    event Subscribed(address indexed subscriber, uint256 chainId, address contractAddress, uint256 topic0);
    event CallbackRequested(
        address indexed sender, uint256 indexed chainId, address indexed recipient, uint64 gasLimit, bytes payload
    );

    receive() external payable { }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function depositTo(address) external payable { }

    function subscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256, uint256, uint256) external {
        subscriptions.push(Subscription(msg.sender, chainId_, contract_, topic0_));
        emit Subscribed(msg.sender, chainId_, contract_, topic0_);
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external { }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        _callbacks.push(config_);
        emit CallbackRequested(msg.sender, config_.chainId, config_.recipient, config_.gasLimit, config_.payload);
    }

    /// @notice Delivers a log to a reactive contract, with this contract as msg.sender.
    function deliver(IReactive target_, IReactive.LogRecord calldata log_) external {
        target_.react(log_);
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(uint256 i_) external view returns (ISystemContract.CallbackConfiguration_V_1_0 memory) {
        return _callbacks[i_];
    }

    function subscriptionCount() external view returns (uint256) {
        return subscriptions.length;
    }
}
