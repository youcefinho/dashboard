-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 84 — LOT BOOKING & CALENDRIER CLIENT PRO (Sprint 3, 2026-05-19)
-- Moteur de réservation client pro niveau GHL/Calendly : types de RDV
-- (durée/buffers/notice/pas), moteur de créneaux correct en fuseau, page de
-- réservation publique, confirmation + rappels, annulation/reprogrammation,
-- redirection post-booking. ADDITIF, sans rien casser.
--
-- depends_on : migration-funnel-seq83.sql (seq 83 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 83).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - des `ALTER TABLE ... ADD COLUMN` (booking_pages / bookings) — additif
--       pur, jamais de modification de CHECK/PK/FK existante ;
--     - un `CREATE TABLE/INDEX IF NOT EXISTS` (booking_event_types) — neuf,
--       idempotent.
--   Les tables `booking_pages` + `bookings` EXISTENT DÉJÀ (seq 7,
--   migration-phase7.sql). La table `appointments` EXISTE DÉJÀ (seq 4
--   migration-phase4.sql, enrichie seq 32 migration-phase24.sql). Les tables
--   `availability_rules` / `date_overrides` / `calendars` EXISTENT DÉJÀ
--   (seq 32). AUCUNE n'est recréée.
--
--   Le CHECK status de `bookings` seq 7
--     status TEXT CHECK (status IN ('confirmed','cancelled','completed','no_show'))
--   est INTOUCHABLE : modifier un CHECK ⇒ rebuild SQLite ⇒ INTERDIT. Le
--   moteur public (Phase B) RESPECTE cette énumération (pas de 'pending').
--   Le CHECK role seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch `users`.
--   AUCUN touch tables E4/E6 régulées (`payments`, `payment_events`,
--   `payment_provider_config`, `refunds`, `disputes`, `return_requests`).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures booking↔event_type / booking_page↔event_type / booking↔agency
--   sont APPLICATIVES, par colonne TEXT). `price_cents` est POSÉ mais
--   INACTIF — AUCUNE logique de paiement n'est activée par ce lot (v2 sous
--   revue PCI/légale — voir docs/LOT-BOOKING.md §6.B).
--
-- TOLÉRANCE « duplicate column / table exists » — exécution best-effort :
--   si seq 84 est rejouée, `ADD COLUMN` peut échouer (« duplicate column
--   name ») et `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas
--   d'erreur). L'erreur éventuelle d'un `ADD COLUMN` rejoué est ATTENDUE et
--   NON FATALE : l'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions schema.sql (vérifiées sur migration-funnel-seq83.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch, PAS d'INTEGER autoincrement,
--   PAS de FK.
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque
--   booking_pages.client_id seq 7) + `agency_id` (scope agence — calque
--   funnels.agency_id seq 83 / quotes.agency_id seq 82). `owner_user_id` =
--   utilisateur dont les disponibilités (availability_rules / date_overrides /
--   appointments seq 32) pilotent le calcul de créneaux. Le slug de
--   booking_pages a déjà un index seq 7 ; l'unicité est gérée côté handler.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-booking-seq84.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) booking_pages — enrichissement ADDITIF (table seq 7 INTOUCHÉE pour
--    l'existant). agency_id = scope agence (calque funnels.agency_id seq 83).
--    redirect_url = redirection post-booking (Calendly/GHL-like). owner_user_id
--    = utilisateur dont les dispos pilotent le moteur de créneaux (§6.C).
ALTER TABLE booking_pages ADD COLUMN agency_id TEXT;
ALTER TABLE booking_pages ADD COLUMN redirect_url TEXT;
ALTER TABLE booking_pages ADD COLUMN owner_user_id TEXT;

-- 2) bookings — enrichissement ADDITIF. Le CHECK status seq 7
--    ('confirmed','cancelled','completed','no_show') reste INTOUCHABLE.
--    agency_id = scope agence. event_type_id = type de RDV réservé (jointure
--    applicative booking_event_types.id, PAS de FK). reminder_sent_at =
--    idempotence du rappel (modèle workflow-as-reminder §6.E).
--    rescheduled_from = id du booking d'origine en cas de reprogrammation.
ALTER TABLE bookings ADD COLUMN agency_id TEXT;
ALTER TABLE bookings ADD COLUMN event_type_id TEXT;
ALTER TABLE bookings ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN rescheduled_from TEXT;

-- 3) booking_event_types — table NEUVE. Un type de RDV = durée + buffers +
--    notice mini + pas de créneau, rattaché à une booking_page (jointure
--    applicative booking_page_id, PAS de FK). price_cents POSÉ mais INACTIF
--    (aucune activation paiement — v2 sous revue PCI/légale §6.B). Bornage
--    tenant client_id + agency_id (calque funnels seq 83).
CREATE TABLE IF NOT EXISTS booking_event_types (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  booking_page_id TEXT,
  name TEXT NOT NULL DEFAULT 'Rendez-vous',
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,   -- POSÉ INACTIF — aucune logique paiement (§6.B)
  slot_step_min INTEGER NOT NULL DEFAULT 30,
  min_notice_min INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_event_types_client ON booking_event_types(client_id);
CREATE INDEX IF NOT EXISTS idx_booking_event_types_agency ON booking_event_types(agency_id);
CREATE INDEX IF NOT EXISTS idx_booking_event_types_page ON booking_event_types(booking_page_id);

-- NB : AUCUNE colonne ajoutée à `users` / `clients` / tables E4/E6 régulées.
-- AUCUN CHECK existant modifié (status bookings seq 7 / role users seq 59
-- INTOUCHÉS). AUCUNE FK. AUCUN DROP / RENAME / rebuild.
-- Le wiring booking→CRM (Phase B) RÉUTILISE le pipeline forms.ts
-- (applyLeadMapping / resolveDedup / mergeIntoLead / logIngestConsent /
-- INSERT leads borné client_id / autoEnrollForTrigger 'appointment_booked')
-- — source='booking'. Aucune duplication de la logique dedup. Choix figé
-- docs/LOT-BOOKING.md §6.F.
