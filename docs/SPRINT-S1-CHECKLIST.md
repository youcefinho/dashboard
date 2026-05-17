# SPRINT-S1-CHECKLIST — Consolidation migrations & schéma D1

> Checklist go/no-go consolidée pour un lancement D1 (go-live).
> Agrège les livrables M1 / M2 / M3 du Sprint S1 (par pointeur de fichier
> figé, sans dépendre de leur contenu détaillé).
> Produit par M3. READ-ONLY : aucun `.sql` / code worker / front modifié.
> Date : 2026-05-16.

## Livrables S1 référencés (pointeurs figés)

| Manager | Livrable | Rôle |
|---|---|---|
| M1 | `docs/MIGRATIONS-ORDER.md` (+ manifest) | Ordre canonique d'application des migrations |
| M2 | `docs/AUDIT-workflow-enrollments-E9.md` | Audit rebuild E9 data-preserving |
| M2 | `docs/FK-INTEGRITY-MAP.md` | Cartographie des FK D1 |
| M3 | `docs/TIMESTAMP-CONSISTENCY-MAP.md` | Cartographie formats timestamps |
| M3 | `src/lib/dbTime.ts` | Helper normalisation (NON câblé S1) |

## Tableau go/no-go

| # | Risque | État | Verdict | Reste à faire |
|---|---|---|---|---|
| 1 | Ordre canonique des migrations documenté | ✅ Documenté (`MIGRATIONS-ORDER.md`) | **GO** sous réserve d'application manuelle dans l'ordre | Automatiser le runner (S2) |
| 2 | Bug runner `migrate.ts` | ✅ Documenté, **non corrigé S1** (fix planifié S2) | **GO conditionnel** : appliquer migrations à la main / via ordre documenté en attendant | Fix runner `migrate.ts` (S2) |
| 3 | Rebuild E9 data-preserving prouvé | ✅ Audité (`AUDIT-workflow-enrollments-E9.md`) | **GO** si conclusion audit = data-preserving confirmé | Re-vérifier sur snapshot prod avant go-live |
| 4 | FK D1 cartographiées | ✅ Cartographiées (`FK-INTEGRITY-MAP.md`) | **GO** | Corriger FK orphelines éventuelles (S2/S3 selon sévérité audit M2) |
| 5 | Timestamps cartographiés | ✅ Cartographiés (`TIMESTAMP-CONSISTENCY-MAP.md`) | **GO** | — |
| 6 | Helper timestamp prêt | ✅ `src/lib/dbTime.ts` créé, **non câblé** | **GO** (zéro impact comportemental S1) | Câbler aux requêtes cross-format à risque (S2) |
| 7 | Comparaisons timestamp cross-module FAUSSES | ⚠️ Aucune confirmée active ; **risque latent** identifié | **GO conditionnel** | Normaliser via `dbTime.ts` les futurs joins INTEGER↔TEXT (S2) |
| 8 | Incohérence ms/s `beta.ts` magic_tokens | ⚠️ Dette identifiée, interne-cohérente (ms vs ms) | **GO** (pas un bug actif) | Normaliser `expires_at`/`used_at` (S2/S3) |

## Verdict global

### ✅ GO conditionnel pour lancement D1

Le schéma D1 est **lançable** pour une beta D1, **à condition** de :

1. **Appliquer les migrations dans l'ordre documenté** (`MIGRATIONS-ORDER.md`)
   manuellement / hors runner, car le bug `migrate.ts` n'est pas corrigé en S1
   (correction = S2). C'est la seule contrainte opérationnelle bloquante si
   ignorée.
2. **Re-confirmer le rebuild E9 data-preserving** sur un snapshot prod avant la
   bascule (l'audit M2 prouve la stratégie ; la preuve sur données réelles
   reste à exécuter au moment du go-live).

Aucun **bug timestamp actif** ne bloque le go-live : tous les usages
`unixepoch` sont entier-vs-entier en interne, et `ecommerce-analytics.ts`
(faux positif Chaman) est conforme au standard texte. Le risque timestamp est
**latent** (futurs joins cross-format) et **mitigé** par `dbTime.ts` prêt à
câbler en S2.

### Reste pour S2

- Fix du runner `migrate.ts` (déblocage automatisation migrations).
- Câblage `src/lib/dbTime.ts` sur les requêtes réconciliant colonnes INTEGER
  (`feature_events`, `dashboards`, sprint43/46/49/50) et colonnes texte.
- Normalisation ms→s de `beta.ts` `magic_tokens.expires_at` / `used_at`.

### Reste pour S3

- Correction des FK orphelines éventuelles selon la sévérité issue de l'audit
  M2 (`FK-INTEGRITY-MAP.md`).
- Décision stratégique : converger tout le projet vers UN seul format
  timestamp (recommandation : conserver le texte `datetime('now')`, dominant à
  146 occ, et migrer l'îlot `unixepoch` — gros chantier, **hors S1/S2**).

## Préservations S1 (M3)

- ✅ 0 fichier `.sql` modifié.
- ✅ 0 code worker / front existant modifié.
- ✅ `src/lib/dbTime.ts` créé mais **importé nulle part** (grep `dbTime|toEpoch|toIsoSql`
  hors fichier = 0 match) → zéro changement comportemental.
- ✅ Aucun ALTER, aucun mass-rewrite de requêtes ni de timestamps.
