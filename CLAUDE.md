# Monte Cristo listening companion

A spoiler-safe character guide for *The Count of Monte Cristo*, used while listening to the Naxos
unabridged audiobook read by Bill Homewood (41 CDs, 117 chapters). The listener picks the chapter
they have reached; the app shows only what is known by the end of that chapter.

## The one rule that matters: no spoilers

The user is listening through the book and has not read ahead. `PROGRESS.md` holds the chapter
they have reached.

- In chat, commit messages, file names, script output and summaries, never mention plot, names or
  events from chapters after the PROGRESS chapter. Refer to later material only by chapter number,
  counts and ids ("added 14 notes to ch 31–35; 2 new people").
- New person ids from chapter 21 onwards are neutral: `p021`, `p022`… (next free number). Keep the
  existing ids for people already in the data.
- Validation scripts print chapter numbers, ids and field paths only. Never the offending text.
- Do not ask the user to review data diffs for chapters beyond PROGRESS. The validators are the
  review.
- Inside the data, each fact is gated at the chapter where the **reader learns it**, not where it
  becomes true. If the narrative withholds something (a disguise, a false name, a hidden link
  between two people, a motive), the data withholds it too, until the chapter where the text makes
  it explicit. A hint is not a reveal. When unsure, gate it later.

## Sources

- `source/pg1184.txt`: Project Gutenberg #1184, the anonymous 1846 translation. This is the text
  Homewood reads. Chapter numbering matches the audiobook.
- `source/chapters/NNN.txt` + `index.json`: one file per chapter, produced by
  `npm run split` (`python scripts/split_chapters.py`). Generated, not committed. Chapter 117's
  file ends with the translator's footnotes.
- `data/tracks.json`: chapter → `{disc, track}` where each chapter starts, taken from the Naxos
  booklet. The booklet itself is not in the repo (copyright, and its notes and track titles
  contain spoilers).
- `reference/guide-v1-ch1-20.html`: the working single-file prototype built in claude.ai. Use it
  for look, behaviour and tone.

Read the chapter text before writing anything about it. Do not work from memory of the novel;
that is how chapters 1–20 were first written and they need checking.

## Data (`data/`)

Every list is sorted by `ch`. "Latest entry ≤ selected chapter wins" applies to `names`, `groups`
and group `labels`; `roles` and `notes` are a log, shown up to the selected chapter.

- `chapters.json`: `{ch, title, disc, track, recap, verified}`. Titles match
  `source/chapters/index.json` (dash/colon style may differ; no em dashes). `disc`/`track` are
  copied from `tracks.json` and checked against it.
- `people.json`:
  ```
  {id, ch, mentioned?,
   names:  [{ch, name, say, fr, alias: [..], forms: [..]}],
   groups: [{ch, group}],
   roles:  [{ch, text}],
   notes:  [{ch, text, ungrounded?}],
   sameAs?:    [{ch, id}],
   grounding?: [{form, textCh, reason}]}
  ```
  `ch` = first on-page appearance; `mentioned` = first time named without appearing (must be
  earlier than `ch`). For people who never appear (group `off`), `ch` is where their part in the
  story is told and `mentioned` an earlier passing mention. The first `names` and `groups` entries sit at `min(ch, mentioned)`.
  `say` is the pronunciation guide, `fr` what the Hear button speaks, `alias` lower-case search
  terms (likely mishearings; never a name the text has not yet given). `forms` are the name
  strings exactly as the text uses them; they drive the grounding and leak checks, so keep them
  distinctive (`old Dantès`, not `Dantès`, for the father). A person can have `forms: []` while
  unnamed. `grounding` records a deliberate mismatch between a form's first occurrence in the
  text (`textCh`, or null) and the chapter the data reveals it, with the reason. `ungrounded` on
  a note says why a person it names is not named in that chapter's text. `sameAs` links two cards
  from chapter `ch`: before it the UI shows them as unrelated and neither card's text may name
  the other.
- `relations.json`: `{from, verb, to, ch}`, read as "from verb to".
- `glossary.json`: `{ch, term, say, forms: [..], notes: [{ch, text}]}`. The entry may not appear
  before the text uses its forms.
- `groups.json`: `[{id, color, ch, labels: [{ch, title, desc}]}]`. Labels are gated like
  everything else, so a group can be introduced or renamed without giving anything away early.
