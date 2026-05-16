# i18n — Variantes linguistiques (Sprint 48 M2)

Documentation des choix de traduction par locale.

## Locales supportées

| Code | Nom natif | Source files | Voice |
|------|-----------|--------------|-------|
| `fr-CA` | Français (Québec) | `src/lib/i18n/fr-CA.ts` | Tutoiement informel, terminologie QC |
| `fr-FR` | Français (France) | `src/lib/i18n/fr-FR.ts` | Vouvoiement formel, terminologie FR pro |
| `en` | English | `src/lib/i18n/en.ts` | US/CA neutre, casual professional |
| `es` | Español | `src/lib/i18n/es.ts` | Latam neutre (compatible MX/AR/CO/ES), vouvoiement |

---

## FR-CA vs FR-FR — variantes clés

| FR-CA (Québec, source) | FR-FR (France) | Notes |
|------------------------|----------------|-------|
| **Tu** (informel) | **Vous** (vouvoiement formel) | Style produit |
| "Courriel" | "Email" | "Courriel" reste accepté FR-FR mais "email" plus courant |
| "Fin de semaine" | "Week-end" | Direct |
| "Magasiner" | "Faire ses courses" | Conservé "Acheter" parfois plus naturel |
| "Boutique" / "Magasin" | "Boutique" / "Magasin" | Identique |
| "Char" (informel) | "Voiture" | Évité dans copy formelle |
| "Patente" (informel) | "Truc" / "Outil" | Évité dans copy formelle |
| "Téléverser" | "Téléverser" / "Télécharger" | Conservé "téléverser" partout (upload) |
| "Société" / "Compagnie" | "Société" | FR-FR préfère "Société" SAS |
| "Provinces" | "Régions" | Champ adresse |
| "Tableau de bord" | "Tableau de bord" | Identique |
| "Étiqueter" | "Étiqueter" | Identique |
| "Bon matin" | "Bonjour" | FR-FR n'utilise pas "Bon matin" |
| "Bon après-midi" | "Bon après-midi" | Identique |
| "Bonsoir" | "Bonsoir" | Identique |
| "Insights" | "Analytiques" | FR-FR préfère analytique vs anglicisme |

### Termes Quebec compliance — préservés à l'identique partout

- **Loi 25** — Loi modernisant des dispositions législatives en matière de protection des renseignements personnels (Québec)
- **LCAP (CASL)** — Loi canadienne anti-pourriel
- **TPS** — Taxe sur les produits et services (Canada)
- **TVQ** — Taxe de vente du Québec
- **GST/HST** — Pour les ventes hors-Québec

Ces termes sont **conservés tels quels** dans tous les catalogues (FR-FR, EN, ES) avec une mention "(Québec)" en clarification quand pertinent. Aucune adaptation locale n'est appropriée pour la compliance fiscale/légale.

---

## ES — Choix de vocabulaire neutre Latam

Cible : MX/AR/CO/CL/PE/ES (Latam dominante mais ES Spain-compatible).

| FR-CA | ES (choix retenu) | Alternatives évitées | Raison |
|-------|-------------------|----------------------|--------|
| "Lead" | "Prospecto" | "Cliente potencial" (long), "Lead" (anglicisme) | Latam standard CRM |
| "Pipeline" | "Embudo de ventas" | "Tubería" (calque), "Pipeline" (acceptable) | "Embudo" = funnel, métaphore commerciale Latam |
| "Tâche" | "Tarea" | — | Universel |
| "Calendrier" | "Calendario" | "Agenda" (acceptable mais autre sens) | Universel |
| "Tableau de bord" | "Panel" | "Tablero" (Latam ok), "Salpicadero" (Spain only) | Plus court, neutre |
| "Boîte de réception" | "Bandeja de entrada" | "Buzón" (Spain) | Latam standard |
| "Étiquette" | "Etiqueta" | "Marbete" (formal) | Universel |
| "Courriel" | "Correo" | "Email" (acceptable, courant) | "Correo" plus formel mais "email" populaire |
| "Mot de passe" | "Contraseña" | "Clave" (Latam casual), "Password" (anglicisme) | Formel correct partout |
| "Téléverser" | "Subir" | "Cargar" (acceptable) | "Subir" plus court et universel |
| "Conformité Loi 25" | "Cumplimiento de la Ley 25 de Quebec" | — | Mention explicite Quebec |
| "Tutoiement / vouvoiement" | "Usted" (formal) | "Tú" (Latam casual) | Choix B2B pro safe |
| "Fin de semaine" | "Fin de semana" | "Finde" (informal Latam) | Universel |

### Pluriel ES
Pluriels supportés via `lib/i18n/plural.ts` (déjà M3). Format `Intl.PluralRules` natif → 'one' / 'other' supporté par ES.

---

## Auto-detection navigator → locale supportée

```ts
// Implémenté dans src/lib/i18n.ts : detectNavigatorLocale()
navigator.languages[0]
  ↓
exact match (fr-CA, fr-FR, en, es) ? → use it
  ↓
prefix match (fr* → fr-FR, en* → en, es* → es) ? → use it
  ↓
fallback → fr-CA (default app)
```

Note : `fr-CA` ne se déclenche qu'en exact match (navigateur explicitement configuré FR Canada). Tout autre `fr-*` → `fr-FR`.

---

## RTL — préparation (stub)

`src/lib/i18n/rtl.ts` détecte direction RTL pour locales futures (ar/he/fa/ur).

Comportement actuel :
- `applyRtlDirection(locale)` sync `<html dir="ltr|rtl">` + `<html lang="...">`
- Aucune locale RTL n'est encore au catalogue → toujours `ltr`
- API prête, à activer en ajoutant `src/lib/i18n/ar.ts` etc.

Le CSS du projet n'utilise pas encore `logical properties` (margin-inline-start vs margin-left). À auditer Sprint 51+ si RTL devient prio.

---

## Coverage — quels strings sont traduits ?

Voir `docs/i18n-coverage-sprint48.md`.

Résumé : ~250 clés couvrent **catalogue cœur** (nav, actions, états, forms, dashboard, leads/pipeline/tasks/inbox/calendar/reports/settings/onboarding/marketing/legal/toasts/empty states).

Les strings **hardcoded dans .tsx** (composants individuels, copy spécifique) restent en FR-CA littéral — coverage progressive prévue Sprint 49+.
