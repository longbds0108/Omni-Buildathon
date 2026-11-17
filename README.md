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

End-to-end latency is the callback block's timestamp minus the price update block's timestamp, both on Base Sepolia, so both come from one clock. Block timestamps have 1-second resolution and Base Sepolia makes a block every 2 seconds, so a figure is accurate to about 2 seconds. Any browser-clock measurement is labeled separately.

## Testnet proof

Not deployed yet. After `./deploy.sh` and the acceptance run, record here:

| Step | Chain | Tx hash |
|---|---|---|
| PriceUpdated v2 ($1,400) | Base Sepolia | |
| PriceUpdated v3 ($1,350), origin | Base Sepolia | |
| RepayRequested v3 | Reactive Lasna | |
| AutoRepaid v3 (callback) | Base Sepolia | |
| Measured latency | | |
