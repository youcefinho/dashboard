# PHASE 0 — PRÉFLIGHT CRITIQUE (2026-05-27)

> Mission RENFORCEMENT V2 DEEP. Session VM (git ✅, bun/node ❌ → build/test/i18n délégués hôte).
> Baseline : `master` @ `921d3b3` (commit de réf handoff), working tree clean.

## Statut des 4 batches

| Batch | Sujet | Faisable VM ? | Statut |
|---|---|---|---|
| 0.1 | Audit bindings wrangler | ✅ (read+grep) | **FAIT** → `docs/AUDIT-BINDINGS-2026-05-27.md` |
| 0.2 | Bundle size delta | ❌ (bun build) | **HOST-PENDING** (voir §0.2) |
| 0.3 | Migrations prod D1 | ❌ (wrangler + GO) | **HOST-PENDING + GO ROCHDI** (voir §0.3) |
| 0.4 | Tests skipped/todo | ✅ (grep+read) | **FAIT** — 1 réactivé, 4 documentés (voir §0.4) |

---

## §0.1 — Bindings (résumé)
Voir doc dédié. **Pas de blocker prod** (tout gardé). 4 bindings à déclarer après GO : `STATE_STORE`+`RATE_LIMITER` (KV, HAUTE/sécurité), `NOTIFICATION_ROOMS` (DO, classe `NotificationsRoom` déjà exportée), `WEBHOOK_QUEUE` (Queue). `AI` = vestigial, ignorer.

## §0.2 — Bundle delta (À EXÉCUTER CÔTÉ HÔTE)
```bash
cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard
bun run build 2>&1 | tee bundle-after.txt   # noter chunks > 600KB
```
Cible handoff : delta < +500KB gzip (idéal ≤ +300KB). Vu l'ampleur (~85 engines + ~105 UI), surveiller le tree-shaking : vérifier `"sideEffects": false` dans `package.json` pour que les `lib/*-engine.ts` non importés soient élagués. Livrable attendu : `docs/BUNDLE-DELTA-2026-05-27.md`.

## §0.3 — Migrations prod (GO ROCHDI OBLIGATOIRE)
- Local D1 : seq103-145 appliquées.
- **Prod D1 : seq103-135 seulement** (LOT 1-4). Manquantes en prod = **seq136-145** (LOT 5).
- ⚠️ NE PAS exécuter sans GO explicite Rochdi :
```bash
wrangler d1 execute intralys-crm --remote --command="SELECT MAX(seq) FROM _migrations"
bun run db:migrate:prod   # applique seq136-145
```
- Rappel fix connu : seq138 renomme `lesson_progress` LMS → `lms_lesson_progress` (collision seq87). Vérifier l'ordre d'application.

## §0.4 — Tests skipped/todo (5 trouvés → décisions)

| Fichier:ligne | Type | Décision | Justif |
|---|---|---|---|
| `webhooks-hmac-hardening.test.ts:147` | skip | ✅ **RÉACTIVÉ** | Skip obsolète : routes rotate/revoke ancrées (`worker.ts:4770-4791`). L'assertion cherchait `/…/rotate$` non-échappé alors que le source contient la regex littérale échappée `\/…\/rotate$`. Corrigé l'échappement + retiré `.skip`. ⚠️ À confirmer vert côté hôte. |
| `WelcomeWizard-s8.test.tsx:135` | skip | ⏸️ **GARDÉ — à réécrire (Phase 3)** | Composant `WelcomeWizard` refactoré (Sprint 47+) : le bouton final `Commencer`/`completeLabel` n'existe plus. Le test cible un flux UI disparu. Réécriture nécessaire lors de l'alignement UI (Phase 3 / Lot A), pas un simple unskip. |
| `saas-billing.test.ts:947` | todo | ⏸️ **GARDÉ — E4 flag inactif** | "LIVE wired: sk_test_ + tenant flag → stripeFetch". Voie Stripe LIVE non câblée (volontaire). Bloqué sur revue PCI + creds Rochdi. |
| `saas-billing.test.ts:948` | todo | ⏸️ **GARDÉ — E4 flag inactif** | "LIVE wired: tenant flag absent → fallback mock". Idem. |
| `saas-billing.test.ts:949` | todo | ⏸️ **GARDÉ — E4 flag inactif** | "LIVE wired: stripeFetch throw → rollback D1". Idem. |

**Note** : les 3 `.todo` saas-billing sont des **contrats futurs intentionnels** (E4 paiement = flag inactif, règle #10). Les activer = quand Manager-B câble la voie live ET creds Stripe confirmés ET revue PCI faite. NE PAS forcer.

---

## ✅ Verdict Phase 0
- **0 blocker prod bloquant** identifié.
- **2 actions GO ROCHDI** : (a) déclarer 4 bindings wrangler, (b) migrer prod seq136-145.
- **1 action hôte** : mesurer bundle delta.
- **1 patch appliqué VM** : réactivation test webhooks rotate/revoke (à valider hôte).

## Diff VM cette session (à valider hôte avant commit)
- `src/worker/__tests__/webhooks-hmac-hardening.test.ts` — unskip + fix échappement (≈5 lignes).
- `docs/AUDIT-BINDINGS-2026-05-27.md` (NEW)
- `docs/PHASE0-PREFLIGHT-2026-05-27.md` (NEW)

**Commande de validation hôte (avant commit Phase 0)** :
```bash
bun run build 2>&1 | grep "error TS" | head -5            # doit être vide
bun run test 2>&1 | grep -E "Test Files|Tests  " | tail -3 # 5273 → 5274 (+1 réactivé)
node scripts/i18n-parity-audit.cjs 2>&1 | tail -5          # 0 missing × 4 (aucune clé i18n touchée)
```
