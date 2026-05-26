# LOT FORMS XL — enrichissement (Sprint 5 : logique conditionnelle, multi-étapes + progression, analytics drop-off par champ, réparation view-tracking, rendu public complet + Loi 25, anti-spam honeypot, page Forms.tsx)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (filesystem VMware Z: sans bun/node) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-AUTOMATION-BUILDER.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**. Les formulaires sont mûrs : builder dnd-kit
`src/pages/FormBuilder.tsx` (12 types de champs), quiz scoring
(`form_field_options.weight`), dédup/attribution/consentement
(`handlePublicFormSubmit`), embed (f.js), mapping custom fields, wiring trigger
`form_submitted` (réutilisé par `funnels.ts`). Ce lot pose le SOCLE pour fermer
4 gaps :

1. **Logique conditionnelle** show/hide selon réponse (C éval client, B éval
   serveur). Stockée dans le JSON `forms.fields` (attribut OPTIONNEL
   `conditional`). `form_field_options.next_field_id` reste MORT — non utilisé.
2. **Multi-étapes + barre de progression** (C). Attribut OPTIONNEL `step` dans le
   JSON `forms.fields`.
3. **Analytics drop-off par champ** (B+C) + **RÉPARER le view-tracking** :
   `handleTrackFormView` existe dans forms.ts mais n'était JAMAIS routé →
   `total_views`=0 → conversion fausse. Route POSÉE Phase A (§6.E).
4. **Rendu public incomplet** (C) : `PublicForm.tsx` ne rend pas
   date/multiselect/file/hidden NI la case consentement Loi 25 (bug silencieux) ;
   + **anti-spam honeypot** (C pose le champ caché, B rejette) ; + page de
   gestion **Forms.tsx** (liste/CRUD, NEUVE).

Architecture figée (NE PAS réinventer) :
- Tables `forms`, `form_submissions` (Phase 7), `form_views`,
  `form_field_options` (Phase 31) EXISTENT — NON recréées, NON altérées.
  Migration seq **106** = STRICTEMENT ADDITIVE (1 `CREATE TABLE IF NOT EXISTS
  form_field_events` + 1 `CREATE INDEX IF NOT EXISTS`). Zéro DROP/RENAME/rebuild/FK.
- **CHECK INTOUCHABLE** : `forms.submit_action`
  (`create_lead`|`webhook`|`email`|`none`). AUCUN ALTER de CHECK.
- Les attributs `conditional` / `step` des champs VIVENT dans le JSON
  `forms.fields` (OPTIONNELS) ⇒ **aucun DDL** pour eux. Rétro-compat byte : un
  formulaire sans ces clés rend EXACTEMENT comme avant.
- Capability = **`auth.role === 'admin'`** (les handlers forms N'UTILISENT PAS de
  capGuard — ils gardent par `if (auth.role !== 'admin') return json({error},403)`
  ; cf. `handleGetForms` l.203, `handleGetFormStats` l.174, etc.). ZÉRO ajout à
  `ALL_CAPABILITIES`.
- NE PAS casser `handlePublicFormSubmit` (dédup `resolveDedup`/`mergeIntoLead`,
  attribution `applyLeadMapping`, consentement `logIngestConsent`, mapping custom
  fields, `autoEnrollForTrigger(env,'form_submitted',leadId)`), ni `funnels.ts`
  (réutilise `form_submitted`).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error`.

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les corps des routes) :

```
// PUBLICS — fetch BRUT contre API_BASE (PAS apiFetch, aucun token injecté),
// calque la soumission publique de PublicForm.tsx (fetch('/api/form/submit')).
// Best-effort : ne JAMAIS bloquer le rendu/remplissage. NE renvoient PAS ApiResponse.
trackFormView(slug: string): Promise<{ success: boolean }>
                                      POST /api/form/:slug/view        body {}
logFormFieldEvent(slug: string,
  payload: { field_name: string; event: string; session_id?: string }):
                  Promise<{ success: boolean }>
                                      POST /api/form/:slug/field-event

// PROTÉGÉ — apiFetch (token injecté, garde admin côté handler).
getFormFieldAnalytics(formId: string): ApiResponse<FormFieldAnalyticsRow[]>
                                      GET  /api/forms/:id/field-analytics
