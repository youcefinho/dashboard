# ROADMAP.md — Intralys CRM

> Source de vérité unique pour le statut + prochaines étapes.
> Dernière mise à jour : 2026-05-12.

## Vision

CRM tout-en-un universel pour PMEs francophones (courtiers, dentistes, plombiers, coachs, cleaning, agences). Pas niche immobilier. Différenciateurs : compliance Loi 25/CASL native, AI FR québécois, packs industrie 1-clic, prix abordable vs GHL/HubSpot.

Marché cible : 200k PMEs QC, 800k Canada, 5M+ francophones global.

## Stack figée (cf. `docs/archive/` historique)

- **Backend** : TypeScript + Cloudflare Workers + D1 (SQLite edge)
- **Storage** : Cloudflare R2
- **Realtime** : Durable Objects (WebChat)
- **Frontend** : React 19 + Vite + Tailwind v4 + TanStack Router
- **AI** : Claude Haiku 4.5 (Anthropic)
- **Email** : Resend (avec mocks dev)
- **SMS** : Twilio (avec mocks dev)
- **Mobile futur** : PWA puis Capacitor V1 puis React Native V2 si traction
- **Hosting** : Cloudflare Pages

Voir `README-DEV.md` pour le setup local sans clés externes.

## Sprints accomplis ✅

| # | Sprint | Effort | Status |
|---|---|---|---|
| 0 | P0+P1+P2+P3 (foundations) | ~30j | ✅ Commité |
| Design 1+2 | Refonte UI palette Intralys cyan/orange | ~10j | ✅ Commité |
| Consolidation + Conversations | Mocks + tests + webchat + FB DM | ~17j | ✅ Commité |
| 4 | Pivot générique + Pipeline + Workflows | ~17j | ✅ Commité (75%, 8 triggers/actions backlog) |
| 5 | Vertical Calendar + Tasks | ~8j | ✅ Commité |
| 6 | Différenciateurs Intralys (D1-D7) | ~12j | ✅ Commité |
| 7 | Templates + Forms + AI killer | ~12j | ✅ Commité |
| 8 | Settings + Reports + Agency admin | ~17j | ✅ Commité |
| 9 | Mobile responsive + PWA | ~6j | ✅ Commité |
| 10 | Polish + Beta privée + Launch | ~10j | ✅ Commité |
| 11 | Capacitor V1 — App native iOS/Android | ~15j | ✅ Commité |
| 12 | Production Hardening & Core UX | ~8j | ✅ Commité |
| 13 | API publique + Webhooks OUT + Zapier | ~10j | ✅ Commité |
| 13.5 | Hotfix audit (tsconfig worker.ts + webhooks robustes + role api) | ~2j | ✅ Commité |
| 14 | GHL Migration importer (CSV + OAuth hybride) | ~15j | ✅ Commité |

**Total livré : ~189 jours de dev.**

## Sprint actuel 🔜

| 15 | App mobile React Native V2 | ~30j | ⏳ En attente de traction |

## Sprints restants

| # | Sprint | Effort | Description |
|---|---|---|---|
| 15 | App mobile React Native V2 | ~30j | Si traction confirmée — vraie app native iOS/Android |

## V2 Backlog (post-traction)

- Phase C Workflows complet : 8 triggers + 8 actions manquants (cf. archive Sprint 4)
- Migration depuis GHL réel (M1-M15 — cf. `_v2-backlog/migrate.ts`)
- Stripe Connect + SaaS configurator + Text-to-Pay
- Google Calendar OAuth 2-way sync (cf. `_v2-backlog/gcal.ts`)
- Google Business Profile API (cf. `_v2-backlog/gbp.ts`)
- Twilio Voice + IVR + voicemail
- Affiliate Manager
- Memberships / Courses
- Website builder / Funnels
- Marketplace templates inter-agency
- Multi-langue UI (EN, ES)
- WhatsApp Business API
- Stripe Connect SaaS configurator
- White-label mobile app branding

## Métriques objectif

- **Sprint 10 (Beta)** : 5 clients test gratuits validés
- **3 mois post-Sprint 10** : 20 clients payants à $47-97/mois
- **6 mois** : 100 clients = $5-10k MRR
- **12 mois** : 500 clients = $25-50k MRR → embauche 1er dev

## Docs actifs

- `README.md` — overview projet (auto-généré par Vite)
- `README-DEV.md` — setup local sans clés externes
- `ROADMAP.md` — ce doc
- `STRATEGY.md` — positionnement marché + concurrents
- `docs/ANTIGRAVITY-DEPTH-AUDIT.md` — checklist enrichissement page par page
- `docs/ANTIGRAVITY-GHL-INVENTORY.md` — référence features GHL extrait via API live
- `docs/ANTIGRAVITY-GHL-COMPLETENESS.md` — vue d'ensemble "fermer GHL"
- `docs/archive/` — sprints accomplis + plans historiques
- `docs/design/design-mockup.html` — mockup palette Intralys

## Convention

- 1 sprint à la fois, pas de parallèle
- Auto mode actif (Antigravity exécute, valide par push commit)
- Tests Vitest obligatoires sur features critiques
- Build vert après chaque commit
- Format commits : `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`
- Anti-collision : `git log --oneline -10 <fichier>` avant de toucher
