# Repay Relay contracts

Foundry project for the Repay Relay loop (Base Sepolia → Reactive Lasna → Base Sepolia). See the root README for the
architecture, the vault rules and how to run the tests, the local two-chain simulation and the testnet deployment.

```bash
forge test        # 27 tests
./local.sh        # two anvil chains + deploy + demo position (then: cd ../frontend && npm run relayer)
./deploy.sh       # Base Sepolia + Reactive Lasna (needs ACCOUNT or PRIVATE_KEY, Base Sepolia ETH and lREACT)
```
