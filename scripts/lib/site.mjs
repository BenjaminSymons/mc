// Turns data/ into one payload per chapter holding only what that chapter adds. The page loads
// and folds together the payloads up to the chosen chapter, so nothing later reaches the browser
// as readable text.
//
// Fields the page does not need (name forms, grounding overrides, "ungrounded" reasons) are left
// out.

export function chapterDeltas(data) {
  const last = data.chapters.length;
  const deltas = data.chapters.map(c => ({
    ch: c.ch,
    chapter: { title: c.title, recap: c.recap, disc: c.disc, track: c.track },
  }));
  const push = (ch, field, value) => {
    if (ch < 1 || ch > last) throw new Error(`entry tagged ch ${ch} is outside chapters 1-${last}`);
    (deltas[ch - 1][field] ??= []).push(value);
  };

  data.groups.forEach((g, order) => {
    push(g.ch, 'groups', { id: g.id, color: g.color, order });
    for (const l of g.labels) push(l.ch, 'labels', { group: g.id, title: l.title, desc: l.desc });
  });

  for (const p of data.people) {
    if (p.mentioned !== undefined) push(p.mentioned, 'seen', { id: p.id, how: 'mentioned' });
    push(p.ch, 'seen', { id: p.id, how: 'page' });
    for (const n of p.names) push(n.ch, 'names', { id: p.id, name: n.name, say: n.say, fr: n.fr, alias: n.alias });
    for (const g of p.groups) push(g.ch, 'personGroups', { id: p.id, group: g.group });
    for (const r of p.roles) push(r.ch, 'roles', { id: p.id, text: r.text });
    for (const n of p.notes) push(n.ch, 'notes', { id: p.id, text: n.text });
  }

  // sameAs may be declared on either card; ship each link once.
  const links = new Set();
  for (const p of data.people) {
    for (const s of p.sameAs ?? []) {
      const key = [p.id, s.id].sort().join('|');
      if (links.has(key)) continue;
      links.add(key);
      push(s.ch, 'sameAs', { a: p.id, b: s.id });
    }
  }

  for (const r of data.relations) push(r.ch, 'relations', { from: r.from, verb: r.verb, to: r.to });

  data.glossary.forEach((g, i) => {
    const key = `g${i}`;
    push(g.ch, 'terms', { key, term: g.term, say: g.say });
    for (const n of g.notes) push(n.ch, 'termNotes', { key, text: n.text });
  });

  return deltas;
}

// Non-spoiler facts the page needs before decoding anything.
export function manifest(data) {
  return {
    last: data.chapters.length,
    tracks: data.chapters.map(c => [c.disc, c.track]),
  };
}
