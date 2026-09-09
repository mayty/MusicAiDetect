// This file has been created with the assistance of an AI tool.
// Binds the popup controls to the values stored in chrome.storage.
// Category names, labels and badge styling all come from settings.js, so adding a
// fifth badge category needs no change in this file.
//
// Two sources of truth coexist here, deliberately. The category toggles are read back out
// of the DOM (see readSettingsFromUi), because a checkbox already *is* its own state. The
// two artist lists are held in `popupNoSkipList` / `popupSkipHistory` and rendered from
// there, because their rows carry no state - they are just a view of stored data.


// Constants
const POPUP_LOADING_CLASS = 'is-loading';
const POPUP_TEMPLATE_ID = 'category-row-template';
const POPUP_GROUP_ID = 'category-group';
const POPUP_MASTER_ID = 'autoskip-enabled';
const POPUP_NOSKIP_TEMPLATE_ID = 'noskip-row-template';
const POPUP_NOSKIP_LIST_ID = 'noskip-list';
const POPUP_NOSKIP_EMPTY_ID = 'noskip-empty';
const POPUP_HISTORY_TEMPLATE_ID = 'history-row-template';
const POPUP_HISTORY_LIST_ID = 'history-list';
const POPUP_HISTORY_EMPTY_ID = 'history-empty';
const POPUP_ERROR_ID = 'popup-error';

const POPUP_SETTINGS_CONTROL_SELECTOR = `#${POPUP_GROUP_ID}, .popup-row.is-master`;
const POPUP_FULL_MESSAGE = 'The never-skip list is full. Remove an artist first.';
const POPUP_SAVE_MESSAGE = 'Could not save. Your change was not applied.';


// Global objects
let popupMasterToggle = null;
let popupCategoryGroup = null;
const popupCategoryToggles = new Map();   // category -> HTMLInputElement

let popupNoSkipList = mergeNoSkipList(null);
let popupSkipHistory = mergeSkipHistory(null);
let popupNoSkipListElement = null;
let popupNoSkipEmptyElement = null;
let popupHistoryListElement = null;
let popupHistoryEmptyElement = null;
let popupErrorElement = null;


/**
 * Builds one category row from the template.
 *
 * @param {"human"|"ai"|"unknown"|"associated"} category - The category the row represents.
 * @return {DocumentFragment} The populated row, ready to append.
 * Notes:
 * - The row is a wrapping <label>, so the input needs no id and cloning cannot produce
 *   duplicate ids. The whole row therefore acts as the click target.
 */
function buildCategoryRow(category) {
  const template = document.getElementById(POPUP_TEMPLATE_ID);
  const row = template.content.cloneNode(true);

  const badge = row.querySelector(`.${BADGE_CLASS}`);
  badge.classList.add(BADGE_EXTRA_CLASS[category]);
  badge.innerText = BADGE_TEXT[category];

  row.querySelector('.popup-row-label').innerText = CATEGORY_LABEL[category];
  popupCategoryToggles.set(category, row.querySelector('.popup-switch'));

  return row;
}


/**
 * Generates one row per category, in CATEGORY_ORDER.
 *
 * @return {void}
 */
function renderCategoryRows() {
  CATEGORY_ORDER.forEach(category => popupCategoryGroup.appendChild(buildCategoryRow(category)));
}


/**
 * Enables or dims the category rows to match the master toggle.
 *
 * @return {void}
 */
function updateMasterState() {
  popupCategoryGroup.disabled = !popupMasterToggle.checked;
}


/**
 * Reflects a settings object into the controls.
 *
 * @param {{enabled: boolean, categories: Object.<string, boolean>}} settings - The settings to show.
 * @return {void}
 */
function applySettings(settings) {
  popupMasterToggle.checked = settings.enabled;
  popupCategoryToggles.forEach((toggle, category) => {
    toggle.checked = settings.categories[category] === true;
  });

  updateMasterState();
}


/**
 * Reads the current state of the controls.
 *
 * @return {{enabled: boolean, categories: Object.<string, boolean>}} The settings shown in the popup.
 */
function readSettingsFromUi() {
  const categories = {};
  popupCategoryToggles.forEach((toggle, category) => {
    categories[category] = toggle.checked;
  });

  return { enabled: popupMasterToggle.checked, categories: categories };
}


