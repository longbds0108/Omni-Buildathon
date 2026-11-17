// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @title Stand-in for the Base Sepolia callback proxy, for tests and the labeled local simulation only.
/// @dev Like the real proxy, it overwrites the first 160 bits of the payload's first argument with the address of the
///      reactive contract that requested the callback, then calls the recipient.
contract MockCallbackProxy {
    event CallbackDelivered(address indexed recipient, address indexed reactiveSender, bool success);

    receive() external payable { }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function depositTo(address) external payable { }

    function deliver(address recipient_, bytes memory payload_, address reactiveSender_)
        external
        returns (bool success_, bytes memory result_)
    {
        require(payload_.length >= 36, "payload too short");
        assembly {
            // skip the 32-byte length word and the 4-byte selector
            mstore(add(payload_, 36), reactiveSender_)
        }
        (success_, result_) = recipient_.call(payload_);
        emit CallbackDelivered(recipient_, reactiveSender_, success_);
    }
}
