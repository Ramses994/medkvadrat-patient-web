import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev ports chosen to avoid the API repo dashboard Playwright (no fixed Vite port there)
// and any local API on 8080/8082/8083.
const DEV_PORT = 5177;
const STUB_API = 'http://127.0.0.1:8091';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: STUB_API,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4177,
    strictPort: true,
    proxy: {
      '/api': {
        target: STUB_API,
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
