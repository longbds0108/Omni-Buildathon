# Repay Relay

Automatic partial loan repayment, triggered by the price. Built for the Reactive Omni Buildathon ("Every Second Counts").

A borrower opens a simulated loan against test collateral on Base Sepolia, funds a repay reserve in mUSD and sets a per-callback limit. When the oracle price reaches the trigger, a reactive contract on Reactive Lasna sees the price log and asks for a callback to Base Sepolia, where the vault pays part of the debt from that reserve. The dashboard shows the trigger, debt before and after, the three transactions and the measured latency.

```
Base Sepolia (84532)                     Reactive Lasna (5318007)                Base Sepolia (84532)
MockOracle.setPrice ──PriceUpdated──▶    ReactiveRepay.react()   ──callback──▶   callback proxy
 (operator)            (log)              onlySystem, checks log,                 → RepayReceiver.executeRepay
                                          price ≤ $1,350, once per version          (checks proxy + injected sender)
                                          requestCallbackV_1_0 → RepayRequested     → LendingVault.autoRepay
                                                                                    → AutoRepaid / CallbackSkipped
```

Each run is joined across chains by **oracle version + origin tx hash**: `PriceUpdated` → `RepayRequested` → `AutoRepaid` or `CallbackSkipped`.

## Buildathon submission

