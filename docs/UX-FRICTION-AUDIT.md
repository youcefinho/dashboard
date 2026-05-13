# Audit UX/Friction — 6 pages cœur (2026-05-13)

> Audit qualitatif des pages les plus utilisées du CRM, fait par lecture de code
> (pas d'interaction live possible dans l'env actuel — sans `bun run dev`).
> Les frictions visuelles/animation subtiles peuvent manquer ; les pbms
> structurels et data-integrity sont par contre solides.

**Scope** : `Dashboard`, `Leads`, `LeadDetail`, `Pipeline`, `Inbox`, `Calendar`

**Légende sévérité** :
- **P0** — Bug data-integrity ou dead-click. Le user prend des décisions sur du faux,
  ou clique dans le vide. À fixer avant beta.
- **P1** — Friction UX claire avec impact quotidien. Win mesurable.
- **P2** — Polish. Pas bloquant, mais accumulation crée une perception "AI generic".

---

## ⚠️ Patterns transversaux (à traiter une fois, gagner partout)

### Pattern 1 — Mensonges UI / fake data
Plusieurs pages affichent du data **inventé à la volée** dans le UI, ce qui peut
induire en erreur le user qui prend des décisions dessus.

| Endroit | Faux data | Impact |
|---|---|---|
| `Dashboard.tsx:157` | `growthPct` calculé via `prevCount = leads * 0.8` | Le delta "+25%" est toujours faux |
| `Dashboard.tsx:280,283,286` | Deltas `+28.3%`, `-2.1%`, `+12.0%` hardcodés en strings | KPIs Pipeline/Conv/Revenu mentent |
| `Dashboard.tsx:499` | `lead.score \|\| Math.random()*60+20` | Score différent à chaque render |
| `Leads.tsx:38-39` | `lat/lng = fixture + Math.random()*0.1` | Pins bougent à chaque refresh |

**Fix transversal** : afficher `—` ou un message "donnée non disponible" au lieu
d'inventer. Pour le `growth%`, faire une vraie comparaison période précédente
(API `getDashboardStats({period_compare: true})` ou calcul backend).

### Pattern 2 — `confirm()` / `alert()` / `prompt()` natifs
Le projet a Modal + Toast wired partout, mais 5+ endroits utilisent les natifs
JS qui cassent l'identité visuelle et la sérénité produit.

| Endroit | Action | Sévérité |
|---|---|---|
| `Leads.tsx:271` | `confirm("Déplacer X prospects vers la corbeille ?")` | Bulk action critique |
| `Leads.tsx:302` | `prompt("Nom de la liste intelligente :")` | Petit mais cheap |
| `LeadDetail.tsx:100` | `confirm("...Loi 25...irréversible.")` | **Compliance + irréversible** — devrait demander de taper "SUPPRIMER" |
| `LeadDetail.tsx:105` | `alert("Erreur lors de la suppression")` | Should be Toast error |
| `LeadDetail.tsx:203` | `confirm("Déplacer ce lead vers la corbeille ?")` | Mineur (déjà un soft delete avec undo) |
| `Calendar.tsx:182` | `alert("Rappel envoyé !")` | Should be Toast success |

**Fix transversal** : créer un hook `useConfirm()` + composant `ConfirmModal`
basé sur Modal existant. Remplacer les 6 natifs. Effort : 1h. Win : produit
sent dramatically more polished.

### Pattern 3 — Boutons dead-click
Des CTAs visibles dans des positions premium qui ne font rien.

| Endroit | Bouton | Note |
|---|---|---|
| `Dashboard.tsx:202-205` | "Exporter" (hero) | Pas de `onClick`. Devrait soit retirer, soit wirer vers export leads CSV |
| `Dashboard.tsx:470-473` | "Filtrer" (table contacts) | Pas de `onClick`. Soit retirer, soit ouvrir filtres réels |
| `Dashboard.tsx:296` | "Gérer les champs" (custom fields) | "hover:underline" mais pas de href/onClick |

**Fix** : 3 boutons, soit wirer soit retirer. Effort : 20 min.

---

## 📊 Dashboard

