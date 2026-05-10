# ANTIGRAVITY-SPRINT2-PLAN.md — Vertical Slice Module Leads/Contacts

> Sprint 2 = 100% remplacement GHL Contacts pour Mathis Guimont (11 contacts).
> Rédigé le 2026-05-10 par Antigravity.
> **Ne rien commiter tant que Rochdi n'a pas validé §A + §B + §C.**

---

## A. Pré-requis & Validation Sprint 1

| Item | Status | Preuve |
|------|--------|--------|
| Refactor worker.ts splitté en 23 modules `src/worker/*.ts` | ✅ | `711a363` — worker.ts = 266 lignes routeur, 23 modules extraits |
| Migration M1 (contacts) infrastructure testée | ✅ | `8a1afb6` — `migrateContacts()` dans `migrate.ts` L282-404 |
| R2 bucket binding `intralys-files` configuré | ✅ | `wrangler.jsonc` — binding `FILES` ajouté (`ece23d3`) |
| Q.1 DND par canal commité | ✅ | `a9be81a` — colonnes `dnd`, `dnd_settings` + phase 10 |
| Q.5 Champs étendus commités | ✅ | `a9be81a` — `date_of_birth`, `country`, `timezone`, `additional_emails` |
| MVP P4.3 Documents | ✅ | `2af8381` — module complet R2 + e-sign + audit trail |
| MVP P4.6 Reviews | ✅ | `e1cee80` — demandes avis, stats, suggestion AI |
| MVP P4.2 Webchat | ✅ | `70612ea` — Durable Object WebSocket + widget |

> **Verdict : Sprint 1 = ✅ COMPLET.** Sprint 2 peut démarrer.

---

## B. Auto-audit honnête des modules Leads existants

### B.1 — `src/pages/Leads.tsx` (451 lignes)

**3 faiblesses qualité :**

1. **Smart Lists en localStorage** (L21-22) — persistance côté client, perdu au changement de navigateur, pas partageable entre users. Doit être D1.
2. **Bulk actions N+1** (L74-80) — boucle `for (const id of selectedIds)` avec `await updateLead()` séquentiel. 100 leads = 100 requêtes HTTP. Doit être 1 batch endpoint `/api/leads/bulk`.
3. **Aucun état "loading" granulaire** — un seul `isLoading` global. Un changement de filtre recharge tout sans skeleton partiel. État filtres pas dans URL (back button perd les filtres).

**3 refactors nécessaires pour Sprint 2 :**

1. **State management** — 10 `useState` indépendants pour les filtres (L14-26). Pour 15+ filtres avancés, passer à `useReducer` avec actions typées. Les filtres doivent être sérialisés dans l'URL (`searchParams`).
2. **Table non virtualisée** — `sortedLeads.map()` rend tous les leads. 1000+ leads = DOM lent. Besoin `@tanstack/react-virtual` ou `react-window`.
3. **Colonnes hardcodées** — les colonnes de la table (L300-316) sont fixes dans le JSX. Pour les colonnes customisables, extraire en config et rendre dynamiquement.

**3 dépendances à ajouter :**

1. `@tanstack/react-virtual` — virtualisation table pour 1000+ leads
2. `@dnd-kit/core` + `@dnd-kit/sortable` — drag&drop colonnes + custom fields reorder
3. `cmdk` ou composant custom — autocomplete tags/users dans filtres et bulk actions

### B.2 — `src/pages/LeadDetail.tsx` (479 lignes — session précédente avait ajouté DND + champs étendus)

**3 faiblesses qualité :**

1. **Cast `as unknown as Record<string, unknown>`** (L~460) — contournement TypeScript pour accéder aux champs Q.5. Le type `Lead` dans `types.ts` n'a pas les nouveaux champs.
2. **Notes = zone texte unique** (L~300-320) — un seul `textarea`. GHL = array de notes datées avec @mentions et catégories.
3. **3 tabs seulement** (Details, Conversations, Activity) — GHL en a 9+. La structure tabs est hardcodée, pas extensible.

