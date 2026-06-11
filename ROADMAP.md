# ROADMAP.md — Intralys CRM

> Source de vérité unique pour le statut + prochaines étapes.
> Dernière mise à jour : 2026-06-11.

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
| Consolidation | Mocks + tests + webchat + FB DM | ~17j | ✅ Commité |
| 4 | Pivot générique + Pipeline + Workflows | ~17j | ✅ Commité |
| 5 | Vertical Calendar + Tasks | ~8j | ✅ Commité |
| 6 | Différenciateurs Intralys (D1-D7) | ~12j | ✅ Commité |
| 7 | Templates + Forms + AI killer | ~12j | ✅ Commité |
| 8 | Settings + Reports + Agency admin | ~17j | ✅ Commité |
| 9 | Mobile responsive + PWA | ~6j | ✅ Commité |
| 10 | Polish + Beta privée + Launch | ~10j | ✅ Commité |
| 11 | Capacitor V1 — App native iOS/Android | ~15j | ✅ Commité |
| 12 | Production Hardening & Core UX | ~8j | ✅ Commité |
| 13 | API publique + Webhooks OUT + Zapier | ~10j | ✅ Commité |
| 13.5 | Hotfix audit (tsconfig worker.ts + webhooks robustes) | ~2j | ✅ Commité |
| 14 | GHL Migration importer (CSV + OAuth hybride) | ~15j | ✅ Commité |
| 14.5 | Hotfix audit GHL Migration (OAuth CSRF/AES) | ~1j | ✅ Commité |
| 16 | Design System Migration — Legacy Modal/Input éliminés | ~1j | ✅ Commité |
| 16.5 | Polish visuel + tokens CSS | ~0.5j | ✅ Commité |
| 17 | Fix P0/P1 UX-friction | ~2j | 🟡 Code-complete |
| 18 | Slide-over panels + perf optimiste | ~5j | 🟡 Code-complete |
| 19 | AI Sparkles + Command palette + optimistic msg | ~5j | 🟡 Code-complete |
| 20 | AI summarize + suggest next action + shortcuts | ~4j | 🟡 Code-complete |
| 21 | Quick-Add FAB + density modes + smart lists | ~5j | 🟡 Code-complete |
| 22 | TaskPanel stack + Activity feed + Lead timeline | ~5j | 🟡 Code-complete |
| 23 | Visual lift design — 47 vagues atomiques | ~16j | 🟡 Code-complete |
| 24 | Polish UX/UI — 6 primitives + InteractiveTour + erreurs pages | ~2j | 🟡 Code-complete |
| 25 | Design depth — Typography + Icon Lucide + Sensorial (7 sons, 5 haptics) | ~1.5j | 🟡 Code-complete |
| 26 | Inbox bubbles + Forms aesthetics + Wizard primitive | ~0.5j | 🟡 Code-complete |
| 27 | Tables premium — Frozen header/sticky col/expand row | ~1j | 🟡 Code-complete |
| 28 | Performance + Mobile + AI Insight Cards | ~0.5j | 🟡 Code-complete |
| 29 | Dashboard Presets — 3 presets Manager/Agent/Admin | ~0.5j | 🟡 Code-complete |
| 30 | Finition design — 3 primitives + hooks + fuzzy search | ~1j | 🟡 Code-complete |
| 31 | Wiring — URL params + Calendar drag-resize + aiSort | ~0.5j | 🟡 Code-complete |
| 32 | Search + AI + Tables — Fuzzy 12 champs + WCAG AA 8 fixes | ~0.5j | 🟡 Code-complete |
| 33 | Icon migration 88 fichiers + reactions + quickReplies | ~0.5j | 🟡 Code-complete |
| 34 | PDF exports + favicon/OG + NetworkStatus + Toast queue | ~0.5j | 🟡 Code-complete |
| 35 | Production-ready — Perf + i18n + E2E + Capacitor + View Transitions | ~1.2j | 🟡 Code-complete |
| 36 | Dashboard DRAMATIC — Hero + KPI + Charts depth | ~0.5j | 🟡 Code-complete |
| 38 | ⚠️ **SPRINT RESET** — CSS -70% + Stripe paradigm + 15 primitives + 7 pages | ~1.5j | 🟡 Code-complete |
| 39 | Stripe-PLUS — Typography + KPI + Charts + Sidebar | ~0.5j | 🟡 Code-complete |
| 40 | Details Stripe-grade — Sparkline + Tag statusIcon + Live indicators | ~0.5j | 🟡 Code-complete |
| 41 | Inbox + Calendar refonte Stripe + useShortcuts hook | ~0.5j | 🟡 Code-complete |
| 42-50 | Settings, Prod quality, Mobile PWA, Onboarding, Reports, A11y AA | ~15j | 🟡 Code-complete |
| E1-E9 | **E-commerce** — Catalogue, Storefront, POS, Gift cards, Loyalty, Funnels | ~20j | 🟡 Code-complete |
| G1-G10 | **LOTs fonctionnels** — Helpdesk, Affiliates, OAuth, Segments, AI, WhiteLabel | ~25j | 🟡 Code-complete |
| S7-S9 | **SaaS + Telephony** — VoIP Twilio, IVR, Voicemail, Billing Stripe | ~10j | 🟡 Code-complete |
| 91 | Rate-Limiting Distribué — KV 3 tiers + middleware + 14 tests | ~0.3j | ✅ Commité |

