import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  plugins: [react()],
  server: {
    host: env.VITE_BIND_HOST || '127.0.0.1',
    port: 3100,
    proxy: {
      "/api": {
        target: env.SERVER_API_URL || "http://127.0.0.1:8001",
        changeOrigin: true,
      },
    },
  },
};
});
