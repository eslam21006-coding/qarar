import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.test.tsx",
      "server/**/*.spec.ts",
      "server/**/*.spec.tsx",
      "client/src/**/*.test.ts",
      "client/src/**/*.test.tsx",
      "client/src/**/*.spec.ts",
      "client/src/**/*.spec.tsx",
      "shared/**/*.test.ts",
      "shared/**/*.test.tsx",
      "shared/**/*.spec.ts",
      "shared/**/*.spec.tsx",
    ],
    setupFiles: ["./client/src/test/setup.ts"],
  },
});
