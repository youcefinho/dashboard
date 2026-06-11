# LOT CONV 7 — Convergence i18n (Sprint 7, périmètre RÉDUIT validé Rochdi)

> Statut : **Phase A SOLO FIGÉE** (inventaire i18n gelé + 37 clés ×4
> catalogues créées AVANT toute conversion = filet anti-régression-R).
> Phase B (conversion string→`t()` par page) débloquée sur fichiers
> DISJOINTS (matrice §6.F). CODE-COMPLETE only — build/tests délégués au
> hôte Antigravity (VM VMware sans bun/node). Aucune prétention « buildé/
> testé vert ».

Objectif : éliminer les **strings FR résiduelles hardcodées** des pages
CRM **non-R** secondaires (LOT 1) + les 4 strings résiduelles de
`Leads.tsx` (LOT 2-limité). i18n maison (`src/lib/i18n.ts` `t(key,vars?)`,
fallback locale→en→raw key, interpolation `{{var}}` UNIQUEMENT si variable
réelle passée). 4 catalogues plats point-notation
`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`.

**EXCLUS formellement** : Dashboard.tsx, LeadDetail.tsx (heros porteurs de
logique — migration = régression), Clients.tsx / Pipeline.tsx (rien de
traduisible : `—`/`⚠`), Tasks.tsx (0 résiduel), toute migration
`<PageHero>`, marketing/légal (`src/pages/marketing/**`, `landing/**`,
`legal/**` — FR intentionnel hors périmètre), `src/lib/i18n.ts`
(référence READ-ONLY), `src/i18n/*.json` (mort/absent).

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS

Sprint front pur. **Aucune touche réseau** : `apiFetch` / `ApiResponse`
(`src/lib/api.ts`) INCHANGÉS, contrat `{ data }` / `{ error }` strict,
jamais de champ `code`. Aucun helper api ajouté. Phase B ne touche
**aucun** appel réseau (conversion JSX/attribut string→`t()` uniquement).

### §6.B — AUCUNE migration DDL

**ZÉRO migration.** Pas de nouvelle séquence, pas d'`ALTER`, pas de
`CREATE TABLE`. `migrations-manifest.json` INTOUCHÉ. CHECK seq 59 /
`users` / `admin_sessions` / tables E4-E6 régulées (`payments`,
`payment_events`, `payment_provider_config`, `refunds`, `disputes`,
`return_requests`) **jamais touchés/lus**. Aucun backend modifié (sprint
front pur).

### §6.C — `<PageHero>` NON modifié — AUCUNE migration PageHero

`<PageHero>` (`src/components/ui/PageHero.tsx`) **INTOUCHÉ ce sprint**.
Aucune page n'est migrée vers/depuis `<PageHero>`. Constat CODE :
Leads/Tasks/Pipeline utilisent **déjà** `<PageHero>` ; Dashboard.tsx /
LeadDetail.tsx ont des heros **custom porteurs de logique métier** (KPI
live, refresh, état, hover-reveal) → **migration = régression** →
**EXCLUS du périmètre**. La suite `PageHero-lotA.test.tsx` ne doit PAS
régresser (aucun fichier PageHero touché ⇒ filet vert par construction).

### §6.D — Inventaire i18n COMPLET (Phase B s'y réfère — NE crée AUCUNE clé)

**Règle clés-avant-conversion (anti-R)** : Phase A a créé/recensé TOUTES
les clés ci-dessous AVANT toute conversion. Phase B **consomme** ces clés
(`t('<clé>')` / `t('<clé>', { var })`) et ne crée, ne modifie, ne
supprime **AUCUNE** clé i18n. Les catalogues sont **gelés Phase A
EXCLUSIF** (§6.F).

**Découverte CODE majeure (CODE > mémoire)** : un sprint i18n antérieur a
déjà créé de nombreuses clés `leads.page.*` et autres SANS jamais câbler
le `.tsx`. **Phase A n'a donc créé que 37 clés réellement manquantes** ;
les strings dont la clé existe déjà sont marquées **[clé existante]** —
Phase B câble la clé existante telle quelle (zéro création).

#### LOT 2-limité — `src/pages/Leads.tsx` (SEULE page R touchée) — 0 clé créée (toutes préexistantes)

