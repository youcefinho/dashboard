# Surfaçage exécutable — 136 fonctions api.ts jamais appelées

Date: 2026-05-27. Source: `src/lib/api.ts` (11 889 lignes). Cible: rendre visibles dans l'UI les features backend déjà construites.

Légende priorité:
- **P0** quick-win: la page cible existe déjà, le geste UI est un simple ajout (bouton/onglet/colonne) sur un écran live.
- **P1**: nécessite une nouvelle section/modal substantielle dans une page existante.
- **P2**: nécessite un nouvel écran complet ou une feature transverse (settings, sécurité).
- **EXCLU**: légitimement non-UI (cron / flux public via apiFetch direct / util auth).

Pages réelles vérifiées via `ls src/pages` (+ sous-dossiers admin, affiliates, b2b, boutique, community, funnels, help, landing, lms, marketing, settings, surveys, warehouse).

---

## EXCLUS (~15) — ne pas surfacer

| Fonction | Raison |
|---|---|
| runDunningCron | Cron facturation (relance impayés), déclenché par scheduler |
| runMrrSnapshotCron | Cron snapshot MRR, scheduler |
| signupAffiliatePublic | Flux public, appelé direct dans `AffiliatesPage`/landing publique |
| submitSurveyResponse | Flux public répondant, `PublicReview`/survey public |
| renderFunnelStep | Rendu public funnel, `PublicFunnel.tsx` |
| trackFunnelConversion | Tracking public funnel, `PublicFunnel.tsx` |
| trackFunnelStepView | Tracking public funnel, `PublicFunnel.tsx` |
| trackAffiliateClick | Tracking public lien affilié, redirect public |
| isAuthenticated | Util auth (guards de route) |
| getStoredUser | Util auth (lecture user local) |
| logout | Util auth (header/menu, géré par layout) |
| registerDevice | Push mobile (Capacitor lifecycle, pas un geste UI) |
| unregisterDevice | Push mobile (lifecycle) |
| getCookieConsent | Banner cookies public (layout public) |
| logConsent | Capture consentement (formulaires publics/banner) |

---

## CRM / Leads / Pipeline

| Fonction | Page cible (src/pages/...) | Geste UI | Prio | Note |
|---|---|---|---|---|
| bulkLeads | Leads.tsx | Barre d'actions groupées (assigner/tag/stage) sur sélection multi-lignes | P0 | action+value en lot |
| importLeadsCsv | Leads.tsx | Bouton « Importer CSV » + modal upload/mapping | P0 | import en masse |
| exportConfigurableCsv | Leads.tsx | Bouton « Exporter CSV » + modal choix colonnes | P0 | export configurable |
| recomputeLeadScore | LeadDetail.tsx | Bouton « Recalculer score » dans le panneau scoring | P0 | |
| aiScoreLead | LeadDetail.tsx | Bouton « Scorer par IA » + affichage score+raison | P1 | |
| getLeadAutomationHistory | LeadDetail.tsx | Onglet/section « Historique automatisations » | P1 | timeline |
| enrollLead | LeadDetail.tsx | Bouton « Inscrire à une séquence/workflow » + picker | P1 | |
| setLeadCustomFields | LeadDetail.tsx | Édition inline des champs perso dans la fiche | P1 | |
| updateLeadNote | LeadDetail.tsx | Édition d'une note existante (crayon + save) | P0 | |
| updateComment | LeadDetail.tsx | Édition d'un commentaire de timeline existant | P0 | |
| getLinkedCustomerForLead | LeadDetail.tsx | Encart « Client e-commerce lié » (commandes/LTV) | P1 | pont CRM↔boutique |
| sendSms | LeadDetail.tsx | Bouton « SMS » dans la barre d'actions de contact | P0 | |
| reorderPipelineStages | Pipeline.tsx | Drag-and-drop persistant de l'ordre des colonnes | P1 | |
| createLostReason | Pipeline.tsx / settings | Modal « Gérer les motifs de perte » + ajout | P1 | |
| getLostReasons | Pipeline.tsx | Dropdown motif lors du passage en « Perdu » | P0 | dépend de createLostReason |
| getConsent | LeadDetail.tsx | Onglet RGPD « Consentements » de la fiche | P2 | |
| forgetLead | LeadDetail.tsx | Bouton « Anonymiser (RGPD) » + confirm | P2 | droit à l'oubli |
| exportLeadPii | LeadDetail.tsx | Bouton « Exporter mes données (RGPD) » | P2 | portabilité |

