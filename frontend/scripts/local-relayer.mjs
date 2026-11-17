#!/usr/bin/env node
// Plays Reactive Network between the two local anvil chains started by contracts/local.sh. It forwards every
// PriceUpdated log to ReactiveRepay through the mock system contract, then delivers every requested callback through
// the mock callback proxy, which injects the reactive contract's address like the real proxy does.
// Local simulation only: on testnet, Reactive Network does this.
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
if (manifest.network !== "local") {
  console.error("public/manifest.json is not a local deployment. Run contracts/local.sh first.");
  process.exit(1);
}
const chain = (c, name) =>
  defineChain({ id: c.chainId, name, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [c.rpc] } } });
const base = chain(manifest.base, "local-base");
const lasna = chain(manifest.lasna, "local-lasna");
// anvil's well-known public test key #9 (local chains only)
const account = privateKeyToAccount("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6");
const pubA = createPublicClient({ chain: base, transport: http() });
const pubB = createPublicClient({ chain: lasna, transport: http() });
const walA = createWalletClient({ account, chain: base, transport: http() });
const walB = createWalletClient({ account, chain: lasna, transport: http() });

const priceUpdated = parseAbiItem("event PriceUpdated(uint256 indexed version, uint256 priceE6, uint256 updatedAt)");
const callbackRequested = parseAbiItem(
  "event CallbackRequested(address indexed sender, uint256 indexed chainId, address indexed recipient, uint64 gasLimit, bytes payload)",
);
const sysAbi = parseAbi([
  "function deliver(address target, (uint256 chainId, address contractAddress, uint256 topic0, uint256 topic1, uint256 topic2, uint256 topic3, bytes data, uint256 blockNumber, uint256 opCode, uint256 blockHash, uint256 txHash, uint256 logIndex) log)",
]);
const proxyAbi = parseAbi(["function deliver(address recipient, bytes payload, address reactiveSender) returns (bool, bytes)"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let nextA = (await pubA.getBlockNumber()) + 1n;
let nextB = (await pubB.getBlockNumber()) + 1n;
console.log(`relaying: oracle ${manifest.base.oracle} → ReactiveRepay ${manifest.lasna.reactiveRepay} → receiver ${manifest.base.receiver}`);

for (;;) {
  try {
    const headA = await pubA.getBlockNumber();
    if (headA >= nextA) {
      const logs = await pubA.getLogs({ address: manifest.base.oracle, event: priceUpdated, fromBlock: nextA, toBlock: headA });
      nextA = headA + 1n;
      for (const l of logs) {
        await sleep(1200);
        const record = {
          chainId: BigInt(manifest.base.chainId),
          contractAddress: l.address,
          topic0: BigInt(l.topics[0]),
          topic1: BigInt(l.topics[1]),
          topic2: 0n,
          topic3: 0n,
          data: l.data,
          blockNumber: l.blockNumber,
          opCode: BigInt(l.topics.length),
          blockHash: BigInt(l.blockHash),
          txHash: BigInt(l.transactionHash),
          logIndex: BigInt(l.logIndex),
        };
        const hash = await walB.writeContract({
          address: manifest.lasna.systemContract,
          abi: sysAbi,
          functionName: "deliver",
          args: [manifest.lasna.reactiveRepay, record],
        });
        await pubB.waitForTransactionReceipt({ hash });
        console.log(`v${l.args.version} $${Number(l.args.priceE6) / 1e6} → react() ${hash.slice(0, 10)}`);
      }
    }
    const headB = await pubB.getBlockNumber();
    if (headB >= nextB) {
      const reqs = await pubB.getLogs({ address: manifest.lasna.systemContract, event: callbackRequested, fromBlock: nextB, toBlock: headB });
      nextB = headB + 1n;
      for (const r of reqs) {
        await sleep(900);
        const hash = await walA.writeContract({
          address: manifest.base.callbackProxy,
          abi: proxyAbi,
          functionName: "deliver",
          args: [r.args.recipient, r.args.payload, r.args.sender],
        });
        await pubA.waitForTransactionReceipt({ hash });
        console.log(`callback → ${r.args.recipient.slice(0, 10)} ${hash.slice(0, 10)}`);
      }
    }
  } catch (e) {
    console.error("relayer:", e.shortMessage ?? e.message);
  }
  await sleep(1000);
}
