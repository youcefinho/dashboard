# LOT MULTILANG-B — Multi-langue sortant (fondations)

Sprint B, méthode Chaman (READ-ONLY) → Phase A SOLO → Phase B (B∥C).
Objectif : stocker / exposer / segmenter la langue préférée d'un contact et
traduire les **libellés système-transactionnels** sortants (footer CASL,
désabonnement, confirmations) via un résolveur worker pur `tLead`.

**Honnêteté v1** : PAS de traduction auto du contenu marketing libre (v2).
Canaux v1 = footer email broadcast + libellés transactionnels documents/reviews.
SMS = v2. Capture v1 = manuel (sélecteur LeadDetail, Phase B-C) + opt-in
ingestion (alias + fallback Accept-Language). PAS de déduction heuristique.

---

## §0 audit (Chaman READ-ONLY)

- `preferred_language` / langue ABSENTE de `leads` (confirmé).
- PATCH lead = builder opt-in champ-par-champ (`leads.ts` PATCH, calque
  `country`/`timezone`), gaté `patchLeadSchemaS3` + `capGuard(auth, 'leads.write')`.
- Catalogues i18n `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` exportent des
  `Record<string,string>` plats IMPORTABLES côté worker. MAIS `t()`
  (`src/lib/i18n.ts`) est navigateur-couplé (window/localStorage/navigator)
  → NE PAS importer dans le worker ; résolveur pur `tLead`.
- Templates email NON multilingues (libellés système en dur FR,
  `compliance.ts generateCaslFooter`). `lead-mapping.ts` ne capturait pas la
  langue.
- seq 97 dernière → 98 libre. `leads.read`/`leads.write` ∈ ALL_CAPABILITIES.

---

## §6.A archi (tranché)

- `ALTER leads ADD COLUMN preferred_language TEXT` **nullable défaut NULL**
  (NULL = défaut tenant fr-CA). Valeurs `'fr-CA'|'fr-FR'|'en'|'es'` validées
  **HANDLER** (whitelist JS), JAMAIS CHECK SQL.
- Capture v1 : manuel (sélecteur LeadDetail Phase B-C) + opt-in ingestion
  (alias `preferred_language|language|langue|locale|lang` + fallback
  Accept-Language). PAS de déduction heuristique.
- Usage v1 (honnête) : STOCKER + EXPOSER + SEGMENTER + traduire LIBELLÉS
  SYSTÈME/TRANSACTIONNELS via `tLead`. PAS de traduction auto du marketing libre.
- Résolveur worker `i18n-server.ts` : importe les objets catalogue,
  `tLead(locale, key, vars?) = DICTS[locale]?.[key] ?? en[key] ?? key`.
  Pas de mini-dico dupliqué. Pur, sans état (locale passée explicitement).
- Segmentation par langue (Phase B-C : `SegmentCriteria.preferred_language`).
  Capability `leads.read`/`leads.write` réutilisées (ZÉRO ajout).

---

## §6.B migration seq 98

Fichier : `migration-multilang-out-seq98.sql`, `depends_on: ["migration-scheduled-reports-seq97.sql"]`.
En-tête garde-fous calqué seq 97. ALTER additif nullable SANS contrainte.

```sql
ALTER TABLE leads ADD COLUMN preferred_language TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_preferred_language ON leads(client_id, preferred_language);
```

INTERDIT : NOT NULL / DEFAULT non-NULL / CHECK / rebuild / FK / DROP.
Manifest : `{ "seq": 98, "file": "migration-multilang-out-seq98.sql",
"depends_on": ["migration-scheduled-reports-seq97.sql"],
"objects": ["alter:leads","index:leads"], "risk": "low" }`.

---

## §6.C backend (Phase A)

- `src/worker/i18n-server.ts` NEUF : `tLead(locale, key, vars?)` pur +
  `normalizeLeadLocale(raw)` + `SUPPORTED_LEAD_LOCALES` + `DEFAULT_LEAD_LOCALE`.
  DICTS{fr-CA,fr-FR,en,es} importés des catalogues. Aucun window/localStorage.
