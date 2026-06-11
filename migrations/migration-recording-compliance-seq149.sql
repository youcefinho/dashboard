-- Migration seq149 : Options d'enregistrement et de consentement pour le routage téléphonique (Loi 25 / LCAP)
-- Ajout des colonnes de contrôle à la table phone_routing_rules.

ALTER TABLE phone_routing_rules ADD COLUMN record_call INTEGER DEFAULT 0;
ALTER TABLE phone_routing_rules ADD COLUMN play_consent_msg INTEGER DEFAULT 1;
