// This file has been created with the assistance of an AI tool.
// --- AUTO-SKIP ---
// Watches the player bar and presses "Next" when a credited artist of the current
// track falls into a category the user selected in the popup.
//
// Reuses `getArtistIdFromLink`, `checkIsAiArtist` and `artistCache` from content.js,
// and `mergeSettings`/`isSkippedCategory`/`subscribeToSettings` from settings.js - all
// three files share one global scope, so every name declared here is prefixed to avoid
// colliding with theirs.


// Constants
const AUTOSKIP_LOG_PREFIX = '[AutoSkip]';
const AUTOSKIP_CONTENT_INFO_SELECTOR = 'ytmusic-player-bar .content-info-wrapper';
const AUTOSKIP_TITLE_SELECTOR = '.title';
const AUTOSKIP_NEXT_BUTTON_SELECTOR = 'ytmusic-player-bar .next-button';
const AUTOSKIP_KEY_SEPARATOR = '\x1f';   /* unit separator - track titles routinely contain '|' */
const AUTOSKIP_TRACK_DATASET_KEY = 'autoskipTrack';

const AUTOSKIP_DEBOUNCE_MS = 150;        /* collapse a burst of player-bar mutations */
const AUTOSKIP_CONFIRM_MS = 250;         /* gap between the two reads that confirm a track */
const AUTOSKIP_CONFIRM_LIMIT = 20;       /* ~5s of patience for a byline that never populates */
const AUTOSKIP_VERIFY_MS = 1500;         /* how long to wait before checking that a skip worked */
const AUTOSKIP_WATCHDOG_MS = 1000;       /* re-bind poll, also covers a page with no player bar yet */
const AUTOSKIP_MAX_CONSECUTIVE_SKIPS = 10;
const AUTOSKIP_STREAK_RESET_MS = 60000;  /* a slow trickle of skips is not a runaway */


// Global objects
let autoSkipSettings = mergeSettings(null);   // fail closed until the real settings load
let autoSkipWrapper = null;                   // the observed .content-info-wrapper
let autoSkipObserver = null;
let autoSkipVideo = null;
let autoSkipConfirmTimeout = null;
let autoSkipVerifyTimeout = null;
let autoSkipPendingSnapshot = null;           // snapshot awaiting its confirming second read
let autoSkipConfirmAttempts = 0;
let autoSkipCommittedKey = null;              // the track currently being acted on
let autoSkipGeneration = 0;                   // invalidates in-flight evaluations
let autoSkipPendingKey = null;                // a skip was issued for this key, awaiting verification
let autoSkipUnskippableKey = null;            // "Next" provably did nothing for this key
let autoSkipConsecutiveSkips = 0;
let autoSkipLastSkipAt = 0;
let autoSkipSuspended = false;


/**
 * Builds a stable identity key for a track from its title and credited artists.
 *
 * @param {string} title - The track title as shown in the player bar.
 * @param {string[]} artistIds - Sorted, de-duplicated artist IDs.
 * @return {string} The track key.
 * Notes:
 * - The player bar exposes no video ID to an isolated world, and the thumbnail is album art
 *   (identical across a whole album), so title + artists is the only collision-safe pair.
 * - A collision needs an identical title *and* artist set, which implies an identical verdict.
 */
function buildAutoSkipKey(title, artistIds) {
  return `${title}${AUTOSKIP_KEY_SEPARATOR}${artistIds.join(',')}`;
}


/**
 * Reads a coherent snapshot of the track currently shown in the player bar.
 *
 * @return {{wrapper: HTMLElement, title: string, artistIds: string[], key: string}|null}
 *   The snapshot, or null when the player bar is not rendered yet.
 * Notes:
 * - Every anchor in the wrapper is offered to `getArtistIdFromLink`, which returns null for
 *   the album link (`browse/MPRE...`), so no separate filtering is needed. The year is a bare
 *   text node and never appears as an anchor.
 */
