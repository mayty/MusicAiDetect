// This file has been edited with the assistance of an AI tool.
// Constants
const PROTOCOL = 'https';
const API_HOST = 'artist-check.com';
const API_ENDPOINT = `${PROTOCOL}://${API_HOST}/youtube/v1/artists/check/batch`;
const API_SINGLE_ENDPOINT = `${PROTOCOL}://${API_HOST}/youtube/v1/artists/check`;
const BADGE_QUERY = `.${BADGE_CLASS}`;  // BADGE_CLASS, BADGE_TEXT and BADGE_EXTRA_CLASS come from settings.js
const TARGET_LINK_SELECTOR = 'a[href*="channel/"]';


// Global objects
const artistCache = new Map();
let batchQueue = new Set();              // Queue for IDs waiting to be fetched
const pendingResolvers = new Map();  // Map to find the resolving function for an ID
let batchCheckTimeout = null;                 // Timer to debounce API requests


/**
 * Fetches classification status for a batch of artist IDs from the API.
 * * @param {string[]} artistIds - An array of unique artist IDs to query.
 * @returns {Promise<Object.<string, "human"|"ai"|"associated">>} A promise resolving to a map where keys are artist IDs and values are their classification.
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
 * Fetches classification status for a single artist ID from the API.
 * * @param {string} artistId - The unique identifier of the artist to query.
 * @returns {Promise<Object.<string, "human"|"ai"|"associated"|"unknown">>}
 *   A promise resolving to a map of a single key (`artistId`) -> status.
 * Notes:
 * - The response body is `{ "status": "human" | "ai" | "associated" | "unknown" }`.
 * @throws {Error} Throws an error if the API response is not ok (non-2xx status) or if the network request fails.
 */
async function fetchSingleFromApi(artistId) {
  console.log(`[Single] Fetching ${artistId}...`);

  const response = await fetch(
    `${API_SINGLE_ENDPOINT}?artist_id=${encodeURIComponent(artistId)}`,
    { method: 'GET' }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Single API Failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();  // Expected: { "status": "human" | "ai" | "associated" | "unknown" }
  return { [artistId]: data.status || 'unknown' };
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

  let results;
  if (idsToFetch.length === 1) {
    results = await fetchSingleFromApi(idsToFetch[0]).catch(err => {
      console.error("Single API Failed", err);
      requestSuccessful = false;
      return {};
    });
  } else {
    results = await fetchBatchFromApi(idsToFetch).catch(err => {
      console.error("Batch API Failed", err);
      requestSuccessful = false;
      return {};
    });
  }

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
 * @return {Promise<"human"|"ai"|"unknown"|"associated">} A promise that resolves to `"human"`, `"ai"`, `"unknown"`, or `"associated"` based on the artist's status.
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
  try {
    const url = new URL(anchorElement.href);
    const parts = url.pathname.split('/').filter(Boolean); // Remove empty strings
    let id = parts[parts.length - 1];

    if (!id) return null;

    if (id.startsWith('MPLA')) id = id.slice(4);

    if (id.startsWith('UC')) {
      return id;
    }
  } catch (e) {
    // Handle invalid URLs gracefully
  }
  return null;
}


/**
 * Marks the given element with a badge to indicate the artist type.
 *
 * @param {HTMLElement} element - The DOM element to be marked with the artist badge.
 * @param {"human"|"ai"|"unknown"|"associated"} status - The status of the artist.
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
async function handleArtistLink(artistLink) {
  if (artistLink.classList.contains('image-wrapper') || artistLink.querySelector('img, yt-img-shadow')) {
    return;
  }

  const currentArtistId = getArtistIdFromLink(artistLink);
  if (!currentArtistId) return;

  const lastCheckedId = artistLink.dataset.lastCheckedId;
  const existingBadge = artistLink.querySelector(BADGE_QUERY);

  if (existingBadge) {
    if (lastCheckedId === currentArtistId) {
      return;
    } else {
      existingBadge.remove();
    }
  }

  artistLink.dataset.lastCheckedId = currentArtistId;

  const status = await checkIsAiArtist(currentArtistId);

  // If the page changed, 'dataset.lastCheckedId' might now be different.
  if (artistLink.dataset.lastCheckedId === currentArtistId) {
    addBadge(artistLink, status);
  }
}


/**
 * Scans an element node for target links and processes them.
 *
 * @param {Element} node - The DOM node that has changed and needs to be processed.
 * @return {void} Does not return a value.
 */
function handleElementNode(node) {
  if (node.matches(TARGET_LINK_SELECTOR)) {
    handleArtistLink(node);
  } else if (node.firstElementChild){
    node.querySelectorAll(TARGET_LINK_SELECTOR).forEach(handleArtistLink);
  }
}


/**
 * Scans a text node for a target link and processes it if found.
 *
 * @param {Text} node - The DOM node that has changed and needs to be processed.
 * @return {void} Does not return a value.
 */
function handleTextNode(node) {
  if (node.parentNode && node.parentNode.matches && node.parentNode.matches(TARGET_LINK_SELECTOR)) {
    handleArtistLink(node.parentNode);
  }
}


const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'attributes' && mutation.target.matches(TARGET_LINK_SELECTOR)) {
      handleArtistLink(mutation.target);
      return;
    }

    mutation.addedNodes.forEach((node) => {
      switch (node.nodeType) {
        case Node.ELEMENT_NODE:
          handleElementNode(node);
          break;
        case Node.TEXT_NODE:
          handleTextNode(node);
          break;
      }
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['href'],
});

// Scan existing links on page load
document.querySelectorAll(TARGET_LINK_SELECTOR).forEach(handleArtistLink);
