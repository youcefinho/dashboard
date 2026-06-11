-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 168 (réelle 163) — SPRINT 73 « Analyse de Sentiment & Intentions » (2026-05-29)
--
-- Ajout des colonnes pour le stockage du sentiment et de l'intention détectée sur les messages.
--
-- ⚠ STRICTEMENT ADDITIF — Aucun rebuild, aucun changement de clé primaire.
-- Les colonnes sont optionnelles/nullables.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE messages ADD COLUMN sentiment TEXT;
ALTER TABLE messages ADD COLUMN detected_intent TEXT;
