# LOT — Sprint 50 : Surveys avancés + DNS records UI (LOT 5 FIN)

> Doc contrat §6 figé. Migration : seq145 — `migration-surveys-dns-seq145.sql`.
> **DERNIER LOT du PROGRAMME GIGA-PLAN.** Compagnons : `LOT-FORMS-XL-S5.md`
> (forms single-step lead capture seq106), `LOT-AFFILIATES-S49.md` (LOT 5
> précédent seq144), `GIGA-PLAN-LOT5-SPRINTS-41-50.md` (roadmap macro).

## Objectif

Livrer en parallèle deux modules indépendants pour boucler la roadmap V1 :

1. **Surveys avancés** — questionnaires multi-pages avec branching logic
   conditionnel, NPS scores (-100..+100), CSAT (Customer Satisfaction),
   types de questions variés. DISTINCT du module Forms (S5, seq106)
   single-step capture lead. Les surveys sont des questionnaires
   d'engagement post-vente / mesure de satisfaction.
2. **Custom domains + DNS records UI** — white-label complet par client via
   Cloudflare for SaaS (zone + SSL + records). Flag Cloudflare API INACTIF
   V1 (corps Phase B). UI Phase A câblée pour gérer la table même sans
   provisioning réel.

## Distinction critique Forms (S5) / Surveys (S50)

| Aspect | Forms S5 (`seq106`) | Surveys S50 (`seq145`) |
|---|---|---|
| Objectif | Capture de lead unique (form embed) | Questionnaire d'engagement multi-réponses |
| Étapes | Single-step (1 page submit) | Multi-pages + branching conditionnel |
| Types | Champs lead (name/email/phone/textarea) | Question types (text/multiple_choice/rating/nps/csat/date) |
| Analytics | form_submissions count | NPS aggregates rolling + CSAT moyenne + completion rate |
| Cap | `forms.manage` | `settings.manage` (escalade — sensible UX visiteur) |
| PUBLIC | POST /api/public/forms/:id/submit | POST /api/public/surveys/:id/submit |

## Distinction critique S94 whitelabel / S50 custom domains

| Aspect | S(G3) seq94 sub-accounts | Sprint 50 seq145 custom-domains |
|---|---|---|
| Storage | Colonne `clients.custom_domain` (1/client) | Table dédiée `custom_domains` (N/client) |
| DNS | Aucun (binding manuel) | Table `dns_records` + sync Cloudflare for SaaS |
| SSL | Manuel (admin pose cert) | Provisioning auto Cloudflare for SaaS (flag INACTIF V1) |
| Verify | Aucun | TXT `_intralys-verify.<domain>` |

## §6 — RÈGLES FIGÉES (PHASE A SOLO)

### §6.A — Migration

- **100 % STRICTEMENT ADDITIF**. 8 `CREATE TABLE IF NOT EXISTS` + 9
  `CREATE INDEX IF NOT EXISTS`. AUCUN `ALTER TABLE` (aucune table existante
  touchée).
- AUCUNE FK SQL. Jointures applicatives par TEXT (calque seq144 / seq143 /
  seq92). AUCUN CHECK SQL. AUCUN DROP / RENAME / rebuild.
- Enums validés HANDLER uniquement :
  - `surveys.type` ∈ `survey-engine.SURVEY_TYPES`
  - `survey_questions.type` ∈ `survey-engine.QUESTION_TYPES`
  - `survey_responses.status` ∈ `survey-engine.RESPONSE_STATUSES`
  - `custom_domains.status` ∈ `dns-engine.DOMAIN_STATUSES`
  - `custom_domains.ssl_status` ∈ `dns-engine.SSL_STATUSES`
  - `dns_records.type` ∈ `dns-engine.DNS_RECORD_TYPES`

### §6.B — Imports

- **RELATIFS uniquement** (`./types`, `../helpers`, `../types`). Pas
  d'alias `@/...` côté worker.
- Engines (`lib/survey-engine.ts`, `lib/dns-engine.ts`) : imports relatifs
  `from '../types'`.

### §6.C — Capabilities (FIGÉES — AUCUN ajout ALL_CAPABILITIES seq80)

