# ANTIGRAVITY-SPRINT4-PLAN.md — Pivot Générique + Pipeline + Workflows

## A. Auto-audit hardcoded "courtier / immobilier" dans le code

Voici les résultats de la recherche `grep -rn -i "courtier\|immobilier\|acheteur\|vendeur\|AMF\|OACIQ\|Centris\|RE/Max\|Mathis" src/` :

1. **`src/components/layout/Sidebar.tsx`** & **`src/pages/Settings.tsx`**
   - *Match* : `isAdmin ? 'Administrateur' : 'Courtier'`
   - *Action* : Renommer 'Courtier' en 'Agent' ou 'Utilisateur'.
2. **`src/components/CommandPalette.tsx`**
   - *Match* : `label: 'Clients', description: 'Gestion des courtiers'`
   - *Action* : Renommer en 'Gestion des clients/sous-comptes'.
3. **`src/lib/types.ts`** & **`src/pages/ClientLeads.tsx`** & **`src/pages/Reports.tsx`**
   - *Match* : `buy: 'Acheteur', sell: 'Vendeur'`
   - *Action* : Retirer/remplacer l'enum `type` par `inbound`, `qualified`, `customer` ou le transformer en custom field optionnel.
4. **`src/pages/Clients.tsx`**
   - *Match* : `Liste des courtiers`, placeholder `Mathis Guimont`, `courtier@email.com`
   - *Action* : Remplacer par des termes génériques (ex: Liste des agences/sous-comptes, placeholder "Client Démo").
5. **`src/pages/Documents.tsx`** & **`src/pages/DocumentTemplates.tsx`**
   - *Match* : `placeholder="Ex: Mandat de courtage acheteur"`
   - *Action* : Remplacer par "Ex: Contrat de prestation de services".
6. **`src/pages/Integrations.tsx`**
   - *Match* : `Centris.ca`, `Importez les fiches propriétés...`, `Numéro de courtier`
   - *Action* : Déplacer l'intégration Centris dans un "Pack Immobilier" optionnel (ou la masquer temporairement pour le MVP générique).
7. **`src/pages/Templates.tsx`**
   - *Match* : Variables `{{courtier}}`, `courtier@intralys.com`
   - *Action* : Remplacer par `{{agent}}` ou `{{user_name}}`, et `contact@intralys.com`.
8. **`src/worker/ai.ts`** & **`src/worker/reviews.ts`** & **`src/lib/api.ts`**
   - *Match* : Prompts avec "Tu es un expert en qualification de leads immobiliers au Québec", `centris_description`, "assistant d'un courtier immobilier".
   - *Action* : Paramétrer le prompt via `client.business_type` et retirer les actions spécifiques à Centris.
9. **`src/worker/scoring.ts`**
   - *Match* : "Score acheteur", "Score vendeur"
   - *Action* : Remplacer par "Score prospect", "Score client".
10. **`src/worker/broadcast.ts`**, **`src/worker/messages.ts`**, **`src/worker/compliance.ts`**, **`src/pages/settings/ComplianceSettings.tsx`**
    - *Match* : `AMF`, `Certificat AMF`, "Message de votre courtier"
    - *Action* : Renommer l'AMF en "Mentions légales personnalisées" ou la rendre toggleable par industrie. Remplacer "votre courtier" par "notre équipe".
11. **Mocks & Tests** (`mock-anthropic.ts`, `mock-gbp.ts`, `ai.test.ts`, `helpers.test.ts`)
    - *Match* : `Mathis`, `Centris`, description de maison, etc.
    - *Action* : Modifier les fixtures pour utiliser des exemples génériques ou liés aux 3 industries du plan (Cleaning, Dental, Coaching).

---

## B. Plan détaillé Phase A — Ajustements génériques (1.5j)

**A.1 — Types et enums universalisés (0.5j)**
- `src/lib/types.ts` :
  - Renommer `LEAD_TYPES` : `['inbound', 'qualified', 'customer']`
  - Renommer `STATUS_LABELS` en FR : Nouveau / Contacté / Qualifié / Gagné / Fermé / Perdu
  - Aligner `LEAD_STATUSES` : `new, contacted, qualified, won, closed, lost`
- Migration SQL (`migration-phase21.sql`) pour appliquer le mapping sur la base existante.

**A.2 — Templates email/SMS génériques (0.5j)**
- 6 templates universels ("Bienvenue", "Relance J+1", "J+3", "J+7", "Conf RDV", "Rappel 24h").
- Variables universelles : `{{name}}`, `{{first_name}}`, `{{business_name}}`, `{{user_name}}`, `{{appointment_date}}`.
- Retrait de toutes mentions spécifiques (immobilier, courtier).

