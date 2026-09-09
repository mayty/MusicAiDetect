// This file has been created with the assistance of an AI tool.
// Binds the popup controls to the settings stored in chrome.storage.sync.
// Category names, labels and badge styling all come from settings.js, so adding a
// fifth badge category needs no change in this file.


// Constants
const POPUP_LOADING_CLASS = 'is-loading';
const POPUP_TEMPLATE_ID = 'category-row-template';
const POPUP_GROUP_ID = 'category-group';
const POPUP_MASTER_ID = 'autoskip-enabled';


// Global objects
let popupMasterToggle = null;
let popupCategoryGroup = null;
const popupCategoryToggles = new Map();   // category -> HTMLInputElement


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
 * Notes:
 * - The DOM is the popup's single source of truth, so there is no shadow copy to fall out of sync.
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
 * - The master's dimming is applied synchronously, before the write, so it never waits on storage.
 * - Category selections are kept when the master is switched off, so switching it back on
 *   restores the user's picks. isSkippedCategory() gates on both, so this is safe.
 */
function handleSettingsChange(event) {
  if (event.target === popupMasterToggle) updateMasterState();

  saveSettings(readSettingsFromUi()).then(saved => {
    if (!saved) console.error('Auto-skip settings were not saved');
  });
}


/**
 * Renders the popup and wires it to storage.
 *
 * @return {Promise<void>} Resolves once the stored settings are on screen.
 * Notes:
 * - The popup deliberately does not subscribeToSettings(): it is the only writer, and
 *   chrome.storage.onChanged echoes a write back to its author, which could stomp a
 *   control the user is in the middle of operating.
 */
async function initializePopup() {
  popupMasterToggle = document.getElementById(POPUP_MASTER_ID);
  popupCategoryGroup = document.getElementById(POPUP_GROUP_ID);

  renderCategoryRows();
  applySettings(await loadSettings());

  document.body.addEventListener('change', handleSettingsChange);
  document.body.classList.remove(POPUP_LOADING_CLASS);
}


document.addEventListener('DOMContentLoaded', initializePopup);
