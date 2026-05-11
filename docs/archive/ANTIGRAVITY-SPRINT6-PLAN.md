# Plan d'Implémentation - Sprint 6: Différenciateurs Intralys

## Objectif du Sprint
Implémenter 7 fonctionnalités "différenciatrices" (killer features) qui distinguent l'Intralys CRM de GoHighLevel (GHL) et apportent une forte valeur métier (immobilière, dentaire, coaching, etc.). Aucune nouvelle fonctionnalité *core* CRM, uniquement de la valeur ajoutée pour la vente.

---

### D1 — AI Lead Scoring Contextualisé (2j)
Enrichir la mécanique de score dans `src/worker/scoring.ts` :
- **Configuration** : Ajouter `business_type`, `brand_voice`, et `scoring_prompt_extra` au contexte du client.
- **Prompt LLM** : Ajuster le prompt système : *"Tu es un expert en qualification leads pour {{business_type}}. Ton du client : {{brand_voice}}..."*
- **Auto-rescore** : S'assurer que les événements déclenchent le rescore (via `lead_score_changed`).
- **UI** : Page Settings > Scoring pour modifier ces variables.
- **Seed** : 3 profils par défaut (Qualification globale, Score chaud, Score qualifié).

#### Fichiers touchés :
- `src/worker/scoring.ts`
- `src/worker/ai.ts`
- `src/pages/Settings.tsx`

---

### D2 — AI Content Generator FR Québécois (1.5j)
Améliorer `handleAiGenerate` dans `src/worker/ai.ts` :
- **8 actions IA** : `email_followup`, `email_welcome`, `sms_followup`, `social_post`, `objection_handler`, `meeting_agenda`, `proposal_intro`, `recap_call`.
- **Paramétrage** : Prendre en compte `client.brand_voice`.
- **UI** : Bouton "✨ Générer avec IA" dans `Templates` et `MessageComposer`.

#### Fichiers touchés :
- `src/worker/ai.ts`
- `src/components/Inbox/MessageComposer.tsx`
- `src/pages/Templates.tsx`

---

### D3 — Carte Interactive Mapbox (1.5j)
Vue de la carte des Leads avec géocodage :
- **Migration `phase27`** : Ajout de `lat REAL` et `lng REAL` à la table `leads`.
- **Vue UI** : Ajouter le mode "map" dans `src/pages/Leads.tsx` (switcher list/cards/map) utilisant `mapbox-gl`.
- **Mock** : Fallback et marqueurs simulés pour le Québec.

#### Fichiers touchés :
- `migration-phase27.sql`
- `src/pages/Leads.tsx`
- `src/worker/leads.ts`

---

### D4 — Dashboard Métier Configurable (2j)
Refonte complète du Dashboard :
- **Migration `phase28`** : Table `dashboard_layouts`.
- **UI `/dashboard`** : Mode Édition avec `dnd-kit` pour glisser-déposer les widgets (KPI, Funnel, Revenue, Activity, etc.).
- **Templates** : Packs d'industries (Generic, Real Estate, Cleaning, Dental, Coaching) installables via Settings.

#### Fichiers touchés :
- `migration-phase28.sql`
- `src/pages/Dashboard.tsx`
- `src/worker/dashboard.ts`

---

### D5 — Signature Mandat 1-Clic depuis SMS (1j)
Fonctionnalité de signature fluide mobile-first :
- **Action de workflow** : `send_signing_link_sms`.
- **UI Mobile** : Route `/s/:token` pour afficher et signer (HTML5 canvas touch).
- **Backend** : PDF généré via `pdf-lib` et envoyé par email au lead.

#### Fichiers touchés :
- `src/pages/SignDocument.tsx` (ou modif si existant)
- `src/worker/documents.ts`
- `src/worker/workflows.ts`

---

### D6 — Mode "Agent en Visite" Mobile (2j)
Vue optimisée mobile pour les visites :
- **Route `/visit/:lead_id`** : Vue 1 colonne, gros boutons touch.
- **Checklist** : Checklist dynamique basée sur des champs customisés.
- **Upload direct** : Photos + notes vocales vers R2.

#### Fichiers touchés :
- `src/pages/VisitMode.tsx`
- `src/worker/leads.ts`

---

### D7 — Système Packs Industrie (2j)
Création d'un système de packs JSON pour tout installer d'un coup :
- **Migration `phase29`** : Table `industry_packs`.
- **Packs seedés** : Generic B2B, Real Estate Pro QC, Local Services, Health & Wellness, Coaching.
- **Backend** : Endpoint d'installation idempotente cascade (custom fields, templates, workflows).
- **UI** : Settings > Packs avec bouton "Installer".

#### Fichiers touchés :
- `migration-phase29.sql`
- `src/worker/packs.ts`
- `src/pages/Settings.tsx`
- `src/worker.ts`

---

## Verification Plan

### Tests Unitaires & Intégration
- `bun run test` : Ajout de 20-30 tests dans un fichier dédié `src/worker/__tests__/differentiators.test.ts`.
- Mocks complétés pour l'IA et Mapbox.

### Tests E2E Manuels
1. AI Scoring paramétré "Dentisterie" réagit bien au prompt spécialisé.
2. Vue Map dans Leads affiche 5 marqueurs québécois avec clustering.
3. Dashboard Edition sauve le layout par utilisateur.
4. Workflow d'envoi de signature SMS, signature tactile sur mobile, et génération PDF.
5. Mode "Agent en visite" responsif testé avec les DevTools Chrome en mode iPhone.
6. L'installation d'un "Pack Industrie" crée instantanément tous les workflows, champs et modèles attendus.
