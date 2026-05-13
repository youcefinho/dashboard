# Sprint 19 — AI native partout + Command palette puissant (~5j)

> **Objectif :** Poursuivre la différenciation UX vs GHL avec les paris #4 (AI inline natif)
> et #2 (Command palette intent engine) du Sprint 18. AI Sparkles dans chaque textarea
> donne un effet "wow" immédiat sur tout user qui tape un message. Command palette
> étendu en intent engine fait de ⌘K l'accélérateur power-user style Linear/Raycast.

## Contexte

Sprint 18 a posé l'infra slide-overs + perf optimiste. Pour la beta, on rajoute :
- AI : différenciateur français québécois — sparkles dans chaque textarea, "Améliorer ce
  texte" + variations contextuelles (raccourcir, traduire, formaliser, etc.)
- Command palette : ⌘K existe en tant que recherche pure. On l'étend avec des **actions**
  ("créer lead jean dupont", "déplacer en contacted", "aller au pipeline").

Stack disponible : `aiGenerate()` existe déjà ([src/lib/api.ts:1393](src/lib/api.ts#L1393))
avec 8 actions hardcodées. On ajoute une 9e action `improve_text` (rewrite générique) +
on expose un endpoint inline.

Baseline visuelle préservée (light theme cyan/orange).

---

## Phase A — AI Sparkles inline (~2j)

**A.1 — Backend : action `improve_text` (~0.5j)** 🔴
- Étendre `AI_ACTIONS` dans [src/worker/ai.ts:102-105](src/worker/ai.ts#L102) avec :
  - `improve_text` — rewrite & polish général
  - `shorten` — réduire de 50%+
  - `formalize` — registre formel/professionnel
  - `casualize` — registre amical/casual
- Le `handleAiGenerate` reçoit `text` en body (le texte actuel à transformer) et `instruction` optionnelle
- System prompt commun : FR québécois, garder le sens, retourner UNIQUEMENT le texte transformé (pas de préambule)
- Frontend `aiGenerate()` étendu pour accepter `text` + nouveau actions

**A.2 — Composant `<AiSparkles>` (~1j)** 🔴
- Bouton flottant en bottom-right d'un textarea/input avec icône Sparkles
- Click → menu Popover avec 4 options : "Améliorer ✨", "Raccourcir 📏", "Formel 👔", "Amical 😊"
- Loading state : sparkles tournent + textarea passe en `cursor-wait`
- Retour : remplace le contenu du textarea, avec animation flash subtile
- Boutons "Garder" / "Annuler" en bottom du textarea pendant 5s post-application (undo facile)
- Support `disabled` quand texte vide
- Fichier : `src/components/ui/AiSparkles.tsx`

**A.3 — Wire dans pages prioritaires (~0.5j)** 🟠
- [LeadDetail.tsx](src/pages/LeadDetail.tsx) — textarea Note (legacy + nouveau formulaire)
- [LeadDetail.tsx](src/pages/LeadDetail.tsx) — textarea note ajout
- [ConversationPanel.tsx](src/components/conversations/ConversationPanel.tsx) — textarea compose message
- [Inbox.tsx](src/pages/Inbox.tsx) — composer message
- [Templates.tsx](src/pages/Templates.tsx) — body template (si textarea visible)
- Pas tous les textareas — juste ceux où l'AI a vraiment du sens

---

## Phase B — Command palette intent engine (~2j)

**B.1 — Parse d'intent (~0.5j)** 🟠
- Étendre [CommandPalette.tsx](src/components/CommandPalette.tsx) avec un parser simple :
  - Pattern `/^(creer|create|new|nouveau)\s+lead\s+(.+)/i` → intent `create-lead` avec nom
  - Pattern `/^(aller|go|navigate)\s+(?:au|to)?\s*(\w+)/i` → intent `navigate`
  - Pattern `/^(supprimer|delete|trash)\s+(.+)/i` → intent `bulk-trash`
  - Pattern fallback → search classique (existant)
- Affichage : si intent reconnu, montrer une "action item" en haut avant les résultats search

**B.2 — Actions exécutables (~1j)** 🟠
- `create-lead <nom>` : POST /leads avec nom seul (les autres champs vides, edit après)
  - Toast success + ouvre le panel du nouveau lead
- `navigate <page>` : navigate vers la page (fuzzy match contre les routes connues)
- `open <type> <id-or-name>` : ouvre un panel (lead, etc.)
- `move <lead> to <status>` : update lead status (avec recherche fuzzy du lead)
- Pas d'actions destructives sans confirmation (delete passe par useConfirm)

**B.3 — Affordances UI (~0.5j)** 🟡
- Indicateur visuel "🎯 Action détectée" en haut du palette
- Hint subtil sous l'input : "Essayez : « nouveau lead Jean Dupont »" (rotation entre 3-4 exemples)
- Section "Actions récentes" qui mémorise les 5 derniers intents exécutés (localStorage)

---

## Phase C — Optimistic message send Inbox (~0.5j)

**C.1 — Affichage instant + état "sending"** 🟡
- Au click "Envoyer" dans [Inbox.tsx](src/pages/Inbox.tsx#L100), créer un Message temporaire avec :
  - `id: 'tmp-' + crypto.randomUUID()`
  - `status: 'sending'`
  - `created_at: new Date().toISOString()`
- L'ajouter à `activeConv.messages` immédiatement → apparaît dans le fil
- Effacer le composer
- Au retour serveur :
  - Success : remplacer tmp par le vrai message (par id)
  - Error : marquer status `failed` + offrir retry inline

---

## Phase D — Build + tests + clôture (~0.5j)

- `bun run build` + `bun run test --run` verts
- Smoke test :
  - Sparkles dans note → améliore + undo marche
  - ⌘K "nouveau lead Test" → crée lead + ouvre panel
  - ⌘K "aller au pipeline" → navigation
  - Inbox send → message apparaît instant + transitionne en "sent"
- ROADMAP : Sprint 19 → ~204j cumulés
- Memory : `sprint19_status.md`
- `git mv ANTIGRAVITY-SPRINT19-PLAN.md docs/archive/`

---

## Critères de succès

- [ ] Backend `improve_text` + variantes (shorten/formalize/casualize) répondent en <3s
- [ ] `<AiSparkles>` plug-and-play : prop `value` + `onChange`, marche dans n'importe quel textarea
- [ ] 5+ pages avec Sparkles inline
- [ ] ⌘K reconnaît 4+ patterns d'intent (create, navigate, move, open)
- [ ] Inbox message send : 0ms latence visible, fallback retry si error
- [ ] Build vert + tests verts
- [ ] Aucune régression Sprint 18 (panels marchent toujours)

## Hors scope (Sprint 20+)

- TaskPanel, AppointmentPanel, ConversationPanel (extension du stack)
- Density modes (compact/comfortable/spacious)
- Multi-user awareness (live cursors)
- Sound design + haptics mobile
- AI summarize conversations
- Vraie semantic search via embeddings

---

_Plan créé le 2026-05-13. Sera archivé dans docs/archive/ à la fin du sprint._
