# Sprint 12 — Production Hardening & Core UX (~8j)

> **Objectif :** Rendre le CRM assez solide pour que les 5 premiers beta clients l'utilisent sans friction.
> Focus sur les features 🔴 BLOCK MIGRATION + 🟠 BLOCK VENTE les plus demandées.
> Ref: `docs/ANTIGRAVITY-GHL-COMPLETENESS.md` §1, §3, §5, §6

---

## Phase A — Contact Entry + Password Reset (1j)

**A.1 — C11 : Formulaire ajout contact manuel (0.5j)** 🔴
- Bouton "+ Nouveau lead" dans la page Leads (modal)
- Champs : nom, email, téléphone, source, status, client_id
- POST `/api/leads` existant → juste l'UI

**A.2 — A7 : Password reset self-serve (0.5j)** 🔴
- Page `/forgot-password` avec champ email
- Endpoint `POST /api/auth/forgot-password` → token 1h → email Resend
- Page `/reset-password/:token` → nouveau mot de passe
- Migration : table `password_reset_tokens (id, user_id, token, expires_at, used)`

---

## Phase B — UX polish critique (2j)

**B.1 — U11 : Toast notifications (0.5j)** 🟡
- Composant `<Toast>` en bottom-right avec auto-dismiss 4s
- Context `useToast()` injectable partout
- Types : success, error, warning, info
- Transition slide-in / fade-out

**B.2 — U4 : Filtres persistants (0.5j)** 🟠
- `localStorage` pour sauvegarder les filtres actifs sur les pages Leads, Tasks, Pipeline
- Restauration au retour sur la page
- Bouton "Réinitialiser filtres"

**B.3 — C2 : Saved replies / Snippets (0.5j)** 🟠
- Table `saved_replies (id, user_id, title, body, shortcut, category)`
- CRUD API + UI dans Settings
- Accès via `/` dans ConversationPanel → dropdown avec recherche

**B.4 — U14 : Undo après suppression (0.5j)** 🟠
- Toast spécial avec bouton "Annuler" pendant 10s
- Utilise le soft-delete existant (trash)
- Sur delete lead, task, note → toast undo qui restore

---

## Phase C — Infra production (1.5j)

**C.1 — I7 : Health check endpoint (0.2j)** 🟡
- `GET /api/health` → check DB connectivity + return version + uptime
- JSON : `{ status: "ok", db: "ok", version: "2.1.0", uptime_s: 123456 }`

**C.2 — I9 : Migration tracker (0.5j)** 🟠
- Table `_migrations (filename, hash, applied_at)`
- Script `migrate.ts` qui applique les fichiers `migration-phase*.sql` non encore joués
- Protection contre re-application

**C.3 — I1 : Backup D1 → instructions documentées (0.3j)** 🔴
- Script `scripts/backup.sh` : `wrangler d1 export` → fichier SQL
- Documentation dans `docs/BACKUP-RESTORE.md`

**C.4 — S12 : Security headers (0.5j)** 🟡
- `public/_headers` : CSP strict, HSTS, X-Frame-Options, X-Content-Type
- Audit et correction des headers existants

---

## Phase D — Compliance & sécurité (1j)

**D.1 — S3 : Session management UI (0.5j)** 🟠
- Dans Settings > Sécurité : liste des sessions actives
- Colonnes : device/browser, IP, dernière activité, date création
- Bouton "Fermer cette session" par session
- Bouton "Fermer toutes les sessions sauf la mienne"

**D.2 — S2 : 2FA backup codes (0.5j)** 🟠
- Générer 10 codes à l'activation du 2FA
- Afficher une seule fois + bouton "Télécharger en PDF"
- Chaque code utilisable 1 seule fois
- Table `backup_codes (id, user_id, code_hash, used_at)`

---

## Phase E — Notifications & UX avancée (1.5j)

**E.1 — N2 : Préférences notifications per-user (0.5j)** 🟠
- Table `notification_preferences (user_id, channel, event_type, enabled)`
- UI dans Settings > Notifications (déjà créé Sprint 11)
- Toggles par type : nouveau lead, message, tâche retard, workflow

**E.2 — C3 : Signatures email par user (0.5j)** 🟠
- Champ `email_signature` (HTML) dans la table `users`
- Éditeur simple dans Settings > Profil
- Auto-injecté dans les emails sortants

**E.3 — Date pickers FR avec presets U15 (0.5j)** 🟡
- Composant `<DateRangePicker>` avec presets FR
- "Aujourd'hui", "Hier", "Cette semaine", "Ce mois", "30 derniers jours", "Custom"
- Utilisé dans Reports, Leads filter, Calendar filter

---

## Phase F — Tests & validation (1j)

**F.1 — Tests unitaires nouvelles features**
- Toast context
- Password reset flow
- Health check endpoint
- Saved replies CRUD

**F.2 — Build & deploy check**
- `bun run build` → 0 erreurs
- `npx vitest run` → 115+ tests
- Audit final toutes les features

---

## Résumé effort

| Phase | Effort | Items |
|---|---|---|
| A — Contact Entry + Password Reset | 1j | C11, A7 |
| B — UX polish critique | 2j | U11, U4, C2, U14 |
| C — Infra production | 1.5j | I7, I9, I1, S12 |
| D — Compliance & sécurité | 1j | S3, S2 |
| E — Notifications & UX avancée | 1.5j | N2, C3, U15 |
| F — Tests & validation | 1j | Tests + build |
| **Total** | **~8j** | **14 items** |

---

## Critères de succès Sprint 12

- [ ] Un beta client peut ajouter un lead manuellement
- [ ] Un beta client peut reset son mot de passe seul
- [ ] Toast feedback sur toutes les actions CRUD
- [ ] Filtres persistés entre sessions
- [ ] Health check endpoint fonctionnel
- [ ] Sessions listées et fermables
- [ ] Backup D1 documenté
- [ ] Build vert + 115+ tests

---

_Plan créé le 2026-05-12. Sera archivé dans docs/archive/ à la fin du sprint._