| Ligne (vérifiée) | String hardcodée | Clé à câbler (PRÉEXISTANTE — Phase A NE crée PAS) | Valeur fr-CA |
|---|---|---|---|
| ~750 | `<option value="">Sélectionner un client...</option>` | `leads.page.create_client_placeholder` **[clé existante L1165]** | `Sélectionner un client...` |
| ~829 | `<th>...Résumé AI + action</th>` | `leads.page.batch_col_summary` **[clé existante L1186]** | `Résumé AI + action` |
| ~843 | `<p>...Généré par Claude Haiku 4.5</p>` | `leads.page.batch_generated_by` **[clé existante L1187]** | `Généré par Claude Haiku 4.5` |
| ~864 | `<span>Téléphone : </span>` | `leads.page.notes_phone` **[clé existante L1190]** | `Téléphone : ` |

> Les 4 clés LOT 2 **existent déjà** dans les 4 catalogues (valeurs
> identiques, parité préexistante non-touchée). **Phase A n'ajoute RIEN
> pour LOT 2.** Phase B = conversion stricte `string → t('<clé>')`,
> INTERDIT toute modif de logique/hooks/queries/handlers/state/structure,
> **diff < 6 lignes**, **validation visuelle Rochdi obligatoire** (§6.E).

#### LOT 1 — pages CRM non-R secondaires — 37 clés créées Phase A (préfixe page existant)

