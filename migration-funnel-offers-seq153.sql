-- Migration seq 153 — Sprint 62 Entonnoirs d'Achat (Funnels) avec Upsell en 1-Clic
--
-- Création de la table funnel_offers pour associer des offres de type bump, upsell ou downsell à des étapes d'un funnel.
-- Pas de FK matérielles conformément aux exigences de conception D1 d'Intralys.

CREATE TABLE IF NOT EXISTS funnel_offers (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  funnel_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  product_variant_id TEXT NOT NULL,
  type TEXT CHECK(type IN ('bump', 'upsell', 'downsell')) NOT NULL,
  price_cents INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_funnel_offers_client ON funnel_offers(client_id);
CREATE INDEX IF NOT EXISTS idx_funnel_offers_funnel_step ON funnel_offers(funnel_id, step_id);