/**
 * Persists the current control state whenever the user changes something.
 *
 * @param {Event} event - The change event.
 * @return {void}
 * Notes:
 * - Listens for 'change' rather than 'click' so keyboard activation is covered too.
 * - The listener is on document.body but writes the *settings* key unconditionally, so it has
 *   to establish first that the event came from a settings control. Without that guard, any
 *   form control added elsewhere in the popup would silently trigger a settings write.
 * - The master's dimming is applied synchronously, before the write, so it never waits on storage.
 * - Category selections are kept when the master is switched off, so switching it back on
 *   restores the user's picks. isSkippedCategory() gates on both, so this is safe.
 */
function handleSettingsChange(event) {
  if (!event.target.closest(POPUP_SETTINGS_CONTROL_SELECTOR)) return;

  if (event.target === popupMasterToggle) updateMasterState();

  saveSettings(readSettingsFromUi()).then(saved => {
    if (!saved) console.error('Auto-skip settings were not saved');
  });
}


/**
 * Shows a message in the popup's status line.
 *
 * @param {string} message - The message to show; an empty string hides the line.
 * @return {void}
 * Notes:
 * - A refused or failed write has to be visible. Unlike a toggle, which shows its own state, a
 *   button whose click was rejected leaves nothing on screen to tell the user it did nothing.
 */
function showPopupError(message) {
  popupErrorElement.innerText = message;
  popupErrorElement.hidden = message === '';
}


/**
 * Chooses what to show for an artist.
 *
 * @param {string} artistId - The artist's channel id.
 * @param {string} name - The stored name; may be empty.
 * @return {string} The name, or the id when no name was captured.
 * Notes:
 * - The player-bar byline populates asynchronously, so an artist can genuinely be recorded
 *   without a name. The id is ugly but identifies the row, and a later skip of the same artist
 *   upgrades it (see recordSkippedArtists).
 */
function getArtistDisplayName(artistId, name) {
  return name || artistId;
}


/**
 * Remembers which row action currently has focus.
 *
 * @return {{artistId: string, action: string}|null} A token for restorePopupFocus, or null.
 * Notes:
 * - The lists are rebuilt wholesale, including on a background tab's skip. Without this, a
 *   keyboard user's focus silently drops to <body> whenever a track is skipped elsewhere.
 */
function capturePopupFocus() {
  const activeElement = document.activeElement;
  const action = (activeElement && activeElement.closest) ? activeElement.closest('.popup-row-action') : null;
  if (!action) return null;

  const row = action.closest('.popup-row');
  return { artistId: row ? row.dataset.artistId : '', action: action.dataset.action };
}


/**
 * Restores focus to the equivalent row action after a rebuild.
 *
 * @param {{artistId: string, action: string}|null} token - The token from capturePopupFocus.
 * @return {void}
 * Notes:
 * - Does nothing when the row is gone, which is the normal outcome of the user's own click:
 *   promoting an artist removes their history row. Chasing focus across sections in that case
 *   would move it somewhere the user did not ask for.
 */
function restorePopupFocus(token) {
  if (!token || !token.artistId) return;

  const row = document.querySelector(`.popup-row[data-artist-id="${CSS.escape(token.artistId)}"]`);
  const action = row ? row.querySelector(`[data-action="${token.action}"]`) : null;
  if (action) action.focus();
}


/**
 * Replaces the contents of one artist list, keeping its scroll position.
 *
 * @param {HTMLElement} listElement - The list container.
 * @param {HTMLElement} emptyElement - The paragraph shown when there is nothing to list.
 * @param {DocumentFragment[]} rows - The rows to show.
 * @return {void}
 */
function replacePopupRows(listElement, emptyElement, rows) {
  const scrollTop = listElement.scrollTop;

  listElement.replaceChildren();
  rows.forEach(row => listElement.appendChild(row));

  listElement.hidden = rows.length === 0;
  emptyElement.hidden = rows.length !== 0;
  listElement.scrollTop = scrollTop;
}


/**
 * Builds one never-skip row from the template.
 *
 * @param {string} artistId - The artist's channel id.
 * @param {string} name - The stored name; may be empty.
 * @return {DocumentFragment} The populated row, ready to append.
 */