- `leads.ts` PATCH (après `timezone`) : bloc `if (body.preferred_language !== undefined)`
  → `normalizeLeadLocale` (hors-liste OU '' → NULL), `updates.push`, activity
  `'language_changed'`. `params` élargi `(string|number|null)[]` pour binder NULL.
- `leads.ts` ingestion (`ingestLead`, INSERT) : colonne `preferred_language`
  ajoutée ; valeur = `m.preferred_language` sinon fallback `Accept-Language`
  normalisé. dryRun preview enrichi `preferred_language`.
- `lead-mapping.ts` : `LeadMappingResult += preferred_language: string|null` ;
  alias `preferred_language: ['preferred_language','language','langue','locale','lang']`
  dans `DEFAULT_MAPPING` ; champ rempli via `normalizeLeadLocale(pick(...))`.
- `leads.ts` GET (`handleGetLeads` / `handleGetClientLeads`) : filtre opt-in
  `language` (calque `status`, whitelist `SUPPORTED_LEAD_LOCALES`). SELECT *
  remonte déjà la colonne.
- INSERT manuel (`handleCreateLead`) INCHANGÉ → `preferred_language` NULL,
  éditable ensuite via PATCH.
- `patchLeadSchemaS3` : `preferred_language: z.string().max(10).optional()`
  (permissif ; whitelist stricte côté handler).

---

## §6.D api.ts

- Type `Lead` (`src/lib/types.ts`) += `preferred_language?: string|null`
  (additif optionnel).
- `updateLead` : `updates.preferred_language?: string` (additif).
- `getLeads` / `getClientLeads` : param `language?: string` additif, émis en
  `?language=` UNIQUEMENT si fourni → URL/réponse byte-identiques sinon.

---

## §6.E i18n ×4 (parité stricte)

UI sélecteur : `leads.language.label`, `leads.language.default`, `leads.language.help`.
Dictionnaire système (consommé par `tLead` Phase B) : `system.unsubscribe`,
`system.casl_notice`, `system.casl_law`, `system.signature`,
`system.review_request`, `system.ticket_confirm`, `system.booking_confirm`.
**10 clés × 4 catalogues** (fr-CA / fr-FR / en / es), parité respectée.

---

## §6.G découpage

- **Phase A SOLO (fait)** : migration + manifest + `i18n-server.ts` + clés i18n ×4
  + type `Lead` + `patchLeadSchemaS3` + PATCH leads + capture ingestion +
  `lead-mapping.ts`.
- **Phase B Manager-B (sortant)** : `compliance.generateCaslFooter(url, locale?)`
  param locale optionnel byte-identique + branchements broadcast/documents/
  reviews via `tLead`.
- **Phase B Manager-C (segmentation+UI)** : `SegmentCriteria.preferred_language`
  + filtre liste + sélecteur LeadDetail.

---

## §6.I garde-fous tenus

ALTER additif nullable strict (jamais NOT NULL/DEFAULT/CHECK/rebuild/FK) ·
CHECK59/E4-E6 jamais touchés · LeadDetail (page R) NON touchée Phase A ·
bornage tenant (client_id depuis auth, jamais body) · ZÉRO ajout
ALL_CAPABILITIES · ApiResponse inchangé (champs/params nouveaux OPTIONNELS) ·
parité i18n ×4 · honnêteté (pas de traduction auto marketing) · jamais git.

---

## §6.H IMPLEMENTATION-LOG — Phase B Manager-C (segmentation + UI) — FAIT

Périmètre EXCLUSIF tenu (segmentation langue + sélecteur LeadDetail + filtre liste).
Aucun fichier Manager-B / Phase-A gelé touché.

