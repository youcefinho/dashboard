# LOT SEQUENCE ANALYTICS — stats d'engagement séquence (Email/Sequence completion)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (VM VMware sans bun/node) — Antigravity
> buildera/testera côté hôte. Modèle : `docs/LOT-BOOKING-REMINDERS.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**, **AUCUNE migration**, qui ferme 1 seul gap
des séquences email (seq 86, `docs/LOT-EMAIL5.md`) :

1. **Surfacer les stats d'engagement au niveau séquence**
   (envoyés / ouverts / cliqués + taux) — déjà TRACKÉES en base
   (`messages.campaign_id` / `campaign_kind = 'sequence'` + `message_events`)
   mais jamais AGRÉGÉES ni AFFICHÉES. On calque le pattern d'agrégation des
   broadcasts (`broadcast.ts:632-644`) appliqué aux séquences.

Architecture figée (NE PAS réinventer) :
- Séquence = `workflows{is_sequence:1}` + `workflow_steps` (seq 86) —
  moteur d'exécution `workflows.ts` INTACT, AUCUN code moteur neuf.
- Tables `messages` (`campaign_id`, `campaign_kind`, index `idx_messages_campaign`)
  + `message_events` (`event_type`) EXISTENT — **AUCUNE migration, ZÉRO DDL**.
  Ne consomme PAS seq 104. **Manifest NON touché.**
- Lecture PURE : une seule requête d'agrégation SQL, AUCUNE écriture, AUCUN cron.
- Capability = **AUCUNE garde ajoutée** : `handleGetSequenceStats` calque
  EXACTEMENT le niveau de garde de `handleGetSequences` / `handleGetSequenceDetail`
  (sequences.ts) qui n'ont **PAS de capGuard** (lecture ; mutation gardée
  ailleurs). **ZÉRO ajout à `ALL_CAPABILITIES`.**
- CASL / Loi 25 : lecture d'agrégats déjà trackés ⇒ aucune régression conformité.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + choix ratio vs %

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
Phase A ne les a PAS modifiés ; Phase B/C ne les touchent PAS.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error`.

Type ADDITIF posé Phase A dans `src/lib/types.ts` — **FIGÉ** :

```
export interface SequenceStats {
  sent: number;
  opened: number;
  clicked: number;
  open_rate: number;   // ratio 0..1 (opened / sent), 0 si sent = 0
  click_rate: number;  // ratio 0..1 (clicked / sent), 0 si sent = 0
}
```

> **CHOIX FIGÉ : `open_rate` / `click_rate` = RATIOS 0..1** (PAS des pourcentages).
> Le backend (Manager-B) renvoie une fraction `opened / sent` (0..1) ; le front
> (Manager-C) la formatte en pourcentage à l'affichage (`Math.round(rate * 100)`
> + `'%'`, ou `Intl.NumberFormat(..., {style:'percent'})`). Division gardée
> contre `/0` → `0` quand `sent === 0`.

Helper ADDITIF posé Phase A dans `src/lib/api.ts` — **FIGÉ**, Phase C le
CONSOMME tel quel (calque la forme exacte de `getSequence` voisin) :

```
getSequenceStats(id: string): Promise<ApiResponse<SequenceStats>>   GET /sequences/:id/stats
```

### §6.B — AUCUNE DDL / AUCUNE migration / manifest NON touché

Sprint en LECTURE PURE. Les colonnes (`messages.campaign_id`,
`messages.campaign_kind`) et l'index (`idx_messages_campaign`) ainsi que
`message_events.event_type` EXISTENT DÉJÀ (seq 86 + tracking). **Aucun fichier
`migration-*.sql` créé, aucune entrée `docs/migrations-manifest.json` ajoutée,
seq 104 NON consommée.** Tout ALTER / DROP / RENAME / rebuild / CHECK est
INTERDIT.

### §6.C — Route `GET /api/sequences/:id/stats` (`worker.ts`, FIGÉ Phase A)

Câblée dans le bloc routes sequences, **AVANT** le match générique
`/api/sequences/:id` (sinon `"stats"` serait avalé comme un id — calque l'ordre
`/:id/variants` avant `/:id` des broadcasts, et `/:id/enroll` avant `/:id` des
séquences) :

