# Dette technique — Release Candidate Sprint 30

> Bilan dette priorisée P0-P3 — **source de vérité** post-Sprint 30.
> Pointée depuis `LAUNCH-CHECKLIST.md §12` et `docs/LOT-RC-BETA.md`.
>
> Convention priorité :
> - **P0** : bloquant production saine — à traiter post-RC avant beta wide
> - **P1** : nécessaire pour scale beta → GA (general availability)
> - **P2** : qualité produit / maintenabilité
> - **P3** : nice-to-have / cleanup cosmétique

## Tableau dette (15 items)

| ID | Priorité | Description | Effort | Localisation | Référence |
|---|---|---|---|---|---|
| **P0-01** | P0 | `sendMagicEmail` stub log-only (aucun email envoyé) — invitation beta 100% manuelle via `wrangler tail` | 1-2 j | `src/worker/beta.ts:172-179` | `LAUNCH-CHECKLIST.md §12`, `docs/BETA-GUIDE.md §2.4` |
| **P0-02** | P0 | Migration FCM Legacy HTTP → FCM v1 OAuth (Legacy deprecated juin 2024 — délivrabilité push dégradée) | 2-3 j | `src/worker/push.ts` + binding `FCM_SERVER_KEY` typé Sprint 30 | `src/worker/types.ts` (commentaire) |
| **P0-03** | P0 | Retrait BYPASS auth (12 occurrences `DEV_BYPASS_AUTH`) — code conservé Sprint 30, retrait manuel Rochdi post-RC | 0.5 j | grep `DEV_BYPASS_AUTH` cross-worker | `LAUNCH-CHECKLIST.md §6` |
| **P0-04** | P0 | Revue PCI SAQ-A + légale E4 Stripe SaaS avant flip `payments_live_enabled=1` | externe | `docs/PCI-RGPD-GOLIVE-checklist.md` | source de vérité régulée |
| **P1-05** | P1 | Cron évaluation `alert_rules` Sprint 24 (table créée seq122, pas d'évaluateur scheduled) | 1 j | `src/worker/observability-admin.ts` + cron CF Workers | `migration-observability-seq122.sql` |
| **P1-06** | P1 | Cron purge `web_vitals` + `request_metrics` rétention 90j (croissance non bornée) | 0.5 j | nouveau scheduled handler | seq77/122 sans TTL |
| **P1-07** | P1 | Branche Resend réelle (`sendMagicEmail` + lifecycle emails onboarding/NPS) | 1-2 j | `src/worker/beta.ts`, `src/worker/messages.ts` | dépendance P0-01 |
| **P1-08** | P1 | Activation E6 régulé DZ (returns flow) — flag `e6_returns_dz_enabled` désactivé | externe | `docs/PCI-RGPD-GOLIVE-checklist.md` | révision compliance DZ |
| **P2-09** | P2 | Refactor 166 `console.*` worker → logger structuré (logs noyés) | 2 j | cross-worker | `superpowers:systematic-debugging` future |
| **P2-10** | P2 | i18n résiduel 6 pages CRM (Leads/Dashboard/LeadDetail/Tasks/Pipeline/Clients) — FR hardcodé | 1-2 j | `src/pages/Leads.tsx` etc. | `LAUNCH-CHECKLIST.md §12` (dette R) |
| **P2-11** | P2 | i18n résiduel `ScopePicker.tsx` (~40 strings), `BulkActionBar.tsx`, jours semaine, articles `HelpCenter` | 1-2 j | `src/components/ScopePicker.tsx` etc. | `docs/LOT-C.md §3` |
| **P2-12** | P2 | SEO canonical incohérence — `index.html:30,52` `intralys.com` vs `wrangler.jsonc:38` + `sitemap.xml` `crm.intralys.com` | 0.5 j | 3 sources à aligner | `LAUNCH-CHECKLIST.md §8` |
| **P2-13** | P2 | Tests E2E Playwright Sprint 26 (5 specs LOT 3) — code écrit, jamais exécutés en CI | 0.5 j | `e2e/specs/lot3-*.spec.ts` | Manager Sprint 26 |
| **P3-14** | P3 | App Store / Play Store submission (Sprint 27 doc complète, jamais soumise) | externe | `docs/MOBILE-SUBMISSION.md` (si existe) | post-RC |
| **P3-15** | P3 | Cleanup imports morts / `tsc --noEmit` warnings résiduels (hors-tests exclus) | 0.5 j | cross-frontend | sprint cleanup |

## Récap par priorité

- **P0** (4 items) : 4-6 jours dev + 1 revue externe (PCI/légale E4)
- **P1** (4 items) : 4-6 jours dev + 1 revue externe (compliance DZ E6)
- **P2** (5 items) : 6-9 jours dev
- **P3** (2 items) : 0.5 j dev + externe

**Total dette technique connue** : ~15-22 jours dev + 2 revues externes.

## Notes méthodo

- Sprint 30 100 % additif — n'a **ajouté aucune dette nouvelle**.
- Items existaient avant Sprint 30 (audit Chaman pré-Sprint 30 a recensé 15).
- BYPASS auth (P0-03) conservé volontairement Sprint 30 pour préserver
  workflow dev local — retrait manuel Rochdi post-RC.
- Refactor `console.*` (P2-09) **mini-sprint séparé** recommandé, pas inclus
  dans LOT 3 (risque régression bruyante).
