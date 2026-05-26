# LOT 3 — Sprint 28 : i18n convergence 4 langues

> Doc contrat §6 figé. PAS de migration (i18n = frontend). Manifest reste à seq124.

## Constat parité — déjà OK
- 4 catalogues × 5118 clés strictement identiques (`Object.keys()` sorted) ✅
- Test `src/components/ui/__tests__/i18n-parity-lotC.test.tsx` (LOT C) verrouille la parité ×4.
- **Sprint 28 n'ajoute PAS de clés de "rattrapage parité"** — il extrait des littéraux hardcodés + corrige 4 bugs missing.

## Clés MISSING corrigées Sprint 28 (4 clés × 4 langues = 16 entrées)
| Clé | fr-CA | fr-FR | en | es | Bug origine |
|---|---|---|---|---|---|
| `leads.table.type` | Type | Type | Type | Tipo | `Leads.tsx:730` affichait "leads.table.type" raw |
| `set.team.invitation` | invitation | invitation | invitation | invitación | `TeamSettings.tsx:406` |
| `set.team.invitations` | invitations | invitations | invitations | invitaciones | `TeamSettings.tsx:406` |
| `set.team.pending` | en attente | en attente | pending | pendiente | `TeamSettings.tsx:406` |

## Littéraux extraits Sprint 28 (~30-35 nouvelles clés × 4 = ~120-140 entrées)

Liste exhaustive par fichier:ligne (ancien littéral → nouvelle clé `t()`) :

### `src/pages/Leads.tsx` (10 extractions)
- L:542 "Tous les statuts" → `leads.filter.all_statuses`
- L:547 "Toutes les sources" → `leads.filter.all_sources`
- L:552 "Tous les clients" → `leads.filter.all_clients`
- L:715 "Annuler" → `action.cancel` (réutilise clé existante)
- L:729 "Contact" → `leads.table.contact`
- L:887 "Source" → `leads.new.source_label`
- L:891 "Manuel" → `leads.new.source_manual`
- L:897 "Type" → `leads.new.type_label`
- L:902 "Client existant" → `leads.new.type_customer`
- L:906 "Note initiale" → `leads.new.note_label`
- L:935 "Lead" → `leads.detail.batch_col_lead`
- L:959 "Exporter CSV" → `leads.export.csv_button`
- L:982 "Notes internes" → `leads.detail.notes_label`
- L:988 "Sauvegarder" → `leads.detail.notes_save`

### `src/pages/EmailBuilder.tsx` (15 extractions)
- L:58 "Niveau" → `email_builder.prop.level`
- L:62/103 "Couleur texte" → `email_builder.prop.text_color`
- L:66 "Alignement" → `email_builder.prop.alignment`
- L:68 "Gauche/Centre/Droite" → `email_builder.align_left/center/right`
- L:75/124 "Contenu HTML" → `email_builder.prop.html_content`
- L:77/110/126 "Couleur" → `email_builder.prop.color`
- L:79 "Taille police" → `email_builder.prop.font_size`
- L:88 "Texte alt" → `email_builder.prop.alt_text`
- L:101 "Couleur fond" → `email_builder.prop.bg_color`
- L:117 "Hauteur" → `email_builder.prop.height`
- L:342 "Preheader" → `email_builder.prop.preheader`

### `src/pages/WorkflowBuilder.tsx` (8 extractions)
- L:448 "Method" → `workflow_builder.field.method`
- L:460/1004 "Pipeline" → `workflow_builder.field.pipeline`
- L:490 "Description" → `workflow_builder.field.description`
- L:494 "Priorité" → `workflow_builder.field.priority`
- L:500/567 "Assigné à" → `workflow_builder.field.assigned_to`
- L:554 "Workflow" → `workflow_builder.field.workflow`
- L:598 "Score minimum" → `workflow_builder.field.min_score`
- L:983 "Trigger global" → `workflow_builder.label.global_trigger`

### `src/pages/FunnelBuilder.tsx` (2 extractions)
- L:134-136 "Gauche/Centre/Droite" → réutilise `email_builder.align_*`
- L:331 "Hauteur" → `funnel_builder.prop.height`

### `src/pages/KBAdmin.tsx` (4 extractions)
- L:320 "Général" → `kb_admin.category.general`
- L:321 "Facturation" → `kb_admin.category.billing`
- L:322 "Technique" → `kb_admin.category.technical`
- L:323 "Compte" → `kb_admin.category.account`

### `src/components/settings/ProfileSettings.tsx` (1 extraction)
- L:114 "Tes informations et préférences de communication." → `profile_settings.subtitle`

### `src/components/Inbox/NewConversationPane.tsx` (2 extractions)
- L:80 "Nouvelle Conversation" → `inbox.new_conversation_title`
- L:178 "Sujet du message..." → `inbox.new_subject_placeholder`

### `src/components/conversations/ConversationPanel.tsx` (2 extractions)
- L:164 "Aucune conversation" → `conversations.empty_state`
- L:257 "Sujet de l'email..." → `conversations.email_subject_placeholder`

### `src/components/Inbox/MessageThread.tsx` (1 extraction)
- L:43 "Aucun message dans cette conversation" → `inbox.thread.empty_message`

### `src/components/panels/LeadTimeline.tsx` (1 extraction)
- L:147 "Aucune activité enregistrée pour ce lead." → `lead_timeline.empty_activity`

### `src/components/onboarding/OnboardingProgressChip.tsx` (1 extraction)
- L:408 "Tu es prêt!" → `onboarding.chip.ready`

