// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { DeployStep } from "./Base.s.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { LendingVault } from "../src/LendingVault.sol";

/// @notice Acceptance setup, sent by the demo borrower: 1 mCOL against 1,000 mUSD, 150 mUSD reserve, 120 mUSD limit,
///         protection on at $1,350. The oracle must be fresh (under 15 minutes old).
contract DemoPosition is DeployStep {
    function run() external {
        string memory base = _read("base");
        LendingVault vault = LendingVault(vm.parseJsonAddress(base, ".vault"));
        IERC20 col = IERC20(vm.parseJsonAddress(base, ".collateral"));
        IERC20 musd = IERC20(vm.parseJsonAddress(base, ".musd"));

        vm.startBroadcast();
        col.approve(address(vault), type(uint256).max);
        musd.approve(address(vault), type(uint256).max);
        vault.openPosition(1e18, 1_000e6);
        vault.fundReserve(150e6);
        vault.configureProtection(1_350e6, 120e6, true);
        vm.stopBroadcast();
    }
}
