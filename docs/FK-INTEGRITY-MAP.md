# FK-INTEGRITY-MAP — Cartographie des clés étrangères (schéma D1 Intralys)

> Doc additif READ-ONLY (Sprint S1 / Manager M2). Aucun `.sql` ni code modifié.
> Source : grep `REFERENCES|FOREIGN KEY` sur tous les `*.sql` + `schema.sql`.
> Régime D1 : Cloudflare D1 force **`PRAGMA foreign_keys=ON`** par défaut et
> **ignore largement les `PRAGMA foreign_keys=OFF`** émis dans un fichier
> migration (no-op en contexte transactionnel). → toute FF dont la cible
> n'existe pas au moment de l'application **fait échouer la migration**.

## 0. Synthèse

| Métrique | Valeur |
|---|---|
| Occurrences FK relevées (`REFERENCES` + `FOREIGN KEY`) | ~95 lignes sur ~40 fichiers |
| Tables cibles distinctes | `leads`, `clients`, `users`, `workflows`, `pipelines`, `pipeline_stages`, `lost_reasons`, `tasks`, `customers`, `orders`, `products`, `product_categories`, `product_variants`, `carts`, `shipments`, `shipping_zones`, `order_items`, `sales_channels`, `return_requests`, `webhook_subscriptions`, `booking_pages`, `forms`, `ai_conversations`, `document_templates`, `score_profiles`, `custom_field_defs` |
| FK volontairement **supprimée** | `workflow_enrollments.lead_id → leads` (E9-m1, cf. AUDIT-workflow-enrollments-E9.md) |
| Fichiers de déploiement dupliqués | `deploy-migrations.sql`, `deploy-safe.sql` (mirroir phase11/p3_2 — risque divergence) |

---

## M2.3 — Tableau FK global

> `ON DEL` = clause `ON DELETE`. « cible présente ? » = la table cible est-elle
> créée par une migration appliquée AVANT (ordre canonique M1 — voir
> docs/MIGRATIONS-ORDER.md). `schema.sql` est la définition de référence
> (snapshot complet) mais l'ordre réel d'application = fichiers `migration-*`.

### FK vers `leads`

| Fichier:L | Table porteuse | Colonne FK | Cible | ON DEL | Présente sous D1 FK=ON ? |
|---|---|---|---|---|---|
| phase1:7 | activity_log (msg/note) | lead_id | leads(id) | CASCADE | ✅ leads = schema.sql:35 (foundation) |
| phase1:19 | (2e table phase1) | lead_id | leads(id) | CASCADE | ✅ |
| phase2:7 | (notes/messages) | lead_id | leads(id) | CASCADE | ✅ |
| phase3:37 | **workflow_enrollments** | lead_id | leads(id) | CASCADE | ⚠️ **RETIRÉE par E9-m1** (rebuild → `lead_id TEXT` nullable, sans FK) |
| phase4:7 | (appointments?) | lead_id | leads(id) | SET NULL | ✅ |
| phase5:42 | — | lead_id | leads(id) | SET NULL | ✅ |
| phase7:32 | booking instances | lead_id | leads(id) | SET NULL | ✅ |
| phase7:73 | form submissions | lead_id | leads(id) | SET NULL | ✅ |
| phase7:94 | ai_conversations | lead_id | leads(id) | CASCADE | ✅ |
| phase11:15 | documents | lead_id | leads(id) | (aucune) | ✅ |
| phase11:54 | doc instances | lead_id | leads(id) | (aucune) | ✅ |
| phase12:18 | — | lead_id | leads(id) | (aucune) | ✅ |
| phase41:13 | **messages** (rebuild) | lead_id | leads(id) | CASCADE | ✅ (FK leads CONSERVÉE ici, contrairement à E9) |
| sprint2-phase0:23 | score events | lead_id | leads(id) | (aucune) | ✅ |
| sprint2-phase0:39 | — | lead_id | leads(id) | (aucune) | ✅ |
| sprint2-phase0:55 | — | lead_id | leads(id) | (aucune) | ✅ |
| sprint3:20 | — | lead_id | leads(id) | (aucune) | ✅ |
| p3_2:8 | documents | lead_id | leads(id) | (aucune) | ✅ |
| p3_2:34 | doc instances | lead_id | leads(id) | (aucune) | ✅ |
| p3_4:17 | custom field values | lead_id | leads(id) | CASCADE | ✅ |
| E1-m1:134 | orders | lead_id | leads(id) | SET NULL | ✅ |

### FK vers `clients`

