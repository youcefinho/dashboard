# LOT PROACTIVE-C — Sprint C (IA proactive batch) — §6 FIGÉ

> Squelette transverse + handlers CRUD réels. Phase A SOLO (transverses owner
> unique). Calque EXACT = `scheduled-reports.ts` (seq 97) pour la capability /
> bornage tenant / cap-guard mode-agence-only, `ecommerce-rfm.ts` (seq 68) pour
> le batch cron borné par itération tenant.

## §0 audit
- `lead-predict.ts` : `computeDeterministic(env, lead)` heuristique pure (parité
  src/lib/leadPredict.ts) + `refineWithLLM` (skip si USE_MOCKS/pas de clé). Sortie
  `{probability30d 0-100, confidence, suggestedActions[], factors[]}`. Cache
  `lead_predictions`. `handleGetLeadPredict` PULL 1-lead. computeDeterministic
  réutilisable batch (mais SELECT lead doit ajouter client_id pour borner en batch).
- `scheduled()` worker.ts:883 = hooks
  `ctx.waitUntil(import('./worker/X').then(m=>m.fn(env)).then(()=>undefined).catch(()=>undefined))`
  best-effort. Précédents E7 `recomputeAllRfmSegments`/`detectAbandonedCarts` +
  scheduled-reports `processScheduledReports`.
- RFM `ecommerce-rfm.ts` : `recomputeAllRfmSegments(env)` itère
  `SELECT client_id,id FROM customers LIMIT 50` ; `deriveSegment()` produit
  at_risk/hibernating/lost = signal churn GRATUIT déterministe ;
  `getSegmentConfig(env,clientId)` seuils récence par tenant.
- `createNotification(env, userId, title, desc, icon, link, clientId)`
  (helpers.ts:163) = canal in-app existant.
- `ai.use` ∈ ALL_CAPABILITIES (capabilities.ts:48). churn/proactive ABSENT.
  seq 98 dernière → 99 libre.

## §6.A archi (tranché)
- 2 tables : `churn_scores(id, client_id, agency_id, entity_type 'lead'|'customer',
  entity_id, score INTEGER, risk_level TEXT, computed_at TEXT)` UNIQUE(client_id,
  entity_type, entity_id) + `proactive_alerts(id, client_id, agency_id, kind
  'churn'|'nba'|'summary', entity_type, entity_id, title, body, status
  'new'|'seen'|'dismissed'|'acted', created_at)`. agency_id nullable. Enums validés
  HANDLER, zéro CHECK SQL, zéro FK.
- Batch cron best-effort : bornage par ITÉRATION
  `SELECT DISTINCT client_id FROM leads LIMIT 50` → chaque tenant
  `WHERE client_id=?` partout (calque RFM). Top-N leads/tenant (ORDER BY score DESC
  LIMIT 20).
- **Churn v1 100% DÉTERMINISTE, ZÉRO LLM en batch** (contrôle coût) : customers via
  rfm_segment at_risk/hibernating + last_order_at>seuil ; leads via
  computeDeterministic (sans refineWithLLM) risk=100-probability30d + chauds
  non-contactés.
- NBA v1 règles déterministes (lead chaud non contacté→relancer, panier abandonné
  non récupéré→relance panier, client at_risk→réactiver) → 1 proactive_alert
  kind='nba'.
- Push = proactive_alert in-app + 1 createNotification récap par tenant/run
  (anti-spam, PAS 1 par alerte). PAS email/SMS auto.
- LLM = résumés kind='summary' à la DEMANDE (handler HTTP, pas cron) via
  callLLM/isAiMockMode ai.ts.
- Capability ai.use. Widget additif (pas refonte Dashboard).

## §6.B migration seq 99 (`migration-proactive-ai-seq99.sql`, depends 98)
En-tête garde-fous VERBATIM calque seq 98. Timestamps `datetime('now')`. Zéro
FK/CHECK/ALTER. 2 tables + 2 index `IF NOT EXISTS`.
Manifest : `{ "seq": 99, "file": "migration-proactive-ai-seq99.sql",
"depends_on": ["migration-multilang-out-seq98.sql"], "objects":
["table:churn_scores","table:proactive_alerts","index:churn_scores",
"index:proactive_alerts"], "risk": "low" }`.

## §6.C backend
Module NEUF `src/worker/proactive-ai.ts` :
- `runProactiveBatch(env)` STUB Phase A (no-op `return undefined`) — corps Phase B.
- `generateChurnScores(env, clientId)` / `generateNbaAlerts(env, clientId)`
  signatures figées, stubs.
