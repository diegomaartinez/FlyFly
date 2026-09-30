import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium carga workers, assets y widgets en tiempo de ejecución desde CESIUM_BASE_URL.
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify(`./${cesiumBaseUrl}`) },
  base: './',
  plugins: [
    viteStaticCopy({
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumSource}/${dir}`,
        dest: cesiumBaseUrl,
      })),
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