---

## Smart Lists / Segments

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| createSmartList | Segments.tsx | Bouton « Nouvelle liste intelligente » + builder filtres | P1 | |
| executeSmartList | Segments.tsx | Bouton « Exécuter » + tableau résultats paginé | P1 | |

---

## Workflows / Automatisations IA

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| aiSuggestWorkflow | WorkflowBuilder.tsx | Bouton « Suggérer par IA » (prompt → steps) | P1 | |
| aiSuggestWorkflowEnriched | WorkflowBuilder.tsx | Variante enrichie (prompt+clientId) du même bouton | P1 | préférer à aiSuggestWorkflow |
| updateFunnel | FunnelBuilder.tsx | Sauvegarde des métadonnées funnel (titre/réglages) | P0 | |
| getFunnelStats | Funnels.tsx / FunnelsPage.tsx | Colonne/onglet « Stats » (vues, conversions) par funnel | P1 | |

---

## Calendrier / Réservation

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| createCalendar | Calendar.tsx | Bouton « Nouveau calendrier » + modal | P1 | |
| updateCalendar | Calendar.tsx | Édition d'un calendrier (réglages) | P1 | |
| deleteCalendar | Calendar.tsx | Bouton supprimer calendrier + confirm | P0 | |
| deleteAppointment | Calendar.tsx | Bouton supprimer un RDV | P0 | |
| markNoShow | Calendar.tsx | Action « No-show » sur un RDV | P0 | |
| getAvailability | Calendar.tsx / PublicBooking | Affichage créneaux dispo (user+date) | P1 | |
| getAvailabilityRules | BookingSettings.tsx | Section « Règles de disponibilité » | P1 | |
| createBookingPage | BookingSettings.tsx | Bouton « Nouvelle page de réservation » + modal | P1 | |
| updateBookingPage | BookingSettings.tsx | Édition d'une page de réservation | P1 | |
| deleteBookingPage | BookingSettings.tsx | Suppression d'une page de réservation | P0 | |
| getBookings | BookingSettings.tsx | Tableau des réservations par page (+filtre statut) | P1 | |
| getGcalAuthUrl | Integrations.tsx | Bouton « Connecter Google Agenda » | P1 | |
| getGcalEvents | Calendar.tsx | Overlay événements Google dans la vue calendrier | P1 | |
| syncGcal | Integrations.tsx / Calendar.tsx | Bouton « Synchroniser maintenant » + compteur synced/total | P0 | |
| listExternalCalendars | Integrations.tsx | Liste des calendriers externes d'une connexion (sélection) | P1 | |

---

## Inbox / Conversations / Chat

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getInboxMessages | Inbox.tsx | Chargement liste messages (filtres) — câbler la liste | P0 | |
| createConversation | Inbox.tsx | Bouton « Nouvelle conversation » + modal | P1 | |
| updateThread | Inbox.tsx / ChatInbox.tsx | Actions thread (assigner/statut/archiver) | P0 | |
| getChatPresenceActive | ChatInbox.tsx | Indicateur « agents/visiteurs en ligne » | P1 | |
| toggleCallRecording | Telephonie.tsx | Toggle « Enregistrer l'appel » pendant l'appel | P1 | |

---

## IA / Assistant

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| aiChat | AiContent.tsx / Inbox.tsx | Panneau chat IA (message → réponse + tokens) | P1 | |
| getAiConversations | AiContent.tsx | Historique des conversations IA (liste) | P1 | |
| getAiConversation | AiContent.tsx | Ouverture d'une conversation IA | P1 | dépend de getAiConversations |

