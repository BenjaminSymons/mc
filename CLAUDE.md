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
  `python3 scripts/split_chapters.py`. Chapter 117's file ends with the translator's footnotes.
- `data/tracks.json`: chapter → `{disc, track}` where each chapter starts, taken from the Naxos
  booklet. The booklet itself is not in the repo (copyright, and its notes and track titles
  contain spoilers).
- `reference/guide-v1-ch1-20.html`: the working single-file prototype built in claude.ai. Use it
  for look, behaviour and tone.

Read the chapter text before writing anything about it. Do not work from memory of the novel;
that is how chapters 1–20 were first written and they need checking.

## Data (`data/`)

Current shape, extracted from the prototype:

- `chapters.json`: `{ch, title, recap, verified}`. Titles must match this translation (see
  `source/chapters/index.json`); several v1 titles are from other translations.
- `people.json`: `{id, group, ch, mentioned?, name, say, fr, alias, roles: [[ch, text]], notes: [[ch, text]]}`.
  `ch` = first on-page appearance; `mentioned` = first time named without appearing. `say` is the
  pronunciation guide, `fr` what the Hear button speaks, `alias` extra search terms (include likely
  mishearings).
- `relations.json`: `{from, verb, to, ch}`, read as "from verb to".
- `glossary.json`: `{ch, term, say, text}`.
- `groups.json`: display groups and colours.
- `tracks.json`: as above.

Extensions needed as the book goes on (design these generically):

- A person's displayed name, pronunciation and search terms can change by chapter:
  `names: [{ch, name, say, fr, alias}]`, latest entry ≤ selected chapter wins.
- Two cards can turn out to be the same person, or linked in a way the reader learns later:
  `sameAs: [{ch, id}]` (or similar). Before that chapter the UI must show them as unrelated; from
  it, link or merge them.
- A person's group can change by chapter: `groups: [[ch, group]]`.
- Groups themselves may need to appear from a chapter onwards, with descriptions that give
  nothing away early.
- Add `disc`/`track` to each chapter from `tracks.json`.

Convert the prototype's arrays to objects where that makes validation easier.

## Validation (`scripts/validate.*`)

Build these before extending past chapter 20, then run them after every batch. Exit non-zero on
errors; warnings for heuristics.

1. **Schema**: required fields, types, known ids and groups, chapters in 1–117.
2. **Internal gating**: every note, role, name entry, relation and glossary item is tagged at or
   after the chapter where everyone it refers to is visible. Relations need both ends visible.
3. **Grounding of first appearances**: find the first chapter in `source/chapters` where each
   name/alias actually occurs; compare with `ch`/`mentioned`. Flag mismatches. Allow an explicit
   override field with a reason where a name appears early in a different sense.
4. **Name leaks**: no text tagged chapter N (recaps, notes, roles, relation verbs, glossary,
   group descriptions) contains any name, alias or name-form that is only revealed after N.
   Untagged text (group descriptions, UI copy) is treated as chapter 1.
5. **Note grounding (warning)**: each person named in a note tagged chapter N occurs in chapter
   N's text, or the note says why not.
6. **Titles**: chapter titles match `index.json`.
7. **Spoiler-safe output**: the scripts themselves obey the output rule above.

## Workflow for extending chapters

1. Verify chapters 1–20 against the text first. Fix recaps, titles, notes, first-appearance
   chapters and spellings (this translation uses Leclere, Marseilles; keep the accents it uses).
   Mark `verified: true`.
2. Then batches of about 10–15 chapters. Use one subagent per chapter: it reads only that
   chapter's text plus a compact summary of the data so far, and returns proposed additions as
   JSON. The main agent merges, resolves conflicts, runs validation, fixes, commits.
3. Keep the data ahead of the listener but work in order; later batches depend on earlier gating.

## Writing style

- British spelling. Plain, direct sentences. No filler, few adjectives.
- Recaps: 2–4 sentences, what happens in that chapter only, nothing foreshadowed.
- Notes: one or two sentences, what this person does or is revealed to be in that chapter.
- Pronunciation: English approximations, stressed syllable in capitals (`dahn-GLAR`). French names
  in French, Italian names in Italian. Add a short note where a silent letter trips people up.

## App

- Svelte 5 (runes) + Vite, static build to `dist/`, no server. The user hosts it.
- Mobile-first; match the prototype's look (IM Fell English + Alegreya Sans, the group colours,
  light/dark tokens).
- Keep every prototype feature: sound-alike search (substring + Levenshtein), chapter picker with
  prev/next saved to localStorage, chapter recap plus collapsible earlier recaps, "This chapter
  only" filter, Hear button (speechSynthesis, fr-FR), per-card chapter log with current-chapter
  highlight, "New in chapter N" badges, relations list, gated glossary.
- Add: disc and track for the selected chapter; a chapter picker that stays usable at 117 entries
  (group by disc or by tens).
- Spoiler protection in the build: do not ship later chapters as readable text. Split the data
  per chapter and encode it (e.g. base64 + simple XOR) so viewing source or network responses does
  not show it; decode only chapters ≤ the selected one.