```

Helpers forms EXISTANTS réutilisés tels quels par Manager-C (page Forms.tsx) —
**INCHANGÉS** : `getForms()` (liste), `getForm(formId)` (load),
`createForm({client_id,name,slug,...})`, `updateForm(id,{...})`,
`deleteForm(id)`, `getFormStats(formId)`, `getFormSubmissions(formId,limit?)`.
⚠ `getForms` et `getForm` EXISTAIENT DÉJÀ — Phase A ne les a PAS recréés.

### §6.B — Types front ADDITIFS (`src/lib/types.ts`, FIGÉS Phase A)

Aucun type `FormField` n'existait dans `types.ts` (il vivait inline dans
`FormBuilder.tsx` et `PublicForm.tsx`). Phase A a créé le type CANONIQUE en
miroir EXACT de la structure JSON écrite par `FormBuilder.tsx` (l'écrivain de
référence), avec les 2 attributs additifs OPTIONNELS :

```ts
type FormFieldType = 'text'|'email'|'phone'|'number'|'date'|'select'
  |'multiselect'|'checkbox'|'radio'|'textarea'|'file'|'hidden';
type FormFieldConditionOperator = 'equals'|'not_equals'|'contains'|'is_empty'|'is_not_empty';
interface FormFieldCondition { field_name: string; operator: FormFieldConditionOperator; value?: string; }
interface FormField {
  id: string; type: FormFieldType; name: string; label: string;
  placeholder?: string; required?: boolean; validation?: string;
  options?: string[]; custom_field_id?: string; weight?: number;
  conditional?: FormFieldCondition;   // ADDITIF — show-if. Absent = toujours visible.
  step?: number;                      // ADDITIF — multi-étapes. Absent/0 = étape 1.
}
interface FormFieldAnalyticsRow { field_name: string; reached: number; completed: number; dropoff_rate: number; }
```

### §6.B-bis — STRUCTURE JSON EXACTE d'un champ de `forms.fields` (CRUCIAL B/C)

`forms.fields` est une **chaîne JSON** (TEXT en base, `DEFAULT '[]'`) contenant un
**tableau** d'objets champ. Source de vérité = `FormBuilder.tsx` (création l.117-120,
édition l.278-307). Un objet champ a la forme :

```jsonc
{
  "id": "uuid",                 // crypto.randomUUID()
  "type": "text",              // FormFieldType (12 valeurs, cf. §6.B)
  "name": "field_1716301234567", // clé du payload data (UNIQUE par form). Légère: `field_${Date.now()}` par défaut, éditable.
  "label": "Texte",
  "placeholder": "",
  "required": false,
  "options": ["Option 1", "Option 2"], // PRÉSENT UNIQUEMENT pour select|multiselect|radio. ARRAY DE STRINGS (1 par ligne dans le builder), PAS [{label,value}].
  "custom_field_id": "",        // OPTIONNEL — mappe vers custom_field_values.field_id à la soumission.
  "weight": 0,                  // OPTIONNEL — quiz scoring (form_type='quiz').
  "conditional": {              // ADDITIF Sprint 5 — OPTIONNEL. Absent = toujours visible.
    "field_name": "field_xxx",  // `name` du champ pilote
    "operator": "equals",      // equals|not_equals|contains|is_empty|is_not_empty
    "value": "oui"             // OPTIONNEL — ignoré pour is_empty/is_not_empty
  },
  "step": 1                     // ADDITIF Sprint 5 — OPTIONNEL. Absent/0 = étape 1.
}
```

⚠ **PIÈGE OPTIONS** : `FormBuilder.tsx` écrit `options: string[]` (lignes de
texte). `PublicForm.tsx` déclarait un type inline `options?: Array<{label,value}>`
DIVERGENT — le rendu select/radio mappe `opt.value`/`opt.label`. **La source de
vérité est `string[]`** (ce que le builder sauve réellement). Manager-C, en
réparant `PublicForm.tsx`, doit consommer `options: string[]` (utiliser la string
à la fois comme value et label) OU normaliser, mais NE PAS supposer un objet
`{label,value}` produit par le builder. Aligner sur `FormField` (types.ts).

**Payload de soumission EXACT** (PublicForm → `POST /api/form/submit`) :
```jsonc
{ "form_id": "<forms.id>", "data": { "<field.name>": <valeur>, ... } }
```
`data` est un `Record<string, unknown>` indexé par `field.name` (PAS par `id`).
`handlePublicFormSubmit` lit `d.name|d.nom`, `d.email`, `d.phone|d.telephone`,
`d.message|d.note` pour le lead, et `d[field.name]` pour les custom fields.
Le consentement Loi 25 (Manager-C, §6.H) DOIT être ajouté DANS `data` sous une
clé lue par `applyLeadMapping` (`consent` — cf. lead-mapping.ts) afin que
`logIngestConsent` reçoive `granted`/`denied`.

### §6.C — DDL seq 106 + schéma RÉEL (conventions)

Fichier : `migration-forms-xl-seq106.sql` — seq **106**,
`depends_on: migration-automation-seq105.sql` (dernière migration du manifest =
seq 105, chaînage SÉQUENTIEL, AUCUNE dépendance de schéma réelle). Entrée
manifest ajoutée Phase A (`docs/migrations-manifest.json` seq 106, risk `low`,
`objects: ["table:form_field_events","index:form_field_events"]`, JSON validé,
virgule seq 105 ajoutée).

> ⚠ `scripts/migrate.ts` STOPPE en erreur dure sur tout `migration-*` présent sur
> disque mais ABSENT du manifest. L'entrée seq 106 est OBLIGATOIRE (ajoutée Phase A).

**Objet ajouté (additif pur)** :
```sql
CREATE TABLE IF NOT EXISTS form_field_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT, field_name TEXT, event TEXT, session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_form_field_events_form ON form_field_events(form_id);
```
Pas de FK (`form_id` lien APPLICATIF), pas de CHECK (`event` chaîne libre).
Calque `form_views` (Phase 31). Les colonnes `conditional`/`step` vivent dans le
JSON `forms.fields` ⇒ **PAS de DDL** pour elles.

**Schéma RÉEL des tables forms existantes** (Manager-B code contre CES colonnes) :
```
forms            : id TEXT PK, client_id TEXT, name, slug TEXT UNIQUE, description,
                   fields TEXT DEFAULT '[]'   ← JSON des champs (§6.B-bis)
                   submit_action TEXT CHECK(create_lead|webhook|email|none)  ← INTOUCHABLE
                   submit_config, success_message, redirect_url, is_active,
                   styling, settings_json TEXT DEFAULT '{}', folder_id, form_type
                   TEXT DEFAULT 'form', total_views INTEGER DEFAULT 0,
                   total_submissions INTEGER DEFAULT 0, created_at, updated_at
