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
const POPUP_SECTIONS_ID = 'popup-sections';
const POPUP_CATEGORY_COUNT_ID = 'category-count';
const POPUP_NOSKIP_COUNT_ID = 'noskip-count';
const POPUP_HISTORY_COUNT_ID = 'history-count';
const POPUP_CATEGORY_SECTION = 'categories';

const POPUP_SECTION_SELECTOR = '.popup-section';
const POPUP_SECTION_TOGGLE_SELECTOR = '.popup-section-toggle';
const POPUP_SECTION_PANEL_SELECTOR = '.popup-section-panel';
const POPUP_SETTINGS_CONTROL_SELECTOR = `#${POPUP_GROUP_ID}, .popup-row.is-master`;
const POPUP_ROW_LINK_SELECTOR = '.popup-row-label[href]';
const POPUP_ROW_FOCUS_SELECTOR = `.popup-row-action, ${POPUP_ROW_LINK_SELECTOR}`;
const POPUP_LINK_FOCUS_TOKEN = 'name';   /* stands in for [data-action] on the row's name link */
const POPUP_CHANNEL_URL_BASE = 'https://music.youtube.com/channel/';
const POPUP_FULL_MESSAGE = 'The never-skip list is full. Remove an artist first.';
const POPUP_SAVE_MESSAGE = 'Could not save. Your change was not applied.';
const POPUP_TAB_MESSAGE = 'Could not open the artist page. Try a plain click instead.';


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
let popupSectionsElement = null;
let popupCategoryCountElement = null;
let popupNoSkipCountElement = null;
let popupHistoryCountElement = null;


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
 * Expands one section and collapses the other two.
 *
 * @param {string} sectionName - The data-section value to expand; '' collapses all of them.
 * @return {void}
 * Notes:
 * - At most one section is open at a time because the popup is 300px wide and Chrome caps it
 *   near 600px tall: two open lists would push the master toggle off screen, which is the same
 *   reasoning that gives .popup-list its max-height.
 * - Single-open by construction rather than by closing a remembered previous section, so the
 *   popup cannot end up showing two open panels if one state update is ever missed.
 * - The state lives in the DOM, for the same reason the category toggles do: aria-expanded is
 *   what assistive technology reads and what rotates the caret in CSS, so it *is* the state and
 *   there is no second copy to drift out of step.
 * - Nothing is persisted. A popup lives for seconds and the next open is usually a different
 *   intent, so every section starts collapsed from the hidden attributes in popup.html.
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
 * Opens the section a header button belongs to, or closes it when it is already open.
 *
 * @param {HTMLElement} toggle - The header button that was activated.
 * @return {void}
 * Notes:
 * - Reads the current state back off aria-expanded rather than tracking it separately.
 * - Clicking an open header closes it: one open section is the maximum, not the minimum.
 */
function togglePopupSection(toggle) {
  const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
  const section = toggle.closest(POPUP_SECTION_SELECTOR);

  expandPopupSection(isExpanded ? '' : section.dataset.section);
}


/**
 * Writes the item count onto each section header.
 *
 * @return {void}
 * Notes:
 * - A collapsed section shows nothing at all, so the count is what tells the user whether
 *   opening it is worth the click.
 * - A zero renders as no text rather than as '0': the panel's own empty paragraph already says
 *   it, and a row of zeroes across the headers is noise.
 * - The history count applies the same never-skip filter renderArtistSections() does, so the
 *   number always matches the rows behind the header.
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
 * @return {void}
 * Notes:
 * - Hides the sections rather than dimming them: with auto-skip off none of them is actionable,
 *   and a 300px popup has no room to spend on three inert sections.
 * - Hidden, never removed. readSettingsFromUi() reads the category checkboxes straight out of
 *   the DOM, so detaching them would report every category as false and wipe the user's picks
 *   on the next write. display:none leaves .checked alone, which is what makes this safe.
 * - Collapses on the way out, so a later re-enable starts from a known state.
 * - Does NOT expand anything on the way in. applySettings() calls this on every popup open,
 *   where every section has to start collapsed; the auto-expand belongs to the user's own click
 *   and lives in handleSettingsChange().
 */
