import { execSync } from 'child_process';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const isRemote = process.argv.includes('--remote');
const envFlag = isRemote ? '--remote' : '--local';
const dbName = 'intralys-crm';
// Flags S2 M1 — défensifs, défaut = comportement strict/sûr
const isDryRun = process.argv.includes('--dry-run');
const continueOnError = process.argv.includes('--continue-on-error');

// Motifs d'erreur SQLite bénins = fichier déjà appliqué (idempotence best-effort).
// ⚠ LIMITE D1 : `wrangler d1 execute --file` exécute le fichier en BLOC, sans
// granularité statement fiable. Un skip est donc best-effort au NIVEAU FICHIER :
// si un ALTER « duplicate column » est suivi d'autres ALTER dans le même fichier,
// wrangler peut interrompre le reste du bloc. Recommandation opérationnelle :
// si `migration-sprint51-m2.sql` bloque sur le duplicate `gclid`, découper
// manuellement ce fichier pour rejouer ses 6 ALTER suivants isolément.
const BENIGN_ERROR_PATTERNS = [
  'duplicate column',
  'already exists',
  'no such table',
];

function isBenignError(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return BENIGN_ERROR_PATTERNS.some(p => lower.includes(p));
}

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

// Retourne :
//  - ok:true                → exécuté proprement
//  - ok:false,benign:true   → échec sur motif bénin (déjà appliqué) → enregistrable
//  - ok:false,benign:false  → ERREUR DURE → NE PAS enregistrer, stop (sauf --continue-on-error)
function runFile(file: string): { ok: boolean; benign: boolean; message?: string } {
  console.log(`\n▶ Application de ${file}...`);
  const cmd = `npx wrangler d1 execute ${dbName} ${envFlag} --file="${file}"`;
  try {
    // stdio:'pipe' pour pouvoir analyser le message d'erreur (idempotence).
    const out = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
    if (out) process.stdout.write(out);
    return { ok: true, benign: false };
  } catch (err: any) {
    const message = `${err?.stderr ?? ''}${err?.stdout ?? ''}${err?.message ?? ''}`;
    if (isBenignError(message)) {
      console.log(`↪ skip: ${file} (motif bénin reconnu — probablement déjà appliqué)`);
      return { ok: false, benign: true, message };
    }
    console.error(`✖ ${file} a échoué sur une erreur NON reconnue :`);
    console.error(message.trim().slice(0, 1000));
    return { ok: false, benign: false, message };
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

// ── Fallback EXACT — ancien comportement 5 buckets (zéro régression) ──
// ⚠ NE PAS MODIFIER cette fonction : c'est le filet de sécurité si le
// manifest est absent / illisible. Elle DOIT rester identique à l'origine.
function getOrderedMigrationsFallback(allFiles: string[]): string[] {
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

// M1.1 — Ordre canonique depuis docs/migrations-manifest.json (contrat S1 figé,
// LECTURE SEULE). Trié par `seq`, filtré aux fichiers réellement présents sur
// disque. En cas d'absence / JSON invalide → fallback EXACT 5 buckets + warn.
// `rootDir` injectable pour testabilité.
function getOrderedMigrations(allFiles: string[], rootDir = process.cwd()): string[] {
  const manifestPath = join(rootDir, 'docs', 'migrations-manifest.json');
  try {
    if (!existsSync(manifestPath)) {
      console.warn(
        `⚠ Manifest absent (${manifestPath}). Fallback ordre 5-buckets historique.`
      );
      return getOrderedMigrationsFallback(allFiles);
    }
    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const entries: Array<{ seq: number; file: string }> = Array.isArray(parsed)
      ? parsed
      : parsed?.migrations;
    if (!Array.isArray(entries) || entries.length === 0) {
      console.warn(
        '⚠ Manifest présent mais sans tableau `migrations` exploitable. Fallback 5-buckets.'
      );
      return getOrderedMigrationsFallback(allFiles);
    }

    const onDisk = new Set(allFiles);
    const sorted = [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    // Warn : fichiers référencés au manifest mais absents du disque
    for (const e of sorted) {
      if (e.file && !onDisk.has(e.file)) {
        console.warn(`⚠ Manifest référence "${e.file}" mais le fichier est absent sur disque — ignoré.`);
      }
    }
    // Warn : fichiers sur disque mais absents du manifest (jamais joués)
    const inManifest = new Set(sorted.map(e => e.file));
    for (const f of allFiles) {
      if (!inManifest.has(f)) {
        console.warn(`⚠ Fichier "${f}" présent sur disque mais absent du manifest — non ordonné, non appliqué.`);
      }
    }

    const ordered = sorted
      .map(e => e.file)
      .filter((f): f is string => !!f && onDisk.has(f));

    if (ordered.length === 0) {
      console.warn('⚠ Manifest ne recoupe aucun fichier présent. Fallback 5-buckets.');
      return getOrderedMigrationsFallback(allFiles);
    }
    console.log(`(manifest) ${ordered.length} migration(s) ordonnée(s) via docs/migrations-manifest.json.`);
    return ordered;
  } catch (e: any) {
    console.warn(
      `⚠ Manifest illisible / JSON invalide (${e?.message ?? e}). Fallback ordre 5-buckets historique.`
    );
    return getOrderedMigrationsFallback(allFiles);
  }
}

// M1.3 — Garde rebuild E9. `migration-sprintE9-m1.sql` fait un
// rebuild:workflow_enrollments qui DÉPEND de migration-phase3.sql appliquée.
// Pré-check : si phase3 absente de _migrations, STOP explicite.
// Pure / testable : prend la liste des fichiers déjà appliqués.
const E9_REBUILD_FILE = 'migration-sprintE9-m1.sql';
const E9_REQUIRED = 'migration-phase3.sql';

function assertE9Guard(file: string, appliedFiles: string[]): { ok: boolean; reason?: string } {
  if (file !== E9_REBUILD_FILE) return { ok: true };
  if (appliedFiles.includes(E9_REQUIRED)) return { ok: true };
  return {
    ok: false,
    reason:
      `⛔ STOP : ${E9_REBUILD_FILE} (rebuild:workflow_enrollments) requiert que ` +
      `${E9_REQUIRED} soit déjà dans _migrations, ce qui n'est PAS le cas. ` +
      `Ne PAS rejouer ce rebuild sans suivre la procédure backup+COUNT décrite ` +
      `dans docs/AUDIT-workflow-enrollments-E9.md.`,
  };
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

  // M1.3 — --dry-run : log l'ordre exact qui SERAIT appliqué, sans rien exécuter.
  if (isDryRun) {
    console.log('\n--dry-run actif : AUCUN wrangler ne sera exécuté. Ordre prévu :');
    pending.forEach((f, i) => console.log(`  ${String(i + 1).padStart(3, ' ')}. ${f}`));
    console.log('\n(dry-run) Fin — rien n\'a été appliqué.');
    return;
  }

  let succeeded = 0;
  let skipped = 0;
  for (const file of pending) {
    // Garde E9 — avant tout rebuild workflow_enrollments
    const guard = assertE9Guard(file, appliedFiles);
    if (!guard.ok) {
      console.error(`\n${guard.reason}`);
      process.exitCode = 1;
      return;
    }

    const content = readFileSync(join(rootDir, file), 'utf-8');
    const hash = getFileHash(content);

    const result = runFile(file);

    if (result.ok || result.benign) {
      // Enregistré SEULEMENT si succès propre ou échec sur motif bénin reconnu.
      runSql(`INSERT OR REPLACE INTO _migrations (filename, hash) VALUES ('${file}', '${hash}')`);
      appliedFiles.push(file);
      if (result.ok) {
        succeeded++;
        console.log(`✅ ${file} appliqué et enregistré.`);
      } else {
        skipped++;
        console.log(`↪ ${file} enregistré (skip idempotent — motif bénin).`);
      }
    } else {
      // ERREUR DURE non reconnue : NE PAS enregistrer dans _migrations.
      if (continueOnError) {
        console.warn(`⚠ ${file} en erreur DURE — non enregistré. --continue-on-error : on poursuit.`);
        continue;
      }
      console.error(
        `\n⛔ STOP : ${file} a échoué sur une erreur non reconnue et N'A PAS été ` +
        `enregistré dans _migrations. Corriger puis relancer (ou --continue-on-error).`
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n🎉 ${succeeded} migration(s) appliquée(s), ${skipped} skip idempotent(s).`);
}

// Exports pour tests unitaires (logique pure, sans effet de bord).
export {
  getOrderedMigrations,
  getOrderedMigrationsFallback,
  isBenignError,
  assertE9Guard,
  naturalNumberKey,
  BENIGN_ERROR_PATTERNS,
};

// Auto-exécution UNIQUEMENT en lancement direct (pas à l'import par les tests).
// process.argv[1] contient le chemin du script lancé via `node/tsx scripts/migrate.ts`.
const invokedDirectly =
  !!process.argv[1] && /migrate\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  migrate().catch(console.error);
}