| Fichier:L | Table porteuse | Colonne | ON DEL | Présente ? |
|---|---|---|---|---|
| phase4:8 | — | client_id | (aucune) | ✅ clients = foundation (schema.sql) |
| phase22:6 | pipelines | client_id | (aucune) | ✅ |
| phase22:28 | lost_reasons | client_id | (aucune) | ✅ |
| phase34:4 | — | client_id | (aucune) | ✅ |
| phase40:17 | — | client_id | CASCADE | ✅ |
| phase40:39 | — | client_id | CASCADE | ✅ |
| p3_2:7 / p3_2:19 / p3_2:35 | documents | client_id | (aucune) | ✅ |
| p3_4:5 / p3_4:28 | — | client_id | (aucune) | ✅ |
| E1-m1:17/41/133/164/214 | e-comm | client_id | (aucune) | ✅ |
| E7-m2:17 / E8-m1:26 / E8-m2:30,55 | e-comm | client_id | (aucune) | ✅ |

### FK vers `users`

| Fichier:L | Colonne | ON DEL | Présente ? |
|---|---|---|---|
| phase11:16 / p3_2:13,26,46 | uploaded_by / created_by | (aucune) | ✅ users = foundation |
| phase29:5 | user_id | (aucune) | ✅ |
| phase35:21,31 | user_id | (aucune) | ✅ |
| phase36:10 | user_id | CASCADE | ✅ |
| phase37:10 | user_id | CASCADE | ✅ |
| sprint2-phase0:40,71,83 | user_id | (aucune) | ✅ |
| sprint46-m3:23 | user_id | (aucune) | ✅ |
| p3_4:27 | user_id | (aucune) | ✅ |

### FK vers `workflows` / pipeline / tasks

| Fichier:L | Table | Colonne → cible | ON DEL | Présente ? |
|---|---|---|---|---|
| phase3:24 | workflow_steps | workflow_id → workflows | CASCADE | ✅ (workflows créé même fichier L5, AVANT) |
| phase3:36 | workflow_enrollments | workflow_id → workflows | (aucune) | ✅ **conservée par E9-m1:34** |
| sprintE9-m1:34 | workflow_enrollments_new | workflow_id → workflows | (aucune) | ✅ |
| phase6:18 | — | pipeline_id → pipelines | CASCADE | ⚠️ voir orphelines |
| phase22:16 | pipeline_stages | pipeline_id → pipelines | (aucune) | ⚠️ ordre |
| phase22:35-37 | leads (ALTER) | pipeline_id/stage_id/lost_reason_id | (aucune) | ⚠️ ordre |
| phase25:5,15,23 | task_* | task_id → tasks | CASCADE | ✅ (tasks foundation) |

### FK e-commerce (Sprint E1+)

| Fichier:L | Table | Colonne → cible | ON DEL | Présente ? |
|---|---|---|---|---|
| E1-m1:44 | product_categories | parent_id → product_categories | (aucune) | ✅ self-ref |
| E1-m1:56,67,85 | — | product_id → products | CASCADE | ✅ (products E1-m1:? même fichier) |
| E1-m1:57 | — | category_id → product_categories | CASCADE | ✅ |
| E1-m1:86,198 | — | variant_id → product_variants | SET NULL | ✅ |
| E1-m1:102 | inventory | variant_id → product_variants | CASCADE (UNIQUE) | ✅ |
| E1-m1:117,233 | — | variant_id → product_variants | CASCADE / (aucune) | ✅ |
| E1-m1:165,215 | orders/carts | customer_id → customers | (aucune, nullable) | ✅ |
| E1-m1:197 | order_items | order_id → orders | CASCADE | ✅ |
| E1-m1:232 | cart_items | cart_id → carts | CASCADE | ✅ |
| E5-m1:38 | — | shipment_id → shipments | CASCADE | ⚠️ ordre (shipments) |
| E5-m1:39 | — | order_item_id → order_items | (aucune) | ⚠️ ordre |
| E5-m2:34 | — | zone_id → shipping_zones | CASCADE | ⚠️ ordre |
| E6-m2:70 | — | return_request_id → return_requests | CASCADE | ⚠️ ordre |
| E8-m1:52,53 / E8-m2:31,32,56 | listings | channel_id → sales_channels, variant_id → product_variants | CASCADE | ⚠️ ordre |
| phase38:6 | — | subscription_id → webhook_subscriptions | CASCADE | ⚠️ ordre |
| phase7:30 | — | booking_page_id → booking_pages | CASCADE | ✅ même fichier |
| phase7:71 | — | form_id → forms | CASCADE | ✅ même fichier |
| phase7:105 | — | conversation_id → ai_conversations | CASCADE | ✅ même fichier |

---

## FK orphelines / à risque

### 1. FK volontairement supprimée — `workflow_enrollments.lead_id`

- phase3:37 `lead_id … REFERENCES leads(id) ON DELETE CASCADE`
  → **E9-m1:35 retire la FK** (`lead_id TEXT` nullable, plus de REFERENCES).
