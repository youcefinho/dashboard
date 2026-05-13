# Sprint 20 — AI intelligente partout + polish power-user (~4j)

> **Objectif :** Capitaliser sur l'infra AI inline du Sprint 19 pour offrir des features
> AI vraiment utilisables (résumé conversation, next-best-action), plus le polish
> power-user qui clôt le différenciateur vs GHL : keyboard shortcuts overlay + retry
> failed messages.

## Contexte

Sprint 19 a posé l'infra AI inline (Sparkles + worker endpoint). Sprint 20 utilise cette
plumbing pour des features visibles côté product :
- **Résumé conversation** : un fil de 30 messages devient 3 puces — game-changer pour
  triage rapide vs GHL qui te fait scroller à la main.
- **Next-best-action** : sur un lead inactif, Sparkles propose une action concrète
  (relance email, appel, message SMS) avec brouillon prêt à envoyer.
- **Keyboard shortcuts overlay** : touche `?` ouvre la liste exhaustive — copie Linear.
- **Retry failed messages** : bouton "Renvoyer" sur les messages `failed` du Sprint 19.

Baseline visuelle préservée (light cyan/orange).

---

## Phase A — AI summarize conversation (~1.5j)

**A.1 — Backend action `summarize_conversation`** 🔴
- Étendre `AI_ACTIONS` dans [src/worker/ai.ts](src/worker/ai.ts) avec `summarize_conversation`
- Le handler reçoit `conversation_id`, charge les N derniers messages du fil
- System prompt : "Tu es un assistant CRM. Résume cette conversation en 3 puces max
  (8-12 mots chacune) : sujet principal, état actuel, prochaine étape suggérée. FR québécois."
- Cache simple sur (conversation_id, last_message_id) : si pas de nouveau message,
  retourner le résumé en cache (TTL 1h)

**A.2 — Frontend bouton "Résumer" Inbox** 🔴
- Dans le header de conversation [Inbox.tsx](src/pages/Inbox.tsx), bouton `<Sparkles>` "Résumer"
- Click → loading spinner → drawer/card pliable au-dessus du fil avec les 3 puces
- État dismissible (X), réapparaît si nouveau message arrive (auto-invalide cache)
- Indicateur "Généré par Claude" en bas pour transparence

---

## Phase B — AI suggest next-best-action (~1j)

**B.1 — Backend action `suggest_next_action`** 🟠
- Reçoit `lead_id`, charge le contexte (lead data, dernières interactions, dernière note)
- System prompt : "Tu es un coach commercial. Propose UNE action concrète et un brouillon
  de message pour ce lead. Format JSON : `{action: 'email'|'sms'|'call', reason: '...', draft: '...'}`."
- Retour parsé côté frontend en card

**B.2 — Card "Suggestion AI" sur LeadDetail** 🟠
- Affichage conditionnel : si `lead.updated_at` > 7j et `status !== 'closed' && !== 'lost'`
- Card dans la sidebar avec icône Sparkles, titre "💡 Prochaine étape suggérée", description,
  bouton "Utiliser ce brouillon" → ouvre ConversationPanel ou copie dans clipboard
- Génération lazy (au click "Générer une suggestion") pour éviter de tirer Claude au load

---

## Phase C — Keyboard shortcuts overlay (~0.5j)

**C.1 — Composant `<KeyboardShortcutsModal>`** 🟡
- Touche `?` (sans modifier) ouvre une modale listant tous les raccourcis
- Sections : Navigation (⌘K, ⌘B sidebar), Édition (⌘S, Esc), Vues (g+l = leads, g+i = inbox)
- Listener global dans AppLayout, ignore les inputs/textareas focus
- Fichier : `src/components/KeyboardShortcutsModal.tsx`
- Hint subtil en footer de la sidebar : "Appuyer ? pour les raccourcis"

---

## Phase D — Retry failed messages + clôture (~1j)

**D.1 — Retry button sur message failed** 🟡
- Dans [MessageThread.tsx](src/components/Inbox/MessageThread.tsx), si `msg.status === 'failed'` afficher
  bouton "↻ Renvoyer" inline
- Click → réutilise `handleSend` avec le `msg.body` (nouveau tmp id), retire le failed
- Le `Inbox.tsx` expose un callback `onRetry(msgId, body)` via props

**D.2 — Cleanup + tests + clôture** 🟡
- `bun run build` + `bun run test --run`
- Smoke test : Sparkles "Résumer" sur conversation → 3 puces apparaissent
- Smoke test : lead avec last_update > 7j → card suggestion apparaît, click génère draft
- Smoke test : `?` ouvre modale
- Smoke test : envoyer message qui fail → bouton renvoyer fonctionne
- ROADMAP : Sprint 20 → ~208j cumulés
- Memory : `sprint20_status.md`
- `git mv ANTIGRAVITY-SPRINT20-PLAN.md docs/archive/`

---

## Critères de succès

- [ ] `summarize_conversation` retourne 3 puces FR québécois en <3s
- [ ] `suggest_next_action` retourne JSON valide avec draft utilisable
- [ ] Bouton "Résumer" Inbox + card "Prochaine étape" LeadDetail wirés
- [ ] Touche `?` ouvre la modale shortcuts (ignorant focus input)
- [ ] Messages `failed` ont un bouton "Renvoyer" inline qui marche
- [ ] Build + tests verts
- [ ] Aucune régression Sprints 17-19

## Hors scope (Sprint 21+)

- TaskPanel, AppointmentPanel, ConversationPanel
- AI batch operations ("résumer tous les leads inactifs")
- Activity stream feed (Slack-style)
- Density modes (compact/comfortable/spacious)
- Multi-user awareness (live cursors)
- Sound design + haptics mobile
- Semantic search via embeddings

---

_Plan créé le 2026-05-13. Sera archivé dans docs/archive/ à la fin du sprint._
