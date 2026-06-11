# LOT C — UX / i18n résiduel (GIGA-PLAN-V2)

> Phase A SOLO (Manager A). Document autoportant. §6 ci-dessous = CONTRATS
> FIGÉS, copiables verbatim par les Managers B et C en Phase B.
> Toutes les clés existent en PARITÉ STRICTE dans les 4 catalogues
> (`fr-CA` source / `fr-FR` / `en` / `es`) — vérifié par diff (0 écart) +
> test `src/components/ui/__tests__/i18n-parity-lotC.test.tsx`.

## Résumé exécution Phase A

- **705 clés** par catalogue dans les namespaces LOT C, identiques ×4
  (diff `Object.keys` trié = vide pour fr-FR / en / es vs fr-CA).
- Namespaces utilisés : `admin.* help.* compliance.* customfields.*
  reports.* templates.* integrations.* onboarding.* panels.* feedback.*
  inbox.*`. Placement **additif** en fin de chaque catalogue (avant `};`),
  aucune clé existante touchée/réordonnée/supprimée.
- `common.close` existe déjà (= 'Fermer' / 'Close' / 'Cerrar') — **réutilisé**
  pour les primitives, aucune nouvelle clé `common.*` créée.
- Primitives `Modal` / `SlidePanel` / `BottomSheet` : ajout prop
  **OPTIONNELLE** `closeLabel?: string` défaut `'Fermer'` (rétro-compat
  totale, appelants existants inchangés). Barrel `index.ts` non modifié
  (interfaces props non exportées ; `BottomSheetProps` reçoit un champ
  optionnel additif, aucune rupture).
- Fichiers modifiés : 4 catalogues i18n, `Modal.tsx`, `SlidePanel.tsx`,
  `BottomSheet.tsx`. Fichiers créés : ce doc + test parité.

### Comment B/C consomment (règle absolue)

