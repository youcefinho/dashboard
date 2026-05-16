# Sprint 17 — Crédibilité avant beta (~1-2j)

> **Objectif :** finir les P0/P1 résiduels de [docs/UX-FRICTION-AUDIT.md](docs/UX-FRICTION-AUDIT.md)
> pour que les 5 beta tournent sur un dashboard sans mensonges UI, sans natifs JS et
> sans boutons dead-click. Pas de nouvelle feature — uniquement du polish data-integrity.

## Contexte

L'audit [docs/UX-FRICTION-AUDIT.md](docs/UX-FRICTION-AUDIT.md) a été produit aujourd'hui (09:09) avec
8 P0 + 17 P1 + 10 P2 identifiés sur 6 pages cœur (Dashboard, Leads, LeadDetail, Pipeline, Inbox, Calendar).

**Vérif manuelle (09:33–13:00) — la majorité des P0 a déjà été corrigée** :

| Audit P0 | État réel |
|---|---|
| Dashboard `growthPct` faux | ✅ déjà fixé — `TODO` à [Dashboard.tsx:154-157](src/pages/Dashboard.tsx#L154-L157), plus de calcul mensonger |
| Dashboard deltas KPIs hardcodés `+28.3%` etc. | ✅ déjà fixé — disparus du fichier |
| Dashboard score random | ✅ déjà fixé — `lead.score ?? 0` à [Dashboard.tsx:498](src/pages/Dashboard.tsx#L498) |
| Leads pins map random | ✅ déjà fixé — commentaire à [Leads.tsx:45](src/pages/Leads.tsx#L45) |
| LeadDetail custom_fields double source | ✅ déjà fixé — source unique `customFields` state ([LeadDetail.tsx:307](src/pages/LeadDetail.tsx#L307)) |
| LeadDetail `window.location.reload()` | ✅ déjà fixé — `void loadLead()` partout |
| Calendar `client_id: 'internal'` | ✅ déjà fixé — `client_id: formClientId` à [Calendar.tsx:151](src/pages/Calendar.tsx#L151) |
| `confirm/alert/prompt` natifs ×6 | ✅ partiellement — pages cœur migrées via [ConfirmDialog.tsx](src/components/ui/ConfirmDialog.tsx). Reste 3 oubliés en Settings. |

**Conclusion** : Sprint 17 = nettoyage des résidus + sélection P1 ciblée. ~1 jour suffit pour
clore la crédibilité avant beta.

---

## Phase A — Nettoyage résidus P0/P1 critiques (0.5j)

**A.1 — 3 natifs JS restants** 🔴 — `~15 min`
Remplacer par l'API `await confirm({...})` du [ConfirmDialog.tsx](src/components/ui/ConfirmDialog.tsx) déjà en place.

- [src/components/settings/SnippetsSettings.tsx:62](src/components/settings/SnippetsSettings.tsx#L62) — `confirm('Êtes-vous sûr de vouloir supprimer cette réponse rapide ?')`
- [src/components/settings/SecuritySettings.tsx:35](src/components/settings/SecuritySettings.tsx#L35) — `confirm('Voulez-vous vraiment fermer toutes les autres sessions ?')`
- [src/components/settings/SecuritySettings.tsx:44](src/components/settings/SecuritySettings.tsx#L44) — `confirm('Générer de nouveaux codes de secours invalidere les anciens. Continuer ?')`

Référence pattern : [Properties.tsx:72](src/pages/Properties.tsx#L72) ou [Templates.tsx:87](src/pages/Templates.tsx#L87).

**A.2 — Dashboard dead-clicks** 🔴 — `~30 min`
3 CTAs visibles sans `onClick` → soit wire, soit retire.

- [Dashboard.tsx:201-204](src/pages/Dashboard.tsx#L201-L204) — bouton "Exporter" hero. Wire vers export leads CSV (réutiliser le pattern de [Leads.tsx](src/pages/Leads.tsx) `handleExportCsv` si présent) OU le retirer si pas de fonction.
- [Dashboard.tsx:470-473](src/pages/Dashboard.tsx#L470-L473) — bouton "Filtrer" table contacts. Retirer (pas de filtres prévus sur ce widget) ou ouvrir un menu Popover de filtres simples.
- Tout autre CTA "Gérer les champs" du widget custom fields → wire vers `/settings/custom-fields` ou retirer.

**A.3 — Dashboard "Live" badge sans liveness** 🟠 — `~20 min`
[Dashboard.tsx:352-359](src/pages/Dashboard.tsx#L352-L359) — badge avec `pulse-live` animation suggère du WS/polling mais l'activité ne se rafraîchit jamais.

Choix simple : retirer le badge **ou** ajouter `setInterval(load, 30_000)` (30s suffit pour activité récente).
Recommandation : retirer le badge — l'activité récente n'est pas critique-en-temps-réel et ajouter du polling tape inutilement l'API.

---

## Phase B — stageProbability unifié (0.5j)

**B.1 — Source unique pour la probability d'un stage** 🟠 — `~2-3h`

[LeadDetail.tsx:165-166](src/pages/LeadDetail.tsx#L165-L166) hardcode :
```ts
const stageProbability: Record<string, number> = { new: 10, contacted: 25, meeting: 50, signed: 90, closed: 100, lost: 0 };
const forecast = (lead.deal_value || 0) * (stageProbability[lead.status] || 0) / 100;
```

Or le backend renvoie déjà `stage.probability` (cf. settings Pipeline). Drift garanti dès qu'un user édite ses stages.

**Actions :**
1. Vérifier l'API : `getPipelineStages()` ou équivalent dans [src/lib/api.ts](src/lib/api.ts) retourne-t-il `probability` par stage ?
2. Charger les stages au mount de `LeadDetail` (Promise.all avec les autres fetchs) — ajouter `pipelineStages` au state
3. Calculer `forecast = lead.deal_value * (pipelineStages.find(s => s.key === lead.status)?.probability ?? 0) / 100`
4. Idem pour la barre de progression à [LeadDetail.tsx:531-533](src/pages/LeadDetail.tsx#L531-L533)
5. Si l'API ne retourne pas `probability`, l'ajouter (migration SQL + endpoint update)

**Critère d'acceptation** : éditer la probability d'un stage dans Settings → Pipeline, recharger LeadDetail, la valeur affichée change.

---

## Phase C — P1 sélectionnés sans risque (0.5j)

**C.1 — EmptyState Leads message contextuel** 🟡 — `~30 min`
[Leads.tsx:432-434](src/pages/Leads.tsx#L432-L434) affiche le même message si filtres OU si vraiment vide. Splitter :

```tsx
{hasActiveFilters ? (
  <EmptyState icon={...} title="Aucun lead ne correspond à vos filtres"
    action={<Button onClick={resetFilters}>Réinitialiser</Button>} />
) : (
  <EmptyState icon={...} title="Aucun lead encore"
    description="Créez-en un manuellement ou attendez vos captures formulaire."
    action={<Button onClick={openCreateModal}>Nouveau lead</Button>} />
)}
```

**C.2 — Inbox "Sélectionnez une conversation" contextuel** 🟡 — `~20 min`
[Inbox.tsx:181-187](src/pages/Inbox.tsx#L181-L187) — distinguer "inbox vide" vs "rien sélectionné" :
- `conversations.length === 0` → "Pas de conversations encore" + suggestion (FB Messenger, WebChat install)
- `conversations.length > 0 && !activeConv` → "Sélectionnez une conversation à gauche pour commencer"

**C.3 — LeadDetail badge count Conversations** 🟡 — `~15 min`
[LeadDetail.tsx:315](src/pages/LeadDetail.tsx#L315) — l'onglet "Notes" a `(X)`, "Conversations" n'en a pas. Ajouter `Conversations ({conversations.length})` pour cohérence.

**C.4 — Pipeline "Déposez ici" sur colonne active uniquement** 🟡 — `~30 min`
[Pipeline.tsx](src/pages/Pipeline.tsx) — utiliser `isOver` de `@dnd-kit/core` pour ne montrer le placeholder qu'au survol pendant un drag actif. Sinon afficher juste un `—` discret.

---

## Phase D — Build + tests + clôture (0.25j)

**D.1 — Vérif globale**
- `bun run build` vert
- `bun run test --run` vert (193+ tests, pas de régression)
- Smoke test manuel : delete d'un snippet/session/backup codes via UI → modal cohérent (plus de native)
- Smoke test : LeadDetail forecast change si tu modifies la probability d'un stage dans Settings

**D.2 — Documents**
- [ROADMAP.md](ROADMAP.md) — Sprint 17 dans accomplis (~194j cumulés)
- `git mv ANTIGRAVITY-SPRINT17-PLAN.md docs/archive/`
- Update [docs/UX-FRICTION-AUDIT.md](docs/UX-FRICTION-AUDIT.md) avec une note "Sprint 17 a couvert : A.1, A.2, A.3, B.1, C.1-4"

---

## Hors scope Sprint 17 (renvoyés à 17.5 / 18 si décidé)

Items P1 restants de l'audit qui demandent + de travail ou + de risque :

- **Calendar timezone refactor** (sensible, ~4h) — risque casser les RDV cross-fuseaux
- **LeadDetail notes legacy dedup** (`lead.notes` champ texte vs `leadNotes[]` structurées, ~2h)
- **LeadDetail edit inline sur blur** (confirmation ou bouton Save, ~1h)
- **Mobile responsive Dashboard table** (cards sous 768px, ~2h)
- **Inbox WS status indicator** (~1h)
- **Keyboard hints `⌘K`** (~30 min)
- **Bulk "select all matching filter"** Leads (~1h)

Tous les **P2** (polish animations, lazy imports, DnD widgets reorder, etc.) attendent post-traction.

---

## Résumé effort

| Phase | Effort | Items |
|---|---|---|
| A — Résidus P0/P1 critiques | 0.5j | 3 natifs + 3 dead-clicks + Live badge |
| B — stageProbability unifié | 0.5j | Source unique backend, suppression hardcode |
| C — P1 sélectionnés sans risque | 0.5j | 4 micro-fixes |
| D — Build + tests + clôture | 0.25j | CI vert, ROADMAP, archive plan |
| **Total** | **~1.5-2j** | **~10 items** |

---

## Critères de succès Sprint 17

- [ ] 0 occurrence de `confirm(`/`alert(`/`prompt(` natif dans `src/**/*.tsx` (hors tests + hors `await confirm/prompt`)
- [ ] 0 bouton sans `onClick` ni `href` ni `type="submit"` dans Dashboard
- [ ] Badge "Live" retiré OU vraie liveness (polling 30s)
- [ ] `stageProbability` hardcodé éliminé — source unique = backend `stage.probability`
- [ ] EmptyState Leads affiche le bon message selon `hasActiveFilters`
- [ ] Build vert + 193+ tests verts + 0 erreurs TS
- [ ] [UX-FRICTION-AUDIT.md](docs/UX-FRICTION-AUDIT.md) annoté avec items couverts

---

## Fichiers critiques à modifier

- [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx) — dead-clicks + Live badge
- [src/pages/LeadDetail.tsx](src/pages/LeadDetail.tsx) — stageProbability + Conversations count
- [src/pages/Leads.tsx](src/pages/Leads.tsx) — EmptyState contextuel
- [src/pages/Inbox.tsx](src/pages/Inbox.tsx) — message contextuel
- [src/pages/Pipeline.tsx](src/pages/Pipeline.tsx) — "Déposez ici" conditionnel
- [src/components/settings/SnippetsSettings.tsx](src/components/settings/SnippetsSettings.tsx) — natif #1
- [src/components/settings/SecuritySettings.tsx](src/components/settings/SecuritySettings.tsx) — natifs #2 et #3
- [src/lib/api.ts](src/lib/api.ts) — possiblement étendre `getPipelineStages()` si la propriété `probability` n'est pas exposée
- [docs/UX-FRICTION-AUDIT.md](docs/UX-FRICTION-AUDIT.md) — annoter items couverts à la fin

## Utilitaires existants à réutiliser

- [src/components/ui/ConfirmDialog.tsx](src/components/ui/ConfirmDialog.tsx) — `confirm()` / `prompt()` non-natif
- [src/components/ui/Toast.tsx](src/components/ui/Toast.tsx) — `useToast()` (success / toastError)
- [src/components/ui/EmptyState.tsx](src/components/ui/EmptyState.tsx) — pattern empty state unifié
- [src/components/ui/Modal.tsx](src/components/ui/Modal.tsx) — Modal Radix (Sprint 16 migration)

---

## Vérification end-to-end

1. `bun run dev` puis naviguer :
   - Settings → Snippets → supprimer un snippet → modal ConfirmDialog s'ouvre (plus de native popup)
   - Settings → Sécurité → "Fermer autres sessions" + "Régénérer codes secours" → modaux ConfirmDialog
   - Dashboard → bouton "Exporter" et "Filtrer" → fait quelque chose OU n'existe plus
   - Dashboard → badge "Live" absent OU activité se rafraîchit à 30s d'intervalle
   - Pipeline Settings → modifier probability d'un stage → LeadDetail affiche la nouvelle valeur
   - Leads sans filtres + 0 lead → message "Aucun lead encore" + CTA "Nouveau lead"
   - Leads avec filtres + 0 résultat → message "Aucun lead ne correspond" + CTA "Réinitialiser"
2. `bun run build` vert
3. `bun run test --run` vert (regarder count de tests, doit être 193+)

---

_Plan créé le 2026-05-13 après vérif que ~70% des P0 du UX-FRICTION-AUDIT étaient déjà corrigés. Sera archivé dans docs/archive/ à la fin du sprint._
