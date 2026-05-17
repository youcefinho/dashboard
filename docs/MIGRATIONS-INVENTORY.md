# MIGRATIONS-INVENTORY — Sprint S1 M1 (Lot 1)

> Doc additif **lecture seule**. Aucun `.sql` ni `scripts/migrate.ts` modifié.
> Source de vérité = contenu SQL réel (grep ligne-à-ligne), pas les commentaires d'ordre.
> Généré 2026-05-16. Working dir : `intralys-dashboard` racine.

## 0. Vue d'ensemble

- **78 fichiers `.sql`** à la racine.
- Bootstrap (hors tracker migrations) : `schema.sql` (29 tables base — `wrangler d1 execute --file=schema.sql` via `db:init`), `seed.sql` (données de seed).
- Bundles de déploiement manuel **redondants** : `deploy-migrations.sql`, `deploy-safe.sql` (copies concaténées de phase10→13 — voir §4).
- Migrations versionnées scannées par le runner : préfixes `migration-phase*`, `migration-sprint*`, `migration_p3_*` (`scripts/migrate.ts:91-94`).
  - `migration-phase1..41` : ~41 fichiers (numéros 19/20 absents).
  - `migration_p3_1/2/4/7/8/9/10` : 7 fichiers.
  - `migration-sprint2-phase0/1`, `migration-sprint3` : 3 fichiers.
  - `migration-sprint43/46/46-m2/46-m3/49-m2/50-m3/51-m1/51-m2` : 8 fichiers.
  - `migration-sprintE1-m1/E1-m2/E2-m2/E3-m1/E4-m1/E5-m1/E5-m2/E6-m1/E6-m2/E7-m1/E7-m2/E8-m1/E8-m2/E9-m1/E9-m3` : 15 fichiers.
  - `migration-sprintER-m1/ER-m2` : 2 fichiers.

## 1. Tableau fichier → objets → dépendances déclarées

Type d'op : C=CREATE TABLE, A=ALTER ADD COLUMN, I=CREATE INDEX, D=DROP, R=table-rebuild (CREATE_new+INSERT SELECT+DROP+RENAME), S=seed/INSERT.