- `settings.manage` : Surveys CRUD + questions + branches + responses
  list/detail + NPS aggregates, Custom domains CRUD + verify + DNS records
  CRUD + sync.
- **PUBLIC (pré-requireAuth)** :
  - POST `/api/public/surveys/:id/submit` — rate-limit `survey_submit:<ip>`
    10/3600s (calque /api/public/affiliates/track-click +
    /api/public/preorders) + honeypot champ `website` HANDLER + PII Loi 25
    (ip_hash SHA256, pas brut).

### §6.D — Anti-shadowing routes (worker.ts)

- Surveys : sous-routes AVANT `/surveys/:id` générique
  - `/surveys/:id/publish` POST
  - `/surveys/:id/questions` GET / POST
  - `/surveys/:id/responses` GET
  - `/surveys/:id/nps` GET (?period_days=30|60|90)
- Survey-questions : `/survey-questions/:id/branches` AVANT
  `/survey-questions/:id`
- Custom-domains : sous-routes AVANT `/custom-domains/:id` générique
  - `/custom-domains/:id/verify` POST
  - `/custom-domains/:id/dns-records` GET / POST

### §6.E — Bornage tenant

- Pattern `loadSurveyInTenant` / `loadDomainInTenant` (calque
  `affiliates.ts:loadAffiliateInTenant`). Legacy → row ; mode agence →
  borne `client_id ∈ accessibleClientIds OU agency_id == tenant.agencyId`,
  sinon 404 propre.
- `survey_responses.client_id` DÉNORM (defense-in-depth IDOR — bornage
  rapide sans jointure surveys).
- `nps_aggregates.client_id` DÉNORM (idem).

### §6.F — Cloudflare for SaaS (FLAG INACTIF V1)

- `env.CLOUDFLARE_API_TOKEN` absent ⇒ `provisionCloudflareForSaas()` retourne
  `{ zone_id: null, ssl_status: 'pending' }` sans appel réseau.
- `syncDnsRecords()` retourne `{ synced: 0, reason: 'phase-a-stub' }` sans
  appel réseau.
- L'UI affiche `pending` + instructions DNS manuelles client (TXT
  verification + CNAME app). Phase B Manager-B câblera l'API réelle
  (cloudflare/sdk ou fetch direct vers `api.cloudflare.com/v4/zones`).

### §6.G — i18n parité STRICTE 4 catalogues

- 30 clés au total (15 `surveys.*` + 15 `dns.*`).
- 4 catalogues : `en.json`, `fr-CA.json`, `fr-FR.json`, `es.json`.
- Parité STRICTE : 30 clés / 30 clés / 30 clés / 30 clés. JAMAIS de clé
  présente dans un seul catalogue.

### §6.H — Engines (signatures FIGÉES Phase A)

- `survey-engine.ts` :
  - `resolveNextQuestion(env, questionId, answer): Promise<{ nextId, jumpToEnd }>`
  - `computeNpsScore(promoters, passives, detractors): number` (pure)
  - `aggregateNpsForPeriod(env, surveyId, periodDays): Promise<NpsAggregateResult>`
- `dns-engine.ts` :
  - `normalizeDomain(domain): string` (pure)
  - `verifyDomainOwnership(env, domain, token): Promise<{ verified, reason }>`
  - `provisionCloudflareForSaas(env, domain): Promise<{ zone_id, ssl_status }>`
  - `syncDnsRecords(env, domainId): Promise<{ synced, reason }>`

### §6.I — Réponses HTTP

- `json({ data })` succès / `json({ error }, status)` erreur. JAMAIS de
  champ `code` (apiFetch / ApiResponse GELÉS).
- Best-effort total : DB indisponible / table absente ⇒ `{ data: [] }` ou
  404 propre, JAMAIS de 500 non maîtrisé.

### §6.J — PUBLIC submit anti-bot

- Rate-limit `survey_submit:<ip>` 10/3600s (calque
  /api/public/affiliates/track-click + /api/public/preorders).
- Honeypot champ `website` HANDLER (présent + non vide ⇒ 200 silencieux
  fake).
- PII Loi 25 : `ip_hash` SHA256, jamais l'IP brute. `respondent_email` /
  `respondent_name` OPT-IN HANDLER (anonyme par défaut si absent du
  payload).