**3 refactors nécessaires pour Sprint 2 :**

1. **Type `Lead` à étendre** — ajouter `dnd_settings`, `date_of_birth`, `country`, `timezone`, `additional_emails`, `additional_phones`, `lifecycle_stage`, `favorite` dans le type TypeScript.
2. **Notes array** — table `lead_notes (id, lead_id, user_id, body, category, is_pinned, created_at)` + API CRUD + UI chronologique.
3. **Tabs dynamiques** — refactorer en config array avec lazy loading par tab. Chaque tab = composant dédié dans `src/components/lead-tabs/`.

**3 dépendances à ajouter :**

1. `date-fns` ou `dayjs` — calcul d'âge, relative dates, formatage avancé
2. `react-textarea-autosize` — notes auto-expand
3. `@mapbox/mapbox-gl-js` — optionnel, si MAPBOX_TOKEN dispo (sinon fallback input texte)

### B.3 — `src/worker/leads.ts` (631 lignes)

**3 faiblesses qualité :**

1. **`handleGetLeads` query hardcodée** (L95-160) — la query SQL ne supporte pas les filtres avancés (custom fields, tags AND/OR, score range, date range custom). Elle construit le WHERE de manière fragile.
2. **Pas de validation body typée** — `handlePatchLead` accepte un `Record<string, unknown>` en body. Pas de schema validation (contrairement à `auth.ts` qui a `loginSchema`).
3. **`handleWebhookLead`** (L553-630) — SQL injection potentielle dans la query workflows (L617 `trigger_config LIKE '%"client_id":"${clientId}"%'`). Utiliser un binding paramétré.

**3 refactors nécessaires pour Sprint 2 :**

