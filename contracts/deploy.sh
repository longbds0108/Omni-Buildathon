#!/usr/bin/env bash
# Deploys the full loop on testnet: Base Sepolia (84532) → Reactive Lasna (5318007) → Base Sepolia.
#
#   ACCOUNT=deployer ./deploy.sh            # Foundry keystore (cast wallet import deployer --interactive)
#   ACCOUNT=deployer PASSWORD_FILE=… ./deploy.sh   # same, unattended
#   PRIVATE_KEY=0x… ./deploy.sh             # or a key from your local environment
#
# The deployer needs Base Sepolia ETH and Lasna lREACT (send Base Sepolia ETH to the faucet
# 0x2afaFD298b23b62760711756088F75B7409f5967 with request(address): 1 ETH → 100 lREACT, at most 5 ETH per transaction).
# Optional: DEMO_BORROWER, RECEIVER_FUNDING_WEI (default 0.01 ether), REACTIVE_FUNDING_WEI (default 1 ether),
# CALLBACK_GAS_LIMIT (default 600000), LASNA_FLAGS (extra forge flags for Lasna, e.g. --legacy).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

BASE_SEPOLIA_RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
LASNA_RPC="${LASNA_RPC:-https://lasna-rpc.rnk.dev/}"
export BASE_SEPOLIA_RPC LASNA_RPC DEPLOY_TAG=testnet

if [[ -n "${ACCOUNT:-}" ]]; then AUTH=(--account "$ACCOUNT"); [[ -n "${PASSWORD_FILE:-}" ]] && AUTH+=(--password-file "$PASSWORD_FILE");
elif [[ -n "${PRIVATE_KEY:-}" ]]; then AUTH=(--private-key "$PRIVATE_KEY");
else echo "Set ACCOUNT (Foundry keystore name) or PRIVATE_KEY." >&2; exit 1; fi

echo "▸ Checking chains and Reactive contracts"
[[ "$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC")" == "84532" ]] || { echo "BASE_SEPOLIA_RPC is not Base Sepolia" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$LASNA_RPC")" == "5318007" ]] || { echo "LASNA_RPC is not Reactive Lasna" >&2; exit 1; }
[[ "$(cast code 0x476F44b11F5C942c58f4c8E3d0300E5710743585 --rpc-url "$BASE_SEPOLIA_RPC")" != "0x" ]] || { echo "No callback proxy bytecode on Base Sepolia" >&2; exit 1; }
[[ "$(cast code 0x8888888888888888888888888888888888888888 --rpc-url "$LASNA_RPC")" != "0x" ]] || { echo "No system contract bytecode on Lasna" >&2; exit 1; }

run() { forge script "$1" --rpc-url "$2" --broadcast --slow "${AUTH[@]}" ${3:-}; }
echo "▸ 1/4 Base Sepolia: tokens, oracle, vault";      run script/DeployBase.s.sol "$BASE_SEPOLIA_RPC"
echo "▸ 2/4 Lasna: ReactiveRepay";                      run script/DeployReactive.s.sol "$LASNA_RPC" "${LASNA_FLAGS:-}"
echo "▸ 3/4 Base Sepolia: RepayReceiver + funding";     run script/DeployReceiver.s.sol "$BASE_SEPOLIA_RPC"
echo "▸ 4/4 Lasna: wire, fund, subscribe";              run script/WireReactive.s.sol "$LASNA_RPC" "${LASNA_FLAGS:-}"
node scripts/build-manifest.mjs testnet --publish
echo "Done. Next: open the demo position (script/DemoPosition.s.sol, as the borrower) or use the dashboard."
