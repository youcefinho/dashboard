# LOT AUTOMATION BUILDER — enrichissement (Sprint 4 : config réelle des nodes, mode édition, exec-log/history/metrics, templates, simulation)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (filesystem VMware Z: sans bun/node) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-SMS-WHATSAPP.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**. Le MOTEUR `src/worker/workflows.ts` est DÉJÀ
complet (26 triggers, 24 step types, branches main/true/false, quiet-hours,
enrollment, queue). Le builder `WorkflowBuilder.tsx` est un VRAI canvas @xyflow
multi-branches. Ce lot pose le SOCLE pour fermer 6 gaps :

1. **Config réelle des nodes** (C) : aujourd'hui seul `send_internal_email` est
   configurable ; les autres panneaux sont des MOCKS.
2. **Mode édition** (C) : `createWorkflow` only, jamais de load → route figée
   `/workflows/$workflowId/edit` (Phase A) + WorkflowBuilder edit-aware (C).
3. **Exec-log / history / metrics** (B+C) : `workflow_execution_log` est écrit
   mais jamais relu → routes exec-log / automation-history + onglet analytics.
4. **Galerie de templates** (B+C) : catalogue serveur `WORKFLOW_TEMPLATES` +
   galerie front.
5. **Simulation** (B) : parcours read-only des steps SANS effet de bord.
6. **3 mocks + assign** (B) : `ai_action`/`math_operation`/`add_to_smart_list`
   restent des mocks et le case `assign` est absent du switch executeStep.

Architecture figée (NE PAS réinventer) :
- Tables `workflows`, `workflow_steps`, `workflow_enrollments`,
  `workflow_execution_log` (Phase 3, enrichies seq 86 / seq E9-m1) EXISTENT —
  NON recréées. Migration seq **105** = STRICTEMENT ADDITIVE (2 `ALTER ADD
  COLUMN` + 2 `CREATE INDEX IF NOT EXISTS`). Zéro DROP/RENAME/rebuild/FK.
- **CHECK INTOUCHABLES** : `workflows.status`, `workflow_steps.branch`
  (main/true/false), `workflow_enrollments.status`, `workflow_execution_log.status`
  (executed/skipped/failed). AUCUN ALTER de CHECK.
- Capability = **RÉUTILISE `workflows.manage`** (via le `capGuard` existant de
  workflows.ts). Liste FIGÉE seq 80 — ZÉRO ajout à `ALL_CAPABILITIES`.
- `TRIGGER_TYPES` / `STEP_TYPES` (types.ts) DÉJÀ complets — NON modifiés.
- NE PAS casser le moteur (`processWorkflowQueue` / `advanceEnrollment` /
  `executeStep` / `autoEnrollForTrigger` signatures INCHANGÉES) ni le chemin
  séquences email (`is_sequence` / `campaignKind='sequence'`, case `send_email`
  INTOUCHÉ).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (rappel)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error`.

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les routes) :

```
getWorkflowExecLog(workflowId: string): ApiResponse<ExecLogEntry[]>
                                                      GET  /workflows/:id/exec-log
getLeadAutomationHistory(leadId: string): ApiResponse<ExecLogEntry[]>
                                                      GET  /leads/:id/automation-history
simulateWorkflow(workflowId: string, payload: Record<string,unknown>):
                       ApiResponse<WorkflowSimulationResult>
                                                      POST /workflows/:id/simulate
getWorkflowTemplates(): ApiResponse<WorkflowTemplate[]>
                                                      GET  /workflow-templates
createWorkflowFromTemplate(key: string): ApiResponse<{ id: string; success: boolean }>
                                                      POST /workflows/from-template
                                                      body { template_key: key }