- `tracks.json`: source, as above.

Ids: people and groups first seen from chapter 21 use neutral ids (`p021`…, `g001`…).
## Validation

`npm run validate` (`node scripts/validate.mjs`, `--errors` for errors only) runs after every
batch and exits non-zero on errors. `npm test` tests the validators themselves. Checks, in
`scripts/lib/checks.mjs`:

1. **Schema**: required fields, types, unknown fields, known ids and groups, chapters in 1–117,
   sorted lists, neutral ids, nothing tagged past the last chapter in `chapters.json`.
2. **Internal gating**: every name, group, role, note, relation, `sameAs` and glossary note is
   tagged at or after the chapter where everyone it refers to is visible. Before a `sameAs` link,
   neither card's text names the other.
3. **Grounding of first appearances**: each form first occurs in the source in the chapter of the
   `names` entry that introduces it, unless a `grounding` override (with reason) says otherwise.
   Glossary forms must occur in the text by the entry's chapter.
4. **Name leaks**: no text tagged chapter N (recaps, names, aliases, roles, notes, relation verbs,
   glossary, group labels) contains a form the data reveals only after N. Matching ignores case,
   accents and apostrophe style.
5. **Note grounding (warning)**: each person named in a note or recap tagged N (and the note's
   owner) is named in chapter N's text, or the note has `ungrounded`.
6. **Titles**: titles match `index.json`; disc/track match `tracks.json`.
7. **Style**: no em dashes, no straight quotes in data text.

Output is spoiler-safe by construction: chapter numbers, safe ids, field paths and counts only.
A test feeds sentinel text through every field to prove it.

## Workflow for extending chapters

1. Verify chapters 1–20 against the text first. Fix recaps, titles, notes, first-appearance
   chapters and spellings (this translation uses Leclere, Marseilles; keep the accents it uses).
   Mark `verified: true`.
2. Then batches of about 10–15 chapters. Use one subagent per chapter: it reads only that
   chapter's text plus a compact summary of the data so far, and returns proposed additions as
   JSON. The main agent merges, resolves conflicts, runs validation, fixes, rebuilds the site
   (
pm run build), commits.
3. Keep the data ahead of the listener but work in order; later batches depend on earlier gating.

## Writing style

- British spelling. Plain, direct sentences. No filler, few adjectives.
- Recaps: 2–4 sentences, what happens in that chapter only, nothing foreshadowed.
- Notes: one or two sentences, what this person does or is revealed to be in that chapter.
- Pronunciation: English approximations, stressed syllable in capitals (`dahn-GLAR`). French names
  in French, Italian names in Italian. Add a short note where a silent letter trips people up.

## App

Plain HTML, CSS and JavaScript, no framework. Source in `app/`; `npm run build` validates the
data (and refuses to build on errors), then writes the site to `docs/`, which is committed and
served by GitHub Pages from `master` → `/docs` (https://benjaminsymons.github.io/mc/).
`npm run preview` serves `docs/` locally; the page needs HTTP, not `file://`. `npm test` fails
if `docs/` is stale.

- `app/index.html`, `app/style.css`, `app/app.js`; `app/codec.js` is shared with the build.
- Spoiler protection: `scripts/lib/site.mjs` splits the data into one payload per chapter holding
  only what that chapter adds (`docs/data/NNN.txt`, base64 + XOR keyed by chapter). The page
  fetches and decodes chapters 1..N only, and folds them together. `docs/data/manifest.json` holds
  only the chapter count and disc/track numbers. The picker shows titles only up to the chosen
  chapter. Never publish `data/` or `source/` on the site.
- Mobile-first; the prototype's look (IM Fell English + Alegreya Sans, group colours, light/dark
  tokens).
- Features: sound-alike search (substring + Levenshtein) over people and glossary; chapter picker
  grouped by disc, with prev/next, saved to localStorage; disc and track for the chosen chapter;
  recap plus collapsible earlier recaps; "This chapter only" filter; Hear button (speechSynthesis,
  fr-FR); per-card chapter log with current-chapter highlight; "New in chapter N" / "First
  mentioned" badges; earlier names; `sameAs` links; relations list with jump links; gated
  glossary with per-chapter notes.