import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Tauri expects a fixed dev port.
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
  clearScreen: false,
});
