# Couverture de validation des mutations — Sprint S3 (Lot 1)

> État au S3. Source de vérité : schémas centralisés `src/lib/schemas.ts` (M1),
> helper réponse `src/worker/lib/validate-response.ts` (M1), intégration
> early-return additive dans les handlers (M2 e-commerce, M3 CRM).
>
> **Principe** : la validation est *strictement additive* (early-return AVANT
> la logique métier, `v.data` consommé ensuite). Aucune logique métier,
> dédup, scoring ou trigger workflow n'a été modifiée. Format d'erreur
> rétro-compatible : `400 { error:<string FR-QC>, code:'VALIDATION', fields? }`.

## ✅ Couvert en S3

### M3 — CRM (5 fichiers durcis)

| Handler | Fichier | Schéma M1 | Note |
|---|---|---|---|
| `handleCreateLead` | `leads.ts` | `createLeadSchema` | client_id+name+email requis, reste permissif `.passthrough()` |
| `handlePatchLead` | `leads.ts` | `patchLeadSchemaS3` | tout optionnel (status/notes/deal_value/score/pipeline_id/stage_id…), métier ≥1 champ |
| `handleBulkLeads` | `leads.ts` | `bulkLeadsSchemaS3` | ids[1..100] + action allowlistée + value opt |
| `handleCreateTask` | `tasks.ts` | `createTaskSchemaS3` | title requis, defaults posés côté handler |
| `handlePatchTask` | `tasks.ts` | `patchTaskSchema` | tout optionnel, ≥1 exigé côté handler |
| `handleCreatePipeline` | `pipelines.ts` | `createPipelineSchema` | name+client_id requis |
| `handleCreatePipelineStage` | `pipelines.ts` | `createPipelineStageSchema` | name requis |
| `handlePublicFormSubmit` | `forms.ts` | `publicFormSubmitSchema` | **endpoint public, permissif** — form_id requis, `data` = objet libre (champs dynamiques non contraints) |
| `handleCreateForm` | `forms.ts` | `createFormSchema` | client_id+name+slug requis |

### M2 — E-commerce (couvert par le Manager M2, hors périmètre M3)

Commandes / produits / inventaire / panier / retours (`ecommerce-orders.ts`,
`ecommerce-products.ts`, `ecommerce-inventory.ts`, `ecommerce-cart.ts`,
`ecommerce-returns.ts`) — schémas `createOrderSchema`, `createProductSchema`,
`adjustInventorySchema`, `addCartItemSchema`, `createReturnSchema`, etc.
Voir `validation-ecommerce.test.ts` (livré M2).

**Total mutations critiques durcies S3 : ~14-16** (9 CRM M3 + 5-7 e-comm M2).

## ⚠️ Gaps connus en S3 (à traiter, ne PAS contourner)

- **`lead-notes.ts`** — `handleCreateLeadNote` / `handleUpdateLeadNote` :
  aucun schéma dédié dans M1 (figé, import-only). Le handler valide déjà
  `body.body.trim()` requis + `category` via allowlist interne. Durcissement
  reporté → **backlog S4** (créer `createLeadNoteSchema` { body req, category
  enum, is_pinned bool }).
- **`handleCreatePipeline` (flux non-admin)** — `createPipelineSchema` rend
  `client_id` requis. Le flux admin l'envoie toujours (front). Un éventuel
  appel non-admin où `client_id` est dérivé côté serveur (`users.client_id`)
  serait rejeté en amont. En pratique la création de pipeline est admin-gated
  via l'UI ; aucune régression observée. À réévaluer S4 si un flux non-admin
  légitime existe (rendre `client_id` optionnel dans le schéma).
- **`handleWebhookLead` / `handleIngestByToken` (ingest public)** — passent
  par le moteur partagé `ingestLead()` qui valide déjà `name`+`email` après
  `applyLeadMapping` (le mapping transforme le payload AVANT validation, donc
  un schéma en amont rejetterait à tort des payloads mappés légitimes).
  `webhookLeadIngestSchema` existe (M1) mais n'est pas branché ici pour ne
  pas casser le mapping. → **backlog S4** : valider APRÈS `applyLeadMapping`.

## ❌ NON couvert en S3 — backlog priorisé S4→S10

~95 modules worker au total ; seuls ~10 fichiers (CRM+e-comm cœur) sont
durcis. Le reste expose des mutations encore non validées par la couche
centralisée. Liste par fichier, priorisée par exposition / criticité.

### Priorité haute (S4-S5) — données client / écritures sensibles
- `auth.ts` — login/reset/changePassword (schémas `loginSchema`/`changePasswordSchema` existent M1, non branchés)
- `api-public-auth.ts` — clés API publiques
- `team.ts` — invitations / rôles
- `settings.ts` — paramètres compte / branding
- `compliance.ts` — consentements Loi 25 / CASL (écritures consent_log)
- `custom-fields.ts` — définitions de champs (injection labels DB)
- `templates.ts` — création templates email (`createTemplateSchema` existe M1)
- `appointments.ts` — RDV (`createAppointmentSchema` existe M1)
- `lead-notes.ts` — voir gap ci-dessus
- `lead-sources.ts` — sources d'ingestion (tokens)
- `webhooks-dispatch.ts` / `webhooks-queue.ts` — config webhooks sortants

