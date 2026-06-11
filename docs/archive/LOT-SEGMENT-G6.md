# LOT G6 — Segmentation comportementale + A/B testing campagnes

Squelette posé Phase A SOLO (migration seq 90 + manifest + stubs backend +
routes worker.ts + helpers/types api.ts + i18n ×4 parité stricte + stub page +
route App.tsx). Corps réels = Phase B (Manager-B backend / Manager-C front).

---

## §0 — AUDIT DISQUE (confirmé Chaman + revérifié Phase A)

- `lead_segments` / segment marketing **ABSENT** (les hits `segment` = e-commerce
  RFM seq 68 `customer_segment_config`, sans rapport). `ab_test` / `split_test`
  **ABSENT** (hits = `product_variants` e-comm seq 58). Namespaces i18n
  `segment.*` + `abtest.*` **LIBRES** (`shop.rfm.segment*` distinct ; `campaign.*`
  existe 23 clés Sprint 5, anchor d'insertion = après `campaign.click_rate`).
- seq libre = **90** (dernière = `migration-helpdesk-seq89.sql`).
- Route App.tsx `/segments` **LIBRE** (grep confirmé : seuls `/sequences` +
  `/campaigns` existent — piège G1 écarté).
- `t` i18n s'importe `import { t } from '@/lib/i18n'` (back-compat Sprint 35),
  PAS un hook `useTranslation` — stub page calque Sequences.tsx.
- **ÉCARTS code vs gap-analysis** :
  1. `broadcasts` utilise une **Cloudflare Queue** `env.BROADCAST_QUEUE`
     (batch 50, `processBroadcastQueueJob`, `enqueueBroadcastJobs`) PAS un
     `Promise.all` naïf → l'A/B se branche dans le payload de queue +
     `enqueueBroadcastJobs`.
  2. `leads.score` EXISTE en colonne directe → critère score = simple WHERE.
  3. `message_events(event_type='open'|'click', message_id, url, ip, ua)` n'a NI
     `lead_id` NI `client_id` → jointure comportementale via `messages.lead_id` /
     `messages.campaign_id` / `messages.client_id`.
  4. `autoEnrollForTrigger` string-match strict → enrôlement-segment côté
     handler, moteur INTOUCHÉ.
  5. `Campaigns.tsx` fait déjà segmentation ad-hoc inline (à promouvoir en
     segments réutilisables — Phase C).
  - **Confirmé Phase A** : `handleEmailBroadcast` (broadcast.ts) lit son audience
    via `body` (`subject`/`body_html`/`filters`/`client_id`/`scheduled_at`/
    `throttle_per_min`) — l'extension api.ts `sendBroadcast` ajoute `segment_id?`
    + `variants?` au même body object. Garde admin = `auth.role !== 'admin'`.

---

## §6.A — ARCHITECTURE (tranché)

- **Q1 segment DYNAMIQUE recompute-on-read + cache** : `lead_segments.criteria_json`
  + `cached_count`/`cached_at`, ZÉRO table de membres matérialisée.
- **Q2 critères v1 AND-only** : status IN, source IN, score (gte/lte/eq sur
  `leads.score`), tags_in / tags_not_in (EXISTS lead_tags), created_at range,
  last_activity range, **comportemental** opened_campaign / clicked_campaign /
  not_opened / not_clicked (broadcast_id + within_days, via EXISTS messages JOIN
  message_events), in_sequence (EXISTS workflow_enrollments active). Combinateur
  AND strict (OR = v2).
- **Q3 A/B v1** : subject + contenu (template), 2-N variantes, split fixe
  pondéré sur 100 % audience, gagnant MANUEL + reporting open/click par variante.
  send-time A/B = v2.
- **Q4** : table `broadcast_variants` + garde additive `if (ab_test_enabled)`,
  PAS de table ab_campaigns séparée. Réutilise broadcast.ts ~85 %.
- **Q5 recompute ON-DEMAND v1** (zéro nouveau scheduler).
- **Q6 wiring** : (a) segment = cible broadcast (sendBroadcast accepte
  segment_id) OUI v1 ; (b) enrôlement workflow en masse via
  `POST /api/segments/:id/enroll` qui itère + appelle `handleEnrollLead`
  EXISTANT (moteur intouché).
- **Q7 capability** : `workflows.manage` réutilisée, ZÉRO ajout `ALL_CAPABILITIES`.
- Modèle data :
  - `lead_segments(id, client_id, agency_id, name, criteria_json, cached_count,
    cached_at, created_by, created_at, updated_at)` ;
  - `broadcast_variants(id, broadcast_id, label, subject, template_id, body_html,
    body_text, split_pct, sent, opened, clicked, created_at)` ;
  - `broadcasts += ab_test_enabled INTEGER DEFAULT 0, winning_variant_id TEXT,
    segment_id TEXT` ;
  - `messages += campaign_variant_id TEXT` (Option A tranchée : reporting par
    variante via colonne sur messages, pas de table de jointure dédiée).
- **ApiResponse / apiFetch GELÉS** : retours `{ data }` / `{ error }`, JAMAIS
  `code`. Discrimination erreur = présence `res.data` / texte `res.error`.

---

## §6.B — MIGRATION seq 90 (`migration-segment-abtest-seq90.sql`, depends 89)

- En-tête garde-fous calque seq 89/seq 86. **Conventions de type calquées sur
  broadcasts/messages** = `id TEXT PK`, timestamps `TEXT DEFAULT
  (datetime('now'))` — PAS unixepoch (≠ seq 89 helpdesk ; confirmé sur
  `migration-emailseq-seq86.sql`).
- Mention explicite en-tête : "CHECK status broadcasts seq 24
  `IN ('queued','processing','completed','failed')` INTOUCHABLE — A/B et
  segment_id n'ajoutent AUCUNE valeur de statut neuve".
- 2 `CREATE TABLE IF NOT EXISTS` (lead_segments, broadcast_variants) + 4
  `ALTER TABLE ADD COLUMN` (broadcasts ×3, messages ×1) + 2 index.
- Les 4 ALTER ADD COLUMN sont ADDITIFS nullable/DEFAULT (rétro-compat
  byte-identique : `ab_test_enabled=0` → chemin legacy ; `campaign_variant_id`
  NULL → legacy). Tolérance "duplicate column" best-effort documentée.
- Manifest seq 90 : `{ "seq": 90, "file": "migration-segment-abtest-seq90.sql",
  "depends_on": ["migration-helpdesk-seq89.sql"], "objects": ["table:lead_segments",
  "table:broadcast_variants","alter:broadcasts","alter:messages","index:lead_segments",
  "index:broadcast_variants"], "risk": "low" }`.

---

## §6.C — ROUTES worker.ts (anti-shadowing : sous-routes AVANT /:id)

PROTÉGÉ (garde `workflows.manage` mode-agence-only calque funnels/sequences,
bornage client_id calque sequences.ts) :

- `GET    /api/segments`            → handleGetSegments (lecture pure, pas de capGuard)
- `POST   /api/segments`            → handleCreateSegment (capGuard)
- `POST   /api/segments/preview`    → handlePreviewSegment (**AVANT** /:id — match
  literal string `'/api/segments/preview'` placé avant le regex `segMatch`)
- `GET    /api/segments/:id`        → handleGetSegment
- `PUT    /api/segments/:id`        → handleUpdateSegment
- `DELETE /api/segments/:id`        → handleDeleteSegment
- `POST   /api/segments/:id/enroll` → handleEnrollSegment (regex `/enroll$` avant `segMatch`)
- `GET    /api/broadcasts/:id/variants` → handleGetVariants (regex `/variants$`
  **AVANT** `/^\/api\/broadcasts\/([^/]+)$/` existant)
- `POST   /api/broadcasts/:id/variants` → handleSetVariants

---

## §6.D — API helpers (api.ts) — ApiResponse INCHANGÉ jamais code

- Types : `LeadSegment`, `SegmentCriteria` (status?/source?/score?{op,value}/
  tags_in?/tags_not_in?/created_after?/created_before?/last_activity_after?/
  last_activity_before?/opened_campaign?{broadcast_id,within_days?,negate?}/
  clicked_campaign?/in_sequence?), `BroadcastVariant`.
- Helpers : `getSegments()`, `getSegment(id)`, `createSegment({name,criteria,
  client_id?})`, `updateSegment(id,partial)`, `deleteSegment(id)`,
  `previewSegment(criteria,client_id?)`, `enrollSegment(id,workflow_id)`,
  `getBroadcastVariants(broadcastId)`, `setBroadcastVariants(broadcastId,variants)`.
- **Extension ADDITIVE `sendBroadcast`** : `segment_id?` + `variants?` ajoutés au
  param object existant (absents → comportement Sprint 5 byte-identique).
  apiFetch/ApiResponse GELÉS.

---

## §6.E — i18n `segment.*` (30 clés) + `abtest.*` (13 clés) ×4 — parité STRICTE

- 43 clés × 4 catalogues = **172 occurrences** (vérifié grep). Ordre fr-CA →
  fr-FR → en → es, anchor après `campaign.click_rate`.
- `segment.*` : title/subtitle/new/empty_title/empty_desc/name/criteria/
  members_count/recompute/recompute_ok/save/delete/confirm_delete +
  crit.status/crit.source/crit.score/crit.score_gte/crit.tags_in/crit.tags_not_in/
  crit.created_range/crit.activity_range/crit.opened/crit.clicked/crit.not_opened/
  crit.not_clicked/crit.in_sequence/crit.within_days + use_as_target/enroll_in/
  enroll_ok.
- `abtest.*` : enable/variant/variant_add/variant_remove/label/split_pct/
  split_total_err/winner/winner_mark/results/open_rate/click_rate/recipients.
- ZÉRO collision : `shop.rfm.segment*` distinct, `campaign.*` réutilisé (pas de
  nouveau namespace), AUCUN `seg.*` (réservé Sequences `seq.*`). Vocabulaire
  calqué langue (fr-CA tutoiement/courriel, fr-FR vouvoiement/e-mail).

---

## §6.F — PAGES (App.tsx)

- `Segments.tsx` NEUF (stub Phase A — composant minimal, export FIGÉ
  `SegmentsPage`) → route NEUVE `/segments` (LazyGuard) ajoutée (import lazy +
  route + routeTree). `/segments` LIBRE confirmé (piège G1 écarté).
- `Campaigns.tsx` ÉTENDU = Phase C Manager-C (PAS Phase A).
- 6 pages R EXCLUES.

---

## §6.G — DÉCOUPAGE

- **Phase A SOLO (FAIT)** : migration seq 90 + manifest + stubs
  `src/worker/segments.ts` (9 handlers signatures figées + helpers
  capGuard/scopeClientId + corps placeholder `{success/data}` ou
  `json({error:'stub'},501)`) + routes worker.ts (segments + broadcast variants
  câblées) + api.ts helpers/types + extension sendBroadcast + i18n ×4 + stub
  page Segments.tsx + route App.tsx + ce doc §6 verbatim.
- **Phase B Manager-B (backend exclusif)** : corps `segments.ts` (CRUD + builder
  query critères AND + 4 sous-requêtes EXISTS comportementales + preview +
  enroll) + modifs CIBLÉES `broadcast.ts` (partition variante dans
  `enqueueBroadcastJobs` + branche `if (ab_test_enabled)` + `campaign_variant_id`
  INSERT + résolution segment_id→leads).
- **Phase C Manager-C (front exclusif)** : `Segments.tsx` réel (liste + builder
  critères + preview live) + `Campaigns.tsx` extension (cible segment + toggle
  A/B + variantes + reporting par variante).

---

## §6.H — DISJONCTION

- Exclusifs B : `src/worker/segments.ts` (neuf), `broadcast.ts` (modifs A/B
  additives).
- Exclusifs C : `src/pages/Segments.tsx` (neuf), `src/pages/Campaigns.tsx`
  (extension).
- PARTAGÉS Phase B/C = **ZÉRO** (worker.ts / api.ts / App.tsx / i18n / migration
  FIGÉS Phase A).
- READ-ONLY Phase B : `workflows.ts` (moteur — APPELÉ jamais modifié),
  `tracking.ts`, `email-blocks.ts`, `sequences.ts`, `capabilities.ts`, le moteur
  d'envoi broadcast legacy (chemin `ab_test_enabled=0` byte-identique).

---

## §6.I — GARDE-FOUS

Additif strict · CHECK status broadcasts seq 24 INTOUCHABLE · CHECK role seq 59
intouché · E4/E6 jamais touchées · `customer_segment_config` seq 68 RFM intouchée ·
6 pages R + workflows @xyflow exclues · i18n 4 catalogues parité avant usage ·
SPA pas SSR · ZÉRO ajout ALL_CAPABILITIES · ApiResponse inchangé jamais code ·
ZÉRO FK (jointures applicatives) · moteur workflow READ-ONLY · jamais git config.

---

## 🚩 FLAGS RÉGRESSION (pour Phase B Manager-B — broadcast.ts)

- **FLAG-1** : partition A/B dans `enqueueBroadcastJobs` ; le chemin
  `ab_test_enabled=0` DOIT produire un payload de queue **bit-identique
  Sprint 5** (mêmes champs : broadcastId/subject/htmlContent/textContent/clientId/
  authUserId/leads/origin/throttlePerMin — n'ajouter `variantId` qu'en branche
  A/B active).
- **FLAG-2** : `runDueScheduledBroadcasts` (cron) ré-applique le split à
  l'échéance ; le `.catch` best-effort EXISTANT est conservé, **JAMAIS de throw**
  (sinon casse le scheduled() E7 / processWorkflowQueue).
- **FLAG-3 (CROSS-TENANT)** : les critères comportementaux qui JOIN `messages`
  DOIVENT injecter `AND m.client_id = ?` ; **refuser** opened/clicked_campaign si
  `client_id` absent en mode agence (calque la garde `tags` de broadcast.ts:78
  qui exige client_id).

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-20)

