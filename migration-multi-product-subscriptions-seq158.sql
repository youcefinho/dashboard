-- Migration seq 158 (Sprint 63) — Gestion des Abonnements Multi-Produits
ALTER TABLE subscriptions ADD COLUMN parent_subscription_id TEXT DEFAULT NULL;
