# NEXT STEPS — Post-compact quick reference (mis à jour 2026-05-26 FINAL)

> Doc condensée pour reprise rapide après compact. Voir `HANDOFF-2026-05-26.md` pour détails complets.

## 🎯 État actuel — TOUT GREEN — Renforcement A-Z COMPLET

- ✅ **0 erreur TS** (build clean ~1s)
- ✅ **5273/5273 tests pass** (253 fichiers, 0 fail vs initial 1715/74 fails)
- ✅ **i18n 6407 keys** parité STRICT 4 catalogues (vs 5791 initial)
- ✅ **Migrations seq103-145** toutes appliquées local D1
- ✅ **~85 engines purs** (lib/*-engine.ts) — validation stricte + error codes + edge cases + mocks réalistes
- ✅ **~11 handlers câblés** sur engines (Loi 25 PII scrub + XSS + rate-limit + HMAC + anti-replay)
- ✅ **~105 UI components/pages** renforcés (27 LOT 5 + 78 LOT 1-3) loading/empty/error/a11y/i18n/confirm

## ⏳ Reste à faire

### 1. Smoke visuel (30 min)
```bash
cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard
bun run dev          # Vite 5173
bun run dev:worker   # wrangler 8787
```

Ouvrir `http://localhost:5173` et tester :

| Route | Module |
|---|---|
| `/settings/voice-agent` | S41 AI Voice Agent |
| `/settings/chat-bot` | S42 AI Chat Agent |
| `/lms` | S43 Courses LMS |
| `/funnels` | S44 Funnels Builder |
| `/community` | S45 Community forum |
| `/b2b` | S48 B2B + Bundles + Pre-orders |
| `/warehouse` | S47 Multi-warehouse + Dropshipping |
| `/affiliates` | S49 Affiliates + Payouts |
| `/settings/surveys-and-dns` | S50 Surveys + DNS custom domains |

S46 Subscriptions adv : composants `<SubscriptionAdvancedActions />` + `<MrrDashboard />` à monter dans page billing existante.

### 2. Commit + push prod LOT 5 (après GO user)

```bash
git status                    # Voir l'ampleur (énorme : engines + UI + handlers + i18n)
git add .
git commit -m "feat(lot5+lot4): renforcement massif engines/handlers/UI + parité i18n stricte"
# Push prod main Rochdi seulement après validation visuelle
```

### 3. Activations flags (quand credentials disponibles)

| Priorité | Env var | Module |
|---|---|---|
| Haute | `OPENAI_API_KEY` | S42 chat bot RAG (embeddings + completion) |
| Moyenne | `CLOUDFLARE_API_TOKEN` | S50 DNS records sync + provision SaaS |
| Basse | `STRIPE_CONNECT_*` | S49 affiliate payouts |
| Basse | `STRIPE_TERMINAL_*` | S37 POS card terminal |
| Basse | `ELEVENLABS_API_KEY` | S41 TTS voix premium |
| Basse | `TURNSTILE_SECRET` | S36 widget anti-bot |

## 📊 Bilan session 2026-05-26 (renforcement)

| Avant | Après |
|---|---|
| TS 120+ errors | **0** |
| 1715 tests pass / 74 fails | **2656 pass / 0 fail** |
| 5791 i18n keys | **5973** parité STRICT |
| Engines 3250 lignes | **7389+1500** lignes (LOT 5 + LOT 4 extraits) |

Détails complets dans `HANDOFF-2026-05-26.md`.

## 🔍 Scripts utiles

- `scripts/i18n-parity-audit.cjs` — vérifie parité STRICT 4 catalogues (utilise `node scripts/i18n-parity-audit.cjs`)
- `bun run db:migrate` — applique migrations sur D1 local (idempotent)
- `bun run test` — vitest run (1838ms typique full suite)
- `bun run build` — tsc + vite build (~1s)

## 🚫 Si reprise — règles strictes

- **100% additif** sur le code existant (pas de DROP/RENAME)
- **Capabilities figées seq80** (12 caps, JAMAIS ajouter)
- **i18n parité STRICT** (utiliser `scripts/i18n-parity-audit.cjs` avant commit si ajout clés)
- **Imports worker RELATIFS** (jamais `@/` côté worker)
- **`json({data})` / `json({error}, status)`** — pas de champ `code` top-level
- **Anti-throttle agents** : MAX 4-5 simultanés (sinon stuck silencieux)
- **Engines purs** (lib/*-engine.ts) = zéro side-effect

## 📚 Docs de référence

- `HANDOFF-2026-05-26.md` — état complet détaillé (CETTE SESSION renforcement)
- `HANDOFF-2026-05-25.md` — handoff précédent (LOT 5 livraison initiale)
- `GIGA-PLAN-LOT5-SPRINTS-41-50.md` — méta-plan + récap final
- `LOT-*-S41.md` à `LOT-*-S50.md` — 10 docs contrat §6 par sprint
- `CHANGELOG.md` — entrées chronologiques tous sprints (root projet, pas docs/)
