// This file has been created with the assistance of an AI tool.
// Extracts the CHANGELOG.md section for a tag so a GitHub release's notes match
// the changelog instead of being typed twice. Keep-a-Changelog headings look like
// "## [0.3.0] - 2026-09-09"; we print everything from that heading up to the next
// top-level "## [" heading (or EOF), with the heading line itself stripped.

const fs = require('fs');

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: node scripts/release-notes.js <tag>');
  process.exit(1);
}

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

// Escape the tag so a "." in "0.3.0" is not treated as a regex wildcard.
const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^## \\[${escaped}\\]`, 'm');

const start = changelog.search(heading);
if (start === -1) {
  // No section for this tag: emit empty notes rather than abort the release.
  process.exit(0);
}

let section = changelog.slice(start);
const next = section.match(/^\n## \[/m); // the next top-level heading
const end = next ? section.indexOf(next[0]) : section.length;
section = section.slice(0, end);

// Strip the "## [x] - date" heading line and trim surrounding blank lines.
const body = section.split('\n').slice(1).join('\n').trim();
process.stdout.write(body + '\n');
