// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { DeployStep } from "./Base.s.sol";
import { MockOracle } from "../src/MockOracle.sol";

/// @notice Operator only: PRICE_E6=1350000000 forge script script/PushPrice.s.sol --broadcast ...
contract PushPrice is DeployStep {
    function run() external {
        MockOracle oracle = MockOracle(vm.parseJsonAddress(_read("base"), ".oracle"));
        uint256 price = vm.envUint("PRICE_E6");
        vm.startBroadcast();
        oracle.setPrice(price);
        vm.stopBroadcast();
    }
}
