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
    // Node by default: most of this codebase is pure functions, and a DOM would
    // only make them slower. Component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
