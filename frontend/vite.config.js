import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development, Vite serves on :5173 and proxies /api/* to FastAPI on
// :8000. In production, FastAPI serves the built dist/ directly and no proxy
// is involved — same-origin /api works without CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // three.js (~530 kB min, ~135 kB gzip) is its own lazy chunk, loaded
    // only by the welcome scene; don't warn about it.
    chunkSizeWarningLimit: 600,
  },
});
