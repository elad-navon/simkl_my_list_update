import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Deployed to GitHub Pages under https://elad-navon.github.io/simkl_my_list_update/,
// so every asset URL has to carry that prefix. `npm run dev` serves from "/" instead,
// which is what BASE_PATH=/ in the env gives you.
const base = process.env.BASE_PATH ?? "/simkl_my_list_update/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
