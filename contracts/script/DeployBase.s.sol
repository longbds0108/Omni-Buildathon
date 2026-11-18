// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { DeployStep } from "./Base.s.sol";
import { TestToken } from "../src/TestToken.sol";
import { MockOracle } from "../src/MockOracle.sol";
import { LendingVault } from "../src/LendingVault.sol";

/// @notice Step 1, Base Sepolia: test tokens, oracle at $1,800, vault with 10,000 mUSD liquidity, demo borrower funded.
contract DeployBase is DeployStep {
    function run() external {
        _requireChain(vm.envOr("BASE_CHAIN_ID", BASE_SEPOLIA));
        address deployer = msg.sender;
        address borrower = vm.envOr("DEMO_BORROWER", deployer);
        uint256 deployBlock = block.number;

        vm.startBroadcast();
        TestToken col = new TestToken("xlmflow Mock Collateral", "mCOL", 18, deployer);
        TestToken musd = new TestToken("xlmflow Mock USD", "mUSD", 6, deployer);
        MockOracle oracle = new MockOracle(deployer);
        LendingVault vault = new LendingVault(col, musd, oracle, deployer);

        musd.mint(deployer, 10_000e6);
        musd.approve(address(vault), 10_000e6);
        vault.seedLiquidity(10_000e6);
        col.mint(borrower, 5e18);
        musd.mint(borrower, 1_000e6);
        oracle.setPrice(1_800e6);
        vm.stopBroadcast();

        string memory k = "base";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", deployBlock);
        vm.serializeAddress(k, "operator", deployer);
        vm.serializeAddress(k, "borrower", borrower);
        vm.serializeAddress(k, "collateral", address(col));
        vm.serializeAddress(k, "musd", address(musd));
        vm.serializeAddress(k, "oracle", address(oracle));
        string memory out = vm.serializeAddress(k, "vault", address(vault));
        vm.writeJson(out, _path("base"));
    }
}
