// This file has been created with the assistance of an AI tool.
// --- SHARED GLOBALS ---
// This file is loaded twice: as the first content script (before content.js and
// autoskip.js) and as a plain script in popup.html. All content scripts of one
// extension share a single global lexical scope, so every top-level name below is
// global in both contexts - never redeclare any of them in another file, or that
// file dies with a SyntaxError before its first statement runs.
//
// Three values are persisted, under three keys:
//   'autoskip'    (sync)  - the master toggle and the per-category picks
//   'noskip'      (sync)  - the never-skip list, an artist id -> name map
//   'skipHistory' (local) - every artist credited on a skipped track, most recent first


// Constants
const BADGE_CLASS = 'artist-badge';
const BADGE_TEXT = {
  'human': 'H',
  'ai': 'AI',
  'unknown': '?',
  'associated': 'AI'   /* same icon/label as AI, distinguished by the dim-blue color */
}
const BADGE_EXTRA_CLASS = {
  'human': 'is-human',
  'ai': 'is-ai',
  'unknown': 'is-unknown',
  'associated': 'is-associated'
}
const CATEGORY_ORDER = ['ai', 'associated', 'unknown', 'human'];
const CATEGORY_LABEL = {
  'human': 'Human',
  'ai': 'AI artist',
  'unknown': 'Unknown',
  'associated': 'AI-associated'
}

const SETTINGS_KEY = 'autoskip';
const DEFAULT_SETTINGS = {
  enabled: false,
  categories: {
    'ai': false,
    'associated': false,
    'unknown': false,
    'human': false
  }
}

const NOSKIP_KEY = 'noskip';
const SKIP_HISTORY_KEY = 'skipHistory';
const SKIP_HISTORY_LIMIT = 100;
const NOSKIP_LIST_LIMIT = 200;    /* cheap secondary guard - NOSKIP_BYTE_BUDGET is the real one */
const NOSKIP_BYTE_BUDGET = 7500;  /* sync's QUOTA_BYTES_PER_ITEM is 8192 for the key plus the serialized value */
const ARTIST_NAME_LIMIT = 64;     /* a CJK name is 3 bytes per character, so a character cap is not a byte cap */


// Global objects
let skipHistoryWriteChain = Promise.resolve();   // serializes read-modify-write of the history


/**
 * Resolves a storage area name to the area object.
 *
 * @param {"sync"|"local"} areaName - The storage area to use.
 * @return {chrome.storage.StorageArea} The area object.
 * @throws {Error} Throws when the name does not resolve to a usable area.
 * Notes:
 * - Throwing here rather than returning undefined keeps a typo'd area name inside the
 *   try/catch of loadStoredValue, which turns it into "resolve to defaults" instead of an
 *   unhandled TypeError on the playback hot path.
 */
function getStorageArea(areaName) {
  const area = chrome.storage[areaName];
  if (!area || typeof area.get !== 'function') throw new Error(`Unknown storage area '${areaName}'`);

  return area;
}


/**
 * Reads one key from one storage area and normalizes it.
 *
 * @param {"sync"|"local"} areaName - The storage area to read from.
 * @param {string} key - The key to read.
 * @param {function(*): T} merge - Normalizes the raw stored value into a complete one.
 * @return {Promise<T>} A promise resolving to the normalized value.
 * @template T
 * Notes:
 * - Never rejects. A failed read resolves to `merge(undefined)`, so callers on the playback
 *   hot path never have to guard against a rejected promise.
 */
async function loadStoredValue(areaName, key, merge) {
  try {
    const stored = await getStorageArea(areaName).get(key);
    return merge(stored[key]);
  } catch (error) {
    console.error(`Failed to read '${key}'`, error);
    return merge(undefined);
  }
}


/**
 * Writes one key into one storage area.
 *
 * @param {"sync"|"local"} areaName - The storage area to write to.
 * @param {string} key - The key to write.
 * @param {*} value - The value to store; callers normalize it first.
 * @return {Promise<boolean>} A promise resolving to `true` on success, `false` if the write failed.
 * Notes:
 * - A sync write fails when the value exceeds QUOTA_BYTES_PER_ITEM, so the `false` return is a
 *   real case for the never-skip list, not just defensive noise.
 */
