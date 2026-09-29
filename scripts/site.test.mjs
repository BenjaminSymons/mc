// Tests for the site build. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadData } from './lib/data.mjs';
import { chapterDeltas, manifest } from './lib/site.mjs';
import { encodeChapter, decodeChapter } from '../app/codec.js';

const data = loadData();
const deltas = chapterDeltas(data);

test('one payload per chapter, and each round-trips through the codec', () => {
  assert.equal(deltas.length, data.chapters.length);
  for (const d of deltas) assert.deepEqual(decodeChapter(d.ch, encodeChapter(d.ch, d)), d);
});

test('a payload only decodes with its own chapter number', () => {
  const [a] = deltas;
  assert.throws(() => decodeChapter(2, encodeChapter(1, a)));
});

test('encoded payloads contain no readable data text', () => {
  const texts = [
    ...data.chapters.flatMap(c => [c.title, c.recap]),
    ...data.people.flatMap(p => [...p.names.map(n => n.name), ...p.notes.map(n => n.text), ...p.roles.map(r => r.text)]),
    ...data.glossary.map(g => g.term),
  ].filter(t => t.length >= 6);
  const encoded = deltas.map(d => encodeChapter(d.ch, d)).join('\n');
  for (const t of texts) assert.ok(!encoded.includes(t));
  const m = JSON.stringify(manifest(data));
  for (const t of texts) assert.ok(!m.includes(t));
});

test('every tagged entry lands in the payload for its chapter', () => {
  const count = (field, ch) => deltas[ch - 1][field]?.length ?? 0;
  const total = field => deltas.reduce((n, d) => n + (d[field]?.length ?? 0), 0);
  assert.equal(total('notes'), data.people.reduce((n, p) => n + p.notes.length, 0));
  assert.equal(total('roles'), data.people.reduce((n, p) => n + p.roles.length, 0));
  assert.equal(total('names'), data.people.reduce((n, p) => n + p.names.length, 0));
  assert.equal(total('relations'), data.relations.length);
  assert.equal(total('terms'), data.glossary.length);
  for (const p of data.people) {
    const seen = deltas[p.ch - 1].seen.find(s => s.id === p.id && s.how === 'page');
    assert.ok(seen, `page appearance for person index ${data.people.indexOf(p)}`);
    if (p.mentioned) assert.ok(count('seen', p.mentioned) > 0);
  }
});

test('docs/ matches the current data and app (run npm run build if this fails)', () => {
  const docs = path.join(ROOT, 'docs');
  for (const d of deltas) {
    const file = path.join(docs, 'data', `${String(d.ch).padStart(3, '0')}.txt`);
    assert.ok(fs.existsSync(file), `docs/data is missing ch ${d.ch}`);
    assert.equal(fs.readFileSync(file, 'utf8'), encodeChapter(d.ch, d) + '\n', `docs/data ch ${d.ch} is stale`);
  }
  assert.equal(fs.readFileSync(path.join(docs, 'data', 'manifest.json'), 'utf8'), JSON.stringify(manifest(data)) + '\n');
  for (const f of fs.readdirSync(path.join(ROOT, 'app'))) {
    assert.equal(fs.readFileSync(path.join(docs, f), 'utf8'), fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'), `docs/${f} is stale`);
  }
});

test('a later on-page appearance is not announced in an earlier payload', () => {
  for (const p of data.people.filter(x => x.mentioned)) {
    const early = deltas[p.mentioned - 1].seen.find(s => s.id === p.id);
    assert.equal(early.how, 'mentioned');
    assert.ok(!JSON.stringify(deltas[p.mentioned - 1]).includes(`"ch":${p.ch}`));
  }
});
