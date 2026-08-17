import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    exclude: ["tests/browser/**", "node_modules/**"],
    coverage: { reporter: ["text", "html"] },
  },
});
