# Stripe Data Flow — Intralys

> Cartographie des flux de données entre Intralys et Stripe pour conformité Loi 25 (Québec) + RGPD (EU).
> Date : 2026-05-23. Version : 1.0.

## §1 Data residency

- **Stripe** : datacenter US (Delaware) + Irlande (EU). Pas de datacenter Canada propre.
- **Intralys D1** : Cloudflare D1 (région principale Amérique du Nord, mais éventuellement réplique EU).
- **Transfert transfrontalier** : USA via Stripe. Sous **clause type Commission Européenne** (Article 28 RGPD + DPA Stripe).
- **Loi 25 art. 17** : transfert hors-Québec autorisé si encadrement contractuel équivalent + évaluation des facteurs (faite via DPA Stripe).

## §2 Données partagées avec Stripe

### 2.1 SaaS billing (subscription Intralys)
- `customer.email` (Stripe Customer) : nécessaire facturation.
- `customer.name` : nécessaire facturation.
- `customer.metadata.agencyId` : interne Intralys (pas de PII).
- `customer.metadata.userId` : interne.
- **PAS de** : adresse postale (sauf si Stripe Tax requis Sprint 39), téléphone, date naissance.

### 2.2 Paiements ecom (Connect tenants)
- Pour Connect Express tenants vendeurs :
  - `account.email` : email du vendeur (tenant)
  - `account.business_type` : sole_prop | company
  - `account.country` : CA (V1)
  - `account.requirements` : géré par Stripe (ID vérification, fiscalité, etc.)

### 2.3 Payment Methods
- `paymentMethod.card.brand`, `last4`, `exp_month`, `exp_year` : NON sensibles (autorisés stockage Intralys per PCI SAQ-A).
- `paymentMethod.id` (token `pm_*`) : token Stripe, non réversible.
- **JAMAIS partagé avec Intralys** : PAN, CVV, magnetic stripe, full expiry, billing address détaillée.

## §3 Rétention

| Donnée | Stripe | Intralys |
|---|---|---|
| Customer (email, name) | 7 ans (obligation comptable) | 5 ans actifs + archivage chiffré |
| Subscription | 7 ans | 5 ans actifs |
| Invoices | 7 ans | 5 ans + archivage |
| Payment Methods | jusqu'à révocation client | jusqu'à révocation client |
| Connect Account | indéfini (compte actif) | jusqu'à dissolution tenant |

## §4 Droit à l'oubli (RTBF — Right To Be Forgotten)

### 4.1 Loi 25 art. 28.1 + RGPD art. 17

L'utilisateur a droit à la suppression de ses données personnelles, sauf :
- Obligation légale (comptable 7 ans)
- Litige en cours
- Intérêt public majeur

### 4.2 Cascade Intralys → Stripe (Sprint 23 + 31)

1. User clique "Supprimer mon compte" (Sprint 23 `me-privacy.ts`).
2. Délai 30j (table `account_deletion_requests` seq121).
3. À J+30, exécution :
   - **Anonymisation** Intralys (pas suppression complète — obligation comptable) :
     - `users.email` → `deleted_<id>@anonymized.intralys.local`
     - `users.name` → `Utilisateur supprimé`
     - `users.phone` → NULL
   - **Cascade Stripe** (Sprint 31 ajout) :
     - SI `users.stripe_customer_id` non null → `stripe.customers.del(customer_id)` (Stripe garde 6 mois puis anonymise)
     - Audit `audit_log` action `me.account.stripe_deleted` avec customer_id (pour traçabilité conformité)
   - **Conservation** :
     - `subscriptions.metadata_json` anonymisé (retire email, garde agencyId pour stats agrégées)
     - `billing_invoices_mock` conservés agrégés (obligation fiscale TPS/TVQ)
     - `audit_log` immuable préservé (traçabilité légale)

### 4.3 Suppression compte tenant (vs user)

Si une AGENCE (tenant) entière demande dissolution :
- Tous les `users` de l'agence anonymisés.
- `subscriptions` Stripe cancelées.
- `stripe_connect_accounts.charges_enabled=0`.
- Données ecom anonymisées (clients/orders).
- Connect account peut être supprimé Stripe (account.delete).

## §5 Droits utilisateurs supplémentaires

### 5.1 Accès (Loi 25 art. 27 + RGPD art. 15)
- `GET /api/me/export-data` (Sprint 23) inclut :
  - Profil user (sans password_hash)
  - Sessions
  - Audit log (seulement actions du user)
  - Consentements donnés
  - Cookie consents
- **Sprint 31 ajout** : inclure aussi :
  - `payment_methods` (stripeCustomerId + brand + last4 only)
  - `subscriptions` history (sans donnée carte)

### 5.2 Rectification (RGPD art. 16)
- Profile update via Settings UI (existant).

### 5.3 Portabilité (RGPD art. 20)
- Export JSON `me/export-data` est portable.

### 5.4 Opposition / limitation (RGPD art. 18+21)
- Cookie consent (Sprint 23) catégoriel (analytics/marketing désactivables).
- Désabonnement email (CASL Sprint 8 `unsubscribes`).

## §6 Sous-traitant DPA

- **Stripe Inc.** (USA + EU) : sous-traitant inscrit registre DPA Intralys.
- **DPA Stripe** : https://stripe.com/legal/dpa
- **Engagement** : Stripe respecte clauses type Commission EU.
- **Notification** : Stripe notifie Intralys sous 72h en cas de violation données.

## §7 Notification incident (Loi 25 art. 3.5)

En cas d'incident de confidentialité présumé :
1. Notification interne Rochdi sous 24h.
2. Évaluation impact (nombre user touchés, sensibilité).
3. Notification Commission d'accès à l'information QC sous 72h si risque sérieux.
4. Notification utilisateurs concernés sous 72h.
5. Audit `audit_log` action `incident.notified` avec horodatage.

## §8 Contact DPO

- Email : dpo@intralys.com (Sprint 23 DataPrivacyPanel link)
- Délai réponse cible : 5 jours ouvrables.
- Délai résolution cible : 30 jours.

## §9 Révision

Cette doc est révisée à chaque sprint touchant Stripe ou flow données utilisateurs. Dernière révision : Sprint 31 (2026-05-23).
