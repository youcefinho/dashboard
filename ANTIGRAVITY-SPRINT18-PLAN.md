# Sprint 18 — Slide-over panels + perf optimiste (~5-6j)

> **Objectif :** Différencier Intralys de GHL non par les features (perdu d'avance) mais
> par le **modèle d'interaction**. Faire ressentir un produit moderne style Linear/Notion
> face à un GHL qui sent l'outil-builder 2018.

## Contexte

GHL force du full-page reload partout — c'est leur faiblesse #1 en perception. On
inverse : clic sur un lead = panel à droite, on peut stacker, on revient au contexte
sans rien perdre. Couplé à de l'optimistic UI partout, l'effet ressenti est radicalement
différent même sans nouvelle feature.

Baseline visuelle préservée : palette cyan/orange Intralys sur fond clair (cf.
[memory: theme baseline](feedback_theme_baseline)). Aucun changement de palette ni
dark mode. On polish le ressenti, pas le look.

## Stack disponible

- `@radix-ui/react-dialog@1.1.15` — utilisé déjà par Modal, on l'étend pour panels
- `@tanstack/react-router@1.168.25` — URL state sync pour panels via `search` params
- `cmdk@1.1.1` — déjà bundlé, command palette base
- `sonner@2.0.7` — toast pour erreurs optimistic rollback
- View Transitions API — native browser (Chrome 111+, Safari 18+)

---

## Phase A — SlidePanel infrastructure (1j)

**A.1 — Composant `<SlidePanel>`** 🔴
- Wrapper Radix Dialog mais slide-from-right au lieu de center
- Animation : `translate-x-full → translate-x-0` 250ms ease-out
- Tailles : `sm` (380px), `md` (540px, défaut), `lg` (720px), `xl` (920px)
- Backdrop click + ESC = close (Radix gère)
- Header sticky avec titre + close + actions custom (slot)
- Body scrollable, footer sticky optionnel
- Compatible thème clair existant (`var(--bg-surface)`, `var(--border-subtle)`)
- Fichier : `src/components/ui/SlidePanel.tsx`

**A.2 — Stack manager** 🟠
- Hook `usePanelStack()` ou contexte qui empile les panels ouverts
- Panel N+1 ouvre au-dessus → panel N glisse de -64px à gauche (effet "carte sous carte")
- Z-index incrémenté automatiquement
- `ESC` ferme uniquement le top panel
- Limite 3 panels (au-delà = remplace plutôt qu'empile pour pas charger le DOM)
- Fichier : `src/components/ui/PanelStack.tsx`

**A.3 — URL state sync** 🟠
- Search params dans l'URL : `?panel=lead&id=lead-001&panel2=task&id2=task-042`
- Sérialisation : `{ type: 'lead', id: '...' }[]`
- Back/forward browser → pop/push panels
- Deep-link friendly : `/?panel=lead&id=lead-001` ouvre le panel direct
- Hook : `usePanelUrlSync()`

---

## Phase B — Migration LeadDetail vers panel (1j)

**B.1 — `<LeadDetailPanelContent>` refactor** 🟠
- Extraire le body de `LeadDetailPage` en composant pur qui prend `leadId` en prop
- Plus de `useParams`, plus de `AppLayout` — juste le contenu
- Fonctionne identique en page complète (wrappé dans AppLayout) ou en panel

**B.2 — Click depuis Leads list = panel** 🟠
- `Leads.tsx` table/cards : `onClick` → `openPanel({ type: 'lead', id })` au lieu de `navigate({ to })`
- Cmd/Ctrl+click ou middle-click = ouvrir en page (comportement web natif)
- Bouton "Ouvrir en page" dans le header du panel pour ceux qui veulent

**B.3 — Route `/leads/:id` reste valide** 🟡
- Deep link, partage URL, ouverture nouvel onglet → tout marche
- `LeadDetailPage` devient un wrapper léger autour de `<LeadDetailPanelContent>` + `<AppLayout>`

---

## Phase C — Optimistic UI partout (1.5j)

**C.1 — Hook `useOptimistic` générique** 🔴
- Pattern : `const [state, setOptimistic] = useOptimistic(serverState, reducer)`
- React 19 a déjà `useOptimistic` natif — l'utiliser
- Wrapper léger qui rollback automatique sur error et affiche toast
- Fichier : `src/hooks/useOptimisticMutation.ts`

**C.2 — Applications immédiates** 🟠
| Action | Fichier | Latence visible cible |
|---|---|---|
| Status change lead | `LeadDetail.tsx`, `Pipeline.tsx`, `Leads.tsx` | 0ms |
| Add/remove tag | `LeadDetail.tsx` | 0ms |
| Toggle favorite | `LeadDetail.tsx`, `Leads.tsx` | 0ms |
| Task complete/uncomplete | `Tasks.tsx`, `LeadDetail.tsx` | 0ms |
| Send message | `Inbox.tsx`, `ConversationPanel.tsx` | 0ms (message apparaît "sending" puis "sent") |
| Note add/delete | `LeadDetail.tsx` | 0ms |
| Pipeline drag (déjà fait, vérifier) | `Pipeline.tsx` | OK |

**C.3 — Rollback + toast error** 🟠
- Si la requête échoue : revert le state local, toast `error` avec message backend
- L'user voit la régression mais comprend pourquoi

---

## Phase D — Pre-fetch on hover (0.5j)

**D.1 — Cache simple in-memory** 🟡
- `src/lib/prefetch.ts` : Map<string, { data, ts, ttl }>
- Helpers `prefetchLead(id)`, `prefetchConversation(id)`, `prefetchPipeline(id)`
- TTL 30s — au-delà, le panel refetch

**D.2 — Wire hover** 🟡
- Leads rows : `onMouseEnter` (avec debounce 150ms pour éviter prefetch survol rapide) → `prefetchLead`
- Conversations list : idem
- Sidebar nav links : `prefetchRoute` (charge le JSON principal du route)
- Mobile : skip (pas de hover)

---

## Phase E — View Transitions API + skeleton matching (0.5j)

**E.1 — View Transitions sur route change** 🟡
- Wrapper sur `<Outlet>` ou intégration TanStack Router
- Si `document.startViewTransition` dispo : fade + slide subtil 200ms
- Fallback : `transition-opacity` CSS pur
- Pas de transitions sur les data-driven changes (juste route navigation)

**E.2 — Skeletons qui matchent le contenu** 🟡
- Audit visuel : pour chaque page principale, le skeleton actuel ressemble-t-il au contenu final ?
- Pages prioritaires : Dashboard (4 stat cards + chart), Leads (table headers + rows), LeadDetail (header card + tabs)
- Remplacer les rectangles génériques par des blocs qui matchent (largeur colonnes, hauteur lignes)
- Évite le "flash of rearranged content"

---

## Phase F — Build + tests + clôture (0.5j)

- `bun run build` vert
- `bun run test --run` vert (193+ tests)
- Smoke test manuel :
  - Click lead dans Leads → panel à droite ouvre
  - Click task dans le panel lead → 2e panel par-dessus
  - ESC ferme top panel, ESC ferme suivant
  - Deep link `/?panel=lead&id=lead-001` ouvre direct
  - Click "Ouvrir en page" → URL passe à `/leads/lead-001` page complète
  - Changer status lead → bascule instantanée, pas de spinner
  - Hover row Leads → réseau dev tools montre prefetch
- ROADMAP.md : Sprint 18 → ~200j cumulés
- Update [docs/UX-FRICTION-AUDIT.md](docs/UX-FRICTION-AUDIT.md) avec note sur le shift d'UX
- `git mv ANTIGRAVITY-SPRINT18-PLAN.md docs/archive/`

---

## Critères de succès Sprint 18

- [ ] `<SlidePanel>` composant utilisable comme drop-in remplaçant pour navigation détail
- [ ] Stack jusqu'à 3 panels avec gestion z-index + slide-back
- [ ] URL sync : panels survivent au refresh + back/forward browser
- [ ] Lead detail accessible via panel OU page (les 2 marchent)
- [ ] 6 actions critiques en optimistic UI (status, tag, favorite, task complete, message, note)
- [ ] Rollback + toast sur error pour chaque
- [ ] Pre-fetch on hover sur Leads + Conversations
- [ ] View Transitions API en place avec fallback gracieux
- [ ] Build vert + 193+ tests verts
- [ ] Aucune régression mobile (panels deviennent bottom-sheet sur <md ? à arbitrer Phase A)

---

## Hors scope (Sprint 19+ si poursuite UX/UI)

- **Command palette intent engine** (~3j) — étendre ⌘K en commandes ("créer lead X", "déplacer Y")
- **AI inline natif** (~4-5j) — Sparkles button dans chaque textarea
- **Multi-user awareness** (live cursors Figma-style)
- **Density modes** (compact/comfortable/spacious)
- **Sound design + haptics mobile**
- **Dark mode toggle** (V2 backlog uniquement, baseline reste claire)

---

_Plan créé le 2026-05-13 après validation user "fait tout ce qui faut" sur l'angle slide-overs + perf. Sera archivé dans docs/archive/ à la fin du sprint._
