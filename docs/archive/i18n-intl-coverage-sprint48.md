# Sprint 48 M3 — Couverture Intl (plural / datetime / number / timezone)

**Date** : 2026-05-15 (clôturé 2026-05-16 après reset limite)
**Statut** : utilities 4/4 livrées + 26 fichiers migrés. Doc finalisée post-reset.

## Utilities créées (`src/lib/i18n/`)

| Fichier | API | Fallback |
|---|---|---|
| `plural.ts` | `plural(locale, count, forms)`, `pluralSimple` | `forms.other` avec `#` remplacé |
| `datetime.ts` | `formatDate`, `formatDateTime`, `formatTime`, `formatRelativeTime`, `formatDateShort` | `toLocaleString(locale)` |
| `number.ts` | `formatCurrency`, `formatPercent`, `formatPercentFromInt`, `formatNumber`, `formatCompact`, `formatMoneyCAD` | string brute |
| `timezone.ts` | `formatDateInTimezone`, `getDetectedTimezone`, `getStoredTimezone`, `setStoredTimezone`, `listTimezones`, `listTimezonesByRegion` | TZ navigateur → UTC |
| `index.ts` | barrel re-export consolidé | — |

Tous zero-dep (Intl natif), opt-in, back-compat 100%.

## Fichiers migrés (26)

Pages : Inbox, Calendar, Tasks, Invoices, Dashboard, Reports, Pipeline, Leads, LeadDetail, Properties, Clients, VisitMode.
Composants : ActivityFeedPanel, LeadTimeline, NotificationsPanel, MessageThread, MessageBubble (ui + Inbox legacy), ConversationPanel, LeadHoverPreview, AutosaveIndicator, AnimatedNumber, ForecastView, ProfileSettings, AuditLogSettings.

## Timezone (M3.4)

`ProfileSettings.tsx` : Select fuseau wiré à `listTimezones()` + `getStoredTimezone()`/`setStoredTimezone()` (localStorage `intralys_timezone`), helper "Détecté : {tz}". Backend Workers stocke UTC (Unix ts) — display = TZ user. Fallback `Intl.DateTimeFormat().resolvedOptions().timeZone`.

## Préservations critiques confirmées

- **TPS/TVQ Invoices** : math `inv.amount / 1.14975` (TPS 5% + TVQ 9.975%) **inchangée verbatim**. `formatCurrency` wrap UNIQUEMENT le display (Invoices.tsx:344-360, commentaire de garde présent).
- Sprint 35 `i18n.ts` (`t`, `getLocale`, `setLocale`) : back-compat 100%.
- Sprint 48 M2 catalogues fr-CA/fr-FR/en/es : consommés via `getLocale()`.
- Mapbox / Loi 25 / CASL / reactions / quickReplies / AI drafts : 0 impact (timestamps display only).

## Reste à migrer (Sprint 49+ progressif)

Strings count-dependent hardcodés résiduels hors pages critiques (Settings secondaires, Admin analytics labels) — non bloquant beta, catalogue Intl prêt, migration mécanique.

## Atomic M3 : 4/4

M3.1 plural · M3.2 datetime · M3.3 number (TPS/TVQ display-only) · M3.4 timezone + Settings selector.
