import { cpSync } from 'node:fs';
import { defineConfig } from 'vite';

// Los .glb se cargan en runtime (appendSceneAsync), así que Vite no los ve en
// el grafo de módulos: los copiamos tal cual a dist/assets.
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
    // El chunk de Babylon es grande a propósito (ver abajo).
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      output: {
        // Babylon se reparte en ~100 chunks por defecto (los shaders son
        // imports dinámicos). Servido por tools/server.py -- HTTP/1.1, un solo
        // hilo, sin gzip -- eso son decenas de peticiones en serie, así que
        // sale más a cuenta un único chunk aunque pese algo más.
        advancedChunks: {
          groups: [{ name: 'babylon', test: /node_modules[\\/]@babylonjs[\\/]/ }],
        },
      },
    },
  },
});
