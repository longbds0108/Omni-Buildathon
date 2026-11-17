import { connectorsForWallets, darkTheme, type Theme } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";

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

export const wagmiConfig = createConfig({
  connectors,
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http() },
});

export const BASE_SEPOLIA = baseSepolia;

/* The homepage palette: cream accent on ink, Inter Tight, large radii. */
const base = darkTheme({ accentColor: "#e8e3d5", accentColorForeground: "#111015", borderRadius: "large", overlayBlur: "small" });
export const rainbowTheme: Theme = {
  ...base,
  fonts: { body: '"Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif' },
  colors: {
    ...base.colors,
    modalBackground: "#141218",
    modalBorder: "rgba(255, 255, 255, 0.08)",
    modalText: "#f5f3f7",
    modalTextSecondary: "#9b949f",
    modalTextDim: "#6f6876",
    modalBackdrop: "rgba(8, 7, 11, 0.7)",
    actionButtonSecondaryBackground: "rgba(255, 255, 255, 0.05)",
    closeButtonBackground: "rgba(255, 255, 255, 0.06)",
    closeButton: "#d6d1d9",
    generalBorder: "rgba(255, 255, 255, 0.14)",
    menuItemBackground: "rgba(131, 170, 255, 0.08)",
    profileForeground: "#141218",
    selectedOptionBorder: "rgba(131, 170, 255, 0.5)",
    connectionIndicator: "#4fd1c5",
    error: "#f08a8d",
  },
  shadows: { ...base.shadows, dialog: "0 30px 80px -20px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(131, 170, 255, 0.12)" },
};
