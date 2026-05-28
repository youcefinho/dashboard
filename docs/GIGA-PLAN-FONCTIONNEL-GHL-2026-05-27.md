# GIGA-PLAN FONCTIONNEL — Combler le gap vers GoHighLevel + CRM complet (2026-05-27)

> Objectif Rochdi : « plateforme digne de GoHighLevel + CRM + outils complet ». Ce plan = backlog des FONCTIONS manquantes (pas la qualité — voir `GIGA-PLAN-ENRICHISSEMENT` pour les 10 axes de profondeur). Établi par audit evidence-based (4 agents) de la surface réelle : **961 handlers, 407 endpoints**.

## 0. CONSTAT HONNÊTE — la plateforme n'est PAS maigre
| Domaine | Couverture vs GHL | Verdict |
|---|---|---|
| Auth / Identité / SaaS multi-tenant | **~95%** | quasi complet (MFA, agences, white-label, snapshots, API, portail) |
| CRM Core (leads/pipeline/contacts) | **~85%** | très complet (37 fonctions leads, scoring, dédup, segments, tâches) |
| E-commerce / Boutique | **~93%** | Shopify-lite quasi complet (POS, multi-canal, loyalty, abonnements) |
| Membership / LMS / Community / B2B | **~95%** | LOT 5 livré (cours, quiz, certificats, forum, surveys, affiliés) |
| Billing / SaaS | **~86%** | facturation, devis, e-sign, MRR/churn, Stripe Connect |
| AI | **~85%** | content writer, bot RAG, voice agent, NL query, proactif |
| Reports / Analytics | **~80%** | dashboards, attribution, cohortes, forecast, exports planifiés |
| Plateforme / Ops / Conformité | **~85%** | audit, RGPD, webhooks, KB, observabilité, marketplace |
| Automation (workflows/funnels) | **~75%** | builder + séquences + trigger links + funnels |
| Marketing (email/social/réputation) | **~80%** | broadcast, social FB/IG, réputation, GBP, product reviews |
| Forms / Sites | **~70%** | form builder + site builder + SSR + custom domains |
| Inbox / Conversations | **~75%** | omnichannel SMS/email/WA/FB/IG/webchat, assignation |
| Calendrier / Booking | **~80%** | dispo, sync Google+Outlook bi-dir, rappels, reschedule self-service |
| Téléphonie / Voix | **~70%** | appels in/out, IVR, voicemail+transcription, recording, SMS, WhatsApp |

**Moyenne : ~83% GHL.** → Le travail n'est pas de « tout reconstruire » mais (1) **surfacer l'existant dans l'UI**, (2) **câbler le runtime** (cf. PHASE1), (3) **combler ~80 fonctions précises** ci-dessous.

> ⚠️ La sensation « trop maigre » vient probablement du fait que beaucoup de ces 961 handlers ne sont PAS visibles/branchés dans l'UI. **Sprint U0 ci-dessous = audit de surfaçage UI** (souvent le vrai gap ressenti).

---

## 1. BACKLOG FONCTIONNEL — les ~80 fonctions manquantes (✗ vérifiés)