| Requirement | Where |
|---|---|
| Track | **Every Second Counts** (time-sensitive DeFi: price-triggered loan protection) |
| Networks | Reactive **Lasna** testnet in the middle, **Base Sepolia** as origin and destination |
| Public, open-source repo | This repository, [MIT license](LICENSE) |
| Deployed contract addresses | [Testnet deployment (live)](#testnet-deployment-live) |
| Transaction hashes for the full loop | [Testnet proof](#testnet-proof): `PriceUpdated` (Base Sepolia) → `RepayRequested` (Lasna) → `AutoRepaid` (Base Sepolia) |
| Latency across the full loop | **1 s** by block timestamps, **9 blocks** (about 1.8 s) on Base Sepolia. Method in [Latency](#latency) |
| Timers on Base Sepolia | The 15-minute price freshness check uses `block.timestamp`, never block counts |
| Demo video (under 3 min) | _link to be added_ (recording plan: [docs/demo-video.md](docs/demo-video.md)) |
| Built during the event | First commit on 17 Nov 2026 |

What the reactive contract does on its own, with no off-chain bot: it filters the oracle log by chain, contract, topic and data shape, compares the price with the borrower's trigger, requests at most one callback per oracle version, and carries the origin tx hash into the callback so every repayment can be traced back to the price update that caused it. The vault then re-checks ten conditions before it moves any funds, and records a reason when it skips.

## Repository

| Path | What |
|---|---|
| `contracts/` | Foundry project: contracts, tests, deploy scripts, manifest builder |
| `frontend/` | Vite homepage (`/`) and React + TypeScript + viem + wagmi/RainbowKit dashboard (`/app/`) |
| `REPAY_RELAY_MVP.md` | The build brief |

## Contracts

| Contract | Chain | Role |
|---|---|---|
| `TestToken` (mCOL, 18 decimals; mUSD, 6 decimals) | Base Sepolia | Test tokens, minted by the deployer only |
| `MockOracle` | Base Sepolia | Operator sets a positive price; `version` +1 per update; emits `PriceUpdated(uint256 indexed version, uint256 priceE6, uint256 updatedAt)` |
| `LendingVault` | Base Sepolia | Zero-interest loan, per-borrower reserve and repay rule, `autoRepay` for the registered receiver |
| `ReactiveRepay` | Reactive Lasna | One route: one borrower, one $1,350 trigger, one oracle, one receiver |
| `RepayReceiver` | Base Sepolia | `executeRepay(address reactiveSender, uint256 oracleVersion, bytes32 originTxHash)` behind `onlyServiceProvider` + `onlyCallbackSender` |

### Vault rules

- Open at **160%** or more, with an oracle price no older than **15 minutes** (`PRICE_FRESHNESS`).
- `collateralValueE6 = collateralE18 × priceE6 / 1e18`, `ratioBps = value × 10,000 / debt`, all rounded down (`Math.mulDiv`).
- Auto-repay: `targetDebt = floor(value × 10,000 / 15,000)`, `amount = min(debt − targetDebt, reserve, maxRepayAmount)`. Restores **150%** unless the reserve or the limit caps it.
- The **120%** line is a *Simulated liquidation line*, display only. Nothing is liquidated.
- `autoRepay` checks, in order: position open, protection on, price fresh, price at or under the vault trigger, callback carries the latest oracle version, not yet paid for this borrower and version, version newer than the last open or configuration. A valid but inapplicable callback is **skipped** with a `CallbackSkipped(reason)` event, not reverted. Unauthorised callers revert.
- Lendable liquidity and reserves are booked apart: vault mUSD balance = `liquidity + totalReserves`. A repay moves the amount from the reserve back into liquidity.
- `configVersion` (the oracle version at the last open or configuration) only rises, so a callback requested before a reconfiguration or a reopen never touches the new rule or loan.

### Reactive Network specifics (Omni)

| Item | Value |
|---|---|
| Lasna RPC | `https://lasna-rpc.rnk.dev/` (chain 5318007, lREACT) |
| System contract (Lasna) | `0x8888888888888888888888888888888888888888` |
| Base Sepolia callback proxy | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` |
| Explorers | `https://sepolia.basescan.org`, `https://lasna.reactscan.net` |
| Faucet (Base Sepolia → lREACT) | `request(address)` on `0x2afaFD298b23b62760711756088F75B7409f5967`, 1 ETH → 100 lREACT, at most 5 ETH per transaction |

- Library: **reactive-lib-omni v0.1.0**, commit `3ade0dcf1d27e67e5783ef807e73a1b9e0c0cce8` (`AbstractReactive`, `AbstractCallback`, `ISystemContract.requestCallbackV_1_0`). Other pins: OpenZeppelin Contracts v5.1.0, forge-std v1.9.4, Solidity 0.8.29.
- `ReactiveRepay` subscribes once, through the system contract, after wiring and funding. `react()` is `onlySystem`; logs that don't match (chain, oracle, topic, `opCode` 2, 64-byte data) are ignored rather than reverted, because a reverted `react()` is still charged.
- The payload's first argument is `address(0)`; the callback proxy overwrites it with ReactiveRepay's address. Callback gas limit: 600,000 (the network ignores requests under 100,000).
- Funding: `depositTo(address)` on the system contract for ReactiveRepay (lREACT) and on the callback proxy for RepayReceiver (Base Sepolia ETH). Any debt stops service until covered; both contracts expose `coverDebt()`.

## Run it

### Tests

```bash
cd contracts
forge test            # 27 tests, including a 256-run fuzz of the repay bounds
```

Covers price above, at and below the trigger; wrong chain, oracle, topic and log shape; unauthorised `react`; wrong proxy and wrong injected sender; duplicate request and duplicate callback; out-of-order and stale callbacks; protection off; vault trigger overriding the route; reconfiguration and reopen; zero debt, limit below the gap, empty reserve; reserve isolation between borrowers; decimal precision; debt reduced by exactly the reserve used; liquidity books; close and collateral return. `test_AcceptanceScenario` replays the brief: $1,800 → 180%; $1,400 → 140%, no request; $1,350 → request, repay 100 mUSD, debt 900, reserve 50, back to 150%.

### Dashboard

```bash
cd frontend
npm install
npm run dev           # http://127.0.0.1:5173/ (homepage) and /app/ (dashboard)
```

The dashboard shows **real testnet data only**. It reads `frontend/public/manifest.json`, written by `contracts/deploy.sh`:

- **`network: "testnet"`:** the deployed contracts on Base Sepolia and Reactive Lasna. Reads work without a wallet; actions are sent from the connected wallet (RainbowKit). Borrower actions need the demo borrower's wallet, price updates need the operator's.
- **No testnet manifest:** a *Not deployed yet* page that shows only live facts read from the two chains (current block, whether the callback proxy and the system contract exist). No numbers are invented.
- **Developers only:** with `VITE_DEV_SIMULATION=1` the dashboard also accepts a local anvil manifest (below) or, with no manifest, runs an in-browser simulation. Both are labeled *Local simulation*. Never set this for a real build.

Optional: set `VITE_WALLETCONNECT_PROJECT_ID` in `frontend/.env` (see `.env.example`) to offer WalletConnect and mobile wallets.

### Local simulation on two chains

```bash
cd contracts && ./local.sh          # anvil 31337 (Base stand-in) + 31338 (Lasna stand-in), deploy, wire, demo position
cd ../frontend && npm run relayer   # plays Reactive Network: forwards PriceUpdated, delivers callbacks via the mock proxy
VITE_DEV_SIMULATION=1 npm run dev
```

Push prices from the dashboard (top bar, as the operator) or with `cast send <oracle> "setPrice(uint256)" 1350000000`. Stop the chains with `./local.sh stop`. The mocks (`src/mocks/`) exist only for tests and this mode.

### Testnet deployment

You need Base Sepolia ETH for the deployer and lREACT on Lasna (send Base Sepolia ETH to the faucet above).

```bash
cd contracts
cp .env.example .env && $EDITOR .env && source .env     # ACCOUNT (Foundry keystore) or PRIVATE_KEY; never commit .env
./deploy.sh
```

`deploy.sh` first checks the chain IDs and that the callback proxy and the system contract have bytecode. Then it runs four steps:

1. **Base Sepolia:** deploy the tokens, oracle and vault. Seed 10,000 mUSD of liquidity, fund the demo borrower, and set the price to $1,800.
2. **Lasna:** deploy `ReactiveRepay`.
3. **Base Sepolia:** deploy `RepayReceiver` and register it on the vault. Fund its callback gas with `depositTo`.
4. **Lasna:** set the recipient, fund reactive gas with `depositTo`, and subscribe.

Last, it writes `contracts/deployments/testnet/manifest.json`, with every chain ID, address and deploy or funding tx hash, and publishes it to `frontend/public/manifest.json`. Then:

```bash
forge script script/DemoPosition.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --account <borrower>   # within 15 min of the last price
PRICE_E6=1400000000 forge script script/PushPrice.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --account <operator>
PRICE_E6=1350000000 forge script script/PushPrice.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --account <operator>
```

or do the same from the dashboard.

## Latency

End-to-end latency is the callback block's timestamp minus the price update block's timestamp, both on Base Sepolia, so both come from one clock. Block timestamps count whole seconds, so that figure is accurate to about one second. Base Sepolia currently makes a block about every 0.2 seconds (measured on 17 Nov 2026: 1,000 blocks in 200 s), so the dashboard also shows the block distance, a finer estimate. Any browser-clock measurement is labeled separately.

## Testnet deployment (live)

Deployed on 17 Nov 2026. The full manifest, with every deploy and funding transaction, is `contracts/deployments/testnet/manifest.json`.

| Contract | Chain | Address |
|---|---|---|
| MockOracle | Base Sepolia | [`0x75e188cafAf2b8138E3B19CfAdDA92f13d9954E9`](https://sepolia.basescan.org/address/0x75e188cafAf2b8138E3B19CfAdDA92f13d9954E9) |
| LendingVault | Base Sepolia | [`0xc05A1f041a42FFa96FC24a3aeBc576b1157aA7F6`](https://sepolia.basescan.org/address/0xc05A1f041a42FFa96FC24a3aeBc576b1157aA7F6) |
| RepayReceiver | Base Sepolia | [`0x1F8A235387763A67E4f293E1bDFC65E149437120`](https://sepolia.basescan.org/address/0x1F8A235387763A67E4f293E1bDFC65E149437120) |
| mCOL | Base Sepolia | [`0x8e802F7811519Cb66b96241a93f80043537378ae`](https://sepolia.basescan.org/address/0x8e802F7811519Cb66b96241a93f80043537378ae) |
| mUSD | Base Sepolia | [`0x7d2b1BaC9fAF8FE457C9F4533C17E04497505844`](https://sepolia.basescan.org/address/0x7d2b1BaC9fAF8FE457C9F4533C17E04497505844) |
| ReactiveRepay | Reactive Lasna | [`0x1Fce7b29CB138F878B672eBAdFCf54A1B87aC140`](https://lasna.reactscan.net/address/0x1Fce7b29CB138F878B672eBAdFCf54A1B87aC140) |
| Demo borrower and operator | both | `0xF9642B695D4DDf58599c953a791F94c2e96b6a57` |

Funding: 1 lREACT deposited for ReactiveRepay at the system contract, 0.01 ETH for RepayReceiver at the callback proxy.

## Testnet proof

The acceptance scenario, run on 17 Nov 2026 against the deployment above:

| Step | Chain | Result | Tx hash |
|---|---|---|---|
| Setup at $1,800 (oracle v1) | Base Sepolia | 1 mCOL, 1,000 mUSD debt, 150 reserve, 120 limit, protection on: **180%** | see manifest + `DemoPosition` broadcast |
| PriceUpdated v2, $1,400 | Base Sepolia | **140%**, debt stays 1,000. Lasna ran `react()` (ReactiveRepay's reserve went 1.0000 → 0.9887 lREACT) and requested nothing | [`0xf997c847…02ace3`](https://sepolia.basescan.org/tx/0xf997c8478f50f30952eb16d81fec9c3b55ebafa8c93933dc3d5fada4e002ace3) |
| PriceUpdated v3, $1,350 (origin) | Base Sepolia | block 59,947,556 | [`0xa2d8f994…076912`](https://sepolia.basescan.org/tx/0xa2d8f994a21abc0e0c2ebb07cf7f4b4cb45f6926505696dde81d306ef3076912) |
| RepayRequested v3 | Reactive Lasna | carries origin tx `0xa2d8f994…` and version 3; block 8,564,794 | [`0xfdb57bfb…ba476b`](https://lasna.reactscan.net/tx/0xfdb57bfbc1d5b268d4beff12c342b0bceb3ccbd76ea640618ffd9e69e6ba476b) |
| AutoRepaid v3 (callback) | Base Sepolia | repaid **100 mUSD**: debt 1,000 → **900**, reserve 150 → **50**, ratio back to **150%**; block 59,947,565 | [`0x9feae670…87e0473`](https://sepolia.basescan.org/tx/0x9feae670d4bb799613160ef3fdcb21e70156d44dd14c588b89c6b772c87e0473) |

**Measured latency:** 1 second by block timestamps (callback block 1,794,911,381 − price block 1,794,911,380; 1-second resolution), and 9 blocks apart on Base Sepolia, about 1.8 seconds at ~0.2 s per block.

## License

MIT. See [LICENSE](LICENSE).
