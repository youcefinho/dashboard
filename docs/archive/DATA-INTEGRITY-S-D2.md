# DATA-INTEGRITY — S-D2 (LOT D, Manager C)

> Registre des relations FK à risque d'orphelins + décision « non corrigeable
> additivement » + registre soft-delete. **Diagnostic seul** : `data-reconcile.ts`
> est READ-ONLY strict (ZÉRO mutation). Rien n'est corrigé ici — ALTER/DROP
> interdits par §6.6, et corriger des données = décision Rochdi (gate prod).

## 1. Contexte du risque

SQLite/D1 **n'applique pas `PRAGMA foreign_keys` par défaut**. Même quand un
`REFERENCES ... ON DELETE` est déclaré, la cascade/SET NULL n'est PAS exécutée
tant que le PRAGMA n'est pas activé (et il ne l'est pas dans ce worker). En
conséquence : supprimer un `clients`/`leads`/`users` laisse des enfants
orphelins **silencieux**. `schema.sql` ne déclare qu'environ 5 `ON DELETE`
(`custom_field_values`, `subtasks`, `task_comments`, `task_attachments`,
`lead_tags`, `activity_log`, `messages`, `customers`, `product_*`…), et
plusieurs d'entre eux ne sont jamais appliqués faute de PRAGMA.

## 2. Registre des relations FK auditées (réelles — vérifiées par grep)

Sources : `schema.sql`, `migration-phase1.sql`, `migration-phase2.sql`,
`migration-phase4.sql`, `migration-phase5.sql`, `migration-sprint3.sql`,
`migration-sprintE1-m1-ecommerce-schema.sql`.

| Relation enfant → parent | `ON DELETE` déclaré | Appliqué ? | Risque orphelin | Audité par data-reconcile |
|---|---|---|---|---|
| `leads.client_id` → `clients.id` | aucun (NOT NULL) | n/a | **FORT** | ✅ |
| `messages.lead_id` → `leads.id` | CASCADE | non (PRAGMA off) | moyen (sûreté) | ✅ |
| `tasks.lead_id` → `leads.id` | SET NULL | non | faible (NULL = OK) | ✅ (lead_id renseigné mais introuvable) |
| `notifications.user_id` → `users.id` | **aucune FK déclarée** | n/a | **FORT** (lien logique) | ✅ |
| `appointments.lead_id` → `leads.id` | SET NULL | non | faible | ✅ |
| `appointments.client_id` → `clients.id` | aucun (NOT NULL) | n/a | **FORT** | ✅ |
| `conversations.lead_id` → `leads.id` | aucun (FK déclarée) | n/a | **FORT** | ✅ |
| `consent_log.lead_id` → `leads.id` | aucun (NOT NULL) | n/a | **FORT (Loi 25)** | ✅ |
| `activity_log.lead_id` → `leads.id` | CASCADE | non | moyen (sûreté) | ✅ |
| `customers.lead_id` → `leads.id` | SET NULL | non | faible (lien faible B2) | ✅ |

Relations à `ON DELETE CASCADE` interne (`subtasks`/`task_comments`/
`task_attachments`/`custom_field_values`/`lead_tags`/`product_*`/`order_items`/
`cart_items`) : déclarées CASCADE mais idem non appliquées sans PRAGMA. Non
auditées par défaut (volume + parent intermédiaire) — extension future possible
sans risque (ajout d'entrées dans `RELATIONS[]`, toujours READ-ONLY).

## 3. Risque NON corrigeable additivement (documenté, PAS corrigé)

- Activer `PRAGMA foreign_keys = ON` rétroactivement **rejetterait** les
  orphelins existants → migration destructive, hors charte LOT D (ALTER/DROP
  interdits §6.6, 0-migration confirmé Phase A).
- Nettoyer les orphelins = `DELETE`/`UPDATE` → mutation interdite côté Manager C
  et décision métier (un orphelin Loi 25 `consent_log` peut être une preuve à
  conserver, pas à purger). **Décision : rapport seulement, action = gate Rochdi.**
- Ajouter les FK manquantes (`notifications.user_id`) = `ALTER TABLE` → interdit
  (SQLite ne supporte pas `ADD CONSTRAINT` de toute façon ; il faudrait
  recréer la table → destructif). Documenté, non fait.

## 4. Registre soft-delete (`deleted_at` incohérent entre modules)

- `leads.deleted_at TEXT` existe (`schema.sql:62`, indexé
  `idx_leads_deleted_at`) → soft-delete réel sur `leads`.
- **AUCUNE autre table cœur** (`messages`, `tasks`, `appointments`,
  `conversations`, `notifications`, `consent_log`, `customers`, `orders`…)
  n'a de colonne `deleted_at`. Incohérence : un lead soft-deleted garde des
  enfants « vivants » qui pointent vers un parent logiquement supprimé mais
  physiquement présent → ces enfants ne sont PAS comptés comme orphelins (le
  parent existe en ligne), mais sont des **orphelins logiques**.
- Conséquence : `data-reconcile.ts` détecte les orphelins **physiques** (parent
  absent de la table). Les orphelins **logiques** (parent présent mais
  `deleted_at` non NULL) ne sont pas dans le scope S-D2 (nécessiterait une
  convention soft-delete uniforme — reco §5).

## 5. Recommandations futures (gate Rochdi, hors LOT D)

1. Convention soft-delete uniforme `deleted_at` sur toutes les tables enfant de
   `leads`/`clients`, ou cascade applicative au moment du soft-delete.
2. Décision métier sur le traitement des orphelins détectés (purge vs archive
   vs conservation Loi 25) — par relation, pas global.
3. Si jamais migration approuvée : recréer les tables avec FK explicites +
   `PRAGMA foreign_keys = ON` au boot worker (migration destructive encadrée).
4. Endpoint `data-reconcile` à brancher dans un cron observabilité (alerte si
   `orphans[].count` franchit un seuil) — câblage worker.ts = Manager A / hors C.

## 6. Endpoint livré

`GET /api/admin/data-reconcile` (chemin indicatif — dispatch worker.ts =
Manager A, voir note handoff). Handler : `handleDataReconcile(request, env, auth)`
dans `src/worker/data-reconcile.ts`. Garde admin LOCALE (`admin`/`owner` sinon
403). Réponse `{ data: { orphans: [{ relation, count }], checked_at } }`.
Best-effort : relation manquante sautée, JAMAIS 500.
