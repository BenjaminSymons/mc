// Validation checks for the guide data. See CLAUDE.md, "Validation".
//
// Output rule: messages carry chapter numbers, ids, field paths and counts only. Never data
// text, names or forms. Ids are printed only when they are safe (see personLabel/groupLabel);
// anything else is referred to by array index.
import { LAST_CHAPTER, firstSeen, fold, formPattern } from './data.mjs';

// People and groups first seen from this chapter must use neutral ids (p021, g001...).
export const NEUTRAL_FROM = 21;
const PERSON_ID = /^[a-z][a-z0-9]*$/;
const NEUTRAL_PERSON_ID = /^p\d{3}$/;
const NEUTRAL_GROUP_ID = /^g\d{3}$/;

export class Report {
  constructor() {
    this.items = [];
  }
  error(check, where, msg) {
    this.items.push({ level: 'error', check, where, msg });
  }
  warn(check, where, msg) {
    this.items.push({ level: 'warning', check, where, msg });
  }
  get errors() {
    return this.items.filter(i => i.level === 'error');
  }
  get warnings() {
    return this.items.filter(i => i.level === 'warning');
  }
}

// ---------------------------------------------------------------------------------------------
// Context: lookups shared by the checks.

function buildContext(data, source) {
  const people = Array.isArray(data.people) ? data.people : [];
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const byId = new Map();
  people.forEach((p, i) => {
    if (p && typeof p.id === 'string' && !byId.has(p.id)) byId.set(p.id, { p, i });
  });
  const groupById = new Map();
  groups.forEach((g, i) => {
    if (g && typeof g.id === 'string' && !groupById.has(g.id)) groupById.set(g.id, { g, i });
  });

  const safePersonId = p =>
    typeof p.id === 'string' &&
    PERSON_ID.test(p.id) &&
    (NEUTRAL_PERSON_ID.test(p.id) || (Number.isInteger(p.ch) && firstSeen(p) < NEUTRAL_FROM));
  const safeGroupId = g =>
    typeof g.id === 'string' &&
    PERSON_ID.test(g.id) &&
    (NEUTRAL_GROUP_ID.test(g.id) || (Number.isInteger(g.ch) && g.ch < NEUTRAL_FROM));

  const personPath = i => (safePersonId(people[i]) ? `people.${people[i].id}` : `people[${i}]`);
  const groupPath = i => (safeGroupId(groups[i]) ? `groups.${groups[i].id}` : `groups[${i}]`);
  // Label for a referenced id (relation end, sameAs target...). Unknown ids are never echoed.
  const personRef = id => {
    const hit = byId.get(id);
    return hit ? personPath(hit.i) : 'an unknown id';
  };
  const groupRef = id => {
    const hit = groupById.get(id);
    return hit ? groupPath(hit.i) : 'an unknown group';
  };

  return { data, source, people, groups, byId, groupById, personPath, groupPath, personRef, groupRef };
}

const at = (where, ch) => (Number.isInteger(ch) ? `${where} (ch ${ch})` : where);

// ---------------------------------------------------------------------------------------------
// 1. Schema

const isCh = v => Number.isInteger(v) && v >= 1 && v <= LAST_CHAPTER;
const TYPES = {
  ch: isCh,
  int: Number.isInteger,
  text: v => typeof v === 'string' && v.trim() !== '',
  string: v => typeof v === 'string',
  bool: v => typeof v === 'boolean',
  array: Array.isArray,
  texts: v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== ''),
  chOrNull: v => v === null || isCh(v),
};

// spec: { key: type } with a trailing "?" on optional keys. Returns true if the object is usable.
function shape(r, where, obj, spec) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    r.error('schema', where, 'not an object');
    return false;
  }
  let ok = true;
  const known = new Set();
  for (const [rawKey, type] of Object.entries(spec)) {
    const optional = rawKey.endsWith('?');
    const key = optional ? rawKey.slice(0, -1) : rawKey;
    known.add(key);
    if (!(key in obj)) {
      if (!optional) {
        r.error('schema', where, `missing field "${key}"`);
        ok = false;
      }
      continue;
    }
    if (!TYPES[type](obj[key])) {
      r.error('schema', where, `field "${key}" should be ${type}`);
      ok = false;
    }
  }
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) r.error('schema', where, `unknown field "${key}"`);
  }
  return ok;
}

function nonDecreasing(r, where, list, strict = false) {
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]?.ch;
    const b = list[i]?.ch;
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (strict ? b <= a : b < a) {
      r.error('schema', `${where}[${i}]`, strict ? 'chapters must strictly increase' : 'entries out of chapter order');
    }
  }
}

