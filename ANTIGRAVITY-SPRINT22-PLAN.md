# Sprint 22 — Stack démo + Activity feed + Timeline unifiée (~5j)

> **Objectif :** Compléter l'histoire panel stack (TaskPanel pour démo 3-deep),
> ajouter l'Activity feed temps réel, et enrichir la Lead timeline en vue
> chronologique unifiée multi-sources.

## Phase A — TaskPanel + getTask backend (~1.5j)
- Backend : `handleGetTask` ([src/worker/tasks.ts](src/worker/tasks.ts)) + route GET `/api/tasks/:id`
- Frontend : `getTask(id)` dans lib/api
- `<TaskPanel>` ([src/components/panels/TaskPanel.tsx](src/components/panels/TaskPanel.tsx)) : SlidePanel
  avec status pills, priority pills, due date, description (avec AiSparkles),
  subtasks (toggle + add + remove), comments (avec AiSparkles + add + remove),
  delete via header action
- Registré dans `PANEL_RENDERERS` de App.tsx
- LeadDetail : click task ouvre TaskPanel **par-dessus** LeadPanel (stack 2-deep)
- Demo stack 3-deep : Lead → Task → re-clic LeadLink dans la task → 2e LeadPanel

## Phase B — Activity stream feed (~1.5j)
- `<ActivityFeedPanel>` ([src/components/ActivityFeedPanel.tsx](src/components/ActivityFeedPanel.tsx)) :
  - Slide-over right via SlidePanel (réutilise infra Sprint 18)
  - Bouton `Activity` dans le header AppLayout
  - Polling 30s auto (interval cleared on close)
  - Group by day, sticky headers
  - Click sur lead_name → ouvre LeadPanel via LeadLink (intégration sprint 18)
  - Bouton refresh manuel + indicateur loading

## Phase C — Lead Timeline unifiée (~1.5j)
- `<LeadTimeline>` ([src/components/panels/LeadTimeline.tsx](src/components/panels/LeadTimeline.tsx)) :
  - Merge dans un seul flux chrono : activity_log + notes + appointments + tasks
  - Sort desc, group by day avec headers sticky
  - Pastille colorée + icône Lucide par type
  - Description truncate 200 chars, meta line (catégorie/échéance/etc.)
- Remplace l'ancienne timeline simple de l'onglet Activité de LeadDetail
- Réutilise data déjà chargée (leadNotes, leadAppointments, leadTasks, lead.activity)

## Phase D — Clôture (~0.5j)
- Build + tests verts
- Smoke test stack 3-deep
- Memory + ROADMAP + archive plan
