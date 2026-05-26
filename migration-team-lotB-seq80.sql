-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 80 — LOT TEAM B (2026-05-19)
-- Système de capabilities composables (rôles génériques + overrides par user).
--
-- depends_on : migration-team-lotA-seq79.sql (seq 79 — users.role_generic,
--              user_invitations). Opère sur le rôle GÉNÉRIQUE
--              (owner|manager|member|viewer), jamais sur users.role.
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / rebuild de `users`
--   (CHECK role seq 59 = role IN ('admin','broker','store_manager')).
--   Aucune FK vers users (D1/SQLite : une FK forcerait un rebuild au moindre
--   ALTER ultérieur ; la jointure user→capabilities est APPLICATIVE,
--   cf. src/worker/capabilities.ts). On ne touche NI `users` NI son CHECK.
--
-- TOLÉRANCE « duplicate column / table existante » — best-effort :
--   CREATE TABLE/INDEX IF NOT EXISTS sont idempotents. Les INSERT de seed
--   sont idempotents via INSERT OR IGNORE + UNIQUE INDEX (role_generic,
--   capability) : rejouer seq 80 ne duplique aucune ligne.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Capabilities par rôle générique (seed système).
CREATE TABLE IF NOT EXISTS role_capabilities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  role_generic TEXT NOT NULL,
  capability TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_role_caps_role ON role_capabilities(role_generic);
CREATE UNIQUE INDEX IF NOT EXISTS ux_role_caps_role_cap
  ON role_capabilities(role_generic, capability);

-- 2) Overrides ponctuels par utilisateur.
CREATE TABLE IF NOT EXISTS user_capability_overrides (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_cap_ovr_user ON user_capability_overrides(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_cap_ovr_user_cap
  ON user_capability_overrides(user_id, capability);

-- 3) Seed role_capabilities — idempotent via INSERT OR IGNORE + UNIQUE INDEX.
-- owner → 12 capabilities
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'leads.read');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'leads.write');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'leads.delete');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'export');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'team.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'billing.view');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'clients.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'reports.view');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'workflows.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'invoices.write');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'settings.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'owner', 'ai.use');

-- manager → opérationnel (SANS settings.manage / invoices.write)
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'leads.read');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'leads.write');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'leads.delete');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'export');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'team.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'billing.view');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'clients.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'reports.view');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'workflows.manage');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'manager', 'ai.use');

-- member → standard
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'member', 'leads.read');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'member', 'leads.write');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'member', 'ai.use');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'member', 'reports.view');

-- viewer → lecture seule STRICTE
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'viewer', 'leads.read');
INSERT OR IGNORE INTO role_capabilities (id, role_generic, capability) VALUES (lower(hex(randomblob(16))), 'viewer', 'reports.view');