| Fichier | Ops | Tables touchées | Dépendances réelles (objets requis) |
|---|---|---|---|
| schema.sql (bootstrap) | C,I | users, clients, leads, admin_sessions, login_attempts, unsubscribes, consent_log, files, document_templates, documents, custom_field_defs, custom_field_values, smart_lists, workflow_steps, invoices, agencies, subscriptions, device_tokens, pipelines, pipeline_stages, lost_reasons, calendars, availability_rules, date_overrides, subtasks, task_comments, task_attachments, task_templates, snippets, properties | — (base) |
| migration-phase1 | C,A,I | lead_tags, activity_log, leads(+deal_value,utm_source,utm_medium,utm_campaign,assigned_to,score) | leads |
| migration-phase2 | C,I | messages, email_templates | — |
| migration-phase3 | C,I | workflows, workflow_steps, workflow_enrollments, workflow_execution_log | leads (FK workflow_enrollments.lead_id→leads), workflows |
| migration-phase4 | C,I | appointments | leads |
| migration-phase5 | C,A,I | audit_log, notifications, tasks, users(+totp_secret,totp_enabled,must_change_password,last_login_at) | users, leads |
| migration-phase6 | C,A,I | pipelines, pipeline_stages, leads(+pipeline_id,stage_id) | leads ⚠️ doublon phase22 |
| migration-phase7 | C,A,I | booking_pages, bookings, forms, form_submissions, users(+parent_user_id,account_level,permissions,max_clients,branding), ai_conversations, ai_messages | users, leads |
| migration-phase8 | C,I | unsubscribes, consent_log | — (ALTER clients amf_* commentés) |
| migration-phase9 | C,I | custom_field_defs, custom_field_values, smart_lists | leads ⚠️ doublon p3_4/schema |
| migration-phase10 | A,I | leads(+dnd,dnd_settings,additional_emails,date_of_birth,country,timezone,external_id,migrated_from) | leads ⚠️ doublon deploy-* |
| migration-phase11 | C,I | files, document_templates, documents | leads ⚠️ doublon p3_2/schema/deploy-* |
| migration-phase12 | C,I | review_requests, reviews_cache | leads ⚠️ doublon deploy-* |
| migration-phase13 | C,I | migration_jobs, migration_field_map | ⚠️ doublon deploy-* |
| migration-phase14 | C,I | broadcasts | users |
| migration-phase15 | C,I | webchat_widgets, webchat_sessions | leads |
| migration-phase16 | C,I | meta_connections | — |
| migration-phase17 | C,A,I | saved_replies, users(+email_signature_html) | users |
| migration-phase18 | C,I | scheduled_messages | — |
| migration-phase21 | (vide / no-op) | — | — |
| migration-phase22 | C,A | pipelines, pipeline_stages, lost_reasons, leads(+pipeline_id,stage_id,lost_reason_id) | leads ⚠️ double-ALTER vs phase6 |
| migration-phase23 | C,A,I | workflows(+8 cols), workflow_folders, workflow_steps(+parent_step_id,branch), trigger_links, trigger_link_clicks, message_events | workflows, workflow_steps ⚠️ double-ALTER workflow_steps vs p3_7 |
| migration-phase24 | C,A,I | calendars, availability_rules, date_overrides, appointments(+9 cols) | appointments (phase4) |
| migration-phase25 | C,A,I | subtasks, task_comments, task_attachments, task_templates, tasks(+recurring_rule,parent_task_id,reminder_minutes_before) | tasks (phase5) |
| migration-phase26 | C,A,I | snippets, email_templates(+channel) | email_templates (phase2) |
| migration-phase27 | C,A | clients(+business_type,brand_voice,scoring_prompt_extra,mapbox_token), leads(+lat,lng,address), signing_tokens, dashboard_layouts, industry_packs | clients, leads ⚠️ leads.address aussi sprint2-phase1 |
| migration-phase28 | C,A,I | admin_sessions(+ip,user_agent,last_active_at), backup_codes | admin_sessions (schema) |
| migration-phase29 | C,A | notification_preferences, users(+email_signature) | users |
| migration-phase30 | C,A,I | email_templates(+7 cols), template_folders | email_templates (phase2) |
| migration-phase31 | C,A,I | forms(+5 cols), form_views, form_field_options | forms (phase7) |
| migration-phase32 | C,D | user_preferences, api_keys, webhook_subscriptions, DROP totp_backup_codes | — ⚠️ user_preferences aussi sprint2-phase0 |
| migration-phase33 | C | saved_reports | — |
| migration-phase34 | C,I | properties | clients ⚠️ doublon schema.sql:466 |
| migration-phase35 | C | beta_invite_codes, feedback, nps_responses | — |
| migration-phase36 | C,I | device_tokens | users ⚠️ doublon schema/p3_10 |
| migration-phase37 | C,I | password_reset_tokens | — |
| migration-phase38 | C,I | webhook_deliveries | webhook_subscriptions (phase32) |
| migration-phase39 | D | DROP totp_backup_codes | ⚠️ doublon phase32:46 |
| migration-phase40 | C | migration_sessions, migration_id_map, ghl_tokens | — |
| migration-phase41 | R,I | **REBUILD messages** (messages_new+INSERT+DROP+RENAME), migration_id_map idx | messages (phase2), migration_id_map (phase40) |
| migration_p3_1 | A | clients(+amf_certificate,amf_disclaimer_required) | clients |
| migration_p3_2 | C,I | files, document_templates, documents | leads ⚠️ doublon phase11/schema |
| migration_p3_4 | C,I | custom_field_defs, custom_field_values, smart_lists | leads ⚠️ doublon phase9/schema |
| migration_p3_7 | A | workflow_steps(+parent_step_id,branch) | workflow_steps ⚠️ double-ALTER vs phase23 |
| migration_p3_8 | C | invoices, coupons | ⚠️ invoices aussi schema.sql:204 |
| migration_p3_9 | C,A | agencies, subscriptions, users(+agency_id) | users ⚠️ agencies/subscriptions aussi schema |
| migration_p3_10 | A,C | leads(+deleted_at), device_tokens (NO `IF NOT EXISTS`), api_keys (NO `IF NOT EXISTS`) | leads ⚠️ device_tokens/api_keys conflit phase36/phase32/schema |
| migration-sprint2-phase0 | C | score_profiles, lead_scores, lead_notes, lead_attributions, smart_lists, user_preferences | leads ⚠️ smart_lists/user_preferences doublons |
| migration-sprint2-phase1 | A | leads(+additional_phones,address,city,postal_code,company,lifecycle_stage,favorite,assigned_to,last_activity_at,social_*,avatar_url) | leads ⚠️ double-ALTER assigned_to (phase1), address (phase27) ; commentaire « APRÈS phase 0 » |
| migration-sprint3 | C,A,I | conversations, messages(+conversation_id) | messages (phase2/phase41) |
| migration-sprint43 | C,I | message_reactions, quick_replies, lead_score_cache | messages, leads |
| migration-sprint46 | C,I | dashboards | users |
| migration-sprint46-m2 | C,I | feature_events | — |
| migration-sprint46-m3 | C,I | idx notifications, notification_preferences_v2 (créée, **PAS** de swap) | notifications, notification_preferences (phase29) |
| migration-sprint49-m2 | C,I | lead_predictions | leads |
| migration-sprint50-m3 | C,I | beta_signups, magic_tokens, beta_feedback, roadmap_items, roadmap_votes | — |
| migration-sprint51-m1 | C,A,I | meta_lead_connections, google_lead_connections, **leads(+gclid TEXT)** ligne 33 | leads ⚠️ double-ALTER gclid vs sprint51-m2 |
| migration-sprint51-m2 | C,A,I | lead_sources, leads(+utm_term,utm_content,**gclid** ligne 29,fbclid,referrer,consent_status,lead_source_id) | leads ⚠️ double-ALTER gclid vs sprint51-m1 |
| migration-sprintE1-m1 | C,I | products, product_categories, product_category_links, product_variants, product_images, inventory, inventory_movements (+orders/order_items/customers/carts décrites — bloc e-comm complet 238L) | clients |
| migration-sprintE1-m2 | A,R | clients(+modules_json), **REBUILD users** (users_e1m2_new+INSERT+DROP+RENAME, élargit CHECK role +store_manager) | users, clients ⚠️ rebuild users APRÈS tous ALTER users (phase5/7/17/29/p3_9) |
| migration-sprintE2-m2 | A | inventory(+last_low_stock_alert_at) | inventory (E1-m1) |
| migration-sprintE3-m1 | C,A | order_number_counters, orders(+paid_at,shipped_at,cancelled_at) | orders (E1-m1) |
| migration-sprintE4-m1 | C,I | payments, payment_events, payment_provider_config | orders (E1/E3) — ZONE RÉGULÉE |
| migration-sprintE5-m1 | C,I | shipments, shipment_items | orders, order_items (E1/E3) |
| migration-sprintE5-m2 | C,I | shipping_zones, shipping_rates | clients |
| migration-sprintE6-m1 | C,I | refunds | orders, payments (E4) — ZONE RÉGULÉE |
| migration-sprintE6-m2 | C,I | disputes, return_requests, rma_items | orders, refunds (E6-m1) — ZONE RÉGULÉE |
| migration-sprintE7-m1 | I | idx orders, idx carts (INDEX only) | orders, carts (E1) |
| migration-sprintE7-m2 | C,I | customer_segment_config | clients |
| migration-sprintE8-m1 | C,I | sales_channels, channel_inventory_allocation | clients, product_variants (E1) |
| migration-sprintE8-m2 | C,I | channel_product_map, channel_sync_log | sales_channels (E8-m1) |
| migration-sprintE9-m1 | R,I | **REBUILD workflow_enrollments** (lead_id NULLABLE + retrait FK leads + cols customer_id/order_id/entity_type) | workflow_enrollments (phase3) ⚠️ doit passer APRÈS phase3 |
| migration-sprintE9-m3 | S | INSERT industry_packs (seed pack e-commerce) | industry_packs (phase27) |
| migration-sprintER-m1 | A | orders(+tax_region,tax_breakdown_json), order_items(+tax_breakdown_json) | orders, order_items (E1/E3) |
| migration-sprintER-m2 | A | clients(+region,country,default_currency,tax_regime,legal_flags_json) | clients |
| migration-sprintS7-m1 | C,I | integration_secrets | clients, sales_channels (E8-m1) — coffre chiffré tokens intégration (S7) |
| migration-sprintS8-m1 | C,I | onboarding_state | clients, users (E1-m2 rebuild:users) — état onboarding unifié CRM+e-comm (S8) |
| migration-sprintS9-m1 | C,I | idx leads (client_id/status/created_at + 2 composites), idx tasks (client_id/created_at), idx order_items(variant_id), web_vitals | leads (schema bootstrap), tasks (phase5), order_items (E1-m1), clients (schema bootstrap) — perf index + télémétrie web vitals (S9). 100% additif, `IF NOT EXISTS` only. ⚠️ order_items.product_id INEXISTANT → indexé variant_id |
| deploy-migrations.sql | A,C,I | (copie phase10→13 concaténée) | leads ⚠️ REDONDANT |
| deploy-safe.sql | C,I | (copie phase11→13 idempotente) | leads ⚠️ REDONDANT |

