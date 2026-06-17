import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// ... your other imports ...

export default defineConfig({
  plugins: [react()],
  
  // ADD THIS PREVIEW BLOCK:
  preview: {
    port: 8080,
    allowedHosts: true, // This explicitly tells Vite to allow Cloud Run's URLs
  },
  
  // ... the rest of your existing config ...
});