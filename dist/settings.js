// This file has been created with the assistance of an AI tool.
// --- SHARED GLOBALS ---
// This file is loaded twice: as the first content script (before content.js and
// autoskip.js) and as a plain script in popup.html. All content scripts of one
// extension share a single global lexical scope, so every top-level name below is
// global in both contexts - never redeclare any of them in another file, or that
// file dies with a SyntaxError before its first statement runs.


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
 * Reads the auto-skip settings from chrome.storage.sync.
 *
 * @return {Promise<{enabled: boolean, categories: Object.<string, boolean>}>}
 *   A promise resolving to normalized settings.
 * Notes:
 * - Never rejects. A failed read resolves to the defaults, so callers on the playback
 *   hot path never have to guard against a rejected promise.
 */
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    return mergeSettings(stored[SETTINGS_KEY]);
  } catch (error) {
    console.error('Failed to read settings', error);
    return mergeSettings(null);
  }
}


/**
 * Writes the auto-skip settings to chrome.storage.sync under SETTINGS_KEY.
 *
 * @param {{enabled: boolean, categories: Object.<string, boolean>}} settings - The settings to persist.
 * @return {Promise<boolean>} A promise resolving to `true` on success, `false` if the write failed.
 * Notes:
 * - The value is normalized before writing, so a partial object is safe to pass.
 */
async function saveSettings(settings) {
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: mergeSettings(settings) });
    return true;
  } catch (error) {
    console.error('Failed to save settings', error);
    return false;
  }
}


/**
 * Subscribes to external changes of the auto-skip settings.
 *
 * @param {function({enabled: boolean, categories: Object.<string, boolean>}): void} callback -
 *   Invoked with normalized settings whenever the stored value changes or is removed.
 * @return {function(): void} A function that removes the listener.
 * Notes:
 * - The callback is NOT invoked with the current value; call loadSettings() for that.
 * - chrome.storage.onChanged echoes a write back to the writer, so the popup - the only
 *   writer - deliberately does not subscribe.
 */
function subscribeToSettings(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!Object.prototype.hasOwnProperty.call(changes, SETTINGS_KEY)) return;

    callback(mergeSettings(changes[SETTINGS_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
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
