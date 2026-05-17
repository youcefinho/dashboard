# MIGRATIONS-ORDER — Ordre canonique réel (Sprint S1 M1)

> Doc additif **lecture seule**. Reconstruit par **dépendances FK / objets observées dans le SQL réel**.
> Les commentaires « APRÈS phaseN » dans les fichiers = indices secondaires uniquement.
> Le but de S1 = **documenter** l'ordre correct et le bug runner. **Le patch du runner est S2.**

## 1. Méthode

Tri par dépendances réelles :
1. `schema.sql` bootstrap (users, clients, leads, pipelines, etc.) hors tracker — joué par `db:init`.
2. Tables référencées (leads, users, clients, messages, workflows, appointments, tasks) AVANT leurs ALTER / tables filles.
3. REBUILD APRÈS tous les ALTER de la table reconstruite (sinon perte colonnes).
4. Bloc e-commerce (`E1` foundation) AVANT ses extensions (`E2..E9`, `ER`).
5. `migration-sprintE9-m1` (rebuild workflow_enrollments) APRÈS `migration-phase3` (création workflow_enrollments).

## 2. Ordre canonique recommandé

| seq | fichier | objets clés | dépend de | conflits / notes |
|---|---|---|---|---|
| — | schema.sql | base 29 tables | — | bootstrap (db:init, hors tracker) |
| 1 | migration-phase1 | lead_tags, activity_log, ALTER leads | schema(leads) | source assigned_to (C2) |
| 2 | migration-phase2 | messages, email_templates | — | |
| 3 | migration-phase3 | workflows, workflow_steps, **workflow_enrollments**, workflow_execution_log | leads | base rebuild E9-m1 |
| 4 | migration-phase4 | appointments | leads | |
| 5 | migration-phase5 | audit_log, notifications, tasks, ALTER users(totp_*) | users, leads | ALTER users → avant E1-m2 (C11) |
| 6 | migration-phase6 | pipelines, pipeline_stages, ALTER leads(pipeline_id,stage_id) | leads | C4/C7 |
| 7 | migration-phase7 | booking_pages, bookings, forms, form_submissions, ALTER users, ai_* | users, leads | ALTER users → avant E1-m2 |
| 8 | migration-phase8 | unsubscribes, consent_log | — | |
| 9 | migration-phase9 | custom_field_defs/_values, smart_lists | leads | C7 |
| 10 | migration-phase10 | ALTER leads (dnd, external_id…) | leads | = deploy-* (C9) |
| 11 | migration-phase11 | files, document_templates, documents | leads | C7 |
| 12 | migration-phase12 | review_requests, reviews_cache | leads | |
| 13 | migration-phase13 | migration_jobs, migration_field_map | — | |
| 14 | migration_p3_1 | ALTER clients(amf_*) | clients | |
| 15 | migration_p3_2 | files, document_templates, documents | leads | C7 (no-op après phase11) |
| 16 | migration_p3_4 | custom_field_* , smart_lists | leads | C7 |
| 17 | migration_p3_7 | ALTER workflow_steps(parent_step_id,branch) | workflow_steps | C5 — source, phase23 = doublon |
| 18 | migration_p3_8 | invoices, coupons | — | C7 (invoices aussi schema) |
| 19 | migration_p3_9 | agencies, subscriptions, ALTER users(agency_id) | users | ALTER users → avant E1-m2 |
| 20 | migration_p3_10 | ALTER leads(deleted_at), device_tokens, api_keys | leads | **C8 : CREATE sans IF NOT EXISTS** — placer avant phase32/36 OU accepter échec masqué |
| 21 | migration-sprint2-phase0 | score_profiles, lead_scores, lead_notes, lead_attributions, smart_lists, user_preferences | leads | « APRÈS phase 0 » (cf. sprint2-phase1) |
| 22 | migration-sprint2-phase1 | ALTER leads (×12) | sprint2-phase0, leads | C2 (assigned_to), C3 (address) doublons |
| 23 | migration-sprint3 | conversations, ALTER messages(conversation_id) | messages | |
| 24 | migration-phase14 | broadcasts | users | |
| 25 | migration-phase15 | webchat_widgets, webchat_sessions | leads | |
| 26 | migration-phase16 | meta_connections | — | |
| 27 | migration-phase17 | saved_replies, ALTER users(email_signature_html) | users | ALTER users → avant E1-m2 |
| 28 | migration-phase18 | scheduled_messages | — | |
| 29 | migration-phase21 | (vide) | — | no-op |
| 30 | migration-phase22 | pipelines, pipeline_stages, lost_reasons, ALTER leads | leads | C4 double-ALTER vs phase6 |
| 31 | migration-phase23 | ALTER workflows(×8), workflow_folders, ALTER workflow_steps, trigger_links, message_events | workflows, workflow_steps | C5 double-ALTER vs p3_7 |
| 32 | migration-phase24 | calendars, availability_rules, date_overrides, ALTER appointments(×9) | appointments | |
| 33 | migration-phase25 | subtasks, task_comments, task_attachments, task_templates, ALTER tasks | tasks | |
| 34 | migration-phase26 | snippets, ALTER email_templates(channel) | email_templates | |
| 35 | migration-phase27 | ALTER clients, ALTER leads(lat,lng,address), signing_tokens, dashboard_layouts, industry_packs | clients, leads | C3 (address) ; industry_packs requis par E9-m3 |
| 36 | migration-phase28 | ALTER admin_sessions, backup_codes | admin_sessions | |
| 37 | migration-phase29 | notification_preferences, ALTER users(email_signature) | users | ALTER users → avant E1-m2 ; base de 46-m3 |
| 38 | migration-phase30 | ALTER email_templates(×7), template_folders | email_templates | |
| 39 | migration-phase31 | ALTER forms(×5), form_views, form_field_options | forms | |
| 40 | migration-phase32 | user_preferences, api_keys, webhook_subscriptions, DROP totp_backup_codes | — | C8/C10 |
| 41 | migration-phase33 | saved_reports | — | |
| 42 | migration-phase34 | properties | clients | C7 (aussi schema:466) |
| 43 | migration-phase35 | beta_invite_codes, feedback, nps_responses | — | |
| 44 | migration-phase36 | device_tokens | users | C7 |
| 45 | migration-phase37 | password_reset_tokens | — | |
| 46 | migration-phase38 | webhook_deliveries | webhook_subscriptions(phase32) | |
| 47 | migration-phase39 | DROP totp_backup_codes | — | C10 no-op |
| 48 | migration-phase40 | migration_sessions, migration_id_map, ghl_tokens | — | base phase41 |
| 49 | migration-phase41 | **REBUILD messages** + idx migration_id_map | messages(phase2), migration_id_map(phase40) | rebuild après tous ALTER messages |
| 50 | migration-sprint43 | message_reactions, quick_replies, lead_score_cache | messages, leads | |
| 51 | migration-sprint46 | dashboards | users | |
| 52 | migration-sprint46-m2 | feature_events | — | |
| 53 | migration-sprint46-m3 | idx notifications, notification_preferences_v2 (pas de swap) | notifications, notification_preferences(phase29) | swap commenté volontairement |
| 54 | migration-sprint49-m2 | lead_predictions | leads | |
| 55 | migration-sprint50-m3 | beta_signups, magic_tokens, beta_feedback, roadmap_items, roadmap_votes | — | |
| 56 | migration-sprint51-m1 | meta_lead_connections, google_lead_connections, ALTER leads(gclid) | leads | **C1 : source gclid** |
| 57 | migration-sprint51-m2 | lead_sources, ALTER leads(utm_term…,gclid,…) | leads | **C1 : gclid:29 ÉCHOUE duplicate (m1:33 l'a déjà ajouté)** |
| 58 | migration-sprintE1-m1 | products, variants, inventory, orders, order_items, customers, carts (bloc e-comm) | clients | foundation e-comm |
| 59 | migration-sprintE1-m2 | ALTER clients(modules_json), **REBUILD users** (+role store_manager) | users, clients | **C11 : DOIT être APRÈS phase5/7/17/29/p3_9** (tous ALTER users) sinon perte colonnes |
| 60 | migration-sprintE2-m2 | ALTER inventory | inventory(E1-m1) | |
| 61 | migration-sprintE3-m1 | order_number_counters, ALTER orders | orders(E1) | |
| 62 | migration-sprintE4-m1 | payments, payment_events, payment_provider_config | orders | ZONE RÉGULÉE |
| 63 | migration-sprintE5-m1 | shipments, shipment_items | orders, order_items | |
| 64 | migration-sprintE5-m2 | shipping_zones, shipping_rates | clients | |
| 65 | migration-sprintE6-m1 | refunds | orders, payments(E4) | ZONE RÉGULÉE |
| 66 | migration-sprintE6-m2 | disputes, return_requests, rma_items | orders, refunds(E6-m1) | ZONE RÉGULÉE |
| 67 | migration-sprintE7-m1 | idx orders, idx carts (INDEX only) | orders, carts | |
| 68 | migration-sprintE7-m2 | customer_segment_config | clients | |
| 69 | migration-sprintE8-m1 | sales_channels, channel_inventory_allocation | clients, product_variants | |
| 70 | migration-sprintE8-m2 | channel_product_map, channel_sync_log | sales_channels(E8-m1) | |
| 71 | migration-sprintER-m1 | ALTER orders(tax_region,tax_breakdown_json), ALTER order_items | orders, order_items(E1/E3) | |
| 72 | migration-sprintER-m2 | ALTER clients(region,country,default_currency,tax_regime,legal_flags_json) | clients | |
| 73 | migration-sprintE9-m1 | **REBUILD workflow_enrollments** (lead_id NULLABLE, retrait FK leads, +entity_type) | **workflow_enrollments(phase3)** | DOIT être APRÈS phase3 ; APRÈS E1-m1 (référence customer/order conceptuellement) |
| 74 | migration-sprintE9-m3 | seed industry_packs (pack e-commerce) | industry_packs(phase27) | INSERT OR IGNORE |
| 75 | migration-sprintS7-m1 | integration_secrets (coffre chiffré tokens intégration) | clients, sales_channels(E8-m1) | S7 — additif, ON DELETE CASCADE channel_id |
| 76 | migration-sprintS8-m1 | onboarding_state (état onboarding unifié CRM+e-comm) | clients, users(E1-m2 rebuild:users) | S8 — additif, UNIQUE(client_id,user_id) upsert idempotent |
| 77 | migration-sprintS9-m1 | idx leads/tasks/order_items + table web_vitals | leads(schema), tasks(phase5), order_items(E1-m1), clients(schema) | S9 — 100% additif `IF NOT EXISTS`, idempotent. order_items indexé sur variant_id (product_id absent) |
| — | deploy-migrations.sql / deploy-safe.sql | REDONDANTS phase10-13 | — | **À NE PAS jouer via tracker** (C9). Archiver en S2. |

> Ambiguïtés assumées honnêtement : l'ordre relatif `migration-sprint2-*` vs `phase14+` n'est pas contraignant par FK (tables indépendantes) — j'ai suivi l'indice commentaire runner (sprint2/sprint3 avant phaseLate). Les `CREATE IF NOT EXISTS` redondants (C7) rendent l'ordre relatif de leurs doublons non critique pour l'exécution, mais critique pour le **drift de schéma** (la 1ère définition gagne).

## 3. BUG RUNNER `scripts/migrate.ts` — DÉFAUT BLOQUANT GO-LIVE

### Localisation exacte

`scripts/migrate.ts`, fonction `getOrderedMigrations(allFiles)` **lignes 53-69** :

```
53  function getOrderedMigrations(allFiles: string[]): string[] {
54    const phaseEarly = allFiles
55      .filter(f => /^migration-phase(\d+)\.sql$/.test(f) && naturalNumberKey(f) <= 13) ...
57    const p3 = allFiles
58      .filter(f => f.startsWith('migration_p3_')) ...
60    const sprint2 = allFiles
61      .filter(f => f.startsWith('migration-sprint2-')) ...
63    const sprint3 = allFiles.filter(f => f === 'migration-sprint3.sql');
64    const phaseLate = allFiles
65      .filter(f => /^migration-phase(\d+)\.sql$/.test(f) && naturalNumberKey(f) > 13) ...
68    return [...phaseEarly, ...p3, ...sprint2, ...sprint3, ...phaseLate];
69  }
```

### Le défaut

`allFiles` (scan, `:91-94`) capture **tous** les préfixes `migration-phase*` / `migration-sprint*` / `migration_p3_*`. **MAIS** `getOrderedMigrations` (`:68`) ne ré-assemble QUE 5 buckets : `phaseEarly` (phase ≤13), `p3`, `sprint2` (`migration-sprint2-*`), `sprint3` (exactement `migration-sprint3.sql`), `phaseLate` (phase >13).

Tout fichier scanné qui ne tombe dans **aucun** de ces 5 filtres est **silencieusement absent de `ordered`** → jamais dans `pending` (`:97`) → **jamais appliqué**, et jamais non plus enregistré dans `_migrations`.

### Fichiers JAMAIS appliqués par le runner (25 fichiers)

`migration-sprint3.sql` matche `sprint3` filter — OK. Mais ces 25 ne matchent **aucun** bucket :

- **sprint43+** : `migration-sprint43.sql`, `migration-sprint46.sql`, `migration-sprint46-m2.sql`, `migration-sprint46-m3.sql`, `migration-sprint49-m2.sql`, `migration-sprint50-m3.sql`, `migration-sprint51-m1.sql`, `migration-sprint51-m2.sql` (8).
- **sprintE\*** : `migration-sprintE1-m1-ecommerce-schema.sql`, `migration-sprintE1-m2-modules-role.sql`, `migration-sprintE2-m2.sql`, `migration-sprintE3-m1.sql`, `migration-sprintE4-m1.sql`, `migration-sprintE5-m1.sql`, `migration-sprintE5-m2.sql`, `migration-sprintE6-m1.sql`, `migration-sprintE6-m2.sql`, `migration-sprintE7-m1.sql`, `migration-sprintE7-m2.sql`, `migration-sprintE8-m1.sql`, `migration-sprintE8-m2.sql`, `migration-sprintE9-m1.sql`, `migration-sprintE9-m3.sql` (15).
- **sprintER\*** : `migration-sprintER-m1.sql`, `migration-sprintER-m2.sql` (2).

> Note : `migration-sprint2-phase0/1.sql` matchent `sprint2` (`startsWith('migration-sprint2-')`) → OK. Le filtre `sprint2` ne matche PAS `sprint43`/`sprint46`/etc. (pas de préfixe `migration-sprint2-`). Le bug ne touche donc QUE les 25 ci-dessus.

### Conséquence

Tout le module e-commerce (E1→E9, ER : ~30+ tables : products, orders, payments, refunds, shipments…), les connecteurs Lead Ads (sprint51 : meta_lead_connections, lead_sources, gclid…), les dashboards builder (sprint46), les prédictions (sprint49), le flow beta (sprint50), reactions/quick_replies (sprint43) **ne sont jamais créés en prod via `bun run db:migrate:prod`**. Ils ne tournent qu'en exécution manuelle `npx wrangler d1 execute --file=… --remote` (indiqué en commentaire dans plusieurs fichiers E\*) — non tracé, non idempotent-sûr, oublis garantis.

### Gravité : **BLOQUANT GO-LIVE n°1**

- À corriger en **S2** (pas en S1 — S1 = doc/analyse seulement).
- Correctif S2 recommandé (hors scope ici) : généraliser `getOrderedMigrations` pour inclure tous les buckets restants dans l'ordre canonique du §2, OU passer à un tri 100 % piloté par un manifest (`docs/migrations-manifest.json` fourni par M1.4) plutôt que par regex de préfixe.
- ⚠️ Effet de bord du correctif : dès que ces 25 fichiers seront ordonnés/appliqués, les conflits C1 (gclid), C8 (p3_10 CREATE sans IF NOT EXISTS), C11 (rebuild users avant ALTER users) **se déclencheront réellement**. Les résoudre EN MÊME TEMPS que le patch runner (S2).

---

## Suivi S2 — M3 (annexe, constat S1 ci-dessus INTACT)

> Ajouté S2/M3. M3 ne possède PAS `scripts/migrate.ts` ni les `.sql` (scope M1).
> Aucune modification du runner/ordre par M3. Note de coordination uniquement :
> le **patch runner** + résolution C1/C8/C11 reste un livrable M1 (S2). Volet M3
> (timestamps worker) : voir `docs/TIMESTAMP-CONSISTENCY-MAP.md` → section
> « Suivi S2 ». Les tables `unixepoch` listées au §3 (sprint43/46/49/50) sont
> écrites entier-cohérent côté worker (`admin-analytics.ts`/`dashboards.ts`
> documentés conformes S2) — leur **ordre d'application** dépend toujours du
> correctif runner M1, indépendant du volet timestamp M3.
