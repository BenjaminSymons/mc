// Loading and shared helpers for the guide data. Used by the validators and, later, the build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LAST_CHAPTER = 117;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function loadData(root = ROOT) {
  const d = name => readJson(path.join(root, 'data', `${name}.json`));
  return {
    chapters: d('chapters'),
    people: d('people'),
    relations: d('relations'),
    glossary: d('glossary'),
    groups: d('groups'),
    tracks: d('tracks'),
  };
}

// Chapter texts from scripts/split_chapters.py. text[n] is chapter n; text[0] is unused.
export function loadSource(root = ROOT) {
  const dir = path.join(root, 'source', 'chapters');
  const indexFile = path.join(dir, 'index.json');
  if (!fs.existsSync(indexFile)) {
    throw new Error('source/chapters is missing. Run: python scripts/split_chapters.py');
  }
  const index = readJson(indexFile);
  const text = [''];
  for (const { ch } of index) {
    text[ch] = fs.readFileSync(path.join(dir, `${String(ch).padStart(3, '0')}.txt`), 'utf8');
  }
  return { index, text };
}

// First chapter in which the reader meets a person, on the page or by name.
export const firstSeen = p => Math.min(p.ch, p.mentioned ?? Infinity);

// Latest entry at or before chapter ch, from a list sorted by ch.
export function atChapter(list, ch) {
  let found;
  for (const e of list) if (e.ch <= ch) found = e;
  return found;
}

// Case-, accent- and apostrophe-insensitive form used for all name matching.
export const fold = s =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLowerCase();

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word matcher for a name form. Spaces match any run of whitespace, since the
// source text is hard-wrapped.
export function formPattern(form) {
  const body = fold(form).trim().split(/\s+/).map(escape).join('\\s+');
  return new RegExp(`(?<!\\p{L})${body}(?!\\p{L})`, 'u');
}

// Indexes the folded source so first-occurrence lookups are cheap.
export class SourceIndex {
  constructor({ index, text }) {
    this.index = index;
    this.folded = text.map(t => fold(t ?? ''));
    this.cache = new Map();
  }

  // Sorted chapter numbers in which form occurs.
  chaptersWith(form) {
    const key = fold(form);
    if (!this.cache.has(key)) {
      const re = formPattern(form);
      const hits = [];
      for (let ch = 1; ch < this.folded.length; ch++) if (re.test(this.folded[ch])) hits.push(ch);
      this.cache.set(key, hits);
    }
    return this.cache.get(key);
  }

  firstChapter(form) {
    return this.chaptersWith(form)[0] ?? null;
  }

  occursIn(form, ch) {
    return this.chaptersWith(form).includes(ch);
  }
}
