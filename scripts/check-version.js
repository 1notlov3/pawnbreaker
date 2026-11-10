#!/usr/bin/env node
// Single source of truth for the version: js/config.js (version / versionLabel).
// This checks (or, with --fix, rewrites) the copies that static HTML needs without JavaScript:
// the menu label in index.html, the ?v= cache-busters, and the README heading.
//   node scripts/check-version.js        # exit 1 if anything is out of sync
//   node scripts/check-version.js --fix  # update them in place
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), fix = process.argv.includes('--fix');
const cfg = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const label = /versionLabel:\s*'([^']+)'/.exec(cfg)[1];              // e.g. "Alpha v0.4.3"
const num = /(\d+\.\d+(?:\.\d+)?)/.exec(label)[1];                   // e.g. "0.4.3"
const rules = [
  ['index.html', /(<span id="m-ver"[^>]*>)[^<]*(<\/span>)/g, (m, a, b) => a + label + b],
  ['index.html', /(\.(?:js|css)\?v=)[0-9.]+/g, (m, a) => a + num],
  ['README.md', /^(# Pawnbreaker[^(\n]*\()[^)]*(\))/m, (m, a, b) => a + label + b]
];
let bad = 0;
for (const [file, re, rep] of rules) {
  const p = path.join(root, file), src = fs.readFileSync(p, 'utf8'), out = src.replace(re, rep);
  if (out !== src) { bad++; if (fix) fs.writeFileSync(p, out); console.log((fix ? 'fixed ' : 'out of sync: ') + file + ' ' + re); }
}
if (!bad) console.log('version ' + label + ' — all copies in sync');
process.exit(bad && !fix ? 1 : 0);
