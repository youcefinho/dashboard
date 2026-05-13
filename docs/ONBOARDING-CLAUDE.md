# Intralys CRM — Onboarding Handoff (2026-05-13)

> Tu prends le relais sur un projet à l'état avancé. Lis ce doc en entier
> avant de toucher au code. Source de vérité = `ROADMAP.md` à la racine.

## 1. Identité projet

**Intralys CRM** = clone GoHighLevel positionné pour PMEs francophones (courtiers
immobiliers, dentistes, plombiers, coachs, services ménage, agences).

- **Solo dev** : Rochdi (`intralys.dev@gmail.com`, ID GitHub `youcefinho`)
- **Working dir** : `c:\Users\rochdi\.gemini\antigravity\scratch\intralys-dashboard`
- **Différenciateurs** vs GHL ($297/mois) et HubSpot ($800/mois) :
  - Compliance Loi 25 (Québec) + CASL (Canada) native
  - AI Claude Haiku 4.5 en français québécois (pas parisien)
  - Packs industrie 1-clic
  - Prix MVP $47-97/mois
- **Marché** : 200k PMEs QC → 800k Canada → 5M+ francophones global

## 2. Stack figée (verrouillée jusqu'à 500 clients)

- Backend : TypeScript + Cloudflare Workers + D1 (SQLite edge)
- Storage : Cloudflare R2 ; Realtime : Durable Objects (WebChat)
- Frontend : React 19 + Vite + Tailwind v4 + TanStack Router
- AI : Anthropic Claude Haiku 4.5 (model id `claude-haiku-4-5`)
- Email : Resend (mocks dev) ; SMS : Twilio (mocks dev)
- Hosting : Cloudflare Pages
- Mobile : PWA → Capacitor V1 (livré) → React Native V2 (en attente de traction)

**Ne propose JAMAIS** Postgres, Vercel, Next.js, OpenAI, Stripe. Stack figée.
Mode `USE_MOCKS=true` est la règle en dev — pas besoin de clés externes pour bosser.

## 3. État actuel (2026-05-13)

**18 sprints livrés** = **~192 jours de dev cumulés**, **193 tests verts**, build vert.

| Sprint | Thème | Effort |
|---|---|---|
| 0–10 | Foundations → MVP complet (CRM, AI, mobile, beta launch) | ~135j |
| 11 | Capacitor V1 (iOS/Android natif) | ~15j |
| 12 | Production Hardening (sessions, 2FA, health, backup, security headers) | ~8j |
| 13 | API publique + Webhooks OUT + Zapier | ~10j |
| 13.5 | Hotfix audit (tsconfig worker.ts exclude + ctx.waitUntil + retry backoff + role api) | ~2j |
| 14 | GHL Migration importer (CSV + OAuth hybride) | ~15j |
| 14.5 | Hotfix audit GHL (OAuth CSRF/AES, schema mismatches, tags/CF, idempotence réelle) | ~1j |
| 16 | Design System Migration (Modal Radix + nouveau Input, _legacy/_compat supprimés) | ~1j |
| 16.5 | Polish visuel + snapshots Playwright | ~0.5j |

**Sprint 15 (React Native V2, ~30j)** : *en attente de traction beta*. Ne pas démarrer.

**Critère Sprint 10 non validé** : "5 clients test gratuits". C'est *le* blocker
stratégique. Tout dev de plus = scope creep tant que ce critère n'est pas atteint.

## 4. Workflow dual-AI Claude ↔ Antigravity

Rochdi utilise **2 IAs en parallèle** :
- **Claude Code (toi)** : planifie, audite, commit chirurgical, draft les prompts
- **Antigravity (Gemini)** : exécute les sprints en batch, commit massivement

**Pattern habituel** :
1. Tu drafts un `ANTIGRAVITY-SPRINT{N}-PLAN.md` à la racine
2. Tu commit le plan + propose un prompt copy-paste à Rochdi
3. Rochdi colle le prompt à Antigravity
4. Antigravity exécute en heures (vs jours estimés)
5. Tu audites le résultat → trouves bugs critiques
6. Tu drafts un Sprint {N}.5 hotfix
7. Rochdi relance Antigravity sur le hotfix

**Pattern Antigravity à connaître** : il livre vite, tests Vitest passent, mais
il **mocke la DB** dans les tests → bugs runtime invisibles. Ex :
- Sprint 13 : tsconfig excluait `src/worker.ts` du type-check → 23 erreurs TS masquées
- Sprint 14 : 5 colonnes inventées (`dnd_settings_json`, `options_json`, `starts_at`)
  → 100% des INSERT auraient crashé en prod

**Pour chaque sprint Antigravity, fais un audit `general-purpose` agent** avant
de proposer Sprint suivant. Pattern dans transcripts récents.

## 5. Source-of-truth files (lire en priorité)

1. `ROADMAP.md` (racine) — statut tous sprints, sprint actuel, sprints restants
2. `STRATEGY.md` (racine) — positionnement marché, pricing, concurrents, hors-scope
3. `README-DEV.md` (racine) — setup local, scripts, env vars, comptes test
4. `docs/archive/ANTIGRAVITY-SPRINT*-PLAN.md` — plans détaillés sprints livrés
5. `docs/archive/SPRINT*-HOTFIX.md` — résumés exécutifs hotfix
6. `docs/MIGRATION-DESIGN-SYSTEM.md` — conventions UI nouveau design system
7. `docs/API-PUBLIC.md`, `docs/ZAPIER-INTEGRATION.md`, `docs/BACKUP-RESTORE.md`