function eachShape(r, where, list, spec) {
  if (!Array.isArray(list)) return false;
  let ok = true;
  list.forEach((e, i) => {
    ok = shape(r, `${where}[${i}]`, e, spec) && ok;
  });
  return ok;
}

export function checkSchema(ctx, r) {
  const { data, people, groups } = ctx;
  for (const key of ['chapters', 'people', 'relations', 'glossary', 'groups']) {
    if (!Array.isArray(data[key])) r.error('schema', key, 'should be an array');
  }
  if (!data.tracks || typeof data.tracks !== 'object') r.error('schema', 'tracks', 'should be an object');

  // Chapters: contiguous from 1.
  (data.chapters ?? []).forEach((c, i) => {
    shape(r, `chapters[${i}]`, c, { ch: 'ch', title: 'text', disc: 'int', track: 'int', recap: 'text', verified: 'bool' });
    if (c?.ch !== i + 1) r.error('schema', `chapters[${i}]`, `expected ch ${i + 1}`);
  });

  // Groups.
  const seenGroups = new Set();
  groups.forEach((g, i) => {
    const where = ctx.groupPath(i);
    if (!shape(r, where, g, { id: 'text', color: 'text', ch: 'ch', labels: 'array' })) return;
    if (!PERSON_ID.test(g.id)) r.error('schema', where, 'id should be lowercase letters and digits');
    if (seenGroups.has(g.id)) r.error('schema', where, 'duplicate id');
    seenGroups.add(g.id);
    if (g.ch >= NEUTRAL_FROM && !NEUTRAL_GROUP_ID.test(g.id)) {
      r.error('schema', `groups[${i}]`, `first seen from ch ${NEUTRAL_FROM}; id must be neutral (g001...)`);
    }
    eachShape(r, `${where}.labels`, g.labels, { ch: 'ch', title: 'text', desc: 'string' });
    nonDecreasing(r, `${where}.labels`, g.labels, true);
    if (!g.labels.length) r.error('schema', `${where}.labels`, 'needs at least one label');
  });

  // People.
  const seenIds = new Set();
  people.forEach((p, i) => {
    const where = ctx.personPath(i);
    const ok = shape(r, where, p, {
      id: 'text', ch: 'ch', 'mentioned?': 'ch', names: 'array', groups: 'array',
      roles: 'array', notes: 'array', 'sameAs?': 'array', 'grounding?': 'array',
    });
    if (!ok) return;
    if (!PERSON_ID.test(p.id)) r.error('schema', where, 'id should be lowercase letters and digits');
    if (seenIds.has(p.id)) r.error('schema', where, 'duplicate id');
    seenIds.add(p.id);
    if (firstSeen(p) >= NEUTRAL_FROM && !NEUTRAL_PERSON_ID.test(p.id)) {
      r.error('schema', `people[${i}]`, `first seen from ch ${NEUTRAL_FROM}; id must be neutral (p021...)`);
    }
    if (eachShape(r, `${where}.names`, p.names, { ch: 'ch', name: 'text', say: 'string', fr: 'string', alias: 'texts', forms: 'texts' })) {
      p.names.forEach((n, k) => {
        if (n.alias.some(a => a !== a.toLowerCase())) r.error('schema', `${where}.names[${k}].alias`, 'search terms should be lower case');
      });
    }
    if (!p.names.length) r.error('schema', `${where}.names`, 'needs at least one entry');
    nonDecreasing(r, `${where}.names`, p.names, true);
    eachShape(r, `${where}.groups`, p.groups, { ch: 'ch', group: 'text' });
    if (!p.groups.length) r.error('schema', `${where}.groups`, 'needs at least one entry');
    nonDecreasing(r, `${where}.groups`, p.groups, true);
    p.groups.forEach((e, k) => {
      if (e && typeof e.group === 'string' && !ctx.groupById.has(e.group)) {
        r.error('schema', `${where}.groups[${k}]`, 'unknown group');
      }
    });
    eachShape(r, `${where}.roles`, p.roles, { ch: 'ch', text: 'text' });
    nonDecreasing(r, `${where}.roles`, p.roles);
    eachShape(r, `${where}.notes`, p.notes, { ch: 'ch', text: 'text', 'ungrounded?': 'text' });
    nonDecreasing(r, `${where}.notes`, p.notes);
    if (p.sameAs) {
      eachShape(r, `${where}.sameAs`, p.sameAs, { ch: 'ch', id: 'text' });
      p.sameAs.forEach((s, k) => {
        if (typeof s?.id !== 'string') return;
        if (!ctx.byId.has(s.id)) r.error('schema', `${where}.sameAs[${k}]`, 'unknown id');
        if (s.id === p.id) r.error('schema', `${where}.sameAs[${k}]`, 'points at itself');
      });
    }
    if (p.grounding) eachShape(r, `${where}.grounding`, p.grounding, { form: 'text', textCh: 'chOrNull', reason: 'text' });
  });

  // Relations.
  (data.relations ?? []).forEach((rel, i) => {
    if (!shape(r, `relations[${i}]`, rel, { from: 'text', verb: 'text', to: 'text', ch: 'ch' })) return;
    if (!ctx.byId.has(rel.from)) r.error('schema', `relations[${i}]`, '"from" is an unknown id');
    if (!ctx.byId.has(rel.to)) r.error('schema', `relations[${i}]`, '"to" is an unknown id');
    if (rel.from === rel.to) r.error('schema', `relations[${i}]`, 'relation to itself');
  });

  // Glossary.
  (data.glossary ?? []).forEach((g, i) => {
    const where = `glossary[${i}]`;
    if (!shape(r, where, g, { ch: 'ch', term: 'text', say: 'string', forms: 'texts', notes: 'array' })) return;
    eachShape(r, `${where}.notes`, g.notes, { ch: 'ch', text: 'text' });
    if (!g.notes.length) r.error('schema', `${where}.notes`, 'needs at least one entry');
    nonDecreasing(r, `${where}.notes`, g.notes);
  });

  // Everything tagged must fall within the chapters that exist in chapters.json.
  const lastWritten = (data.chapters ?? []).length;
  for (const t of taggedTexts(ctx)) {
    if (Number.isInteger(t.ch) && t.ch > lastWritten) {
      r.error('schema', at(t.where, t.ch), `tagged beyond the last chapter in chapters.json (${lastWritten})`);
    }
  }

  const used = new Set(people.flatMap(p => (Array.isArray(p?.groups) ? p.groups.map(e => e?.group) : [])));
  groups.forEach((g, i) => {
    if (g && !used.has(g.id)) r.warn('schema', ctx.groupPath(i), 'group has no members');
  });
}