---

## Facturation / Devis / Documents

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getInvoices | Invoices.tsx | Câbler le tableau des factures (liste) | P0 | |
| getInvoice | Invoices.tsx | Vue détail facture (modal/drawer) | P0 | |
| createInvoice | Invoices.tsx | Bouton « Nouvelle facture » + modal (montant/lead) | P1 | retourne payment_url |
| getQuote | Quotes.tsx | Vue détail devis (drawer) | P0 | |
| updateDocumentTemplate | DocumentTemplates.tsx | Sauvegarde édition d'un modèle de document | P0 | |

---

## Reports / Dashboards / Forecast

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getReportsOverview | Reports.tsx | Section synthèse (KPIs sur N jours) | P0 | |
| getReportsSources | Reports.tsx | Onglet « Sources » (tableau/graphe) | P0 | |
| getReportsConversion | Reports.tsx | Onglet « Funnel de conversion » | P0 | |
| getConversionBaselines | Reports.tsx | Lignes de référence sur graphes conversion | P1 | |
| getDashboard | Dashboard.tsx / SharedDashboard.tsx | Chargement d'un dashboard par id | P1 | |
| getDashboardLayouts | Dashboard.tsx | Sélecteur de layouts sauvegardés | P1 | |
| createDashboardLayout | Dashboard.tsx | Bouton « Enregistrer la disposition » | P1 | |
| updateDashboardLayout | Dashboard.tsx | Renommer/maj layout | P1 | |
| deleteDashboardLayout | Dashboard.tsx | Supprimer un layout | P0 | |
| createForecastTarget | Reports.tsx | Modal « Définir un objectif de prévision » | P2 | |
| deleteForecastTarget | Reports.tsx | Supprimer un objectif | P1 | dépend de createForecastTarget |

---

## Formulaires / Snapshots / Templates

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getFormSubmissions | Forms.tsx | Onglet « Réponses » d'un formulaire (tableau) | P0 | |
| getSnapshot | SnapshotsPage.tsx | Vue détail d'un snapshot | P0 | |
| getPackDetail | Marketplace.tsx | Page détail d'un industry pack (+ snapshot inclus) | P1 | |
| createTemplateFolder | Templates.tsx | Bouton « Nouveau dossier » | P0 | |
| getTemplateFolders | Templates.tsx | Arborescence dossiers (sidebar) | P0 | dépend de createTemplateFolder |

---

## Agence / Sous-comptes / Whitelabel (admin)

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getAgencies | Agencies.tsx | Câbler le tableau des agences | P0 | |
| createAgency | Agencies.tsx | Bouton « Nouvelle agence » + modal | P1 | |
| getSubAccounts | Agencies.tsx / Settings.tsx | Tableau des sous-comptes | P0 | |
| createSubAccount | Agencies.tsx | Bouton « Créer sous-compte » + modal | P1 | |
| updateSubAccount | Agencies.tsx | Édition sous-compte (rôle/limites) | P1 | |
| getWhitelabel | settings (whitelabel) | Chargement réglages marque blanche | P1 | |
| updateWhitelabel | settings (whitelabel) | Formulaire marque blanche (logo/domaine) | P1 | dépend de getWhitelabel |
| updateClientBusinessConfig | Settings.tsx | Section « Config métier du client » | P2 | |

---

## Sécurité / Compte / Notifications

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| totpSetup | Settings.tsx / ComplianceSettings.tsx | Bouton « Activer 2FA » → QR (otpauth_url) | P1 | |
| totpVerify | Settings.tsx | Champ code de vérification 2FA | P1 | dépend de totpSetup |
| totpDisable | Settings.tsx | Bouton « Désactiver 2FA » + confirm | P1 | |
| setNotificationPreferences | Settings.tsx | Section préférences de notification (toggles) | P1 | |
| updateCustomField | settings/CustomFieldsSettings.tsx | Édition d'un champ personnalisé | P0 | |

---

## E-commerce / Boutique