1. `import { t } from '@/lib/i18n';` (déjà importé dans la plupart des
   fichiers — sinon ajouter l'import).
2. Remplacer la string FR hardcodée par `t('<cle>')` selon les tables §6.
3. Pour les clés avec `{var}` : `t('cle').replace('{var}', String(val))`
   (pattern existant dans le codebase — ex. `t('...').replace('{n}', n)`).
   Aucune dépendance d'interpolation à introduire.
4. **Clé absente du §6 → STOP, signaler au coordinateur. JAMAIS créer une
   clé soi-même** (c'est exactement la cause racine de la régression R).

---

## §6 Contrats figés

### (0) Interdits — NON négociables

- 🚫 Créer/renommer/supprimer une clé i18n (B/C consomment, ne créent pas).
- 🚫 Toucher namespaces réservés 6 pages R : `leads.* dashboard.* tasks.*
  pipeline.* clients.* leaddetail.*`.
- 🚫 Écrire dans les fichiers de l'autre Manager, 6 pages R, E4/E6,
  `worker.ts`, `mockData.ts`, `api.ts`, `vite.config`, `wrangler.jsonc`,
  marketing/landing/legal, migrations/helpers figés, `PageHero.tsx`,
  `EmptyState.tsx`.
- 🚫 Modifier une signature de primitive (réservé Manager A).

### (1) Signature `closeLabel?` — 3 primitives (FIGÉE)

```ts
// Modal.tsx, SlidePanel.tsx, BottomSheet.tsx
/** LOT C — aria-label du bouton fermer (i18n). Défaut 'Fermer'. */
closeLabel?: string;   // OPTIONNELLE — défaut 'Fermer' (rétro-compat)
```
B/C **n'ont rien à faire** sur ces primitives (rétro-compat). Si un appelant
veut localiser le close : passer `closeLabel={t('common.close')}` (clé
existante, `common.close`). Ne PAS modifier la signature.

### (2) Tables clé → valeur fr-CA, par fichier cible

> fr-CA = texte FR original verbatim (iso-affichage). Les 3 autres
> catalogues ont la même clé (parité prouvée).

#### B-1 · `src/pages/admin/AdminOverview.tsx`

| Clé | Valeur fr-CA | Emplacement |
|---|---|---|
| `admin.layout_title` | Administration | `<AppLayout title=>` :194 |
| `admin.hero_meta` | Administration | PageHero meta :197 |
| `admin.hero_title` | Vue d'ensemble | PageHero title :198 |
| `admin.hero_desc` | Pilotage organisationnel : adoption, croissance, et activité utilisateurs. | :199 |
| `admin.period_aria` | Période overview | aria-label :202 |
| `admin.period_7d` | 7 jours | PERIOD_LABELS '7d' :36 |
| `admin.period_30d` | 30 jours | PERIOD_LABELS '30d' :37 |
| `admin.period_90d` | 90 jours | PERIOD_LABELS '90d' :38 |
| `admin.period_1y` | 1 an | PERIOD_LABELS '1y' :39 |
| `admin.kpi_users` | Utilisateurs | kpi label :151 |
| `admin.kpi_active_monthly` | Actifs / mois | :159 |
| `admin.kpi_leads_month` | Leads ce mois | :167 |
| `admin.kpi_conversion` | Conversion | :175 |
| `admin.kpi_mrr` | MRR | :183 |
| `admin.compare_prev` | Comparaison vs période précédente ({period}). | :229 — `{period}`=PERIOD_LABELS[period] |
| `admin.chart_users_growth` | Croissance utilisateurs | :239 |
| `admin.chart_leads_conversions` | Leads & conversions | :253 |

> `PERIOD_LABELS` est un `Record` const : remplacer la valeur par un getter
> `t(...)` au render (ne pas appeler `t()` au top-level module).

#### B-2 · `src/pages/help/HelpCenter.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `help.cat_getting_started` | Premiers pas |
| `help.cat_leads` | Gestion des Leads |
| `help.cat_workflows` | Automatisations |
| `help.cat_integrations` | Intégrations |
| `help.cat_billing` | Facturation |
| `help.hero_meta` | Centre d'aide Intralys |
| `help.hero_title` | Comment pouvons-nous vous aider ? |
| `help.search_placeholder` | Rechercher des articles, des tutoriels... |
| `help.search_aria` | Rechercher dans le centre d'aide |
| `help.kpi_articles` | Articles |
| `help.kpi_categories` | Catégories |
| `help.kpi_popular` | Populaires |
| `help.sidebar_categories` | Catégories |
| `help.back_to_articles` | Retour aux articles |
| `help.tag_fallback` | Article |
| `help.load_error` | `# Erreur\nImpossible de charger cet article.` |
| `help.results` | Résultats ({n}) — `{n}`=visibleArticles.length |
| `help.articles_fallback` | Articles |
| `help.reset` | Réinitialiser |
| `help.no_results` | Aucun article ne correspond à votre recherche. |

> Les titres d'articles individuels (`articles` map, 25 entrées) NE SONT PAS
> i18n-isés (contenu data, fichiers `.md` non traduits) — laisser tel quel.
> Les `categories` (id+name) : remplacer `name` par `t('help.cat_*')` au
> render via un mapping id→clé.

#### B-3 · `src/pages/Reports.tsx` (résidus uniquement)

| Clé | Valeur fr-CA | Ligne |
|---|---|---|
| `reports.no_revenue` | Aucun revenu pour la période | :512 |
| `reports.cac_title` | Coût d'Acquisition (CAC) estimé | :516 |
| `reports.col_source` | Source | :521 |
| `reports.col_spend` | Dépenses | :522 |
| `reports.col_won` | Gagnés | :523 / :733 |
| `reports.col_cac` | CAC | :524 |
| `reports.split_by_type` | 📋 Répartition par type | :623 |
| `reports.detail_by_source` | 📊 Détail par source | :655 |
| `reports.col_subaccount` | Sous-compte | :730 |
| `reports.col_leads` | Leads | :731 |
| `reports.col_conv` | Conv. | :733 |
| `reports.col_pipeline` | Pipeline | :734 |

> NE PAS toucher la logique TPS/TVQ ni `reports.*` existant (period/export).

#### B-4 · `src/pages/Integrations.tsx` + `src/components/reports/DashboardBuilder.tsx`

`Integrations.tsx` utilise déjà `t('integrations.*')` (panel). Résidus = via
`DashboardBuilder.tsx` (constantes + JSX). Table :

| Clé | Valeur fr-CA |
|---|---|
| `integrations.db_config_title` | Configurer le widget |
| `integrations.db_config_with` | Configurer · {title} |
| `integrations.db_config_desc` | Source de données, filtres, dimensions, métriques et affichage. |
| `integrations.db_cancel` | Annuler |
| `integrations.db_apply` | Appliquer |
| `integrations.db_title_label` | Titre |
| `integrations.db_source_label` | Source de données |
| `integrations.db_source_aria` | Source de données |
| `integrations.db_filters_label` | Filtres |
| `integrations.db_period` | Période |
| `integrations.db_period_7d` | 7 derniers jours |
| `integrations.db_period_30d` | 30 derniers jours |
| `integrations.db_period_90d` | 90 derniers jours |
| `integrations.db_period_12m` | 12 derniers mois |
| `integrations.db_period_all` | Toute la période |
| `integrations.db_src_lead` | Source (lead) |
| `integrations.db_src_lead_ph` | ex : google, facebook |
| `integrations.db_status` | Statut |
| `integrations.db_status_ph` | ex : new, won |
| `integrations.db_tags` | Tags (séparés par virgule) |
| `integrations.db_tags_ph` | ex : vip, chaud |
| `integrations.db_dimension` | Dimension (axe) |
| `integrations.db_dim_source` | Source |
| `integrations.db_dim_status` | Statut |
| `integrations.db_dim_type` | Type |
| `integrations.db_dim_owner` | Propriétaire |
| `integrations.db_dim_client` | Sous-compte |
| `integrations.db_dim_date` | Date (jour) |
| `integrations.db_dim_week` | Semaine |
| `integrations.db_dim_month` | Mois |
| `integrations.db_metric` | Métrique |
| `integrations.db_metric_aria` | Métrique |
| `integrations.db_display` | Affichage |
| `integrations.db_color_theme` | Thème couleur |
| `integrations.db_legend` | Légende |
| `integrations.db_labels` | Étiquettes |
| `integrations.db_preview_aria` | Aperçu du widget |
| `integrations.db_src_leads` | Leads |
| `integrations.db_src_tasks` | Tâches |
| `integrations.db_src_conversations` | Conversations |
| `integrations.db_src_events` | Rendez-vous |
| `integrations.db_src_invoices` | Factures |
| `integrations.db_m_count` | Compte (count) |
| `integrations.db_m_sum` | Somme (sum) |
| `integrations.db_m_avg` | Moyenne (avg) |
| `integrations.db_m_median` | Médiane (median) |
| `integrations.db_m_min` | Minimum (min) |
| `integrations.db_m_max` | Maximum (max) |
| `integrations.db_w_kpi` | KPI |
| `integrations.db_w_barchart` | Bar chart |
| `integrations.db_w_linechart` | Line chart |
| `integrations.db_w_donut` | Donut |
| `integrations.db_w_table` | Table |
| `integrations.db_w_map` | Carte |
| `integrations.db_w_funnel` | Funnel |
| `integrations.db_w_heatmap` | Heatmap |
| `integrations.db_resize` | Redimensionner (actuel : {size}) |
| `integrations.db_resize_title` | Redimensionner |
| `integrations.db_configure` | Configurer le widget |
| `integrations.db_configure_title` | Configurer |
| `integrations.db_delete` | Supprimer le widget |
| `integrations.db_delete_title` | Supprimer |
| `integrations.db_move` | Déplacer le widget (Espace pour activer, flèches pour bouger, Entrée pour déposer) |
| `integrations.db_move_title` | Déplacer |
| `integrations.db_add_widget` | Ajouter widget |
| `integrations.db_toolbar_aria` | Outils dashboard |
| `integrations.db_count_one` | {n} widget |
| `integrations.db_count_many` | {n} widgets |
| `integrations.db_empty_title` | Aucun widget |
| `integrations.db_empty_ro` | Ce tableau de bord ne contient pas encore de widgets. |
| `integrations.db_empty_edit` | Clique sur « Ajouter widget » pour commencer à construire ton tableau de bord. |

> `WIDGET_CATALOG` / `DATA_SOURCES` / `METRICS` sont des `const` modules :
> remplacer la valeur `label` par un getter `t(...)` AU RENDER (ne pas
> appeler `t()` au top-level). Pluriel widget : `count===1 ? db_count_one :
> db_count_many` avec `.replace('{n}', n)`.

#### B-5 · `src/pages/Templates.tsx` (résidus)

| Clé | Valeur fr-CA | Ligne |
|---|---|---|
| `templates.view_grid` | Vue grille | :167 |
| `templates.view_list` | Vue liste | :168 |
| `templates.row_collapse` | Réduire | :315 |
| `templates.row_expand` | Afficher les détails | :315 |
| `templates.name_placeholder` | Bienvenue nouveau lead | :375 |
| `templates.subject_placeholder` | Merci {{nom}} ! | :380 |
| `templates.body_placeholder` | `<h2>Bonjour {{nom}},</h2><p>Merci pour votre intérêt...</p>` | :395 |
| `templates.preview_placeholder` | `<p style="color:#999">Aperçu du contenu...</p>` | :437 |
| `templates.preview_title` | Aperçu : {name} | :465 — `{name}`=previewTemplate.name |
| `templates.preview_fallback` | Aperçu | :465 |

> `{{nom}}` est un token applicatif (slash-var), ne PAS le traduire — il fait
> partie de la valeur littérale. `tb()`/`tpl.modal.*` existants : ne pas
> toucher.

#### B-6 · `src/components/admin/FeatureUsageTable.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `admin.feat_title` | Top features utilisées |
| `admin.feat_subtitle` | Adoption par usage 30 derniers jours. |
| `admin.feat_col_feature` | Feature |
| `admin.feat_col_adoption` | Adoption |
| `admin.feat_col_sessions` | Sessions |
| `admin.feat_col_users` | Utilisateurs |
| `admin.feat_col_trend` | Tendance 30j |
| `admin.feat_col_last` | Dernière |
| `admin.feat_role_title` | Adoption par rôle |
| `admin.feat_role_none` | Aucune donnée disponible. |
| `admin.feat_role_admin` | Admin |
| `admin.feat_role_member` | Membre |
| `admin.feat_role_viewer` | Lecteur |
| `admin.feat_rel_now` | À l'instant |
| `admin.feat_rel_min` | il y a {n} min |
| `admin.feat_rel_hour` | il y a {n}h |
| `admin.feat_rel_day` | il y a {n}j |

> `formatRelative()` :85 — remplacer chaque retour par
> `t('admin.feat_rel_*').replace('{n}', String(x))`. Garder le `'—'` fallback.

#### B-7 · `src/components/admin/UserActivityHeatmap.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `admin.heat_title` | Heatmap activité |
| `admin.heat_subtitle` | Répartition par jour × heure. |
| `admin.heat_period_aria` | Période heatmap |
| `admin.heat_grid_aria` | Heatmap activité utilisateurs |
| `admin.heat_less` | Moins |
| `admin.heat_more` | Plus |
| `admin.period_7d` | 7 jours (PARTAGÉ B-1) |
| `admin.period_30d` | 30 jours (PARTAGÉ B-1) |
| `admin.period_90d` | 90 jours (PARTAGÉ B-1) |

> `DAY_LABELS_SHORT` / `DAY_LABELS_FULL` (Lun..Dim) + tooltip
> `"{jour} {heure} : {n} événement(s)"` : **HORS SCOPE LOT C** (cf §3) —
> jours de la semaine = candidat `common.*` futur, non créé ici pour ne pas
> sur-élargir. Laisser hardcodé pour l'instant.

#### B-8 · `src/components/reports/DashboardBuilder.tsx`

→ couvert par la table B-4 (`integrations.db_*`). Même fichier.

#### C-1 · `src/pages/settings/ComplianceSettings.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `compliance.toast_saved` | Mentions légales enregistrées |
| `compliance.toast_save_error` | Erreur lors de la sauvegarde |
| `compliance.toast_no_export` | Aucune donnée à exporter |
| `compliance.toast_export_ok` | Export CSV téléchargé |
| `compliance.toast_export_error` | Échec de l'export |
| `compliance.time_now` | À l'instant |
| `compliance.time_min` | Il y a {n} min |
| `compliance.time_hour` | Il y a {n}h |
| `compliance.time_day` | Il y a {n} jours |
| `compliance.kpi_total` | Désabonnés total |
| `compliance.kpi_email` | Email |
| `compliance.kpi_sms` | SMS |
| `compliance.kpi_rgpd` | RGPD requests |
| `compliance.page_title` | Conformité & légal |
| `compliance.page_subtitle` | Listes de désabonnement (Loi 25 / CASL) et mentions légales. |
| `compliance.legal_title` | Mentions légales |
| `compliance.legal_subtitle` | Insertion automatique dans les courriels sortants — AMF, RBQ, OACIQ. |
| `compliance.auto_title` | Mentions légales automatiques |
| `compliance.auto_desc` | Active l'insertion auto dans les courriels sortants. |
| `compliance.text_label` | Texte de la mention légale |
| `compliance.text_placeholder` | ex: 123456 — Cabinet enregistré auprès de l'AMF |
| `compliance.text_helper` | Numéro de permis, AMF, RBQ, OACIQ, etc. |
| `compliance.save` | Enregistrer |
| `compliance.optout_title` | Liste de suppression (opt-outs) |
| `compliance.optout_subtitle` | Conformité Loi 25 / CASL. |
| `compliance.export_csv` | Exporter CSV |
| `compliance.loading` | Chargement... |
| `compliance.empty_title` | Aucun contact désabonné |
| `compliance.empty_desc` | Les opt-outs apparaîtront ici (CASL / RGPD). |

> `compliance.tps/tvq/loi25/casl` existants : NE PAS toucher.
> `timeAgo()` :92 → `t('compliance.time_*').replace('{n}', String(x))`.

#### C-2 · `src/pages/settings/CustomFieldsSettings.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `customfields.confirm_title` | Supprimer ce champ personnalisé ? |
| `customfields.confirm_desc` | Les valeurs déjà saisies sur les leads pour ce champ seront perdues. |
| `customfields.confirm_yes` | Supprimer |
| `customfields.toast_deleted` | Champ supprimé |
| `customfields.toast_added` | Champ ajouté |
| `customfields.new_name` | Nouveau champ {n} — `{n}`=fields.length+1 |
| `customfields.kpi_total` | Total champs |
| `customfields.kpi_text` | Texte |
| `customfields.kpi_number` | Nombre |
| `customfields.kpi_select` | Sélection |
| `customfields.loading` | Chargement... |
| `customfields.page_title` | Champs personnalisés |
| `customfields.page_subtitle` | Enrichis tes fiches leads avec des champs spécifiques à ton processus de vente. |
| `customfields.empty_title` | Aucun champ personnalisé |
| `customfields.empty_desc` | Créez votre premier champ pour enrichir les fiches leads (texte, nombre, sélection...). |
| `customfields.add_quick` | Ajouter un champ rapide |
| `customfields.actions_aria` | Actions |
| `customfields.delete` | Supprimer |
| `customfields.save_order` | Enregistrer l'ordre |

#### C-3 · `src/components/onboarding/OnboardingWizard.tsx`

> `onboarding.*` existant (welcome/step/region/...) NE concerne PAS ce
> wizard (autre composant). Le wizard utilise `onboarding.wiz_*` +
> `onboarding.ind_*`. Liste exhaustive :

| Clé | Valeur fr-CA |
|---|---|
| `onboarding.wiz_skip_info` | Onboarding ignoré. Vous pouvez le reprendre plus tard. |
| `onboarding.wiz_done` | Configuration terminée ! Bienvenue dans Intralys. |
| `onboarding.wiz_save_error` | Erreur lors de la sauvegarde. |
| `onboarding.wiz_title` | Bienvenue sur Intralys |
| `onboarding.wiz_step_of` | Étape {step} sur {total} |
| `onboarding.wiz_pct` | {pct}% complété |
| `onboarding.wiz_welcome` | Bienvenue |
| `onboarding.wiz_welcome_body` | Nous sommes ravis de vous accueillir dans Intralys CRM. Prenons 2 minutes pour configurer votre compte afin de vous offrir la meilleure expérience possible. |
| `onboarding.wiz_founder_word` | Mot du fondateur (30s) |
| `onboarding.wiz_company_title` | Parlez-nous de votre entreprise |
| `onboarding.wiz_company_name` | Nom de l'entreprise |
| `onboarding.wiz_company_name_ph` | Ex: Agence Tremblay |
| `onboarding.wiz_industry_label` | Type d'industrie |
| `onboarding.wiz_industry_search` | Cherchez votre industrie... |
| `onboarding.wiz_industry_empty` | Aucune industrie trouvée |
| `onboarding.wiz_team_size` | Taille de l'équipe |
| `onboarding.wiz_customize_title` | Personnalisez votre CRM |
| `onboarding.wiz_primary_color` | Couleur principale |
| `onboarding.wiz_logo` | Logo de l'entreprise |
| `onboarding.wiz_upload_click` | Cliquez pour uploader |
| `onboarding.wiz_upload_hint` | PNG, JPG ou SVG (max 2MB) |
| `onboarding.wiz_pack_title` | Pack Industrie Recommandé |
| `onboarding.wiz_pack_desc` | Basé sur votre industrie, nous avons préconfiguré un ensemble de champs, pipelines et automatisations adaptés à votre métier. |
| `onboarding.wiz_pack_name` | Pack Courtage Immobilier |
| `onboarding.wiz_pack_sub` | Optimisé pour le marché québécois (OACIQ) |
| `onboarding.wiz_pack_recommended` | Recommandé |
| `onboarding.wiz_pack_f1` | Pipeline Achat & Vente préconfiguré |
| `onboarding.wiz_pack_f2` | Champs personnalisés (Budget, Quartier...) |
| `onboarding.wiz_pack_f3` | 3 automatisations de relance SMS/Email |
| `onboarding.wiz_pack_f4` | Modèles d'emails conformes Loi 25 |
| `onboarding.wiz_pack_installed` | Pack installé avec succès ! |
| `onboarding.wiz_pack_install_btn` | Installer le pack (Optionnel) |
| `onboarding.wiz_lead_title` | Créons votre premier prospect (Lead) |
| `onboarding.wiz_lead_desc` | Le moyen le plus rapide d'apprendre est de pratiquer. Ajoutons un prospect test pour voir comment Intralys gère le cycle de vie. |
| `onboarding.wiz_fullname_ph` | Nom complet |
| `onboarding.wiz_email_ph` | Email |
| `onboarding.wiz_emails_title` | Connecter vos courriels |
| `onboarding.wiz_emails_desc` | Intralys a besoin de se connecter à votre adresse email pour envoyer des campagnes et notifications automatiques de la part de votre domaine. |
| `onboarding.wiz_resend` | Connexion Resend / SMTP |
| `onboarding.wiz_resend_desc` | Configuration technique requise (DNS) |
| `onboarding.wiz_gen_dns` | Générer les enregistrements DNS |
| `onboarding.wiz_team_title` | Invitez votre équipe |
| `onboarding.wiz_team_desc` | Collaborez avec vos agents et assistants. Vous pouvez aussi faire cette étape plus tard depuis les paramètres. |
| `onboarding.wiz_invite_email_ph` | adresse@email.com |
| `onboarding.wiz_invite` | Inviter |
| `onboarding.wiz_ready_title` | Tout est prêt ! |
| `onboarding.wiz_ready_desc` | Votre CRM est configuré. Prêt à faire un rapide tour du propriétaire pour découvrir les fonctionnalités clés ? |
| `onboarding.wiz_skip_step` | Ignorer cette étape |
| `onboarding.wiz_prev` | Précédent |
| `onboarding.wiz_finalizing` | Finalisation... |
| `onboarding.wiz_start_tour` | Commencer le tour |
| `onboarding.wiz_next` | Suivant |
| `onboarding.wiz_default_name` | Rochdi |

Industries `INDUSTRY_OPTIONS` (label + description) — clés `ind_*` :
`real_estate, local_services, health, coaching, beauty, fitness, legal,
accounting, restaurant, education, automotive, construction, agency,
photo_video, events, tech, finance, nonprofit, retail, generic_b2b`.
Pour chaque : `onboarding.ind_<x>` (label) + `onboarding.ind_<x>_d`
(description). Valeurs fr-CA = texte original verbatim de chaque entrée
(ex. `ind_real_estate`='Courtage immobilier',
`ind_real_estate_d`='Agents, courtiers, agences immo'). Les `icon` emoji
restent inchangés. Remplacer `label`/`description` AU RENDER (mapper via
`value`→clé), pas au top-level module.

> `wiz_step_of` : `t(...).replace('{step}',s).replace('{total}',TOTAL)`.
> `wiz_pct` : `.replace('{pct}', String(Math.round(...)))`.

#### C-4 · `src/components/panels/TaskPanel.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `panels.task_err` | Erreur : {msg} |
| `panels.task_subtask_err` | Erreur création sous-tâche : {msg} |
| `panels.task_comment_err` | Erreur ajout commentaire : {msg} |
| `panels.task_err_unknown` | inconnue |
| `panels.task_deleted` | Tâche supprimée |
| `panels.task_due_today` | Aujourd'hui |
| `panels.task_due_tomorrow` | Demain |
| `panels.task_kpi_status` | Statut |
| `panels.task_kpi_priority` | Priorité |
| `panels.task_kpi_due` | Échéance |
| `panels.task_kpi_subtasks` | Sous-tâches |
| `panels.task_fallback_title` | Tâche |
| `panels.task_delete_aria` | Supprimer la tâche |
| `panels.task_delete_tip` | Supprimer la tâche |
| `panels.task_not_found` | Tâche introuvable. |
| `panels.task_change_status` | Changer le statut |
| `panels.task_status_label` | Statut |
| `panels.task_change_priority` | Changer la priorité |
| `panels.task_priority_label` | Priorité |
| `panels.task_due_tip` | Échéance |
| `panels.task_linked_lead` | Lead lié : |
| `panels.task_see_lead` | Voir lead |
| `panels.task_description` | Description |
| `panels.task_edit` | Modifier |
| `panels.task_desc_ph` | Décris cette tâche... |
| `panels.task_save` | Enregistrer |
| `panels.task_cancel` | Annuler |
| `panels.task_no_desc` | Aucune description — clique pour ajouter |
| `panels.task_subtasks` | Sous-tâches |
| `panels.task_subtask_done_aria` | Marquer fait |
| `panels.task_subtask_undone_aria` | Marquer non-fait |
| `panels.task_subtask_del_aria` | Supprimer sous-tâche |
| `panels.task_subtask_ph` | Nouvelle sous-tâche... |
| `panels.task_subtask_add_aria` | Ajouter sous-tâche |
| `panels.task_add` | Ajouter |
| `panels.task_comments` | Commentaires |
| `panels.task_no_comments` | Aucun commentaire pour l'instant. |
| `panels.task_author_system` | Système |
| `panels.task_comment_del_aria` | Supprimer commentaire |
| `panels.task_comment_ph` | Ajouter un commentaire... |
| `panels.task_comment_btn` | Commenter |

> `Erreur : {res.error}` → `t('panels.task_err').replace('{msg}', res.error)`.
> `TASK_STATUS_LABELS`/`TASK_PRIORITY_LABELS` viennent de `@/lib/types`
> (HORS scope LOT C — ne pas toucher).

#### C-4b · `src/components/panels/AiNextActionCard.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `panels.ai_next_title` | Prochaine étape suggérée |
| `panels.ai_next_desc` | Ce lead semble inactif — laissez l'AI proposer une action concrète. |
| `panels.ai_next_generating` | Génération… |
| `panels.ai_next_generate` | Générer une suggestion |
| `panels.ai_next_err` | Erreur AI : {msg} |
| `panels.ai_next_err_none` | pas de suggestion disponible |
| `panels.ai_next_copied` | Brouillon copié |
| `panels.ai_action_email` | Email |
| `panels.ai_action_sms` | SMS |
| `panels.ai_action_call` | Appel |
| `panels.ai_suggested` | {label} suggéré |
| `panels.ai_copy` | Copier |
| `panels.ai_copied` | Copié |
| `panels.ai_regenerate` | Régénérer la suggestion |
| `panels.ai_regenerate_title` | Régénérer |
| `panels.ai_generated_by` | Généré par Claude Haiku 4.5 |

> `ACTION_META` label `Email/SMS/Appel` → mapper au render via
> `panels.ai_action_*`. `{label} suggéré` →
> `t('panels.ai_suggested').replace('{label}', meta.label)`.

#### C-4c · `src/components/panels/LeadPredictionCard.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `panels.predict_conf_high` | Confiance élevée |
| `panels.predict_conf_medium` | Confiance moyenne |
| `panels.predict_conf_low` | Confiance faible |
| `panels.predict_gauge_aria` | Probabilité de conversion sous 30 jours : {pct}% |
| `panels.predict_under_30d` | sous 30j |
| `panels.predict_actions` | Actions suggérées |
| `panels.predict_foot_local` | Estimation locale (hors-ligne) |
| `panels.predict_foot_ai` | Estimé par Claude Haiku 4.5 |
| `panels.predict_title` | Prévision 30 jours |

#### C-4d · `src/components/panels/ConversationHoverPreview.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `panels.conv_now` | maintenant |
| `panels.conv_min` | il y a {n}m |
| `panels.conv_hour` | il y a {n}h |
| `panels.conv_day` | il y a {n}j |
| `panels.conv_you` | Vous |
| `panels.conv_contact` | Contact |
| `panels.conv_unknown` | Inconnu |
| `panels.conv_no_recent` | Aucun message récent. |
| `panels.conv_preview` | Aperçu |
| `panels.conv_click_open` | Cliquer pour ouvrir → |

> `relTime()` :117 → `t('panels.conv_*').replace('{n}', String(x))`.
> `CHANNEL_LABELS` (`@/lib/types`) HORS scope.

#### C-5 · `src/components/ui/ScopePicker.tsx` + `src/components/ui/BulkActionBar.tsx`

→ **HORS SCOPE LOT C (reporté LOT C-bis)**. Voir §3 ci-dessous. Aucune clé
fournie : si C tente de les i18n-iser → STOP, signaler. Laisser le FR
hardcodé tel quel pour ce lot.

#### C-6 · `src/components/feedback/NpsModal.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `feedback.nps_thanks` | Merci pour vos précieux retours ! |
| `feedback.nps_send_error` | Erreur lors de l'envoi. |
| `feedback.nps_title` | Votre avis compte |
| `feedback.nps_question` | Quelle est la probabilité que vous recommandiez Intralys à un collègue ou un ami ? |
| `feedback.nps_score_aria` | Note {n} sur 10 |
| `feedback.nps_not_likely` | Pas du tout probable |
| `feedback.nps_very_likely` | Très probable |
| `feedback.nps_detractors` | Détracteurs |
| `feedback.nps_passives` | Passifs |
| `feedback.nps_promoters` | Promoteurs |
| `feedback.nps_q_promoter` | Super ! Qu'est-ce qui vous plaît le plus ? |
| `feedback.nps_q_passive` | Merci. Que pourrions-nous améliorer ? |
| `feedback.nps_q_detractor` | Désolé de l'apprendre. Comment pouvons-nous corriger le tir ? |
| `feedback.nps_followup` | Votre réponse détaillée nous aidera à faire d'Intralys le meilleur outil pour vous. |
| `feedback.nps_comment_ph` | Partagez vos pensées... |
| `feedback.nps_later` | Plus tard |
| `feedback.nps_sending` | Envoi... |
| `feedback.nps_send` | Envoyer la réponse |

> `Note {n} sur 10` → `.replace('{n}', String(num))`.

#### C-6b · `src/components/feedback/FeedbackWidget.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `feedback.fw_select_rating` | Veuillez sélectionner une note. |
| `feedback.fw_send_error` | Erreur lors de l'envoi. |
| `feedback.fw_title` | Votre avis compte |
| `feedback.fw_close` | Fermer |
| `feedback.fw_thanks_title` | Merci ! |
| `feedback.fw_thanks_body` | Vos retours nous aident à améliorer Intralys. |
| `feedback.fw_rate_label` | Comment évaluez-vous votre expérience ? |
| `feedback.fw_star_aria` | {n} étoiles |
| `feedback.fw_star_aria_one` | 1 étoile |
| `feedback.fw_r5` | `Excellent ` (espace final volontaire) |
| `feedback.fw_r4` | `Très bien ` (espace final volontaire) |
| `feedback.fw_r3` | Correct |
| `feedback.fw_r2` | À améliorer |
| `feedback.fw_r1` | Décevant |
| `feedback.fw_comment_ph` | Dites-nous ce qui fonctionne bien, ou ce qu'on pourrait améliorer... |
| `feedback.fw_sending` | Envoi... |
| `feedback.fw_send` | Envoyer |
| `feedback.fw_fab_aria` | Donner votre avis |

> `{star} étoile(s)` : si `star>1` → `fw_star_aria` `.replace('{n}',star)`,
> sinon `fw_star_aria_one`.

#### C-6c · `src/components/feedback/BetaFeedbackWidget.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `feedback.beta_type_bug` | Bug |
| `feedback.beta_type_idea` | Idée |
| `feedback.beta_type_question` | Question |
| `feedback.beta_capture_unavail` | Capture non disponible sur cet appareil. |
| `feedback.beta_capture_failed` | La capture a échoué. |
| `feedback.beta_write_msg` | Écris un petit message avant d'envoyer. |
| `feedback.beta_thanks` | Merci pour ton retour ! |
| `feedback.beta_thanks_title` | Bien reçu |
| `feedback.beta_send_impossible` | Envoi impossible, réessaye dans un instant. |
| `feedback.beta_check_conn` | Vérifie ta connexion et réessaye. |
| `feedback.beta_dialog_aria` | Donner un retour |
| `feedback.beta_panel_title` | Un retour à partager ? |
| `feedback.beta_close` | Fermer |
| `feedback.beta_type_aria` | Type de retour |
| `feedback.beta_msg_ph` | Dis-nous ce que tu as en tête… |
| `feedback.beta_msg_aria` | Ton message |
| `feedback.beta_shot_attached` | Capture jointe |
| `feedback.beta_shot_busy` | Capture… |
| `feedback.beta_shot_attach` | Joindre une capture |
| `feedback.beta_sending` | Envoi… |
| `feedback.beta_send` | Envoyer |
| `feedback.beta_fab_aria` | Donner un retour |

> `TYPES` const label Bug/Idée/Question → mapper au render via
> `feedback.beta_type_*`.

#### C-7 · `src/components/Inbox/ConversationsList.tsx`

| Clé | Valeur fr-CA |
|---|---|
| `inbox.list_title` | Boîte de réception |
| `inbox.list_new_conv` | Nouvelle conversation |
| `inbox.list_search_ph` | Rechercher... |
| `inbox.list_search_clear` | Effacer la recherche |
| `inbox.list_tab_all` | Toutes |
| `inbox.list_ch_all` | Tous |
| `inbox.list_ch_email` | Email |
| `inbox.list_ch_sms` | SMS |
| `inbox.list_ch_chat` | Chat |
| `inbox.list_ch_meta` | Meta |
| `inbox.list_empty_title` | Aucune conversation |
| `inbox.list_empty_body` | Connecte un canal pour recevoir tes premiers messages. |
| `inbox.list_empty_cta` | Nouvelle conversation |
| `inbox.list_now` | maintenant |
| `inbox.list_unknown` | Inconnu |
| `inbox.list_select_aria` | Sélectionner la conversation avec {name} |
| `inbox.list_unstar_aria` | Retirer le marquage étoilé |
| `inbox.list_archive_aria` | Archiver la conversation |
| `inbox.list_archive_title` | Archiver |
| `inbox.list_delete_aria` | Supprimer la conversation |
| `inbox.list_delete_title` | Supprimer |

> `inbox.*` existant (title/subtitle/page.*/bulk.*) NE PAS toucher.
> `CONVERSATION_STATUS_LABELS` (`@/lib/types`) HORS scope (open/closed/snoozed).
> `{name}` : `.replace('{name}', conv.lead_name || t('inbox.list_unknown'))`.
> `timeAgo()` interne : `mins<1 → t('inbox.list_now')`, le reste reste
> compact `{n}m/{n}h/{n}j` non i18n-isé (format numérique, pas de mot).

### (3) Hors scope LOT C — reporté LOT C-bis (honnête, pas de demi-travail caché)

Priorisation appliquée (cf brief : 4 sous-pages 0-i18n + OnboardingWizard
prioritaires). Reportés explicitement, AUCUNE clé créée pour eux :

- `src/components/ui/ScopePicker.tsx` — ~40 strings (API_SCOPES /
  WEBHOOK_EVENTS labels+desc, headers). Volume élevé, composant générique
  config technique (scopes API affichés en `code`). LOT C-bis.
- `src/components/ui/BulkActionBar.tsx` — "Désélectionner / sélectionné(s) /
  Tout désélectionner" + a11y. Logique pluriel SR. LOT C-bis.
- `UserActivityHeatmap` : jours semaine (Lun..Dim) + tooltip composé —
  candidat `common.weekday_*` futur, non créé pour ne pas sur-élargir le
  namespace `common.*`. LOT C-bis.
- Titres d'articles `HelpCenter` (data `.md`) : contenu, non UI string.

---

§6 FIGÉ → Phase B peut démarrer.