Fichiers **créés** :
- `migration-segment-abtest-seq90.sql` (2 tables + 4 ALTER + 2 index, conventions
  TEXT datetime calquées broadcasts/messages).
- `src/worker/segments.ts` (9 handlers stubs + helpers `capGuard`
  (`workflows.manage`) / `scopeClientId` exporté ; corps placeholder).
- `src/pages/Segments.tsx` (stub, export `SegmentsPage`, i18n `t('segment.*')`).
- `docs/LOT-SEGMENT-G6.md` (ce fichier).

Fichiers **modifiés** :
- `docs/migrations-manifest.json` (+ entrée seq 90).
- `src/worker.ts` (import segments.ts + routes segments (preview avant /:id,
  /enroll avant /:id) + routes broadcast variants (`/variants$` avant le match
  générique `/api/broadcasts/:id`)).
- `src/lib/api.ts` (types `SegmentCriteria`/`LeadSegment`/`BroadcastVariant` + 9
  helpers + extension ADDITIVE `sendBroadcast` `segment_id?`/`variants?`).
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (+ 43 clés chacun, parité 172 totale).
- `src/App.tsx` (lazy `SegmentsPage` + `segmentsRoute` `/segments` + routeTree).

Confirmations garde-fous :
- 6 pages R / E4-E6 / CHECK role seq 59 / CHECK status broadcasts seq 24 /
  `customer_segment_config` seq 68 : **INTOUCHÉS**.
