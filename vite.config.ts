import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../common/src/main/resources/metrics-viewer",
    emptyOutDir: true,
  },
});
