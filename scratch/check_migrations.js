const { readdirSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');

const rootDir = 'C:\\Users\\rochdi\\.gemini\\antigravity-ide\\scratch\\intralys-dashboard';
const manifestPath = join(rootDir, 'docs', 'migrations-manifest.json');

const allFiles = readdirSync(rootDir).filter(f =>
  (f.startsWith('migration-') || f.startsWith('migration_'))
  && f.endsWith('.sql')
);

if (!existsSync(manifestPath)) {
  console.error('Manifest introuvable');
  process.exit(1);
}

const raw = readFileSync(manifestPath, 'utf-8');
const parsed = JSON.parse(raw);
const entries = parsed.migrations || [];
const inManifest = new Set(entries.map(e => e.file));

console.log('Fichiers sur le disque absents du manifest :');
const missing = [];
for (const f of allFiles) {
  if (!inManifest.has(f)) {
    console.log(`- ${f}`);
    missing.push(f);
  }
}
console.log(`Total manquants: ${missing.length}`);