### P0
1. **Fake growth %** (`Dashboard.tsx:154-157`) — voir Pattern 1.
2. **Deltas KPIs hardcodés** (`Dashboard.tsx:280,283,286`) — voir Pattern 1.
3. **Score random** (`Dashboard.tsx:499`) — voir Pattern 1.

### P1
4. **Badge "Live" sans vraie liveness** (`Dashboard.tsx:357-360`) — le badge avec
   pulse-animation suggère du polling/WS, mais l'activité ne se rafraîchit pas.
   → Soit ajouter `setInterval(load, 5000)` (5s polling), soit retirer le badge.
5. **Exporter / Filtrer dead** (voir Pattern 3).
6. **Table "Derniers contacts" non-responsive mobile** (`Dashboard.tsx:464+`) — 6 colonnes
   en `overflow-x-auto` sur mobile = horizontal scroll d'enfer. Devrait basculer
   en card list sous 768px.

### P2
7. **Widget reorder pas DnD** (`Dashboard.tsx:233-234`) — `ChevronUp`/`Down` au lieu
   de drag-and-drop alors que `@dnd-kit/sortable` est déjà dans le bundle (utilisé
   par FormBuilder). Cohérence + ergonomie.
8. **Greeting fixé sur 12h/18h** (`Dashboard.tsx:168-169`) — "Bonsoir" dès 18h01,
   "Bon après-midi" jusqu'à 17h59. Détail mais brusque sur un user à 17h55.

---

## 👥 Leads

### P0
1. **Pins map random** (`Leads.tsx:38-39`) — voir Pattern 1.

### P1
2. **EmptyState message trompeur** (`Leads.tsx:432-434`) — `description="Aucun lead
   ne correspond à vos filtres"` est affiché même quand `hasFilters === false`
   (premier usage, 0 leads). Devrait avoir 2 messages :
   - `hasFilters` : "Aucun lead ne correspond à vos filtres" + action "Réinitialiser"
   - `!hasFilters` : "Aucun lead encore — créez-en un ou attendez les captures"
     + action "Nouveau lead"
3. **`prompt()` smart list** (`Leads.tsx:302`) — voir Pattern 2.
4. **`confirm()` bulk trash** (`Leads.tsx:271`) — voir Pattern 2.
5. **Mapbox token requis pour vraie carte** (`Leads.tsx:89`, footer mock map line 129)
   — la "mode mock" affiche `| Configurez VITE_MAPBOX_TOKEN pour la vraie carte`
   en footer. Cheap pour un onboarding ; devrait être un banner top "Active la
   carte interactive : ajouter VITE_MAPBOX_TOKEN" avec lien doc.
6. **No keyboard shortcut hint** — `CommandPalette.tsx` existe (Cmd+K) mais aucun
   indice visuel dans la toolbar. Un `<kbd>⌘K</kbd>` à côté du champ de recherche
   transforme l'expérience power-user.

### P2
7. **Animation delay stagger sur rows** (`Leads.tsx:543`) — `animationDelay: ${index * 20}ms`
   = sur 100 leads, dernière row animée à +2s. Cap à `Math.min(index, 20) * 20`.
8. **Bulk bar n'a pas "Select all matching filter"** — classique des grandes
   listes. Si user filtre par status=new (200 leads) et coche le header
   checkbox, sélectionne seulement les visibles. Ajouter "Sélectionner les 200 résultats".
9. **Map fallback charge Mapbox via CDN au runtime** (`Leads.tsx:56-65`) — 3 requêtes
   réseau (CSS+JS+token) à chaque switch vers vue map. Lazy import + cache OK
   après 1ère fois, mais le 1er switch est lent.

---

## 👤 LeadDetail

### P0
1. **Double source pour custom fields** — l'onglet "Détails" lit `(lead as any).custom_fields`
   (`LeadDetail.tsx:299`), l'onglet "Scores" lit `customFields` state chargé via
   `getLeadCustomFields()` (`LeadDetail.tsx:67,476`). Le user voit potentiellement
   2 réalités différentes. → Choisir UNE source, retirer l'autre.
