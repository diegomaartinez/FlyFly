import { defineConfig, loadEnv, Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium carga workers, assets y widgets en tiempo de ejecución desde CESIUM_BASE_URL.
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

/**
 * Archivos que dependen del dominio y de la publicidad:
 * - VITE_SITE_URL (p. ej. https://flyfly.es): canonical, Open Graph, robots.txt con sitemap y sitemap.xml.
 * - VITE_ADSENSE_CLIENT (ca-pub-...): ads.txt, exigido por AdSense.
 */
function sitePlugin(mode: string): Plugin {
  const env = loadEnv(mode, '.', 'VITE_');
  const site = env.VITE_SITE_URL?.replace(/\/$/, '');
  const adsClient = env.VITE_ADSENSE_CLIENT;
  return {
    name: 'flyfly-site',
    transformIndexHtml() {
      if (!site) return [];
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: `${site}/` }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:url', content: `${site}/` }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og-image.jpg` }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${site}/og-image.jpg` }, injectTo: 'head' },
      ];
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${site}/sitemap.xml\n` : ''}`,
      });
      if (site) {
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site}/</loc></url>\n</urlset>\n`,
        });
      }
      if (adsClient) {
        this.emitFile({ type: 'asset', fileName: 'ads.txt', source: `google.com, ${adsClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: { CESIUM_BASE_URL: JSON.stringify(`./${cesiumBaseUrl}`) },
  base: './',
  plugins: [
    viteStaticCopy({
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumSource}/${dir}`,
        dest: cesiumBaseUrl,
      })),
    }),
    sitePlugin(mode),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    // Dos páginas: el juego y "Anúnciate".
    rollupOptions: { input: { main: 'index.html', anunciate: 'anunciate.html' } },
  },
}));