```

Helpers workflow EXISTANTS réutilisés tels quels par Manager-C (mode édition) :
`getWorkflow(id)` (load) et `updateWorkflow(id, {...steps})` (save) — INCHANGÉS.

### §6.B — Types front ADDITIFS (`src/lib/types.ts`, FIGÉS Phase A)

`TRIGGER_TYPES` / `STEP_TYPES` **NON modifiés**. Ajouté Phase A :

- `Workflow.template_key?: string | null` (miroir de `workflows.template_key`).
- `WorkflowTemplate { key; id?; name; industry; description; trigger_type;
  trigger_config?; steps: WorkflowTemplateStep[] }` (+ `WorkflowTemplateStep
  { step_order; step_type; config; branch?; parent_step_id? }`). DATA pure.
- `ExecLogEntry { id; enrollment_id; workflow_id?; lead_id?; step_id?;
  step_type?; status; executed_at; detail? }` — ALIGNÉ sur les colonnes RÉELLES
  de `workflow_execution_log` (cf. §6.C). `workflow_id`/`step_type`/`lead_name`
  = enrichissements de LECTURE par jointure (la table N'A PAS `workflow_id`).
- `WorkflowSimulationResult { path: Array<{ step_id; step_type; branch?;
  outcome }>; reached_goal? }`.

### §6.C — DDL seq 105 + schéma RÉEL (conventions)

Fichier : `migration-automation-seq105.sql` — seq **105**,
`depends_on: migration-sms-whatsapp-seq104.sql` (dernière migration du manifest
= seq 104, chaînage SÉQUENTIEL, AUCUNE dépendance de schéma réelle). Entrée
manifest ajoutée Phase A (`docs/migrations-manifest.json` seq 105, risk `low`,
`objects: ["alter:workflows","alter:workflow_execution_log",
"index:workflow_execution_log"]`, JSON validé).

> ⚠ `scripts/migrate.ts` STOPPE en erreur dure sur tout `migration-*` présent
> sur disque mais ABSENT du manifest. L'entrée seq 105 est OBLIGATOIRE (ajoutée
> Phase A).

**Schéma RÉEL `workflow_execution_log`** (migration-phase3.sql:51-58, JAMAIS
rebuildé depuis) — Manager-B/C codent contre CES colonnes EXACTES :
```
id            INTEGER PRIMARY KEY AUTOINCREMENT
enrollment_id TEXT  NOT NULL
step_id       TEXT  NOT NULL
status        TEXT  CHECK (status IN ('executed','skipped','failed')) DEFAULT 'executed'  ← INTOUCHABLE
result        TEXT  DEFAULT ''        ← le « détail » JSON s'appelle `result`, PAS `detail`
executed_at   TEXT  DEFAULT (datetime('now'))   ← le timestamp s'appelle `executed_at`, PAS `created_at`
lead_id       TEXT  ← AJOUTÉ seq 105 (nullable, SANS CHECK, PAS de FK)
```
⚠ La table **N'A PAS** de colonne `workflow_id` : le lien au workflow se fait
par jointure `enrollment_id → workflow_enrollments.workflow_id` (cf.
`handleGetWorkflows` l.33-35 : `JOIN workflow_enrollments we ON el.enrollment_id
= we.id WHERE we.workflow_id = ?`). `ExecLogEntry.workflow_id` est donc une
projection de LECTURE, pas une colonne.

**Objets ajoutés (additif pur)** :
- `workflows.template_key TEXT` (NULL = créé manuellement / legacy ; clé du
  modèle WORKFLOW_TEMPLATES, SANS CHECK).
- `workflow_execution_log.lead_id TEXT` (NULL = legacy / entité non-lead ;
  dénormalisation pour la lecture par lead, SANS CHECK, PAS de FK).
- Index : `idx_exec_log_lead(lead_id)`, `idx_exec_log_executed_at(executed_at)`.

Conventions (calque seq 104) : `ALTER ... ADD COLUMN` purs + `CREATE INDEX IF
NOT EXISTS`, zéro FK, PAS d'unixepoch/autoincrement nouveau. AUCUN ALTER de
contrainte / DROP / RENAME / rebuild. Tolérance duplicate-column best-effort.

### §6.D — Clés `step.config` lues par `executeStep` (CRUCIAL pour Manager-C)

Manager-C DOIT produire EXACTEMENT ces clés JSON dans `step.config` (chaque
node) pour que le moteur les lise. Extrait verbatim de `executeStep`
(workflows.ts). Rétro-compat : ne PAS renommer, ne PAS retirer de clé existante.

```
wait                      → wait_type ('delay'|'until_date'|'until_time'|'for_event'),
                            delay_minutes (number), wait_date (ISO), wait_time ('HH:MM')