2. **`window.location.reload()` pour annuler suppression** (`LeadDetail.tsx:217`) —
   force un full reload, perd tab actif + scroll + tout l'état. Devrait juste
   appeler `loadLead()`.

### P1
3. **Notes dans 2 onglets** — `Détails` affiche `lead.notes` (champ texte simple),
   `Notes` affiche `leadNotes[]` (notes structurées avec catégorie/pin/auteur).
   Confus : "où je note ?". → Fusionner ou supprimer `lead.notes` legacy.
4. **`confirm()` Loi 25 "forget"** (`LeadDetail.tsx:100`) — action **irréversible**
   sur PII. Mérite mieux qu'un OK/Cancel natif : demander de taper "SUPPRIMER"
   ou le nom du lead pour confirmer (pattern Stripe / GitHub).
5. **`confirm()` soft delete** (`LeadDetail.tsx:203`) — voir Pattern 2.
6. **Edit inline sur blur** (`LeadDetail.tsx:270`) — si user clique ailleurs
   accidentellement (ex: scroll mobile), le champ est sauvegardé. Devrait
   demander confirmation OU avoir un bouton "Save" visible.
7. **`stageProbability` hardcodé** (`LeadDetail.tsx:156`) — `{ new: 10, contacted: 25, ... }`
   alors que Pipeline gère des stages dynamiques avec probability variable.
   Drift garanti. → Lire la probability du stage via API.
8. **Pas de count badge "Conversations"** (`LeadDetail.tsx:315`) — `Notes (X)`
   a un count, `Conversations` non. Inconstance visuelle.

### P2
9. **3 useEffect parallèles sans loading agrégé** (`LeadDetail.tsx:56-68`) — chaque
   fetch (lead, appointments, tasks, notes, scores, customFields) résout à des
   moments différents → user voit la page se peupler en cascade. Soit
   `Promise.all` agrégé, soit Skeleton par section.
10. **`as any` × 2** (`LeadDetail.tsx:299-300`) — code smell, masque un type
    pas mis à jour. Pas un pbm UX mais signale dette technique.

---

## 🎯 Pipeline

Pipeline a été touché en début de session (EmptyState global ajouté). Reste :

### P1
1. **Probabilités stages dupliquées** — backend retourne `stage.probability`,
   mais `LeadDetail.tsx` les redéfinit hardcodées. → Voir P1.7 LeadDetail.
2. **"Déposez ici" affiché dans toutes les colonnes vides** — visuellement
   OK pour empty kanban first-time, mais quand 1 seule colonne est vide
   parmi 6, "Déposez ici" répété donne un sentiment de pages-en-construction.
   → Soit afficher juste sur la colonne active de drag-over, soit changer
   le texte à "—" sur les colonnes inactives.

### P2
3. **Pas de filtre temporel** — voir les leads new de la semaine vs. tous-temps
   pourrait être un toggle utile pour les courtiers en cycle court.

---

## 💬 Inbox

Architecture 3-pane solide. Sous-composants bien wirés (ES+SK déjà présents).

### P1
1. **WebSocket sans status indicator** — `useConversationWs` gère la connexion
   mais l'user ne voit pas si le WS est connecté/déconnecté. Si la connexion
   est down, les messages partent en REST fallback silencieusement. Devrait
   afficher un indicateur "Reconnexion..." en cas de dégradation.
2. **"Sélectionnez une conversation" peu engageant** (`Inbox.tsx:181-187`) — si
   `conversations.length === 0` et `!activeConv`, on voit le même message.
   Devrait distinguer "rien à sélectionner / inbox vide".

### P2
3. **Auto-select first conversation** (`Inbox.tsx:58`) — défaut sélectionne la
   première de la liste, mais si user revient sur la page après avoir fermé
   onglet, on perd son contexte. localStorage le dernier `selectedConvId` ?

---

## 📅 Calendar

### P0
1. **`client_id: 'internal'` hardcodé** (`Calendar.tsx:141`) — le commentaire
   dit "or dynamic" mais ne l'est pas. Tout appointment créé via cette UI a
   un faux `client_id`, qui peut foirer les stats `/api/appointments?client_id=X`
   ou les filtres par sous-compte. **Vrai bug data**.
