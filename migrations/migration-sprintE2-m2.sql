-- ── Sprint E2 M2 — Inventaire : anti-spam alertes stock faible ───────────────
-- Additif PUR, nullable. Aucune donnée existante touchée. Convention stricte
-- du projet : TEXT DEFAULT (datetime('now')) pour les timestamps, jamais
-- unixepoch ni INTEGER autoincrement. Idempotent (IF NOT EXISTS via garde).
--
-- Colonne : trace du dernier moment où une notification "stock faible" a été
-- émise pour cette variante. Permet de ne pas re-spammer le tenant à chaque
-- ajustement tant que le stock reste sous le seuil (réarmé quand on repasse
-- au-dessus du seuil — voir ecommerce-inventory.ts).
--
-- SQLite n'a pas "ADD COLUMN IF NOT EXISTS" : ce script est conçu pour être
-- joué une seule fois lors de la migration E2 M2 (les colonnes ALTER échouent
-- silencieusement en re-run si déjà présentes — relancer manuellement n'est
-- pas attendu côté D1, la migration est one-shot comme les autres du projet).

ALTER TABLE inventory ADD COLUMN last_low_stock_alert_at TEXT;
