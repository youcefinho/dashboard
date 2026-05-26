// i18n parity audit — extracts keys from each catalogue and compares sets.
const fs = require('fs');
const path = require('path');

const files = {
  'fr-CA': 'src/lib/i18n/fr-CA.ts',
  'fr-FR': 'src/lib/i18n/fr-FR.ts',
  'en':    'src/lib/i18n/en.ts',
  'es':    'src/lib/i18n/es.ts',
};

// Regex: capture key in single OR double quotes at start of (possibly indented) line: '....': or "....":
// keys may contain dots, letters, digits, underscore, hyphen.
const KEY_RE = /^\s*['"]([A-Za-z0-9_.\-]+)['"]\s*:/gm;

const catalogs = {};
for (const [lang, rel] of Object.entries(files)) {
  const abs = path.join(process.cwd(), rel);
  const src = fs.readFileSync(abs, 'utf8');
  const keys = new Set();
  let m;
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(src)) !== null) {
    keys.add(m[1]);
  }
  catalogs[lang] = keys;
}

// Print counts
console.log('=== KEY COUNTS ===');
for (const lang of Object.keys(files)) {
  console.log(`${lang}: ${catalogs[lang].size} keys`);
}

// Build union
const union = new Set();
for (const k of Object.keys(catalogs)) {
  for (const key of catalogs[k]) union.add(key);
}
console.log(`UNION: ${union.size} keys`);

// Per-lang missing keys
console.log('\n=== MISSING KEYS (per catalogue) ===');
const missing = {};
for (const lang of Object.keys(files)) {
  const miss = [];
  for (const key of union) {
    if (!catalogs[lang].has(key)) miss.push(key);
  }
  missing[lang] = miss.sort();
  console.log(`\n${lang}: ${miss.length} missing`);
  if (miss.length && miss.length <= 60) {
    for (const k of miss) console.log(`  - ${k}`);
  } else if (miss.length) {
    // group by module prefix
    const byModule = {};
    for (const k of miss) {
      const mod = k.split('.')[0];
      byModule[mod] = (byModule[mod] || 0) + 1;
    }
    console.log('  (too many, by module):');
    for (const [mod, n] of Object.entries(byModule).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${mod}: ${n}`);
    }
  }
}

// Write to JSON for downstream use
fs.writeFileSync(
  path.join(process.cwd(), 'scripts/i18n-parity-report.json'),
  JSON.stringify({ counts: Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, v.size])), union: union.size, missing }, null, 2),
);
console.log('\nReport written: scripts/i18n-parity-report.json');
