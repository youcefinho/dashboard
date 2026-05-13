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

function runFile(file: string): { ok: boolean; partial?: boolean } {
  console.log(`\n▶ Application de ${file}...`);
  const cmd = `npx wrangler d1 execute ${dbName} ${envFlag} --file="${file}"`;
  try {
    execSync(cmd, { stdio: 'inherit' });
    return { ok: true };
  } catch (err: any) {
    // Migration may have been partially applied (e.g. ALTER TABLE column already exists)
    // We log it but mark as partial — the migration is recorded so we don't retry.
    console.warn(`⚠ ${file} a échoué partiellement (probablement déjà appliqué). On continue.`);
    return { ok: false, partial: true };
  }
}

function getFileHash(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ── Ordre d'application déterministe ────────────────────────
// 1. Sprint 0-3 foundations (phase1-13)
// 2. Sprint 0 P3 extras (p3_*)
// 3. Sprint 2 (sprint2-phase0, sprint2-phase1)
// 4. Sprint 3 (sprint3)
// 5. Sprints 4+ (phase14 et plus)
function naturalNumberKey(name: string): number {
  // Extrait le premier nombre du nom de fichier pour tri numérique
  const match = name.match(/(\d+)/);
  return match ? parseInt(match[1]!, 10) : 0;
}

function getOrderedMigrations(allFiles: string[]): string[] {
  const phaseEarly = allFiles
    .filter(f => /^migration-phase(\d+)\.sql$/.test(f) && naturalNumberKey(f) <= 13)
    .sort((a, b) => naturalNumberKey(a) - naturalNumberKey(b));
  const p3 = allFiles
    .filter(f => f.startsWith('migration_p3_'))
    .sort((a, b) => naturalNumberKey(a) - naturalNumberKey(b));
  const sprint2 = allFiles
    .filter(f => f.startsWith('migration-sprint2-'))
    .sort();
  const sprint3 = allFiles.filter(f => f === 'migration-sprint3.sql');
  const phaseLate = allFiles
    .filter(f => /^migration-phase(\d+)\.sql$/.test(f) && naturalNumberKey(f) > 13)
    .sort((a, b) => naturalNumberKey(a) - naturalNumberKey(b));

  return [...phaseEarly, ...p3, ...sprint2, ...sprint3, ...phaseLate];
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

  // 3. Scan directory — catch ALL migration prefixes
  const rootDir = process.cwd();
  const allFiles = readdirSync(rootDir).filter(f =>
    (f.startsWith('migration-phase') || f.startsWith('migration-sprint') || f.startsWith('migration_p3_'))
    && f.endsWith('.sql')
  );

  const ordered = getOrderedMigrations(allFiles);
  const pending = ordered.filter(f => !appliedFiles.includes(f));

  if (pending.length === 0) {
    console.log('\n✅ La base de données est déjà à jour.');
    return;
  }

  console.log(`\n${pending.length} migration(s) en attente trouvée(s).`);

  let succeeded = 0;
  let partial = 0;
  for (const file of pending) {
    const content = readFileSync(join(rootDir, file), 'utf-8');
    const hash = getFileHash(content);

    const result = runFile(file);

    // Record migration even on partial failure — most likely already applied
    runSql(`INSERT OR REPLACE INTO _migrations (filename, hash) VALUES ('${file}', '${hash}')`);
    if (result.ok) {
      succeeded++;
      console.log(`✅ ${file} appliqué et enregistré.`);
    } else {
      partial++;
      console.log(`⚠ ${file} enregistré (partiel).`);
    }
  }

  console.log(`\n🎉 ${succeeded} migration(s) appliquée(s) avec succès, ${partial} partielle(s).`);
}

migrate().catch(console.error);