### 🔵 LOT F1 — Quick wins UX à fort impact (pur build, pas d'intégration externe)
Ces fonctions sont attendues d'un CRM moderne et **manquent vraiment** :
| # | Fonction | Domaine | Pourquoi |
|---|---|---|---|
| F1.1 | **Notes internes** dans conversations (privé équipe ≠ message client) | Inbox | collaboration équipe — standard GHL |
| F1.2 | **Accusés de réception / statut de livraison** des messages | Inbox | feedback envoi SMS/email |
| F1.3 | **Indicateurs de frappe** (typing) — le DO WebSocket existe déjà | Inbox | temps réel |
| F1.4 | **Envoi programmé** de message (delay/heure précise) | Inbox | standard |
| F1.5 | **Réponses suggérées par IA** dans l'inbox | Inbox/AI | différenciateur |
| F1.6 | **Champs personnalisés typés** (dropdown, multi-select, checkbox, date) — actuellement texte | CRM | flexibilité données |
| F1.7 | **Règles d'attribution/routage de leads** (round-robin, par source) | CRM | distribution équipe |
| F1.8 | **DND / préférences de contact** (UI) — la table opt-out existe | CRM | conformité + UX |
| F1.9 | **Paiement à la réservation** (Stripe dans le tunnel booking) | Calendar | monétisation RDV |
| F1.10 | **Événements objectif (goal/conversion)** dans workflows | Automation | mesure ROI auto |
| F1.11 | **Déclencheurs manquants** : anniversaire, message entrant | Automation | parité GHL |
| F1.12 | **Quiet hours** (plages horaires d'envoi) dans workflows | Automation | conformité |
| F1.13 | **Popups / widgets flottants** (opt-in, exit-intent) | Sites | capture leads |
| F1.14 | **Formulaires multi-étapes** (UI) + **champs upload fichier** | Forms | parité |
| F1.15 | **Réponses d'avis par IA** | Marketing/AI | gain de temps |
| F1.16 | **Missed-call-text-back** (SMS auto sur appel manqué) | Téléphonie | feature GHL signature |
| F1.17 | **Portail facturation client self-service** (payer facture, gérer abo) | Billing | autonomie client |
| F1.18 | **Liens visio** (Zoom/Meet/Teams) dans confirmation RDV | Calendar | hybride |

### 🟣 LOT F2 — Calendriers & téléphonie avancés
| # | Fonction | Domaine |
|---|---|---|
| F2.1 | **Calendriers de groupe/classe** (collectif multi-staff) | Calendar |
| F2.2 | **Round-robin auto-dispatch** (assignation automatique) | Calendar |
| F2.3 | **Buffer times** configurables | Calendar |
| F2.4 | **Provisioning de numéros** de téléphone (Twilio buy) | Téléphonie |
| F2.5 | **Power dialer** (composition en série) | Téléphonie |
| F2.6 | **Call tracking / attribution** (numéros traçables par source) | Téléphonie |

### 🟢 LOT F3 — Marketing & contenu avancés
| # | Fonction | Domaine |
|---|---|---|
| F3.1 | **Social LinkedIn + TikTok** (planner) | Marketing |
| F3.2 | **RSS-to-email** (newsletter auto) | Marketing |
| F3.3 | **UI campagnes dédiée** + analytics de campagne | Marketing |
| F3.4 | **A/B testing avancé** (email + séquences) | Marketing/Automation |
| F3.5 | **Module blog** dédié (publishing) | Sites |
| F3.6 | **Bibliothèque de templates** sites/funnels | Sites |
| F3.7 | **Math/opérations** dans actions workflow | Automation |

### 🟠 LOT F4 — E-commerce & B2B avancés
| # | Fonction | Domaine |
|---|---|---|
| F4.1 | **Moteur upsell/cross-sell** temps réel (panier) | E-commerce |
| F4.2 | **Portail retours self-service** + génération d'étiquettes | E-commerce |
| F4.3 | **B2B avancé** : RFQ (demande de devis) + chaînes d'approbation | E-commerce/B2B |
| F4.4 | **Pricing dynamique** (géo, A/B, par volume) | E-commerce |
| F4.5 | **Facturation multi-devises** + taxes multi-région sur factures SaaS | Billing |
| F4.6 | **Système de crédits / wallet** client | Billing |
| F4.7 | **Metering usage-based** (facturation à l'usage) | Billing |
| F4.8 | **Coupons d'abonnement** (distincts des coupons e-commerce) | Billing |

### 🔴 LOT F5 — Intégrations externes (nécessitent creds + travail API tiers)
> ⚠️ Chacune = rails posés mock-inactif, activation = main Rochdi + creds.
| # | Intégration | Domaine |
|---|---|---|
| F5.1 | **Marketplaces** : Amazon / eBay / Etsy | E-commerce |
| F5.2 | **3PL fulfillment** : ShipStation / FBA | E-commerce |
| F5.3 | **BNPL** : Klarna / Affirm / PayPal Credit | E-commerce |
| F5.4 | **Comptabilité** : QuickBooks / Xero / FreshBooks | Billing |
| F5.5 | **Reporting Ads** : Google Ads + Facebook Ads | Reports |
| F5.6 | **SSO / SAML 2.0 / OpenID** + LDAP/Entra ID | Auth |
| F5.7 | **Visio** : Zoom / Google Meet / Teams (API) | Calendar |
| F5.8 | **SIP / PBX** (téléphonie avancée) | Téléphonie |

### ⚫ LOT F6 — Enterprise & conformité
| # | Fonction | Domaine |
|---|---|---|
| F6.1 | **App mobile** : build + distribution (Capacitor → stores) | Plateforme |
| F6.2 | **Mode HIPAA** (santé) + SOC2 readiness | Plateforme |
| F6.3 | **Revenue recognition** ASC 606 | Billing |
| F6.4 | **Gamification** LMS (badges, classements) | LMS |
| F6.5 | **Analyse de cohortes** apprenants | LMS |
| F6.6 | **Scorecards de performance agents** | Reports |
| F6.7 | **Constructeur de rapports SQL** custom (utilisateurs avancés) | Reports |
| F6.8 | **IP whitelisting** + auth passwordless | Auth |
| F6.9 | **Assistant IA employé** (agent autonome multi-tâches) | AI |
| F6.10 | **IA prise de RDV** (booking conversationnel) | AI/Calendar |

---

## 2. SPRINT U0 — Audit de surfaçage UI (À FAIRE EN PREMIER)
**Le vrai gap ressenti est probablement là.** Beaucoup des 961 handlers n'ont pas d'entrée UI/nav. Avant de construire du neuf :
1. Croiser les 407 endpoints API ↔ les 131 pages : quels handlers n'ont AUCUN appel front ?
2. Lister les fonctions « invisibles » (ex : marketplace l'était au LOT 2, débloqué par une entrée nav).
3. Pour chaque domaine : la page expose-t-elle TOUTES les capacités du handler (filtres, bulk, exports, sous-ressources) ?
**Livrable** : `docs/AUDIT-SURFACAGE-UI.md` — table endpoint→page→exposé(o/n). Souvent, « enrichir une section » = surfacer ce qui existe déjà, pas coder du backend.

---

## 3. ORDONNANCEMENT recommandé
| Priorité | Lot | Rationale |
|---|---|---|
| **P0** | Sprint U0 surfaçage + PHASE1 câblage runtime | Rendre VISIBLE/ACTIF ce qui existe déjà (80% du « manque » ressenti). |
| **P1** | LOT F1 (quick wins UX) | 18 fonctions pur-build à fort impact, parité GHL ressentie. |
| **P2** | LOT F2 + F3 (calendrier/téléphonie/marketing avancés) | Approfondit les domaines à 70-80%. |
| **P3** | LOT F4 (e-commerce/billing avancés) | Monétisation + B2B. |
| **P4** | LOT F5 (intégrations) | Nécessite creds Rochdi ; gros ROI mais dépend du tiers. |
| **P5** | LOT F6 (enterprise/conformité) | Différenciation haut de gamme. |

## 4. Méthode (rappel)
Chaque fonction F* = mini-sprint « 18 agents » : Chaman (audit existant — souvent une base existe déjà) → Phase A socle (migration/types/routes/i18n/contrat) → Phase B B∥C (backend∥frontend disjoints, MAX 4 agents) → cohérence + tests + validation hôte. 100% additif, capabilities seq80 figées, flags paiement/intégration inactifs par défaut.

## 5. DoD par fonction
- [ ] Backend : handler + validation engine + tests + bornage tenant + i18n×4.
- [ ] Frontend : page/composant + états (loading/empty/error/confirm) + a11y + i18n.
- [ ] Surfaçage : entrée nav/route + visible selon capability.
- [ ] Build 0 erreur + tests verts + parité i18n.
- [ ] Doc contrat `docs/LOT-F<n>.md`.

## 6. Synthèse stratégique
- La plateforme est **~83% GHL-équivalente au niveau backend** — c'est énorme.
- Le ressenti « maigre » = **surfaçage UI incomplet** + **runtime non câblé** (engines testés mais pas exécutés). → P0 règle l'essentiel du ressenti SANS gros build.
- Le vrai backlog neuf = **~80 fonctions** dont ~18 quick-wins (LOT F1) et ~16 intégrations (F5/F6) dépendantes de creds.
- Combiné au `GIGA-PLAN-ENRICHISSEMENT` (qualité/profondeur) → roadmap complète vers une plateforme tout-en-un de niveau GHL.