**Mémoire persistante Claude Code** :
`C:\Users\rochdi\.claude\projects\c--Users-rochdi--gemini-antigravity-scratch-intralys-dashboard\memory\`
- `MEMORY.md` (index)
- `project_overview.md`, `project_status.md`, `project_strategy.md`, `project_conventions.md`

Lis ces 4 au démarrage de toute conversation.

## 6. Conventions critiques (DO)

- **1 sprint à la fois** — pas de parallélisme
- **Format commits** : `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`,
  `refactor(scope): ...`, `test(scope): ...`, `docs(scope): ...`
- **Anti-collision** : `git log --oneline -10 <fichier>` avant de toucher
- **Build vert + tests verts** avant chaque commit
- **Tests Vitest** obligatoires sur features critiques
- **FR québécois** dans tout le UI (pas parisien : "ça fit", "pis", "courriel")
- **Tokens CSS uniquement** dans le UI : `text-[var(--text-muted)]`,
  jamais `text-gray-400` / `text-zinc-500`
- **Run `bun run build` + `bun run test --run`** pour valider

## 7. Tech debt VOLONTAIRE (NE PAS retirer)

### 🟡 BYPASS auth en mode dev
Rochdi a explicitement demandé un bypass login local sans saisir mot de passe.
Implémentation depuis Sprint polish pré-beta (commit 20efccb) :

- **Backend** : `src/worker/auth.ts` `requireAuth` retourne `{ userId: 'admin', role: 'admin' }`
  si `env.DEV_BYPASS_AUTH === 'true'`
- **Frontend** : `src/lib/api.ts` `login()` retourne fake token si
  `import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'`
- **Dev local** : `DEV_BYPASS_AUTH=true` dans `.dev.vars` + `VITE_DEV_BYPASS_AUTH=true`
  dans `.env.local` (les deux gitignored)
- **Prod** : variables non-définies → vrai check token + password

**À retirer SEULEMENT** juste avant ouverture beta aux 5 premiers clients
(décision de Rochdi, pas auto).

### 🟡 CSP unsafe-inline + unsafe-eval
`public/_headers` autorise `'unsafe-inline' 'unsafe-eval'` script-src.
Nécessaire pour Vite (dev) + Swagger UI inline scripts à `/docs/api`.
À durcir post-React strict mode + nonce — Sprint dédié si besoin.

## 8. Anti-patterns à refuser

- Migrer vers Postgres/Vercel/Next.js/OpenAI → stack figée
- Implémenter Workflows phase C 8 triggers/actions → V2 backlog
- Stripe Connect billing réel → V2 backlog (mock display OK)
- Google Calendar 2-way sync, Google Business Profile → V2 backlog (`_v2-backlog/`)
- Twilio Voice IVR → hors-scope définitif (courtiers utilisent cell perso)
- Memberships / Courses → Skool territoire
- Refresh palette / direction artistique sans demande explicite
- Multi-langue UI (EN, ES) → après 100 clients
- Démarrer Sprint 15 RN V2 sans validation traction beta

## 9. Direction stratégique recommandée

Le projet est **shippable**. Reste objectivement :

### Option A : GTM beta (recommandé)
Critère Sprint 10 pas validé = 5 clients test gratuits.
Cold emails déjà draftés (1 par industrie) — chercher dans `/tmp` ou re-générer
via skill `cold-email`. Plan d'attaque :
1. Cold outreach 200 PMEs QC (LinkedIn + email)
2. Onboarding 5 beta gratuit 30j + feedback hebdo
3. Itération produit selon top 3 frictions remontées
4. Soft launch payant landing intralys.com

### Option B : Petit polish hors-tech
Aucun sprint nécessaire — projet techniquement complet pour MVP.
Voir CSP harden (Sprint 17 dédié si vraiment voulu).

### Option C : Items V2 backlog priorisés
Si Rochdi remonte une frustration produit lors de l'usage perso → traiter.
Sinon ne rien faire en attendant beta.

## 10. Quick start commands

```bash
# Setup
bun install
bun run db:setup            # schema + seed + toutes migrations

# Dev
bun run dev                  # frontend Vite localhost:5173
bun run dev:worker           # worker Wrangler localhost:8787

# Validation
bun run build               # tsc + vite build (MUST be green)
bun run test --run          # 193+ tests Vitest

# DB
bun run db:migrate          # applique migrations non jouées (idempotent)
bun run db:backup           # export D1 → SQL
```

## 11. Comptes test

| Email | Password | Rôle |
|---|---|---|
| admin@intralys.com | Intralys2026! | admin |
| mathis@example.com | managed | broker (Gatineau) |

En dev avec `DEV_BYPASS_AUTH=true`, n'importe quel email/password fonctionne.

## 12. Skills Claude disponibles utiles

- `gsd-*` (suite GSD : plan, execute, audit, debug, ship)
- `cold-email` (B2B cold outreach FR)
- `frontend-design` (UI distinctive si refresh visuel)
- `intralys-*` (skills agence Intralys — applicables aux SITES clients, pas au dashboard CRM)
- `session-handoff-intralys` (handoff Claude ↔ Antigravity)
- `claude-api` (si modifier intégration Anthropic SDK)

## 13. Premier message à Rochdi

Quand tu reprends, commence par :

1. `git log --oneline -10` pour voir où on en est
2. Lire `ROADMAP.md` "Sprint actuel"
3. Run `bun run build && bun run test --run` pour valider santé
4. Demande à Rochdi : "On en est où sur les beta clients ?"
   - Si la réponse est "0 beta" → propose GTM cold emails (Option A).
   - Si la réponse mentionne un bug ou frustration → debug-mode focus.
   - Si la réponse est ambiguë → demande ce qu'il veut attaquer ce session.

---

*Recap généré le 2026-05-13 après Sprint 16.5. Ce doc est self-contained — copie-colle dans une nouvelle conversation Claude et il aura tout le contexte.*
