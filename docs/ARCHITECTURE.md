<!-- This file has been created with the assistance of an AI tool. -->
# Architecture

How the extension is put together and why.

## The source lives in `dist/`

There is no `src/` and no build step. `dist/*.js` and `dist/*.html` are the actual,
hand-maintained source — the `Makefile` only regenerates PNG icons and zips the folder
for upload. Edit `dist/` directly, then reload the unpacked extension.

## Data flow

```
 YouTube Music page
   │  content script observes the DOM
   ▼
 artist <a> (href /channel/<UC...>)           ─┐
   │ getArtistIdFromLink                       │
   ▼                                           │
 checkIsAiArtist(artistId)                     │  debounced ~200ms window
   │  already in artistCache? → return         │  batches concurrent lookups
   │  already pending?        → return promise │
   ▼                                           │
 batchQueue + processBatch                    ◄┘
   │
   ├─ 1 id   → GET /youtube/v1/artists/check?artist_id=...
   └─ n ids  → POST /youtube/v1/artists/check/batch { "artist_ids": [...] }
   │
   ▼
 status → artistCache.set(id, status)  (only on a successful request)
   │
   ▼
 addBadge(element, status)   → content.js (page badges)
 evaluateAutoSkipTrack(...)  → autoskip.js (maybe skip the track)
```

The popup (`popup.html`) shares `settings.js` for the same constants, storage helpers
and merge/normalizers, and renders the settings, never-skip list and skip history.

## One global scope across three content scripts

`manifest.json` loads `settings.js`, `content.js` and `autoskip.js` as three content
scripts into a single isolated world. Chrome gives content scripts of one extension a
**shared global lexical scope**, so every top-level `const`/`let` in one file is
visible in the others. That is why:

- `settings.js` declares the constants and helpers both `content.js` and `autoskip.js`
  reuse (`getArtistIdFromLink`, `checkIsAiArtist`, `artistCache`, `merge*`, storage
  loaders, badge constants).
- Every file prefixes its own constants (`AUTOSKIP_*`, `POPUP_*`) so two files never
  declare the same top-level name — a collision is a hard `SyntaxError`.

`popup.html` also loads `settings.js` (globals) followed by `popup.js`, so the same
non-redeclaration rule applies there.

## Classification: batching, caching, and the meaning of `unknown`

`checkIsAiArtist` collapses concurrent lookups for the same window into a **single
round trip**:

- The first call per id starts a ~200ms debounce (`processBatch`). While it is in
  flight, further calls for that id reuse a shared pending promise.
- `processBatch` dispatches one request for the whole queue. A queue of **one** id is
  sent to the scalar endpoint; anything larger to the batch endpoint.
- The result map is written to `artistCache` **only when the request succeeded**. On a
  failure the queue is drained as `unknown` but the cache is left untouched.

That last point is load-bearing. `checkIsAiArtist` returns `status = results[id] ||
'unknown'`, so `unknown` covers two very different situations:

1. The database really says "unknown".
2. The API call failed / the id wasn't in the response.

`isAutoSkipArtist` in `autoskip.js` distinguishes them: it refuses to skip a track
whose status is `unknown` **and** whose id is not in `artistCache`. So an uncached
`unknown` — i.e. an outage — can never skip the user's queue, while a *cached*
`unknown` is a genuine database answer and may be skipped if the user selected it.

## Auto-skip state machine

`autoskip.js` watches the player bar. The interesting parts:

### Reading a track

`readAutoSkipSnapshot` builds an identity key from `title` + **sorted** artist ids.
The player bar exposes no video id to an isolated world and the thumbnail is album art
(identical across an album), so title + artists is the only collision-safe pair. Names
are deliberately kept out of the key — the byline's text populates independently of its
hrefs, so including names would churn the key on every text mutation.

The title and byline update independently, so one read taken mid-transition can pair a
new title with the previous track's artists. The **confirm-twice gate** requires the
same key to be read twice (~400ms apart) before committing; an incomplete snapshot
(no title or no artist links) is retried up to `AUTOSKIP_CONFIRM_LIMIT` times.

