# TIMESTAMP-CONSISTENCY-MAP — Sprint S1 / M3

> Cartographie READ-ONLY des formats de timestamps dans `src/worker/` et les
> migrations `.sql`. Aucun code/SQL modifié. Produit par M3 (Chaman, S1).
> Date relevé : 2026-05-16.

## 1. Standard de fait du projet

| Format | Occurrences | Portée |
|---|---|---|
| `datetime('now')` → texte `YYYY-MM-DD HH:MM:SS` (UTC) | **146** sur **58 fichiers** worker | Standard dominant, toutes colonnes `*_at TEXT` |
| Colonnes SQL `*_at TEXT` / `DATETIME` (legacy `TEXT`) | **276** sur **67 fichiers** `.sql` | Convention historique (phases 1→41 + sprints E*) |
| `unixepoch()` → entier (secondes epoch) | **9** lignes worker (3 fichiers) + tables migrations récentes | Îlot minoritaire (sprint43/46/49/50) |

**Convention canonique = texte `YYYY-MM-DD HH:MM:SS` (comparable lexicographiquement).**
L'îlot `unixepoch` (entiers) est l'exception introduite par les tables récentes.

## 2. Inventaire exhaustif `unixepoch` dans `src/worker/`

| Fichier:ligne | Expression | Contexte | Risque |
|---|---|---|---|
| `admin-analytics.ts:115` | `strftime('%w', event_time, 'unixepoch')` | SELECT/GROUP BY heatmap | OK interne (modificateur `'unixepoch'` cohérent avec colonne INTEGER) |
| `admin-analytics.ts:116` | `strftime('%H', event_time, 'unixepoch')` | SELECT heatmap | OK interne (idem) |
| `admin-analytics.ts:119` | `WHERE event_time >= ?` (bind `since` = `Math.floor(Date.now()/1000) - …`) | WHERE filtre période | OK : compare entier vs entier (epoch s vs epoch s) |
| `beta.ts:37` | `created_at INTEGER DEFAULT (unixepoch())` | CREATE TABLE `beta_signups` | Îlot INTEGER (CREATE IF NOT EXISTS bootstrap) |
| `beta.ts:44` | `created_at INTEGER DEFAULT (unixepoch())` | CREATE TABLE `magic_tokens` | Îlot INTEGER |
| `beta.ts:52` | `created_at INTEGER DEFAULT (unixepoch())` | CREATE TABLE `beta_feedback` | Îlot INTEGER |
| `beta.ts:61` | `created_at INTEGER DEFAULT (unixepoch())` | CREATE TABLE `roadmap_items` | Îlot INTEGER |
| `beta.ts:66` | `created_at INTEGER DEFAULT (unixepoch())` | CREATE TABLE `roadmap_votes` | Îlot INTEGER |
| `dashboards.ts:104` | `sets.push('updated_at = (unixepoch())')` | UPDATE dashboards | Îlot INTEGER (cohérent si colonne `updated_at` créée INTEGER) |
| `dashboards.ts:134` | `UPDATE dashboards SET … updated_at = (unixepoch())` | UPDATE share token | Îlot INTEGER |

### Correction du constat Chaman
- **`ecommerce-analytics.ts` = FAUX POSITIF.** L'unique match (`ecommerce-analytics.ts:59`) est
  un **commentaire** documentant que ce fichier utilise volontairement le format
  texte `datetime('now')` (`resolveWindowStart` → `since.toISOString().slice(0,19).replace('T',' ')`).
  Ce fichier est **conforme au standard texte**, pas un cas unixepoch.
- Fichiers worker réellement concernés par `unixepoch` : **3** (`admin-analytics.ts`,
  `beta.ts`, `dashboards.ts`), **pas 4**.

## 3. Tables/colonnes en format INTEGER (epoch) — migrations `.sql`

| Migration | Colonne | Format |
|---|---|---|
| `migration-sprint43.sql:20,35,48` | `created_at`, `computed_at` | `INTEGER … DEFAULT (unixepoch())` |
| `migration-sprint46.sql:17,18` | `created_at`, `updated_at` | `INTEGER … DEFAULT (unixepoch())` |
| `migration-sprint46-m2.sql:20` | `feature_events.event_time` | `INTEGER DEFAULT (unixepoch())` |
| `migration-sprint49-m2.sql:17` | `computed_at` | `INTEGER … DEFAULT (unixepoch())` |
| `migration-sprint50-m3.sql:17,26,37,48,55` | `created_at` (5 tables) | `INTEGER DEFAULT (unixepoch())` |

Toutes les **autres** tables `*_at` (phases 1→41, sprints E1→E9) = `TEXT` ou `DATETIME` legacy
alimentées par `datetime('now')` (texte).

## 4. Le cas mixte `beta.ts` (3 formats dans 1 fichier)

