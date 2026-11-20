import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Where the Express API runs. server/.env sets PORT=8000.
// Override with VITE_API_TARGET if you change the backend port.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    // Must match CLIENT_ORIGINS in server/.env (http://localhost:5173)
    port: 5173,
    proxy: {
      // Proxying keeps browser requests same-origin, so the httpOnly auth cookie just works.
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