1. **Query builder dynamique** — refactorer `handleGetLeads` avec un query builder qui accepte N filtres (tags, custom fields, score range, date range, assigned_to, DND, has/hasn't). Pattern : `buildLeadsQuery(filters) → { sql, params }`.
2. **Endpoints Smart Lists** — CRUD `/api/smart-lists` + `/api/smart-lists/:id/leads` (exécute les filters persistés). Count cache via cron.
3. **Endpoints Custom Fields** — CRUD `/api/custom-fields` + `/api/leads/:id/custom-fields` (valeurs par lead). Le module `custom-fields.ts` existe mais pas les handlers CRUD complets.

---

## C. Plan détaillé Sprint 2 ordonné

### Phase 2.0 — Multi-score profiles (1j)

**Migration :**
```sql
-- migration-sprint2-phase0.sql
CREATE TABLE IF NOT EXISTS score_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  formula TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_scores (
  lead_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (lead_id, profile_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (profile_id) REFERENCES score_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_profile ON lead_scores(profile_id);
```

**3 profils seedés :**
1. "Qualification globale" — `{"weights": {"has_phone": 10, "has_email": 10, "has_budget": 20, "engagement_7d": 15, "tag_chaud": 25, "source_referral": 20}}`
2. "Score acheteur" — `{"weights": {"type_buy": 30, "has_budget": 25, "response_time_24h": 20, "meeting_booked": 25}}`
3. "Score vendeur" — `{"weights": {"type_sell": 30, "has_property_address": 25, "has_property_value": 25, "engagement_7d": 20}}`

**API :**
- `GET /api/score-profiles` — liste
- `POST /api/score-profiles` — créer
- `GET /api/leads/:id/scores` — scores pour tous les profils
- `POST /api/leads/:id/scores/recompute` — recalcul

**Tests :** Créer profil → recompute pour 1 lead → vérifier score retourné.

---

### Phase 2.1 — Migration M1 Contacts enrichie (2j)

L'infrastructure existe (`migrate.ts` L282-404), mais il manque :

**Enrichissements migration :**
1. `contact.attributions[]` → table `lead_attributions (id, lead_id, medium, source, campaign, referrer, session_source, created_at)` — multi-touch
2. `contact.additionalEmails[]` → colonne `additional_emails TEXT` (JSON array)
3. `contact.additionalPhones[]` → nouvelle colonne `additional_phones TEXT`
4. `contact.address1`, `city`, `state`, `postalCode` → nouvelles colonnes `address TEXT`, `city TEXT`, `postal_code TEXT`
5. `contact.companyName` → colonne `company TEXT`
6. Mapping `contact.type` GHL (lead/customer/…) → `lifecycle_stage` enum
7. Log diff : pour chaque contact importé, stocker `migration_raw_data TEXT` = JSON GHL brut pour audit post-import

**Migration SQL supplémentaire :**
```sql
ALTER TABLE leads ADD COLUMN additional_phones TEXT DEFAULT '[]';
ALTER TABLE leads ADD COLUMN address TEXT;
ALTER TABLE leads ADD COLUMN city TEXT;
ALTER TABLE leads ADD COLUMN postal_code TEXT;
ALTER TABLE leads ADD COLUMN company TEXT;
ALTER TABLE leads ADD COLUMN lifecycle_stage TEXT DEFAULT 'lead';
ALTER TABLE leads ADD COLUMN favorite INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS lead_attributions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  medium TEXT,
  source TEXT,
  campaign TEXT,
  referrer TEXT,
  session_source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE INDEX IF NOT EXISTS idx_lead_attributions_lead ON lead_attributions(lead_id);

CREATE TABLE IF NOT EXISTS lead_notes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL,
  user_id TEXT,
  body TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id);
```

**Test E2E :** Importer 11 contacts Mathis → vérifier custom fields, tags, DND, attributions préservés. Comparer avec data GHL brute.

---

### Phase 2.2 — Migration M3 Custom Fields enrichie (1j)

L'infrastructure existe (`migrate.ts` L221-278), enrichissements :

1. **12+ dataTypes mappés** (actuellement 11) :
   | GHL dataType | Notre type | Notes |
   |---|---|---|
   | TEXT | text | |
   | LARGE_TEXT | textarea | |
   | NUMERICAL | number | |
   | PHONE | phone | |
   | MONETARY | monetary | Afficher avec symbole $ |
   | CHECKBOX | checkbox | |
   | SINGLE_OPTIONS | single_select | picklist |
   | MULTIPLE_OPTIONS | multi_select | picklist |
   | DATE | date | date picker |
   | FILE_UPLOAD | file_upload | lien R2 |
   | SIGNATURE | signature | canvas signature pad |
   | TEXT_BOX_LIST | textarea | fallback |

2. **`parentId` support** — folders GHL → `parent_id` dans notre table
3. **`model` champ** — `contact` vs `opportunity` préservé
4. **Colonne `is_required`** dans `custom_field_defs`

**Test :** Importer 5 custom fields Mathis → vérifier types, options, positions.

---

### Phase 2.3 — Custom Fields UI Builder (2j)

**Route :** `/settings/custom-fields`

**Composants :**
- `CustomFieldsList` — liste avec folders collapsibles
- `CustomFieldModal` — création/édition avec :
  - Nom, type (12+ dropdown), placeholder
  - Picklist options editor (pour single/multi_select)
  - Toggles : is_required, is_unique
  - Model : contact vs opportunity
  - Position : drag&drop via `@dnd-kit`
- `CustomFieldRenderer` — composant réutilisable qui rend le bon input selon dataType :
  - `text` → `<Input />`
  - `textarea` → `<textarea />`
  - `number` / `monetary` → `<Input type="number" />`
  - `date` → `<input type="date" />`
  - `single_select` → `<select />`
  - `multi_select` → multi-checkbox
  - `checkbox` → `<input type="checkbox" />`
  - `phone` / `email` / `url` → `<Input type="..." />`
  - `file_upload` → upload R2
  - `signature` → canvas pad (lib `signature_pad`)

**API :**
- `GET /api/custom-fields` (liste par client)
- `POST /api/custom-fields` (créer)
- `PATCH /api/custom-fields/:id` (modifier)
- `DELETE /api/custom-fields/:id` (soft delete)
- `POST /api/custom-fields/reorder` (update positions)

**Intégration LeadDetail.tsx :** Section "Champs personnalisés" avec `<CustomFieldRenderer />` pour chaque field → valeur en inline edit.

---

### Phase 2.4 — Smart Lists exécutables (2j)

**Migration :**
```sql
CREATE TABLE IF NOT EXISTS smart_lists (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  client_id TEXT,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  is_shared INTEGER DEFAULT 0,
  count_cache INTEGER DEFAULT 0,
  count_updated_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT NOT NULL,
  page TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT DEFAULT '{}',
  PRIMARY KEY (user_id, page, key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**API :**
- `GET /api/smart-lists` — toutes les listes (perso + partagées)
- `POST /api/smart-lists` — créer (max 10 filtres, validé côté API)
- `PATCH /api/smart-lists/:id` — modifier
- `DELETE /api/smart-lists/:id`
- `GET /api/smart-lists/:id/leads` — exécute les filtres → retourne leads paginés

**Cron count cache :** Toutes les 5 min, recalculer `count_cache` pour chaque smart list active.

**UI :**
- Sidebar Leads : section "Mes vues" avec noms + compteurs
- Bouton "💾 Sauvegarder cette vue" → modal nom + toggle partagée
- Click sur Smart List → charge les filtres dans la page Leads
- 3 Smart Lists seedées : "Hot leads (score ≥ 70)", "Sans réponse 7j", "RDV cette semaine"

---

### Phase 2.5 — Enrichissement Leads.tsx (3j)

**Filtres avancés (ajoutés au panneau de filtres) :**
- Filtre custom field (dropdown dynamique selon fields du client)
- Filtre tags multi-select avec toggle AND/OR
- Filtre date range custom (date picker start/end)
- Filtre score range (slider 0-100)
- Filtre assigned_to (autocomplete users)
- Filtre has/has not (email, phone, tasks, appointments)
- Filtre last activity > N jours
- Filtre DND (dropdown canal)
- Filtre lifecycle stage (dropdown enum)

**Architecture filtres :** `useReducer` avec état dans URL (`searchParams`). Bouton "Filtres avancés" toggle un panneau expandable sous la barre principale.

**Colonnes customisables :**
- Drawer "⚙️ Configurer colonnes" avec checkboxes + drag reorder
- Sauvegarde via `user_preferences (user_id, 'leads', 'columns', '{...}')`
- Colonnes dispo : Nom, Email, Tél, Client, Type, Statut, Score, Source, Tags, Assigned, DND, Lifecycle, Deal Value, Date, Custom Fields...

**Vue Card** améliorée (déjà existante L242-284, enrichir avec lifecycle badge + attribution source).

**Bulk actions enrichies :**
- Bulk send email (modal compose + template selector)
- Bulk send SMS (modal compose)
- Bulk add to workflow (dropdown)
- Bulk update custom field (field selector + value)
- Bulk export selected (CSV des sélectionnés seulement)

**Inline edit :** Status dropdown (✅ déjà fait), Tags inline (chip add/remove), Assigned_to inline.

**Bouton "+ Ajouter un contact"** (C11) — modal avec full form.

---

### Phase 2.6 — Enrichissement LeadDetail.tsx (4j)

**Header card enrichi :**
- Avatar (URL si dispo, sinon initials avec bg coloré — ✅ partiellement fait)
- Quick actions row : 📞 Call (`tel:` link), 💬 SMS, 📧 Email, 📅 Book RDV, 📝 Note — 5 boutons en haut
- Lead score badge avec couleur (vert ≥70, jaune 40-69, rouge <40)
- Last activity timestamp ("Dernier contact il y a 3 jours")
- Owner avec avatar
- Source badge prominent
- Star/favorite toggle (icône ⭐)
- Lifecycle stage dropdown badge (Lead → MQL → SQL → Opportunity → Customer)

**Panneau Details enrichi :**
- DND 4 canaux : Email, SMS, Call, Voicemail (✅ 3 faits, ajouter Voicemail)
- Additional emails (array add/remove) — ✅ colonne existe
- Additional phones (array add/remove)
- Date of birth + âge calculé — ✅ colonne existe
- Country / Timezone select — ✅ colonnes existent
- Address (input texte, ou Mapbox autocomplete si `MAPBOX_TOKEN` dispo)
- Social profiles (LinkedIn, FB, IG URLs)
- Lifecycle stage history (mini-timeline)
- Lead source detail (UTM collapsible : source, medium, campaign, referrer)
- Custom fields rendus avec `<CustomFieldRenderer />`

**9 tabs (de 3 à 9) :**

| Tab | Composant | Source data |
|---|---|---|
| Details | `LeadTabDetails.tsx` | ✅ existant, enrichi |
| Conversations | `LeadTabConversations.tsx` | ✅ existant |
| Activity | `LeadTabActivity.tsx` | ✅ existant, enrichi (filter par type, group by day) |
| Opportunities | `LeadTabOpportunities.tsx` | **nouveau** — deals liés au contact |
| Tasks | `LeadTabTasks.tsx` | **nouveau** — tasks dédiées |
| Appointments | `LeadTabAppointments.tsx` | **nouveau** — RDV liés |
| Files | `LeadTabFiles.tsx` | **nouveau** — documents R2 |
| Workflows | `LeadTabWorkflows.tsx` | **nouveau** — enrollments actifs/passés |
| Notes | `LeadTabNotes.tsx` | **nouveau** — notes multiples, @mention, pin, catégories |

**Notes system :**
- Multiple notes (array chronologique, pas zone unique)
- @mention users avec autocomplete
- Pin important note (épinglée en haut)
- Catégories dropdown (call, meeting, follow-up, general)

**Quick actions sidebar :**
- "Envoyer vers workflow" + modal selector
- "Créer tâche" + modal
- "Planifier RDV" + modal
- "Ajouter à opportunité" + modal
- "Marquer doublon" action
- "Fusionner avec..." action (C10)

---

### Phase 2.7 — Tests E2E vertical complete (1j)

**Procédure de test final :**

1. Nettoyer : `wrangler d1 execute --local --command "DELETE FROM leads WHERE client_id='gatineau-test'"`
2. Migration custom fields : `POST /api/migrate` avec `modules: ['custom_fields']`
3. Migration contacts : `POST /api/migrate` avec `modules: ['contacts']`
4. Vérifier en UI Leads que les 11 contacts apparaissent :
   - Custom fields rendus (Budget, Message, Délai, etc.)
   - Tags préservés
   - DND settings préservés
   - Multi-touch attribution visible
5. Ouvrir un contact spécifique :
   - Vérifier les 9 tabs
   - Tester DND toggle
   - Ajouter une note avec @mention
   - Toggle favorite
   - Changer lifecycle stage
6. Créer Smart List "Acheteurs Gatineau" avec filtres
7. Bulk action : sélectionner 5 contacts → envoyer email via template
8. Comparer screen by screen avec GHL → liste features manquantes → `SPRINT2-DEFER.md`

---

## D. Risques techniques Sprint 2

| # | Risque | Sévérité | Plan mitigation |
|---|--------|----------|-----------------|
| R1 | **Attributions GHL complexes** — mapping JSON `contact.attributions[]` peut contenir des structures variables entre sub-accounts | 🟠 | Logger le JSON brut GHL dans `migration_raw_data`. Mapper les champs connus (medium, source, campaign), ignorer les inconnus avec flag `partial_import`. |
| R2 | **Custom fields dataTypes non supportés** — `SIGNATURE`, `FILE_UPLOAD` ne peuvent pas être rendus en Sprint 2 sans canvas/upload complexe | 🟠 | Fallback vers `<textarea>` + badge "📎 Type: signature" pour l'affichage. Upload R2 minimal (file input → R2 PUT). Canvas signature reporté Sprint 5. |
| R3 | **Smart Lists N+1 query** — filters complexes sur custom fields = JOIN dynamique + scan séquentiel | 🔴 | Count cache 5min via cron (pas de recompute live). Pagination cursor sur résultats. Limite 10 filtres max par smart list. Index composites sur colonnes filtrées fréquemment. |
| R4 | **GHL PIT Token Mathis** — le token peut avoir expiré ou ne pas avoir les scopes contacts/customFields | 🟠 | Rochdi doit confirmer token valide avant Phase 2.1. Fallback : test avec mock data si token indisponible. |
| R5 | **Performance 1000+ leads** — table non virtualisée va ramer. Si Mathis a peu de contacts (11) le risque est faible, mais pas scalable | 🟡 | Implémenter virtualisation dès Sprint 2.5 pour préparer le scaling. `@tanstack/react-virtual` est léger (~3KB). |

---

## E. Estimation finale Sprint 2

| Phase | Description | Effort | Cumul |
|-------|-------------|--------|-------|
| 2.0 | Multi-score profiles | 1j | 1j |
| 2.1 | Migration M1 Contacts enrichie | 2j | 3j |
| 2.2 | Migration M3 Custom Fields enrichie | 1j | 4j |
| 2.3 | Custom Fields UI builder | 2j | 6j |
| 2.4 | Smart Lists exécutables | 2j | 8j |
| 2.5 | Enrichissement Leads.tsx | 3j | 11j |
| 2.6 | Enrichissement LeadDetail.tsx | 4j | 15j |
| 2.7 | Tests E2E vertical complete | 1j | 16j |
| **Total Sprint 2** | | **~16j** | — |

**Cumul Sprint 0 + Sprint 1 + Sprint 2 = ~41j** (sweet spot de la decision matrix §15).

---

## F. Critère de réussite Sprint 2

À la fin du sprint, Rochdi doit pouvoir :

1. ✅ Importer ses 11 contacts Mathis depuis GHL en 1 clic
2. ✅ Créer un custom field "Couleur préférée" et le voir dans chaque LeadDetail
3. ✅ Sauvegarder une Smart List "Acheteurs budget > 500k" avec count live en sidebar
4. ✅ Ouvrir un contact → 9 tabs → note avec @mention → toggle DND
5. ✅ Bulk envoyer un email à 5 contacts sélectionnés via template

Si une action ne marche pas → Sprint 2 PAS terminé.

---

## G. Convention commits Sprint 2

```
feat(leads): ...           → enrichissement page liste
feat(lead-detail): ...     → enrichissement fiche détail
feat(custom-fields): ...   → P3.4.a UI builder
feat(smart-lists): ...     → P3.4.b listes intelligentes
feat(migrate-leads): ...   → migration M1+M3
feat(scoring): ...         → Q.4 multi-profiles
fix(leads): ...            → corrections bugs
refactor(leads): ...       → refactoring interne
```

---

## H. Anti-collision vérifié

```
git log --oneline -10 src/pages/Leads.tsx
  8434753 feat(crm): P0 complet (56j ago)

git log --oneline -10 src/worker/leads.ts
  64a9e63 fix(worker): handleWebhookLead (aujourd'hui)

git log --oneline -10 src/worker/migrate.ts
  8a1afb6 feat(migration): moteur complet (aujourd'hui)
```

**Aucune collision détectée.** Dernière modification Leads.tsx = P0 (il y a longtemps). Aucun autre agent n'a touché ces fichiers récemment.

---

_Document généré le 2026-05-10 par Antigravity. Vertical slice strategy — Sprint 2 Module Leads/Contacts._