- `/segments` route **sans collision** (piège G1 écarté).
- ZÉRO ajout `ALL_CAPABILITIES` (réutilise `workflows.manage`).
- ApiResponse / apiFetch **GELÉS** (jamais `code`).
- Aucune commande git/bun exécutée. **Build délégué Antigravity** (VMware sans
  bun/node).

---

## IMPLEMENTATION-LOG — Phase B Manager-C (front exclusif, 2026-05-20)

Fichiers **modifiés** (3) :
- `src/pages/Segments.tsx` — STUB → CORPS RÉEL : liste segments (cards
  cached_count + cached_at + recompute/criteria/enroll/delete) + **builder de
  critères** dans un `SlidePanel` (size lg) : status (FilterChip), source
  (FilterChip), score (Switch + Select op gte/lte/eq + Input), tags_in/tags_not_in
  (FilterChip ×2), created_range (2× Input date), activity_range (2× Input date),
  comportemental opened/not_opened/clicked/not_clicked (Select kind + Select
  broadcast + Input within_days), in_sequence (Select any/in/not_in). **Aperçu
  live débounce 450 ms** (`previewSegment(criteria)` → count footer + sample 8
  premiers). Save via create/update, recompute via getSegment (relit
  cached_count), delete via `useConfirm`, enroll masse via second SlidePanel
  (Select workflow `getWorkflows`). Helpers : `builderToCriteria` /
  `criteriaToBuilder` (round-trip édition).