### Priorité moyenne (S6-S8) — métier secondaire
- `conversations.ts`, `messages.ts`, `broadcast.ts`, `webchat.ts`
- `calendar.ts`, `bookings.ts`
- `workflows.ts` (automations — payloads complexes, schéma dédié à concevoir)
- `reviews.ts`, `feedback.ts`, `snippets.ts`, `quick-replies.ts`, `reactions.ts`
- `properties.ts`, `documents.ts`, `billing.ts`, `saas.ts`, `sub-accounts.ts`
- `trigger-links.ts`, `email-blocks.ts`, `packs.ts`, `modules.ts`
- `onboarding.ts`, `dashboards.ts`, `beta.ts`
- E-commerce étendu : `ecommerce-payments.ts`, `ecommerce-refunds.ts`,
  `ecommerce-disputes.ts`, `ecommerce-invoice.ts`, `ecommerce-import.ts`,
  `ecommerce-channel-*.ts`, `ecommerce-shipments.ts`, `ecommerce-cart-recovery.ts`
  *(certains assignés à M2/E4-E6 selon plan Chaman)*

### Priorité basse (S9-S10) — surfaces analytiques / lecture dominante / migration
- `dashboard.ts`, `reports.ts`, `admin.ts`, `admin-analytics.ts`
- `ai.ts`, `lead-predict.ts`, `lead-score.ts`, `scoring.ts`,
  `pipeline-insights.ts`, `ecommerce-analytics.ts`, `ecommerce-rfm.ts`,
  `ecommerce-customer-metrics.ts`, `ecommerce-reco.ts`
- `voice.ts`, `mobile.ts`, `push.ts`, `notifications.ts`, `notifications-ws.ts`
- `migration-ghl-*.ts` (6 fichiers — import GHL, validation entrée tierce)
- `tracking.ts`, `meta.ts`, `meta-leadgen.ts`, `customer-reconcile.ts`

### Hors périmètre validation de payload
`helpers.ts`, `crypto.ts`, `types.ts`, `health.ts`, `openapi-spec.ts`,
`route-meta-ssr.ts`, `lead-mapping.ts`, `lead-dedup.ts`, `ecommerce-tax-engine.ts`,
`ecommerce-region.ts`, `ecommerce-shipping-zones.ts`,
`ecommerce-inventory-strategy.ts`, `ecommerce-consumer-policy.ts` (logique pure /
infra, pas d'entrée HTTP directe non médiée).

## Honnêteté sur la couverture réelle

**~10 / ~95 modules durcis (~10-15 % des mutations critiques).** Le S3
sécurise les chemins d'écriture les plus exposés (création/édition leads,
tâches, pipelines, formulaires publics, e-commerce cœur). La majorité du
worker reste à couvrir : ce document est le backlog de référence pour les
lots S4→S10. Chaque lot devra suivre le **même pattern additif** (schéma M1
ou nouveau schéma dédié → early-return → `v.data`, métier inchangé) et
ajouter ses tests de non-régression.

---

## Suivi S4 (Lot 2) — annotation, constats S1-S3 intacts

> Cette section **annote** l'état ci-dessus sans le réécrire. Les constats
> S1-S3 restent la photo historique. Mise à jour des gaps traités par le
> Lot 2 (Managers M2 validation + M3 audit_log).

### Gaps S3 résolus par M2 (validation)

| Gap S3 (réf. ci-dessus) | Statut S4 | Résolu par |
|---|---|---|
| `lead-notes.ts` — `handleCreateLeadNote` / `handleUpdateLeadNote` | ✅ **RÉSOLU** | M2 — `createLeadNoteSchema` { body req, category enum, is_pinned bool } branché en early-return additif |
| `ecommerce-cart.ts` — `updateCart` (validation panier) | ✅ **RÉSOLU** | M2 — schéma panier branché, métier dédup/total inchangé |
| `handleWebhookLead` / `handleIngestByToken` — validation post-mapping | ✅ **RÉSOLU** | M2 — validation déplacée **APRÈS** `applyLeadMapping` (`webhookLeadIngestSchema`), mapping légitime préservé |

Propagation M2 notée : durcissement étendu à **`templates.ts`**
(`createTemplateSchema`) et **`appointments.ts`** (`createAppointmentSchema`)
— schémas M1 désormais branchés, même pattern early-return additif.

### audit_log instrumenté en S4 (M3) — voir `docs/OBSERVABILITY.md`

Traçabilité (≠ validation de payload) ajoutée best-effort sur les mutations
sensibles **`team.ts`** (invite / changement rôle / suppression user) et
**`settings.ts`** (création/révocation clé API, création/suppression
webhook incl. variantes publiques Zapier, mise à jour conformité AMF).
Détails complets + convention `action`/`resource`/`details` (zéro secret,
Loi 25) : `docs/OBSERVABILITY.md` §3. `lead-notes.ts` audit reporté S5
(collision M2 évitée en S4).

### Backlog priorité haute restant — Lot 3

Encore **non couverts** (validation et/ou audit) malgré priorité haute :

- `auth.ts` — login / reset / changePassword (`loginSchema` /
  `changePasswordSchema` M1 existent, non branchés) + audit événements sécu
- `api-public-auth.ts` — authentification clés API publiques
- `compliance.ts` — consentements Loi 25 / CASL (écritures `consent_log`)
- `custom-fields.ts` — définitions de champs (injection labels DB)
- `lead-sources.ts` — sources d'ingestion (tokens)
- `webhooks-dispatch.ts` / `webhooks-queue.ts` — dispatch webhooks sortants
- `lead-notes.ts` — audit (reporté S5)

Le reste du backlog priorité moyenne/basse (S6-S10) demeure tel que listé
dans les sections S3 ci-dessus.
