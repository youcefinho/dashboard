import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const isRemote = process.argv.includes('--remote');
const envFlag = isRemote ? '--remote' : '--local';
const dbName = 'intralys-crm';

function runSql(query: string, returnJson = false) {
  const jsonFlag = returnJson ? '--json' : '';
  const cmd = `npx wrangler d1 execute ${dbName} ${envFlag} --command="${query}" ${jsonFlag}`;
  try {
    const output = execSync(cmd, { encoding: 'utf-8', stdio: returnJson ? 'pipe' : 'inherit' });
    if (returnJson) return JSON.parse(output);
    return null;
  } catch (e) {
    console.error(`Erreur SQL: ${query}`);
    process.exit(1);
  }
}

function runFile(file: string) {
  console.log(`\n▶ Application de ${file}...`);
  const cmd = `npx wrangler d1 execute ${dbName} ${envFlag} --file="${file}"`;
  execSync(cmd, { stdio: 'inherit' });
}

function getFileHash(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function migrate() {
  console.log(`=== Intralys CRM Migration Tracker (${isRemote ? 'PROD' : 'LOCAL'}) ===`);

  // 1. Ensure table exists
  console.log('1. Vérification de la table _migrations...');
  runSql(`CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, hash TEXT, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  // 2. Fetch applied
  let appliedFiles: string[] = [];
  try {
    const res = runSql(`SELECT filename FROM _migrations`, true);
    if (res && res[0] && res[0].results) {
      appliedFiles = res[0].results.map((r: any) => r.filename);
    }
  } catch {
    console.log('Aucune migration précédente trouvée.');
  }

  // 3. Scan directory
  const rootDir = process.cwd();
  const allFiles = readdirSync(rootDir).filter(f => f.startsWith('migration-phase') && f.endsWith('.sql'));
  
  // Also include schema.sql and seed.sql if they exist but usually they are tracked as Phase 0 or manually.
  // We'll stick to 'migration-phase*.sql' as they represent incremental steps.
  
  // Sort naturally
  allFiles.sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  const pending = allFiles.filter(f => !appliedFiles.includes(f));

  if (pending.length === 0) {
    console.log('\n✅ La base de données est déjà à jour.');
    return;
  }

  console.log(`\n${pending.length} migration(s) en attente trouvée(s).`);

  for (const file of pending) {
    const content = readFileSync(join(rootDir, file), 'utf-8');
    const hash = getFileHash(content);

    runFile(file);

    // Record migration
    runSql(`INSERT INTO _migrations (filename, hash) VALUES ('${file}', '${hash}')`);
    console.log(`✅ ${file} appliqué et enregistré.`);
  }

  console.log('\n🎉 Toutes les migrations ont été appliquées avec succès.');
}

migrate().catch(console.error);
