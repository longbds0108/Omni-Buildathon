// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { DeployStep } from "./Base.s.sol";
import { ReactiveRepay } from "../src/ReactiveRepay.sol";

/// @notice Step 4, Reactive Lasna: set the recipient once, fund reactive gas with depositTo(address) on the system
///         contract, then register the single subscription.
contract WireReactive is DeployStep {
    function run() external {
        _requireChain(vm.envOr("LASNA_CHAIN_ID", LASNA));
        ReactiveRepay reactive = ReactiveRepay(payable(vm.parseJsonAddress(_read("lasna"), ".reactiveRepay")));
        address receiver = vm.parseJsonAddress(_read("receiver"), ".receiver");
        uint256 funding = vm.envOr("REACTIVE_FUNDING_WEI", uint256(1 ether));

        vm.startBroadcast();
        reactive.setRecipient(receiver);
        (bool ok,) =
            SYSTEM_CONTRACT.call{ value: funding }(abi.encodeWithSignature("depositTo(address)", address(reactive)));
        require(ok, "depositTo on the system contract failed");
        reactive.subscribe();
        vm.stopBroadcast();

        string memory k = "wire";
        vm.serializeAddress(k, "recipient", receiver);
        string memory out = vm.serializeUint(k, "funding", funding);
        vm.writeJson(out, _path("wire"));
    }
}
