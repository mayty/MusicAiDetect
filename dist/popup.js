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
const POPUP_GROUP_ID = 'category-group';
const POPUP_CATEGORY_SECTION = 'categories';

const POPUP_SECTION_SELECTOR = '.popup-section';
const POPUP_SECTION_TOGGLE_SELECTOR = '.popup-section-toggle';
const POPUP_SECTION_PANEL_SELECTOR = '.popup-section-panel';
const POPUP_SETTINGS_CONTROL_SELECTOR = `#${POPUP_GROUP_ID}, .popup-row.is-master`;
const POPUP_ROW_LINK_SELECTOR = '.popup-row-label[href]';
const POPUP_ROW_FOCUS_SELECTOR = `.popup-row-action, ${POPUP_ROW_LINK_SELECTOR}`;
const POPUP_LINK_FOCUS_TOKEN = 'name';   /* stands in for [data-action] on the row's name link */
const POPUP_FULL_MESSAGE = 'The never-skip list is full. Remove an artist first.';
const POPUP_SAVE_MESSAGE = 'Could not save. Your change was not applied.';
const POPUP_TAB_MESSAGE = 'Could not open the artist page. Try a plain click instead.';


// Global objects
let popupMasterToggle = null;
const popupCategoryToggles = new Map();   // category -> HTMLInputElement

let popupNoSkipList = mergeNoSkipList(null);
let popupSkipHistory = mergeSkipHistory(null);
let popupNoSkipListElement = null;
let popupNoSkipEmptyElement = null;
let popupHistoryListElement = null;
let popupHistoryEmptyElement = null;
let popupErrorElement = null;
let popupSectionsElement = null;
let popupCategoryCountElement = null;
let popupNoSkipCountElement = null;
let popupHistoryCountElement = null;


/** Applies a category's badge colour and letter to the .artist-badge inside `root`. */
function fillBadge(root, status) {
  const badge = root.querySelector(BADGE_QUERY);

  badge.classList.add(BADGE_EXTRA_CLASS[status]);
  badge.innerText = BADGE_TEXT[status];
}


/**
 * Builds one category row from the template.
 *
 * The row is a wrapping <label>, so the input needs no id and cloning cannot produce duplicate
 * ids. The whole row therefore acts as the click target.
 */
function buildCategoryRow(category) {
  const row = document.getElementById('category-row-template').content.cloneNode(true);

  fillBadge(row, category);
  row.querySelector('.popup-row-label').innerText = CATEGORY_LABEL[category];
  popupCategoryToggles.set(category, row.querySelector('.popup-switch'));

  return row;
}


/** Generates one row per category, in CATEGORY_ORDER. */
function renderCategoryRows() {
  const group = document.getElementById(POPUP_GROUP_ID);

  CATEGORY_ORDER.forEach(category => group.appendChild(buildCategoryRow(category)));
}


/**
 * Expands one section and collapses the other two.
 *
 * @param {string} sectionName - The data-section value to expand; '' collapses all of them.
 * @return {void}
 * Notes:
 * - At most one section is open at a time because the popup is 300px wide and Chrome caps it
 *   near 600px tall: two open lists would push the master toggle off screen.
 * - Single-open by construction rather than by closing a remembered previous section, so the
 *   popup cannot end up showing two open panels if one state update is ever missed.
 * - The state lives in the DOM, for the same reason the category toggles do: aria-expanded is
 *   what assistive technology reads and what rotates the caret in CSS, so it *is* the state and
 *   there is no second copy to drift out of step.
 * - Nothing is persisted; every section starts collapsed from the hidden attributes in popup.html.
 */
function expandPopupSection(sectionName) {
  popupSectionsElement.querySelectorAll(POPUP_SECTION_SELECTOR).forEach(section => {
    const isExpanded = section.dataset.section === sectionName;

    section.querySelector(POPUP_SECTION_TOGGLE_SELECTOR)
      .setAttribute('aria-expanded', String(isExpanded));
    section.querySelector(POPUP_SECTION_PANEL_SELECTOR).hidden = !isExpanded;
  });
}


/**
 * Opens the section a header button belongs to, or closes it when it is already open: one open
 * section is the maximum, not the minimum. Reads the current state back off aria-expanded.
 */
function togglePopupSection(toggle) {
  const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
  const section = toggle.closest(POPUP_SECTION_SELECTOR);

  expandPopupSection(isExpanded ? '' : section.dataset.section);
}


/**
 * Writes the item count onto each section header.
 *
 * A collapsed section shows nothing at all, so the count is what tells the user whether opening
 * it is worth the click. A zero renders as no text rather than '0' - the panel's own empty
 * paragraph already says it. The history count applies the same never-skip filter
 * renderArtistSections() does, so the number always matches the rows behind the header.
 */