```
const seqStats = path.match(/^\/api\/sequences\/([^/]+)\/stats$/);
if (seqStats && method === 'GET') return handleGetSequenceStats(env, auth, seqStats[1]!);
const seqMatch = path.match(/^\/api\/sequences\/([^/]+)$/);   // APRÈS
```

Phase B/C NE TOUCHENT PAS `worker.ts` — uniquement le CORPS de
`handleGetSequenceStats` (B) et la page (C).

### §6.D — Contrat `src/worker/sequences.ts` (signature FIGÉE)

Signature FIGÉE Phase A (worker.ts la câble). Calque EXACTEMENT
`handleGetSequenceDetail` : `(env, auth, id)`, `auth: SeqAuth`, D1 via `env.DB`,
PAS de capGuard (lecture). Phase B écrit UNIQUEMENT le corps balisé
`// Manager-B: agrégation réelle`, SANS changer la signature ni la forme de
retour (`{ data: SequenceStats }` / `{ error }`).

```
export async function handleGetSequenceStats(
  env: Env,
  _auth: SeqAuth,
  sequenceId: string,
): Promise<Response>
```

**STUB Phase A** : retourne
`json({ data: { sent:0, opened:0, clicked:0, open_rate:0, click_rate:0 } })`.

### §6.E — i18n (POSÉ Phase A — parité STRICTE 4 catalogues)

5 clés posées Phase A dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (parité STRICTE,
mêmes clés partout, valeurs traduites, posées juste après `seq.delete_confirm`).
Phase C les CONSOMME, n'en crée AUCUNE :

```
seq.stat_sent
seq.stat_opened
seq.stat_clicked
seq.stat_open_rate
seq.stat_click_rate
```

### §6.F — Event types RÉELS de `message_events` (CRITIQUE pour Manager-B)

Valeurs EXACTES insérées par `tracking.ts` dans `message_events.event_type` —
**à utiliser TELLES QUELLES dans l'agrégation** (PAS `email_opened` /
`link_clicked`, qui sont des triggers workflow, PAS des event types) :

- ouverture → **`'open'`**  (`tracking.ts:102`, `handleTrackOpen`)
- clic      → **`'click'`** (`tracking.ts:147`, `handleTrackClick`)

### §6.G — (réservé)

### §6.H — Répartition DISJOINTE Phase B/C (zéro fichier partagé)

**Manager-B (backend) — owned EXCLUSIF** :
- `src/worker/sequences.ts` — **corps réel** de `handleGetSequenceStats`
  UNIQUEMENT (les 6 autres handlers du fichier restent INTACTS) :
  - Borne sur la séquence : vérifier `workflows.is_sequence = 1` pour `:id`
    (calque le `WHERE id = ? AND is_sequence = 1` de `handleGetSequenceDetail`) ;
    `404 { error }` si introuvable.
  - Agrégation LECTURE PURE calquée sur `broadcast.ts:632-644`, mais jointe sur
    `m.campaign_id = :sequenceId AND m.campaign_kind = 'sequence'` (index
    `idx_messages_campaign`) :
    - `sent` = `COUNT(*)` (ou `COUNT(DISTINCT m.id)`) des `messages` de la
      séquence.
    - `opened` = `COUNT(DISTINCT m.id)` joint `message_events`
      `me.event_type = 'open'` (§6.F).
    - `clicked` = `COUNT(DISTINCT m.id)` joint `message_events`
      `me.event_type = 'click'` (§6.F).
  - Garde `client_id` OPTIONNELLE SEULEMENT si les autres handlers la
    respectent (calque `scopeClientId` ; legacy / mono-tenant ⇒ pas de filtre).
  - `open_rate = sent ? opened / sent : 0` ; `click_rate = sent ? clicked / sent : 0`
    (**division gardée contre `/0`**, ratios 0..1 — §6.A).
  - Retour `json({ data: SequenceStats })` ; erreur SQL → `json({ error }, 500)`.
    best-effort : colonne/table absente ⇒ réponse propre, JAMAIS de throw nu.

