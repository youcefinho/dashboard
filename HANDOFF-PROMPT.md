# 🎯 HANDOFF PROMPT — Intralys Dashboard (état réel juin 2026)

Tu reprends le projet `intralys-dashboard` (CRM tout-en-un PMEs francophones). Ce fichier reflète l'état RÉEL du projet.

> **Source de vérité** : AGENTS.md (règles permanentes) + ROADMAP.md (historique sprints) + ce fichier (contexte reprise).

---

## 📍 Working dir
`c:\Users\rochdi\.gemini\antigravity-ide\scratch\intralys-dashboard`

⚠️ **Heads-up** :
- Repo sur **VMware Shared Folder** → `git` peut refuser (`fatal: detected dubious ownership`). Travailler via Read/Edit/Write/Grep.
- **bun/npx** : validation build/typecheck côté user.

---

## 🛠️ Stack figée
- **Frontend** : React 19 + Vite + Tailwind v4 + TanStack Router
- **Backend** : TypeScript + Cloudflare Workers + D1 + R2 + Durable Objects
- **AI** : Claude Haiku 4.5 · **Email** : Resend · **SMS** : Twilio
- **Mobile** : PWA + Capacitor V1
- **Hosting** : Cloudflare Pages

---

## 📊 État du projet

### Chiffres clés
- **~240 jours de dev** cumulés
- **91+ sprints** livrés (dont LOTs thématiques E1-E9, S7-S9, G1-G10, etc.)
- **82+ pages**, **45+ settings components**, **50+ primitives UI**
- **14,664 lignes CSS** (design system Stripe depuis Sprint 38 RESET)
- **4 catalogues i18n** (fr-CA, fr-FR, en, es) ~400KB chacun
- **177 fichiers SQL** de migration (dans `migrations/`)

### Design system : Stripe Dashboard (Sprint 38+)
- Primary : `#635BFF` (purple Stripe)
- Brand Intralys : `#009DDB` cyan + `#D96E27` orange (signature uniquement)
- Surfaces : `--bg-canvas` #F6F9FC / `--bg-surface` white
- Shadows : noir subtle 5-10%
- Pas de dark mode (sauf sidebar variant opt-in)

### Fonctionnalités majeures livrées
| Catégorie | Sprints | Contenu |
|-----------|---------|---------|
| **Core CRM** | 0-22 | Leads, Pipeline, Tasks, Calendar, Inbox, Dashboard |
| **Design depth** | 23-41 | 47 vagues visuelles → Sprint 38 RESET Stripe → Sprint 39-41 polish |
| **Settings** | 42 | 11 composants settings, PipelineSettings Wizard |
| **Production quality** | 43 | Perf audit, dead code, lint, TS strict, backend wiring |
| **Mobile PWA** | 44 | Capacitor, deep links, push notifs, splash, offline |
| **Onboarding** | 45 | Setup wizard, empty states, coachmarks |
| **Reports** | 46 | Reports builder, admin analytics, notifications |
| **E-commerce** | E1-E9 | Catalogue, storefront, checkout, POS, gift cards, loyalty |
| **Helpdesk** | G1 | Tickets, SLA, KB, chatbot |
| **AI Workspace** | G8 | RAG, copilote, chatbot sessions |
| **Telephony** | S7-S9 | VoIP Twilio, IVR, voicemail, dialer |
| **Billing** | S10 | Stripe live, subscriptions, invoices |
| **Rate limiting** | 91 | KV distributed, 3 tiers, 14 tests |

### Dernière dette technique corrigée (Sprint cleanup juin 2026)
- ✅ 126 occurrences `--brand-primary` → `--primary` migrées (14 fichiers)
- ✅ Documents.tsx : OACIQ button indigo → design tokens + TypeScript strict
- 📦 177 migrations SQL consolidées dans `migrations/`
- 📦 163 docs obsolètes archivés dans `docs/archive/`

---

## 📁 Structure nettoyée

```
intralys-dashboard/
├── AGENTS.md              ← Règles permanentes agent (design system, conventions)
├── HANDOFF-PROMPT.md      ← Ce fichier (contexte reprise)
├── ROADMAP.md             ← Historique sprints + vision
├── STRATEGY.md            ← Positionnement marché
├── README-DEV.md          ← Setup local
├── CHANGELOG.md           ← Changelog releases
├── LAUNCH-CHECKLIST.md    ← Checklist go-live
├── BETA-CODES.md          ← Codes beta privée
├── schema.sql             ← Schéma D1 courant
├── seed.sql               ← Données seed
├── migrations/            ← 177 fichiers SQL historiques
├── docs/                  ← 13 docs actifs (primitives, API, a11y, ops)
│   └── archive/           ← ~200 specs LOT/sprint terminés
├── src/                   ← Code source
│   ├── components/        ← Composants (ui/, layout/, settings/, etc.)
│   ├── pages/             ← 82+ pages
│   ├── hooks/             ← 9 hooks custom
│   ├── lib/               ← Utilities (i18n, api, fuzzy, aiSort, etc.)
│   └── index.css          ← Design system Stripe (~14.6K lignes)
└── tests/                 ← E2E Playwright + Vitest
```

---

## 🔜 Prochaines étapes possibles

Consulter `ROADMAP.md` section "Sprints restants & Giga-Roadmap 100 Sprints" pour les vagues 6-10.

Axes prioritaires identifiés :
1. **Vague 6 (S51-S60)** : Téléphonie avancée (IVR visuel, transcriptions Whisper)
2. **Vague 7 (S61-S70)** : Funnels, A/B Testing, Multi-entrepôts
3. **Vague 8 (S71-S80)** : IA cognitive (RAG avancé, bot autonome, sentiments)
4. **Vague 9 (S81-S90)** : Multi-tenant SaaS (agences, white-label, custom domains)
5. **Vague 10 (S91-S100)** : ~~Rate-limiting~~ ✅ + chiffrement + Loi 25 auto + SQLite mobile

---

## 👤 User profile

- **Nom** : Rochdi Dahmani · **Email** : intralys@gmail.com
- **Langue** : français québécois informel (tu/ouais, jamais vous)
- **Autonomie** : enchaîner sans demander feu vert. Si doute → choisis et continue.
- **Style design** : Stripe Dashboard paradigm (subtle, pas dramatic)
- **Outil** : Bun (jamais npm). Build = `bun run build`. Dev = `bun run dev`.
