<!-- This file has been created with the assistance of an AI tool. -->
# Changelog

## [0.3.0] - 2026-09-09

### Added
- **Auto-skip.** A master toggle in the popup picks artist categories to skip and
  presses **Next** automatically when a matching track starts. Off by default.
- **Never-skip list.** A listed artist vetoes a whole track, even when another credit
  matches a skipped category.
- **Skip history.** Every artist credited on a skipped track is recorded, newest
  first, ready to be promoted to the never-skip list.
- **Runaway guards.** Auto-skip suspends after a run of consecutive skips, and
  latches tracks where "Next" provably does nothing (repeat-one, end of queue).

### Changed
- The popup now collapses its settings into sections (categories, never-skip,
  history) that open one at a time.

## [0.2.0] - 2026-09-07

### Added
- **"AI-associated" category.** Distinguished from a full AI artist by the same badge
  letter but a dim-blue colour.

### Changed
- **Split bulk and scalar requests.** A single artist id is checked against the scalar
  endpoint, while several are batched against the batch endpoint — so a lone lookup no
  longer needs the batch payload.

## [0.1.0] - 2026-01-30

### Added
- Initial release. Marks artists on YouTube Music with a badge — human, AI artist, or
  unknown — from the artist-check.com database.
