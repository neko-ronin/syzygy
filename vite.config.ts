import { defineConfig } from 'vite';
import { syzygyApi } from './server/plugin.mjs';

export default defineConfig({
  plugins: [syzygyApi()],
  server: { port: 5180, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'esnext', assetsInlineLimit: 0 },
  // WGSL is imported as raw strings so shaders stay in their own files.
  assetsInclude: ['**/*.wgsl'],
});