function updatePopupSectionCounts() {
  const categoryCount = Array.from(popupCategoryToggles.values())
    .filter(toggle => toggle.checked).length;
  const noSkipCount = Object.keys(popupNoSkipList).length;
  const historyCount = popupSkipHistory
    .filter(entry => !isNoSkipArtist(popupNoSkipList, entry.id)).length;

  popupCategoryCountElement.innerText = categoryCount === 0 ? '' : String(categoryCount);
  popupNoSkipCountElement.innerText = noSkipCount === 0 ? '' : String(noSkipCount);
  popupHistoryCountElement.innerText = historyCount === 0 ? '' : String(historyCount);
}


/**
 * Shows or hides the settings sections to match the master toggle.
 *
 * Hidden, never removed: readSettingsFromUi() reads the category checkboxes straight out of the
 * DOM, so detaching them would report every category as false and wipe the user's picks on the
 * next write. display:none leaves .checked alone, which is what makes this safe.
 */
function updateMasterState() {
  popupSectionsElement.hidden = !popupMasterToggle.checked;

  if (!popupMasterToggle.checked) expandPopupSection('');
}


/** Reflects a settings object into the controls. */
function applySettings(settings) {
  popupMasterToggle.checked = settings.enabled;
  popupCategoryToggles.forEach((toggle, category) => {
    toggle.checked = settings.categories[category] === true;
  });

  updateMasterState();
  updatePopupSectionCounts();
}


/** Reads the current state of the controls. */
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
 * - Category selections are kept when the master is switched off, so switching it back on
 *   restores the user's picks. isSkippedCategory() gates on both, so this is safe.
 * - Switching auto-skip on opens "Skip these categories", because that is the choice which makes
 *   the toggle do anything: enabled with no category ticked is a no-op. It lives here rather than
 *   in updateMasterState() because applySettings() calls that on every popup open, where every
 *   section is meant to start collapsed.
 */
function handleSettingsChange(event) {
  if (!event.target.closest(POPUP_SETTINGS_CONTROL_SELECTOR)) return;

  if (event.target === popupMasterToggle) {
    updateMasterState();
    if (popupMasterToggle.checked) expandPopupSection(POPUP_CATEGORY_SECTION);
  }

  updatePopupSectionCounts();

  saveSettings(readSettingsFromUi()).then(saved => {
    if (!saved) console.error('Auto-skip settings were not saved');
  });
}


/**
 * Shows a message in the popup's status line; an empty string hides it.
 *
 * A refused or failed write has to be visible. Unlike a toggle, which shows its own state, a
 * button whose click was rejected leaves nothing on screen to tell the user it did nothing.
 */
function showPopupError(message) {
  popupErrorElement.innerText = message;
  popupErrorElement.hidden = message === '';
}


/**
 * The artist's name, or their id when no name was captured.
 *
 * The player-bar byline populates asynchronously, so an artist can genuinely be recorded without
 * a name. The id is ugly but identifies the row, and a later skip upgrades it (recordSkippedArtists).
 */
function getArtistDisplayName(artistId, name) {
  return name || artistId;
}


/**
 * Builds the YouTube Music channel URL for an artist, or '' when the id is not one this
 * extension could have produced.
 *
 * encodeURIComponent, not encodeURI: isArtistId establishes only the 'UC' prefix, so the tail of
 * a hand-edited id could hold '/', '?' or '#', which encodeURI leaves intact and which would
 * steer the URL out of the channel path segment. A real channel id is unreserved throughout.
 */
function getArtistChannelUrl(artistId) {
  if (!isArtistId(artistId)) return '';

  return 'https://music.youtube.com/channel/' + encodeURIComponent(artistId);
}


/**
 * Remembers which row action currently has focus, for restorePopupFocus.
 *
 * The lists are rebuilt wholesale, including on a background tab's skip. Without this, a keyboard
 * user's focus silently drops to <body> whenever a track is skipped elsewhere. The name link has
 * no [data-action] of its own - handlePopupClick does not route it - so it is recorded under
 * POPUP_LINK_FOCUS_TOKEN instead.
 */
function capturePopupFocus() {
  const focused = document.activeElement && document.activeElement.closest(POPUP_ROW_FOCUS_SELECTOR);
  if (!focused) return null;

  const row = focused.closest('.popup-row');
  return {
    artistId: row ? row.dataset.artistId : '',
    action: focused.dataset.action || POPUP_LINK_FOCUS_TOKEN
  };
}