**A.3 — Seed data 3 industries différentes (0.5j)**
- Refonte de `seed.sql` avec 3 clients de démo :
  - **Lumière Nettoyage Pro** (Cleaning, #009DDB)
  - **Dr. Tremblay Dentisterie** (Dental, #37CA37)
  - **Coach Performance Plus** (Coaching, #757BBD)
- Données réalistes par client (10 leads, 1 pipeline, 3 workflows, custom fields, conversations, tasks).

---

## C. Plan détaillé Phase B — Vertical Pipeline (7.5j)

**B.1 — Migration phase22 : Multi-pipelines + custom stages (1j)**
- Table `pipelines` : ajout `is_default`, `color`.
- Table `pipeline_stages` : ajout `probability`, `color`, `wip_limit`, `sla_days`.
- Création de `lost_reasons` (label, sort_order).

**B.2 — Backend handlers (1.5j)**
- CRUD complet `pipelines` + stats par stage.
- Réordonnancement drag&drop.
- Endpoint forecast de revenus.
- Endpoints `lost-reasons` et action `mark-lost`.

**B.3 — Frontend Pipeline page enrichie (3j)**
- Sélecteur multi-pipelines.
- Vues : Kanban, Liste, Forecast.
- Cartes enrichies : deal value, alertes SLA/WIP, quick actions, jours dans l'étape.
- Drag & Drop et animations.
- Inline edit et Bulk actions.
- Page de Settings pour les pipelines (CRUD & drag&drop des colonnes).

**B.4 & B.5 — Tests (2j)**
- Smoke tests Vitest (création pipeline, reorder, forecast).
- Tests E2E manuels sur Kanban et multi-pipelines.

---

## D. Plan détaillé Phase C — Vertical Workflows (8j)

**C.1 — Migration phase23 : triggers/actions (1j)**
- Table `workflows` enrichie (folder, reenrollment, quiet hours, business hours).
- Tables `workflow_folders`, `trigger_links`, `trigger_link_clicks`.
- Table `workflow_steps` (parent_step_id, branch pour conditionnelles).

**C.2 — Backend workflow engine étendu (3j)**
- 12 nouveaux Triggers (email_opened, link_clicked, form_submitted, appointment_booked, etc.).
- 11 nouvelles Actions (create_task, webhook, ai_action, send_internal_email, trigger_another_workflow, etc.).
- Wait conditions étendues (event, specific date, time of day, business hours).
- Endpoints de configuration, dry-run, analytics.

**C.3 — Email tracking (1j)**
- Pixel tracking `1x1` transparent et log des ouvertures.
- Link wrapper pour tracker les clics et déclencher les workflows.

**C.4 — Frontend Workflows pages enrichies (2j)**
- Page Liste : dossiers sidebar, statistiques de conversion, bouton "+ New from template".
- Détail : top bar avec bouton Publish, propriétés du step, onglets (Config, Enrollments, Analytics).
- Builder : toolbox drag&drop des steps.

**C.5 — Tests (1j)**
- Vitest smoke tests sur le moteur (triggers, quiet hours, test-run dry-run).
- Tests E2E manuels sur une campagne nurturing complète.

---

## E. Risques techniques

1. **Complexité de l'executor (12 triggers + 11 actions)** : Risque de boucle infinie ou crash. *Mitigation : Tests unitaires systématiques par type de nœud et garde-fous (limite de sauts).*
2. **Email Tracking Endpoint public** : Endpoint sans auth vulnérable au scraping ou aux faux événements. *Mitigation : Validation de HMAC dans l'URL du pixel/lien.*
3. **Wait scheduler intelligent** : Un cron minute n'est pas idéal pour `wait_for_event`. *Mitigation : Table `wait_events` scrutée par le cron existant.*
4. **Renommage Enums** : Changer `meeting` -> `qualified` peut casser l'UI existante. *Mitigation : Grep exhaustif et update strict.*
5. **Multi-pipelines Default** : Les leads existants sans `pipeline_id` doivent être basculés vers un Pipeline par défaut pour éviter de les perdre.

---

## F. Estimation globale

| Phase | Effort | Cumul |
|-------|--------|-------|
| A — Ajustements génériques | 1.5j | 1.5j |
| B — Vertical Pipeline | 7.5j | 9j |
| C — Vertical Workflows | 8j | 17j |
| **Total Sprint 4** | **~17j** | — |

**Auto-mode activé : passage à l'étape A.1 (Universalisation des types et enums) immédiat.**