### Deciding and skipping

`evaluateAutoSkipTrack` runs for a committed snapshot and, in order:

1. No linked artist (a user upload) → progress, do nothing.
2. Any credit on the never-skip list → **veto**: the track plays. This needs no API
   call and runs before the await, so it cannot race a track change.
3. Statuses fetched, then `isAutoSkipCurrent` re-checks that this evaluation still
   applies (the `dataset` token + a generation counter).
4. If no credit matches → progress, do nothing.
5. Otherwise `requestAutoSkip`.

`requestAutoSkip` clicks the real Next control (keeping queue order, shuffle and
play/pause consistent — seeking the media element to its end would not, and loops
forever under repeat-one). It records the **whole byline** to history, not just the
matching artists: the veto makes that worth doing, because the artist who can rescue a
collaboration is the one who did *not* match, and the popup can only whitelist an
artist it has a history row for.

### Latches and guards

| Guard | Behaviour |
|---|---|
| Consecutive-skip streak | `AUTOSKIP_MAX_CONSECUTIVE_SKIPS` consecutive skips suspend auto-skip; it resumes when a track is allowed to play or settings change. |
| Unskippable latch | If, after a skip, the track key is unchanged (`verifyAutoSkip`), that key is latched so it is never retried in a tight loop — it caps the "repeat-one / end of queue" case. The streak counter is deliberately not reset by a failure. |
| Watchdog | Re-binds the player-bar observer every second, covering a page with no player bar yet and Polymer replacing the observed element. |

A configuration change (`applyAutoSkipConfig`) drops every latch before re-evaluating,
which is what lets a settings change recover a suspended state.

## Storage and the sync quota

| Key | Area | Contents |
|---|---|---|
| `autoskip` | `sync` | `{ enabled, categories }` |
| `noskip` | `sync` | `artistId -> name` map |
| `skipHistory` | `local` | `[{ id, name, status, at }]`, newest first, capped |

`chrome.storage.sync` charges the **key name + JSON-serialized value** against an
~8KB per-item quota and counts **bytes**, not characters — a CJK name costs up to 3
bytes per character. Hence:

- The never-skip list is a `artistId -> name` **map**, not an array.
- `NOSKIP_BYTE_BUDGET` (7500) plus `NOSKIP_LIST_LIMIT` (200) pre-check the size before
  a write, because a quota overflow is reported only by a silent rejection — an
  indistinguishable-from-broken click otherwise.
- `mergeSkipHistory` caps on read as well as write, so a hand-edited store can't
  produce an endless render.

Storage helpers are written to **never reject**: a failed read returns the merged empty
value, so callers on the playback hot path never need a `try/catch`.

## Invariants worth keeping

- **Never-skip veto wins.** A listed artist means the track plays regardless of the
  category picks. The veto is only as good as the rendered byline, which the few-hundred-ms
  confirm gate tries to make reliable.
- **Popup collapse uses `hidden`, not `display:none`.** A `display` rule in CSS would
  out-specify the UA's `[hidden]{display:none}` and the collapse would silently stop
  collapsing. Similarly, the sections are never removed from the DOM — `readSettingsFromUi`
  reads the checkboxes back out of the DOM, so detaching them would report every
  category as false and wipe the user's picks on the next write.
- **`dataset` + generation guards.** After an `await`, both `content.js`
  (`lastCheckedId`) and `autoskip.js` (`autoskipTrack`, `autoSkipGeneration`) re-check
  that the element/track is still the one that was asked about, so a stale async result
  is never written to the wrong DOM node or used to skip the wrong track.
- **Only successful API requests write the cache** — see the `unknown` discussion above.
- **An empty name is a valid name.** The player-bar byline populates asynchronously; a
  name-less artist still links, and a later skip upgrades the stored name
  (`recordSkippedArtists` never downgrades a known name to an empty one).