- **`src/worker/segments.ts`** :
  - `SegmentCriteria` += `preferred_language?: string[]` (additif).
  - `buildSegmentQuery` : bloc additif `preferred_language IN (...)` posé
    JUSTE après le bloc `source IN (...)` (calque exact : placeholders + binds).
    Bornage tenant déjà assuré par `leads.client_id = ?` de la query de base —
    AUCUNE borne supplémentaire requise (colonne directe `leads`, pas de JOIN
    cross-tenant comme les critères comportementaux). ZÉRO ajout capability.
- **`src/lib/api.ts`** : type miroir `SegmentCriteria` += `preferred_language?: string[]`
  (additif optionnel).
- **`src/pages/LeadDetail.tsx`** (page R — modif ULTRA-CIBLÉE ADDITIVE) :
  - UN `<select>` langue ajouté DANS la Card « Champs étendus » existante, à la
    suite des lignes `country`/`timezone` (même conteneur `space-y-2 text-xs`).
  - Options : `''`(=`leads.language.default`) / `fr-CA` / `fr-FR` / `en` / `es`.
    Valeur courante = `lead.preferred_language || ''`.
  - onChange optimiste (calque `favorite`/`dnd`) : `setLead({...lead,
    preferred_language: value || null})` puis `updateLead(leadId,
    {preferred_language: value})` ; rollback `setLead(prev)` + `toastError` si
    erreur, sinon `void loadLead()`. Help line `leads.language.help` sous le champ.
  - AUCUN refactor : autres champs (email/phone/address/country/timezone/dob),
    layout 3-colonnes, hooks de chargement (`loadLead`/`useEffect`), onglets,
    tabs INTACTS. Aucune nouvelle dépendance / import (réutilise `updateLead`,
    `t`, `toastError`, `loadLead`, `setLead` déjà présents).
- **`src/pages/Leads.tsx`** (filtre additif — jugé TRIVIAL/sûr, fait) :
  - State `langFilter` + persistance `localStorage` `intralys_leads_filter_lang`
    (calque status/source/client).
  - `<select>` langue ajouté dans la barre de filtres après le filtre client
    (mêmes classes/options que LeadDetail).
  - `getLeads({...,language: langFilter || undefined})` câblé sur `loadData` ET
    `handleLoadMore` (curseur) ; deps `useCallback` élargies.
  - `hasFilters` élargi ; 2 handlers « Réinitialiser/Tout » remettent `langFilter`.
  - Smart-lists round-trip : `filters.language` sauvé (`saveSmartList`) + restauré
    (`loadSmartList`). `SmartList.filters` = `Record<string,unknown>` → type-safe.

i18n : clés `leads.language.{label,default,help}` Phase A RÉUTILISÉES (×4 catalogues
déjà présentes), AUCUNE clé créée. Type `Lead.preferred_language?: string|null`
Phase A RÉUTILISÉ (figé). `updateLead.preferred_language?: string` Phase A réutilisé.

---

## §6.J IMPLEMENTATION-LOG — Phase B Manager-B (libellés système sortants) — FAIT

Branchement des libellés SYSTÈME sortants sur `tLead`. DISJOINT de Manager-C
(segmentation `segments.ts` + UI `src/pages/*` dont LeadDetail) — ZÉRO touch.

### Pattern byte-identique (clé du lot)

