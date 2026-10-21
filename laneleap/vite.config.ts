/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Emits `sw.js` with the list of hashed build assets injected, so the service
 * worker can precache the full game for offline play without extra deps.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'laneleap-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const extra = [
        './',
        'index.html',
        'manifest.webmanifest',
        'favicon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'icons/apple-touch-icon.png',
      ];
      const precache = Array.from(new Set([...extra, ...files]));
      const version = Date.now().toString(36);
      const template = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8');
      const source = template
        .replace('__PRECACHE_LIST__', JSON.stringify(precache))
        .replace('__CACHE_VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorkerPlugin()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
