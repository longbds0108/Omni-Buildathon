import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The homepage is static (index.html + public/home). The dashboard is a React app under /app/ with clean URLs
// such as /app/position, so every extension-less /app/* request is answered with app/index.html.
const appFallback = (): Plugin => {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url && /^\/app(\/[^.?]*)?(\?.*)?$/.test(req.url)) req.url = "/app/index.html";
    next();
  };
  return {
    name: "repay-relay-app-fallback",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
};

export default defineConfig({
  plugins: [react(), appFallback()],
  build: {
    target: "es2022",
    rollupOptions: { input: { home: here("index.html"), app: here("app/index.html"), docs: here("docs/index.html") } },
  },
});
