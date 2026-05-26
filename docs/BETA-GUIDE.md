# Guide Beta Intralys — premiers testeurs

> Guide d'accueil pour les **5 premiers beta testeurs** Intralys CRM.
> Distribution privée — pas de communication publique avant feu vert Rochdi.
> Codes seed Sprint 30 (`migration-release-gates-seq125.sql`).

## §1 — Public visé

Cette beta s'adresse à un cercle restreint **5 utilisateurs** :
- Cabinets de courtage hypothécaire / immobilier Québec
- Conseillers AMF (planificateurs / sécurité financière)
- Agences PME en croissance utilisant déjà un CRM
- Profils sélectionnés par Rochdi pour leur feedback structuré

**Engagement attendu** : 1 session white-glove + 2 sessions feedback
sur 4 semaines. Pas un produit grand public — feedback qualitatif > quantitatif.

## §2 — Workflow invitation (7 étapes)

### Étape 1 — Réception du code
Rochdi envoie au testeur un email manuel contenant :
- Lien d'invitation : `https://<prod>/?code=BETA-INTRALYS-2026-XXXX`
- Le code unique attribué (un parmi les 5 ci-dessous)

### Étape 2 — Codes attribués (seq125 seed)

| # | Code | Statut |
|---|---|---|
| 1 | `BETA-INTRALYS-2026-X7K9` | Disponible |
| 2 | `BETA-INTRALYS-2026-M4P2` | Disponible |
| 3 | `BETA-INTRALYS-2026-L8V5` | Disponible |
| 4 | `BETA-INTRALYS-2026-R3N1` | Disponible |
| 5 | `BETA-INTRALYS-2026-Q9J4` | Disponible |

`max_uses=1` par défaut (un seul signup par code). Audit via
`SELECT * FROM beta_invite_codes;` sur D1.

### Étape 3 — Signup
Le testeur ouvre le lien `?code=XXX` → form signup pré-rempli avec code.
Validation côté worker `beta.ts:handleBetaSignup` (Sprint 30 patch Manager-B
câble `beta_invite_codes` table).

### Étape 4 — Magic link
Après signup, un email magic link est envoyé.
**⚠️ DETTE P0-01** : actuellement `sendMagicEmail` est un stub log-only
(`src/worker/beta.ts:172-179`) — Rochdi voit le lien dans
`wrangler tail` et le **transmet manuellement** au testeur.
Migration Resend/SendGrid backlog post-RC.

### Étape 5 — Premier login
Lien magic → session 24h créée. Onboarding `WelcomeWizard` lancé (Sprint 21
durci — checklist serveur, reprise multi-appareil via `/api/onboarding/state`).

### Étape 6 — Session white-glove 30 min
Rochdi accompagne le testeur sur :
- Création du premier lead
- Configuration pipeline + 1 workflow
- Pré-remplissage clients/agences
- Test mobile (PWA install — Sprint 27)

### Étape 7 — Feedback continu
Le testeur a accès :
- **Feedback widget** in-app (bouton flottant — voir §3)
- **NPS** déclenché à J+7 et J+30
- **Roadmap publique** (Sprint 50 — `/roadmap` route)

## §3 — Feedback widget

Bouton flottant en bas-droite (`BetaFeedbackButton.tsx` Sprint 50).
- Types : `bug`, `feature`, `general`
- Champs : message libre + URL automatique
- Endpoint : `POST /api/beta/feedback` (auth requise)
- Audit : table `beta_feedback` (seq55)

Le testeur peut aussi écrire à `feedback@intralys.com` (forward Rochdi).

## §4 — Roadmap publique

`/roadmap` page (route publique sans auth) :
- Items roadmap visibles avec statut (`planned` / `in_progress` / `shipped`)
- Vote possible si connecté (`POST /api/roadmap/vote`)
- Source : `roadmap_items` + `roadmap_votes` (seq55)

## §5 — Support contact

| Canal | Usage | Délai |
|---|---|---|
| Email `support@intralys.com` | Question fonctionnelle | < 24h ouvré |
| Feedback widget | Bug / suggestion | Reviewed weekly |
| WhatsApp Rochdi | Urgence beta | Best effort |
| Roadmap vote | Influence priorisation | Continu |

## §6 — NDA / légal

- **Confidentialité** : ne pas partager screenshots, codes d'invitation,
  ni détails fonctionnels avant communication publique officielle.
- **Données** : Loi 25 Québec respectée (Sprint 23 — `/api/account/me/export`
  + `/api/account/me/delete` disponibles dès l'inscription).
- **Cookies** : bannière consent obligatoire (Sprint 23).
- **Paiements** : tier `free` uniquement durant la beta. `payments_live_enabled=0`
  tant que revue PCI/légale non signée (`docs/PCI-RGPD-GOLIVE-checklist.md`).

## §7 — Limites bêta connues

- **Email magic link manuel** (cf. §2 Étape 4 — P0-01).
- **Push notifications iOS** : FCM Legacy deprecated juin 2024 ; migration
  v1 OAuth backlog P0-02 — délivrabilité dégradée possible.
- **Stripe SaaS** : flag mock — pas de prélèvement réel (P0-04).
- **6 pages CRM dé-i18n** (Leads/Dashboard/LeadDetail/Tasks/Pipeline/Clients) :
  FR hardcodé, OK pour cible fr-CA, EN/ES affichent FR sur ces pages.
- **Lent sur très gros tenants** (>10k leads) : indexes seq77+123 posés
  mais pas testés à charge.

Merci de tester avec bienveillance — la beta est par définition incomplète.
Feedback brut > feedback poli. Bugs > nice-to-have.