- Routes worker.ts (routeProtected, gate ai.use via proactiveCapGuard mode-agence-
  only) Phase A câblées vers handlers : `GET /api/ai/proactive/alerts` (liste WHERE
  client_id, status!=dismissed par défaut) + `POST /api/ai/proactive/alerts/:id/dismiss`
  + `POST /api/ai/proactive/alerts/:id/seen`. Corps RÉELS Phase A (CRUD simple
  borné), UPDATE `WHERE id=? AND client_id=?` (meta.changes==0 ⇒ 404, zéro fuite
  cross-tenant). Bornage client_id depuis auth.
- Hook cron scheduled() :
  `ctx.waitUntil(import('./worker/proactive-ai').then(m=>m.runProactiveBatch(env)).then(()=>undefined).catch(()=>undefined));`
  (calque E7), placé après le hook scheduled-reports.

## §6.D api.ts
`getProactiveAlerts()`, `dismissProactiveAlert(id)`, `markProactiveAlertSeen(id)`.
Type `ProactiveAlert`. ApiResponse INCHANGÉ (jamais `code`).

## §6.E i18n `proactive.*` ×4
`widget_title/churn_risk/nba_relance/relance_panier/reactivate/dismiss/empty/
risk_high/risk_medium/risk_low`. 4 catalogues parité stricte (10 clés × 4).

## §6.F pages (Phase B Manager-C)
ProactiveAlertsWidget.tsx + montage conditionnel (capabilities ai.use), pas refonte
Dashboard. Pas Phase A.

## §6.G découpage
- Phase A SOLO (CE LOT) : migration+manifest + proactive-ai.ts (stubs
  runProactiveBatch/generateChurnScores/generateNbaAlerts + handlers alerts CRUD
  réels bornés) + routes worker.ts + hook cron + api.ts + i18n ×4 + doc.
- Phase B Manager-B : corps runProactiveBatch (itération tenant) +
  generateChurnScores/generateNbaAlerts déterministes (réutilise
  computeDeterministic/RFM/createNotification).
- Phase B Manager-C : ProactiveAlertsWidget.tsx + montage.

