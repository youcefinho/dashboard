-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 117 — SPRINT 17 « Proposals e-sign — pont devis↔signature »
-- (2026-05-22)
-- L'E-SIGNATURE existe DÉJÀ (seq 11, migration-phase11.sql : table `documents`
-- status SANS CHECK, token UNIQUE, audit_trail, expires_at ; documents.ts
-- handleCreateDocument/handleSendDocument/handleSendSigningSms/handlePublicSign
-- Document capture IP/UA/horodatage/hash SHA-256/audit_trail/notif, statut
-- 'won'=signé ; SignDocument.tsx /sign/$token ; 15 clés sign.* ×3). Les DEVIS
-- existent DÉJÀ (seq 82, migration-invoice-real-seq82.sql : table `quotes`
-- status CHECK FIGÉ draft/sent/accepted/declined/expired + quote_items + taxes
-- TPS/TVQ ; quotes.ts create/update/get/accept→facture ; pdfExport kind:'quote').
-- CE LOT NE RECONSTRUIT RIEN — il AJOUTE seulement le PONT : lier un document de
-- signature à un devis (quote_id), le lien retour (document_id), et l'horodatage
-- de refus public (declined_at). Côté HANDLER (Phase B Manager-B) : envoyer un
-- devis chiffré pour signature, relier, signature→accept du devis (facture),
-- refus public.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / CREATE TABLE
--   documents / CREATE TABLE quotes / ALTER d'une contrainte existante.
--   ⚠ NE JAMAIS TOUCHER le CHECK `quotes.status` (seq 82 :
--   draft/sent/accepted/declined/expired). accepted/declined sont DÉJÀ permis et
--   RÉUTILISÉS (signature→accepted, refus→declined) — AUCUNE valeur 'signed'/
--   'viewed' n'est ajoutée à quotes.status. `documents.status` est LIBRE (pas de
--   CHECK, seq 11) : 'won'=signé conservé, NE PAS casser le filtre sent/viewed de
--   handlePublicGetDocument.
--   Ce lot N'AJOUTE QUE :
--     - 3 `ALTER TABLE … ADD COLUMN` — colonnes TEXT NULLABLES, sans DEFAULT
--       non-NULL, sans CHECK, sans FK ;
--     - 1 `CREATE INDEX IF NOT EXISTS` — neuf, idempotent.
--   AUCUN CHECK. AUCUNE FK. AUCUN rebuild. AUCUN touch leads / clients / agencies
--   / users / invoices / invoice_items / quote_items / document_templates / files
--   / notifications / activity_log. AUCUN touch tables E4/E6 régulées.
--
-- ⚠ ADD COLUMN sur SQLite/D1 : ajout de colonne NULLABLE = opération in-place
--   (PAS de rebuild de table tant qu'il n'y a ni DEFAULT non-constant ni CHECK ni
--   FK). On reste donc sur le contrat « zéro rebuild documents / zéro rebuild
--   quotes ».
--
-- ⚠ BORNAGE TENANT — le lien quote↔document est APPLICATIF (par `quote_id` /
--   `document_id` en colonne TEXT, PAS de FK). Les UPDATE/SELECT (Phase B) sont
--   bornés tenant (resolveClientId pour quotes — loadQuoteScoped ; documents
--   borné par token public). client_id/agency_id résolus serveur, JAMAIS body.
--
-- depends_on : migration-telephony-disposition-seq116.sql (seq 116 — dernière
--              migration du manifest avant ce lot ; chaînage SÉQUENTIEL pour
--              l'ordre, AUCUNE dépendance de SCHÉMA réelle sur seq 116). Tables
--              ciblées créées seq 11 (`documents`) et seq 82 (`quotes`).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `ALTER TABLE … ADD COLUMN` n'est PAS idempotent sur D1 (échoue si la colonne
--   existe déjà). En cas de rejeu, retirer manuellement les 3 ADD COLUMN déjà
--   appliqués. `CREATE INDEX IF NOT EXISTS` est idempotent (rejeu = no-op).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-proposals-esign-seq117.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) documents.quote_id — lien vers le devis dont ce document est la proposition
--    de signature. NULLABLE (un document peut n'avoir AUCUN devis : signature
--    classique seq 11 inchangée). Jointure APPLICATIVE, PAS de FK.
ALTER TABLE documents ADD COLUMN quote_id TEXT;

-- 2) documents.declined_at — horodatage du refus public (handlePublicDecline
--    Document, Phase B). NULLABLE. documents.status='declined' (statut LIBRE,
--    pas de CHECK).
ALTER TABLE documents ADD COLUMN declined_at TEXT;

-- 3) quotes.document_id — lien RETOUR vers le document de signature émis pour ce
--    devis. NULLABLE. Jointure APPLICATIVE, PAS de FK. ⚠ NE TOUCHE PAS le CHECK
--    quotes.status (seq 82).
ALTER TABLE quotes ADD COLUMN document_id TEXT;

-- Index ADDITIF idempotent — résolution document→devis (chemin chaud :
-- handlePublicSignDocument / handlePublicDeclineDocument lisent doc.quote_id pour
-- répercuter sur le devis).
CREATE INDEX IF NOT EXISTS idx_documents_quote ON documents(quote_id);

-- NB : 3 ALTER ADD COLUMN (TEXT NULLABLES, sans DEFAULT non-NULL, sans CHECK,
-- sans FK), 1 INDEX neuf, AUCUN CHECK, AUCUNE FK, AUCUN DROP / RENAME / rebuild /
-- CREATE TABLE documents / CREATE TABLE quotes. CHECK quotes.status (seq 82)
-- INTOUCHÉ — accepted/declined RÉUTILISÉS, AUCUN signed/viewed ajouté.
-- documents.status LIBRE — 'won'=signé conservé. Lien quote↔document APPLICATIF
-- (TEXT, PAS de FK). UPDATE bornés tenant (resolveClientId / token). Capability
-- invoices.write RÉUTILISÉE — ZÉRO ajout ALL_CAPABILITIES. Choix figés
-- docs/LOT-PROPOSALS-ESIGN.md §6.
