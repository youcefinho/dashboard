-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 100 — LOT ATTRIBUTION-D Attribution multi-touch & cohortes (fondations)
-- (2026-05-21)
-- 1 table NEUVE `lead_touchpoints` : capture des TOUCHPOINTS d'acquisition d'un
-- lead (source/medium/campaign/referrer + ordre du touch), bornée tenant. Capture
-- DÉSORMAIS, multi-touch PROSPECTIF — ce lot NE RECRÉE PAS d'historique. Avant ce
-- lot l'attribution réelle était SINGLE-TOUCH (dernier touch écrit dans les
-- colonnes `leads.utm_*`, écrasées au merge). Les leads existants n'ont donc aucun
-- touch (sauf backfill synthétique optionnel touch_order=0 — Phase B). La VALEUR
-- multi-touch (first/last/linéaire/time-decay) apparaît pour les leads ré-ingérés
-- multi-source APRÈS livraison. Les COHORTES de leads, elles, sont RÉTROACTIVES
-- (calculées en JS sur `leads.created_at` + statut — donnée existante, calque
-- ecommerce-analytics handleEcommerceCohorts).
--
-- ⚠ ÉCRITURE = capture best-effort UNIQUEMENT (1 INSERT additif à la création + au
--   merge d'un lead, import dynamique + try/catch TOTAL avalant — n'échoue JAMAIS
--   l'ingestion). Tout le reste (attribution + cohortes) est 100% LECTURE/AGRÉGAT
--   exposé via handlers HTTP bornés client_id.
--
-- ⚠ BORNAGE TENANT — chaque ligne porte `client_id` (NULLABLE au schéma, TOUJOURS
--   renseigné par le hook de capture depuis l'auth/itération, JAMAIS le body).
--   Aucune nouvelle capability : `reports.view` (déjà dans ALL_CAPABILITIES) suffit
--   — ZÉRO ajout.
--
-- depends_on : migration-proactive-ai-seq99.sql (seq 99 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 99). Table `leads` (seq 1) existe
--              déjà — référencée en LECTURE par le hook/les rapports, JAMAIS par FK.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 1 `CREATE TABLE IF NOT EXISTS` — neuve, idempotente ;
--     - 1 `CREATE INDEX IF NOT EXISTS` — neuf, idempotent.
--   AUCUN NOT NULL. AUCUN DEFAULT non-NULL (hors id randomblob / touch_order /
--   timestamp datetime('now') — défauts internes propres à la table neuve).
--   AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch clients / agencies / users /
--   leads / customers. La table MORTE `lead_attributions` (seq 21) n'est PAS
--   touchée. AUCUN touch tables E4/E6 régulées. Le CHECK role users seq 59
--   (rebuild:users) est INTOUCHÉ.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` sont idempotents
--   (rejeu = no-op). scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-attribution-cohort-seq100.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) lead_touchpoints — touchpoints d'acquisition d'un lead (multi-touch
--    prospectif), bornés tenant. touch_order = ordre du touch (0 = premier /
--    création ; n = merge ultérieur via SELECT MAX(touch_order)+1). source/medium/
--    campaign/referrer = copie du touch au moment de l'ingestion. occurred_at =
--    horodatage du touch. Les 4 modèles d'attribution (first/last/linéaire/
--    time-decay — Phase B) sont calculés à la lecture sur ces lignes.
CREATE TABLE IF NOT EXISTS lead_touchpoints (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, lead_id TEXT,
  touch_order INTEGER DEFAULT 0,
  source TEXT, medium TEXT, campaign TEXT, referrer TEXT,
  occurred_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIF idempotent : touchpoints d'un lead d'un tenant, triés par ordre
-- de touch (support direct du calcul d'attribution multi-touch ordonné).
CREATE INDEX IF NOT EXISTS idx_lead_touchpoints_lead ON lead_touchpoints(client_id, lead_id, touch_order);

-- NB : 1 CREATE TABLE neuve, 1 INDEX neuf, AUCUN NOT NULL forcé, AUCUN CHECK,
-- AUCUNE FK, AUCUN DROP / RENAME / rebuild / ALTER. NULL client_id jamais produit
-- par le hook de capture (toujours borné auth/itération). Bornage tenant =
-- client_id partout. ZÉRO ajout ALL_CAPABILITIES (reports.view). Capture best-
-- effort (try/catch total — n'échoue jamais l'ingestion). lead_attributions
-- (seq 21, morte) NON touchée. Multi-touch PROSPECTIF, cohortes RÉTROACTIVES.
-- Choix figés docs/LOT-ATTRIBUTION-D.md §6.
