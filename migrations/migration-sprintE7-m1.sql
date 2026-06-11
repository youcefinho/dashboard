-- ── Sprint E7 M1 — Index perf Customer 360 / RFM / panier abandonné ──────────
--
-- INDEX UNIQUEMENT. AUCUN ALTER (les colonnes customers agrégées —
-- total_spent_cents / orders_count / avg_order_value_cents / first_order_at /
-- last_order_at / rfm_segment — existent déjà depuis migration-sprintE1-m1 et
-- sont PEUPLÉES par UPDATE ciblé dans ecommerce-customer-metrics.ts, jamais
-- re-déclarées). Convention stricte projet : IF NOT EXISTS, idempotent,
-- additif / non destructif.

-- recomputeCustomerMetrics : SUM(orders) filtré par (client_id, customer_id,
-- status) — index composite couvrant le WHERE du recalcul net-of-refunds.
CREATE INDEX IF NOT EXISTS idx_orders_customer_status
  ON orders(client_id, customer_id, status);

-- detectAbandonedCarts (M2) + handleListAbandonedCarts : balayage des paniers
-- par (client_id, status) ordonnés sur updated_at (seuil d'inactivité).
CREATE INDEX IF NOT EXISTS idx_carts_status_abandoned
  ON carts(client_id, status, updated_at);