async function saveStoredValue(areaName, key, value) {
  try {
    await getStorageArea(areaName).set({ [key]: value });
    return true;
  } catch (error) {
    console.error(`Failed to save '${key}'`, error);
    return false;
  }
}


/**
 * Subscribes to external changes of one key in one storage area.
 *
 * @param {"sync"|"local"} areaName - The storage area to watch.
 * @param {string} key - The key to watch.
 * @param {function(*): T} merge - Normalizes the raw new value.
 * @param {function(T): void} callback - Invoked with the normalized value on every change.
 * @return {function(): void} A function that removes the listener.
 * @template T
 * Notes:
 * - The callback is NOT invoked with the current value; call the matching loader for that.
 * - Tests `hasOwnProperty` rather than truth-testing `newValue`, because a *removal* delivers
 *   no `newValue` at all and must still normalize to an empty value.
 * - chrome.storage.onChanged echoes a write back to the writer, so a sole writer of a key
 *   deliberately does not subscribe to it.
 */
function subscribeToStoredValue(areaName, key, merge, callback) {
  const listener = (changes, changedArea) => {
    if (changedArea !== areaName) return;
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return;

    callback(merge(changes[key].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}


/**
 * Measures the storage footprint of one key/value pair.
 *
 * @param {string} key - The key it would be stored under.
 * @param {*} value - The value to measure.
 * @return {number} The size in bytes, or Infinity when the value cannot be serialized.
 * Notes:
 * - chrome.storage.sync charges the key name plus the JSON serialization of the value against
 *   QUOTA_BYTES_PER_ITEM, and counts bytes rather than characters - a name in a non-Latin
 *   script costs up to three times its length.
 */
function measureStoredSize(key, value) {
  try {
    return new TextEncoder().encode(key + JSON.stringify(value)).length;
  } catch (error) {
    console.error('Failed to measure a stored value', error);
    return Infinity;
  }
}


/**
 * Coerces an artist name into a safe, bounded string.
 *
 * @param {*} raw - The value to coerce; may be of any type, including undefined.
 * @return {string} A trimmed name of at most ARTIST_NAME_LIMIT characters, possibly empty.
 * Notes:
 * - An empty result is legitimate: the player-bar byline populates asynchronously, so a name
 *   can genuinely be unknown at the moment a skip is recorded. Callers render `name || id`.
 */
function clampArtistName(raw) {
  if (typeof raw !== 'string') return '';

  return raw.trim().slice(0, ARTIST_NAME_LIMIT);
}


/**
 * Tests whether a value looks like a YouTube channel id.
 *
 * @param {*} raw - The value to test.
 * @return {boolean} True for a 'UC'-prefixed string.
 * Notes:
 * - Matches the acceptance rule in getArtistIdFromLink, so a stored id can only be one this
 *   extension could have produced.
 */
function isArtistId(raw) {
  return typeof raw === 'string' && raw.startsWith('UC');
}


/**
 * Merges a raw stored value with DEFAULT_SETTINGS, producing a complete settings object.
 *
 * @param {*} raw - The value read from chrome.storage.sync; may be of any shape, including undefined.
 * @return {{enabled: boolean, categories: Object.<string, boolean>}} A normalized settings object.
 * Notes:
 * - Iterates over the *default* keys, so keys written by a newer version are dropped and
 *   keys missing from an older version are filled in. Adding a fifth badge category therefore
 *   needs no migration - old payloads simply lack the key and default to `false`.
 * - Coerces with a strict `=== true`, so a non-boolean stored value can never enable skipping.
 */
function mergeSettings(raw) {
  const source = (raw && typeof raw === 'object') ? raw : {};
  const storedCategories = (source.categories && typeof source.categories === 'object') ? source.categories : {};

  const categories = {};
  Object.keys(DEFAULT_SETTINGS.categories).forEach(category => {
    categories[category] = storedCategories[category] === true;
  });

  return { enabled: source.enabled === true, categories: categories };
}


/**
 * Normalizes a raw stored value into the never-skip list.
 *
 * @param {*} raw - The value read from chrome.storage.sync; may be of any shape, including undefined.
 * @return {Object.<string, string>} A map of artist id -> display name.
 * Notes:
 * - A map rather than a list of objects: membership is the hot-path operation, it de-duplicates
 *   for free, and it costs ~25% fewer bytes against the 8KB sync item quota. Display order is
 *   derived in the popup, not stored.
 * - Names are stored, not just ids, because this key syncs across devices and may name artists
 *   this device has never skipped and therefore cannot look up in its history.
 * - Capped on read as well as on write, so a hand-edited store cannot produce an endless render.
 */
function mergeNoSkipList(raw) {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const noSkipList = {};
  Object.keys(source).slice(0, NOSKIP_LIST_LIMIT).forEach(artistId => {
    if (isArtistId(artistId)) noSkipList[artistId] = clampArtistName(source[artistId]);
  });

  return noSkipList;
}


/**
 * Normalizes a raw stored value into the skip history.
 *
 * @param {*} raw - The value read from chrome.storage.local; may be of any shape, including undefined.
 * @return {Array.<{id: string, name: string, status: string, at: number}>}
 *   The history, most recent first, de-duplicated and capped.
 * Notes:
 * - An entry whose status is not a known category is dropped rather than defaulted: the popup
 *   renders BADGE_EXTRA_CLASS[status] into classList.add(), which throws on undefined.
 * - De-duplicates keeping the *first* occurrence, which is the most recent one.
 */
function mergeSkipHistory(raw) {
  const source = Array.isArray(raw) ? raw : [];

  const history = [];
  const seenIds = new Set();
  source.forEach(rawEntry => {
    if (history.length >= SKIP_HISTORY_LIMIT) return;

    const entry = (rawEntry && typeof rawEntry === 'object') ? rawEntry : {};
    if (!isArtistId(entry.id) || seenIds.has(entry.id)) return;
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, entry.status)) return;

    seenIds.add(entry.id);
    history.push({
      id: entry.id,
      name: clampArtistName(entry.name),
      status: entry.status,
      at: Number.isFinite(entry.at) ? entry.at : 0
    });
  });

  return history;
}


/**
 * Reads the auto-skip settings from chrome.storage.sync.
 *
 * @return {Promise<{enabled: boolean, categories: Object.<string, boolean>}>}
 *   A promise resolving to normalized settings. Never rejects.
 */
function loadSettings() {
  return loadStoredValue('sync', SETTINGS_KEY, mergeSettings);
}


/**
 * Writes the auto-skip settings to chrome.storage.sync under SETTINGS_KEY.
 *
 * @param {{enabled: boolean, categories: Object.<string, boolean>}} settings - The settings to persist.
 * @return {Promise<boolean>} A promise resolving to `true` on success, `false` if the write failed.
 * Notes:
 * - The value is normalized before writing, so a partial object is safe to pass.
 */
function saveSettings(settings) {
  return saveStoredValue('sync', SETTINGS_KEY, mergeSettings(settings));
}


/**
 * Subscribes to external changes of the auto-skip settings.
 *
 * @param {function({enabled: boolean, categories: Object.<string, boolean>}): void} callback -
 *   Invoked with normalized settings whenever the stored value changes or is removed.
 * @return {function(): void} A function that removes the listener.
 */
function subscribeToSettings(callback) {
  return subscribeToStoredValue('sync', SETTINGS_KEY, mergeSettings, callback);
}


/**
 * Reads the never-skip list from chrome.storage.sync.
 *
 * @return {Promise<Object.<string, string>>} A promise resolving to an artist id -> name map. Never rejects.
 */
function loadNoSkipList() {
  return loadStoredValue('sync', NOSKIP_KEY, mergeNoSkipList);
}


/**
 * Writes the never-skip list to chrome.storage.sync under NOSKIP_KEY.
 *
 * @param {Object.<string, string>} noSkipList - The list to persist.
 * @return {Promise<boolean>} A promise resolving to `true` on success, `false` if the write failed.
 * Notes:
 * - A `false` here most likely means QUOTA_BYTES_PER_ITEM was exceeded. Callers should surface
 *   that to the user rather than swallow it - unlike a toggle, a refused add leaves no visible
 *   trace that the click did nothing.
 */
function saveNoSkipList(noSkipList) {
  return saveStoredValue('sync', NOSKIP_KEY, mergeNoSkipList(noSkipList));
}


/**
 * Subscribes to external changes of the never-skip list.
 *
 * @param {function(Object.<string, string>): void} callback - Invoked with the normalized list on every change.
 * @return {function(): void} A function that removes the listener.
 */
function subscribeToNoSkipList(callback) {
  return subscribeToStoredValue('sync', NOSKIP_KEY, mergeNoSkipList, callback);
}


/**
 * Reads the skip history from chrome.storage.local.
 *
 * @return {Promise<Array.<{id: string, name: string, status: string, at: number}>>}
 *   A promise resolving to the history, most recent first. Never rejects.
 */
function loadSkipHistory() {
  return loadStoredValue('local', SKIP_HISTORY_KEY, mergeSkipHistory);
}


/**
 * Writes the skip history to chrome.storage.local under SKIP_HISTORY_KEY.
 *
 * @param {Array.<{id: string, name: string, status: string, at: number}>} history - The history to persist.
 * @return {Promise<boolean>} A promise resolving to `true` on success, `false` if the write failed.
 * Notes:
 * - Normalizing on write is what enforces SKIP_HISTORY_LIMIT, so callers may pass a longer array.
 * - Deliberately in `local`: the history is per-device, it grows without a useful bound, and
 *   sync's write-rate quota is shared with the settings key.
 */
function saveSkipHistory(history) {
  return saveStoredValue('local', SKIP_HISTORY_KEY, mergeSkipHistory(history));
}


/**
 * Subscribes to external changes of the skip history.
 *
 * @param {function(Array.<{id: string, name: string, status: string, at: number}>): void} callback -
 *   Invoked with the normalized history on every change.
 * @return {function(): void} A function that removes the listener.
 */
function subscribeToSkipHistory(callback) {
  return subscribeToStoredValue('local', SKIP_HISTORY_KEY, mergeSkipHistory, callback);
}


/**
 * Records the artists credited on a skipped track, moving them to the front of the history.
 *
 * @param {Array.<{id: string, name: string, status: string}>} entries - The artists to record,
 *   in the order they should appear; the caller leads with the ones that caused the skip.
 * @return {Promise<void>} Resolves once the write has been attempted. Never rejects.
 * Notes:
 * - An upsert, not an append: an artist already in the history is moved to the front with a
 *   refreshed timestamp and status, so the list stays ordered by *last* skipped.
 * - Never downgrades a known name to an empty one. The byline populates asynchronously, so a
 *   later skip of the same artist can legitimately carry no name.
 * - Serialized through a module-level promise chain, with the read inside the queued task, so
 *   two skips seconds apart in one tab cannot interleave their read-modify-write and lose an
 *   entry. Two *tabs* skipping in the same instant still can; the history is advisory and that
 *   is not worth a service worker.
 */
function recordSkippedArtists(entries) {
  skipHistoryWriteChain = skipHistoryWriteChain.then(async () => {
    const now = Date.now();
    const source = Array.isArray(entries) ? entries : [];
    const recorded = mergeSkipHistory(source.map(entry => Object.assign({}, entry, { at: now })));
    if (recorded.length === 0) return;

    const stored = await loadSkipHistory();
    const recordedIds = new Set(recorded.map(entry => entry.id));

    const promoted = recorded.map(entry => {
      if (entry.name !== '') return entry;

      const previous = stored.find(storedEntry => storedEntry.id === entry.id);
      return (previous && previous.name !== '') ? Object.assign({}, entry, { name: previous.name }) : entry;
    });

    await saveSkipHistory(promoted.concat(stored.filter(entry => !recordedIds.has(entry.id))));
  }).catch(error => console.error('Failed to record skipped artists', error));

  return skipHistoryWriteChain;
}


/**
 * Determines whether a given artist status should be auto-skipped under the given settings.
 *
 * @param {{enabled: boolean, categories: Object.<string, boolean>}} settings - The current settings.
 * @param {"human"|"ai"|"unknown"|"associated"} status - The artist status to test.
 * @return {boolean} True when the master toggle is on and the category is selected.
 */
function isSkippedCategory(settings, status) {
  return settings.enabled === true && settings.categories[status] === true;
}


/**
 * Determines whether an artist is on the never-skip list.
 *
 * @param {Object.<string, string>} noSkipList - The current never-skip list.
 * @param {string} artistId - The artist to test.
 * @return {boolean} True when the artist is listed.
 * Notes:
 * - Uses hasOwnProperty rather than a truth test, so an artist stored with an empty name -
 *   which happens when the byline had not populated when they were recorded - still counts.
 */
function isNoSkipArtist(noSkipList, artistId) {
  return Object.prototype.hasOwnProperty.call(noSkipList, artistId);
}
