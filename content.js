// Constants
const DEV = false;
const PROTOCOL = DEV ? 'http' : 'https';
const API_HOST = DEV ? 'localhost:8080' : 'artist-check.com';
const API_ENDPOINT = `${PROTOCOL}://${API_HOST}/youtube/v1/artists/check/batch`;
const BADGE_CLASS = 'artist-badge';
const BADGE_QUERY = `.${BADGE_CLASS}`;
const BADGE_TEXT = {
  'human': 'H',
  'ai': 'AI',
  'unknown': '?'
}
const BADGE_EXTRA_CLASS = {
  'human': 'is-human',
  'ai': 'is-ai',
  'unknown': 'is-unknown'
}
const CONTAINER_SELECTORS = [
  '.secondary-flex-columns yt-formatted-string.complex-string',  // List items ("Quick picks" style)
  '.content-info-wrapper .subtitle yt-formatted-string.complex-string',  // Player
  'ytmusic-two-row-item-renderer[has-circle-cropped-thumbnail] .title',  // Circle artist card ("Similar to" style)
  'ytmusic-two-row-item-renderer .subtitle'  // Regular artist card ("Listen again" style)
];
const TARGET_LINK_SELECTOR = CONTAINER_SELECTORS.map(selector => `${selector} a[href*="channel/"]`).join(', ');


// Global objects
const artistCache = new Map();
let batchQueue = new Set();              // Queue for IDs waiting to be fetched
const pendingResolvers = new Map();  // Map to find the resolving function for an ID
let batchCheckTimeout = null;                 // Timer to debounce API requests
let observerTimeout = null;                   // Timer to debounce DOM scan


/**
 * Fetches classification status for a batch of artist IDs from the API.
 * * @param {string[]} artistIds - An array of unique artist IDs to query.
 * @returns {Promise<Object.<string, "human"|"ai">>} A promise resolving to a map where keys are artist IDs and values are their classification.
 * Notes:
 * - The returned object only contains keys for artists found in the database; it may be a subset of the input `artistIds`.
 * @throws {Error} Throws an error if the API response is not ok (non-2xx status) or if the network request fails.
 */
async function fetchBatchFromApi(artistIds) {
  console.log(`[Batch] Fetching ${artistIds.length} artists...`);

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artist_ids: artistIds })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Batch API Failed: ${response.status} - ${errorText}`);
  }

  return await response.json();  // Expected format: { "UC123...": "ai", "UC456...": "human" }
}


/**
 * Processes a batch of IDs from the queue, fetches their statuses from an external API,
 * updates the memory cache with the results, and resolves pending promises for each ID.
 *
 * @return {Promise<void>} Resolves when the batch is processed completely, including API fetching, cache updates, and promise resolution.
 */
async function processBatch() {
  if (batchQueue.size === 0) return;

  const preparedBatch = batchQueue;
  batchQueue = new Set();
  const idsToFetch = Array.from(preparedBatch);

  let requestSuccessful = true;

  const results = await fetchBatchFromApi(idsToFetch).catch(err => {
    console.error("Batch API Failed", err);
    requestSuccessful = false;
    return {};
  });

  idsToFetch.forEach(id => {
    const status = results[id] || 'unknown'; 
    
    // Update Memory Cache
    if (requestSuccessful) {
      artistCache.set(id, status);
    }

    // Resolve the original Promise waiting in checkIsAiArtist
    if (pendingResolvers.has(id)) {
      const resolverObj = pendingResolvers.get(id);
      resolverObj.resolve(status); 
      
      pendingResolvers.delete(id);
    }
  });
}


/**
 * Determines whether the artist with the given ID is an AI artist.
 * The method uses caching and batching mechanisms to enhance performance.
 *
 * @param {string} artistId - The unique identifier of the artist to check.
 * @return {Promise<"human"|"ai"|"unknown">} A promise that resolves to `"human"`, `"ai"`, or `"unknown"` based on the artist's status.
 */
function checkIsAiArtist(artistId) {
  if (artistCache.has(artistId)) {
    return Promise.resolve(artistCache.get(artistId));
  }

  if (pendingResolvers.has(artistId)) {
    return pendingResolvers.get(artistId).promise;
  }

  batchQueue.add(artistId);

  // Create a Promise that hangs here until processBatch calls 'resolve'
  let resolveFunc;
  const promise = new Promise((resolve) => {
    resolveFunc = resolve;
  });
  pendingResolvers.set(artistId, { promise, resolve: resolveFunc });

  clearTimeout(batchCheckTimeout);
  batchCheckTimeout = setTimeout(processBatch, 200);

  return promise;
}


/**
 * Extracts the artist ID from the href attribute of an anchor element.
 *
 * @param {HTMLElement} anchorElement - The anchor element containing the href attribute.
 * @return {string|null} The extracted artist ID if present and valid, otherwise null.
 */
function getArtistIdFromLink(anchorElement) {
  const href = anchorElement.getAttribute('href');
  if (!href) return null;

  const parts = href.split('/');
  const id = parts[parts.length - 1];
  
  if (id.startsWith('UC')) {
      return id;
  }
  return null;
}


/**
 * Marks the given element with a badge to indicate the artist type.
 *
 * @param {HTMLElement} element - The DOM element to be marked with the artist badge.
 * @param {"human"|"ai"|"unknown"} status - The status of the artist.
 * @return {void} This method does not return a value.
 */
function addBadge(element, status) {
  if (!element.isConnected) return;  // Check if element is still in the DOM
  if (element.querySelector(BADGE_QUERY)) return;  // Prevent double marking

  const badge = document.createElement('span');

  badge.classList.add(BADGE_CLASS, BADGE_EXTRA_CLASS[status]);
  badge.innerText = BADGE_TEXT[status];
  
  element.prepend(badge); 
}


/**
 * Marks an artist link with a badge indicating their classification status.
 *
 * @param {HTMLElement} artistLink - The DOM element representing the artist link to process.
 * @return {void} A promise that resolves when the artist link has been handled.
 */
function handleArtistLink(artistLink) {
  // 1. Prevent Double Marking
  if (artistLink.querySelector(BADGE_QUERY)) return;

  // 2. Skip Image Links
  if (artistLink.querySelector('img, yt-img-shadow')) return;

  // 3. Extract ID and Check API
  const artistId = getArtistIdFromLink(artistLink);
  if (!artistId) return;

  checkIsAiArtist(artistId).then(status => addBadge(artistLink, status));
}


/**
 * Scans various UI elements for artist links and retrieves their classification status from the API.
 * Assigns badges to visually mark different artist types.
 *
 * @return {void} This function does not return a value, but updates the DOM with artist badges.
 */
function scanAndMarkArtists() {
  document.querySelectorAll(TARGET_LINK_SELECTOR).forEach(handleArtistLink);
}

const observer = new MutationObserver((mutations) => {
  const shouldScan = mutations.some(mutation =>
    mutation.type === 'childList' &&
    Array.from(mutation.addedNodes).some(node =>
      node.nodeType === 1 && !node.classList.contains(BADGE_CLASS)
    )
  );

  if (!shouldScan) return;

  clearTimeout(observerTimeout);
  observerTimeout = setTimeout(() => {
    scanAndMarkArtists();
  }, 500);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

scanAndMarkArtists();
