import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  build: {
    target: 'esnext', // Allows using modern features like Top-Level Await inside workers if needed
  }
});
