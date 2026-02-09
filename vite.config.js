import { defineConfig } from 'vite';

export default defineConfig({
  base: '/broken-arrow-insight/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
  server: {
    open: true,
  },
});
