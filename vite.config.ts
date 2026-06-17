import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Force Lovable to build the Nitro SSR server!
  nitro: true,
  
  tanstackStart: {
    server: { entry: "server" },
  },
});
