-- ════════════════════════════════════════════════════════════════════════
-- Sprint E9 — M3.3 : seed pack industrie « E-commerce »
-- ════════════════════════════════════════════════════════════════════════
--
-- DERNIER sprint roadmap e-commerce B2. Ajoute UN pack industrie
-- déclaratif réutilisant l'installeur générique existant
-- (worker/packs.ts — NON modifié). Idempotent : INSERT OR IGNORE +
-- slug UNIQUE. Aucune table créée/altérée (industry_packs créée en
-- migration-phase27.sql). Aucune ALTER. Aucun code régulé touché.
--
-- Format snapshot_json STRICTEMENT conforme à packs.ts :
--   custom_fields : { name, key, type, options? }
--   workflows     : { name, trigger, steps:[{type, delay_hours?, subject?, body?}] }
--                   → `trigger` = nom EXACT reconnu par le moteur M1
--                     (order_created/order_paid/cart_abandoned/
--                      post_purchase/win_back/refund_issued).
--                     Workflows seedés is_active=0 (le client active).
--   templates     : { name, channel, subject?, body }
--   smart_lists   : { name, filters }
--
-- Ordre d'application go-live : APRÈS migration-phase27.sql (table
-- industry_packs). Indépendant des autres migrations E9. Voir
-- docs/PCI-RGPD-GOLIVE-checklist.md.
--
-- Note SQL : les apostrophes dans le JSON sont échappées en '' (norme
-- SQLite). FR québécois pour tous les libellés / contenus.

INSERT OR IGNORE INTO industry_packs (id, slug, name, description, icon, industries, snapshot_json) VALUES
('pack-ecommerce', 'ecommerce', 'E-commerce', 'Optimisé pour les boutiques en ligne québécoises : relance panier, après-achat, reconquête, remboursement.', '🛒', 'E-commerce,Boutique,Commerce de détail,Vente en ligne', '{"custom_fields":[{"name":"Valeur vie client","key":"ltv","type":"currency"},{"name":"Nombre de commandes","key":"nb_commandes","type":"number"},{"name":"Panier moyen","key":"panier_moyen","type":"currency"},{"name":"Canal d''acquisition","key":"canal_acquisition","type":"select","options":["Boutique Intralys","Shopify","WooCommerce","Réseaux sociaux","Référencement","Bouche-à-oreille"]},{"name":"Segment RFM","key":"segment_rfm","type":"select","options":["Champion","Fidèle","Potentiel","À risque","Perdu","Nouveau"]},{"name":"Risque de désabonnement","key":"risque_churn","type":"select","options":["Faible","Moyen","Élevé"]}],"workflows":[{"name":"Confirmation de commande","trigger":"order_created","steps":[{"type":"email","subject":"Merci pour votre commande {{lead.name}}!","body":"Bonjour {{lead.name}},\n\nNous avons bien reçu votre commande. Vous recevrez une confirmation dès que le paiement sera validé.\n\nMerci de votre confiance,\n{{client.name}}"}]},{"name":"Paiement reçu — préparation","trigger":"order_paid","steps":[{"type":"email","subject":"Paiement confirmé — votre commande est en préparation","body":"Bonjour {{lead.name}},\n\nVotre paiement a bien été reçu. Nous préparons votre colis avec soin et vous tiendrons informé(e) de l''expédition.\n\nÀ très vite,\n{{client.name}}"}]},{"name":"Relance panier abandonné","trigger":"cart_abandoned","steps":[{"type":"wait","delay_hours":4},{"type":"email","subject":"Vous avez oublié quelque chose, {{lead.name}}?","body":"Bonjour {{lead.name}},\n\nVotre panier vous attend toujours. Finalisez votre commande en un clic — nos produits partent vite!\n\n{{client.name}}"},{"type":"wait","delay_hours":44},{"type":"sms","body":"Bonjour {{lead.name}}, votre panier est encore disponible chez {{client.name}}. Besoin d''aide pour finaliser? Répondez à ce message."}]},{"name":"Suivi après-achat","trigger":"post_purchase","steps":[{"type":"wait","delay_hours":168},{"type":"email","subject":"Comment se passe votre expérience, {{lead.name}}?","body":"Bonjour {{lead.name}},\n\nNous espérons que votre achat vous comble. Votre avis compte beaucoup pour nous — un commentaire nous aiderait énormément. 🙏\n\nMerci,\n{{client.name}}"}]},{"name":"Reconquête client inactif","trigger":"win_back","steps":[{"type":"email","subject":"On vous a manqué, {{lead.name}}?","body":"Bonjour {{lead.name}},\n\nÇa fait un moment! Pour vous revoir, voici une attention spéciale sur votre prochaine commande.\n\nÀ bientôt chez {{client.name}}"}]},{"name":"Confirmation de remboursement","trigger":"refund_issued","steps":[{"type":"email","subject":"Votre remboursement a été traité","body":"Bonjour {{lead.name}},\n\nNous confirmons que votre remboursement a été émis. Le montant devrait apparaître sur votre relevé sous quelques jours ouvrables selon votre institution.\n\nMerci de votre compréhension,\n{{client.name}}"}]}],"templates":[{"name":"Confirmation commande","channel":"email","subject":"Merci pour votre commande {{lead.name}}!","body":"Bonjour {{lead.name}},\n\nVotre commande est confirmée. Vous recevrez les détails d''expédition prochainement.\n\nMerci,\n{{client.name}}"},{"name":"Expédition en cours","channel":"sms","body":"📦 Bonne nouvelle {{lead.name}}! Votre commande {{client.name}} vient d''être expédiée. Suivi à venir par courriel."},{"name":"Relance panier","channel":"email","subject":"Votre panier vous attend, {{lead.name}}","body":"Bonjour {{lead.name}},\n\nIl reste des articles dans votre panier. Finalisez votre achat avant qu''ils ne partent!\n\n{{client.name}}"},{"name":"Demande d''avis","channel":"sms","body":"Bonjour {{lead.name}}, merci pour votre achat! Un avis Google nous aide à grandir. Merci 🙏 — {{client.name}}"}],"smart_lists":[{"name":"Clients VIP","filters":{"custom_field_segment_rfm":["Champion","Fidèle"]}},{"name":"Clients à risque","filters":{"custom_field_risque_churn":"Élevé"}},{"name":"Paniers abandonnés récents","filters":{"status":"cart_abandoned","inactive_days":7}},{"name":"Acheteurs récurrents","filters":{"status":"customer","min_orders":2}}]}');
