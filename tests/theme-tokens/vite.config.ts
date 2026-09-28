import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // The fixture loads `src/index.css`, whose `@font-face` rules point at
  // `/fonts/…`. Serving the app's own public dir is what makes those URLs real
  // here: the terminal font contract asks whether the self-hosted face is
  // genuinely late to arrive, and that question needs a font that can arrive.
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
});
