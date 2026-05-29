const { readFileSync } = require('fs');
const { join } = require('path');

const rootDir = 'C:\\Users\\rochdi\\.gemini\\antigravity-ide\\scratch\\intralys-dashboard';
const manifestPath = join(rootDir, 'docs', 'migrations-manifest.json');

const raw = readFileSync(manifestPath, 'utf-8');
const parsed = JSON.parse(raw);
const entries = parsed.migrations || [];

const found = entries.filter(e => e.file.includes('affiliate'));
console.log('Fichiers contenant "affiliate" dans le manifest :', found);
console.log('Nombre total d\'entrées dans le manifest :', entries.length);
