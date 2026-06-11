# SPRINT U0 — Audit de surfaçage UI (2026-05-27)

> Le « ressenti maigre » expliqué par les données. Méthode : 828 fonctions du client `src/lib/api.ts` croisées avec leur usage réel dans `src/pages` + `src/components` + `src/hooks`.
> Résultat : **136 fonctions client (16%) ne sont JAMAIS appelées par l'UI** → fonctionnalités backend EXISTANTES mais INVISIBLES.
> Faux-positifs vérifiés ~nuls (getBookings/createInvoice/getCart/createTicket/getAvailability/exportLeadPii = 0 usage hors api.ts).

## 🚨 Le vrai problème = surfaçage, pas absence
Tu as **961 handlers backend / 828 fonctions client**, mais **136 ne sont branchées à aucune UI**. C'est ÇA qui donne l'impression « trop maigre » : la puissance existe, elle n'est pas exposée.

## Features INVISIBLES marquantes (à surfacer en priorité)

### 🔐 Sécurité — **MFA/2FA invisible !**
`totpSetup`, `totpVerify`, `totpDisable` — l'authentification à 2 facteurs est **codée et testée** mais **aucun écran** pour l'activer. → Ajouter section MFA dans Settings/Sécurité. **Quick win sécurité majeur.**

### 📅 Calendrier & Booking — gros pan invisible
`getBookings`, `getAvailability`, `getAvailabilityRules`, `createBookingPage`, `updateBookingPage`, `deleteBookingPage`, `createCalendar`, `updateCalendar`, `deleteCalendar`, `deleteAppointment`, `markNoShow`, `listExternalCalendars`, `syncGcal`, `getGcalAuthUrl`, `getGcalEvents` → gestion des pages de réservation, règles de dispo, sync Google, no-show : **construits, non exposés**. → Page Calendar/BookingSettings à enrichir massivement.

### 💳 Facturation & Devis
`createInvoice`, `getInvoice`, `getInvoices`, `getQuote` → CRUD factures à peine surfacé. → Compléter pages Invoices/Quotes.

### 🛒 E-commerce — beaucoup d'invisible
Panier (`getCart`, `addCartItem`, `updateCartItem`, `deleteCartItem`, `convertCart`), commandes (`createEcommerceOrder`), coupons (`getEcommerceCoupon`, `validateCoupon`), abonnements (`getEcommerceSubscription`), variantes/stock (`getEcommerceVariants`, `getVariantInventory`), **gift cards** (`redeemGiftCard`, `getGiftCardBalance`), **loyalty** (`earnLoyaltyPoints`, `redeemLoyaltyPoints`, `getLoyaltyProgram`), reco/churn (`getProductReco`, `getCustomerChurn`), analytics (`getEcommerceSalesByChannel`), shipping (`resolveShippingRateApi`, `updateShippingRate`). → Boutique à enrichir (caisse loyalty/gift cards surtout).

### 📊 Dashboards personnalisables — invisible
`getDashboard`, `getDashboardLayouts`, `createDashboardLayout`, `updateDashboardLayout`, `deleteDashboardLayout` → constructeur de dashboards configurables **non exposé**. → Feature différenciante à surfacer.

### 🎯 Outils CRM avancés invisibles
`bulkLeads` (actions en masse), `enrollLead` (enrôlement automation), `recomputeLeadScore`, `setLeadCustomFields`, `getLeadAutomationHistory`, `importLeadsCsv`, **`createSmartList` + `executeSmartList`** (listes intelligentes !), `createLostReason`/`getLostReasons`, `reorderPipelineStages`. → CRM a plus de muscle que l'UI ne montre.

