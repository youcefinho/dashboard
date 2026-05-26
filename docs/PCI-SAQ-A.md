# PCI DSS SAQ-A — Intralys

> Self-Assessment Questionnaire A applicable depuis Sprint 31 (activation Stripe live).
> Date : 2026-05-23. Version : 1.0 (cible PCI DSS v4.0).

## §1 Scope

Intralys utilise **Stripe** comme processeur de paiement entièrement externalisé. SAQ-A applicable car :
- Intralys NE stocke JAMAIS de PAN (Primary Account Number)
- Tokenization 100% client-side via Stripe Elements + Stripe.js
- Aucun flux carte ne transite par les serveurs Intralys
- Stripe est certifié PCI DSS niveau 1 (auditeur externe annuel QSA)
- Site Intralys = HTTPS only, TLS 1.2+ (Cloudflare default)

## §2 Assertions techniques

### 2.1 Pas de stockage carte
- **Migration audit** : grep `pan|cvv|card_number|track_data|magnetic_stripe` dans `migration-*.sql` → 0 résultat (vérifié 2026-05-23, sprints 1-126).
- **Types TS audit** : grep dans `src/lib/types.ts` → AUCUN champ PAN/CVV.
- **D1 schema** : table `payment_methods` (seq126) stocke UNIQUEMENT : `brand`, `last4`, `exp_month`, `exp_year`, `stripe_payment_method_id` (token Stripe). Aucune donnée sensible.

### 2.2 Tokenization client-side
- `@stripe/stripe-js` chargé lazy côté frontend (composant `<StripePaymentForm />`, Sprint 31).
- Stripe Elements (Card Element) iframe Stripe-hosted — les serveurs Intralys ne voient JAMAIS le PAN.
- Setup Intent flow : client → Stripe direct → token (`pm_*`) → Intralys reçoit le token seul.

### 2.3 Secrets
- `STRIPE_SECRET_KEY` (sk_live_*) : stocké via `wrangler secret put` UNIQUEMENT. JAMAIS commit `wrangler.jsonc`.
- `STRIPE_WEBHOOK_SECRET` (whsec_*) : idem.
- `VITE_STRIPE_PUBLISHABLE_KEY` (pk_live_*) : non-secret (clé publique), build-time injection.
- Audit grep : `wrangler.jsonc` ne contient AUCUN secret hardcodé.

### 2.4 Communications sécurisées
- HTTPS strict (Cloudflare TLS 1.2+).
- Stripe API : `https://api.stripe.com/v1` (TLS 1.2+).
- HSTS header injecté par Cloudflare (1 an, includeSubdomains, preload).
- Webhook Stripe signature HMAC SHA-256 v1 vérifiée (`verifyStripeWebhookSignatureSaas`, Sprint 22 helper). Tolérance 300s anti-replay. UNIQUE constraint `billing_events(provider, provider_event_id)` anti-replay strict.

### 2.5 Idempotency
- Tous les POST Stripe utilisent `Idempotency-Key` header (pattern E4 marchand `stripe-provider.ts:183`).
- Format clé : `<operation>_<agencyId>_<context>` pour dédup 24h Stripe.

## §3 Assertions organisationnelles

### 3.1 Accès
- Console Cloudflare D1 admin : 2FA Cloudflare requis.
- Wrangler secrets : accès limité à Rochdi + équipe core (2-3 personnes max V1).
- Audit log (table `audit_log` seq5 + enrichi seq121) immuable : toute mutation billing tracée.

### 3.2 Rotation
- Rotation `STRIPE_SECRET_KEY` : cible 90 jours (manuel via Stripe Dashboard + `wrangler secret put`).
- Rotation `STRIPE_WEBHOOK_SECRET` : idem.
- Logs rotation : tracés dans `audit_log` action `billing.secret.rotated`.

### 3.3 Revue
- Revue PCI annuelle : Rochdi + (futur) QSA externe si > 6M transactions/an.
- Cette doc relue à chaque sprint touchant Stripe.

### 3.4 Incident response
- Compromission présumée clé Stripe : (1) rotation immédiate via Dashboard, (2) `wrangler secret put` nouvelle clé, (3) audit `audit_log` pour transactions anormales, (4) notification Stripe Compliance team si requis.
- Compromission présumée customer data : application Loi 25 art. 3.5 (notification Commission d'accès à l'information du Québec sous 72h).

## §4 Validation et attestation

### Checklist 12 items SAQ-A
- [ ] HTTPS strict TLS 1.2+ (Cloudflare default)
- [ ] HSTS preload activé
- [ ] Aucun stockage PAN/CVV (grep verified)
- [ ] Tokenization Stripe Elements client-side
- [ ] Webhook signature HMAC vérifiée (anti-tampering)
- [ ] Idempotency-Key sur tous POST mutateurs
- [ ] Secrets via Wrangler bindings (jamais commit)
- [ ] Rotation secrets ≤ 90j
- [ ] Audit log immuable activé (seq5 + seq121)
- [ ] 2FA Cloudflare console
- [ ] Procédure rotation documentée
- [ ] Procédure incident documentée

### Attestation Rochdi
```
Je, Rochdi [NOM], dirigeant Intralys, atteste que :
1. Les 12 items SAQ-A ci-dessus sont vérifiés.
2. Aucun changement architectural non-documenté n'a été effectué.
3. Cette attestation est mise à jour à chaque sprint touchant Stripe.

Date :
Signature :
```

## §5 Références
- PCI DSS v4.0 SAQ-A : https://www.pcisecuritystandards.org
- Stripe PCI compliance : https://stripe.com/docs/security
- Loi 25 QC : https://www.cai.gouv.qc.ca/loi-25
- RGPD art. 32 (sécurité) : https://gdpr-info.eu/art-32-gdpr/
