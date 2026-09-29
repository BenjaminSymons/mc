// Validates data/ against itself and the source text. Exits 1 on errors.
//
//   node scripts/validate.mjs            all errors and warnings
//   node scripts/validate.mjs --errors   errors only
//
// Output is spoiler-safe: chapter numbers, ids, field paths and counts only (CLAUDE.md).
import { loadData, loadSource, SourceIndex } from './lib/data.mjs';
import { validate } from './lib/checks.mjs';

const errorsOnly = process.argv.includes('--errors');

const data = loadData();
const report = validate(data, new SourceIndex(loadSource()));

for (const { level, check, where, msg } of report.items) {
  if (errorsOnly && level !== 'error') continue;
  console.log(`${level === 'error' ? 'ERROR' : 'warn '} [${check}] ${where}: ${msg}`);
}

const tally = level => {
  const counts = {};
  for (const i of report.items) if (i.level === level) counts[i.check] = (counts[i.check] ?? 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
};
const verified = data.chapters.filter(c => c.verified).length;
console.log(
  `\n${data.chapters.length} chapters (${verified} verified), ${data.people.length} people, ` +
    `${data.relations.length} relations, ${data.glossary.length} glossary entries`,
);
console.log(`${report.errors.length} errors (${tally('error')})`);
console.log(`${report.warnings.length} warnings (${tally('warning')})`);
process.exit(report.errors.length ? 1 : 0);