### ⚖️ RGPD / Loi 25 — invisible (conformité !)
`forgetLead` (droit à l'oubli), `exportLeadPii` (export données perso), `logConsent`, `getConsent`, `getCookieConsent` → outils de conformité **codés, non exposés**. → Obligation légale : à surfacer dans la fiche lead + paramètres.

### 🤖 IA invisible
`aiChat`, `aiScoreLead`, `aiSuggestWorkflow`, `aiSuggestWorkflowEnriched`, `getAiConversations`, `getAiConversation`.

### 📈 Rapports invisibles
`getReportsConversion`, `getReportsOverview`, `getReportsSources`, `getConversionBaselines`, `createForecastTarget`/`deleteForecastTarget` (objectifs de prévision).

### 🏢 SaaS / Agence
`createAgency`, `getAgencies`, `createSubAccount`, `updateSubAccount`, `getSubAccounts` → gestion agence/sous-comptes partiellement invisible.

### 🎨 White-label, Tickets, Surveys, POS, Affiliés, Push
`getWhitelabel`/`updateWhitelabel` ; `createTicket` ; `getSurvey`/`getSurveyResponse`/`listResponses` ; `createPosRegister`/`updatePosRegister`/`voidPosTransaction` ; `getAffiliateById` ; `registerDevice`/`unregisterDevice` (push mobile) ; `toggleCallRecording`, `sendSms`.

## ✅ Exclusions LÉGITIMES (ne PAS surfacer — ~15)
- **Crons** (déclenchés serveur) : `runDunningCron`, `runMrrSnapshotCron`, `recomputeLeadScore`(batch).
- **Flux publics** (utilisés dans pages publiques via apiFetch direct, pas le client nommé) : `signupAffiliatePublic`, `submitSurveyResponse`, `renderFunnelStep`, `trackFunnelConversion`, `trackFunnelStepView`, `trackAffiliateClick`.
- **Utilitaires auth** : `isAuthenticated`, `getStoredUser`, `logout` (utilisés autrement).

→ Net : **~115 fonctions réellement à surfacer.**

## 📋 PLAN « SURFACER + DURCIR + ENRICHIR » par domaine
Pour chaque domaine, 3 gestes combinés (la demande de Rochdi) :
1. **Surfacer** les fonctions invisibles (entrée nav/onglet/bouton + page).
2. **Durcir** (10 axes du `GIGA-PLAN-ENRICHISSEMENT` : sécurité, états UX, a11y, i18n, tests).
3. **Enrichir** (fonctions neuves du `GIGA-PLAN-FONCTIONNEL-GHL`).

| Domaine | Surfacer (U0) | Durcir | Enrichir (neuf) |
|---|---|---|---|
| Sécurité/Auth | **MFA** (totp*), agences/sous-comptes | rate-limit, RBAC | SSO/SAML (F5.6) |
| Calendrier | bookings/dispo/calendars/sync/no-show | anti double-booking | paiement RDV (F1.9), groupe (F2.1), visio (F5.7) |
| E-commerce | panier, gift cards, loyalty, reco, coupons | wire payments, idempotence | upsell (F4.1), portail retours (F4.2) |
| CRM | smart lists, bulk, import CSV, automation history | index D1, scoring câblé | champs typés (F1.6), routage (F1.7) |
| Dashboards/Reports | layouts custom, reports conversion/sources | export streaming | Ads reporting (F5.5), scorecards (F6.6) |
| Conformité | **forget/export PII, consent** (Loi 25) | scrub unifié, audit | HIPAA (F6.2) |
| Facturation | invoices/quotes CRUD | tax multi-région | portail client (F1.17), wallet (F4.6) |
| IA | aiChat/score/suggest, conversations | scrub PII LLM | réponses avis IA (F1.15), assistant (F6.9) |

## Ordonnancement
- **P0a (ce sprint)** : surfacer les **quick wins critiques** = MFA + outils RGPD (forget/export PII) + smart lists + dashboards custom. Fort impact, backend déjà prêt → surtout du frontend.
- **P0b** : surfacer le reste par domaine (1 passe/domaine).
- **P1+** : durcir (10 axes) + enrichir (LOTs F1→F6).

## Livrable technique
Liste brute des 136 dans ce repo (générée), exclusions marquées. Prochaine étape exécutable : pour chaque fonction à surfacer, identifier la page cible + ajouter l'appel + l'UI (états + i18n + a11y) + capability guard.

> **Conclusion** : « enrichir chaque section » commence par **surfacer les ~115 fonctions déjà codées** — c'est ~70% du ressenti réglé avec surtout du frontend, puis on durcit (qualité) et on enrichit (fonctions neuves).

---

## ✅ AVANCEMENT SURFAÇAGE (VM, à valider hôte)

### Wave 1 (3 features)
| Feature | Fichiers | i18n |
|---|---|---|
| **MFA / 2FA** (totpSetup/Verify/Disable) | `src/components/settings/MfaSettings.tsx` (NEW) + `Settings.tsx` | `mfa.*` (30) |
| **RGPD / Loi 25 par lead** (forgetLead, exportLeadPii) | `src/components/leads/LeadPrivacyActions.tsx` (NEW) + `LeadDetail.tsx` | `privacy.lead.*` (15) |
| **Dashboards custom** (layouts CRUD) | `src/components/dashboard/DashboardLayoutManager.tsx` (NEW) + `Dashboard.tsx` | `dashboards.*` (24) |

### Wave 2 (4 features)
| Feature | Fichiers | i18n |
|---|---|---|
| **Smart lists** (createSmartList/executeSmartList) | `src/components/segments/SmartListsPanel.tsx` (NEW) + `Segments.tsx` | `smartlists.*` (27) |
| **Gift cards + Loyalty ops** (balance/redeem/earn) | `src/components/boutique/GiftLoyaltyOps.tsx` (NEW) + `GiftCardsLoyaltyPage.tsx` | `giftloyalty.*` (54) |
| **Détail facture** (getInvoice line items) | `src/components/billing/InvoiceDetailModal.tsx` (NEW) + `Invoices.tsx` | `invoices.*` (+4) |
| **Gestion réservations** (booking pages/dispo/no-show) | `src/components/booking/BookingManagement.tsx` (NEW) + `BookingSettings.tsx` | `bookingmgmt.*` (33) |

### Wave 3 (4 features)
| Feature | Fichiers | i18n |
|---|---|---|
| **Agences + sous-comptes** (getAgencies/createAgency/getSubAccounts/createSubAccount/updateSubAccount) | `src/components/agencies/AgencyManagement.tsx` (NEW) + `Agencies.tsx` | `agencies.mgmt.*` (45) |
| **Rapports serveur** (overview/conversion/sources/baselines) | `src/components/reports/ServerAnalyticsPanel.tsx` (NEW) + `Reports.tsx` | `reportsx.*` (31) |
| **Assistant IA chat** (aiChat/getAiConversations/getAiConversation) | `src/components/ai/AiAssistantChat.tsx` (NEW) + `AiContent.tsx` | `aiassist.*` (18) |
| **Variantes produits + stock** (getEcommerceVariants/getVariantInventory + CRUD) | `src/components/boutique/VariantInventoryOps.tsx` (NEW) + `boutique/Produits.tsx` | `variants.*` (41) |

### Wave 4 (4 features)
| Feature | Fichiers | i18n |
|---|---|---|
| **Validation coupons** (validateCoupon test discount) | `src/components/boutique/CouponValidateTester.tsx` (NEW) + `boutique/Coupons.tsx` | `couponsx.*` (9) |
| **Détail abonnement** (getEcommerceSubscription) | `src/components/boutique/SubscriptionDetail.tsx` (NEW) + `boutique/Abonnements.tsx` | `subsx.*` (8) |
| **Sync calendriers externes** (Google connect/sync/events) | `src/components/calendar/ExternalCalendarSync.tsx` (NEW) + `Calendar.tsx` | `calsync.*` (33) |
| **Soumissions formulaires + analytics champs** (getFormSubmissions/getFormFieldAnalytics) | `src/components/forms/FormSubmissionsPanel.tsx` (NEW) + `Forms.tsx` | `formsx.*` (19) |

### Wave 5 (4 features)
Détail affiliés (`affx`) · Réponses sondages (`surveysx`) · Création tickets (`ticketsx`) · Dossiers templates (`tplfolders`). +74 clés.

### Wave 6 (4 features)
Churn client 360 (`custx`) · Stats funnels (`funnelx`) · Détail packs marketplace (`mktx`) · Config boutique/business/paiement (`storecfg`). +83 clés.

### Wave 7 (2 features)
Commande manuelle + détail expédition (`ordersx`) · Canaux e-commerce Shopify/Woo + sync (`chanx`). +45 clés. (intègre OK après reboot PC — intégrité vérifiée.)

**BILAN GLOBAL (7 waves)** : **25 features surfacées**, +593 clés i18n (6407→**7014**), **parité STRICTE 4 catalogues vérifiée à chaque wave** (LF, sans BOM, 0 apostrophe droite). ~25 pages enrichies. ⚠️ Non validé (pas de bun en VM) → `bun run build`+`test`+`i18n-parity-audit` côté hôte requis avant commit. Reste ~68 fonctions à surfacer.