> 📋 **Détail complet** : voir `docs/archive/` pour les specs LOT et plans sprint originaux.

**Total livré : ~240 jours de dev.**

## Sprint actuel 🔜

🎉 **SPRINT 100 LIVRÉ — GIGA-ROADMAP COMPLÈTE !** 🎉

## Sprints restants & Giga-Roadmap 100 Sprints 🔜

> [!TIP]
> La feuille de route complète (100 sprints) est archivée dans `docs/archive/GIGA-ROADMAP-100-SPRINTS.md`.

### Prochaines Vagues
- **Vague 6 (S51-S60)** : Téléphonie avancée (IVR visuel, répondeurs, transcriptions Whisper, push FCM/APNS)
- **Vague 7 (S61-S70)** : Funnels, A/B Testing, Multi-entrepôts, tarifs B2B, taxes locales
- **Vague 8 (S71-S80)** : IA cognitive (RAG, bot autonome, analyse sentiments, copilote vente)
- **Vague 9 (S81-S90)** : Multi-tenant SaaS (agences, white-label, custom domains, snapshots)
- **Vague 10 (S91-S100)** : ~~Rate-limiting~~ ✅ S91 + ~~Chiffrement AES-GCM~~ ✅ S92 + ~~Purge RGPD/Loi 25~~ ✅ S93 + ~~Edge Cache~~ ✅ S94 + ~~Code Splitting~~ ✅ S95 + ~~API Versioning~~ ✅ S96 + ~~Offline Mobile~~ ✅ S97 + ~~Rich Push~~ ✅ S98 + ~~E2E Tests~~ ✅ S99 + ~~Security Audit~~ ✅ S100 ✅✅✅

## Métriques objectif

- **Sprint 10 (Beta)** : 5 clients test gratuits validés
- **3 mois post-Sprint 10** : 20 clients payants à $47-97/mois
- **6 mois** : 100 clients = $5-10k MRR
- **12 mois** : 500 clients = $25-50k MRR → embauche 1er dev

## Docs actifs

- `README-DEV.md` — setup local sans clés externes
- `ROADMAP.md` — ce doc
- `STRATEGY.md` — positionnement marché + concurrents
- `HANDOFF-PROMPT.md` — contexte reprise agent
- `AGENTS.md` — règles permanentes agent + design system
- `docs/DOCS-PRIMITIVES.md` — catalogue 50+ primitives UI
- `docs/archive/` — sprints accomplis + plans historiques

## Convention

- 1 sprint à la fois, pas de parallèle
- Tests Vitest obligatoires sur features critiques
- Build vert après chaque commit
- Format commits : `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`
- Migrations SQL dans `migrations/`