- `src/pages/Campaigns.tsx` — EXTENSION A/B (Sprint 5 préservé) :
  - **Cible segment** : FilterChip toggle filters/segment (affiché seulement si
    segments existent) → Select segments ; passe `segment_id` à sendBroadcast
    (segment et filters mutuellement exclusifs dans le payload).
  - **A/B testing** : Switch `abtest.enable` → éditeur de variantes (2-N) :
    label/subject/template/split_pct + add/remove + **validation somme = 100 %**
    (`splitValid` désactive Send + message `abtest.split_total_err`).
  - **Submit A/B** : `sendBroadcast({ variants })` puis `setBroadcastVariants(
    broadcastId, variants)` si l'API renvoie un id (idempotent).
  - **Reporting** : composant `<VariantReport>` (lazy `getBroadcastVariants` au
    montage) — tableau variante × recipients/open_rate/click_rate + badge gagnant
    dérivé du meilleur taux clic (read-only, winner_mark non exposé API Phase A).
  - Badge `A/B` (Tag brand) sur les cards d'historique `ab_test_enabled`.
- `src/index.css` — append bloc `/* === LOT G6 Segmentation + A/B === */`
  (Stripe-sober, prefers-reduced-motion) : `.segment-card`/.segment-builder/
  .segment-preview-foot/.segment-sample + `.abtest-report`/.abtest-table/
  .abtest-winner-row/.abtest-editor.