function buildNoSkipRow(artistId, name) {
  const row = document.getElementById(POPUP_NOSKIP_TEMPLATE_ID).content.cloneNode(true);
  const displayName = getArtistDisplayName(artistId, name);

  const rowElement = row.querySelector('.popup-row');
  rowElement.dataset.artistId = artistId;
  rowElement.querySelector('.popup-row-label').innerText = displayName;
  rowElement.querySelector('.popup-row-action')
    .setAttribute('aria-label', `Remove ${displayName} from the never-skip list`);

  return row;
}


/**
 * Builds one skip-history row from the template.
 *
 * @param {{id: string, name: string, status: string, at: number}} entry - The history entry.
 * @return {DocumentFragment} The populated row, ready to append.
 * Notes:
 * - The badge shows why the track was skipped at the time. mergeSkipHistory drops entries with
 *   an unknown status, which is what keeps BADGE_EXTRA_CLASS[status] from being undefined here.
 */
function buildHistoryRow(entry) {
  const row = document.getElementById(POPUP_HISTORY_TEMPLATE_ID).content.cloneNode(true);
  const displayName = getArtistDisplayName(entry.id, entry.name);

  const badge = row.querySelector(`.${BADGE_CLASS}`);
  badge.classList.add(BADGE_EXTRA_CLASS[entry.status]);
  badge.innerText = BADGE_TEXT[entry.status];

  const rowElement = row.querySelector('.popup-row');
  rowElement.dataset.artistId = entry.id;
  rowElement.querySelector('.popup-row-label').innerText = displayName;
  rowElement.querySelector('.popup-row-action').setAttribute('aria-label', `Never skip ${displayName}`);

  return row;
}


/**
 * Renders both artist lists from the values currently held in memory.
 *
 * @return {void}
 * Notes:
 * - The never-skip section is rendered from the list alone, never from the history: it syncs
 *   across devices and may name artists this device has never skipped.
 * - The history is *filtered* by the never-skip list rather than having promoted artists
 *   removed from it. That is what makes promotion reversible - taking an artist off the
 *   never-skip list puts them back in the history at their original position.
 * - Sorted by name, because the never-skip list is stored as a map and has no insertion order.
 */
function renderArtistSections() {
  const focusToken = capturePopupFocus();

  const noSkipRows = Object.keys(popupNoSkipList)
    .sort((left, right) => getArtistDisplayName(left, popupNoSkipList[left])
      .localeCompare(getArtistDisplayName(right, popupNoSkipList[right])))
    .map(artistId => buildNoSkipRow(artistId, popupNoSkipList[artistId]));
  replacePopupRows(popupNoSkipListElement, popupNoSkipEmptyElement, noSkipRows);

  const historyRows = popupSkipHistory
    .filter(entry => !isNoSkipArtist(popupNoSkipList, entry.id))
    .map(buildHistoryRow);
  replacePopupRows(popupHistoryListElement, popupHistoryEmptyElement, historyRows);

  restorePopupFocus(focusToken);
}


/**
 * Renders a new never-skip list and persists it.
 *
 * @param {Object.<string, string>} noSkipList - The list to store.
 * @return {Promise<void>} Resolves once the write has been attempted.
 * Notes:
 * - Renders first and reconciles afterwards, so the button feels immediate. A failed write
 *   reloads from storage rather than keeping the optimistic view, so the popup can never show
 *   a state that was not persisted.
 */
async function commitNoSkipList(noSkipList) {
  showPopupError('');
  popupNoSkipList = mergeNoSkipList(noSkipList);
  renderArtistSections();

  if (await saveNoSkipList(popupNoSkipList)) return;

  showPopupError(POPUP_SAVE_MESSAGE);
  popupNoSkipList = await loadNoSkipList();
  renderArtistSections();
}


/**
 * Adds an artist from the history to the never-skip list.
 *
 * @param {string} artistId - The artist to add.
 * @return {Promise<void>} Resolves once the write has been attempted.
 * Notes:
 * - The size is checked before writing rather than after a rejected write, because
 *   chrome.storage.sync reports a quota overflow only by failing, and a silently failed click
 *   is indistinguishable from a broken button. QUOTA_BYTES_PER_ITEM counts bytes, so a list of
 *   names in a non-Latin script fills up at a third of the character count.
 */
