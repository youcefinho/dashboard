-- ── Sprint 87 (seq182) — Facturation Multidevises avec Taux en Direct ──
--
-- Création de la table currency_exchange_rates pour stocker les taux en direct.

CREATE TABLE IF NOT EXISTS currency_exchange_rates (
  base TEXT NOT NULL,
  target TEXT NOT NULL,
  rate REAL NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (base, target)
);