// ---------------------------------------------------------------------------------------------
// Every piece of text that is shown for a chapter, with where it lives. Used by the leak and
// gating checks. `owner` is the person whose card shows it, if any.

export function* taggedTexts(ctx) {
  const { data, people, groups } = ctx;
  for (const [i, c] of (data.chapters ?? []).entries()) {
    if (typeof c?.recap === 'string') yield { where: `chapters[${i}].recap`, ch: c.ch, text: c.recap, kind: 'recap' };
  }
  for (const [i, p] of people.entries()) {
    if (!p) continue;
    const base = ctx.personPath(i);
    for (const [k, n] of (Array.isArray(p.names) ? p.names : []).entries()) {
      if (!n) continue;
      const w = `${base}.names[${k}]`;
      if (typeof n.name === 'string') yield { where: `${w}.name`, ch: n.ch, text: n.name, owner: p.id };
      if (typeof n.fr === 'string') yield { where: `${w}.fr`, ch: n.ch, text: n.fr, owner: p.id };
      if (typeof n.say === 'string') yield { where: `${w}.say`, ch: n.ch, text: n.say, owner: p.id };
      for (const [j, a] of (Array.isArray(n.alias) ? n.alias : []).entries()) {
        if (typeof a === 'string') yield { where: `${w}.alias[${j}]`, ch: n.ch, text: a, owner: p.id };
      }
    }
    for (const field of ['roles', 'notes']) {
      for (const [k, e] of (Array.isArray(p[field]) ? p[field] : []).entries()) {
        if (typeof e?.text === 'string') {
          yield { where: `${base}.${field}[${k}]`, ch: e.ch, text: e.text, owner: p.id, kind: field, entry: e };
        }
      }
    }
  }
  for (const [i, rel] of (data.relations ?? []).entries()) {
    if (typeof rel?.verb === 'string') yield { where: `relations[${i}]`, ch: rel.ch, text: rel.verb };
  }
  for (const [i, g] of (data.glossary ?? []).entries()) {
    if (!g) continue;
    if (typeof g.term === 'string') yield { where: `glossary[${i}].term`, ch: g.ch, text: g.term };
    if (typeof g.say === 'string') yield { where: `glossary[${i}].say`, ch: g.ch, text: g.say };
    for (const [k, e] of (Array.isArray(g.notes) ? g.notes : []).entries()) {
      if (typeof e?.text === 'string') yield { where: `glossary[${i}].notes[${k}]`, ch: e.ch, text: e.text };
    }
  }
  for (const [i, g] of groups.entries()) {
    for (const [k, l] of (Array.isArray(g?.labels) ? g.labels : []).entries()) {
      const w = `${ctx.groupPath(i)}.labels[${k}]`;
      if (typeof l?.title === 'string') yield { where: `${w}.title`, ch: l.ch, text: l.title };
      if (typeof l?.desc === 'string') yield { where: `${w}.desc`, ch: l.ch, text: l.desc };
    }
  }
}

