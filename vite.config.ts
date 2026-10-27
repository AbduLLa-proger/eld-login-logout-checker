import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const packageJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf-8",
  ),
) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
