// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { DeployStep } from "./Base.s.sol";
import { ReactiveRepay } from "../src/ReactiveRepay.sol";

/// @notice Step 2, Reactive Lasna: the route for one borrower, one $1,350 trigger and one oracle.
contract DeployReactive is DeployStep {
    function run() external {
        _requireChain(vm.envOr("LASNA_CHAIN_ID", LASNA));
        _requireCode(SYSTEM_CONTRACT, "system contract");
        string memory base = _read("base");
        address oracle = vm.parseJsonAddress(base, ".oracle");
        address borrower = vm.parseJsonAddress(base, ".borrower");
        uint256 originChainId = vm.parseJsonUint(base, ".chainId");
        uint256 trigger = vm.envOr("TRIGGER_PRICE_E6", uint256(1_350e6));
        uint64 gasLimit = uint64(vm.envOr("CALLBACK_GAS_LIMIT", uint256(600_000)));
        uint256 deployBlock = block.number;

        vm.startBroadcast();
        ReactiveRepay reactive = new ReactiveRepay(originChainId, oracle, originChainId, borrower, trigger, gasLimit);
        vm.stopBroadcast();

        string memory k = "lasna";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", deployBlock);
        vm.serializeUint(k, "triggerPriceE6", trigger);
        vm.serializeUint(k, "callbackGasLimit", gasLimit);
        string memory out = vm.serializeAddress(k, "reactiveRepay", address(reactive));
        vm.writeJson(out, _path("lasna"));
    }
}