## 2. Échantillonnage audité ligne-à-ligne (ALTER/FK/DROP/REBUILD)

- **REBUILD** (pattern CREATE_new+INSERT SELECT+DROP+RENAME, perte data si mal ordonné) :
  `migration-phase41.sql` (messages), `migration-sprintE1-m2.sql:31-48` (users), `migration-sprintE9-m1.sql:32-56` (workflow_enrollments).
- **DROP** : `migration-phase32.sql:46` + `migration-phase39.sql:3` (tous deux `DROP TABLE IF EXISTS totp_backup_codes` — phase39 redondant, no-op).
- **FK critique** : `migration-phase3.sql` `workflow_enrollments.lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE` → relâchée par `migration-sprintE9-m1.sql` (rebuild, lead_id NULLABLE, FK retirée). E9-m1 DOIT s'exécuter après phase3 sinon `DROP TABLE workflow_enrollments` échoue ou copie une table inexistante.
- **REBUILD users (E1-m2)** : copie colonnes `id,email,password_hash,name,role,client_id,is_active,created_at,updated_at` UNIQUEMENT. ⚠️ Si exécuté AVANT les ALTER users (phase5 totp_*, phase7 parent_user_id/account_level/permissions/max_clients/branding, phase17 email_signature_html, phase29 email_signature, p3_9 agency_id), ces colonnes manquent dans `users_e1m2_new` → **perte de colonnes / données users** au RENAME. Risque élevé.

