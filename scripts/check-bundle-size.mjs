#!/usr/bin/env node
// ── Sprint 50 M1.3 — Bundle size budget enforcement ──
//
// Parse dist/assets/*.js, calcule la taille gzip, compare aux budgets.
// Exit 1 si un budget est dépassé (CI-ready). Exit 0 sinon.
// Si dist/ absent : exit 0 + warning (stub, ne casse pas la CI sans build).
//
// Usage : node scripts/check-bundle-size.mjs   (alias : npm run check:bundle)
//         node scripts/check-bundle-size.mjs --json   (sortie JSON)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const ASSETS_DIR = join(process.cwd(), 'dist', 'assets');
const KB = 1024;
const asJson = process.argv.includes('--json');

// ── Budgets (gzip) ──────────────────────────────────────
// Initial = ce qui charge au premier paint d'une route app
// (entry index + vendor-react + vendor-router + CSS critique).
// Les vendor lourds (recharts, xyflow…) sont LAZY → hors budget initial,
// budgétés séparément.
const BUDGETS = {
  // Bundle initial app (entry index + vendor-react + vendor-router).
  // Mesure réelle build Sprint 50 ≈ 213 KB gz. Budget = 230 KB (marge
  // ~8% anti-régression). NOTE : l'index entry (~128 KB gz) reste la
  // cible de réduction prioritaire post-beta (code-split AppLayout).
  initialApp: 230 * KB,
  // N'importe quelle page route chunk seule (lazy). Plus gros actuel :
  // Settings ~35 KB gz. Budget large = anti-régression majeure.
  pageChunkMax: 220 * KB,
  // Vendor chunks lazy — chargés on-demand par route. Plus gros :
  // vendor-recharts ~129 KB gz (Reports/Dashboard charts only).
  vendorChunkMax: 320 * KB,
  // CSS total (single file index-*.css, Tailwind + index.css ~58 KB gz).
  cssMax: 80 * KB,
};

// Chunks vendor connus (Sprint 43 — lazy, chargés par route qui les importe)
const VENDOR_PREFIXES = [
  'vendor-react', 'vendor-router', 'vendor-recharts', 'vendor-lucide',
  'vendor-dnd', 'vendor-radix', 'vendor-xyflow', 'vendor-cmdk',
  'vendor-markdown', 'vendor-dexie', 'vendor-signature', 'vendor-toast',
  'vendor-zod',
];

function gz(buf) { return gzipSync(buf, { level: 9 }).length; }
function fmt(n) { return (n / KB).toFixed(1) + ' KB'; }

if (!existsSync(ASSETS_DIR)) {
  const msg = 'dist/assets introuvable — build absent. check:bundle SKIP (exit 0).';
  if (asJson) console.log(JSON.stringify({ skipped: true, reason: msg }));
  else console.warn('⚠️  ' + msg + '\n   Lance `npm run build` puis ré-exécute.');
  process.exit(0);
}

const files = readdirSync(ASSETS_DIR).filter((f) => /\.(js|css)$/.test(f));
const report = { initialApp: 0, pages: [], vendors: [], css: 0, violations: [] };

let indexEntryGz = 0;
let vendorReactGz = 0;
let vendorRouterGz = 0;

for (const f of files) {
  const full = join(ASSETS_DIR, f);
  if (!statSync(full).isFile()) continue;
  const buf = readFileSync(full);
  const g = gz(buf);

  if (f.endsWith('.css')) {
    report.css += g;
    continue;
  }

  const isVendor = VENDOR_PREFIXES.some((p) => f.startsWith(p));
  if (isVendor) {
    report.vendors.push({ file: f, gzip: g });
    if (f.startsWith('vendor-react')) vendorReactGz += g;
    if (f.startsWith('vendor-router')) vendorRouterGz += g;
    if (g > BUDGETS.vendorChunkMax) {
      report.violations.push(
        `Vendor ${f} = ${fmt(g)} > plafond ${fmt(BUDGETS.vendorChunkMax)}`
      );
    }
  } else if (/^index-.*\.js$/.test(f)) {
    indexEntryGz += g;
  } else {
    report.pages.push({ file: f, gzip: g });
    if (g > BUDGETS.pageChunkMax) {
      report.violations.push(
        `Page chunk ${f} = ${fmt(g)} > budget ${fmt(BUDGETS.pageChunkMax)}`
      );
    }
  }
}

// Initial app = entry index + react + router (chargés au 1er paint)
report.initialApp = indexEntryGz + vendorReactGz + vendorRouterGz;
if (report.initialApp > BUDGETS.initialApp) {
  report.violations.push(
    `Bundle initial app = ${fmt(report.initialApp)} > budget ${fmt(BUDGETS.initialApp)}`
  );
}
if (report.css > BUDGETS.cssMax) {
  report.violations.push(
    `CSS total = ${fmt(report.css)} > budget ${fmt(BUDGETS.cssMax)}`
  );
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('\n\u{1F4E6}  Bundle size budget — Sprint 50 M1.3\n');
  console.log(`  Initial app (index+react+router) : ${fmt(report.initialApp)}  / budget ${fmt(BUDGETS.initialApp)}`);
  console.log(`  CSS total                        : ${fmt(report.css)}  / budget ${fmt(BUDGETS.cssMax)}`);
  console.log(`  Pages chunks                     : ${report.pages.length} (plafond ${fmt(BUDGETS.pageChunkMax)} chacun)`);
  const top = [...report.pages].sort((a, b) => b.gzip - a.gzip).slice(0, 5);
  for (const p of top) console.log(`    - ${p.file.padEnd(38)} ${fmt(p.gzip)}`);
  console.log(`  Vendor chunks (lazy)             : ${report.vendors.length} (plafond ${fmt(BUDGETS.vendorChunkMax)} chacun)`);
  for (const v of [...report.vendors].sort((a, b) => b.gzip - a.gzip)) {
    console.log(`    - ${v.file.padEnd(38)} ${fmt(v.gzip)}`);
  }
  console.log('');
  if (report.violations.length) {
    console.error('❌  DÉPASSEMENTS BUDGET :');
    for (const v of report.violations) console.error('   - ' + v);
    console.error('');
  } else {
    console.log('✅  Tous les budgets respectés.\n');
  }
}

process.exit(report.violations.length ? 1 : 0);
