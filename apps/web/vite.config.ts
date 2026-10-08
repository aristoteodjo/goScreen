import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Server-only secrets (DATABASE_URL, BETTER_AUTH_SECRET) are read from
  // process.env by better-auth, which Vite does not populate on its own.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
  };
});
