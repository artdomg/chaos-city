import { cpSync } from 'node:fs';
import { defineConfig } from 'vite';

// Los .glb se cargan en runtime (BABYLON.SceneLoader), así que Vite no los ve
// en el grafo de módulos: los copiamos tal cual a dist/assets.
function copyAssets() {
  return {
    name: 'copy-assets',
    closeBundle() {
      cpSync('assets', 'dist/assets', { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copyAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // El bundle va a dist/bundle para no mezclarse con dist/assets (.glb).
    assetsDir: 'bundle',
    chunkSizeWarningLimit: 10000,
  },
});
