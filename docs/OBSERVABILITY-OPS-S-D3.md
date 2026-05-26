# Observabilité OPS — Endpoint Web Vitals admin (Sprint S-D §6.3)

> État au **Sprint S-D (LOT D, Manager B)**. Source de vérité :
> `src/worker/observability-ops.ts`. Complète `docs/OBSERVABILITY.md` (S4)
> SANS le contredire : le `logger` structuré reste **cantonné à
> `error-response.ts`** (design S4 délibéré) — ce module n'émet aucun log et
> ne propose pas d'éparpiller `logger`.
>
> **Principe transversal (hérité S4)** : strictement additif, **best-effort**,
> lecture seule. L'observabilité ne change aucune logique métier et **ne peut
> JAMAIS faire échouer une requête** (jamais 500/503).

---

## 1. Surface ops exposée

| Endpoint | Méthode | Garde | Effet |
|---|---|---|---|
| `/api/admin/web-vitals` | `GET` | `admin` \| `owner` | Agrégat télémétrie Web Vitals (lecture seule) |

- **Garde admin** : double — (a) dispatch `worker.ts` (Manager A, en amont),
  (b) `requireAdmin()` LOCAL dans `observability-ops.ts` (défense en
  profondeur). Réplique LOCALE du patron `admin-analytics.ts:16-23` — **pas
  d'import cross-module** (cohérence avec la décision §6.3). Refus →
  `{ error: 'Accès réservé aux administrateurs.' }` HTTP 403 (format §6.2 :
  `error` = string brute lue par le front).
- **Aucune mutation** : aucun `INSERT/UPDATE/DELETE`. Pure agrégation SELECT.

## 2. Source de données

Table `web_vitals` créée par S9 (`migration-sprintS9-m1.sql:65-77`) :

```
web_vitals(
  id TEXT PK, metric_name TEXT NOT NULL, value REAL NOT NULL,
  rating TEXT, url TEXT, session_id TEXT,
  client_id TEXT REFERENCES clients(id),   -- NULLABLE, pas de scoping imposé
  created_at TEXT DEFAULT (datetime('now'))
)
```

Index présents (S9, aucune migration LOT D) :
`idx_web_vitals_created_at` (filtre fenêtre) + `idx_web_vitals_metric`
(GROUP BY / filtre p75). Les deux colonnes utilisées par l'endpoint sont
**déjà indexées** → décision Phase A confirmée : **0 migration LOT D**.

### Multi-tenant — décision

`web_vitals` est une **table télémétrie GLOBALE ops**. La colonne
`client_id` est *nullable* (pas de `NOT NULL`, pas de contrainte de scoping)
et l'endpoint est **admin-only**. Cohérent avec `admin-analytics.ts` (vue
ops agrégée globale). → **Aucun filtre `client_id`** appliqué : c'est une
vue ops transverse délibérée, pas une vue tenant. Une éventuelle ventilation
par client serait un ajout futur explicite, hors scope §6.3.

## 3. Paramètre & fenêtrage

| `?period=` | Modificateur SQLite `created_at` |
|---|---|
| `24h` | `datetime('now','-24 hours')` |
| `7d` *(défaut)* | `datetime('now','-7 days')` |
| `30d` | `datetime('now','-30 days')` |