function readAutoSkipSnapshot() {
  const wrapper = document.querySelector(AUTOSKIP_CONTENT_INFO_SELECTOR);
  if (!wrapper) return null;

  const titleElement = wrapper.querySelector(AUTOSKIP_TITLE_SELECTOR);
  const title = titleElement ? titleElement.textContent.trim() : '';

  const artistIds = [];
  wrapper.querySelectorAll('a').forEach(anchorElement => {
    const artistId = getArtistIdFromLink(anchorElement);
    if (artistId && !artistIds.includes(artistId)) artistIds.push(artistId);
  });
  artistIds.sort();   // stable against YouTube Music reordering the byline

  return { wrapper: wrapper, title: title, artistIds: artistIds, key: buildAutoSkipKey(title, artistIds) };
}


/**
 * Schedules a debounced re-read of the player bar.
 *
 * @param {number} [delay=AUTOSKIP_DEBOUNCE_MS] - Milliseconds to wait before reading.
 * @return {void}
 */
function scheduleAutoSkipRead(delay) {
  clearTimeout(autoSkipConfirmTimeout);
  autoSkipConfirmTimeout = setTimeout(confirmAutoSkipSnapshot, typeof delay === 'number' ? delay : AUTOSKIP_DEBOUNCE_MS);
}


/**
 * Decides whether the snapshot currently in the DOM represents a new track and, once the
 * same key has been read twice in a row, commits it for evaluation.
 *
 * @return {void}
 * Notes:
 * - The title and the byline update independently, so a single read taken mid-transition can
 *   pair the new title with the previous track's artists. Requiring two identical reads
 *   discards that phantom key, at the cost of ~400ms of latency before a skip fires.
 * - An incomplete snapshot (no title, or no artist links yet) is retried up to
 *   AUTOSKIP_CONFIRM_LIMIT times, then committed anyway so a track that genuinely has no
 *   linked artist (a user upload) is recorded as seen rather than retried forever.
 */
function confirmAutoSkipSnapshot() {
  autoSkipConfirmTimeout = null;

  const snapshot = readAutoSkipSnapshot();
  if (!snapshot) return;   // the watchdog will re-bind

  if (snapshot.key === autoSkipCommittedKey) {
    autoSkipPendingSnapshot = null;
    return;
  }

  if (!autoSkipPendingSnapshot || autoSkipPendingSnapshot.key !== snapshot.key) {
    autoSkipPendingSnapshot = snapshot;   // first sighting - confirm it before acting
    autoSkipConfirmAttempts = 0;
    scheduleAutoSkipRead(AUTOSKIP_CONFIRM_MS);
    return;
  }

  const isComplete = snapshot.title !== '' && snapshot.artistIds.length > 0;
  if (!isComplete && autoSkipConfirmAttempts < AUTOSKIP_CONFIRM_LIMIT) {
    autoSkipConfirmAttempts += 1;
    scheduleAutoSkipRead(AUTOSKIP_CONFIRM_MS);
    return;
  }

  autoSkipPendingSnapshot = null;
  autoSkipConfirmAttempts = 0;
  commitAutoSkipTrack(snapshot);
}


/**
 * Records a snapshot as the track being acted on and starts evaluating it.
 *
 * @param {{wrapper: HTMLElement, title: string, artistIds: string[], key: string}} snapshot - The confirmed snapshot.
 * @return {void}
 */
function commitAutoSkipTrack(snapshot) {
  const isNewTrack = autoSkipPendingKey !== null && autoSkipPendingKey !== snapshot.key;

  autoSkipCommittedKey = snapshot.key;
  snapshot.wrapper.dataset[AUTOSKIP_TRACK_DATASET_KEY] = snapshot.key;

  if (isNewTrack) {
    // The previous skip did advance the queue, so its verification is moot.
    clearTimeout(autoSkipVerifyTimeout);
    autoSkipVerifyTimeout = null;
    autoSkipPendingKey = null;
  }
  autoSkipUnskippableKey = null;   // referred to the previous track

  evaluateAutoSkipTrack(snapshot, ++autoSkipGeneration);
}