- `partial=true` ⇒ accumule answers + reste `in_progress`. `partial=false`
  ⇒ finalize (`status='completed'`, `completed_at=now`, déclenche
  éventuelle agrégation NPS Phase B).

## Phase B (Manager-B backend exclusif — à venir)

- Câblage SQL réel des 17 handlers surveys + 8 handlers custom-domains.
- Engine `survey-engine.resolveNextQuestion` : SELECT branches + match.
- Engine `survey-engine.aggregateNpsForPeriod` : agrégat SQL + INSERT
  nps_aggregates (cron périodique).
- Engine `dns-engine.verifyDomainOwnership` : fetch dns.google.com/resolve
  TXT record.
- Engine `dns-engine.provisionCloudflareForSaas` : POST
  api.cloudflare.com/v4/zones + SSL provisioning.
- Engine `dns-engine.syncDnsRecords` : push records vers Cloudflare API.
- Tests unitaires + integration (calque `__tests__/affiliates.test.ts`).

## Référence rapide handlers

| Module | Handler | Méthode | Route | Cap |
|---|---|---|---|---|
| Surveys | handleListSurveys | GET | /api/surveys | settings.manage |
| Surveys | handleCreateSurvey | POST | /api/surveys | settings.manage |
| Surveys | handleGetSurvey | GET | /api/surveys/:id | settings.manage |
| Surveys | handleUpdateSurvey | PUT | /api/surveys/:id | settings.manage |
| Surveys | handleDeleteSurvey | DELETE | /api/surveys/:id | settings.manage |
| Surveys | handlePublishSurvey | POST | /api/surveys/:id/publish | settings.manage |
| Surveys | handleListSurveyQuestions | GET | /api/surveys/:id/questions | settings.manage |
| Surveys | handleCreateSurveyQuestion | POST | /api/surveys/:id/questions | settings.manage |
| Surveys | handleUpdateSurveyQuestion | PUT | /api/survey-questions/:id | settings.manage |
| Surveys | handleDeleteSurveyQuestion | DELETE | /api/survey-questions/:id | settings.manage |
| Surveys | handleListBranches | GET | /api/survey-questions/:id/branches | settings.manage |
| Surveys | handleCreateBranch | POST | /api/survey-questions/:id/branches | settings.manage |
| Surveys | handleDeleteBranch | DELETE | /api/survey-branches/:id | settings.manage |
| Surveys | handleListResponses | GET | /api/surveys/:id/responses | settings.manage |
| Surveys | handleGetResponseDetail | GET | /api/survey-responses/:id | settings.manage |
| Surveys | handleGetNpsAggregate | GET | /api/surveys/:id/nps | settings.manage |
| Surveys | handlePublicSubmitSurvey | POST | /api/public/surveys/:id/submit | PUBLIC |
| Domains | handleListCustomDomains | GET | /api/custom-domains | settings.manage |
| Domains | handleAddCustomDomain | POST | /api/custom-domains | settings.manage |
| Domains | handleVerifyDomain | POST | /api/custom-domains/:id/verify | settings.manage |
| Domains | handleDeleteDomain | DELETE | /api/custom-domains/:id | settings.manage |
| Domains | handleListDnsRecords | GET | /api/custom-domains/:id/dns-records | settings.manage |
| Domains | handleCreateDnsRecord | POST | /api/custom-domains/:id/dns-records | settings.manage |
| Domains | handleUpdateDnsRecord | PUT | /api/dns-records/:id | settings.manage |
| Domains | handleDeleteDnsRecord | DELETE | /api/dns-records/:id | settings.manage |

Total : **25 handlers** (17 surveys + 8 custom-domains) + 7 helpers engines
(3 survey + 4 dns). 1 route PUBLIC submit.

## Migration

```
npx wrangler d1 execute intralys-crm --file=migration-surveys-dns-seq145.sql --remote
```

## Statut

- **Phase A (Manager-A SOLO)** : ✅ Migration + manifest + api.ts types/helpers
  + worker.ts dispatch + stubs handlers + i18n parité + doc §6 figé.
- **Phase B (Manager-B backend)** : ⏳ Câblage SQL réel + engines réels +
  tests + UI React (Phase B/C selon scope).