2. **`alert("Rappel envoyé !")`** (`Calendar.tsx:182`) — voir Pattern 2.

### P1
3. **`selectedCalendars.size` dans deps de `load`** (`Calendar.tsx:85`) — peut
   causer une boucle re-fetch quand l'user toggle les calendars. À retirer.
4. **Timezone fragile** (`Calendar.tsx:111,157`) — `s.endsWith('Z') ? '' : 'Z'`
   est un patch pour des dates parfois timezone-aware, parfois pas. Risque
   d'erreur d'1h sur les RDV proches du changement d'heure ou en cross-fuseau.
   → Standardiser : tout en UTC en base, conversion locale en render via `Intl.DateTimeFormat`.

### P2
5. **DnD reschedule sans confirmation** — drag un appointment sur une autre
   case = save immédiat. Optimistic update OK, mais si user lâche dans la
   mauvaise case par erreur, pas d'undo visible. Toast "Annuler" comme on a
   sur soft-delete leads ?

---

## Récap — priorisation

### 🔴 P0 à fixer avant beta (8 items)
| # | Page | Issue | Effort |
|---|---|---|---|
| 1 | Dashboard | Fake growth % | 30 min (vrai calcul ou afficher `—`) |
| 2 | Dashboard | Deltas hardcodés | 30 min |
| 3 | Dashboard | Score random | 15 min |
| 4 | Leads | Pins map random | 30 min |
| 5 | LeadDetail | Custom fields double source | 1h |
| 6 | LeadDetail | window.reload après undo | 10 min |
| 7 | Calendar | `client_id: 'internal'` | 30 min (lier au lead sélectionné ou ajouter dropdown) |
| 8 | (transversal) | `confirm()`/`alert()`/`prompt()` natifs ×6 | 1h pour `useConfirm()` + remplacements |

**Total P0 : ~4-5h.** Vraiment un sprint d'1 journée.

### 🟡 P1 — Sprint 17.5 candidat (17 items, ~2-3 jours)
À grouper par thème :
- **Empty states & messages contextuels** (Leads, Inbox) : ~2h
- **Notes/custom fields déduplication** (LeadDetail) : ~3h
- **Dead-clicks Dashboard** : 20 min
- **Mobile responsive Dashboard table** : ~2h
- **Keyboard hints + power-user affordances** : ~1h
- **Calendar timezone refactor** : ~4h (sensible)
- **WS status indicator Inbox** : ~1h
- **Live badge Dashboard (polling ou retrait)** : 30 min
- **Stage probability source unifiée** : ~2h

### 🟢 P2 — polish backlog (10+ items)
Animation delays, lazy imports, drag-reorder widgets, etc. À traiter pendant
les pauses entre features prio.

---

## Recommandation Sprint 17

**Option A — "Crédibilité avant beta" (recommandé)** : faire les 8 P0 en 1 jour.
Win = quand les 5 beta tournent dans le dashboard, ils ne voient plus de chiffres
qui mentent ni de natifs JS. C'est ça qui transforme la perception "AI hack"
vs "produit fini".

**Option B — Sprint 17 large** : P0 + P1 sélectionnés (notes dedup, empty states,
calendar tz) = ~3 jours.

**Option C — Skip et go beta tel quel**. Risk : les beta vont remonter ces
choses-là en feedback = même travail + tu paies en perception négative au
passage.

---

## Limites de cet audit

- ❌ Pas d'interaction live (`bun run dev` indisponible dans env actuel)
- ❌ Pas testé sur device mobile réel — Capacitor concerns potentiellement absents
- ❌ Pas vérifié les API réelles (data réelle vs mocks)
- ✅ Lecture exhaustive des 6 fichiers de pages cœur + sous-composants critiques
- ✅ Findings sourcés avec ligne précise pour chaque item

*Audit généré le 2026-05-13 par Claude Code après gap-filling Sprint 16.5.*

---

## Items couverts par Sprint 17 (2026-05-13, code-complete)