/**
 * Determines whether a resolved status means the track should be skipped.
 *
 * @param {"human"|"ai"|"unknown"|"associated"} status - The status resolved for the artist.
 * @param {string} artistId - The artist the status belongs to.
 * @return {boolean} True when this artist alone justifies skipping the track.
 * Notes:
 * - `checkIsAiArtist` also resolves 'unknown' when the API request *failed*, and `processBatch`
 *   only writes the cache when the request succeeded. So an uncached 'unknown' means "could not
 *   reach the database", not "the database says unknown", and must never trigger a skip -
 *   otherwise an outage would skip the user's whole queue.
 */
function isAutoSkipStatus(status, artistId) {
  if (!isSkippedCategory(autoSkipSettings, status)) return false;
  if (status === 'unknown' && !artistCache.has(artistId)) return false;

  return true;
}


/**
 * Checks whether an evaluation started earlier still applies to what is playing now.
 *
 * @param {{wrapper: HTMLElement, key: string}} snapshot - The snapshot the evaluation started from.
 * @param {number} generation - The generation counter captured when the evaluation started.
 * @return {boolean} True when the evaluation may still act.
 * Notes:
 * - Mirrors the `dataset.lastCheckedId` guard in content.js. The dataset token self-invalidates
 *   if Polymer replaces the wrapper; the generation counter additionally covers a forced
 *   re-evaluation of the *same* key while an earlier one is still awaiting.
 */
function isAutoSkipCurrent(snapshot, generation) {
  return snapshot.wrapper.isConnected
    && snapshot.wrapper.dataset[AUTOSKIP_TRACK_DATASET_KEY] === snapshot.key
    && generation === autoSkipGeneration;
}


/**
 * Clears the consecutive-skip streak and lifts a suspension.
 *
 * @return {void}
 * Notes:
 * - Called whenever a track is allowed to play, which is the signal that auto-skip is not
 *   running away. Suspension is therefore checked in requestAutoSkip rather than in
 *   evaluateAutoSkipTrack - evaluation has to keep running, or a suspension could never lift.
 */
function releaseAutoSkipStreak() {
  autoSkipConsecutiveSkips = 0;
  autoSkipLastSkipAt = 0;
  autoSkipSuspended = false;
}


/**
 * Resolves the status of every credited artist and skips the track if any of them matches.
 *
 * @param {{wrapper: HTMLElement, title: string, artistIds: string[], key: string}} snapshot - The committed snapshot.
 * @param {number} generation - The generation counter for this evaluation.
 * @return {Promise<void>} Resolves once the track has been evaluated.
 */
async function evaluateAutoSkipTrack(snapshot, generation) {
  if (!autoSkipSettings.enabled) return;

  // A track with no linked artist (a user upload) can never match, so it counts as progress.
  // Note this is NOT the same as the 'unknown' status and must never cause a skip.
  if (snapshot.artistIds.length === 0) {
    releaseAutoSkipStreak();
    return;
  }

  // A slow trickle of skips is normal listening, not a runaway.
  if (autoSkipLastSkipAt !== 0 && Date.now() - autoSkipLastSkipAt > AUTOSKIP_STREAK_RESET_MS) {
    releaseAutoSkipStreak();
  }

  const statuses = await Promise.all(snapshot.artistIds.map(artistId => checkIsAiArtist(artistId)));

  // The debounce plus a network round trip can outlast the track, and the user may have
  // switched auto-skip off in the meantime.
  if (!isAutoSkipCurrent(snapshot, generation)) return;
  if (!autoSkipSettings.enabled) return;

  const matched = snapshot.artistIds.filter((artistId, index) => isAutoSkipStatus(statuses[index], artistId));
  if (matched.length === 0) {
    releaseAutoSkipStreak();   // a track was allowed to play - we are making progress
    return;
  }

  requestAutoSkip(snapshot, matched);
}