form_submissions : id TEXT PK, form_id TEXT, client_id, lead_id, data TEXT '{}',
                   ip, user_agent, created_at
form_views       : id INTEGER PK AUTOINC, form_id TEXT, visitor_id, ip,
                   user_agent, url, viewed_at TEXT DEFAULT (datetime('now'))
form_field_options : id TEXT PK, field_id TEXT, value, label, weight INTEGER,
                   next_field_id  ← MORT (non utilisé), sort_order
```

### §6.D — Logique conditionnelle + honeypot : règles serveur (CRUCIAL Manager-B)

Manager-B implémente l'évaluation conditionnelle DANS `handlePublicFormSubmit`
(forms.ts) — chemin déjà existant, NE PAS le casser :
- **Champs VISIBLES uniquement** : pour chaque champ avec `conditional`, évaluer
  l'opérateur contre `data[conditional.field_name]`. Ne **valider `required` que
  pour les champs VISIBLES**. Un champ caché par condition NON satisfaite ⇒ ni
  requis, ni mappé.
- Opérateurs : `equals` / `not_equals` (égalité stricte string), `contains`
  (sous-chaîne), `is_empty` / `is_not_empty` (valeur vide/absente). `value`
  OPTIONNELLE (ignorée pour is_empty/is_not_empty). Champ sans `conditional` =
  toujours visible (legacy).
- **Honeypot** : Manager-C pose un champ caché spécifique (convention de nom
  FIGÉE : **`name === '_hp'`** — champ texte masqué, jamais rempli par un humain).
  Manager-B : si `data['_hp']` est non vide ⇒ **rejet silencieux** = répondre
  `json({ data: { id: '<random>', success_message } }, 201)` SANS créer de
  submission/lead ni `autoEnrollForTrigger`. Aucun signal au bot (200/201
  normal). Le honeypot N'EST PAS dans le schéma `fields` rendu visible.

### §6.E — Routes (worker.ts, FIGÉ Phase A)

Toutes câblées Phase A dans `worker.ts` (Phase B/C NE TOUCHENT PAS worker.ts) :

```
// PUBLICS (pré-requireAuth) — câblés AVANT le matcher GET `/api/form/` et AVANT
// `/api/form/submit` (exact). slug → form_id résolu DANS worker.ts pour /view
// (handleTrackFormView attend un form_id ; signature EXISTANTE inchangée).
POST /api/form/:slug/view        → (résout slug→id) handleTrackFormView(request, env, formId)
POST /api/form/:slug/field-event → handleLogFormFieldEvent(request, env, slug)   [STUB Phase A]
// PROTÉGÉ (admin via auth.role dans le handler) — après /stats, pas de shadowing
// (segment supplémentaire vs `^/api/forms/([^/]+)$`).
GET  /api/forms/:id/field-analytics → handleGetFormFieldAnalytics(env, auth, formId) [STUB Phase A]
```

⚠ **SIGNATURE RÉELLE** `handleTrackFormView(request: Request, env: Env, formId: string)`
— prend un **form_id**, PAS un slug. Le worker résout `slug → forms.id` (SELECT id
FROM forms WHERE slug=? AND is_active=1, 404 sinon) AVANT l'appel. Manager-B NE
modifie PAS cette signature ni ce corps (déjà fonctionnel : INSERT form_views +
`total_views = total_views + 1`).

### §6.F — Stubs handlers neufs (`src/worker/forms.ts`, FIGÉ Phase A)

Phase A a ajouté **UNIQUEMENT 2 stubs en FIN de fichier** (zone stubs balisée,
après `handleGetFormSubmissions`). Manager-B remplit les corps réels :
```ts
handleLogFormFieldEvent(request, env, slug): Promise<Response>   // PUBLIC, stub: json({data:{success:true}})
handleGetFormFieldAnalytics(env, auth, formId): Promise<Response> // ADMIN (auth.role), stub: json({data:[]})
```
Signatures FIGÉES (calquées sur les handlers forms existants : `auth: {role}`,
`env.DB`). Le stub compile et renvoie une réponse valide best-effort.

### §6.G — i18n (POSÉ Phase A — parité STRICTE 4 catalogues)

29 clés posées Phase A dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (parité STRICTE
vérifiée — mêmes 29 clés partout, valeurs traduites). Phase C les CONSOMME, n'en
crée AUCUNE :
```
fb.cond.*      : title, show_if, field, operator, value, op.equals,
                 op.not_equals, op.contains, op.is_empty, op.is_not_empty, none