| Élément | Valeur écrite | Type colonne | Cohérence |
|---|---|---|---|
| `magic_tokens.expires_at` | `Date.now() + MAGIC_TTL_MS` → **millisecondes** (L176-179) | `INTEGER NOT NULL` | ⚠️ ms, PAS epoch secondes ni texte |
| `magic_tokens.used_at` | `Date.now()` → **millisecondes** (L204-205) | `INTEGER` | ⚠️ ms |
| `magic_tokens.created_at` | `unixepoch()` → **epoch secondes** (L44) | `INTEGER` | epoch s |
| `admin_sessions.created_at` / `expires_at` / `last_active_at` | `datetime('now')` + `.toISOString()` → **texte** (L227,231) | `TEXT` (cf. `migration-phase11.sql:50`, `phase28.sql:6`) | texte |

`expires_at`/`used_at` de `magic_tokens` sont en **millisecondes** comparées à `Date.now()`
(ms) côté JS — interne-cohérent (L201 : `Date.now() > mt.expires_at`), mais **incohérent
avec le `created_at` epoch-secondes de la même table** et avec tout le reste du projet.
Pas un bug fonctionnel actif (la comparaison reste ms vs ms), mais piège latent si
quelqu'un compare `created_at` (s) et `expires_at` (ms) un jour.

## 5. Synthèse risque

- **Pas de comparaison cross-format actuellement FAUSSE en production confirmée** : chaque
  usage `unixepoch` compare entier-vs-entier en interne (`admin-analytics.ts`), et les
  UPDATE `dashboards.ts` écrivent un entier dans une colonne créée entier.
- **Risque latent réel** : si une future requête joint/filtre une colonne `unixepoch`
  (INTEGER s) contre une colonne `datetime('now')` (TEXT) — ex. rapport agrégé
  cross-module mêlant `feature_events.event_time` (INTEGER) et `leads.created_at` (TEXT) —
  la comparaison serait **silencieusement FAUSSE** (entier toujours `<` toute string).
- **Incohérence ms/s dans `beta.ts`** : dette à normaliser (S2/S3), pas bloquante go-live.

Voir `docs/SPRINT-S1-CHECKLIST.md` pour le verdict go/no-go et
`src/lib/dbTime.ts` (helper de normalisation à la lecture, prévu S2+, **non câblé en S1**).

---

## Suivi S2 — statut par constat (annexe, constat S1 ci-dessus INTACT)

> Ajouté Sprint S2 / M3. Ne réécrit PAS le diagnostic S1. Annote uniquement le
> statut de traitement de chaque ligne `unixepoch` + dette ms, et signale UN
> risque cross-format additionnel découvert en S2 (hors périmètre map S1).

| Constat S1 | Statut S2 | Détail |
|---|---|---|
| `admin-analytics.ts:115/116/119` (`event_time` unixepoch, entier-vs-entier) | ✅ **conforme — documenté** | Commentaire inline `[S2]` ajouté. Comparaison `event_time >= since` = entier-s vs entier-s. `MAX(event_time)*1000` = conversion s→ms correcte. **0 modification de comportement.** |
| `dashboards.ts:104/134` (`updated_at = unixepoch()`, écriture entière) | ✅ **conforme — documenté** | Commentaire inline `[S2]`. Écriture entier dans colonne INTEGER (migration-sprint46). Aucune lecture/comparaison cross-format. **0 modification.** |
| `beta.ts` `magic_tokens.expires_at`/`used_at` en **ms** vs `created_at` en **s** | ✅ **dette latente DOCUMENTÉE — comportement préservé** | En-tête fichier + 3 marqueurs inline `[S2]`. Comparaison active `Date.now() > expires_at` = ms-vs-ms **correcte** → NON modifiée (un « fix » ms→s la casserait). Aucune comparaison cross-format active. Risque latent réaffirmé pour futurs JOIN. |
| **[S2 — NOUVEAU] `admin-analytics.ts` `leads.created_at` (TEXT) vs bind entier epoch** | 🔧 **CÂBLÉ (risque réel prouvé S2)** | **Hors map S1** (S1 ciblait `unixepoch` ; ce cas est `leads.created_at` TEXT `datetime('now')` comparé via `>=` à `Math.floor(startMonth)` entier + `COALESCE(created_at,0)` mêlant TEXT/0). Comparaison SQLite **silencieusement fausse** (affinité texte↔entier). Fix : `toIsoSql()` normalise la borne au format texte SQL canonique, comparaison texte-vs-texte. Logique métier (compte leads du mois) **inchangée**. Voir `admin-analytics.ts` handler `handleAdminOverview`. |

**Verdict S2** : 3 constats S1 = conformes/documentés sans modif (S1 avait raison :
aucune comparaison `unixepoch` interne fausse). 1 risque cross-format **additionnel**
non couvert par S1 trouvé et **câblé défensivement** via `src/lib/dbTime.toIsoSql`
(figé S1, désormais importé par `admin-analytics.ts` en import relatif).
Tests : `src/worker/__tests__/dbtime.test.ts` (fonctions pures, robustesse + null-safe).