/**
 * Issues a skip for the given track, subject to the runaway guards.
 *
 * @param {{title: string, key: string}} snapshot - The track to skip.
 * @param {string[]} matched - The artist IDs that justified the skip, for logging.
 * @return {void}
 */
function requestAutoSkip(snapshot, matched) {
  if (autoSkipSuspended) return;
  if (autoSkipPendingKey !== null) return;                  // one skip in flight at a time
  if (autoSkipUnskippableKey === snapshot.key) return;       // "Next" already proved to be a no-op here

  if (autoSkipConsecutiveSkips >= AUTOSKIP_MAX_CONSECUTIVE_SKIPS) {
    autoSkipSuspended = true;
    console.warn(
      AUTOSKIP_LOG_PREFIX,
      `Stopped after ${autoSkipConsecutiveSkips} consecutive skips - letting "${snapshot.title}" play.`,
      'Auto-skip resumes when the settings change or a non-matching track plays.'
    );
    return;
  }

  autoSkipConsecutiveSkips += 1;
  autoSkipLastSkipAt = Date.now();
  autoSkipPendingKey = snapshot.key;
  console.log(AUTOSKIP_LOG_PREFIX, `Skipping "${snapshot.title}"`, matched);

  if (performAutoSkip()) {
    autoSkipVerifyTimeout = setTimeout(() => verifyAutoSkip(snapshot.key), AUTOSKIP_VERIFY_MS);
  } else {
    autoSkipUnskippableKey = snapshot.key;
    autoSkipPendingKey = null;
    console.warn(AUTOSKIP_LOG_PREFIX, 'The next-track control is unavailable; leaving the track alone.');
  }
}


/**
 * Clicks the player bar's next-track control.
 *
 * @return {boolean} True when a click was dispatched, false when the control is missing or disabled.
 * Notes:
 * - Going through YouTube Music's own control keeps queue order, shuffle, radio continuation
 *   and the play/pause state consistent - seeking the media element to its end does not, and
 *   loops forever under repeat-one.
 * - The control renders either as a `yt-icon-button` wrapping an inner <button> or as a
 *   `tp-yt-paper-icon-button` that *is* the button, so both shapes are handled.
 */
function performAutoSkip() {
  const host = document.querySelector(AUTOSKIP_NEXT_BUTTON_SELECTOR);
  if (!host) return false;
  if (host.hasAttribute('disabled') || host.getAttribute('aria-disabled') === 'true') return false;

  const target = host.querySelector('button') || host;
  target.click();
  return true;
}


/**
 * Checks, some time after a skip was issued, whether the track actually changed.
 *
 * @param {string} expectedKey - The track key that was playing when the skip was issued.
 * @return {void}
 * Notes:
 * - A still-identical track means "Next" was a no-op (last track of a queue, repeat-one, or a
 *   changed DOM contract). The key is latched as unskippable so the track is never retried in
 *   a tight loop; the streak counter is deliberately not reset, so failures do not buy attempts.
 */
function verifyAutoSkip(expectedKey) {
  autoSkipVerifyTimeout = null;
  autoSkipPendingKey = null;

  const snapshot = readAutoSkipSnapshot();
  if (!snapshot || snapshot.key !== expectedKey) return;   // the skip worked

  autoSkipUnskippableKey = expectedKey;
  const playerBar = document.querySelector('ytmusic-player-bar');
  console.warn(
    AUTOSKIP_LOG_PREFIX,
    'The track did not change after pressing Next; not retrying.',
    `repeat-mode=${playerBar ? playerBar.getAttribute('repeat-mode') : 'unknown'}`
  );
}


/**
 * Re-evaluates the track currently playing, ignoring the "already seen" guard.
 *
 * @return {void}
 */
