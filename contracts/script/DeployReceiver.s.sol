// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { DeployStep } from "./Base.s.sol";
import { LendingVault } from "../src/LendingVault.sol";
import { RepayReceiver } from "../src/RepayReceiver.sol";

/// @notice Step 3, Base Sepolia: the receiver bound to the proxy, ReactiveRepay, the borrower and the vault; registered
///         once on the vault; callback gas funded at the proxy with depositTo(address).
contract DeployReceiver is DeployStep {
    function run() external {
        _requireChain(vm.envOr("BASE_CHAIN_ID", BASE_SEPOLIA));
        address proxy = vm.envOr("CALLBACK_PROXY", BASE_SEPOLIA_CALLBACK_PROXY);
        _requireCode(proxy, "callback proxy");
        string memory base = _read("base");
        string memory lasna = _read("lasna");
        LendingVault vault = LendingVault(vm.parseJsonAddress(base, ".vault"));
        address borrower = vm.parseJsonAddress(base, ".borrower");
        address reactive = vm.parseJsonAddress(lasna, ".reactiveRepay");
        uint256 funding = vm.envOr("RECEIVER_FUNDING_WEI", uint256(0.01 ether));

        vm.startBroadcast();
        RepayReceiver receiver = new RepayReceiver(proxy, reactive, vault, borrower);
        vault.setReceiver(address(receiver));
        (bool ok,) = proxy.call{ value: funding }(abi.encodeWithSignature("depositTo(address)", address(receiver)));
        require(ok, "depositTo on the callback proxy failed");
        vm.stopBroadcast();

        string memory k = "receiver";
        vm.serializeAddress(k, "callbackProxy", proxy);
        vm.serializeUint(k, "funding", funding);
        string memory out = vm.serializeAddress(k, "receiver", address(receiver));
        vm.writeJson(out, _path("receiver"));
    }
}
