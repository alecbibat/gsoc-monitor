import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This is an npm workspace, so Cesium's package (and its prebuilt static
// assets under Build/) is hoisted to the repo-root node_modules rather than
// living under client/node_modules, which is what vite-plugin-cesium assumes
// by default. Point it at the real location explicitly.
const cesiumBuildRootPath = path.resolve(__dirname, '../node_modules/cesium/Build');

export default defineConfig({
  // Stamped at build time (i.e. when Heroku builds the slug) so the UI can show
  // when the latest deploy went out.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    cesium({
      cesiumBuildRootPath,
      cesiumBuildPath: path.join(cesiumBuildRootPath, 'Cesium') + '/',
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
