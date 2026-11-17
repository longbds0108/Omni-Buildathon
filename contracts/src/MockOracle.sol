// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Manual price oracle operated by the demo deployer.
/// @notice Every update bumps `version` by one and emits `PriceUpdated`, which the reactive contract on Lasna watches.
contract MockOracle is Ownable {
    error ZeroPrice();

    /// @dev One indexed topic (version): the log arrives on Lasna as a LOG2 with priceE6 and updatedAt in `data`.
    event PriceUpdated(uint256 indexed version, uint256 priceE6, uint256 updatedAt);

    uint256 public priceE6;
    uint256 public version;
    uint256 public updatedAt;

    constructor(address operator_) Ownable(operator_) { }

    /// @param priceE6_ Price of one collateral token in USD with 6 decimals, e.g. 1_350_000_000 for $1,350.
    function setPrice(uint256 priceE6_) external onlyOwner {
        if (priceE6_ == 0) revert ZeroPrice();
        uint256 v = version + 1;
        version = v;
        priceE6 = priceE6_;
        updatedAt = block.timestamp;
        emit PriceUpdated(v, priceE6_, block.timestamp);
    }

    /// @return priceE6_ Latest price, version_ its version, updatedAt_ its block timestamp.
    function latest() external view returns (uint256 priceE6_, uint256 version_, uint256 updatedAt_) {
        return (priceE6, version, updatedAt);
    }
}
