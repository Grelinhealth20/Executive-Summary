import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build assets with relative paths so the Express server can serve them from
// client/dist. During dev, proxy API calls to the Node backend on port 3000.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
