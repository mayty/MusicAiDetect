// This file has been created with the assistance of an AI tool.
// ESLint 10 flat config for the hand-maintained extension scripts in dist/.
//
// These are classic scripts that share one global lexical scope (see
// dist/settings.js's header comment): manifest.json loads settings.js, content.js
// and autoskip.js as content scripts, and popup.html loads settings.js + popup.js.
// ESLint parses each file in isolation, so a name that one file defines and another
// legitimately reuses across that shared scope looks undefined. To let no-undef stay
// an error (so a genuine typo still fails the gate) we declare, per file, the
// top-level names of every file it shares a scope with as read-only globals.
//
// Cross-file *redeclaration* of a top-level name is a real bug and is checked by
// scripts/ci-check.js, not here.

import fs from 'node:fs';
import path from 'node:path';
import js from '@eslint/js';
import globals from 'globals';

// A top-level declaration starts at column 0; indented ones are function locals.
const DECLARATION = /^(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/;

const SCRIPTS = ['settings.js', 'content.js', 'autoskip.js', 'popup.js'];

// Which files share a global scope with which (per manifest.json and popup.html).
const GROUPS = [
  ['settings.js', 'content.js', 'autoskip.js'],
  ['settings.js', 'popup.js'],
];

function topLevelNames(file) {
  const lines = fs.readFileSync(path.join('dist', file), 'utf8').split('\n');
  const names = new Set();
  for (const line of lines) {
    const match = line.match(DECLARATION);
    if (match) names.add(match[1]);
  }
  return names;
}

function sharedGlobalsFor(file) {
  const names = new Set();
  for (const group of GROUPS) {
    if (group.includes(file)) {
      for (const member of group) {
        // A file's own top-level declarations are known to ESLint in isolation, so
        // only the names defined by OTHER files it shares a scope with are globals.
        // Including a file's own names would trip no-redeclare / no-global-assign.
        if (member === file) continue;
        for (const name of topLevelNames(member)) names.add(name);
      }
    }
  }
  const globals = {};
  for (const name of names) globals[name] = 'readonly';
  return globals;
}

const BASE_GLOBALS = {
  ...globals.browser,
  ...globals.es2021,
  chrome: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
};

const RULES = {
  ...js.configs.recommended.rules,
  // The code is hand-written and not linted until now, so style noise is demoted to
  // warnings while real problems (syntax errors, genuine undefined identifiers) still
  // fail the gate. Tune here only if a new real error needs to be surfaced.
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'prefer-const': 'warn',
  'no-console': 'off',
};

export default SCRIPTS.map((file) => ({
  files: [`dist/${file}`],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
    globals: { ...BASE_GLOBALS, ...sharedGlobalsFor(file) },
  },
  rules: RULES,
}));