## 3. Conflits & redondances — voir §4 ci-dessous

## 4. Conflits & redondances (M1.3)

| # | Conflit | Fichiers:lignes | Gravité | Détail |
|---|---|---|---|---|
| C1 | **Double-ALTER `leads.gclid`** | `migration-sprint51-m1.sql:33` (`ALTER TABLE leads ADD COLUMN gclid TEXT;`) vs `migration-sprint51-m2.sql:29` (`ALTER TABLE leads ADD COLUMN gclid TEXT DEFAULT '';`) | **HAUTE** | Le 2e ALTER échoue `duplicate column name: gclid` si les deux passent. Note m2:26 admet « ignorer duplicate column ». **CONFIRMÉ lignes exactes.** |
| C2 | Double-ALTER `leads.assigned_to` | `migration-phase1.sql:38` (`DEFAULT ''`) vs `migration-sprint2-phase1.sql:13` (sans default) | MOYENNE | 2e échoue duplicate column. |
| C3 | Double-ALTER `leads.address` | `migration-sprint2-phase1.sql:7` vs `migration-phase27.sql:11` (`DEFAULT ''`) | MOYENNE | 2e échoue duplicate column. |
| C4 | Double-ALTER `leads.pipeline_id`/`stage_id` | `migration-phase6.sql:35-36` vs `migration-phase22.sql:35-36` | MOYENNE | phase22 ré-ajoute pipeline_id/stage_id (+ lost_reason_id neuf). 2e échoue duplicate. |
| C5 | Double-ALTER `workflow_steps.parent_step_id`/`branch` | `migration_p3_7.sql:2-3` vs `migration-phase23.sql:21-22` | MOYENNE | Mêmes colonnes ajoutées 2×. |
| C6 | Double-ALTER `leads.country` | `migration-phase10.sql:12` vs `migration-sprintER-m2.sql:31` (clients, PAS leads — OK) ; vrai doublon = phase10 vs `deploy-migrations.sql:16` | MOYENNE | Voir C9 (deploy-* redondants). |
| C7 | Tables redéfinies (CREATE IF NOT EXISTS — bénin mais drift schéma) | `pipelines`/`pipeline_stages` : schema.sql:250/260 + phase6 + phase22 ; `files`/`document_templates`/`documents` : schema.sql + phase11 + p3_2 ; `custom_field_defs`/`custom_field_values`/`smart_lists` : schema.sql + phase9 + p3_4 + sprint2-phase0 ; `invoices` : schema.sql:204 + p3_8 ; `agencies`/`subscriptions` : schema.sql + p3_9 ; `device_tokens` : schema.sql:242 + phase36 + p3_10 ; `user_preferences` : phase32 + sprint2-phase0 ; `properties` : schema.sql:466 + phase34 | BASSE→MOYENNE | `CREATE IF NOT EXISTS` rend la 2e définition no-op : la 1ère structure gagne. **Risque de drift** : les colonnes divergentes entre définitions ne sont jamais appliquées. À auditer si schéma réel ≠ attendu. |
| C8 | `migration_p3_10` CREATE **sans** `IF NOT EXISTS` | `migration_p3_10.sql:7` (device_tokens), `:16` (api_keys) | MOYENNE | Si device_tokens (schema/phase36) ou api_keys (phase32) déjà créés → `table already exists`, fichier échoue. Le runner masque l'échec (`runFile` partial:true) mais la migration est marquée appliquée → état incohérent. |
| C9 | **Redondance deploy-\*** | `deploy-migrations.sql` (146L = phase10+11+12+13 concaténés) ; `deploy-safe.sql` (130L = phase11+12+13 idempotent) | MOYENNE | Doublons purs des migrations individuelles. **Non scannés** par `getOrderedMigrations` (préfixe `deploy-` exclu du filtre `:91-94`) → jouables seulement à la main. Risque : appliqués manuellement EN PLUS du tracker → ALTER en double sur leads. À supprimer ou archiver (recommandation S2). |
| C10 | Double DROP `totp_backup_codes` | `migration-phase32.sql:46` vs `migration-phase39.sql:3` | BASSE | `DROP IF EXISTS` idempotent — phase39 = no-op. |
| C11 | REBUILD users vs ALTER users | `migration-sprintE1-m2.sql:31-48` vs ALTER users de phase5/7/17/29/p3_9 | **HAUTE** | Voir §2. Ordre impératif : E1-m2 APRÈS tous les ALTER users, sinon perte de colonnes. Le runner n'ordonne PAS sprintE* (voir bug runner) → fichier jamais appliqué actuellement, mais risque latent dès qu'il sera ordonné en S2. |

