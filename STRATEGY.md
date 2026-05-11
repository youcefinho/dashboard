# STRATEGY.md — Intralys CRM

> Positionnement marché, concurrents, modèle économique.
> Lis avant tout sprint pour ne pas dériver.

## Positionnement

**Intralys = CRM tout-en-un universel pour PMEs francophones qui gèrent des leads.**

Pas niche industrie : un lead capté via Facebook/Google/site = même structure peu importe le métier. Courtiers immobiliers, dentistes, plombiers, coachs, cleaning, agences pub — tous bénéficient du même core CRM.

Les spécificités industrie = **Packs optionnels** installables en 1 clic (custom fields + workflows + templates + dashboard layout pré-configurés).

## Marché cible

| Segment | Taille | Notes |
|---|---|---|
| PMEs QC francophones | ~200k | Marché initial — compliance Loi 25/CASL native = avantage |
| PMEs Canada | ~800k | Phase 2 — EN UI à ajouter |
| PMEs francophones global (FR, BE, CH, Maghreb) | ~5M+ | Phase 3 — multi-langue, hosting régional |
| Entreprise / Mid-market | — | Hors scope — Salesforce/HubSpot territory |

## Concurrents directs

| Concurrent | Force principale | Faille exploitable |
|---|---|---|
| **GoHighLevel** | Leader marché agency US, all-in-one | Anglais only, UI dépassée, complexité, $297/mois |
| **HubSpot** | Brand fort, écosystème massif | Cher ($800/mois Pro), complexe pour PMEs, free trop limité |
| **Pipedrive** | UX clean, commercial focus | Pas natif marketing/AI, pas booking, pas docs |
| **Brevo (ex-Sendinblue)** | FR natif, prix abordable | Surtout email — CRM faible, pas workflows complexes |
| **ActiveCampaign** | Workflows puissants | Pas booking, pas docs, pas calendrier, pas AI moderne |
| **Monday CRM** | Joli, flexible | Pas natif lead capture / marketing |
| **Zoho CRM** | Prix bas | UI dépassée, fragmenté en 30+ produits |
| **Folk / Attio** | Modernes, design top | Trop nouveaux, manque marketing/automation/forms |

## Positionnement Intralys

- **Tout-en-un comme GHL** : CRM + Marketing + Calendar + Docs + AI + Forms + Workflows + Reports
- **Beau comme Folk/Attio** : design system Intralys cyan/orange clean
- **Abordable comme Brevo** : $47-97/mois starter (vs $297 GHL, $800 HubSpot)
- **FR natif** : aucun gros concurrent US ne fait du français naturel
- **Compliance Loi 25 + CASL native** : avantage marché QC/CA (Loi 25 en vigueur depuis sept 2023)
- **AI Claude FR québécois** : scoring + content + workflow assistant en vrai français
- **Packs industrie 1-clic** : onboarding ultra-rapide vs config 5h sur GHL

## Différenciateurs killer (Sprint 6 livré)

1. **AI lead scoring contextualisé** par `business_type` du client
2. **AI content generator** 8 actions FR québécois
3. **Carte interactive Mapbox** des leads
4. **Dashboard configurable** widgets drag&drop + 5 layouts par industrie
5. **Signature mandat 1-clic SMS** (mobile-first)
6. **Mode "Agent en visite"** mobile-first vue dédiée
7. **Système Packs industrie** (5 packs seedés : Generic B2B, Real Estate Pro QC, Local Services, Health & Wellness, Coaching)

## Modèle économique

### Pricing prévu (à valider Sprint 10 Beta)

| Plan | Prix mensuel | Cible | Limites |
|---|---|---|---|
| **Starter** | $47 | Solopreneurs | 1 user, 1000 contacts, 500 emails/mois |
| **Pro** | $97 | PMEs 2-10 employés | 5 users, 10k contacts, 5k emails, AI, packs |
| **Business** | $197 | PMEs 10-50 | 25 users, 50k contacts, 20k emails, white-label léger |
| **Agency** | $297 | Agences (Intralys-style) | Sub-accounts illimités, revente SaaS, white-label total |

Add-ons :
- Pack "Real Estate Pro QC" (AMF + OACIQ + Centris) : +$20/mois
- Voice & IVR : +$40/mois (post Twilio Voice setup)
- Stripe Connect billing : commission 2%

### Roadmap revenue

- **3 mois post-launch** : 20 clients = $1-2k MRR
- **6 mois** : 100 clients = $5-10k MRR
- **12 mois** : 500 clients = $25-50k MRR → embauche 1er dev
- **24 mois** : 2000 clients = $100-200k MRR → équipe 4-5 devs + sales

## Hors scope définitif (sauf retournement marché)

- Memberships / Courses (Skool fait mieux)
- Ecommerce store builder (Shopify territory)
- Voice IVR Twilio (skip volontaire — courtiers utilisent cell perso)
- Affiliate Manager (V3, après 50 clients)
- Class/group bookings (rare en PME)

## Stratégie GTM (Sprint 10)

**Phase 1 — Beta privée (mois 1-2)**
- 5 clients test gratuits (1 par industrie : courtier + dentiste + plombier + coach + cleaning)
- Feedback hebdo + fix priorités
- Témoignages + études de cas

**Phase 2 — Soft launch (mois 3-4)**
- Landing intralys.com avec démo live
- Outbound LinkedIn + cold email vers 200 PMEs QC
- Posts LinkedIn Rochdi (founder story + différenciateurs)
- Partenariats agences marketing locales

**Phase 3 — Scale (mois 5+)**
- Ads Google (mots-clés "CRM PME Quebec", "alternative GoHighLevel français")
- Content marketing : 1 blog post/sem sur use cases industrie
- Referral program (10% commission récurrente)
- Programme partenaires agences (revente sub-accounts)

## Décisions stratégiques verrouillées

- ✅ Stack Cloudflare (pas pivot avant 500 clients)
- ✅ FR uniquement MVP (EN après 100 clients)
- ✅ Solo dev (Antigravity + Claude) jusqu'à 500 clients
- ✅ Pas de Stripe billing en MVP (mock display, vraie facturation = backlog)
- ✅ Pas de migration GHL réelle (V2 backlog quand mature)
- ✅ App mobile = Capacitor V1, React Native V2 si traction