function reevaluateAutoSkipTrack() {
  const snapshot = readAutoSkipSnapshot();
  if (!snapshot) return;

  autoSkipCommittedKey = snapshot.key;
  snapshot.wrapper.dataset[AUTOSKIP_TRACK_DATASET_KEY] = snapshot.key;
  evaluateAutoSkipTrack(snapshot, ++autoSkipGeneration);
}


/**
 * Applies a settings update and re-checks what is playing right now.
 *
 * @param {{enabled: boolean, categories: Object.<string, boolean>}} settings - The new settings.
 * @return {void}
 * Notes:
 * - Ticking a category while a matching track plays is a request to get rid of it now, so the
 *   current track is re-evaluated immediately rather than at the next track change. Un-ticking
 *   needs no special handling - the re-evaluation simply yields "don't skip".
 * - Clearing the latches here is what lets a settings change recover a suspended state.
 */
function handleAutoSkipSettingsChange(settings) {
  autoSkipSettings = settings;

  releaseAutoSkipStreak();
  autoSkipUnskippableKey = null;
  clearTimeout(autoSkipVerifyTimeout);
  autoSkipVerifyTimeout = null;
  autoSkipPendingKey = null;

  if (autoSkipSettings.enabled) reevaluateAutoSkipTrack();
}


/**
 * Attaches listeners to the current media element, if it changed.
 *
 * @return {void}
 * Notes:
 * - These events are latency accelerators only: `loadstart` often fires before the byline
 *   settles, so it cannot be the source of truth. Losing them costs delay, not correctness.
 */
function bindAutoSkipVideo() {
  const video = document.querySelector('video');
  if (!video || video === autoSkipVideo) return;

  autoSkipVideo = video;
  video.addEventListener('loadstart', () => scheduleAutoSkipRead());
  video.addEventListener('play', () => scheduleAutoSkipRead());
}


/**
 * Attaches the player-bar observer, re-attaching if the observed element was replaced.
 *
 * @return {void}
 * Notes:
 * - Scoped to `.content-info-wrapper` rather than the player bar, because `.time-info` ticks
 *   several times a second and lives in `#left-controls`; observing the whole bar with
 *   `characterData` would fire the callback continuously.
 * - `attributeFilter: ['href']` is needed because Polymer recycles the byline anchors and
 *   swaps their href in place, and `characterData` because a track change can swap nothing
 *   but the title's text node.
 */
function bindAutoSkipObserver() {
  bindAutoSkipVideo();

  const wrapper = document.querySelector(AUTOSKIP_CONTENT_INFO_SELECTOR);
  if (!wrapper) return;
  if (wrapper === autoSkipWrapper && wrapper.isConnected) return;

  if (autoSkipObserver) autoSkipObserver.disconnect();

  autoSkipWrapper = wrapper;
  autoSkipCommittedKey = null;   // force a fresh evaluation against the new element
  autoSkipObserver = new MutationObserver(() => scheduleAutoSkipRead());
  autoSkipObserver.observe(wrapper, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href'],
  });

  scheduleAutoSkipRead();
}


/**
 * Starts auto-skip once the initial settings are known.
 *
 * @param {{enabled: boolean, categories: Object.<string, boolean>}} settings - The stored settings.
 * @return {void}
 * Notes:
 * - Binding always ends with an immediate read, so attaching after the page has already started
 *   playing loses nothing - there is no event to have missed. That is what makes it safe to
 *   wait for the settings before starting, instead of buffering track changes.
 * - The watchdog covers the player bar not existing at document_idle and Polymer replacing the
 *   observed element later; it costs two querySelector calls per second.
 */
function startAutoSkip(settings) {
  autoSkipSettings = settings;
  subscribeToSettings(handleAutoSkipSettingsChange);

  bindAutoSkipObserver();
  setInterval(bindAutoSkipObserver, AUTOSKIP_WATCHDOG_MS);
}


loadSettings().then(startAutoSkip);