## §6.I garde-fous
Additif/CHECK59/E4-E6-jamais · cron best-effort jamais throw · **contrôle coût LLM
(zéro Claude en batch, déterministe pur)** · **bornage tenant batch (DISTINCT
client_id itéré, WHERE client_id partout, zéro fuite)** · IA agit lecture/alerte
SEULEMENT (crée scores+alerts, PAS email/SMS auto, ne mute rien d'autre) · zéro
ajout ALL_CAPABILITIES (ai.use) · ApiResponse inchangé · zéro FK · datetime('now') ·
parité i18n ×4 · jamais git.

## État Phase A (livré)
| Artefact | Fichier | État |
|---|---|---|
| Migration seq 99 | `migration-proactive-ai-seq99.sql` | livré |
| Manifest | `docs/migrations-manifest.json` (seq 99) | livré |
| Module backend | `src/worker/proactive-ai.ts` | stubs batch + handlers réels |
| Routes + cron hook | `src/worker.ts` (import + 3 routes + 1 hook) | livré |
| Client API | `src/lib/api.ts` (`ProactiveAlert` + 3 fns) | livré |
| i18n ×4 | `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` | 10 clés × 4 (parité) |

- `runProactiveBatch` = STUB no-op (`return undefined`). `generateChurnScores`
  (`{scored:0}`) / `generateNbaAlerts` (`{created:0}`) = stubs signatures figées.
- Handlers alertes = corps réels bornés `WHERE client_id = ?` (client_id ∈ auth,
  jamais body/URL). UPDATE seen/dismiss borné `id AND client_id` + 404 si changes==0.
- Cron hook best-effort `.catch(()=>undefined)` après scheduled-reports.

## IMPLEMENTATION-LOG — Phase B Manager-B (corps batch déterministe, 2026-05-21)

### Périmètre écriture (EXCLUSIF)
- `src/worker/proactive-ai.ts` — corps réels des 3 générateurs batch UNIQUEMENT
  (signatures Phase A FIGÉES : `runProactiveBatch(env): Promise<void>`,
  `generateChurnScores(env, clientId): Promise<{scored}>`,
  `generateNbaAlerts(env, clientId): Promise<{created}>`).
- `docs/LOT-PROACTIVE-C.md` — ce log.
- **ZÉRO touch** : handlers HTTP / PROACTIVE_ENUMS / resolveProactiveAgencyId /
  migration / manifest / worker.ts / api.ts / i18n / widget Manager-C /
  lead-predict.ts / ecommerce-rfm.ts / helpers.ts (tous READ-ONLY).

### Imports ajoutés (2 lignes seulement)
- `createNotification` depuis `./helpers` (réutilisé READ-ONLY, signature
  `(env, userId, title, description, icon, link, clientId)`).
- `getSegmentConfig` depuis `./ecommerce-rfm` (réutilisé READ-ONLY pour le seuil
  `recency.cold` par tenant — JAMAIS de magic number en dur).

### `runProactiveBatch(env)` — calque recomputeAllRfmSegments
- `SELECT DISTINCT client_id FROM leads WHERE client_id IS NOT NULL LIMIT 50`.
- Boucle par tenant en **try/catch isolé** (échec d'un tenant n'altère jamais le
  lot) : `generateChurnScores` puis `generateNbaAlerts`.
- Si `created > 0` → **1 seule** `createNotification` récap par tenant/run
  (anti-spam, PAS 1 par alerte), icône `sparkles`, lien `/dashboard`, vers le 1er
  user actif du tenant (`firstUserOf`, calque booking-public.ts:142). best-effort.
- **NE THROW JAMAIS** : try/catch global enveloppant + try/catch par tenant +
  try/catch notif. Retourne `undefined`.

### `generateChurnScores(env, clientId)` — DÉTERMINISTE PUR
- **Customers** : `WHERE client_id = ? AND (rfm_segment IN
  ('at_risk','hibernating','lost') OR récence > recency.cold)` LIMIT 50. Score
  déterministe = composante de récence normalisée (50..90) + bonus segment
  (lost 15 / hibernating 10 / at_risk 6), borné 0..100 → risk_level
  (≥70 high / ≥40 medium / sinon low). Branche e-comm en try/catch (table absente
  ⇒ sautée). **upsertChurnScore** = `ON CONFLICT(client_id, entity_type, entity_id)
  DO UPDATE` (entity_type='customer'), idempotent.
- **Leads** : `WHERE client_id = ? AND deleted_at IS NULL ORDER BY score DESC
  LIMIT 20`. Pour chaque → `leadProbability30d` (réplique 1:1 de
  `computeDeterministic` de lead-predict.ts, qui est **module-privé NON exporté** ;
  réplique READ-ONLY, **ZÉRO refineWithLLM**) → churn = 100 - probability30d.
  UPSERT entity_type='lead'. **ZÉRO appel Claude.**
- Retourne `{ scored }`.
- *Écart documenté* : `computeDeterministic` n'étant pas exporté par lead-predict.ts
  (et lead-predict READ-ONLY → interdit de l'exporter), la logique déterministe est
  **répliquée à l'identique** (coefficients source/status/tags, freshness exp,
  pondération 0.5/0.35/0.15). Aucun LLM dans la réplique.

### `generateNbaAlerts(env, clientId)` — règles déterministes
- **Règle 1** : leads `status='qualified'` sans activité depuis >3 j
  (`COALESCE(last_activity_at, updated_at)`) → alerte kind='nba' "Relancer {nom}".
- **Règle 2** : `carts WHERE client_id=? AND status='abandoned' AND recovered_at
  IS NULL` → kind='nba' "Relance panier" (entity_id = cart.id). Branche e-comm en
  try/catch (table carts absente ⇒ sautée).
- **Règle 3** : `churn_scores risk_level='high' AND entity_type='customer'` (jointure
  LEFT customers même tenant pour le nom) → kind='churn' "Réactiver {nom}".
- **Anti-doublon** : `alertExists(client_id, kind, entity_id, status='new')` avant
  chaque INSERT → skip si déjà présent.
- Garde-fou anti-flood : LIMIT 10 par règle/tenant/run.
- Retourne `{ created }`.

### Garde-fous tenus
- **ZÉRO LLM en batch** : aucun `fetch` Anthropic, aucun `callLLM`, aucun
  `refineWithLLM` ; `leadProbability30d` est purement arithmétique.
- **Bornage tenant strict** : `DISTINCT client_id` itéré ; `WHERE client_id = ?`
  sur leads/customers/carts/churn_scores ; UPSERT/INSERT toujours bornés ;
  jointure règle 3 doublement bornée (`cs.client_id` + `c.client_id`). client_id
  jamais issu d'un body.
- **Best-effort, jamais throw** : try/catch global + par tenant + par entité +
  par branche e-comm + anti-doublon.
- **IA lecture/alerte seulement** : écrit UNIQUEMENT churn_scores +
  proactive_alerts + 1 createNotification in-app récap. **PAS d'email, PAS de SMS,
  ne mute NI leads NI customers NI carts.**
- lead-predict.ts / ecommerce-rfm.ts / helpers.ts / handlers HTTP / widget
  Manager-C = **NON modifiés**. ApiResponse inchangé. E4-E6/CHECK59 jamais touchés.
- ZÉRO LLM en Phase A (et batch Phase B = déterministe pur par contrat §6.A/§6.I).

## IMPLEMENTATION-LOG — Phase B Manager-C (widget front, 2026-05-21)

### Périmètre écriture (EXCLUSIF)
1. `src/components/ProactiveAlertsWidget.tsx` — **NEUF**. Widget Card listant les
   alertes IA. Actions seen / dismiss UNIQUEMENT (non-métier).
2. `src/pages/Dashboard.tsx` — montage ULTRA-CIBLÉ ADDITIF (2 lignes) :
   import + `<ProactiveAlertsWidget />` inséré juste après le bloc hero, avant
   le panneau de configuration des widgets.
3. `src/index.css` — bloc sentinellé `/* === Sprint C IA proactive === */ …
   /* === Fin Sprint C === */` en fin de fichier (append-only, classes
   `proactive-*` neuves + vars de design existantes).
4. `docs/LOT-PROACTIVE-C.md` — ce log.

### ⚠️ FLAG — montage sur page R cœur (Dashboard)
Dashboard EST une page R cœur. Modif strictement **additive** (2 lignes), AUCUN
refactor, aucune logique/rendu existant touché. Le gating capability est porté
par le widget lui-même (self-hide), donc **aucun `capabilities`/auth ajouté dans
Dashboard** — surface de modif minimale.

### Widget — comportement
- Card "Suggestions de l'IA" (`proactive.widget_title`), icône Sparkles.
- `getProactiveAlerts()` au montage ; filtre les `status === 'dismissed'`.
- Par alerte : icône Lucide selon `kind` (churn→AlertTriangle, nba→Flame,
  summary→FileText, fallback Sparkles) + libellé catégorie (`churn_risk` /
  `nba_relance` / `widget_title`) + badge risque churn `<Tag>` (`risk_high`
  danger / `risk_medium` warning / `risk_low` neutral) + date + title + body.
- Actions : "Marquer lu" (`notif.mark_read`, 4 locales) → `markProactiveAlertSeen`
  (passe en `seen`, opacité réduite) ; "Ignorer" (`proactive.dismiss`) →
  `dismissProactiveAlert` optimiste (retrait + rollback + toast si erreur
  non-capability).

### Capability gating (best-effort) + self-hide
`src/lib/auth.tsx` **n'expose PAS** `capabilities` → gating best-effort calqué sur
`AiAssistantPanel` : erreur API matchant `/cap|access|forbidden|ai\.use|403/i` →
widget masqué (`return null`). Masqué AUSSI si chargement fini + 0 alerte (discret,
pas d'empty bruyant sur le Dashboard).

### i18n
- Clés Phase A câblées : `widget_title`, `churn_risk`, `nba_relance`, `dismiss`,
  `risk_high`, `risk_medium`, `risk_low`.
- Clés Phase A NON utilisées (pas de contexte retenu) : `relance_panier`,
  `reactivate`, `empty` (empty remplacé par self-hide SUBTLE).
- Clé hors-périmètre réutilisée : `notif.mark_read` (présente dans les 4 locales).
- **AUCUNE clé i18n créée. Fichiers i18n NON touchés (gelés Phase A).**

### Disjonction / garde-fous tenus
- `src/worker/*` (dont proactive-ai.ts Manager-B), `worker.ts`, `api.ts`,
  `types.ts`, migrations, i18n : **ZÉRO touch** (lecture seule pour audit).
- 5 autres pages R cœur : intouchées. Seul Dashboard reçoit 2 lignes additives.
- `ApiResponse` inchangé → détection erreur par string-match sur `error`.
- `ProactiveAlert` type figé Phase A importé tel quel.
- Actions widget = seen/dismiss SEULEMENT (jamais mutation lead/client).
- Primitives réutilisées : Card / Tag / Button / Icon / useToast. SUBTLE,
  zéro orb/glow/gradient brand.
- CSS append-only sentinellé `/* === Sprint C === */`.
- Build délégué Antigravity (VM sans bun/node) — non buildé ici.