async function addToNoSkipList(artistId) {
  const entry = popupSkipHistory.find(historyEntry => historyEntry.id === artistId);
  if (!entry) return;

  const noSkipList = Object.assign({}, popupNoSkipList, { [artistId]: entry.name });
  const isTooLarge = Object.keys(noSkipList).length > NOSKIP_LIST_LIMIT
    || measureStoredSize(NOSKIP_KEY, noSkipList) > NOSKIP_BYTE_BUDGET;

  if (isTooLarge) {
    showPopupError(POPUP_FULL_MESSAGE);
    return;
  }

  await commitNoSkipList(noSkipList);
}


/**
 * Removes an artist from the never-skip list.
 *
 * @param {string} artistId - The artist to remove.
 * @return {Promise<void>} Resolves once the write has been attempted.
 */
async function removeFromNoSkipList(artistId) {
  const noSkipList = Object.assign({}, popupNoSkipList);
  delete noSkipList[artistId];

  await commitNoSkipList(noSkipList);
}


/**
 * Empties the skip history.
 *
 * @return {Promise<void>} Resolves once the write has been attempted.
 * Notes:
 * - Deliberately leaves the never-skip list alone: it is a set of decisions the user made, not
 *   a record of what happened.
 */
async function clearSkipHistory() {
  showPopupError('');
  popupSkipHistory = [];
  renderArtistSections();

  if (await saveSkipHistory(popupSkipHistory)) return;

  showPopupError(POPUP_SAVE_MESSAGE);
  popupSkipHistory = await loadSkipHistory();
  renderArtistSections();
}


/**
 * Routes a click on any of the popup's buttons.
 *
 * @param {Event} event - The click event.
 * @return {void}
 * Notes:
 * - Matching on [data-action] rather than on a class keeps this handler from swallowing the
 *   clicks that reach the category rows, which are <label>s wrapping their checkbox.
 */
function handlePopupClick(event) {
  const action = event.target.closest('[data-action]');
  if (!action) return;

  const row = action.closest('.popup-row');
  const artistId = row ? row.dataset.artistId : '';

  switch (action.dataset.action) {
    case 'add-noskip':
      addToNoSkipList(artistId);
      break;
    case 'remove-noskip':
      removeFromNoSkipList(artistId);
      break;
    case 'clear-history':
      clearSkipHistory();
      break;
  }
}


/**
 * Renders the popup and wires it to storage.
 *
 * @return {Promise<void>} Resolves once the stored values are on screen.
 * Notes:
 * - The popup deliberately does not subscribeToSettings() or subscribeToNoSkipList(): it is the
 *   only writer of both, and chrome.storage.onChanged echoes a write back to its author, which
 *   could stomp a control the user is in the middle of operating.
 * - The skip history is different, and is subscribed to: a background tab writes it whenever it
 *   skips a track, and the popup only ever writes it by clearing, where an echo is idempotent.
 * - The three loads run together because .popup.is-loading hides the whole popup until they all
 *   land, so awaiting them one after another would only be slower.
 */
async function initializePopup() {
  popupMasterToggle = document.getElementById(POPUP_MASTER_ID);
  popupCategoryGroup = document.getElementById(POPUP_GROUP_ID);
  popupNoSkipListElement = document.getElementById(POPUP_NOSKIP_LIST_ID);
  popupNoSkipEmptyElement = document.getElementById(POPUP_NOSKIP_EMPTY_ID);
  popupHistoryListElement = document.getElementById(POPUP_HISTORY_LIST_ID);
  popupHistoryEmptyElement = document.getElementById(POPUP_HISTORY_EMPTY_ID);
  popupErrorElement = document.getElementById(POPUP_ERROR_ID);

  renderCategoryRows();

  const [settings, noSkipList, skipHistory] = await Promise.all([
    loadSettings(),
    loadNoSkipList(),
    loadSkipHistory()
  ]);

  applySettings(settings);
  popupNoSkipList = noSkipList;
  popupSkipHistory = skipHistory;
  renderArtistSections();

  subscribeToSkipHistory(history => {
    popupSkipHistory = history;
    renderArtistSections();
  });

  document.body.addEventListener('change', handleSettingsChange);
  document.body.addEventListener('click', handlePopupClick);
  document.body.classList.remove(POPUP_LOADING_CLASS);
}


document.addEventListener('DOMContentLoaded', initializePopup);