Les catalogues `system.*` (Phase A) ont des chaînes FR **différentes** des
libellés FR en dur historiques (footer en dur = « …communications d'Intralys. »
+ « Se désabonner | Conformément… » ; catalogue `system.casl_notice` =
« …communications. » sans « d'Intralys »). Brancher aveuglément `tLead` sur le
chemin par défaut CASSERAIT le byte-identique.

→ **Résolution** : à chaque injection on calcule
`resolved = normalizeLeadLocale(locale) ?? DEFAULT_LEAD_LOCALE` ; si
`resolved === 'fr-CA'` (= défaut, = langue NULL/non renseignée, = appelant sans
locale) on émet **EXACTEMENT l'ancienne chaîne FR en dur** (bytes inchangés).
`tLead` n'est utilisé QUE pour une locale non-fr-CA réellement résolue
(`en`/`es`/`fr-FR`). Garantit byte-identique ET traduction multilingue.

### Fichiers modifiés (écriture)

1. **`src/worker/compliance.ts`** — import
   `{ tLead, normalizeLeadLocale, DEFAULT_LEAD_LOCALE }`.
   `generateCaslFooter(unsubscribeUrl, locale: string = 'fr-CA')` : param locale
   OPTIONNEL. `resolved === 'fr-CA'` → HTML FR original **byte-identique** (les 4
   appelants sans locale — `messages.ts:89`, broadcast mock+Resend, tests — restent
   inchangés) ; non-fr-CA → `system.casl_notice` / `system.unsubscribe` /
   `system.casl_law` via `tLead`.

2. **`src/worker/broadcast.ts`** — 6 projections SELECT enrichies de
   `preferred_language` (envoi immédiat : segment inner builder + outer guarded +
   legacy ; programmé/cron : idem ×3). Types `rawLeads`/`eligibleLeads` élargis
   `preferred_language?: string|null` (évite le drop TS à l'enqueue). 2 appels
   `generateCaslFooter(unsubUrl)` → `generateCaslFooter(unsubUrl,
   lead.preferred_language || undefined)` (`|| undefined` : NULL/'' ⇒ défaut FR).

3. **`src/worker/reviews.ts`** (`handleCreateReviewRequest`) — import idem.
   `lead = SELECT *` ⇒ `lead.preferred_language` dispo (aucun SELECT ajouté).
   Phrase d'accroche de la demande d'avis : `resolved === 'fr-CA'` ⇒ ancienne
   phrase FR exacte ; sinon `tLead(resolved, 'system.review_request')`.
   Best-effort (dans le `try` d'envoi existant ; aucune nouvelle voie d'échec).

### Écart honnête — `documents.ts` NON modifié

Aucun libellé `system.*` ne traduit fidèlement le copy des courriels documents
(« Document à signer », « Document signé avec succès », mandat OACIQ,
« Conservez cet email comme preuve de signature ») = copy légal/instructionnel
spécifique, PAS un libellé système générique. Les clés dispo (`ticket_confirm`
= « demande reçue », `booking_confirm` = « RDV confirmé », `signature` =
« Cordialement, l'équipe ») ont une sémantique DIFFÉRENTE. Forcer une de ces
clés = traduction trompeuse (viole honnêteté) ; injecter une ligne neuve =
casse byte-identique. → Abstention assumée : `documents.ts` reste FR-only v1.
Branchement propre = clés `system.*` dédiées + projection langue, lot ultérieur.

### Garde-fous tenus

- `generateCaslFooter` param locale OPTIONNEL → appelants sans locale + langue
  NULL ⇒ **byte-identique** (chemin fr-CA = ancien HEREDOC exact).
- best-effort : aucune nouvelle branche throw (footer/review dans try existants).
- honnêteté : seuls libellés système traduits (footer CASL + accroche review) ;
  marketing libre intouché ; `documents.ts` abstention documentée.
- bornage tenant : aucune requête nouvelle ; SELECT broadcast conservent gardes
  client_id/DND/unsubscribe. ApiResponse inchangé.
- `i18n-server.ts`/`leads.ts`/`lead-mapping.ts`/worker.ts/api.ts/migration/
  manifest GELÉS (importés, jamais modifiés). `segments.ts` + `src/pages/*`
  (LeadDetail) + capabilities + 6 pages R = ZÉRO touch. Jamais git.

---

## Écarts / dette connue (honnêteté)

- `forms.ts` (submit) et `funnels.ts` (submit public) ont leur PROPRE INSERT
  leads (PAS via `ingestLead`). Ils n'écrivent PAS `preferred_language`
  (stocke NULL = défaut tenant). Hors scope §6.A capture v1 (manuel + opt-in
  ingestion). Branchement éventuel = lot ultérieur, non bloquant (colonne
  nullable → zéro régression).