fb.step.*      : title, label ({n}), next, prev, progress ({current}/{total})
fb.analytics.* : title, dropoff, completion, reached, empty
fb.antispam.*  : error          (message d'erreur ; rien à AFFICHER au visiteur si honeypot)
forms.list.*   : title, new, col_name, col_submissions, col_views, col_conversion, empty
```

### §6.H — Répartition DISJOINTE Phase B/C (zéro fichier partagé)

**Manager-B (backend) — owned EXCLUSIF** :
- `src/worker/forms.ts` :
  - **Corps réels des 2 stubs** `handleLogFormFieldEvent` (INSERT
    `form_field_events` : résoudre slug→form_id, `field_name`, `event`,
    `session_id` ; best-effort) + `handleGetFormFieldAnalytics` (agrège drop-off
    depuis `form_field_events` + `form_submissions` → `FormFieldAnalyticsRow[]`).
  - **Évaluation conditionnelle serveur** dans `handlePublicFormSubmit` : ne
    valider `required` que pour les champs VISIBLES (§6.D).
  - **Rejet honeypot** : `data['_hp']` non vide ⇒ 200/201 silencieux sans
    submission/lead/enroll (§6.D).
  - ⚠ NE CASSE PAS dédup (`resolveDedup`/`mergeIntoLead`), attribution
    (`applyLeadMapping`), consentement (`logIngestConsent`), mapping custom
    fields, `autoEnrollForTrigger(...,'form_submitted',...)`. `handleTrackFormView`
    déjà fonctionnel — NE PAS le modifier.
  - (Optionnel) `src/worker/form-analytics.ts` NEUF si Manager-B préfère y mettre
    l'agrégation drop-off — fichier distinct, importé par forms.ts.

**Manager-C (front) — owned EXCLUSIF** :
- `src/pages/FormBuilder.tsx` : UI éditer conditions show-if par champ (produire
  `conditional` §6.B-bis) + assigner `step` ; onglet analytics drop-off
  (`getFormFieldAnalytics`, clés `fb.analytics.*`). Conserver `options: string[]`.
- `src/pages/PublicForm.tsx` : **RENDRE les types manquants**
  date/multiselect/file/hidden (aujourd'hui `default → champ non supporté`) ;
  **case consentement Loi 25 affichée + bloquante + envoyée dans le payload**
  (clé `consent` dans `data`, §6.B-bis) ; logique conditionnelle show/hide LIVE
  (éval `conditional` côté client) ; multi-step + barre de progression (clés
  `fb.step.*`) ; champ honeypot caché `name='_hp'` ; appels `trackFormView(slug)`
  au mount + `logFormFieldEvent(slug, {...})` au blur/complete des champs.
  ⚠ Aligner le type inline `Field.options` sur `string[]` (§6.B-bis PIÈGE).
- `src/pages/Forms.tsx` (**NEUF**) : liste/CRUD formulaires (`getForms`/
  `deleteForm`) + création menant au builder. Corriger la nav cassée : il existe
  `/forms/builder/$formId` (App.tsx l.887) mais AUCUNE page de liste `/forms` ni
  flux de création propre (`getForm('new')` renverrait 404). Clés `forms.list.*`.
- **App.tsx** : la route `/forms` (liste) N'EXISTE PAS — seule
  `/forms/builder/$formId` existe. App.tsx N'EST PAS dans les INTERDITS de ce lot
  (contrairement au lot Automation). Manager-C PEUT ajouter la route `/forms` →
  `Forms.tsx` (calque `formBuilderRoute`, LazyGuard, enregistrer dans routeTree).
  Si Manager-C juge App.tsx hors de son périmètre, le SIGNALER (ne pas créer de
  collision). Aucun autre changement App.tsx.

**INTERDITS aux DEUX Managers** (FIGÉS Phase A, lecture seule) :
- `migration-forms-xl-seq106.sql`, `docs/migrations-manifest.json`,
  `src/lib/types.ts`, `src/lib/api.ts`, `src/worker.ts`,
  `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, `src/index.css`, `src/lib/schemas.ts`,
  **`docs/LOT-FORMS-XL.md`**.
- ⚠ `src/worker/forms.ts` = **Manager-B exclusif** (Phase A n'y a ajouté que les
  2 stubs en fin de fichier). Pages front (`FormBuilder.tsx`, `PublicForm.tsx`,
  `Forms.tsx` NEUF) = **Manager-C exclusif**. **Aucun fichier partagé entre B et
  C** ⇒ parallélisation sûre.

### §6.I — Pièges / garde-fous

- **CHECK INTOUCHABLE** — `forms.submit_action` (create_lead|webhook|email|none).
  AUCUN ALTER de CHECK, jamais de rebuild SQLite.
- **JSON `forms.fields` rétro-compat** — `conditional`/`step` OPTIONNELS ; un
  formulaire sans ces clés rend EXACTEMENT comme avant (tout visible, étape 1).
- **Manifest OBLIGATOIRE** — entrée seq 106 ajoutée (JSON validé, virgule seq 105) ;
  sans elle `scripts/migrate.ts` STOPPE en erreur dure.
- **FK INTERDITES** — `form_field_events.form_id` ↔ `forms(id)` reste APPLICATIF
  (colonne TEXT, bornage serveur). Aucune FK.
- **NE PAS casser `handlePublicFormSubmit`** — dédup/attribution/consentement/
  mapping custom fields/`form_submitted` INCHANGÉS. NE PAS casser `funnels.ts`
  (réutilise `form_submitted`).
- **Loi 25 / CASL** — le consentement DOIT finir affiché + bloquant + envoyé dans
  le payload (`data.consent`). Manager-C l'affiche/bloque, le payload le porte,
  `logIngestConsent` (déjà appelé dans submit) le persiste.
- **Honeypot** — champ caché `name='_hp'` (convention FIGÉE §6.D). Rempli ⇒ rejet
  silencieux 200/201 sans lead/submission. Aucun message visible.
- **PIÈGE OPTIONS** — `forms.fields[].options` est `string[]` (builder), PAS
  `[{label,value}]`. Aligner PublicForm/FormField (§6.B-bis).
- **view-tracking = dette critique** — `handleTrackFormView` n'était JAMAIS routé
  (total_views=0). Route POSÉE Phase A (§6.E). Manager-C appelle `trackFormView`
  au mount de PublicForm.
- **Flux création `formId='new'`** — pas de page liste `/forms` ; `getForm('new')`
  renverrait 404. Manager-C crée `Forms.tsx` + flux de création propre.
- **Capability** — handlers forms gardent par `auth.role === 'admin'` (PAS de
  capGuard). ZÉRO ajout à `ALL_CAPABILITIES`.
- **Imports worker RELATIFS** (`./types`, `./helpers`, `./workflows`,
  `../lib/schemas`) — PAS d'alias `@/`. Front utilise `@/`.
- **Parité i18n STRICTE** sur les 4 catalogues (29 clés vérifiées).
- best-effort partout : table/colonne absente ⇒ réponse propre, JAMAIS de
  500/throw non maîtrisé. Le tracking ne bloque JAMAIS le rendu.
- Pas de build/test côté VM (filesystem Z: sans bun/node) — build/test côté hôte.
  NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `migration-forms-xl-seq106.sql` — DDL additif (1 CREATE TABLE
  `form_field_events` + 1 CREATE INDEX). Zéro ALTER/CHECK/FK/DROP.
- `docs/LOT-FORMS-XL.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `docs/migrations-manifest.json` — entrée seq 106 (+ virgule seq 105).
- `src/lib/types.ts` — `FormFieldType`/`FormFieldConditionOperator`/
  `FormFieldCondition`/`FormField` (NEUFS, miroir JSON `forms.fields` +
  `conditional`/`step` OPTIONNELS) + `FormFieldAnalyticsRow`.
- `src/lib/api.ts` — helpers `trackFormView` / `logFormFieldEvent` (publics, fetch
  brut) / `getFormFieldAnalytics` (protégé) + import `FormFieldAnalyticsRow`.
  `getForms`/`getForm` EXISTAIENT — non recréés.
- `src/worker.ts` — import des 3 handlers ; routes publiques
  `POST /api/form/:slug/view` (slug→id résolu) + `POST /api/form/:slug/field-event`
  (avant le GET `/api/form/` et `/api/form/submit`) ; route protégée
  `GET /api/forms/:id/field-analytics` (après `/stats`).
- `src/worker/forms.ts` — UNIQUEMENT les 2 stubs `handleLogFormFieldEvent` /
  `handleGetFormFieldAnalytics` en FIN DE FICHIER (= Manager-B exclusif pour le
  reste : corps réels + éval conditionnelle + honeypot).
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 29 clés fb.cond/fb.step/fb.analytics/
  fb.antispam/forms.list, parité STRICTE 4 catalogues.

Non touché : `handleTrackFormView` (déjà fonctionnel, juste ROUTÉ),
`handlePublicFormSubmit` (dédup/attribution/consentement/custom fields/
`form_submitted` INCHANGÉS), `forms.submit_action` CHECK, `schemas.ts`,
`capabilities.ts` (ALL_CAPABILITIES), `index.css`, `FormBuilder.tsx`/
`PublicForm.tsx`/`Forms.tsx` (= Phase C), corps réels des 2 handlers + éval
conditionnelle + honeypot (= Phase B). Non exécuté (VM) — build/test côté hôte.