function updateMasterState() {
  popupSectionsElement.hidden = !popupMasterToggle.checked;

  if (!popupMasterToggle.checked) expandPopupSection('');
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
  updatePopupSectionCounts();
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
 * - The master's own state is applied synchronously, before the write, so it never waits on storage.
 * - Category selections are kept when the master is switched off, so switching it back on
 *   restores the user's picks. isSkippedCategory() gates on both, so this is safe.
 * - Switching auto-skip on opens "Skip these categories", because that is the choice which makes
 *   the toggle do anything: enabled with no category ticked is a no-op. Switching it off closes
 *   everything (updateMasterState), so the pair is symmetric.
 * - That auto-expand lives here rather than in updateMasterState() because applySettings() calls
 *   updateMasterState() on every popup open, where every section is meant to start collapsed.
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
 * Builds the YouTube Music channel URL for an artist.
 *
 * @param {string} artistId - The artist's channel id.
 * @return {string} The channel page URL, or '' when the id is not one this extension could
 *   have produced.
 * Notes:
 * - Same acceptance rule as getArtistIdFromLink, via isArtistId: an id that fails it is not
 *   linked at all rather than linked hopefully. mergeNoSkipList and mergeSkipHistory filter on
 *   the same test, so this only ever fires against a hand-edited store.
 * - `channel/<id>` is the URL form the content script already reads ids out of, so no
 *   translation is needed - getArtistIdFromLink strips the `MPLA` prefix that some page links
 *   carry and stores the bare channel id that arrives here.
 * - encodeURIComponent, not encodeURI: isArtistId establishes only the 'UC' prefix, so the tail
 *   of a hand-edited id could hold '/', '?' or '#', which encodeURI leaves intact and which
 *   would steer the URL out of the channel path segment. A real channel id is unreserved
 *   throughout, so this changes nothing for the ids the extension actually stores.
 */
function getArtistChannelUrl(artistId) {
  if (!isArtistId(artistId)) return '';

  return POPUP_CHANNEL_URL_BASE + encodeURIComponent(artistId);
}


/**
 * Remembers which row action currently has focus.
 *
 * @return {{artistId: string, action: string}|null} A token for restorePopupFocus, or null.
 * Notes:
 * - The lists are rebuilt wholesale, including on a background tab's skip. Without this, a
 *   keyboard user's focus silently drops to <body> whenever a track is skipped elsewhere.
 * - The name link has no [data-action] of its own - handlePopupClick does not route it - so it
 *   is recorded under POPUP_LINK_FOCUS_TOKEN instead. Nothing else in a row is focusable, so
 *   the token stays a two-way choice.
 */
function capturePopupFocus() {
  const activeElement = document.activeElement;
  const focused = (activeElement && activeElement.closest) ? activeElement.closest(POPUP_ROW_FOCUS_SELECTOR) : null;
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
 * @param {{artistId: string, action: string}|null} token - The token from capturePopupFocus.
 * @return {void}
 * Notes:
 * - Does nothing when the row is gone, which is the normal outcome of the user's own click:
 *   promoting an artist removes their history row. Chasing focus across sections in that case
 *   would move it somewhere the user did not ask for.
 * - The [href] in POPUP_ROW_LINK_SELECTOR does double duty: an unlinked name is not focusable,
 *   so the lookup finds nothing and focus is left alone rather than thrown at an inert element.
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
 * Fills a row's name cell and points it at the artist's channel.
 *
 * @param {HTMLElement} rowElement - The cloned row.
 * @param {string} artistId - The artist's channel id.
 * @param {string} displayName - The text to show, from getArtistDisplayName.
 * @return {void}
 * Notes:
 * - The href is omitted rather than set to '', because an empty href resolves to popup.html
 *   itself: the name would stay a focusable, clickable link pointing at the popup. Rows are
 *   cloned fresh from the template on every render, so the attribute is simply never added and
 *   there is nothing to remove.
 * - A row with no href renders as the plain text it always was: every link rule in popup.css is
 *   keyed on [href], and an anchor without one is neither tabbable nor pointer-cursored.
 * - A name-less artist still links. The id is all the row can show, and the channel page is
 *   exactly where the user finds out whose id it is.
 * - title carries the untruncated name: .popup-row-label ellipsises inside 300px less the badge
 *   and the button, and nothing else in the popup can reveal the rest.
 */
function fillArtistRowName(rowElement, artistId, displayName) {
  const nameElement = rowElement.querySelector('.popup-row-label');
  const channelUrl = getArtistChannelUrl(artistId);

  nameElement.innerText = displayName;
  nameElement.title = displayName;
  if (channelUrl) nameElement.href = channelUrl;
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
  fillArtistRowName(rowElement, artistId, displayName);
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
 * - The badge is this artist's own category at the time of the skip, not the reason the track
 *   was skipped: a row can be a co-credit on a track another artist got skipped for, which is
 *   exactly the row worth promoting to the never-skip list. mergeSkipHistory drops entries with
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
  fillArtistRowName(rowElement, entry.id, displayName);
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

  updatePopupSectionCounts();
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
 * Decides whether a click asks for a tab opened behind the popup.
 *
 * @param {MouseEvent} event - The click or auxclick event.
 * @return {boolean} True for a ctrl/Cmd-click and for a middle-click.
 * Notes:
 * - Two gestures across two event types, which is why the caller is bound to both. Chrome
 *   dispatches 'click' for the primary button only, so a ctrl-click arrives as a click with
 *   button 0, while the middle button skips 'click' entirely and arrives as 'auxclick' with
 *   button 1.
 * - The button test is what keeps the context menu working. A right-click is an 'auxclick' too,
 *   with button 2, and falls through here, so nothing calls preventDefault on it and "Copy link
 *   address" is untouched.
 * - shiftKey is excluded rather than ignored: Ctrl+Shift-click means "new tab, in front" in
 *   Chrome, and a foreground open is exactly what the popup cannot survive. Excluding it leaves
 *   every shift combination native, alongside the plain Shift-click that opens a window.
 * - altKey is not excluded. Alt-click carries no ctrl or meta, so it already falls through to
 *   the browser's download, which is the only Alt gesture a link has.
 * - metaKey is what covers macOS, where Cmd-click is the new-tab gesture. Ctrl-click there is
 *   the context-menu gesture instead, and Chrome dispatches contextmenu and no click at all for
 *   it, so the ctrlKey branch is unreachable on a Mac and needs no platform test to hold it back.
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
 *   tabs.create is serviced in the browser process instead of through the popup's web contents,
 *   and active:false keeps focus on the bubble, so neither thing that dismisses a popup happens.
 *   active:true would bring the second one straight back - which is what a plain click is
 *   deliberately left to do for itself, because there the popup closing is the point.
 * - tabs.create needs no permission. "tabs" gates reading a tab's url, pendingUrl, title and
 *   favIconUrl, none of which this touches; the returned Tab is ignored.
 * - A listener of its own rather than a case in handlePopupClick, and the popup's only 'auxclick'
 *   listener. That switch never looks at event.button, so binding it to 'auxclick' as well would
 *   let a middle- OR right-click on a row's button promote or remove an artist.
 * - The gesture is tested before the target, because every plain click in the popup reaches this
 *   handler and that is the branch worth leaving cheapest.
 * - Reads the href off the element rather than rebuilding it from the row's artist id, so
 *   fillArtistRowName stays the one place that decides where a name points and the tab can never
 *   disagree with what the context menu copies.
 * - The new tab lands at the end of the strip rather than beside the opener, where a native
 *   ctrl-click would put it. Matching that needs a prior tabs.query for the current tab's index,
 *   which is a second call that can fail, for a position nobody asked about.
 * - Reports on screen, not only to the console. preventDefault has already suppressed the
 *   browser's own open by the time the write fails, so a rejection leaves a click that did
 *   nothing at all and nothing saying why - the case showPopupError exists for.
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
 * - The section headers ride this same switch instead of taking a listener of their own. They
 *   are <button>s outside any .popup-row, so the artistId above is empty for them, exactly as
 *   it already is for clear-history.
 * - The artist name links are deliberately outside this switch. They carry no [data-action], so
 *   the closest() below returns null and a plain click is left to navigate natively, which
 *   closes the popup and puts the channel page in front of the user, exactly as intended. The
 *   two background-tab gestures are intercepted in handlePopupLinkClick instead.
 * - Bound to 'click' only, never to 'auxclick'. The switch below does not look at event.button,
 *   so a middle- or right-click on a row would match [data-action] and promote or remove an
 *   artist the user only meant to open, or right-click for the address.
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
 *   could stomp a control the user is in the middle of operating.
 * - The skip history is different, and is subscribed to: a background tab writes it whenever it
 *   skips a track, and the popup only ever writes it by clearing, where an echo is idempotent.
 * - The three loads run together because .popup.is-loading hides the whole popup until they all
 *   land, so awaiting them one after another would only be slower.
 * - The accordion adds no listener of its own: the header buttons are [data-action] targets, so
 *   the delegated click handler already routes them, and the sections start collapsed from the
 *   hidden attributes in popup.html rather than from a first render pass.
 * - The artist names take a second click listener, plus the popup's only auxclick listener,
 *   because their two background-tab gestures have to be intercepted rather than routed and the
 *   switch in handlePopupClick is not safe to run for a non-primary button. The two click
 *   listeners can never both match: the links carry no [data-action], and no [data-action]
 *   element is a link. See handlePopupLinkClick.
 */
async function initializePopup() {
  popupMasterToggle = document.getElementById(POPUP_MASTER_ID);
  popupCategoryGroup = document.getElementById(POPUP_GROUP_ID);
  popupNoSkipListElement = document.getElementById(POPUP_NOSKIP_LIST_ID);
  popupNoSkipEmptyElement = document.getElementById(POPUP_NOSKIP_EMPTY_ID);
  popupHistoryListElement = document.getElementById(POPUP_HISTORY_LIST_ID);
  popupHistoryEmptyElement = document.getElementById(POPUP_HISTORY_EMPTY_ID);
  popupErrorElement = document.getElementById(POPUP_ERROR_ID);
  popupSectionsElement = document.getElementById(POPUP_SECTIONS_ID);
  popupCategoryCountElement = document.getElementById(POPUP_CATEGORY_COUNT_ID);
  popupNoSkipCountElement = document.getElementById(POPUP_NOSKIP_COUNT_ID);
  popupHistoryCountElement = document.getElementById(POPUP_HISTORY_COUNT_ID);

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
  document.body.classList.remove(POPUP_LOADING_CLASS);
}


document.addEventListener('DOMContentLoaded', initializePopup);
