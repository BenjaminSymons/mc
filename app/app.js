// Monte Cristo listening companion. Loads the per-chapter payloads up to the chosen chapter,
// folds them into one state and renders it. Nothing past the chosen chapter is decoded.
import { decodeChapter } from './codec.js';

const STORE_KEY = 'mc-ch';
const $ = id => document.getElementById(id);
const last = list => list[list.length - 1];
const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let manifest = null;
let sel = 1;
let query = '';
let onlyThis = false;
let state = null;
let renderToken = 0;
const pending = []; // pending[ch]: Promise of that chapter's decoded payload

// ---------------------------------------------------------------------------------------------
// Loading

function loadChapter(ch) {
  pending[ch] ??= fetch(`data/${String(ch).padStart(3, '0')}.txt`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(text => decodeChapter(ch, text))
    .catch(err => {
      pending[ch] = undefined; // allow a retry
      throw err;
    });
  return pending[ch];
}

async function loadUpTo(n) {
  return Promise.all(Array.from({ length: n }, (_, i) => loadChapter(i + 1)));
}

// Fold payloads 1..n into lists; every entry keeps the chapter it came from.
function fold(payloads) {
  const s = { chapters: [], people: new Map(), groups: new Map(), relations: [], terms: new Map() };
  const person = id => {
    if (!s.people.has(id)) {
      s.people.set(id, { id, pageCh: null, mentionedCh: null, names: [], groups: [], roles: [], notes: [], same: [] });
    }
    return s.people.get(id);
  };
  for (const d of payloads) {
    const ch = d.ch;
    s.chapters[ch] = d.chapter;
    for (const g of d.groups ?? []) s.groups.set(g.id, { ...g, labels: [] });
    for (const l of d.labels ?? []) s.groups.get(l.group)?.labels.push({ ch, title: l.title, desc: l.desc });
    for (const e of d.seen ?? []) person(e.id)[e.how === 'page' ? 'pageCh' : 'mentionedCh'] = ch;
    for (const e of d.names ?? []) person(e.id).names.push({ ch, name: e.name, say: e.say, fr: e.fr, alias: e.alias });
    for (const e of d.personGroups ?? []) person(e.id).groups.push({ ch, group: e.group });
    for (const e of d.roles ?? []) person(e.id).roles.push({ ch, text: e.text });
    for (const e of d.notes ?? []) person(e.id).notes.push({ ch, text: e.text });
    for (const e of d.sameAs ?? []) {
      person(e.a).same.push({ ch, id: e.b });
      person(e.b).same.push({ ch, id: e.a });
    }
    for (const e of d.relations ?? []) s.relations.push({ ch, ...e });
    for (const e of d.terms ?? []) s.terms.set(e.key, { ch, term: e.term, say: e.say, notes: [] });
    for (const e of d.termNotes ?? []) s.terms.get(e.key)?.notes.push({ ch, text: e.text });
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Sound-alike search: substring first, then Levenshtein distance on single words.

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ');

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function soundsLike(haystacks, q) {
  const qn = norm(q).replace(/ /g, '');
  if (!qn) return true;
  const hay = haystacks.map(norm);
  if (hay.some(h => h.replace(/ /g, '').includes(qn))) return true;
  if (qn.length < 4) return false;
  const tol = qn.length > 7 ? 3 : 2;
  return hay.join(' ').split(' ').filter(Boolean).some(t => lev(t, qn) <= tol);
}

const personMatches = p =>
  !query || soundsLike(p.names.flatMap(n => [n.name, n.say.replace(/-/g, ''), ...n.alias]), query);
const termMatches = t => !query || soundsLike([t.term, t.say.replace(/-/g, '')], query);

// ---------------------------------------------------------------------------------------------
// Speech

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let frVoice = null;
function pickVoice() {
  frVoice = synth?.getVoices().find(v => /^fr/i.test(v.lang)) ?? null;
}
if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}
function speak(text) {
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.rate = 0.85;
  if (frVoice) u.voice = frVoice;
  synth.speak(u);
}
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>';

// ---------------------------------------------------------------------------------------------
// Rendering

const nameOf = id => last(state.people.get(id).names).name;
const groupOf = p => last(p.groups).group;
const colourOf = id => state.groups.get(groupOf(state.people.get(id)))?.color ?? 'var(--ink)';
const link = id =>
  `<a href="#p-${esc(id)}" style="--g:${esc(colourOf(id))}" data-jump="${esc(id)}">${esc(nameOf(id))}</a>`;

function inThisChapter(p) {
  return (
    p.pageCh === sel ||
    p.mentionedCh === sel ||
    [p.names, p.groups, p.roles, p.notes, p.same].some(list => list.some(e => e.ch === sel))
  );
}

function card(p) {
  const n = last(p.names);
  const earlier = [...new Set(p.names.map(x => x.name))].filter(x => x !== n.name);
  const role = last(p.roles)?.text ?? '';
  let badge = '';
  if (p.pageCh === sel) badge = `<span class="new">New in chapter ${sel}</span>`;
  else if (p.pageCh === null && p.mentionedCh === sel) badge = `<span class="new">First mentioned in chapter ${sel}</span>`;
  const hear = synth && n.fr ? `<button class="say" data-say="${esc(n.fr)}" aria-label="Hear ${esc(n.name)}">${ICON}Hear</button>` : '';
  return `<article class="card" id="p-${esc(p.id)}">
    ${badge}
    <div class="top"><h3>${esc(n.name)}</h3>${hear}</div>
    ${n.say ? `<p class="pron">${esc(n.say)}</p>` : ''}
    ${role ? `<p class="role">${esc(role)}</p>` : ''}
    ${earlier.length ? `<p class="aka">Earlier called ${earlier.map(esc).join(', ')}</p>` : ''}
    ${p.same.map(s => `<p class="same">Same person as ${link(s.id)}</p>`).join('')}
    ${p.pageCh === null ? '<p class="only">Mentioned only so far.</p>' : ''}
    <ul class="notes">${p.notes
      .map(e => `<li class="${e.ch === sel ? 'now' : ''}"><span class="tag">Ch ${e.ch}</span><span>${esc(e.text)}</span></li>`)
      .join('')}</ul>
  </article>`;
}

function renderPicker() {
  const select = $('chsel');
  if (!select.options.length) {
    // Group by tens so the list stays usable at 117 chapters.
    let group = null;
    for (let ch = 1; ch <= manifest.last; ch++) {
      if ((ch - 1) % 10 === 0) {
        group = document.createElement('optgroup');
        group.label = `Chapters ${ch}–${Math.min(ch + 9, manifest.last)}`;
        select.appendChild(group);
      }
      const o = document.createElement('option');
      o.value = String(ch);
      group.appendChild(o);
    }
  }
  // Titles only up to the chosen chapter.
  for (const o of select.options) {
    const ch = Number(o.value);
    o.textContent = ch <= sel && state.chapters[ch] ? `${ch}. ${state.chapters[ch].title}` : `Chapter ${ch}`;
  }
  select.value = String(sel);
  $('prev').disabled = sel === 1;
  $('next').disabled = sel === manifest.last;
}

function renderRecap() {
  const c = state.chapters[sel];
  $('recapLab').textContent = `Chapter ${sel} · disc ${c.disc}, track ${c.track}`;
  $('recapTitle').textContent = c.title;
  $('recapText').textContent = c.recap;
  $('earlierBox').hidden = sel === 1;
  let html = '';
  for (let i = sel - 1; i >= 1; i--) {
    const e = state.chapters[i];
    html += `<li><b>${i}. ${esc(e.title)}</b><p>${esc(e.recap)}</p></li>`;
  }
  $('earlier').innerHTML = html;
}

function renderPeople() {
  const visible = [...state.people.values()];
  $('hint').textContent = `${visible.length} people so far`;
  const groups = [...state.groups.values()].sort((a, b) => a.order - b.order);
  let html = '';
  let shown = 0;
  for (const g of groups) {
    const list = visible.filter(p => groupOf(p) === g.id && personMatches(p) && (!onlyThis || inThisChapter(p)));
    if (!list.length) continue;
    shown += list.length;
    const label = last(g.labels);
    html += `<section class="group" style="--g:${esc(g.color)}">
      <div class="ghead"><h2>${esc(label.title)}</h2></div>
      ${label.desc ? `<p class="gdesc">${esc(label.desc)}</p>` : ''}
      <div class="grid">${list.map(card).join('')}</div></section>`;
  }
  if (!shown) {
    const terms = query ? [...state.terms.values()].filter(termMatches).length : 0;
    html = `<p class="empty">${
      terms
        ? `No people match. ${terms === 1 ? 'One place or term matches' : `${terms} places or terms match`} below.`
        : query
          ? 'No match. Try spelling it the way it sounded, for example “dang-lar” or “mair-say-dess”.'
          : 'Nobody new in this chapter.'
    }</p>`;
  }
  $('people').innerHTML = html;
}

function renderRelations() {
  const rels = state.relations.filter(r => !onlyThis || r.ch === sel);
  $('rels').innerHTML = rels.length
    ? rels
        .map(r => `<li class="${r.ch === sel ? 'now' : ''}">${link(r.from)} <span class="v">${esc(r.verb)}</span> ${link(r.to)}</li>`)
        .join('')
    : '<li class="v">Nothing new connects in this chapter.</li>';
}

function renderGlossary() {
  const terms = [...state.terms.values()].filter(t => termMatches(t) && (!onlyThis || t.notes.some(n => n.ch === sel)));
  $('gloss').innerHTML = terms.length
    ? terms
        .map(t => {
          const notes =
            t.notes.length === 1
              ? `<p>${esc(t.notes[0].text)}</p>`
              : t.notes
                  .map(n => `<p class="${n.ch === sel ? 'now' : ''}"><span class="tag">Ch ${n.ch}</span>${esc(n.text)}</p>`)
                  .join('');
          return `<div><dt>${esc(t.term)}${t.say ? `<i>${esc(t.say)}</i>` : ''}</dt><dd>${notes}</dd></div>`;
        })
        .join('')
    : `<p class="empty">${query ? 'No places or terms match.' : 'No new places or terms in this chapter.'}</p>`;
}

function render() {
  renderPicker();
  renderRecap();
  renderPeople();
  renderRelations();
  renderGlossary();
}

async function setChapter(n) {
  sel = Math.max(1, Math.min(manifest.last, n));
  try {
    localStorage.setItem(STORE_KEY, String(sel));
  } catch {}
  const token = ++renderToken;
  document.body.classList.add('loading');
  try {
    const payloads = await loadUpTo(sel);
    if (token !== renderToken) return; // a later choice has taken over
    state = fold(payloads);
    render();
  } catch {
    if (token !== renderToken) return;
    $('people').innerHTML = '<p class="empty">Could not load the chapter data. Check your connection and try again.</p>';
  } finally {
    if (token === renderToken) document.body.classList.remove('loading');
  }
}

function clearFilters() {
  query = '';
  $('q').value = '';
  onlyThis = false;
  $('onlyBtn').setAttribute('aria-pressed', 'false');
}

// ---------------------------------------------------------------------------------------------
// Start-up

async function start() {
  try {
    const res = await fetch('data/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch {
    $('people').innerHTML = '<p class="empty">Could not load the guide. Check your connection and reload.</p>';
    return;
  }
  $('coverage').textContent = `The guide currently covers chapters 1–${manifest.last}.`;

  let saved = 1;
  try {
    saved = parseInt(localStorage.getItem(STORE_KEY), 10) || 1;
  } catch {}

  $('chsel').addEventListener('change', e => setChapter(parseInt(e.target.value, 10)));
  $('prev').addEventListener('click', () => setChapter(sel - 1));
  $('next').addEventListener('click', () => setChapter(sel + 1));
  $('onlyBtn').addEventListener('click', e => {
    onlyThis = !onlyThis;
    e.currentTarget.setAttribute('aria-pressed', String(onlyThis));
    if (state) render();
  });
  $('q').addEventListener('input', e => {
    query = e.target.value;
    if (state) render();
  });
  document.addEventListener('click', e => {
    const say = e.target.closest('.say');
    if (say) {
      speak(say.dataset.say);
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (!jump) return;
    e.preventDefault();
    if (query || onlyThis) {
      clearFilters();
      render();
    }
    const el = document.getElementById(`p-${jump.dataset.jump}`);
    if (el) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
    }
  });

  await setChapter(saved);
}

start();