**Manager-C (front) — owned EXCLUSIF** :
- `src/pages/Sequences.tsx` — à l'ouverture du détail d'une séquence, appeler
  `getSequenceStats(id)` (helper FIGÉ §6.A) et afficher des cartes stats
  (envoyés / ouverts / cliqués + taux d'ouverture / clic), libellés via les clés
  i18n posées par A (§6.E). Taux = ratio 0..1 → formatter en % à l'affichage.
  Style sobre RÉUTILISANT les primitives / classes EXISTANTES de la page (zéro
  `index.css`). Rétro-compat : séquence sans engagement = tout à 0 (le stub /
  l'agrégat renvoient 0, jamais d'erreur bloquante).

**INTERDITS aux DEUX Managers** (FIGÉS Phase A ou hors scope, lecture seule) :
- `src/lib/api.ts`, `src/lib/types.ts`, `src/worker.ts`,
  `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, `src/index.css`,
  **`docs/LOT-SEQUENCE-ANALYTICS.md`**.
- `src/worker/workflows.ts`, `src/worker/broadcast.ts`,
  `src/worker/tracking.ts`, `src/worker/compliance.ts`,
  `src/pages/Campaigns.tsx`, `src/components/EmailBuilder.tsx`.
- `src/worker/capabilities.ts` (`ALL_CAPABILITIES` FIGÉ — aucune capability).
- AUCUNE migration / AUCUNE touche `docs/migrations-manifest.json`.

**Disjonction** : Manager-B ⊂ {corps `handleGetSequenceStats` de `sequences.ts`}
∥ Manager-C ⊂ {`Sequences.tsx`}. **Aucun fichier partagé entre B et C** ⇒
parallélisation sûre, zéro race.

### §6.I — Pièges / garde-fous

- **AUCUNE DDL / AUCUNE migration / manifest INTOUCHÉ** — colonnes + index
  existent (seq 86 + tracking). Ne PAS consommer seq 104. CHECK / contraintes
  intouchables.
- **Ordre des routes** — `/api/sequences/:id/stats` câblée AVANT
  `/api/sequences/:id` (sinon `"stats"` avalé comme un id).
- **Event types RÉELS** — `'open'` / `'click'` (§6.F, `tracking.ts:102/147`),
  PAS `email_opened` / `link_clicked` (ce sont des triggers workflow).
- **Division `/0`** — `open_rate` / `click_rate` = 0 quand `sent === 0`.
- **Ratios 0..1** — backend renvoie une fraction, front formatte en % (§6.A).
- **Imports worker RELATIFS** (`./types`, `./helpers`, `./workflows`) — PAS
  d'alias `@/` (tsconfig.worker.json).
- **Parité i18n STRICTE** sur les 4 catalogues — clés AVANT tout usage.
- **AUCUNE capability ajoutée** — calque l'absence de capGuard de
  `handleGetSequences` / `handleGetSequenceDetail` (lecture).
- **Conformité CASL / Loi 25** non régressée (lecture d'agrégats déjà trackés).
- Pas de build/test côté VM (VMware sans bun/node) — Antigravity build/test
  côté hôte. NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `docs/LOT-SEQUENCE-ANALYTICS.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `src/lib/types.ts` — interface ADDITIVE `SequenceStats` (ratios 0..1).
- `src/lib/api.ts` — import `SequenceStats` + helper FIGÉ `getSequenceStats`.
- `src/worker.ts` — import `handleGetSequenceStats` + route
  `GET /api/sequences/:id/stats` AVANT `/:id` générique.
- `src/worker/sequences.ts` — STUB `handleGetSequenceStats` (signature FIGÉE,
  retour zéros, balise `// Manager-B: agrégation réelle`).
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 5 clés `seq.stat_*`, parité STRICTE
  4 catalogues.

Non touché : `workflows.ts`, `broadcast.ts`, `tracking.ts`, `compliance.ts`,
`Campaigns.tsx`, `EmailBuilder.tsx`, `capabilities.ts` (ALL_CAPABILITIES),
`index.css`, `docs/migrations-manifest.json` (AUCUNE migration). Corps réel
`handleGetSequenceStats` = Phase B ; `Sequences.tsx` = Phase C.
Non exécuté (VM) — Antigravity build/test côté hôte.