**Phase A — Résidus P0/P1 :**
- ✅ Pattern 2 (natifs JS) : 3 `confirm()` restants en Settings migrés vers `useConfirm()` ([SnippetsSettings.tsx:62](../src/components/settings/SnippetsSettings.tsx#L62), [SecuritySettings.tsx:35,44](../src/components/settings/SecuritySettings.tsx#L35))
- ✅ Pattern 3 (dead-clicks) : Dashboard "Exporter" wiré vers `exportLeadsCsv()`, "Filtrer" retiré (pas de filtres prévus pour ce widget). "Gérer les champs" n'existait pas dans le code (audit erroné sur ce point).
- ✅ Dashboard "Live" badge sans liveness : retiré ([Dashboard.tsx:352-359](../src/pages/Dashboard.tsx#L352-L359))

**Phase B — Source unique probability :**
- ✅ LeadDetail.tsx P1.7 : `stageProbability` hardcodé éliminé, source = `pipeline_stages.probability` via `lead.stage_id`. Fallback legacy préservé pour anciens leads sans `stage_id`. Affichage utilise aussi `stage.name` quand dispo. ([LeadDetail.tsx:164-169, 539](../src/pages/LeadDetail.tsx#L164))

**Phase C — P1 sélectionnés sans risque :**
- ✅ Leads P1.2 : EmptyState contextuel (filtres actifs vs vide initial) avec 2 CTAs distincts
- ✅ Inbox P1.2 : message contextuel (inbox vraiment vide vs juste rien sélectionné)
- ✅ LeadDetail P1.8 : badge count `Conversations (${messagesCount})` ajouté, cohérent avec `Notes (X)`
- ✅ Pipeline P1.2 : "Déposez ici" affiché uniquement quand drag actif (`draggedId !== null`), sinon `—` discret

**Phase additionnelle (continuation 2026-05-13) — P1 supplémentaires :**
- ✅ Keyboard hint `⌘K` (Leads P1.6) : déjà visible dans la toolbar globale ([AppLayout.tsx:179](../src/components/layout/AppLayout.tsx#L179))
- ✅ Inbox WS status indicator (Inbox P1.1) : `useConversationWs` retourne maintenant `wsStatus` (`idle|connecting|connected|reconnecting|closed`), affiché en badge dans le header de conversation Webchat avec backoff exponentiel (3s → 15s cap). [useConversationWs.ts](../src/hooks/useConversationWs.ts), [Inbox.tsx:210](../src/pages/Inbox.tsx#L210)
- ✅ LeadDetail notes dedup (LeadDetail P1.3) : carte "Notes" legacy retirée de l'onglet Détails. Si `lead.notes` legacy non vide, affichée en banner doré dans l'onglet Notes avec "Convertir en note" (crée un `leadNote` structuré et clear le legacy) ou "Supprimer". État `editNotes`/`isEditingNotes`/`handleSaveNotes` cleané. ([LeadDetail.tsx:432-460](../src/pages/LeadDetail.tsx#L432))
- ✅ Mobile responsive Dashboard table (Dashboard P1.6) : sous `md` (<768px) la table "Derniers contacts" devient une liste de cards verticales avec nom/statut/source/valeur/score/temps. Table préservée ≥md. ([Dashboard.tsx:472-505](../src/pages/Dashboard.tsx#L472))

**Notes importantes pour l'audit suivant :**
- Beaucoup d'items P0 de l'audit initial étaient déjà corrigés entre 09:09 et 09:33 le 2026-05-13 (avant rédaction Sprint 17 plan). Voir le contexte du `ANTIGRAVITY-SPRINT17-PLAN.md`.
- **Build & tests non vérifiés** dans l'env actuel (pas de `bun`/`npm` disponibles). À valider avant commit.

**P1 restants (Sprint 18 candidat si justifié par feedback beta) :**
- Calendar timezone refactor (~4h, sensible — risque RDV cross-fuseau)
- LeadDetail P1.6 edit inline sur blur (confirmation ou bouton Save explicite)
- Leads P2.8 bulk "Select all matching filter"
- Leads P2.9 lazy import Mapbox CDN
- Pipeline P2.3 filtre temporel
- Calendar P2.5 DnD reschedule undo
- Dashboard P2.7 widget reorder via DnD
- Inbox P2.3 localStorage last `selectedConvId`