Check i18n : 100 % clés Phase A câblées (`t('segment.*')` + `t('abtest.*')` +
`t('campaign.*')` réutilisé). **1 écart tracé** : `segment.crit.not_in`
n'existe PAS au catalogue Phase A → fallback inline `|| 'Hors séquence'`
(i18n NON touché, conforme consigne).

Check préservation Sprint 5 : broadcast SANS A/B (variants absent) + SANS segment
(targetMode='filters' par défaut) ⇒ payload sendBroadcast **byte-identique
Sprint 5** (filters + scheduled_at + throttle_per_min uniquement).

Écarts CODE > brief (props UI réelles) :
- Builder + enroll en `SlidePanel` (pas Modal) — calque la primitive panel ;
  footer sticky pour aperçu live + actions.
- recompute = relit `getSegment` (le serveur recalcule cached_count à la
  lecture, §6.A Q5 recompute-on-read) — pas d'endpoint recompute dédié.
- Tag n'a pas de variant `primary` (enum `brand|success|warning|danger|info|
  neutral|accent|default`) → badge A/B = `brand`, gagnant = `success`.

Check disjonction : ZÉRO modification de `segments.ts` / `broadcast.ts` /
`worker.ts` / `api.ts` / i18n×4 / migration seq90 / manifest / `App.tsx` /
6 pages R. Aucune commande git/bun. **Build délégué Antigravity** (VMware sans
bun/node).

---

## IMPLEMENTATION-LOG — Phase B Manager-B (backend) — 2026-05-20

Fichiers **modifiés** (2 + ce doc) :
- `src/worker/segments.ts` — 9 stubs → CORPS RÉELS + helpers neufs.
- `src/worker/broadcast.ts` — modifs A/B CIBLÉES ADDITIVES (segment_id→leads +
  partition variante + campaign_variant_id + reporting par variante + cron).

### `segments.ts` — handlers/fonctions écrits
- **`buildSegmentQuery(criteria, clientId, selectCols?)`** EXPORTÉ (le cœur) :
  AND strict. status IN / source IN / score (gte|lte|eq sur `leads.score`) /
  created_at range / **`last_activity_at`** range (colonne RÉELLE confirmée
  `migration-sprint2-phase1.sql:14`, ≠ `last_activity` du brief) / tags_in EXISTS
  lead_tags / tags_not_in NOT EXISTS / comportemental opened/clicked + negate +
  not_opened/not_clicked (EXISTS messages JOIN message_events) / in_sequence
  (EXISTS workflow_enrollments active).
- **`validateBehavioralBornage`** : FLAG-3 — refus 400 d'un critère comportemental
  si mode agence sans client_id réel.
- **`resolveSegmentLeads`** / **`loadSegmentInTenant`** / **`parseCriteria`** + type
  `SegmentCriteria` exportés.
- `handleGetSegments` (lecture pure, bornage client_id, ORDER updated_at DESC) ·
  `handleCreateSegment` (capGuard + FLAG-3 + cached_count initial + agency_id) ·
  `handlePreviewSegment` (capGuard, count+sample 20, ZÉRO persistance) ·
  `handleGetSegment` (404 tenant, **recompute-on-read** + sample 20) ·
  `handleUpdateSegment` (404, UPDATE name/criteria + recompute, FLAG-3) ·
  `handleDeleteSegment` (404, DELETE) ·
  `handleEnrollSegment` (404, builder → **`autoEnroll` EXISTANT** par lead,
  best-effort try/catch, `{enrolled}` — moteur INTOUCHÉ) ·
  `handleGetVariants` (admin, reporting open/click recalculé via
  `messages.campaign_variant_id` JOIN message_events) ·
  `handleSetVariants` (admin+capGuard, somme split_pct=100→400, DELETE+re-INSERT,
  pose `ab_test_enabled`).

### `broadcast.ts` — modifs A/B
- **Résolution `segment_id`→leads** dans `handleEmailBroadcast` (branche `if
  (body.segment_id)`) : charge segment, `buildSegmentQuery` borné client_id DU
  SEGMENT (FLAG-3) + email valide + DND email (parité legacy). `segment_id`
  persisté à l'INSERT broadcasts. ABSENT ⇒ filters legacy byte-identique.
- **`enqueueBroadcastJobs`** : charge `broadcast_variants` (best-effort, erreur ⇒
  legacy). AUCUNE variante ⇒ **payload bit-identique Sprint 5** (9 champs, PAS de
  variantId). Variantes ⇒ partition DÉTERMINISTE par split_pct (seuils cumulés +
  reste d'arrondi aux premières variantes split>0), chaque batch porte
  subject/html/text de SA variante + `variantId`.
- **`processBroadcastQueueJob`** : `campaign_variant_id` (NULL legacy) ajouté aux
  2 INSERT messages (mock+Resend) + incrément best-effort `broadcast_variants.sent`
  par variante.
- **`runDueScheduledBroadcasts`** (cron) : SELECT enrichi `segment_id` + branche
  segment→leads à l'échéance (FLAG-3 borné). Partition A/B AUTOMATIQUE (via
  enqueueBroadcastJobs). `.catch` best-effort CONSERVÉ, ZÉRO throw ajouté (FLAG-2).

### Écarts CODE > brief
- **Bornage tenant = `client_id` simple** (pas `accessibleClientIds`/`IN`) :
  modules voisins (sequences/broadcast) bornent par un client_id UNIQUE via
  `scopeClientId`. On calque le CODE (byte-équivalent), pas le brief. FLAG-3
  garanti par le client_id DU SEGMENT injecté dans les JOIN messages.
- **Colonne activité = `last_activity_at`** (brief proposait plusieurs noms à
  vérifier — confirmé `last_activity_at`).
- **Enroll délègue à `autoEnroll`** (pas `handleEnrollLead`) : primitive interne
  idempotente best-effort void, idéale pour boucle de masse ; `handleEnrollLead`
  est le handler HTTP (parse request/Response). Moteur INTOUCHÉ.
- **DND email respecté aussi en ciblage segment** (ajouté côté broadcast.ts dans
  la sous-requête `guarded`, le builder ne pose pas DND).
- **`in_sequence` aligné sur le contrat wire api.ts gelé = `boolean`** (true ⇒
  enrôlé dans UNE séquence active quelconque / false ⇒ aucune). Le brief décrivait
  `{workflow_id}` ; on supporte les DEUX (boolean prioritaire = contrat front,
  objet `{workflow_id}` toléré défensivement). De même `not_opened/not_clicked`
  acceptés EN PLUS de `opened_campaign.negate` (api.ts n'expose que negate).

### Checks régression
- **stubs Phase A** : grep `stub`/`501` dans segments.ts = **0**.
- **FLAG-1** : `enqueueBroadcastJobs` retourne le chemin legacy AVANT toute logique
  A/B ⇒ payload bit-identique Sprint 5 (sans variantId) ; `campaign_variant_id`
  = NULL à l'INSERT (job.variantId undefined). **VÉRIFIÉ.**
- **FLAG-3** : critères comportementaux injectent `AND m.client_id = ?` (segment) ;
  `validateBehavioralBornage` REFUSE 400 si mode agence sans client_id ; builder
  IGNORE le critère si clientId null (sûr). **VÉRIFIÉ.**
- **Rétro-compat** : broadcast sans segment_id ET sans variants = Sprint 5
  byte-identique (else filters + chemin legacy enqueue intacts).
- **Moteur workflow INTOUCHÉ** : enroll délègue à `autoEnroll`, ZÉRO modif
  processWorkflowQueue/advanceEnrollment/executeStep/autoEnrollForTrigger.
- **Import acyclique** : broadcast.ts → segments.ts → workflows.ts (leaf) ;
  workflows.ts n'importe ni broadcast.ts ni segments.ts. ZÉRO cycle.
- **CHECK status seq 24 / CHECK seq 59 / E4-E6 / 6 pages R / @xyflow / i18n /
  migration / worker.ts / api.ts / App.tsx / fichiers Manager-C** : INTOUCHÉS.
- Aucune commande git/bun. **Build délégué Antigravity** (VMware sans bun/node).