condition                 → field (string, clé du lead), operator
                            ('equals'|'not_equals'|'contains'|'greater_than'|'less_than'),
                            value (string)            → renvoie branche 'true'|'false'
send_email                → template_id (id email_templates)   ⚠ case INTOUCHÉ (séquence)
send_internal_email       → to_email, subject, body  (interpolation {{champ}})
send_sms                  → message (interpolation {{champ}})
add_tag                   → tag
remove_tag                → tag
change_status             → status ∈ {new,contacted,qualified,won,closed,lost}
notify                    → message
webhook                   → url (https:// requis), method (défaut 'POST')
update_pipeline           → pipeline_id
update_stage              → stage_id
create_task               → title, description, priority (défaut 'medium'), assigned_to
create_appointment        → title, days_from_now (number), type (défaut 'meeting')
create_opportunity        → deal_value (number)
update_opportunity        → deal_value (number)
update_custom_field       → field_id, value (interpolation {{champ}})
trigger_another_workflow  → workflow_id (cible)
end_other_workflow        → workflow_id (cible)
goal_reached              → (aucune clé ; marque l'enrollment 'completed')
ai_action                 → MOCK (Manager-B définit les clés en finissant le mock)
math_operation            → MOCK (Manager-B)
add_to_smart_list         → MOCK (Manager-B)
assign                    → case ABSENT du switch ; Manager-B l'ajoute (additif,
                            calque change_status ; clé attendue : assigned_to)
```

Branches : `condition` renvoie `'true'`/`'false'` ; tous les autres renvoient
`'main'`. Le next step est trouvé par
`WHERE parent_step_id = ? AND branch = ?` (advanceEnrollment l.469-471).

**Sérialisation parent_step_id / branch + sentinel premier step** (FIGÉ —
WorkflowBuilder l.384-421) : chaque step porte `{ id, step_order, step_type,
config (JSON string), parent_step_id, branch }`. Le PREMIER step (rattaché au
node trigger) utilise le sentinel **`parent_step_id = 'trigger_1'`** (et le
moteur lit `parent_step_id IS NULL OR parent_step_id = 'trigger_1'` pour trouver
le step initial — handleEnrollLead l.234 / autoEnroll l.317). `branch` provient
du `sourceHandle` de l'edge ('true'/'false', sinon 'main'). Manager-C, en mode
ÉDITION, reconstruit nodes/edges depuis `parent_step_id` + `branch` (gérer le
sentinel) et resauve via `updateWorkflow` (qui DELETE+réINSERT les steps).

### §6.E — Routes (worker.ts, FIGÉ Phase A)

Toutes câblées Phase A dans `worker.ts` (Phase B/C NE TOUCHENT PAS worker.ts).
Capability `workflows.manage` appliquée DANS les handlers (capGuard). Les
sous-routes SPÉCIFIQUES sont câblées AVANT le matcher générique
`/api/workflows/:id` (sinon `from-template` serait avalé comme un `:id`) :

```
GET    /api/workflow-templates          → handleGetWorkflowTemplates(env, auth)   (./worker/workflow-templates)
POST   /api/workflows/from-template     → handleCreateWorkflowFromTemplate(request, env, auth)
GET    /api/workflows/:id/exec-log      → handleGetWorkflowExecLog(env, auth, id)
POST   /api/workflows/:id/simulate      → handleSimulateWorkflow(request, env, auth, id)
GET    /api/leads/:id/automation-history→ handleGetLeadAutomationHistory(env, auth, id)
```
`exec-log` / `simulate` / `from-template` (workflows.ts) ; `automation-history`
(workflows.ts) ; `workflow-templates` (workflow-templates.ts). Ordre dans
worker.ts : `/api/workflow-templates` + `/api/workflows/from-template` +
`:id/exec-log` + `:id/simulate` AVANT `wfMatch` (`^/api/workflows/([^/]+)$`) ;
`leadAutoHistMatch` parmi les sous-routes leads (avant `leadMatch`).

### §6.F — App.tsx (route ÉDITION, FIGÉ Phase A)

Route ajoutée Phase A (calque `workflowNewRoute` / `workflowDetailRoute`),
enregistrée AVANT `workflowDetailRoute` dans `routeTree` :
```
path '/workflows/$workflowId/edit' → WorkflowBuilderPage (LazyGuard)
```
Manager-C rend `WorkflowBuilder` edit-aware : si le param `workflowId` est
présent (route edit), charger via `getWorkflow` et sauver via `updateWorkflow`
au lieu de `createWorkflow`. Phase A NE touche À RIEN d'autre dans App.tsx.

### §6.G — i18n (POSÉ Phase A — parité STRICTE 4 catalogues)

30 clés posées Phase A dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (parité STRICTE
vérifiée — mêmes 30 clés partout, valeurs traduites). Phase C les CONSOMME, n'en
crée AUCUNE :

```
wb.cfg.*   : title, template, message, subject, to_email, delay, field,
             operator, value, tag, status, url, save        (panneaux config nodes)
wf_tpl.*   : title, from_template, industry, use, empty      (galerie templates)
wf_log.*   : title, step, status, executed_at, dropoff, conversion, empty
                                                             (journal + métriques)
wf_sim.*   : title, run, path, reached_goal, no_goal         (simulation)
```

### §6.H — Répartition DISJOINTE Phase B/C (zéro fichier partagé)

**Manager-B (backend) — owned EXCLUSIF** :
- `src/worker/workflows.ts` :
  - **CORPS RÉELS des 4 handlers stub** (Phase A n'a posé QUE les 4 stubs en FIN
    de fichier, après le `switch` de `executeStep`) :
    - `handleGetWorkflowExecLog` : LECTURE `workflow_execution_log` JOIN
      `workflow_enrollments` (`we.workflow_id = ?`) → `ExecLogEntry[]` (mapper
      `result`→`detail`, `executed_at` tel quel, enrichir `step_type` par
      jointure `workflow_steps` si voulu).
    - `handleGetLeadAutomationHistory` : LECTURE `WHERE lead_id = ?`
      (colonne seq 105). Best-effort si lead_id NULL sur logs legacy.
    - `handleSimulateWorkflow` : chemin **SÉPARÉ read-only** qui parcourt les
      steps (parent_step_id/branch) SANS effet de bord — **NE réutilise PAS
      `executeStep`** ; évalue `condition` (true/false), construit
      `WorkflowSimulationResult { path, reached_goal }`.
    - `handleCreateWorkflowFromTemplate` : lit `{ template_key }`, retrouve le
      def dans `WORKFLOW_TEMPLATES`, INSERT `workflows` (avec `template_key` seq
      105) + `workflow_steps`, retourne `{ id, success }`.
  - **finir les 3 mocks** `ai_action` / `math_operation` / `add_to_smart_list`
    (dans le `switch` de `executeStep`).
  - **ajouter le case `assign`** (additif dans le `switch`, `default` INCHANGÉ ;
    calque `change_status`, clé `assigned_to`).
  - **renseigner `lead_id`** dans les INSERT `workflow_execution_log` existants
    (l.358, 462, 641, 664, 717 ≈ — ajouter la colonne+valeur `lead.id`).
  - ⚠ NE TOUCHE PAS le case `send_email` / chemin séquence (`is_sequence` /
    `campaignKind`), ni les signatures `processWorkflowQueue` / `advanceEnrollment`
    / `executeStep` / `autoEnrollForTrigger`.
- `src/worker/workflow-templates.ts` (corps déjà fonctionnel Phase A : catalogue
  `WORKFLOW_TEMPLATES` + `handleGetWorkflowTemplates`) — compléter si besoin,
  signature du handler FIGÉE.

**Manager-C (front) — owned EXCLUSIF** :
- `src/pages/WorkflowBuilder.tsx` : remplacer le panneau config MOCK par de
  VRAIS formulaires par `step_type` produisant les clés `step.config` EXACTES du
  §6.D (clés `wb.cfg.*`) ; config trigger pour les autres triggers ; **mode
  édition** (route `/workflows/:id/edit`) : charger via `getWorkflow`,
  reconstruire nodes/edges depuis `parent_step_id` + `branch` (gérer le sentinel
  `trigger_1`), sauver via `updateWorkflow`.
- `src/pages/WorkflowDetail.tsx` : onglet analytics (drop-off par step +
  conversion via `getWorkflowExecLog`) + timeline (`wf_log.*`).
- `src/pages/Workflows.tsx` : bouton « Depuis un modèle » + galerie
  (`getWorkflowTemplates` / `createWorkflowFromTemplate`, clés `wf_tpl.*`).
- `src/pages/workflow-templates.ts` (**NEUF**, données galerie front calquées
  sur `funnel-templates.ts`). ⚠ FICHIER DIFFÉRENT de
  `src/worker/workflow-templates.ts` (Manager-B) — même nom, **chemins
  distincts** (`pages/` vs `worker/`), aucun conflit.
- éventuel composant de simulation consommant `simulateWorkflow` (clés
  `wf_sim.*`). Manager-C peut aussi afficher l'historique automation dans la
  page Lead via `getLeadAutomationHistory` SI un composant de détail lead lui
  appartient — sinon le signaler (ne pas créer de collision avec un fichier B).

**INTERDITS aux DEUX Managers** (FIGÉS Phase A, lecture seule) :
- `migration-automation-seq105.sql`, `docs/migrations-manifest.json`,
  `src/lib/types.ts`, `src/lib/api.ts`, `src/worker.ts`, `src/App.tsx`,
  `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, `src/index.css`,
  **`docs/LOT-AUTOMATION-BUILDER.md`**.
- ⚠ `src/worker/workflows.ts` = **Manager-B exclusif** (Phase A n'y a ajouté que
  les 4 stubs en fin de fichier). `src/worker/workflow-templates.ts` =
  **Manager-B exclusif**. `src/pages/workflow-templates.ts` = **Manager-C
  exclusif** (NEUF). **Aucun fichier partagé entre B et C** ⇒ parallélisation
  sûre.

### §6.I — Pièges / garde-fous

- **CHECK INTOUCHABLES** — `workflows.status`, `workflow_steps.branch`,
  `workflow_enrollments.status`, `workflow_execution_log.status`. AUCUN ALTER de
  CHECK, jamais de rebuild SQLite.
- **Manifest OBLIGATOIRE** — entrée seq 105 ajoutée (JSON validé) ; sans elle
  `scripts/migrate.ts` STOPPE en erreur dure.
- **FK INTERDITES** — `workflow_execution_log.lead_id` ↔ `leads(id)` reste
  APPLICATIF (colonne TEXT, bornage serveur). Aucune FK ajoutée.
- **NE PAS casser le moteur** — signatures `processWorkflowQueue` /
  `advanceEnrollment` / `executeStep` / `autoEnrollForTrigger` INCHANGÉES.
- **NE PAS casser les séquences email** — case `send_email` /
  `is_sequence`/`campaignKind='sequence'` INTOUCHÉ.
- **RÉTRO-COMPAT clés JSON `step.config`** — ne JAMAIS renommer/retirer une clé
  existante (§6.D) ; le moteur lit ces clés exactes.
- **Sérialisation parent_step_id / branch + sentinel** — premier step =
  `parent_step_id = 'trigger_1'` ; next step via `parent_step_id` + `branch`
  (§6.D). Mode édition : reconstruire et resauver via `updateWorkflow`
  (DELETE+réINSERT steps).
- **Colonnes RÉELLES exec-log** — `result` (PAS `detail`), `executed_at` (PAS
  `created_at`), PAS de `workflow_id` (jointure via enrollment). Cf. §6.C.
- **Simulation SANS effet de bord** — chemin SÉPARÉ, NE réutilise PAS
  `executeStep` (aucun INSERT messages/tags/status, aucun envoi).
- **Capability FIGÉE seq 80** — réutilise `workflows.manage` via le `capGuard`
  existant, ZÉRO ajout à `ALL_CAPABILITIES`.
- **Imports worker RELATIFS** (`./types`, `./helpers`, `./capabilities`,
  `./workflows`, `./workflow-templates`) — PAS d'alias `@/`. Front utilise `@/`.
- **Parité i18n STRICTE** sur les 4 catalogues (30 clés vérifiées).
- best-effort partout : table/colonne absente ⇒ réponse propre, JAMAIS de
  500/throw non maîtrisé.
- Pas de build/test côté VM (filesystem Z: sans bun/node) — build/test côté hôte.
  NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `migration-automation-seq105.sql` — DDL additif (1 ALTER workflows + 1 ALTER
  workflow_execution_log + 2 CREATE INDEX).
- `src/worker/workflow-templates.ts` — catalogue `WORKFLOW_TEMPLATES` (5 modèles :
  immobilier ×2, dentiste, services, restauration) + `handleGetWorkflowTemplates`
  (corps fonctionnel, capability workflows.manage). Signature FIGÉE.
- `docs/LOT-AUTOMATION-BUILDER.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `docs/migrations-manifest.json` — entrée seq 105.
- `src/lib/types.ts` — `Workflow.template_key?` + interfaces `WorkflowTemplate`/
  `WorkflowTemplateStep`/`ExecLogEntry`/`WorkflowSimulationResult`.
  `TRIGGER_TYPES`/`STEP_TYPES` INCHANGÉS.
- `src/lib/api.ts` — 5 helpers (`getWorkflowExecLog`, `getLeadAutomationHistory`,
  `simulateWorkflow`, `getWorkflowTemplates`, `createWorkflowFromTemplate`) +
  import des 3 nouveaux types.
- `src/worker.ts` — import des 4 stubs + `handleGetWorkflowTemplates` ; routes
  `/api/workflow-templates`, `/api/workflows/from-template`, `:id/exec-log`,
  `:id/simulate` (avant le matcher générique), `/api/leads/:id/automation-history`.
- `src/worker/workflows.ts` — UNIQUEMENT les 4 stubs `handleGetWorkflowExecLog`/
  `handleGetLeadAutomationHistory`/`handleSimulateWorkflow`/
  `handleCreateWorkflowFromTemplate` en FIN DE FICHIER (= Manager-B exclusif pour
  le reste : corps réels + mocks + assign + lead_id dans les INSERT).
- `src/App.tsx` — route `/workflows/$workflowId/edit` (+ enregistrement dans
  routeTree). RIEN D'AUTRE.
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 30 clés wb.cfg/wf_tpl/wf_log/wf_sim,
  parité STRICTE 4 catalogues.

Non touché : moteur `workflows.ts` (executeStep/advanceEnrollment/queue =
INCHANGÉS hors les 4 stubs ajoutés en fin de fichier), case `send_email`/
séquences, `capabilities.ts` (ALL_CAPABILITIES), `index.css`,
`WorkflowBuilder.tsx`/`WorkflowDetail.tsx`/`Workflows.tsx`/
`src/pages/workflow-templates.ts` (= Phase C), corps réels des 4 handlers +
mocks + assign + lead_id (= Phase B). Non exécuté (VM) — build/test côté hôte.
