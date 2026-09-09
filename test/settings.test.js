// This file has been created with the assistance of an AI tool.
// Unit tests for the pure helpers in dist/settings.js. The file is a classic
// script with no exports, so it is loaded here into a node:vm context: its
// top-level function declarations become properties of the context's global, and
// each closes over the file's top-level const bindings, so the helpers can be
// called without adding any export to the extension source. Nothing touches
// chrome.storage at load time, so running it in a bare context is safe.

const test = require('node:test');
const assert = require('node:assert/strict');
// The helpers return objects created in the node:vm realm, whose prototypes differ
// from this test realm. deepStrictEqual requires matching prototypes, so structural
// comparisons use the legacy deepEqual, which ignores prototypes. Scalar checks below
// still use the strict assert.equal.
const deepEqual = require('node:assert').deepEqual;
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { TextEncoder, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('dist/settings.js', 'utf8'), sandbox);

const {
  clampArtistName,
  isArtistId,
  mergeSettings,
  mergeNoSkipList,
  mergeSkipHistory,
  isSkippedCategory,
  isNoSkipArtist,
} = sandbox;

// Mirrors of the constants in dist/settings.js, so a change to a limit is caught
// by a failing assertion rather than silently making a test vacuous.
const ARTIST_NAME_LIMIT = 64;
const NOSKIP_LIST_LIMIT = 200;
const SKIP_HISTORY_LIMIT = 100;

const CATEGORY_DEFAULTS = { ai: false, associated: false, unknown: false, human: false };

test('clampArtistName trims and caps at ARTIST_NAME_LIMIT', () => {
  assert.equal(clampArtistName('  Taylor  '), 'Taylor');
  assert.equal(clampArtistName('a'.repeat(101)), 'a'.repeat(ARTIST_NAME_LIMIT));
});

test('clampArtistName returns an empty string for any non-string', () => {
  assert.equal(clampArtistName(42), '');
  assert.equal(clampArtistName(null), '');
  assert.equal(clampArtistName(undefined), '');
  assert.equal(clampArtistName({}), '');
  assert.equal(clampArtistName('   '), '');
});

test('isArtistId accepts id-like strings and rejects everything else', () => {
  assert.equal(isArtistId('UCABC'), true);
  assert.equal(isArtistId('UC'), true);
  assert.equal(isArtistId('ucabc'), false); // case-sensitive
  assert.equal(isArtistId('abc'), false);
  assert.equal(isArtistId(''), false);
  assert.equal(isArtistId(123), false);
  assert.equal(isArtistId(undefined), false);
  assert.equal(isArtistId(null), false);
});

test('mergeSettings fills every default category when the stored value is absent', () => {
  deepEqual(mergeSettings(undefined), { enabled: false, categories: CATEGORY_DEFAULTS });
});

test('mergeSettings keeps a true category and coerces any non-true value to false', () => {
  const merged = mergeSettings({
    enabled: true,
    categories: { ai: true, associated: 'yes', unknown: 1, human: 0 },
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.categories.ai, true);
  assert.equal(merged.categories.associated, false);
  assert.equal(merged.categories.unknown, false);
  assert.equal(merged.categories.human, false);
});

test('mergeSettings drops categories that are not in DEFAULT_SETTINGS', () => {
  const merged = mergeSettings({ enabled: true, categories: { bogus: true, ai: true } });
  assert.equal('bogus' in merged.categories, false);
});

test('mergeSettings tolerates a malformed stored shape', () => {
  deepEqual(mergeSettings('not an object'), { enabled: false, categories: CATEGORY_DEFAULTS });
  deepEqual(mergeSettings([]), { enabled: false, categories: CATEGORY_DEFAULTS });
});

test('mergeNoSkipList normalizes a missing or array value to an empty map', () => {
  deepEqual(mergeNoSkipList(undefined), {});
  deepEqual(mergeNoSkipList([]), {});
  deepEqual(mergeNoSkipList('nope'), {});
});

test('mergeNoSkipList keeps only valid artist ids and clamps their names', () => {
  const merged = mergeNoSkipList({ UC1: 'Name', notAnId: 'x' });
  deepEqual(merged, { UC1: 'Name' });
});

test('mergeNoSkipList caps the list at NOSKIP_LIST_LIMIT entries', () => {
  const raw = {};
  for (let i = 0; i < NOSKIP_LIST_LIMIT + 20; i++) raw['UC' + i] = 'a';
  assert.equal(Object.keys(mergeNoSkipList(raw)).length, NOSKIP_LIST_LIMIT);
});

test('mergeSkipHistory dedupes by id keeping the most recent entry', () => {
  const entry = { id: 'UC1', name: 'A', status: 'ai', at: 123 };
  const merged = mergeSkipHistory([entry, { ...entry, at: 456 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].at, 123);
});

test('mergeSkipHistory drops entries with an unknown status or a non-UC id', () => {
  const merged = mergeSkipHistory([
    { id: 'UC1', name: 'A', status: 'bogus' },
    { id: 'x', name: 'B', status: 'ai' },
    { id: 'UC2', name: 'C', status: 'human' },
  ]);
  deepEqual(merged.map((entry) => entry.id), ['UC2']);
});

test('mergeSkipHistory defaults a non-finite timestamp to 0', () => {
  const merged = mergeSkipHistory([{ id: 'UC1', name: 'A', status: 'ai', at: Infinity }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].at, 0);
});

test('mergeSkipHistory caps the list at SKIP_HISTORY_LIMIT entries', () => {
  const raw = [];
  for (let i = 0; i < SKIP_HISTORY_LIMIT + 10; i++) {
    raw.push({ id: 'UC' + i, name: 'a', status: 'ai' });
  }
  assert.equal(mergeSkipHistory(raw).length, SKIP_HISTORY_LIMIT);
});

test('isSkippedCategory requires both the master toggle and the selected category', () => {
  const settings = { enabled: true, categories: { ai: true, human: false } };
  assert.equal(isSkippedCategory(settings, 'ai'), true);
  assert.equal(isSkippedCategory(settings, 'human'), false);
  assert.equal(isSkippedCategory({ enabled: false, categories: { ai: true } }, 'ai'), false);
});

test('isNoSkipArtist uses hasOwnProperty so an empty name still counts', () => {
  assert.equal(isNoSkipArtist({ UC1: '' }, 'UC1'), true);
  assert.equal(isNoSkipArtist({}, 'UC1'), false);
});
