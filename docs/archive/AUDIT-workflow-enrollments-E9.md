# AUDIT — Rebuild `workflow_enrollments` (Sprint E9-m1)

> Doc additif READ-ONLY (Sprint S1 / Manager M2). Aucun `.sql` ni code modifié.
> Sources lues : `migration-sprintE9-m1.sql`, `migration-phase3.sql`,
> `migration-phase41.sql`, `schema.sql`, `scripts/migrate.ts`,
> `scripts/backup.sh`, `src/worker/workflows.ts`.

## 0. Résumé exécutif

`migration-sprintE9-m1.sql` reconstruit `workflow_enrollments` via le pattern
table-rebuild éprouvé (identique à `migration-phase41.sql` pour `messages`) :
`PRAGMA foreign_keys=OFF` → `CREATE workflow_enrollments_new` → `INSERT … SELECT`
→ `DROP` → `RENAME` → recréation index → `PRAGMA foreign_keys=ON`.

**Verdict mapping : la branche LEAD existante est copiée BIT-POUR-BIT** sur les
8 colonnes héritées. Les seules différences sont **additives et intentionnelles**
(3 colonnes e-comm forcées à des valeurs neutres). Aucune perte, aucune
transformation de donnée lead.

---

## M2.1 — Diff colonne-à-colonne (preuve du mapping bit-pour-bit)

Source = `migration-phase3.sql:34-43` (table `workflow_enrollments` originale).
Cible = `migration-sprintE9-m1.sql:32-44` (`workflow_enrollments_new`).
Valeur = clause `SELECT` de l'`INSERT` `migration-sprintE9-m1.sql:48-53`.

| # | Colonne source (phase3:L) | Type/contrainte source | Colonne cible (E9-m1:L) | Type/contrainte cible | Valeur INSERT (E9-m1 L51-52) | Verdict |
|---|---|---|---|---|---|---|
| 1 | `id` (L35) | `TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))` | `id` (L33) | **identique** | `id` | ✅ bit-pour-bit |
| 2 | `workflow_id` (L36) | `TEXT NOT NULL REFERENCES workflows(id)` | `workflow_id` (L34) | **identique** (FK `workflows` conservée) | `workflow_id` | ✅ bit-pour-bit |
| 3 | `lead_id` (L37) | `TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE` | `lead_id` (L35) | `TEXT` (NULLABLE, **FK leads retirée**) | `lead_id` | ✅ valeur préservée — voir ⚠️ A & C |
| — | *(absente)* | — | `customer_id` (L36) | `TEXT` | `NULL` | ➕ additif neutre |
| — | *(absente)* | — | `order_id` (L37) | `TEXT` | `NULL` | ➕ additif neutre |
| — | *(absente)* | — | `entity_type` (L38) | `TEXT DEFAULT 'lead'` | `'lead'` (littéral forcé) | ➕ additif, rétro-défaut correct |
| 4 | `current_step_id` (L38) | `TEXT` | `current_step_id` (L39) | **identique** | `current_step_id` | ✅ bit-pour-bit |
| 5 | `status` (L39) | `TEXT CHECK (status IN ('active','paused','completed','cancelled')) DEFAULT 'active'` | `status` (L40) | **identique** (CHECK + DEFAULT préservés) | `status` | ✅ bit-pour-bit |
| 6 | `next_action_at` (L40) | `TEXT` | `next_action_at` (L41) | **identique** | `next_action_at` | ✅ bit-pour-bit |
| 7 | `enrolled_at` (L41) | `TEXT DEFAULT (datetime('now'))` | `enrolled_at` (L42) | **identique** | `enrolled_at` | ✅ bit-pour-bit |
| 8 | `completed_at` (L42) | `TEXT` | `completed_at` (L43) | **identique** | `completed_at` | ✅ bit-pour-bit |

### Conclusion M2.1

- **Ordre des colonnes du SELECT explicite et aligné** sur la liste de colonnes
  de l'`INSERT` (E9-m1 L48-50) → aucun décalage de mapping positionnel.
