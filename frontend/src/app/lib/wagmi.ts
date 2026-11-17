import { connectorsForWallets, darkTheme, type Theme } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import type { Chain } from "viem";
import { manifest } from "./manifest";
import { chainOf } from "./live";

/*
 * RainbowKit + wagmi on Base Sepolia only: every transaction the borrower signs lands there; Lasna needs no wallet.
 * WalletConnect (QR and mobile wallets) needs a project ID from cloud.reown.com in VITE_WALLETCONNECT_PROJECT_ID.
 * Without one the modal lists browser-extension wallets and Coinbase Wallet, which need no project ID.
 */
const projectId: string = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "";
export const hasWalletConnect = projectId.length > 0;

const connectors = connectorsForWallets(
  hasWalletConnect
    ? [
        { groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet] },
        { groupName: "More", wallets: [walletConnectWallet, injectedWallet] },
      ]
    : [{ groupName: "Browser wallets", wallets: [injectedWallet, rabbyWallet, coinbaseWallet] }],
  { appName: "Repay Relay", projectId: projectId || "unset", appDescription: "Automatic repay from a reserve, driven by Reactive Network." },
);

/* The chain the borrower signs on: Base Sepolia (with the manifest's RPC), or the local anvil stand-in. */
const home: Chain =
  manifest?.network === "local"
    ? chainOf(manifest.base, "ETH")
    : manifest
      ? { ...baseSepolia, rpcUrls: { default: { http: [manifest.base.rpc] } } }
      : baseSepolia;

export const wagmiConfig = createConfig({
  connectors,
  chains: [home],
  transports: { [home.id]: http(manifest?.base.rpc) },
});

export const BASE_SEPOLIA = home;

/* The dashboard palette: charcoal and olive surfaces, warm off-white text, burnt orange for the primary action. */
const base = darkTheme({ accentColor: "#c95d2a", accentColorForeground: "#fff6ec", borderRadius: "small", overlayBlur: "small" });
export const rainbowTheme: Theme = {
  ...base,
  fonts: { body: '"Geist", "Inter", ui-sans-serif, system-ui, sans-serif' },
  colors: {
    ...base.colors,
    modalBackground: "#1d1f1a",
    modalBorder: "rgba(236, 230, 214, 0.12)",
    modalText: "#ece6d6",
    modalTextSecondary: "#a7a190",
    modalTextDim: "#77725f",
    modalBackdrop: "rgba(10, 10, 8, 0.62)",
    actionButtonSecondaryBackground: "rgba(236, 230, 214, 0.05)",
    closeButtonBackground: "rgba(236, 230, 214, 0.06)",
    closeButton: "#a7a190",
    generalBorder: "rgba(236, 230, 214, 0.15)",
    menuItemBackground: "rgba(236, 230, 214, 0.06)",
    profileForeground: "#1d1f1a",
    selectedOptionBorder: "rgba(201, 93, 42, 0.6)",
    connectionIndicator: "#87b36e",
    error: "#d4575f",
  },
  shadows: { ...base.shadows, dialog: "0 30px 70px -20px rgba(0, 0, 0, 0.9)" },
};
