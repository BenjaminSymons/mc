// Tests for the validators, on small made-up data. Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceIndex } from './lib/data.mjs';
import { validate, normTitle } from './lib/checks.mjs';

const TEXT = [
  '',
  'Chapter 1. Arrival\nAnna meets Bruno at the harbour.',
  'Chapter 2. News\nBruno talks about the Tower.',
  'Chapter 3. Masks\nA stranger in grey. Bruno. The stranger is\nCarla Voss, it turns out. Anna.',
];
const source = () =>
  new SourceIndex({
    index: [
      { ch: 1, title: 'Arrival' },
      { ch: 2, title: 'News' },
      { ch: 3, title: 'Masks' },
    ],
    text: TEXT,
  });

const person = (id, ch, forms, extra = {}) => ({
  id,
  ch,
  names: [{ ch, name: id, say: id, fr: id, alias: [], forms }],
  groups: [{ ch, group: 'main' }],
  roles: [],
  notes: [],
  ...extra,
});

function fixture() {
  return {
    chapters: [1, 2, 3].map((ch, i) => ({
      ch,
      title: ['Arrival', 'News', 'Masks'][i],
      disc: 1,
      track: ch,
      recap: 'Things happen.',
      verified: true,
    })),
    people: [
      person('anna', 1, ['Anna'], { notes: [{ ch: 1, text: 'Meets Bruno.' }] }),
      person('bruno', 1, ['Bruno']),
      person('stranger', 3, []),
    ],
    relations: [{ from: 'anna', verb: 'knows', to: 'bruno', ch: 1 }],
    glossary: [{ ch: 2, term: 'The Tower', say: '', forms: ['Tower'], notes: [{ ch: 2, text: 'A tower.' }] }],
    groups: [{ id: 'main', color: 'red', ch: 1, labels: [{ ch: 1, title: 'Main', desc: '' }] }],
    tracks: { 1: { disc: 1, track: 1 }, 2: { disc: 1, track: 2 }, 3: { disc: 1, track: 3 } },
  };
}

const run = data => validate(data, source());
const errs = (data, check) => run(data).errors.filter(e => !check || e.check === check);

test('a consistent fixture has no errors', () => {
  assert.deepEqual(run(fixture()).errors, []);
});

test('schema: unknown fields, unknown ids and bad chapters are errors', () => {
  const d = fixture();
  d.people[0].nickname = 'x';
  d.relations.push({ from: 'anna', verb: 'likes', to: 'nobody', ch: 1 });
  d.people[1].roles.push({ ch: 200, text: 'x' });
  const e = errs(d, 'schema').map(x => x.msg);
  assert.ok(e.includes('unknown field "nickname"'));
  assert.ok(e.includes('"to" is an unknown id'));
  assert.ok(e.some(m => m.includes('"ch" should be ch')));
});

test('schema: people first seen from ch 21 need neutral ids, and the id is not printed', () => {
  const d = fixture();
  d.people.push(person('secretname', 21, []));
  const e = errs(d, 'schema');
  assert.ok(e.some(x => x.msg.includes('must be neutral')));
  assert.ok(e.every(x => !`${x.where} ${x.msg}`.includes('secretname')));
});

test('titles: dash and colon styles compare equal; wrong titles and tracks are errors', () => {
  assert.equal(normTitle('Marseilles—The Arrival'), normTitle('Marseilles: The Arrival'));
  assert.equal(normTitle('Marseilles - The Arrival'), normTitle('Marseilles—The Arrival'));
  const d = fixture();
  d.chapters[1].title = 'Rumours';
  d.chapters[2].disc = 2;
  assert.equal(errs(d, 'titles').length, 2);
});

test('gating: notes, relations and names before the person is seen are errors', () => {
  const d = fixture();
  d.people[2].notes.push({ ch: 2, text: 'Lurks.' });
  d.relations.push({ from: 'anna', verb: 'fears', to: 'stranger', ch: 2 });
  assert.equal(errs(d, 'gating').length, 2);
});

test('gating: before a sameAs link, neither card names the other', () => {
  const d = fixture();
  d.people.push(person('carla', 3, ['Carla Voss']));
  d.people[2].sameAs = [{ ch: 3, id: 'carla' }];
  d.people[2].names[0].forms = [];
  // Allowed: named on the day of the link.
  d.people[2].notes.push({ ch: 3, text: 'Is Carla Voss.' });
  assert.deepEqual(errs(d, 'gating'), []);
  // Link moved later: the ch 3 note now gives it away.
  d.chapters.push({ ch: 4, title: 'x', disc: 1, track: 4, recap: 'x', verified: false });
  d.people[2].sameAs[0].ch = 4;
  assert.ok(errs(d, 'gating').some(e => e.where.includes('people.stranger.notes[0]')));
});

