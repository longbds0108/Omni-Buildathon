// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Script } from "forge-std/Script.sol";

/// @notice Shared helpers: every step writes its addresses to deployments/<DEPLOY_TAG>/<step>.json.
abstract contract DeployStep is Script {
    address internal constant SYSTEM_CONTRACT = 0x8888888888888888888888888888888888888888;
    address internal constant BASE_SEPOLIA_CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    uint256 internal constant BASE_SEPOLIA = 84532;
    uint256 internal constant LASNA = 5318007;

    function _tag() internal view returns (string memory) {
        return vm.envOr("DEPLOY_TAG", string("testnet"));
    }

    function _path(string memory step_) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", _tag(), "/", step_, ".json");
    }

    function _read(string memory step_) internal view returns (string memory) {
        return vm.readFile(_path(step_));
    }

    function _requireChain(uint256 expected_) internal view {
        require(block.chainid == expected_, string.concat("wrong chain, expected ", vm.toString(expected_)));
    }

    /// The Reactive contracts we rely on must exist on the chain we deploy to.
    function _requireCode(address target_, string memory what_) internal view {
        require(target_.code.length > 0, string.concat(what_, " has no bytecode on this chain"));
    }
}