> Détail bug runner et liste exhaustive des fichiers jamais appliqués : voir `docs/MIGRATIONS-ORDER.md` §BUG RUNNER.

---

## Suivi S2 — M3 (annexe, inventaire S1 ci-dessus INTACT)

> Ajouté S2/M3. Aucun `.sql` modifié par M3 (scope M1). Annotation timestamp
> uniquement sur les tables à colonnes `INTEGER (unixepoch())` recensées §1 :
>
> - `migration-sprint46` (`dashboards.created_at/updated_at` INTEGER) : écriture
>   worker `dashboards.ts` = entier `unixepoch()` cohérent → **conforme, documenté
>   S2** (pas de câblage dbTime).
> - `migration-sprint46-m2` (`feature_events.event_time` INTEGER) : lu par
>   `admin-analytics.ts` en entier-vs-entier → **conforme, documenté S2**.
> - `migration-sprint50-m3` (`magic_tokens` etc. INTEGER `created_at`) : `beta.ts`
>   écrit `expires_at`/`used_at` en **ms** (dette latente **documentée S2**,
>   comportement ms-vs-ms cohérent préservé — cf TIMESTAMP-CONSISTENCY-MAP §4).
>
> Détail complet du statut par constat : `docs/TIMESTAMP-CONSISTENCY-MAP.md`
> → « Suivi S2 ». Les conflits schéma C1–C11 restent du ressort M1 (inchangés).