test('leaks: text tagged before a form is revealed is an error', () => {
  const d = fixture();
  d.people[0].notes.push({ ch: 2, text: 'Thinks of carla voss.' }); // case and spacing differ
  d.people.push(person('carla', 3, ['Carla Voss']));
  d.groups[0].labels[0].desc = 'Near the tower.'; // glossary form, revealed ch 2
  const e = errs(d, 'leaks').map(x => x.where);
  assert.deepEqual(e.sort(), ['groups.main.labels[0].desc (ch 1)', 'people.anna.notes[1] (ch 2)']);
});

test('leaks: accents and curly apostrophes do not hide a name', () => {
  const d = fixture();
  d.people.push(person('carla', 3, ['Carla Voss']));
  d.chapters[0].recap = 'Cárla Vöss’s ship.';
  assert.equal(errs(d, 'leaks').length, 1);
});

test('grounding: forms must first occur in the chapter the data reveals them', () => {
  const d = fixture();
  d.people[1] = person('bruno', 2, ['Bruno']); // text has Bruno in ch 1
  d.relations = [];
  d.people[0].notes = [];
  assert.ok(errs(d, 'grounding').some(e => e.msg.includes('text has this form earlier (ch 1)')));

  d.people[1].grounding = [{ form: 'Bruno', textCh: 1, reason: 'Mentioned in passing.' }];
  assert.deepEqual(errs(d, 'grounding'), []);

  d.people[1].grounding[0].textCh = 3;
  assert.ok(errs(d, 'grounding').some(e => e.msg.startsWith('stale override')));
});

test('grounding: a form the data reveals before the text is an error, as is a missing one', () => {
  const d = fixture();
  d.people.push(person('carla', 2, ['Carla Voss', 'Nobody Here']));
  const e = errs(d, 'grounding').map(x => x.msg);
  assert.ok(e.includes('data reveals this form before the text does (text: ch 3)'));
  assert.ok(e.includes('form does not occur in the source'));
});

test('grounding: glossary entries may not precede the text', () => {
  const d = fixture();
  d.glossary[0].ch = 1;
  d.glossary[0].notes[0].ch = 1;
  assert.equal(errs(d, 'grounding').length, 1);
});

test('note grounding warns when a named person is absent from that chapter', () => {
  const d = fixture();
  d.people[0].notes.push({ ch: 2, text: 'Waits for Bruno.' });
  const w = run(d).warnings.filter(x => x.check === 'notes');
  assert.deepEqual(w.map(x => x.where), ['people.anna.notes[1] (ch 2)']);
  d.people[0].notes[1].ungrounded = 'Anna is only thought of here.';
  assert.equal(run(d).warnings.filter(x => x.check === 'notes').length, 0);
});

test('style: em dashes and straight quotes are errors', () => {
  const d = fixture();
  d.chapters[0].recap = 'Anna arrives—late.';
  d.people[0].notes[0].text = "Meets Bruno's ship.";
  assert.deepEqual(errs(d, 'style').map(e => e.where), ['chapters[0].recap (ch 1)', 'people.anna.notes[0] (ch 1)']);
});

test('output never contains data text, even when everything is wrong', () => {
  const S = 'zqsecret';
  const d = fixture();
  d.chapters[0].recap = `${S} recap`;
  d.chapters[1].title = `${S} title`;
  d.people.push({
    id: `${S}id`,
    ch: 30,
    mentioned: 40,
    names: [{ ch: 29, name: `${S}name`, say: S, fr: S, alias: [`${S}Alias`], forms: [`${S}form`] }],
    groups: [{ ch: 2, group: `${S}group` }],
    roles: [{ ch: 1, text: `${S} role` }],
    notes: [{ ch: 1, text: `${S} note Anna` }],
    sameAs: [{ ch: 1, id: `${S}other` }],
    grounding: [{ form: `${S}x`, textCh: 9, reason: S }],
    [`${S}key`]: 1,
  });
  d.relations.push({ from: `${S}a`, verb: `${S} verb`, to: `${S}b`, ch: 1 });
  d.glossary.push({ ch: 1, term: S, say: S, forms: [`${S}g`], notes: [{ ch: 1, text: S }] });
  d.groups.push({ id: `${S}grp`, color: S, ch: 25, labels: [{ ch: 25, title: S, desc: S }] });
  d.people[0].notes.push({ ch: 1, text: `${S}form ${S}g` });

  const r = run(d);
  assert.ok(r.errors.length > 10);
  for (const item of r.items) {
    const line = `${item.where} ${item.msg}`.toLowerCase();
    // Field names are schema, not data; the test's sentinel key is the one allowed echo.
    assert.ok(!line.replace(`"${S}key"`, '').includes(S), line);
  }
});