- **Conséquence** : plus de purge en cascade des enrollments à la suppression
  d'un lead → **enrollments orphelins possibles** (lignes `lead_id` pointant un
  lead disparu). Aucun nettoyage applicatif par `lead_id` détecté dans
  `src/worker/workflows.ts` (L48 utilise un LEFT JOIN tolérant, L157 purge par
  `workflow_id` uniquement). **Décision documentée & assumée** (impossible de
  garder la FK avec la sentinelle e-comm). Détail : AUDIT-workflow-enrollments-E9.md M2.2(c).

### 2. CASCADE risquées (suppression en chaîne profonde)

| Chaîne | Risque |
|---|---|
| `clients` → (phase40 CASCADE) → ... | Supprimer un client cascade large : multi-tenant — suppression client = wipe données client. **Comportement attendu** mais destructif : protéger côté applicatif (soft-delete recommandé). |
| `products` → variants/images/prices (E1-m1 CASCADE x4) | Suppression produit purge tout l'arbre variantes/inventaire. Cohérent e-comm. |
| `orders` → `order_items` CASCADE (E1-m1:197) ; mais `orders.customer_id` SANS cascade | Supprimer un customer ne supprime PAS ses orders (FK nullable sans ON DELETE → D1 bloquera la suppression du customer si orders y réfèrent, OU laissera orphelin selon NOT NULL). `orders.customer_id` est nullable (E1-m1:165 « guest checkout ») → suppression customer = `FOREIGN KEY constraint` si non géré applicativement. |
| `workflows` → `workflow_steps` CASCADE (phase3:24) ; `workflow_enrollments.workflow_id` SANS cascade (phase3:36) | Supprimer un workflow cascade ses steps mais **PAS** ses enrollments (pas d'ON DELETE) → D1 FK=ON **bloquera** le `DELETE workflows` s'il reste des enrollments. `workflows.ts:157` purge explicitement les enrollments AVANT — **mitigation applicative correcte**, mais fragile si une autre voie supprime un workflow. |

### 3. FK « ordre-sensibles » (cible créée dans une migration ULTÉRIEURE)

Sous D1 FK=ON, créer une table avec `REFERENCES cible(id)` **échoue si `cible`
n'existe pas encore**. Les FK marquées ⚠️ ci-dessus (pipelines/pipeline_stages
phase22, e-comm E5/E6/E8, webhook_subscriptions phase38) sont **correctes
uniquement si l'ordre canonique** (docs/MIGRATIONS-ORDER.md — M1) garantit que
la cible est créée AVANT. Points de vigilance :

- `phase22:35-37` : `ALTER TABLE leads ADD COLUMN pipeline_id REFERENCES
  pipelines(id)` — exige `pipelines` créé (phase22:6, même fichier, AVANT
  l'ALTER L35 → OK intra-fichier). SQLite **n'applique pas** la FK d'une colonne
  ajoutée par `ALTER ADD COLUMN` rétroactivement (limitation connue) → FK
  « déclarative » non vérifiée par D1 pour ces 3 colonnes.
- `migration-sprintE9-m1.sql` **non capté par `getOrderedMigrations`**
  (`scripts/migrate.ts:53-69` : aucun bucket ne matche `migration-sprintE9-`)
  → l'ordre n'est pas garanti par le runner ; application manuelle ordonnée
  requise (voir AUDIT M2.4).

### 4. Duplication `deploy-migrations.sql` / `deploy-safe.sql`

Ces 2 fichiers re-déclarent des FK (documents/doc-instances `lead_id`,
`uploaded_by`, `template_id`) identiques à phase11/p3_2. **Risque de divergence
silencieuse** si l'un est modifié sans l'autre. Non bloquant tant que les défs
restent en phase ; à surveiller (hors scope M2).

---

## Impact `foreign_keys=ON` forcé par D1 — synthèse

| Effet | Conséquence concrète |
|---|---|
| `PRAGMA foreign_keys=OFF` ignoré (no-op transactionnel D1) | Le rebuild E9/phase41 reste sûr **par construction** (aucune ligne copiée ne viole une FK conservée), pas grâce au PRAGMA. |
| FK vérifiée à l'INSERT/DELETE | Toute migration créant une table avec `REFERENCES cible` exige `cible` déjà présente → **ordre canonique critique** (M1). |
| CASCADE actif | Suppressions `clients`/`products`/`orders`/`workflows` propagent : protéger applicativement (soft-delete / purge explicite préalable). |
| FK retirée volontairement (E9 `lead_id`) | Gain : flexibilité e-comm. Coût : orphelins enrollments → besoin purge applicative (dette signalée). |

---

## Renvois

- Détail rebuild E9 & procédure sûre : `docs/AUDIT-workflow-enrollments-E9.md`
- Ordre canonique d'application : `docs/MIGRATIONS-ORDER.md` (livré par M1)
- Checklist Sprint S1 : `docs/SPRINT-S1-CHECKLIST.md` (livré par M3)