/**
 * Restores focus to the equivalent row action after a rebuild.
 *
 * Does nothing when the row is gone, which is the normal outcome of the user's own click:
 * promoting an artist removes their history row, and chasing focus across sections would move it
 * somewhere the user did not ask for. The [href] in POPUP_ROW_LINK_SELECTOR does double duty: an
 * unlinked name is not focusable, so focus is left alone rather than thrown at an inert element.
 */
function restorePopupFocus(token) {
  if (!token || !token.artistId) return;

  const row = document.querySelector(`.popup-row[data-artist-id="${CSS.escape(token.artistId)}"]`);
  if (!row) return;

  const target = token.action === POPUP_LINK_FOCUS_TOKEN
    ? row.querySelector(POPUP_ROW_LINK_SELECTOR)
    : row.querySelector(`[data-action="${token.action}"]`);
  if (target) target.focus();
}


/** Replaces the contents of one artist list, keeping its scroll position. */
function replacePopupRows(listElement, emptyElement, rows) {
  const scrollTop = listElement.scrollTop;

  listElement.replaceChildren(...rows);

  listElement.hidden = rows.length === 0;
  emptyElement.hidden = rows.length !== 0;
  listElement.scrollTop = scrollTop;
}


/**
 * Clones an artist row template and fills in the parts both lists share.
 *
 * @param {string} templateId - The <template> to clone.
 * @param {string} artistId - The artist's channel id.
 * @param {string} name - The stored name; may be empty.
 * @return {{fragment: DocumentFragment, row: HTMLElement, displayName: string}}
 *   The fragment to append, its .popup-row element, and the name the caller needs for its
 *   aria-label.
 * Notes:
 * - The href is omitted rather than set to '', because an empty href resolves to popup.html
 *   itself: the name would stay a focusable, clickable link pointing at the popup. A row with no
 *   href renders as plain text - every link rule in popup.css is keyed on [href], and an anchor
 *   without one is neither tabbable nor pointer-cursored.
 * - A name-less artist still links. The id is all the row can show, and the channel page is
 *   exactly where the user finds out whose id it is.
 * - title carries the untruncated name: .popup-row-label ellipsises inside 300px less the badge
 *   and the button, and nothing else in the popup can reveal the rest.
 */
function buildArtistRow(templateId, artistId, name) {
  const fragment = document.getElementById(templateId).content.cloneNode(true);
  const displayName = getArtistDisplayName(artistId, name);

  const row = fragment.querySelector('.popup-row');
  row.dataset.artistId = artistId;

  const nameElement = row.querySelector('.popup-row-label');
  nameElement.innerText = displayName;
  nameElement.title = displayName;

  const channelUrl = getArtistChannelUrl(artistId);
  if (channelUrl) nameElement.href = channelUrl;

  return { fragment: fragment, row: row, displayName: displayName };
}


/** Builds one never-skip row. */
function buildNoSkipRow(artistId, name) {
  const { fragment, row, displayName } = buildArtistRow('noskip-row-template', artistId, name);

  row.querySelector('.popup-row-action')
    .setAttribute('aria-label', `Remove ${displayName} from the never-skip list`);

  return fragment;
}


/**
 * Builds one skip-history row.
 *
 * The badge is this artist's own category at the time of the skip, not the reason the track was
 * skipped: a row can be a co-credit on a track another artist got skipped for, which is exactly
 * the row worth promoting to the never-skip list. mergeSkipHistory drops entries with an unknown
 * status, which is what keeps BADGE_EXTRA_CLASS[status] from being undefined here.
 */
function buildHistoryRow(entry) {
  const { fragment, row, displayName } = buildArtistRow('history-row-template', entry.id, entry.name);

  fillBadge(row, entry.status);
  row.querySelector('.popup-row-action').setAttribute('aria-label', `Never skip ${displayName}`);

  return fragment;
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

  updatePopupSectionCounts();
  restorePopupFocus(focusToken);
}


/**
 * Renders a new never-skip list and persists it.
 *
 * Renders first and reconciles afterwards, so the button feels immediate. A failed write reloads
 * from storage rather than keeping the optimistic view, so the popup can never show a state that
 * was not persisted.
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
 * The size is checked before writing rather than after a rejected write, because
 * chrome.storage.sync reports a quota overflow only by failing, and a silently failed click is
 * indistinguishable from a broken button. QUOTA_BYTES_PER_ITEM counts bytes, so a list of names
 * in a non-Latin script fills up at a third of the character count.
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


/** Removes an artist from the never-skip list. */
async function removeFromNoSkipList(artistId) {
  const noSkipList = Object.assign({}, popupNoSkipList);
  delete noSkipList[artistId];

  await commitNoSkipList(noSkipList);
}


