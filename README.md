<!-- This file has been edited with the assistance of an AI tool. -->
# YTM AI Artist Detector

> Marks AI artists on YouTube Music and can auto-skip them.

A Manifest V3 Chrome extension that reads the artist credits in the YouTube Music
player, queries the [artist-check.com](https://artist-check.com) database, and tags
every credited artist with a badge: **H** (human), **AI** (AI artist), **?**
(unknown), or a dim-blue **AI** (AI-associated).

On top of the badges it can auto-skip: pick which categories to skip and the
extension presses **Next** for you whenever a matching track starts. A "never skip"
list lets you rescue collaborations — a listed artist vetoes the whole track even
when another credit falls into a skipped category.

Available on the [Chrome Web Store](https://chromewebstore.google.com/detail/aeemndkkpeaglfhiapkhekmnoiojodma).

## Features

- **Artist badges.** Every credited artist — on a track, and on the channel pages
  and search results behind it — is labelled with a badge showing its classification.
- **Auto-skip.** Flip the toggle in the popup, choose the categories to skip, and the
  extension advances the queue whenever a matching track starts. Off by default.
- **Never-skip list.** A listed artist rescues any track they are credited on, even
  when another co-credit matches a skipped category.
- **Skip history.** Every artist credited on a skipped track is recorded (newest
  first), so you can see — and promote — the co-credit who can rescue a collaboration.

## How it works

The popup and the page share one classification pipeline:

1. The content script watches the player bar (and the rest of the page) for artist
   links.
2. `checkIsAiArtist` batches concurrent lookups and sends them to artist-check.com —
   a single id goes to the scalar endpoint, several to the batch one.
3. Artist badges are injected once a status comes back; auto-skip acts on the same
   statuses when you've enabled it.

Auto-skip is deliberately conservative. It requires two identical reads of a track
before acting (so a transient title/byline mismatch is never skipped), never skips on
an *uncached* "unknown" (which means the API couldn't be reached, not that the artist
is unknown), and suspends after a run of consecutive skips.

## Installation

The packaged extension is on the Chrome Web Store. To load a local copy from source:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** and select the `dist/` folder.

## Development

There is no build step — the source is hand-maintained in `dist/`. After editing,
reload the extension on `chrome://extensions`.

| Command | What it does |
|---|---|
| `make generate_icons` | Regenerate the `dist/*.png` icons and the store icon from `icon_source/logo.svg` (needs `rsvg-convert`). |
| `make package` | Zip `dist/` into `dist.zip` for upload. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow and the
non-obvious design decisions, and [CLAUDE.md](CLAUDE.md) for agent/contributor notes.

## Continuous integration

GitHub Actions guards changes (`npm run lint`, `npm test`, `npm run check`) on every
pull request and on pushes to `master`. A tag push (e.g. `0.3.0`) runs `make package`,
attaches `{tag}.zip` to a release, and fills its notes from the matching `CHANGELOG.md`
section; a pull request instead uploads a `pr-{n}.zip` artifact for manual testing.

## Data

Artist **ids** are sent to artist-check.com to look up their
classification. Names only ever go into your browser's own `chrome.storage`: the
auto-skip configuration and the never-skip list in the `sync` area, the skip history
in `local`. Nothing about your listening history leaves the browser except the artist
ids themselves.