- Les 8 colonnes historiques sont copiées **à l'identique, sans cast ni
  transformation**. `status` et ses CHECK/DEFAULT, `enrolled_at` et son DEFAULT
  sont préservés textuellement.
- **Seule divergence de schéma sur `lead_id`** : passage de `NOT NULL
  REFERENCES leads(id) ON DELETE CASCADE` → `TEXT` nullable sans FK. **La
  *valeur* `lead_id` de chaque ligne lead existante reste son ID réel** (copie
  directe de la colonne) — donc bit-pour-bit côté donnée. Le relâchement de
  contrainte est documenté et volontaire (cf. E9-m1 L9-21). Cohérent avec
  `src/worker/workflows.ts:410,414` qui lit `enrollment.lead_id` tel quel pour
  les enrollments `entity_type='lead'`.
- Les 3 colonnes e-comm sont **strictement additives** : `customer_id=NULL`,
  `order_id=NULL`, `entity_type='lead'` → aucun impact sur la sémantique des
  lignes lead historiques. `workflows.ts:356,420` retombe sur `'lead'` quand
  `entity_type` est absent, cohérent avec le DEFAULT.

**MAPPING E9 : bit-pour-bit PROUVÉ pour la branche LEAD** (perte de donnée nulle ;
seule la *contrainte* FK leads est volontairement abandonnée, pas la valeur).

---

## M2.2 — Risques du rebuild

### (a) `INSERT … SELECT FROM workflow_enrollments` sans garde `IF EXISTS`