// Every name form, with the chapter the data reveals it and who it belongs to.
function formRegistry(ctx) {
  const forms = new Map(); // folded form -> { pattern, reveal, owners: Set<id> , ownerCh: Map<id, ch> }
  const add = (form, ch, owner) => {
    if (typeof form !== 'string' || !form.trim() || !Number.isInteger(ch)) return;
    const key = fold(form).trim();
    let f = forms.get(key);
    if (!f) forms.set(key, (f = { pattern: formPattern(form), reveal: ch, owners: new Map() }));
    f.reveal = Math.min(f.reveal, ch);
    if (owner) f.owners.set(owner, Math.min(f.owners.get(owner) ?? Infinity, ch));
  };
  for (const p of ctx.people) {
    for (const n of Array.isArray(p?.names) ? p.names : []) {
      for (const form of Array.isArray(n?.forms) ? n.forms : []) add(form, n.ch, p.id);
    }
  }
  for (const g of ctx.data.glossary ?? []) {
    for (const form of Array.isArray(g?.forms) ? g.forms : []) add(form, g.ch, null);
  }
  return forms;
}

// Person ids whose forms (revealed by chapter ch) appear in text.
function peopleNamedIn(registry, text, ch) {
  const folded = fold(text);
  const ids = new Set();
  for (const f of registry.values()) {
    if (!f.pattern.test(folded)) continue;
    for (const [id, revealed] of f.owners) if (revealed <= ch) ids.add(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------
// 2. Internal gating

export function checkGating(ctx, r) {
  const { people, data } = ctx;
  const seen = id => {
    const hit = ctx.byId.get(id);
    return hit && Number.isInteger(hit.p.ch) ? firstSeen(hit.p) : null;
  };

  people.forEach((p, i) => {
    if (!p || !Number.isInteger(p.ch)) return;
    const where = ctx.personPath(i);
    const first = firstSeen(p);
    if (p.mentioned !== undefined && !(p.mentioned < p.ch)) {
      r.error('gating', where, '"mentioned" must be earlier than "ch"');
    }
    const lists = { names: p.names, groups: p.groups, roles: p.roles, notes: p.notes };
    for (const [field, list] of Object.entries(lists)) {
      if (!Array.isArray(list)) continue;
      list.forEach((e, k) => {
        if (Number.isInteger(e?.ch) && e.ch < first) {
          r.error('gating', at(`${where}.${field}[${k}]`, e.ch), `before the person is seen (ch ${first})`);
        }
      });
    }
    for (const field of ['names', 'groups']) {
      const e0 = Array.isArray(p[field]) ? p[field][0] : null;
      if (Number.isInteger(e0?.ch) && e0.ch !== first) {
        r.error('gating', at(`${where}.${field}[0]`, e0.ch), `first entry must be at ch ${first}`);
      }
    }
    (Array.isArray(p.groups) ? p.groups : []).forEach((e, k) => {
      const g = ctx.groupById.get(e?.group)?.g;
      if (g && Number.isInteger(g.ch) && Number.isInteger(e.ch) && e.ch < g.ch) {
        r.error('gating', at(`${where}.groups[${k}]`, e.ch), `${ctx.groupRef(e.group)} is not shown until ch ${g.ch}`);
      }
    });
    (Array.isArray(p.sameAs) ? p.sameAs : []).forEach((s, k) => {
      const other = seen(s?.id);
      if (other === null || !Number.isInteger(s.ch)) return;
      if (s.ch < first || s.ch < other) {
        r.error('gating', at(`${where}.sameAs[${k}]`, s.ch), `before both people are seen (ch ${Math.max(first, other)})`);
      }
      const back = ctx.byId.get(s.id).p.sameAs?.find(b => b?.id === p.id);
      if (back && back.ch !== s.ch) {
        r.error('gating', at(`${where}.sameAs[${k}]`, s.ch), `${ctx.personRef(s.id)} declares the same link at ch ${back.ch}`);
      }
    });
  });

  (data.relations ?? []).forEach((rel, i) => {
    if (!rel || !Number.isInteger(rel.ch)) return;
    for (const end of ['from', 'to']) {
      const s = seen(rel[end]);
      if (s !== null && rel.ch < s) {
        r.error('gating', at(`relations[${i}]`, rel.ch), `"${end}" (${ctx.personRef(rel[end])}) is not seen until ch ${s}`);
      }
    }
  });

  (data.glossary ?? []).forEach((g, i) => {
    const n0 = Array.isArray(g?.notes) ? g.notes[0] : null;
    if (Number.isInteger(n0?.ch) && n0.ch !== g.ch) {
      r.error('gating', at(`glossary[${i}].notes[0]`, n0.ch), `first note must be at ch ${g.ch}`);
    }
    (Array.isArray(g?.notes) ? g.notes : []).forEach((e, k) => {
      if (Number.isInteger(e?.ch) && e.ch < g.ch) r.error('gating', at(`glossary[${i}].notes[${k}]`, e.ch), `before the entry (ch ${g.ch})`);
    });
  });

  ctx.groups.forEach((g, i) => {
    const l0 = Array.isArray(g?.labels) ? g.labels[0] : null;
    if (Number.isInteger(l0?.ch) && l0.ch !== g.ch) {
      r.error('gating', at(`${ctx.groupPath(i)}.labels[0]`, l0.ch), `first label must be at ch ${g.ch}`);
    }
  });

  // Cards later revealed as linked: before the link, neither card's text may name the other.
  const registry = formRegistry(ctx);
  const links = [];
  for (const p of people) {
    for (const s of Array.isArray(p?.sameAs) ? p.sameAs : []) {
      if (ctx.byId.has(s?.id) && Number.isInteger(s.ch)) links.push({ a: p.id, b: s.id, ch: s.ch });
    }
  }
  if (links.length) {
    for (const t of taggedTexts(ctx)) {
      if (!t.owner || !Number.isInteger(t.ch)) continue;
      const named = peopleNamedIn(registry, t.text, t.ch);
      for (const { a, b, ch } of links) {
        const other = t.owner === a ? b : t.owner === b ? a : null;
        if (other && t.ch < ch && named.has(other)) {
          r.error('gating', at(t.where, t.ch), `names ${ctx.personRef(other)} before the two are linked (ch ${ch})`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Grounding of first appearances

export function checkGrounding(ctx, r) {
  const { source } = ctx;
  ctx.people.forEach((p, i) => {
    if (!p || !Array.isArray(p.names)) return;
    const where = ctx.personPath(i);
    const overrides = new Map();
    (Array.isArray(p.grounding) ? p.grounding : []).forEach((o, k) => {
      if (typeof o?.form === 'string') overrides.set(fold(o.form), { o, k, used: false });
    });
    const earlier = new Set();
    p.names.forEach((n, k) => {
      if (!Number.isInteger(n?.ch) || !Array.isArray(n.forms)) return;
      n.forms.forEach((form, j) => {
        if (typeof form !== 'string') return;
        const key = fold(form);
        if (earlier.has(key)) return;
        earlier.add(key);
        const actual = source.firstChapter(form);
        const o = overrides.get(key);
        if (o) o.used = true;
        if (actual === n.ch) {
          if (o) r.error('grounding', `${where}.grounding[${o.k}]`, 'override not needed');
          return;
        }
        if (o && o.o.textCh === actual) return;
        const w = at(`${where}.names[${k}].forms[${j}]`, n.ch);
        if (o) r.error('grounding', `${where}.grounding[${o.k}]`, `stale override: text first has this form in ${actual === null ? 'no chapter' : `ch ${actual}`}`);
        else if (actual === null) r.error('grounding', w, 'form does not occur in the source');
        else if (actual > n.ch) r.error('grounding', w, `data reveals this form before the text does (text: ch ${actual})`);
        else r.error('grounding', w, `text has this form earlier (ch ${actual}); fix the chapter or add a grounding override`);
      });
    });
    for (const o of overrides.values()) {
      if (!o.used) r.error('grounding', `${where}.grounding[${o.k}]`, 'override matches no form');
    }
  });

  (ctx.data.glossary ?? []).forEach((g, i) => {
    if (!Number.isInteger(g?.ch) || !Array.isArray(g.forms)) return;
    g.forms.forEach((form, j) => {
      if (typeof form !== 'string') return;
      const actual = source.firstChapter(form);
      const w = at(`glossary[${i}].forms[${j}]`, g.ch);
      if (actual === null) r.error('grounding', w, 'form does not occur in the source');
      else if (actual > g.ch) r.error('grounding', w, `entry shown before the text uses the term (text: ch ${actual})`);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Name leaks: text tagged N must not contain a form the data only reveals after N.

export function checkLeaks(ctx, r) {
  const registry = formRegistry(ctx);
  for (const t of taggedTexts(ctx)) {
    const ch = Number.isInteger(t.ch) ? t.ch : 1; // untagged text counts as chapter 1
    const folded = fold(t.text);
    for (const f of registry.values()) {
      if (f.reveal > ch && f.pattern.test(folded)) {
        const owners = [...f.owners.keys()].map(ctx.personRef);
        const whose = owners.length ? `a form of ${owners.join(', ')}` : 'a glossary form';
        r.error('leaks', at(t.where, ch), `contains ${whose} revealed in ch ${f.reveal}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Note grounding (warnings): people named in a note or recap for chapter N are named in
// chapter N's text. A note can say why not with "ungrounded".

export function checkNoteGrounding(ctx, r) {
  const registry = formRegistry(ctx);
  const formsBy = id => {
    const p = ctx.byId.get(id)?.p;
    return (Array.isArray(p?.names) ? p.names : []).flatMap(n =>
      (Array.isArray(n?.forms) ? n.forms : []).map(form => ({ form, ch: n.ch })),
    );
  };
  for (const t of taggedTexts(ctx)) {
    if (t.kind !== 'notes' && t.kind !== 'recap') continue;
    if (!Number.isInteger(t.ch) || t.entry?.ungrounded) continue;
    const ids = peopleNamedIn(registry, t.text, t.ch);
    if (t.owner) ids.add(t.owner);
    for (const id of ids) {
      const forms = formsBy(id).filter(f => f.ch <= t.ch);
      if (!forms.length) continue;
      if (!forms.some(f => ctx.source.occursIn(f.form, t.ch))) {
        r.warn('notes', at(t.where, t.ch), `${ctx.personRef(id)} is not named in the chapter text`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Titles, discs and tracks

export const normTitle = s =>
  s
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/\s*[—–:]\s*|\s+-\s+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

export function checkTitles(ctx, r) {
  const index = new Map((ctx.source.index ?? []).map(e => [e.ch, e.title]));
  (ctx.data.chapters ?? []).forEach((c, i) => {
    if (!Number.isInteger(c?.ch)) return;
    const where = `chapters[${i}]`;
    const expected = index.get(c.ch);
    if (expected === undefined) r.error('titles', at(where, c.ch), 'no such chapter in source index');
    else if (typeof c.title === 'string' && normTitle(c.title) !== normTitle(expected)) {
      r.error('titles', at(where, c.ch), 'title does not match the source');
    }
    const t = ctx.data.tracks?.[String(c.ch)];
    if (!t) r.error('titles', at(where, c.ch), 'no disc/track in tracks.json');
    else if (t.disc !== c.disc || t.track !== c.track) r.error('titles', at(where, c.ch), 'disc/track differ from tracks.json');
  });
}

// ---------------------------------------------------------------------------------------------
// 7. House style: no em dashes, curly quotes only.

export function checkStyle(ctx, r) {
  const texts = [...taggedTexts(ctx)];
  (ctx.data.chapters ?? []).forEach((c, i) => {
    if (typeof c?.title === 'string') texts.push({ where: `chapters[${i}].title`, ch: c.ch, text: c.title });
  });
  for (const t of texts) {
    if (t.text.includes('—')) r.error('style', at(t.where, t.ch), 'contains an em dash; use a plain hyphen or recast');
    if (/['"]/.test(t.text)) r.error('style', at(t.where, t.ch), 'contains a straight quote; use ’ “ ”');
  }
}

// ---------------------------------------------------------------------------------------------

export const CHECKS = [checkSchema, checkGating, checkGrounding, checkLeaks, checkNoteGrounding, checkTitles, checkStyle];

// source: { index, text: SourceIndex-compatible } — see validate.mjs.
export function validate(data, source) {
  const r = new Report();
  const ctx = buildContext(data, source);
  for (const check of CHECKS) check(ctx, r);
  return r;
}