| Fonction | Page cible (boutique/...) | Geste UI | Prio | Note |
|---|---|---|---|---|
| getEcommerceVariants | boutique/Produits.tsx | Section variantes d'un produit | P1 | |
| getVariantInventory | boutique/Produits.tsx / warehouse | Colonne stock par variante | P1 | |
| createEcommerceOrder | boutique/Commandes.tsx | Bouton « Créer une commande » (manuelle) | P1 | |
| getCustomerOrders | boutique/Clients.tsx | Onglet « Commandes » d'un client | P0 | |
| getEcommerceCustomer | boutique/Clients.tsx | Vue détail client e-commerce | P0 | |
| getCustomerGroups | boutique/Clients.tsx | Filtre/section groupes de clients | P1 | |
| getCustomerChurn | boutique/BoutiqueDashboard.tsx | Widget « Churn clients » | P1 | |
| getProductReco | boutique/Produits.tsx / PublicStore | Bloc « Recommandations produits » | P1 | |
| getEcommerceSalesByChannel | boutique/BoutiqueDashboard.tsx | Graphe ventes par canal | P0 | |
| getStoreSettings | boutique/BoutiqueDashboard.tsx / settings | Chargement réglages boutique | P0 | |
| saveStoreSettings | settings (boutique) | Formulaire réglages boutique (save) | P0 | dépend de getStoreSettings |
| updateChannel | settings (boutique) | Toggle/édition d'un canal de vente | P1 | |
| updatePaymentConfig | settings (boutique) | Section config paiement | P1 | |
| updateShippingRate | settings (boutique) | Édition d'un tarif de livraison | P1 | |
| resolveShippingRateApi | PublicCheckout.tsx | Calcul tarif livraison au checkout | P1 | |
| getEcommerceCoupon | boutique/Coupons.tsx | Vue détail d'un coupon | P0 | |
| validateCoupon | PublicCheckout.tsx | Champ « Code promo » + validation | P0 | |
| getEcommerceSubscription | boutique/Abonnements.tsx | Vue détail d'un abonnement | P0 | |

---

## Panier / Checkout (flux boutique connecté)

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getCart | PublicStore.tsx / PublicCheckout.tsx | Affichage panier | P0 | |
| addCartItem | PublicStore.tsx | Bouton « Ajouter au panier » | P0 | |
| updateCartItem | PublicCheckout.tsx | Quantité +/- sur ligne panier | P0 | |
| deleteCartItem | PublicCheckout.tsx | Bouton supprimer ligne panier | P0 | |
| convertCart | PublicCheckout.tsx | Bouton « Finaliser la commande » | P1 | panier → commande |

---

## POS (point de vente)

| Fonction | Page cible (boutique/POS.tsx) | Geste UI | Prio | Note |
|---|---|---|---|---|
| createPosRegister | boutique/POS.tsx | Bouton « Nouvelle caisse » | P1 | |
| updatePosRegister | boutique/POS.tsx | Édition caisse | P1 | |
| voidPosTransaction | boutique/POS.tsx | Bouton « Annuler la transaction » + confirm | P1 | |

---

## Gift cards / Fidélité

| Fonction | Page cible (boutique/GiftCardsLoyaltyPage.tsx) | Geste UI | Prio | Note |
|---|---|---|---|---|
| getGiftCardBalance | boutique/GiftCardsLoyaltyPage.tsx | Champ « Vérifier solde carte cadeau » | P0 | |
| redeemGiftCard | boutique/GiftCardsLoyaltyPage.tsx | Bouton « Utiliser carte cadeau » | P1 | |
| getLoyaltyProgram | boutique/GiftCardsLoyaltyPage.tsx | Affichage du programme de fidélité | P0 | |
| earnLoyaltyPoints | boutique/GiftCardsLoyaltyPage.tsx | Action « Créditer des points » | P1 | |
| redeemLoyaltyPoints | boutique/GiftCardsLoyaltyPage.tsx | Bouton « Échanger des points » | P1 | |

---

## B2B / Bundles / Précommandes / Warehouse