Valeur absente ou invalide → **`7d`** (jamais d'erreur paramètre).
`since` = `SELECT datetime('now', <offset>)` (cohérent avec le filtre SQL).
Si la lecture de `since` échoue → fallback ISO calculé en JS (best-effort) ;
l'agrégat reste servi.

## 4. Requêtes d'agrégation

**Count / avg par métrique** (1 requête, indexée sur `created_at`) :

```sql
SELECT metric_name, COUNT(*) AS count, AVG(value) AS avg
  FROM web_vitals
 WHERE created_at >= datetime('now', ?)   -- offset période
 GROUP BY metric_name
 ORDER BY metric_name;
```

**p75 — méthode : nearest-rank approx** (1 requête par métrique) :

```sql
SELECT value
  FROM web_vitals
 WHERE metric_name = ?
   AND created_at >= datetime('now', ?)
 ORDER BY value ASC
 LIMIT 1 OFFSET ?;          -- OFFSET = floor(count * 3 / 4), 0-based
```

- **Pourquoi nearest-rank** : SQLite/D1 n'a pas de fonction `PERCENTILE`
  native. Le rang `floor(count·3/4)` (0-based) sur les valeurs triées ASC
  donne le 75ᵉ percentile approximatif. Précision suffisante pour une vue
  ops (pas de SLA contractuel sur la valeur exacte).
- `count == 0` → `p75 = 0` (aucune donnée, pas de requête).
- `count == 1` → `OFFSET 0` = l'unique valeur.
- Coût : 1 requête agrégat + N requêtes p75 (N = nb métriques distinctes,
  typiquement ≤ 6 : LCP/CLS/INP/FCP/TTFB/…). Volumétrie `web_vitals` faible
  (télémétrie ops échantillonnée) → acceptable. `value` non indexée mais le
  prédicat `metric_name` + fenêtre `created_at` réduit fortement le scan.
- Erreur p75 d'une métrique → `0` pour cette métrique uniquement (la réponse
  globale n'est jamais cassée).
- `avg` et `p75` arrondis à 2 décimales (lisibilité ops).

## 5. Contrat de réponse (§6.3 — figé)

Succès (HTTP **200**) :

```json
{
  "data": {
    "metrics": [
      { "metric_name": "LCP", "count": 42, "avg": 2480.5, "p75": 3100.0 }
    ],
    "period": "7d",
    "since": "2026-05-10 00:00:00"
  }
}
```

**Best-effort strict** : table absente, SQL KO, DB throw → HTTP **200** avec
`{ data: { metrics: [], period, since } }`. **JAMAIS 500, JAMAIS 503**
(try/catch englobant). C'est une vue ops : son indisponibilité ne doit
jamais dégrader l'API ni alerter en erreur applicative.

## 6. `/api/health` — décision Manager B

**health.ts NON modifié.** Le contrat §6.4 recommande par défaut de ne rien
ajouter sans valeur ops claire et bon marché. Un compteur
`web_vitals_24h` aurait coûté une requête supplémentaire sur le chemin
nominal de `/api/health` (sondé fréquemment par les uptime checks) pour une
valeur ops marginale — déjà couverte de façon plus riche par
`/api/admin/web-vitals`. Décision : **anti-sur-scope, health.ts inchangé**
(shape S10 `{status, db, version:'2.1.0', uptime_s, migrations_count}`
intégralement préservé, non touché).

## 7. Alerting recommandé (opérationnel — hors code, indicatif)

Consommer `/api/admin/web-vitals?period=24h` depuis l'outillage ops
(dashboard interne ou cron de surveillance). Seuils Core Web Vitals usuels
sur le `p75` (Google « good ») :

| Métrique | p75 « good » | Seuil alerte recommandé (p75 > …) |
|---|---|---|
| LCP | ≤ 2500 ms | 4000 ms |
| INP | ≤ 200 ms | 500 ms |
| CLS | ≤ 0.1 | 0.25 |
| FCP | ≤ 1800 ms | 3000 ms |
| TTFB | ≤ 800 ms | 1800 ms |

- Alerter sur **dégradation soutenue** du `p75` (pas un pic isolé) +
  `count` significatif (éviter le bruit sur faible volume).
- Endpoint best-effort : `metrics: []` (200) ≠ « tout va bien » — peut
  signifier table vide / collecteur S9 arrêté. L'outillage ops doit
  distinguer « 0 métrique » d'un vrai signal sain (corréler avec le volume
  de POST `/api/telemetry/web-vitals` côté S9).
- **Loi 25 (hérité S4)** : aucune PII exposée — agrégats anonymes
  (`metric_name`, count, avg, p75). Pas d'`url`/`session_id`/`client_id`
  dans la réponse.

---

## 8. Récap fichiers (Manager B, LOT D)

| Fichier | Action |
|---|---|
| `src/worker/observability-ops.ts` | **CRÉÉ** — `handleAdminWebVitals` (garde admin locale + agrégat best-effort) |
| `src/worker/__tests__/sd-observability.test.ts` | **CRÉÉ** — garde 403 / agrégat count·avg·p75 / best-effort / period |
| `docs/OBSERVABILITY-OPS-S-D3.md` | **CRÉÉ** — ce doc |
| `src/worker/health.ts` | **NON modifié** (anti-sur-scope §6.4, justifié §6) |

Aucun fichier interdit touché (logger/error-response/migrations/helpers
figés/worker.ts/Manager C/E4-E6/i18n/wrangler intacts).