`migration-sprintE9-m1.sql:48-53` lit directement `FROM workflow_enrollments`
sans test d'existence. SQLite **n'a pas** de `INSERT … SELECT` conditionnel à
l'existence de la table source. Si `workflow_enrollments` n'existe pas (env
neuf où `migration-phase3.sql` n'a pas tourné AVANT), le statement échoue
(`no such table: workflow_enrollments`).

- **Mitigation runner** : `scripts/migrate.ts:23-35` (`runFile`) catche l'échec,
  log `⚠ … a échoué partiellement` et **enregistre quand même** la migration
  dans `_migrations` (`INSERT OR REPLACE`, L115). Conséquence : sur env neuf,
  E9-m1 pourrait être **marquée appliquée alors que la table n'a pas été
  reconstruite** → état schéma incohérent silencieux.
- **Ordre requis CONFIRMÉ** : E9-m1 **doit** tourner APRÈS `migration-phase3.sql`
  (qui `CREATE TABLE IF NOT EXISTS workflow_enrollments`). L'ordre canonique de
  `getOrderedMigrations` (`scripts/migrate.ts:53-69`) place `migration-phaseN`
  N>13 par numéro croissant puis… **mais `migration-sprintE9-m1.sql` n'est PAS
  capturé par les buckets `phaseEarly/p3/sprint2/sprint3/phaseLate`** : il ne
  matche ni `^migration-phase\d+\.sql$` ni `migration-sprint2-` ni
  `migration-sprint3.sql`. **Il est donc absent du tableau retourné par
  `getOrderedMigrations` → jamais appliqué par ce runner.** ⚠️ Risque réel
  d'orchestration (voir M2.4, à corréler avec docs/MIGRATIONS-ORDER.md — M1).

> NB factuel : `getOrderedMigrations` ne renvoie que
> `[...phaseEarly, ...p3, ...sprint2, ...sprint3, ...phaseLate]`. Les fichiers
> `migration-sprintE*-m*.sql` et `migration-sprint46+` ne sont dans **aucun**
> bucket. Verdict : **l'ordre d'application des migrations E9 n'est pas couvert
> par `scripts/migrate.ts` actuel** — application manuelle ou pipeline externe
> requis. (Hors file-ownership M2 : signalé pour M1/M3.)

### (b) `PRAGMA foreign_keys=OFF/ON` exécuté par le runner D1

`scripts/migrate.ts:25` invoque `npx wrangler d1 execute … --file="<file>"` :
**le fichier entier est passé en un seul appel** à Wrangler/D1 (pas de split
statement-par-statement côté `migrate.ts`). Le PRAGMA et le rebuild partagent
donc le même contexte d'exécution du fichier.

- **Limite connue D1/SQLite-Workers** : `PRAGMA foreign_keys` est une opération
  **no-op à l'intérieur d'une transaction**, et D1 enveloppe l'exécution d'un
  fichier. En pratique D1 **ignore largement `PRAGMA foreign_keys`** et applique
  son propre régime FK. Le pattern reste néanmoins **sûr ici** car le rebuild
  ne crée aucune ligne orpheline : `workflow_id` pointe toujours vers un
  `workflows` valide (FK conservée), et la FK `leads` est *supprimée* (donc
  aucune vérification résiduelle possible). `migration-phase41.sql:9,47`
  utilise **exactement le même encadrement PRAGMA** et est en production →
  pattern validé empiriquement.
- **Verdict** : le `PRAGMA OFF/ON` est **cosmétique/défensif** sous D1, non
  load-bearing. Le rebuild est correct *indépendamment* de l'effet réel du
  PRAGMA, car aucune ligne copiée ne viole une FK conservée.

### (c) FK supprimées / recréées — impact `ON DELETE CASCADE`

| FK | phase3 (avant) | E9-m1 (après) | Impact |
|---|---|---|---|
| `workflow_id → workflows(id)` | `REFERENCES workflows(id)` (pas de CASCADE) | `REFERENCES workflows(id)` (L34) | **Inchangé** ✅ |
| `lead_id → leads(id)` | `NOT NULL REFERENCES leads(id) ON DELETE CASCADE` (phase3:L37) | **RETIRÉE** (L35 : `lead_id TEXT` nullable, pas de REFERENCES) | ⚠️ **Perte du `ON DELETE CASCADE`** : supprimer un `leads` ne supprime plus automatiquement ses enrollments → enrollments **orphelins possibles** (lignes `lead_id` pointant un lead supprimé). |

**Conséquence métier** : la suppression d'un lead ne purge plus ses
enrollments. `src/worker/workflows.ts:48` fait `LEFT JOIN leads l ON
we.lead_id = l.id` (LEFT JOIN → tolère l'orphelin, pas de crash), et
`workflows.ts:157` supprime explicitement les enrollments par `workflow_id` à
la suppression d'un workflow. **Aucune purge applicative par `lead_id`
détectée** → dette : un nettoyage applicatif/cron des enrollments dont le
`leads` n'existe plus devrait être ajouté (hors scope M2, signalé). Décision
documentée et assumée dans E9-m1 L9-21 (sentinelle e-comm impossible sinon).

### (d) Les 4 index historiques recréés ?

Comparaison phase3 (L45-48) ↔ E9-m1 (L59-62) :

| Index | phase3 | E9-m1 | Verdict |
|---|---|---|---|
| `idx_enrollments_workflow_id (workflow_id)` | L45 | L59 | ✅ identique |
| `idx_enrollments_lead_id (lead_id)` | L46 | L60 | ✅ identique |
| `idx_enrollments_status (status)` | L47 | L61 | ✅ identique |
| `idx_enrollments_next_action (next_action_at)` | L48 | L62 | ✅ identique |

**Les 4 index historiques sont recréés à l'identique** (mêmes noms, mêmes
colonnes, `IF NOT EXISTS`). E9-m1 ajoute en plus 2 index e-comm
(`idx_enrollments_customer` L65, `idx_enrollments_order` L66) + 2 index
analytics `orders` (L72-75) — additifs, hors table.

> ⚠️ Note SQLite : après `DROP TABLE`, les index de l'ancienne table sont
> détruits avec elle ; les `CREATE INDEX … IF NOT EXISTS` post-RENAME les
> recréent bien sur la nouvelle table. Couverture d'index **intégralement
> restaurée**.

### Verdict M2.2

| Risque | Verdict |
|---|---|
| (a) INSERT sans garde + ordre | ⚠️ **RÉEL** : échoue sur env neuf si phase3 absent ; **E9-m1 non capté par `getOrderedMigrations`** → ordre/exécution à garantir hors runner actuel |
| (b) PRAGMA D1 | 🟢 **NON-bloquant** : PRAGMA quasi no-op sous D1 mais rebuild correct indépendamment ; pattern phase41 validé en prod |
| (c) FK leads perdue | ⚠️ **RÉEL & ASSUMÉ** : perte `ON DELETE CASCADE` → enrollments orphelins possibles, pas de purge applicative par `lead_id` |
| (d) 4 index historiques | 🟢 **OK** : recréés à l'identique + 2 additifs |

---

## M2.4 — Procédure d'application SÛRE en production

> Hypothèse : D1 distant (`--remote`), base `intralys-crm`.

### Pré-requis d'ordre (CANONIQUE)

E9-m1 dépend de tables créées AVANT lui :

1. `workflows` — créée par `migration-phase3.sql:5` (FK `workflow_id` cible).
2. `workflow_enrollments` (version phase3) — créée par `migration-phase3.sql:34`
   (table source du `INSERT … SELECT`).
3. `leads` — définie dans `schema.sql:35` (référence métier, plus de FK après
   rebuild mais valeurs `lead_id` doivent rester cohérentes).
4. `customers` / `orders` — `migration-sprintE1-m1-ecommerce-schema.sql:131,162`
   (non requis pour le rebuild lui-même : colonnes additives non-FK ; requis
   pour la phase d'usage e-comm).

> **Ordre obligatoire : `migration-phase3.sql` (+ toute migration créant
> `leads`/`workflows`) DOIT être appliqué AVANT `migration-sprintE9-m1.sql`.**
> Voir **docs/MIGRATIONS-ORDER.md** (livré par M1) pour le manifest canonique
> figé — ne pas dépendre de `getOrderedMigrations` qui ne capte pas le préfixe
> `migration-sprintE9-`.

### Procédure pas-à-pas

```
0. PRÉ-CHECK ORDRE
   - Vérifier que migration-phase3.sql est dans _migrations (déjà appliqué).
     SELECT filename FROM _migrations WHERE filename='migration-phase3.sql';
   - Si absent → STOP, appliquer d'abord les migrations amont.

1. BACKUP PRÉALABLE (obligatoire)
   - ./scripts/backup.sh --remote
   - scripts/backup.sh:18 → `wrangler d1 export intralys-crm --remote
     --output=backups/intralys_crm_<DATE>.sql`
   - Vérifier code retour 0 ("✅ Backup réussi") ET taille fichier > 0.
   - Conserver le chemin backups/intralys_crm_<DATE>.sql pour rollback.

2. COUNT AVANT (assertion d'intégrité)
   - npx wrangler d1 execute intralys-crm --remote \
       --command="SELECT COUNT(*) AS n FROM workflow_enrollments" --json
   - Noter N_AVANT (et idéalement la répartition par status).

3. APPLICATION
   - npx wrangler d1 execute intralys-crm --remote \
       --file="migration-sprintE9-m1.sql"
   - Surveiller la sortie : aucune erreur `no such table`,
     `FOREIGN KEY constraint failed`, ni `UNIQUE constraint`.

4. COUNT APRÈS (vérification bit-pour-bit volumétrique)
   - SELECT COUNT(*) AS n FROM workflow_enrollments  → N_APRES
   - ASSERTION : N_APRES == N_AVANT
   - Contrôle complémentaire conseillé :
     SELECT COUNT(*) FROM workflow_enrollments
       WHERE entity_type='lead' AND lead_id IS NOT NULL;
     → doit == N_AVANT (toutes les anciennes lignes = branche lead).
   - SELECT COUNT(*) FROM workflow_enrollments
       WHERE customer_id IS NOT NULL OR order_id IS NOT NULL; → doit == 0.

5. VÉRIF SCHÉMA
   - PRAGMA table_info(workflow_enrollments); → 11 colonnes,
     lead_id NULLABLE, entity_type DEFAULT 'lead'.
   - SELECT name FROM sqlite_master WHERE type='index'
       AND tbl_name='workflow_enrollments';
     → présence des 4 index historiques + idx_enrollments_customer/order.

6. ENREGISTREMENT (si application manuelle hors migrate.ts)
   - INSERT OR REPLACE INTO _migrations (filename, hash)
       VALUES ('migration-sprintE9-m1.sql', '<sha256 du fichier>');
```

### Rollback si divergence

Déclencheurs : étape 3 en erreur, OU `N_APRES != N_AVANT`, OU schéma/index
manquant à l'étape 5.

```
R1. NE PAS ré-exécuter E9-m1 (le DROP TABLE est déjà potentiellement passé).
R2. Restaurer depuis le backup étape 1 :
    - Recréer la base depuis backups/intralys_crm_<DATE>.sql
      (wrangler d1 execute --file=<backup>) sur une base de
      restauration / ou import contrôlé.
R3. Re-vérifier COUNT == N_AVANT après restauration.
R4. Post-mortem avant toute nouvelle tentative.
```

### Risque résiduel (honnête)

- **D1 n'a pas de transaction multi-statement garantie sur `--file`** : si
  l'exécution casse APRÈS `DROP TABLE workflow_enrollments` (E9-m1:L55) mais
  AVANT `RENAME` (L56), la table est **perdue** sans renommage → seul le backup
  étape 1 protège. C'est le point de fragilité maximal : **le backup n'est pas
  optionnel.**
- Perte définitive du `ON DELETE CASCADE` sur `lead_id` (M2.2.c) : non
  réversible sans nouveau rebuild ; assumée par design E9.
- L'absence de capture de `migration-sprintE9-m1.sql` par `getOrderedMigrations`
  signifie que **l'automatisation `migrate.ts` ne joue pas cette migration** :
  application manuelle contrôlée requise (cette procédure), ou correction du
  runner (hors scope M2 — relève M1/M3).

---

## Annexe — Cohérence applicative (`src/worker/workflows.ts`)

- L227 : ancien `INSERT` 6 colonnes (`id, workflow_id, lead_id,
  current_step_id, status, next_action_at`) — compatible post-rebuild
  (colonnes e-comm prennent leurs DEFAULT/NULL, `entity_type` → `'lead'`).
- L303 : nouvel `INSERT` 9 colonnes incluant `customer_id, order_id,
  entity_type` — exploite les colonnes additives.
- L283-287 : déduplication par `lead_id` | `customer_id` | `order_id` selon
  `entityType` — repose sur les 3 nouveaux index (L60/65/66).
- L356/410/420 : lecture rétro-compatible `entity_type || 'lead'` — alignée
  sur le DEFAULT `'lead'` du schéma reconstruit.

→ Le code Sprint 46/E9 est **cohérent avec le schéma reconstruit** ;
la branche lead reste lue/écrite à l'identique.

---

## Suivi S2 — M3 (annexe, audit S1 ci-dessus INTACT)

> Ajouté S2/M3. Aucun `.sql`/rebuild touché par M3 (scope M2/M1). Volet
> timestamp uniquement : `workflow_enrollments` utilise `enrolled_at`/
> `completed_at` en **TEXTE `datetime('now')`** (cf. M2.1 : `enrolled_at TEXT
> DEFAULT (datetime('now'))` préservé bit-pour-bit). Donc **conforme au standard
> texte du projet — aucune colonne `unixepoch`/ms ici, aucun risque cross-format
> timestamp, aucun câblage dbTime requis**. La dette « purge enrollments
> orphelins par `lead_id` » (M2.2.c) reste un constat S1 hors périmètre M3 (non
> traitée ici, inchangée). Détail timestamps : `docs/TIMESTAMP-CONSISTENCY-MAP.md`
> → « Suivi S2 ».
