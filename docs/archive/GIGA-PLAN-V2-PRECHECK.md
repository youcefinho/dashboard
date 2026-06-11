# GIGA-PLAN V2 — PRÉ-CHECK (terrain préparé par Claude, 2026-05-17)

> À lire JUSTE APRÈS `docs/GIGA-PLAN-V2.md`, AVANT de démarrer.
> Pré-audit read-only fait par Claude (contexte programme complet) pour
> dérisquer LOT 0 et recadrer LOT A. Vérifié sur disque (grep/read).

## ✅ Constat 1 — Les 6 pages CRM restaurées : imports 100% sains

`Leads/Dashboard/LeadDetail/Tasks/Pipeline/Clients.tsx` (restaurées du
commit `5764096`) — TOUS leurs imports résolvent dans le code actuel :
- `@/components/ui` : `PageHero`, `EmptyState`, `AiSparkles`,
  `usePanelStack`, `AnimatedNumber`, `usePrompt`, `useToast`, `useConfirm`
  → présents dans `src/components/ui/index.ts`.
- `@/lib/api` : `getLeads`, `exportLeadsCsv`, `aiSummarizeLeads`,
  `AiBatchLeadSummary`, `getLeadDetail`, `getLeadMessages`, `getLeadScores`,
  `getLeadCustomFields`, `getDashboardStats` → tous exportés (api.ts
  modifié par S9 mais ces signatures intactes ; les 6 pages n'utilisent
  PAS `getClientLeads` modifié par S9 → zéro impact).
- `@/lib/types` `SmartList`, `@/lib/prefetch` `getCachedLead/setCachedLead`,
  `@/components/ui/SwipeAction`, `@/hooks/useLongPress`,
  `@/components/panels/{AiNextActionCard,LeadTimeline}`,
  `@/components/conversations/ConversationPanel`,
  `@/components/pipelines/ForecastView`, `@/lib/confetti` → fichiers
  présents.

**Conséquence LOT 0** : le build NE cassera PAS à cause de la restauration
des 6 pages. Si `bun run build` échoue, chercher ailleurs (autres sprints,
tests déjà exclus du typecheck via `tsconfig.json` par Antigravity).

## ✅ Constat 2 — RECADRAGE LOT A (scope réduit, important)

Le `GIGA-PLAN-V2.md` supposait que les 6 pages restaurées avaient
« potentiellement perdu le polish design des sprints 36-41 ». **C'est
FAUX.** Le commit `5764096` n'était pas ancien : c'était le commit
**immédiatement avant la conversion i18n cassée S6-M2**. Les 6 pages
contiennent toujours les primitives design modernes (`PageHero`,
`AiSparkles`, `SwipeAction`, `AnimatedNumber`, panels récents…). Le SEUL
diff réellement annulé = la conversion i18n cassée (textes FR hardcodés
de nouveau, ce qui est l'état VOULU).

**Donc :**
- **S-A1** devient une **vérification de parité rapide** (confirmer que
  les 6 pages sont visuellement au standard Stripe actuel), PAS un gros
  réalignement. Probable : peu/pas de backlog de réalignement.
- **S-A2 (réalignement)** : probablement SKIP ou minimal. Le Chaman S-A1
  tranche sur preuve réelle.
- La vraie dette résiduelle des 6 pages = **i18n uniquement** → reste au
  **LOT C (S-C1)**, inchangé (ré-i18n propre, clés AVANT conversion).
- LOT A garde toute sa valeur sur **S-A3 (profondeur design system,
  états vides/erreur/chargement, a11y visuel, responsive)** et **S-A4
  (UI e-commerce)** — c'est là qu'est le vrai gisement « vrai produit ».

## ▶️ Démarrage recommandé

1. **LOT 0 S0.1** : `bun run build` + `bun run test`. Rapporter le réel.
   (Risque 6 pages = écarté ; surveiller le reste.)
2. **LOT 0 S0.2** : préparer les 5 gates (`docs/GOLIVE-S10.md`).
3. **LOT A** en commençant par **S-A1 = audit parité rapide** (Chaman) :
   si parité OK → sauter S-A2, aller direct à **S-A3** (le vrai travail
   design profondeur). Méthode 18 agents dès S-A3.

Le reste du plan (`GIGA-PLAN-V2.md` lots B/C/D/E) inchangé.
