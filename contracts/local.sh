#!/usr/bin/env bash
# Local simulation of the whole loop on two anvil chains: 31337 stands in for Base Sepolia, 31338 for Reactive Lasna.
# A mock system contract sits at 0x8888…8888 on the second chain and a mock callback proxy on the first; the relayer
# (frontend: npm run relayer) plays Reactive Network between them. The dashboard labels this as Local simulation.
#
#   ./local.sh          start both chains, deploy, wire, open the demo position, publish the local manifest
#   ./local.sh stop     stop both chains
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"
A=http://127.0.0.1:8545
B=http://127.0.0.1:8546
# anvil's well-known public test key #0 (local chains only)
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

stop() {
  [[ -f .anvil-base.pid ]] && kill "$(cat .anvil-base.pid)" 2>/dev/null || true
  [[ -f .anvil-lasna.pid ]] && kill "$(cat .anvil-lasna.pid)" 2>/dev/null || true
  rm -f .anvil-base.pid .anvil-lasna.pid
}
if [[ "${1:-}" == "stop" ]]; then stop; echo "stopped"; exit 0; fi
stop

anvil --port 8545 --chain-id 31337 --silent > /dev/null 2>&1 & echo $! > .anvil-base.pid
anvil --port 8546 --chain-id 31338 --silent > /dev/null 2>&1 & echo $! > .anvil-lasna.pid
for url in $A $B; do for i in $(seq 1 50); do cast chain-id --rpc-url $url >/dev/null 2>&1 && break; sleep 0.2; done; done

echo "▸ mock system contract at 0x8888…8888 on the Lasna stand-in"
cast rpc anvil_setCode 0x8888888888888888888888888888888888888888 "$(forge inspect MockSystemContract deployedBytecode)" --rpc-url $B > /dev/null
echo "▸ mock callback proxy on the Base stand-in"
PROXY=$(forge create src/mocks/MockCallbackProxy.sol:MockCallbackProxy --rpc-url $A --private-key $KEY --broadcast --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).deployedTo))')

export DEPLOY_TAG=local BASE_CHAIN_ID=31337 LASNA_CHAIN_ID=31338 CALLBACK_PROXY=$PROXY
run() { forge script "$1" --rpc-url "$2" --broadcast --private-key $KEY -q; }
run script/DeployBase.s.sol $A
run script/DeployReactive.s.sol $B
run script/DeployReceiver.s.sol $A
run script/WireReactive.s.sol $B
run script/DemoPosition.s.sol $A
node scripts/build-manifest.mjs local --publish
echo "Local chains are running. Start the relayer: cd ../frontend && npm run relayer"