### `src/pages/Quotes.tsx` (4 extractions)
- L:474 "Description" → `quotes.detail.description`
- L:498 "Aucune ventilation de taxes" → `quotes.detail.no_tax_breakdown`
- L:509 "Articles" → `quotes.detail.articles`
- L:520 "Identifiant complet" → `quotes.detail.full_id`

### `src/pages/LeadDetail.tsx` (1 extraction)
- L:1004 "Source" → `lead_detail.source_label` (ou réutilise `leads.new.source_label`)

**TOTAL : ~38 ChirurgicalEdits dans 13 fichiers cibles + ~30-35 nouvelles clés ajoutées aux 4 catalogues.**

## Audit orphelines (audit-only, AUCUNE suppression Sprint 28)
- 1714 clés présentes dans catalogues sans hit `t('clé')` direct dans `src/`.
- ~70% probablement utilisées via clé dynamique (`t(\`labels.status.${var}\`)`) — faux positifs.
- ~30% (~500 clés) vrais vestiges à investiguer en Sprint cleanup futur.
- Top namespaces orphelins :
  - `leads.*` : 153 candidats
  - `shop.*` : 133 candidats
  - `leaddetail.*` : 131 candidats
  - `labels.*` : 129 candidats
  - `tasks.*` : 112 candidats
  - `dashboard.*` : 84 candidats
  - `set.*` : 72 candidats
  - `pipeline.*` : 69 candidats
  - `onboarding.*` : 60 candidats

**Action Sprint 28** : aucune suppression. Le rapport documente pour Sprint cleanup futur dédié (post-RC).

## Helper `t()` dev-warn
- `src/lib/i18n.ts` ligne ~150 : ajout `console.warn` DEV-only si clé absente (gate `import.meta.env.DEV`).
- Comportement prod **inchangé** (no warn).
- Catche futures clés missing en local pendant développement.

## Hors-scope (renvoyé)
- Refonte i18n loader/runtime (déjà clean — 25 lignes)
- Migration vers react-intl/i18next (décision Sprint 35 : maison léger, -15kb gzipped)
- Pluralisation ICU MessageFormat (helper plural() natif existant)
- RTL support arabe/hébreu (stub `rtl.ts` Sprint 48 M2, backlog)
- Date/number formatting (déjà existant via `datetime.ts`, `number.ts`, `timezone.ts`)
- Suppression de clés orphelines (1714 candidats — Sprint cleanup futur dédié)
- Renommage de clés (breaking, jamais Sprint 28)
- Extraction littéraux dans `src/pages/marketing/legal/*` (contenu juridique fr-CA voulu)
- Extraction `aria-label`/`title` attrs → **Sprint 29** (a11y AAA + convergence design)
- Migration vers `t()` côté worker (chaines audit log, pas i18n)

## §6 Contrats figés

### 6.1 (cette doc)

### 6.2 Append clés gap dans 4 catalogues (Manager-B)
- Bloc A — MISSING fixes : 4 clés ×4 = 16 entrées
- Bloc B-G — Extractions : ~30-35 nouvelles clés ×4 = ~120-140 entrées
- Total : ~150 entrées additives en fin de chaque catalogue, regroupées sous commentaire `// ── Sprint 28 i18n convergence ──`

### 6.3 ~38 ChirurgicalEdits composants (Manager-C)
- Voir tableau "Littéraux extraits Sprint 28" ci-dessus
- Pour chaque edit : vérifier `import { t } from '@/lib/i18n'` présent (sinon ajouter), remplacer littéral par `{t('...')}`, AUCUN autre changement

### 6.4 Helper dev-warn (Manager-B)
- `src/lib/i18n.ts` ligne ~150 dans fonction `t()` :
  ```diff
  -  let str = primary?.[key] ?? fallback?.[key] ?? key;
  +  const primaryHit = primary?.[key];
  +  const fallbackHit = fallback?.[key];
  +  if (import.meta.env.DEV && primaryHit === undefined && fallbackHit === undefined) {
  +    // eslint-disable-next-line no-console
  +    console.warn('[i18n] missing key:', key);
  +  }
  +  let str = primaryHit ?? fallbackHit ?? key;
  ```

### 6.5 Test parité étendu (Phase A)
- ChirurgicalEdit fin de `src/components/ui/__tests__/i18n-parity-lotC.test.tsx` :
  ```ts
  describe('Sprint 28 — clés extraites présentes ×4', () => {
    const sprint28Sample = [
      'leads.table.type',
      'leads.table.contact',
      'leads.filter.all_statuses',
      'set.team.invitation',
      'set.team.invitations',
      'set.team.pending',
      'email_builder.prop.level',
      'workflow_builder.field.method',
      'kb_admin.category.general',
      'inbox.new_conversation_title',
      'conversations.empty_state',
      'onboarding.chip.ready',
      'profile_settings.subtitle',
    ];
    it.each(sprint28Sample)('clé Sprint 28 "%s" présente dans les 4 catalogues', (key) => {
      for (const [name, cat] of Object.entries(catalogues)) {
        expect(cat[key], `${name} doit contenir ${key}`).toBeTruthy();
      }
    });
  });
  ```
- AUCUN test LOT C existant touché. Le `catalogues` object est déjà défini dans le fichier (vérifier la structure exacte avant l'ajout).

## Garanties
- Parité ×4 strict maintenue (test LOT C reste vert)
- Aucune clé renommée/supprimée
- Aucune migration SQL (seq reste à 124)
- Aucune capability ajoutée
- Pages marketing/legal intouchées
- Worker intouchable (chaines audit log)
