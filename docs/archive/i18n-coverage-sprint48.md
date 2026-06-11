# i18n — Coverage report (Sprint 48 M2)

État de la traduction par locale et chemin de progression vers 100%.

## État Sprint 48 M2

### Catalogue cœur (par locale)

| Locale | Clés catalogue | Source file |
|--------|----------------|-------------|
| fr-CA | ~250 keys | `src/lib/i18n/fr-CA.ts` |
| fr-FR | ~250 keys | `src/lib/i18n/fr-FR.ts` |
| en | ~250 keys | `src/lib/i18n/en.ts` |
| es | ~250 keys | `src/lib/i18n/es.ts` |

Catégories couvertes :
- API errors (5 keys)
- Auth (20 keys)
- Errors / 404 (7 keys)
- Offline (6 keys)
- Share (2 keys)
- Navigation principale (26 keys)
- Common actions (50 keys)
- States (24 keys)
- Forms — labels (30 keys)
- Forms — placeholders (7 keys)
- Forms — validation (12 keys)
- Dashboard (15 keys)
- Leads (13 keys)
- Lead detail (6 keys)
- Pipeline (11 keys)
- Tasks (11 keys)
- Inbox (10 keys)
- Calendar (10 keys)
- Reports (10 keys)
- Settings (20 keys)
- Onboarding (16 keys)
- Marketing landing (8 keys)
- Marketing pricing (12 keys)
- Marketing about (2 keys)
- Marketing contact (7 keys)
- Legal — Quebec compliance (5 keys, terms preserved)
- Compliance terms (5 keys, preserved)
- Toast (7 keys)
- Empty states (4 keys)
- Tooltips (5 keys)
- Locale-specific (4 keys, qc.*)

---

## Hardcoded vs i18n.t()

**Stratégie Sprint 48** : ne PAS retraduire chaque string hardcoded dans .tsx. Le catalogue couvre les strings critiques. Migration progressive prévue Sprint 49+.

### Composants déjà migrés t()

- `src/pages/NotFound.tsx` — errors.* keys
- `src/pages/OfflineFallback.tsx` — offline.* keys
- `src/pages/Login.tsx` — auth.* keys
- `src/components/ui/ShareButton.tsx` — share.* keys
- `src/lib/api.ts` — api.* keys (toast errors)

### Composants à migrer (priorité haute pour Sprint 49+)

- `src/components/layout/Sidebar.tsx` — nav.* keys (26 keys disponibles)
- `src/pages/Dashboard.tsx` — dashboard.* keys (15 keys disponibles)
- `src/pages/Leads.tsx` — leads.* keys (13 keys disponibles)
- `src/pages/LeadDetail.tsx` — lead_detail.* keys
- `src/pages/Pipeline.tsx` — pipeline.* keys
- `src/pages/Tasks.tsx` — tasks.* keys
- `src/pages/Inbox.tsx` — inbox.* keys
- `src/pages/Calendar.tsx` — calendar.* keys
- `src/pages/Reports.tsx` — reports.* keys
- `src/pages/Settings.tsx` + `src/components/settings/*.tsx` — settings.* keys
- `src/components/onboarding/WelcomeWizard.tsx` — onboarding.* keys
- `src/pages/marketing/*.tsx` — marketing.* keys
- `src/pages/marketing/legal/*.tsx` — legal.* keys

### Composants à migrer (priorité basse)

- `src/components/QuickAddFab.tsx`
- `src/components/CommandPalette.tsx`
- Sub-componentes panels (LeadTimeline, ActivityFeedPanel...)
- Forms (FormBuilder, EmailBuilder)
- DocumentTemplates, Documents
- Workflows, Templates
- Admin pages

---

## Méthode de migration (Sprint 49+)

Pattern recommandé pour migration progressive :

```tsx
// Avant
<h1>Tableau de bord</h1>
<button>Annuler</button>

// Après
import { t } from '@/lib/i18n';

<h1>{t('nav.dashboard')}</h1>
<button>{t('action.cancel')}</button>
```

Pour ajouter une clé manquante :
1. Ajouter dans `fr-CA.ts` (source de vérité)
2. Mirror dans `fr-FR.ts`, `en.ts`, `es.ts` (4 fichiers, ~30 sec)
3. Utiliser dans le composant : `t('nouvelle.clé')`

Fallback automatique :
- Clé manquante dans la locale active → fallback `en` → fallback `key` brut

---

## Stratégie de couverture

| Sprint | Coverage cible | Pages cibles |
|--------|----------------|--------------|
| **48 M2** (actuel) | Catalogue 250 keys + 4 langues | (catalogue uniquement) |
| 49 | Pages cœur t() wired | Sidebar + Dashboard + Leads + Pipeline + Tasks |
| 50 | Pages secondaires | Inbox + Calendar + Reports + Settings + Onboarding |
| 51 | Marketing + Legal | Landing + Pricing + About + Contact + Legal pages |
| 52 | Forms + Admin + RTL prep | FormBuilder + EmailBuilder + Admin + AR/HE catalogue |

---

## Tests recommandés

- [x] Switch langue via Settings → reload page → strings catalogue traduits
- [x] First visit avec navigator FR → fr-FR auto-detect
- [x] First visit avec navigator EN-US → en auto-detect
- [x] First visit avec navigator ES-MX → es auto-detect
- [x] First visit avec navigator FR-CA explicit → fr-CA auto-detect
- [x] `<html lang>` updated au switch
- [ ] WelcomeWizard sync langue → persistence post-onboarding
- [ ] RTL stub : forcing locale 'ar' (manuel localStorage) → `<html dir="rtl">` se met à jour
- [ ] Build TS strict : 0 errors imports

---

## Notes back-compat

- API Sprint 35 (`t`, `getLocale`, `setLocale`, `availableLocales`) → 100% préservée
- Type `Locale` étendu : `'fr-CA' | 'en'` → `'fr-CA' | 'fr-FR' | 'en' | 'es'` (additif, breaking si checks exhaustifs sur 2 cases — à auditer si nécessaire)
- `setLocale(locale, { reloadAfterChange: false })` nouveau paramètre optionnel (back-compat car opt-in)
- Anciens `src/i18n/fr-CA.json` et `src/i18n/en.json` non supprimés (legacy, plus utilisés mais conservés safe-zone)

---

## Quebec compliance non-traduit (volontaire)

Ces termes restent identiques dans **toutes les locales** :

- `compliance.loi25` — "Loi 25" (mention "(Quebec)" en EN/ES)
- `compliance.casl` — "LCAP" / "CASL"
- `compliance.tps` — "TPS" / "GST (TPS)" en EN
- `compliance.tvq` — "TVQ" / "QST (TVQ)" en EN
- `compliance.gst_hst` — "GST/HST" partout

Raison : terminologie légale/fiscale officielle, non traduisible sans risque de confusion contractuelle.
