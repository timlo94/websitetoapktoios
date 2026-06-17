import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Tell Nitro to build specifically for a standard Node container, not Cloudflare
  nitro: {
    preset: "node-server"
  },
  
  tanstackStart: {
    server: { entry: "server" },
  },
});