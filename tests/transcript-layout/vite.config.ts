import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-transcript-fixture'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