| Page | Ligne (vérifiée) | String hardcodée | Clé (créée Phase A ×4) | Valeur fr-CA |
|---|---|---|---|---|
| Integrations.tsx | ~223 | `URL Webhook à coller dans Google Ads` | `integrations.gads.webhook_url_label` | `URL Webhook à coller dans Google Ads` |
| Integrations.tsx | ~257 | `Clé webhook (google_key)` | `integrations.gads.key_label` | `Clé webhook (google_key)` |
| Integrations.tsx | ~261 | `Libellé (optionnel)` | `integrations.gads.label_label` | `Libellé (optionnel)` |
| Integrations.tsx | ~262 | `placeholder="Campagne Été 2026"` | `integrations.gads.label_placeholder` | `Campagne Été 2026` |
| Integrations.tsx | ~667 | `Connectez-vous à Facebook pour lier votre page et compte Instagram.` | `integrations.meta.connect_desc` | `Connectez-vous à Facebook pour lier votre page et compte Instagram.` |
| Integrations.tsx | ~669 | `Connecter avec Facebook` | `integrations.meta.connect_button` | `Connecter avec Facebook` |
| Integrations.tsx | ~674 | `Code du widget à intégrer :` | `integrations.webchat.snippet_label` | `Code du widget à intégrer :` |
| Integrations.tsx | ~681 | `Utilisez l'URL webhook universelle ci-dessus pour connecter cette intégration.` | `integrations.fallback.universal_desc` | `Utilisez l'URL webhook universelle ci-dessus pour connecter cette intégration.` |
| Integrations.tsx | ~682 | `Consultez la documentation de {integration.name} pour configurer le webhook sortant.` | `integrations.fallback.doc_hint` (`{{name}}` = variable RÉELLE) | `Consultez la documentation de {{name}} pour configurer le webhook sortant.` |
| Documents.tsx | ~201 | `<option value="">Sélectionner un modèle...</option>` | `documents.form.template_placeholder` | `Sélectionner un modèle...` |
| Documents.tsx | ~213 | `<option value="">Sélectionner un lead...</option>` | `documents.form.lead_placeholder` | `Sélectionner un lead...` |
| Documents.tsx | ~384 | `<span class="...label">Créé</span>` | `documents.expand.created_label` | `Créé` |
| Invoices.tsx | ~411 | `<span class="...label">Description complète</span>` | `invoices.expand.description_label` | `Description complète` |
| Invoices.tsx | ~413 | `inv.description || 'Aucune description fournie.'` | `invoices.expand.description_empty` | `Aucune description fournie.` |
| Invoices.tsx | ~468 | `<span class="...label">Lead associé</span>` | `invoices.expand.lead_label` | `Lead associé` |
| Invoices.tsx | ~470 | `<span>Aucun lead</span>` | `invoices.expand.lead_empty` | `Aucun lead` |
| Invoices.tsx | ~519 | `placeholder="Ex: Frais de démarrage..."` | `invoices.modal.desc_placeholder` | `Ex: Frais de démarrage...` |
| Reviews.tsx | ~346 | `<span class="...label">Lead lié</span>` | `reviews.expand.lead_label` | `Lead lié` |
| Reviews.tsx | ~351 | `<span class="...label">Votre réponse</span>` | `reviews.expand.reply_label` | `Votre réponse` |
| Reviews.tsx | ~357 | `<span class="...label">Rédiger une réponse</span>` | `reviews.expand.reply_write_label` | `Rédiger une réponse` |
| Reviews.tsx | ~363 | `placeholder="Écrivez votre réponse..."` | `reviews.expand.reply_placeholder` | `Écrivez votre réponse...` |
| Properties.tsx | ~300 | `aria-label="Retirer la propriété"` | `properties.action.remove_aria` | `Retirer la propriété` |
| Properties.tsx | ~301 | `title="Retirer"` | `properties.action.remove_title` | `Retirer` |
| Properties.tsx | ~325 | `<span class="...label">Adresse complète</span>` | `properties.expand.address_label` | `Adresse complète` |
| Properties.tsx | ~362 | `<label>Numéro MLS (ex: 12345678)</label>` | `properties.form.mls_label` | `Numéro MLS (ex: 12345678)` |
| Workflows.tsx | ~323 | `aria-label="Voir détails"` | `workflows.action.view_detail` | `Voir détails` |
| WorkflowBuilder.tsx | ~590 | `<label>Étape (Stage)</label>` | `wf_builder.trigger.stage_label` | `Étape (Stage)` |
| WorkflowBuilder.tsx | ~596 | `<option value="">N'importe quelle étape</option>` | `wf_builder.trigger.stage_any` | `N'importe quelle étape` |
| WorkflowBuilder.tsx | ~641 | `placeholder="Le lead {{name}} a été gagné !"` | `wf_builder.node.message_placeholder` (`{{name}}` = **token littéral d'exemple**, PAS variable i18n — Phase B appelle `t(key)` SANS vars ⇒ reste littéral) | `Le lead {{name}} a été gagné !` |
| FormBuilder.tsx | ~179 | `aria-label="Paramètres"` | `formbuilder.action.settings_aria` | `Paramètres` |
| FormBuilder.tsx | ~336 | `<label>Code d'intégration</label>` | `formbuilder.embed.code_label` | `Code d'intégration` |
| FormBuilder.tsx | ~377 | `placeholder="J'accepte d'être recontacté(e) conformément à la Loi 25."` | `formbuilder.field.consent_placeholder` (Loi 25 — wording conservé verbatim) | `J'accepte d'être recontacté(e) conformément à la Loi 25.` |
| TriggerLinks.tsx | ~191 | `placeholder="ex: Lien guide gratuit"` | `trigger.modal.name_placeholder` | `ex: Lien guide gratuit` |
| TriggerLinks.tsx | ~193 | `placeholder="ex: intéressé_guide"` | `trigger.modal.tag_placeholder` | `ex: intéressé_guide` |
| TriggerLinks.tsx | ~166 | `title="Copier URL"` | `trigger.action.copy_url_title` | `Copier URL` |
| TriggerLinks.tsx | ~178 | `title="Supprimer"` | `trigger.action.delete_title` | `Supprimer` |
| DocumentTemplates.tsx | ~171 | `<Tag>Modèle</Tag>` | `doctemplates.card.badge` | `Modèle` |

**LOT 1 = 11 pages, 37 strings, 37 clés créées ×4 catalogues.**

**Strings LOT 1 dont la clé PRÉEXISTE (Phase B câble l'existant, Phase A
n'a RIEN créé)** — découvert par grep sur le code réel :
`TriggerLinks.tsx` labels `Nom` → `trigger.modal.name` (L2607),
`URL cible` → `trigger.modal.url` (L2608), `Tag au clic (optionnel)` →
`trigger.modal.tag` (L2609) ; `Documents.tsx` `Modèle de document` →
`documents.form.template` (L2318), `Lead destinataire` →
`documents.form.lead` (L2319). Phase B réutilise ces clés telles quelles.

> **Convention clés** : plate, point-notation, sous le préfixe de page
> existant (`integrations.*`, `documents.*`, `invoices.*`, `reviews.*`,
> `properties.*`, `workflows.*`, `trigger.*`, `wf_builder.*`,
> `formbuilder.*`, `doctemplates.*`), suffixe sémantique
> (`*.action_*`/`*.expand.*`/`*_label`/`*_placeholder`/`*_empty`).
> `{{var}}` posé UNIQUEMENT pour `integrations.fallback.doc_hint`
> (variable réelle `name`). Pour `wf_builder.node.message_placeholder`,
> `{{name}}` est un **token littéral d'exemple** (Phase B appelle
> `t(key)` SANS objet vars ⇒ la regex i18n.ts ne remplace rien ⇒ le texte
> reste littéral, comportement identique à l'actuel).

### §6.E — Règle pages R : `Leads.tsx` SEULE page R touchée (LOT 2)

`src/pages/Leads.tsx` est la **SEULE** page « R » touchée ce sprint, et
**UNIQUEMENT** pour les 4 strings du tableau LOT 2 (§6.D), dont les clés
**préexistent** (Phase A n'a rien ajouté pour Leads). Phase B (Manager-C) :

- conversion **STRICTE** `string littérale → t('<clé préexistante>')`,
  rien d'autre ;
- **INTERDIT** : toute modif de logique / hooks / queries / handlers /
  state / structure JSX / props / imports non-`t` ;
- **diff < 6 lignes** sur `Leads.tsx` (4 remplacements 1-ligne max) ;
- `t` est déjà importé dans `Leads.tsx` (vérifié : usage `t('leads.modal.*')`) ;
- **validation visuelle Rochdi OBLIGATOIRE** avant clôture (page R = zone
  sensible anti-régression). Aucune autre page R (LeadDetail / Pipeline /
  Tasks / Inbox / Calendar) n'est touchée.

### §6.F — Matrice de propriété Phase B (disjonction STRICTE — 1 page = 1 owner)

| Fichier | Propriétaire | Règle |
|---|---|---|
| `src/pages/Integrations.tsx`, `Documents.tsx`, `Invoices.tsx`, `Reviews.tsx`, `Properties.tsx`, `Workflows.tsx`, `WorkflowBuilder.tsx`, `FormBuilder.tsx`, `TriggerLinks.tsx`, `DocumentTemplates.tsx` (LOT 1) | **Manager-B** | conversion string→`t('<clé §6.D>')` STRICTE, zéro logique modifiée, import `t` si absent |
| `src/pages/Leads.tsx` (LOT 2 — 4 strings) | **Manager-C** | conversion STRICTE 4 clés préexistantes, diff < 6 lignes, validation visuelle Rochdi (§6.E) |
| `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` · `docs/LOT-CONV7.md` | **Phase A — GELÉS** | B/C ne les modifient PAS (catalogues = Phase A EXCLUSIF, clés déjà toutes créées/recensées) |
| `src/lib/i18n.ts` · `src/i18n/*.json` (mort) | — | **READ-ONLY / INTERDIT** |
| `Dashboard.tsx` · `LeadDetail.tsx` · `Clients.tsx` · `Pipeline.tsx` · `Tasks.tsx` | — | **INTERDITS** (EXCLUS du périmètre — heros logique / 0 résiduel) |
| `PageHero.tsx` + toute migration PageHero | — | **INTERDIT** (§6.C) |
| `src/pages/marketing/**` · `landing/**` · `legal/**` · `boutique/**` | — | **INTERDIT** (FR intentionnel hors périmètre) |
| backend (worker/**, migrations, manifest) · `apiFetch`/`ApiResponse` · CHECK seq 59 · `users` · E4-E6 régulés | — | **INTERDIT** (sprint front pur — §6.A/§6.B) |

Disjonction stricte : Manager-B (10 pages LOT 1) et Manager-C
(`Leads.tsx` LOT 2) n'ont **AUCUN fichier en commun**. Les 4 catalogues
i18n + ce doc sont **gelés Phase A** — B/C n'y touchent jamais (toutes
les clés nécessaires existent déjà : 37 créées Phase A + clés
préexistantes recensées §6.D).

### §6.G — Garde-fous + suites à ne pas régresser

Garde-fous DURS : strictement ADDITIF aux catalogues ; **parité STRICTE
×4** (37 clés identiques fr-CA/fr-FR/en/es, zéro valeur vide, zéro
doublon, zéro modif/suppression d'existant, format plat point-notation) ;
`{{var}}` UNIQUEMENT variable réelle (1 seul cas :
`integrations.fallback.doc_hint`) ; AUCUNE conversion `.tsx` faite en
Phase A (c'est Phase B) ; AUCUNE migration / backend / réseau (front
pur) ; `src/lib/i18n.ts` / `PageHero.tsx` / Dashboard / LeadDetail /
Clients / Pipeline / Tasks / marketing / légal **intouchés** ; CHECK
seq 59 / `users` / E4-E6 régulés jamais touchés ;
rétro-compat byte-identique (purement additif ⇒ comportement existant
strictement inchangé tant que Phase B n'a pas câblé ; après câblage, `t()`
renvoie la même chaîne que le littéral d'origine).

Suites à NE PAS régresser (Phase B, build côté hôte Antigravity) :

- **`src/components/ui/__tests__/i18n-parity-lotC.test.tsx`** = **filet
  anti-R** : asserte égalité STRICTE des 4 ensembles de clés + zéro
  valeur vide. Phase A garde ce test vert (parité 37 clés vérifiée :
  `diff` 4 catalogues IDENTICAL, 0 vide, 0 doublon). Phase B ne touchant
  pas les catalogues, le test reste vert par construction.
- **`PageHero-lotA.test.tsx`** : non régressé (aucun fichier PageHero
  touché — §6.C).
- Suites pages converties : Phase B doit garder le rendu visuel
  identique (les valeurs `t()` égalent les littéraux d'origine).

## Écarts CODE vs cadrage (issus de la lecture du CODE réel)

1. **Les 4 clés LOT 2 (`Leads.tsx`) PRÉEXISTENT** dans les 4 catalogues
   (`leads.page.create_client_placeholder` L1165, `batch_col_summary`
   L1186, `batch_generated_by` L1187, `notes_phone` L1190 — valeurs
   identiques). Un sprint i18n antérieur les a créées sans câbler le
   `.tsx`. **Phase A n'a donc créé AUCUNE clé pour LOT 2** (anti-doublon,
   CODE > mémoire). Phase B = pur câblage. Conforme à l'esprit du cadrage
   (« LOT 2 = les 4 strings résiduelles ») — la divergence est que la
   création de clés était déjà faite.
2. **Plusieurs strings LOT 1 ont aussi des clés préexistantes** non
   câblées (`documents.form.template`/`lead`, `trigger.modal.name`/`url`/
   `tag`). Phase A ne les a PAS recréées (garde-fou anti-doublon strict) ;
   recensées §6.D pour câblage Phase B. **Phase A n'a créé que les 37
   clés réellement absentes.**
3. **Numéros de ligne du cadrage indicatifs confirmés** : LOT 2 ≈
   750/829/843/864 — vérifiés par lecture (750, 829, 843, 864 exact).
4. **`wf_builder.node.message_placeholder` contient `{{name}}` littéral**
   (token d'exemple affiché à l'utilisateur, pas une interpolation i18n).
   Stocké tel quel ; Phase B appelle `t(key)` SANS vars ⇒ la regex
   i18n.ts (`vars` absent) ne remplace rien ⇒ texte affiché identique à
   l'actuel. Aucune régression.
5. **`EmailBuilder.tsx` / `Sequences.tsx` / `Campaigns.tsx` / `Quotes.tsx`
   : 0 string résiduelle JSX/attribut user-facing** (vérifié grep — seuls
   commentaires/toasts dynamiques). Donc HORS LOT 1 effectif (cadrage les
   listait comme candidats « ex. » — le CODE montre qu'ils n'ont rien à
   convertir). Aucun écart structurel : le cadrage disait « toute page
   hors-R avec strings FR hardcodées ».
6. **`integrations.fallback.doc_hint`** : la string d'origine interpole
   `{integration.name}` (vraie variable JSX) ⇒ clé posée avec `{{name}}`
   (seul `{{var}}` du lot). Phase B devra appeler
   `t('integrations.fallback.doc_hint', { name: integration.name })`.
