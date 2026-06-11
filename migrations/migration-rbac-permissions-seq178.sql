-- ── Sprint 83 (seq178) — Rôles Granulaires & Permissions Étendues (RBAC) ──
--
-- Création de la table role_permissions pour stocker de manière dynamique 
-- les permissions de rôles modifiées par les administrateurs.
-- Initialisation avec les valeurs actuelles par défaut de role_capabilities.

CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,
  capability TEXT NOT NULL,
  allowed INTEGER DEFAULT 1,
  UNIQUE(role_name, capability)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_name);

-- Copie initiale des permissions par défaut depuis la table role_capabilities
INSERT OR IGNORE INTO role_permissions (id, role_name, capability, allowed)
SELECT lower(hex(randomblob(16))), role_generic, capability, 1 FROM role_capabilities;
