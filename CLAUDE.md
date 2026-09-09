<!-- This file has been created with the assistance of an AI tool. -->
# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

**YTM AI Artist Detector** is a Manifest V3 Chrome extension that marks artists on
YouTube Music with a badge identifying whether they are a human, an AI artist,
AI-associated, or unknown, and can auto-skip tracks whose credited artists fall into
a category the user selects.

Published on the Chrome Web Store:
`https://chromewebstore.google.com/detail/aeemndkkpeaglfhiapkhekmnoiojodma`

## Critical layout fact: there is no build step and no `src/`

The extension's source is hand-maintained directly inside `dist/`. There is no
bundler, transpiler, or compile step — `dist/*.js` and `dist/*.html` are edited in
place. The `Makefile` (see below) only regenerates PNG icons and zips the folder.

**Consequence:** when you change the extension you edit `dist/` directly. Never go
looking for a source tree that feeds it.

## File map

| File (`dist/`) | Role |
|---|---|
| `settings.js` | Shared globals + the storage layer. Loaded first in every content script, and as a plain script in the popup. |
| `content.js` | Main content script. Scans the page for artist links, fetches their status from the API, and injects badges. |
| `autoskip.js` | Optional auto-skip behaviour. Watches the player bar and presses "Next" for matching tracks. |
| `popup.html/js/css` | The toolbar popup: master auto-skip toggle, category picks, never-skip list, skip history. |
| `styles.css` | Badge + page styling. |
| `manifest.json` | MV3 manifest. |

## The one thing that will break a file: shared global scope

`manifest.json` loads `settings.js`, `content.js`, and `autoskip.js` as three content
scripts. **They share one global lexical scope** — so every top-level
`const`/`let`/`var` in one is visible to the others.

Never redeclare a top-level name in another file, or that file dies with a
`SyntaxError` before its first statement runs. `popup.html` also loads `settings.js`
(its globals) plus `popup.js`, so the same rule applies there.

Constants are intentionally prefixed to avoid collisions across files:
`AUTOSKIP_*` (`autoskip.js`), `POPUP_*` (`popup.js`), and `BADGE_*` / `CATEGORY_*` /
`NOSKIP_*` / `SKIP_*` (`settings.js`).

## Categories

Defined entirely by the constants in `settings.js`:

- `CATEGORY_ORDER = ['ai', 'associated', 'unknown', 'human']`
- `CATEGORY_LABEL` — the human-readable name shown in the popup.
- `BADGE_TEXT` / `BADGE_EXTRA_CLASS` — the badge letter and the CSS class.
  `associated` reuses the `AI` letter but gets its own dim-blue class.

Adding a new category needs **no storage migration**: `mergeSettings` iterates over
`DEFAULT_SETTINGS.categories`, so an old stored payload simply lacks the new key and
defaults to `false`.

`unknown` is a real state, but an *uncached* `unknown` means "the API call failed",
not "the database says unknown". `isAutoSkipArtist` therefore refuses to skip a track
where the status is `unknown` and the id is not in `artistCache` — otherwise an API
outage would skip the user's whole queue.

## Storage

Three keys, each with a dedicated `merge*` normalizer in `settings.js`:

| Key | Area | Contents |
|---|---|---|
| `autoskip` | `sync` | `{ enabled, categories }` — master toggle + per-category picks. |
| `noskip` | `sync` | `artistId -> name` map. An artist here vetoes the whole track. |
| `skipHistory` | `local` | Array of `{ id, name, status, at }`, newest first, capped at `SKIP_HISTORY_LIMIT`. |

`sync` storage has an ~8KB per-item quota, which is why the never-skip list is capped
by a byte budget (`NOSKIP_BYTE_BUDGET`) and stored as a map rather than a list. All
reads/writes **never reject** — they normalize to an empty value on failure, so a
promise on the playback hot path is safe.

## API

Classification comes from `artist-check.com`:

- **Batch:** `POST /youtube/v1/artists/check/batch` with `{ "artist_ids": [...] }`.
- **Scalar:** `GET /youtube/v1/artists/check?artist_id=<id>`.

`checkIsAiArtist` batches concurrent lookups into ~200ms windows and caches results
in `artistCache`. `processBatch` routes a single-element queue to the scalar endpoint
and anything larger to the batch endpoint ("split between bulk and scalar requests").
Only a *successful* request writes the cache.

## Auto-skip pipeline (`autoskip.js`)

`observe player bar` → `readAutoSkipSnapshot` (title + sorted artist ids form an
identity key) → **confirm-twice gate** (two identical reads, ~400ms, discards the
transient title/byline mismatch mid-transition) → `evaluateAutoSkipTrack` →
`requestAutoSkip` → `performAutoSkip` (clicks the real Next control) →
`verifyAutoSkip` (checks the track actually changed).

Guards worth knowing:

- **Never-skip veto:** if any credited artist is on the never-skip list, the track
  plays even when another credit matches a selected category.
- **Runaway streak:** `AUTOSKIP_MAX_CONSECUTIVE_SKIPS` consecutive skips suspend
  auto-skip until a track is allowed to play or the settings change.
- **Unskippable latch:** if "Next" provably did nothing (repeat-one, end of queue),
  that key is latched so the track is never retried in a loop.
- **Watchdog:** re-binds the observer every second, covering a page with no player
  bar yet and Polymer replacing the observed element.

## Build / Makefile

Requires `rsvg-convert` (for the generated PNGs).

- `make generate_icons` — regenerates `dist/{16,32,48,128}.png` and
  `listing/store_icon.png` from `icon_source/logo.svg`.
- `make package` — `zip -r dist.zip dist`, the upload bundle.
- `make generate_icon SIZE=128` — build a single size.

## Conventions

- Every created/edited source file carries **exactly one** AI attribution comment at
  the very top. Don't stack a second; don't convert "created" to "edited". JSON files
  (e.g. `manifest.json`) skip attribution because they can't hold comments.
- The code is heavily commented and rigorous about failure modes — match that density
  when you edit. Comments explain *why* (often a subtle Chrome/Polymer gotcha) and
  usually carry `Notes:` bullets.
- Popup sections use the `hidden` attribute for the collapse, never `display:none`.
  Adding a `display` rule in CSS would out-specify the UA's `[hidden]{display:none}`
  and the collapse would silently stop collapsing.
