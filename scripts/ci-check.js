// This file has been created with the assistance of an AI tool.
// Lightweight CI checks that a per-file linter cannot catch. Dependency-free
// (Node built-ins only) so it runs without a node_modules install.
//
// What it enforces, beyond what ESLint/node --check see:
//   1. dist/manifest.json is valid JSON.
//   2. Every file referenced by manifest.json and popup.html exists on disk.
//   3. No cross-file top-level identifier collision within a shared global scope.
//   4. package.json and manifest.json carry the same version.
//
// #3 is the load-bearing one: manifest.json loads settings.js, content.js and
// autoskip.js as content scripts that share one global lexical scope (and the
// popup loads settings.js + popup.js the same way). A top-level const/let/var/
// function/class declared in two of them throws a SyntaxError in the browser at
// load time - which node --check cannot detect because it parses each file alone.

const fs = require('fs');
const path = require('path');

const DIST = 'dist';

// A declaration is a collider only if it starts at column 0 - indented ones are
// function locals, which are scoped to their own function and never collide.
const DECLARATION = /^(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/;

const COLLISION_GROUPS = [
  ['settings.js', 'content.js', 'autoskip.js'], // manifest.json content_scripts
  ['settings.js', 'popup.js'],                   // popup.html scripts
];

let failed = false;

function fail(message) {
  console.error(`✗ ${message}`);
  failed = true;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

// --- 1. manifest.json must be valid JSON ---
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
} catch (error) {
  fail(`dist/manifest.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

// --- 2. every referenced file must exist on disk ---
const references = new Set();

for (const script of manifest.content_scripts || []) {
  for (const file of script.js || []) references.add(file);
  for (const file of script.css || []) references.add(file);
}
if (manifest.action) {
  if (manifest.action.default_popup) references.add(manifest.action.default_popup);
  for (const file of Object.values(manifest.action.default_icon || {})) references.add(file);
}
for (const file of Object.values(manifest.icons || {})) references.add(file);
for (const resource of manifest.web_accessible_resources || []) {
  for (const file of resource.resources || []) references.add(file);
}

const popupHtmlPath = path.join(DIST, 'popup.html');
if (fs.existsSync(popupHtmlPath)) {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  for (const match of html.matchAll(/(?:<script[^>]*\ssrc|<link[^>]*\shref)="([^"]+)"/g)) {
    references.add(match[1]);
  }
}

let referencesOk = true;
for (const file of references) {
  if (!fs.existsSync(path.join(DIST, file))) {
    fail(`dist/${file} is referenced but does not exist`);
    referencesOk = false;
  }
}
if (referencesOk) ok('All manifest/popup references resolve');

// --- 3. cross-file top-level identifier collisions ---
function topLevelNames(file) {
  const lines = fs.readFileSync(path.join(DIST, file), 'utf8').split('\n');
  const names = new Set();
  for (const line of lines) {
    const match = line.match(DECLARATION);
    if (match) names.add(match[1]);
  }
  return names;
}

let collisionDetected = false;
for (const group of COLLISION_GROUPS) {
  const owner = new Map(); // name -> first file that declared it
  for (const file of group) {
    for (const name of topLevelNames(file)) {
      if (owner.has(name)) {
        fail(`top-level "${name}" is declared in both ${owner.get(name)} and ${file} (shared global scope)`);
        collisionDetected = true;
      } else {
        owner.set(name, file);
      }
    }
  }
}
if (!collisionDetected) ok('No cross-file top-level identifier collisions');

// --- 4. package.json and manifest.json versions match ---
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
} catch (error) {
  fail(`package.json is not valid JSON: ${error.message}`);
}

if (pkg && pkg.version !== manifest.version) {
  fail(`Version mismatch: package.json is "${pkg.version}", manifest.json is "${manifest.version}"`);
} else if (pkg) {
  ok(`Versions match (${manifest.version})`);
}

if (failed) process.exit(1);
