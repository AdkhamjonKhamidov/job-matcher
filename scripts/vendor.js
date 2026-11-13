// Copy the browser-side libraries from node_modules into public/vendor so they are
// served as plain static files (locally and on Vercel). Runs after `npm install`.
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'vendor');
const nm = (p) => path.join(ROOT, 'node_modules', p);

const FILES = [
  ['pdfjs-dist/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['mammoth/mammoth.browser.min.js', 'mammoth/mammoth.browser.min.js'],
  ['d3-array/dist/d3-array.min.js', 'd3/d3-array.min.js'],
  ['d3-geo/dist/d3-geo.min.js', 'd3/d3-geo.min.js'],
  ['topojson-client/dist/topojson-client.min.js', 'topojson/topojson-client.min.js'],
  ['us-atlas/states-albers-10m.json', 'us-atlas/states-albers-10m.json'],
  ...['400', '500', '800', '900'].map((w) => [`@fontsource/archivo/files/archivo-latin-${w}-normal.woff2`, `fonts/archivo/files/archivo-latin-${w}-normal.woff2`]),
  ...['400', '500'].map((w) => [`@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-${w}-normal.woff2`, `fonts/ibm-plex-mono/files/ibm-plex-mono-latin-${w}-normal.woff2`]),
];

await rm(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const dest = path.join(OUT, to);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(nm(from), dest);
}
console.log(`vendor: copied ${FILES.length} files to public/vendor`);
