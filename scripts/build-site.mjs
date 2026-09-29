// Builds the static site into docs/ (served by GitHub Pages from master /docs).
//
//   node scripts/build-site.mjs          validate, then build
//
// Refuses to build if validation reports errors. Output is spoiler-safe: counts only.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadData, loadSource, SourceIndex } from './lib/data.mjs';
import { validate } from './lib/checks.mjs';
import { chapterDeltas, manifest } from './lib/site.mjs';
import { encodeChapter } from '../app/codec.js';

const OUT = path.join(ROOT, 'docs');
const APP = path.join(ROOT, 'app');

const data = loadData();
const report = validate(data, new SourceIndex(loadSource()));
if (report.errors.length) {
  console.error(`Validation failed with ${report.errors.length} errors. Run: npm run validate`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

for (const file of fs.readdirSync(APP)) fs.copyFileSync(path.join(APP, file), path.join(OUT, file));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'data', 'manifest.json'), JSON.stringify(manifest(data)) + '\n');
for (const d of chapterDeltas(data)) {
  const name = `${String(d.ch).padStart(3, '0')}.txt`;
  fs.writeFileSync(path.join(OUT, 'data', name), encodeChapter(d.ch, d) + '\n');
}

console.log(`Built docs/: ${data.chapters.length} chapters, ${data.people.length} people`);