/**
 * Empties the skip history, deliberately leaving the never-skip list alone: it is a set of
 * decisions the user made, not a record of what happened.
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
 * Decides whether a click asks for a tab opened behind the popup.
 *
 * Two gestures across two event types, which is why the caller is bound to both: a ctrl-click
 * arrives as a 'click' with button 0, while the middle button skips 'click' entirely and arrives
 * as 'auxclick' with button 1. The button test is what keeps the context menu working - a
 * right-click is an auxclick too, with button 2, and falls through untouched. shiftKey is
 * excluded rather than ignored: Ctrl+Shift-click means "new tab, in front", and a foreground open
 * is exactly what the popup cannot survive. metaKey covers macOS, where Cmd-click is the new-tab
 * gesture.
 */
function isPopupBackgroundTabClick(event) {
  if (event.shiftKey) return false;

  return event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey));
}


/**
 * Turns a ctrl-click or middle-click on an artist name into a background tab.
 *
 * @param {MouseEvent} event - The click or auxclick event.
 * @return {void}
 * Notes:
 * - The reason the gesture is intercepted at all: Chrome dismisses the popup for any tab the
 *   popup's own document opens, whatever the disposition, so the anchor's own ctrl-click and
 *   middle-click took the popup down with them and only one artist could ever be queued. A
 *   tabs.create is serviced in the browser process instead, and active:false keeps focus on the
 *   bubble, so neither thing that dismisses a popup happens. A plain click is deliberately left
 *   to navigate natively, because there the popup closing is the point.
 * - tabs.create needs no permission. "tabs" gates reading a tab's url, title and favIconUrl,
 *   none of which this touches.
 * - A listener of its own rather than a case in handlePopupClick, and the popup's only 'auxclick'
 *   listener. That switch never looks at event.button, so binding it to 'auxclick' as well would
 *   let a middle- or right-click on a row's button promote or remove an artist.
 * - Reports on screen, not only to the console: preventDefault has already suppressed the
 *   browser's own open by the time the write fails, so a rejection would otherwise leave a click
 *   that did nothing at all and nothing saying why.
 */
function handlePopupLinkClick(event) {
  if (!isPopupBackgroundTabClick(event)) return;

  const link = event.target.closest(POPUP_ROW_LINK_SELECTOR);
  if (!link) return;

  event.preventDefault();
  showPopupError('');

  chrome.tabs.create({ url: link.href, active: false }).catch(error => {
    console.error('Artist page was not opened', error);
    showPopupError(POPUP_TAB_MESSAGE);
  });
}


/**
 * Routes a click on any of the popup's buttons.
 *
 * @param {Event} event - The click event.
 * @return {void}
 * Notes:
 * - Matching on [data-action] rather than on a class keeps this handler from swallowing the
 *   clicks that reach the category rows, which are <label>s wrapping their checkbox.
 * - The artist name links are deliberately outside this switch. They carry no [data-action], so
 *   closest() returns null and a plain click navigates natively; the two background-tab gestures
 *   are intercepted in handlePopupLinkClick instead.
 * - Bound to 'click' only, never to 'auxclick'. The switch does not look at event.button, so a
 *   middle- or right-click on a row would otherwise match [data-action] and promote or remove an
 *   artist the user only meant to open.
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
    case 'toggle-section':
      togglePopupSection(action);
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
 *   could stomp a control the user is in the middle of operating. The skip history is different,
 *   and is subscribed to: a background tab writes it whenever it skips a track, and the popup
 *   only ever writes it by clearing, where an echo is idempotent.
 * - The three loads run together because .popup.is-loading hides the whole popup until they all
 *   land, so awaiting them one after another would only be slower.
 * - The accordion adds no listener of its own: the header buttons are [data-action] targets, and
 *   the sections start collapsed from the hidden attributes in popup.html.
 */
async function initializePopup() {
  popupMasterToggle = document.getElementById('autoskip-enabled');
  popupNoSkipListElement = document.getElementById('noskip-list');
  popupNoSkipEmptyElement = document.getElementById('noskip-empty');
  popupHistoryListElement = document.getElementById('history-list');
  popupHistoryEmptyElement = document.getElementById('history-empty');
  popupErrorElement = document.getElementById('popup-error');
  popupSectionsElement = document.getElementById('popup-sections');
  popupCategoryCountElement = document.getElementById('category-count');
  popupNoSkipCountElement = document.getElementById('noskip-count');
  popupHistoryCountElement = document.getElementById('history-count');

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
  document.body.addEventListener('click', handlePopupLinkClick);
  document.body.addEventListener('auxclick', handlePopupLinkClick);
  document.body.classList.remove('is-loading');
}


document.addEventListener('DOMContentLoaded', initializePopup);
