import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { devSimulation, loadManifest, manifest } from "./lib/manifest";
import "./styles/app.css";

// The manifest decides what the dashboard reads, so it loads before the app modules (wallet config, data store).
// Without a testnet deployment the dashboard shows no numbers at all, only the real state of the two chains.
await loadManifest();
const root = createRoot(document.getElementById("root")!);
if (manifest || devSimulation) {
  const { App } = await import("./App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  const { NotDeployed } = await import("./NotDeployed");
  root.render(
    <StrictMode>
      <NotDeployed />
    </StrictMode>,
  );
}
