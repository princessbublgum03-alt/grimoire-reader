import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'vendor');

fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['node_modules/epubjs/dist/epub.min.js', 'epub.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js']
];

for (const [srcRel, dstName] of files) {
  const src = path.join(root, srcRel);
  const dst = path.join(outDir, dstName);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing vendor source file: ${src}`);
  }
  fs.copyFileSync(src, dst);
}

console.log(`Synced ${files.length} local vendor bundles to public/vendor/`);