| Fonction | Page cible | Geste UI | Prio | Note |
|---|---|---|---|---|
| getBundle | b2b/B2BPage.tsx | Vue détail d'un bundle | P1 | |
| createPreorder | b2b/B2BPage.tsx | Bouton « Nouvelle précommande » | P1 | |
| getShipment | warehouse/WarehousePage.tsx | Vue détail d'une expédition | P1 | |

---

## LMS / Cours

| Fonction | Page cible (lms/CoursesLMSPage.tsx) | Geste UI | Prio | Note |
|---|---|---|---|---|
| getCourseModules | lms/CoursesLMSPage.tsx | Liste/arborescence des modules d'un cours | P0 | |

---

## Affiliés

| Fonction | Page cible (affiliates/AffiliatesPage.tsx) | Geste UI | Prio | Note |
|---|---|---|---|---|
| getAffiliateById | affiliates/AffiliatesPage.tsx | Vue détail d'un affilié (drawer) | P1 | |

---

## Surveys (admin)

| Fonction | Page cible (surveys/SurveysAndDnsPage.tsx) | Geste UI | Prio | Note |
|---|---|---|---|---|
| getSurvey | surveys/SurveysAndDnsPage.tsx | Vue détail d'un sondage | P0 | |
| getSurveyResponse | surveys/SurveysAndDnsPage.tsx | Vue détail d'une réponse | P0 | |
| listResponses | surveys/SurveysAndDnsPage.tsx | Tableau des réponses d'un sondage | P0 | |

---

## Tickets / Support

| Fonction | Page cible (Tickets.tsx) | Geste UI | Prio | Note |
|---|---|---|---|---|
| createTicket | Tickets.tsx | Bouton « Nouveau ticket » + modal | P1 | |

---

## Top 20 quick-wins (P0, page existe, geste minimal)

Ordre conseillé d'exécution — chaque ligne = une PR courte câblant un getter/mutation déjà prêt côté backend sur un écran live.

| # | Fonction | Page | Geste |
|---|---|---|---|
| 1 | getInvoices | Invoices.tsx | Câbler tableau factures |
| 2 | getReportsOverview | Reports.tsx | Section KPIs |
| 3 | getReportsSources | Reports.tsx | Onglet Sources |
| 4 | getReportsConversion | Reports.tsx | Onglet Funnel |
| 5 | getFormSubmissions | Forms.tsx | Onglet Réponses |
| 6 | getAgencies | Agencies.tsx | Câbler tableau agences |
| 7 | getSubAccounts | Agencies.tsx | Tableau sous-comptes |
| 8 | bulkLeads | Leads.tsx | Actions groupées |
| 9 | importLeadsCsv | Leads.tsx | Bouton Importer CSV |
| 10 | exportConfigurableCsv | Leads.tsx | Bouton Exporter CSV |
| 11 | sendSms | LeadDetail.tsx | Bouton SMS |
| 12 | recomputeLeadScore | LeadDetail.tsx | Bouton Recalculer score |
| 13 | updateLeadNote | LeadDetail.tsx | Édition note |
| 14 | getStoreSettings | boutique/BoutiqueDashboard.tsx | Charger réglages boutique |
| 15 | saveStoreSettings | settings (boutique) | Save réglages boutique |
| 16 | validateCoupon | PublicCheckout.tsx | Champ code promo |
| 17 | getCustomerOrders | boutique/Clients.tsx | Onglet Commandes client |
| 18 | getCourseModules | lms/CoursesLMSPage.tsx | Liste modules |
| 19 | listResponses | surveys/SurveysAndDnsPage.tsx | Tableau réponses |
| 20 | updateDocumentTemplate | DocumentTemplates.tsx | Save modèle |

---

### Récap chiffré
- Total fonctions: **136**
- Exclues (non-UI légitime): **15**
- Actionnables surfaçables: **121** (P0 ≈ 40, P1 ≈ 65, P2 ≈ 16)
- Quick-wins P0 prioritaires identifiés: **20**
