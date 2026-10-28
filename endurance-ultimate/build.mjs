// Builds a fully self-contained, offline single-file version of the game:
//   endurance-ultimate/endurance24.html  (three.js + fonts inlined, no network needed)
// Usage (needs `three@0.160.0` and `esbuild` installed somewhere):
//   NODE_PATH=/path/to/node_modules node endurance-ultimate/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const require = createRequire(path.join(nodePaths[0] || here, 'noop.js'));
const esbuild = require('esbuild');

const src = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const open = '<script type="module">', start = src.indexOf(open), end = src.lastIndexOf('</script>');
if (start < 0 || end < start) throw new Error('module script not found');
const code = src.slice(start + open.length, end);

// 1) bundle the game module together with three.js
const { outputFiles } = await esbuild.build({
  stdin: { contents: code, resolveDir: here, loader: 'js' },
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2020', nodePaths,
  alias: { 'three/addons': 'three/examples/jsm' },
  legalComments: 'none',
});
const bundle = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// 2) embed the Google fonts (latin subset) as base64 woff2
async function fontCss() {
  const url = src.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/)[1].replace(/&amp;/g, '&');
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const css = await (await fetch(url, { headers: { 'User-Agent': ua } })).text();
  const blocks = css.split('/* ').filter(b => b.startsWith('latin */'));
  let out = '';
  for (const b of blocks) {
    const face = b.slice(b.indexOf('@font-face'));
    const fUrl = face.match(/url\((https:[^)]+)\)/)[1];
    const buf = Buffer.from(await (await fetch(fUrl)).arrayBuffer());
    out += face.replace(fUrl, 'data:font/woff2;base64,' + buf.toString('base64')) + '\n';
  }
  return out;
}
let fonts = '';
try { fonts = await fontCss(); } catch (e) { console.warn('fonts not embedded (offline?):', e.message); }

// 3) assemble
let html = src.slice(0, start) + '<script type="module">\n' + bundle + '\n</script>' + src.slice(end + '</script>'.length);
html = html.replace(/<link rel="preconnect"[^>]*>\n?/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/, fonts ? '<style>\n' + fonts + '</style>\n' : '')
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
const out = path.join(here, 'endurance24.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB', fonts ? '(fonts embedded)' : '(system fonts)');
