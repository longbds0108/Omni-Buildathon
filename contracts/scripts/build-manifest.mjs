#!/usr/bin/env node
// Merges deployments/<tag>/*.json with the broadcast receipts into deployments/<tag>/manifest.json.
// With --publish it also writes frontend/public/manifest.json, which switches the dashboard from Local simulation to
// the deployed contracts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tag = process.argv[2] ?? "testnet";
const publish = process.argv.includes("--publish");
const dir = path.join(root, "deployments", tag);
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

const base = read("base.json");
const lasna = read("lasna.json");
const receiver = read("receiver.json");
const wire = read("wire.json");

const NETWORKS = {
  testnet: {
    base: { rpc: process.env.DASHBOARD_BASE_RPC || "https://base-sepolia-rpc.publicnode.com", explorer: "https://sepolia.basescan.org", name: "Base Sepolia" },
    lasna: { rpc: process.env.DASHBOARD_LASNA_RPC || "https://lasna-rpc.rnk.dev/", explorer: "https://lasna.reactscan.net", name: "Reactive Lasna" },
  },
  local: {
    base: { rpc: "http://127.0.0.1:8545", explorer: null, name: "Local Base (anvil)" },
    lasna: { rpc: "http://127.0.0.1:8546", explorer: null, name: "Local Lasna (anvil)" },
  },
};
const net = NETWORKS[tag] ?? NETWORKS.testnet;

const steps = [
  ["DeployBase.s.sol", base.chainId, "base"],
  ["DeployReactive.s.sol", lasna.chainId, "lasna"],
  ["DeployReceiver.s.sol", base.chainId, "base"],
  ["WireReactive.s.sol", lasna.chainId, "lasna"],
];
const known = {
  base: {
    [String(base.vault).toLowerCase()]: "LendingVault",
    [String(base.oracle).toLowerCase()]: "MockOracle",
    [String(base.collateral).toLowerCase()]: "mCOL",
    [String(base.musd).toLowerCase()]: "mUSD",
    [String(receiver.receiver).toLowerCase()]: "RepayReceiver",
    [String(receiver.callbackProxy).toLowerCase()]: "Callback proxy",
  },
  lasna: {
    [String(lasna.reactiveRepay).toLowerCase()]: "ReactiveRepay",
    "0x8888888888888888888888888888888888888888": "System contract",
  },
};
const transactions = [];
for (const [script, chainId, chain] of steps) {
  const file = path.join(root, "broadcast", script, String(chainId), "run-latest.json");
  if (!fs.existsSync(file)) continue;
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  run.transactions.forEach((tx, i) => {
    const target = known[chain][String(tx.transaction?.to ?? "").toLowerCase()] ?? tx.contractName ?? "call";
    const label = tx.transactionType === "CREATE" ? `Deploy ${tx.contractName}` : `${target} · ${(tx.function ?? "transfer").split("(")[0]}`;
    transactions.push({ chain, label, hash: tx.hash, block: Number(run.receipts?.[i]?.blockNumber ?? 0) });
  });
}

const manifest = {
  network: tag,
  generatedAt: new Date().toISOString(),
  base: {
    ...net.base,
    chainId: Number(base.chainId),
    deployBlock: Number(base.deployBlock),
    operator: base.operator,
    collateral: base.collateral,
    musd: base.musd,
    oracle: base.oracle,
    vault: base.vault,
    receiver: receiver.receiver,
    callbackProxy: receiver.callbackProxy,
  },
  lasna: {
    ...net.lasna,
    chainId: Number(lasna.chainId),
    deployBlock: Number(lasna.deployBlock),
    reactiveRepay: lasna.reactiveRepay,
    systemContract: "0x8888888888888888888888888888888888888888",
  },
  borrower: base.borrower,
  triggerPriceE6: String(lasna.triggerPriceE6),
  callbackGasLimit: Number(lasna.callbackGasLimit),
  funding: { receiverWei: String(receiver.funding), reactiveWei: String(wire.funding) },
  transactions,
};

fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: deployments/${tag}/manifest.json (${transactions.length} transactions)`);
if (publish) {
  const out = path.join(root, "..", "frontend", "public", "manifest.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log("published to frontend/public/manifest.json");
}
