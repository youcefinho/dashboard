# Recovery Workflow — Sprint 40 (multi-touch abandoned carts)

> Compagnon de `LOT-REVIEWS-ABANDONED-S40.md` §6/§10. Décrit la **séquence
> multi-touch** ajoutée par `abandoned-carts.ts` (Sprint 40) au-dessus du
> moteur single-touch `ecommerce-cart-recovery.ts` (Sprint E7) — sans le
> toucher. Migration : `migration-product-reviews-abandoned-seq135.sql`.

## §1 Vue d'ensemble

- **Recovery workflow** = séquence multi-touch automatisée pour récupérer
  les paniers abandonnés (`carts.status = 'abandoned'`).
- **3 steps** progressifs :
  - **Step 1 — T+1h** : rappel doux, **pas de coupon** (preserve marge).
  - **Step 2 — T+24h** : email + coupon **5%** (`REC-{token8}-2`).
  - **Step 3 — T+72h** : email + coupon **10%** (`REC-{token8}-3`).
- **Idempotent** (UPDATE atomique conditional anti-race) + **batch borné**
  (LIMIT 50 par run cron) + **opt-out RGPD** (lookup `customers.dnd`).
- **Coexiste pacifiquement** avec **Sprint E7 single-touch**
  (`ecommerce-cart-recovery.ts`) — colonnes `ALTER` additives séparées,
  E7 utilise `recovered_at` legacy, S40 utilise `recovery_*` neuves.
- **Capabilities** : `clients.manage` (config + cron-scan), `reports.view`
  (lecture states). Réutilise engine coupons existant (seq18 + ALTER seq85).

## §2 Diagramme séquence

```
Cart abandonné (T=0)
  │
  │   carts.status='abandoned'
  │   recovery_email_sent_count = 0
  │   last_recovery_at = NULL
  │   recovery_completed_at = NULL
  │
  ▼ +60 min cumulative
Cron scan → Step 1
  ├─ DND check : customers.dnd = 1 ?  → INSERT attempt status='skipped_dnd', STOP
  ├─ Compose email "rappel doux" (pas de coupon)
  ├─ Send via Resend (customers.email)
  └─ recordRecoveryAttempt(cart, step=1, channel='email', coupon=null)
       UPDATE carts SET
         recovery_email_sent_count = 1,             -- 0→1
         last_recovery_at = datetime('now'),
         recovery_attempts_json = json_array(append step 1)
       WHERE id = ? AND recovery_email_sent_count = 0
                    AND recovered_at IS NULL        -- skip si E7 a déjà tiré
                    AND recovery_completed_at IS NULL
  │
  ▼ +23h cumulative (i.e. T+24h depuis abandon)
Cron scan → Step 2
  ├─ generateRecoveryCoupon → REC-{token8}-2 (5% off, single-use, TTL 7j)
  ├─ Compose email "5% offert" + coupon code dans CTA
  ├─ Send via Resend
  └─ recordRecoveryAttempt(cart, step=2, channel='email', coupon='REC-...')
       UPDATE carts SET
         recovery_email_sent_count = 2,             -- 1→2
         recovery_discount_code = 'REC-abc12345-2',
         last_recovery_at = datetime('now')
       WHERE id = ? AND recovery_email_sent_count = 1
                    AND recovered_at IS NULL
                    AND recovery_completed_at IS NULL
  │
  ▼ +48h cumulative (i.e. T+72h depuis abandon)
Cron scan → Step 3
  ├─ generateRecoveryCoupon → REC-{token8}-3 (10% off, single-use, TTL 7j)
  ├─ Compose email "dernière chance — 10%" + coupon
  ├─ Send via Resend
  └─ recordRecoveryAttempt(cart, step=3, channel='email', coupon='REC-...')
       UPDATE carts SET
         recovery_email_sent_count = 3,             -- 2→3
         recovery_discount_code = 'REC-abc12345-3',
         last_recovery_at = datetime('now')
       WHERE id = ? AND recovery_email_sent_count = 2
  │
  ▼ Cron suivant
SKIP (recovery_email_sent_count = 3, séquence terminée)
  │
  ▼ Si customer clique CTA email
GET /api/recovery/:cart_token/:step (PUBLIC, HMAC-vérifié)
  ├─ Vérifie signature `${cart_id}.${sig8}` via env.RECOVERY_SECRET
  ├─ Mark attempts_json[step-1].clicked_at = now
  ├─ Reposition carts.status = 'active' (réactive le panier)
  ├─ Redirect 302 → /storefront/checkout?cart={token}&coupon={code}
  └─ Si recovery_completed_at déjà posé → skip ré-application coupon, redirect direct

Si checkout success → carts.status='converted' + recovery_completed_at = now
                  → cron suivants : SKIP (recovery_completed_at IS NOT NULL)
```

## §3 Matrice discount

| Step | Délai cumulé (min) | Délai humain | Discount % | Coupon code format        | TTL coupon |
|-----:|-------------------:|--------------|-----------:|---------------------------|-----------:|
| 1    | 60                 | T+1h         | 0 %        | — (pas de coupon)         | —          |
| 2    | 1 440              | T+24h        | 5 %        | `REC-{token8}-2`          | 7 jours    |
| 3    | 4 320              | T+72h        | 10 %       | `REC-{token8}-3`          | 7 jours    |

Constantes figées Phase A (`src/lib/types.ts`) :

```ts
export const RECOVERY_DELAYS_MIN = { 1: 60, 2: 1440, 3: 4320 } as const;
export const RECOVERY_DISCOUNT_PCT = { 1: 0, 2: 5, 3: 10 } as const;
```

`{token8}` = 8 premiers caractères hex du `cart_token` (lui-même posé à
l'insertion du cart par seq85 — réutilisation directe, pas de regen). Permet
de tracer un coupon à un cart sans lookup inverse coûteux.

## §4 Anti-double-send vs Sprint E7

| Champ                              | Sprint E7 (single-touch) | Sprint 40 (multi-touch) |
|------------------------------------|--------------------------|-------------------------|
| `carts.recovered_at`               | ✅ utilisé (timestamp)   | ❌ jamais écrit         |
| `carts.recovery_email_sent_count`  | ❌ ignoré                | ✅ 0→3                  |
| `carts.last_recovery_at`           | ❌ ignoré                | ✅ MAJ chaque step      |
| `carts.recovery_attempts_json`     | ❌ ignoré                | ✅ append JSON          |
| `carts.recovery_discount_code`     | ❌ ignoré                | ✅ code coupon courant  |
| `carts.recovery_completed_at`      | ❌ ignoré                | ✅ NULL ou conversion   |

**Garde absolue côté Sprint 40** : tout UPDATE dans
`processRecoverySequence` inclut `WHERE recovered_at IS NULL` →
si E7 a déjà tiré son single-touch (et posé `recovered_at`), S40 **n'envoie
rien**, l'attempt est skippé et `recovery_email_sent_count` reste à 0.
**Garantie : un customer ne reçoit jamais E7 + S40 en doublon.**

Inverse non-symétrique : E7 n'a pas besoin de check sur les colonnes S40
(c'est S40 qui s'adapte à E7, pas l'inverse — préserve la
régression-zéro absolue sur `ecommerce-cart-recovery.ts`).

## §5 Templates email FR-CA / FR-FR / EN / ES

Composés par `composeRecoveryEmail(env, cartId, step, locale)` →
`{ subject, html, text }`. Variables : `{customer_first_name}`, `{cart_items_html}`,
`{cart_total}`, `{coupon_code}`, `{recovery_url}`, `{unsubscribe_url}`.

### Step 1 — Rappel doux (pas de coupon)

| Locale | Subject                                          | Body opener (text)                                                                                   |
|--------|--------------------------------------------------|------------------------------------------------------------------------------------------------------|
| fr-CA  | `Tu as oublié quelque chose dans ton panier ?`   | `Salut {first_name}, on a remarqué que tu avais laissé des articles dans ton panier. Les voici :`    |
| fr-FR  | `Vous avez laissé un article dans votre panier`  | `Bonjour {first_name}, vous avez récemment ajouté des articles à votre panier sans finaliser :`      |
| en     | `Did you forget something in your cart?`         | `Hi {first_name}, we noticed you left some items in your cart. Here's what's waiting for you:`       |
| es     | `¿Olvidaste algo en tu carrito?`                 | `Hola {first_name}, notamos que dejaste algunos artículos en tu carrito. Aquí están:`                |

CTA : "Reprendre mon panier" / "Reprendre votre panier" / "Resume my cart" / "Reanudar mi carrito".

### Step 2 — 5% offert

| Locale | Subject                                              |
|--------|------------------------------------------------------|
| fr-CA  | `5 % offert avec le code {coupon_code} 🎁`           |
| fr-FR  | `Profitez de 5 % de réduction avec {coupon_code}`    |
| en     | `5% off your cart with {coupon_code}`                |
| es     | `5% de descuento con {coupon_code}`                  |

Body : rappel des articles + bloc coupon stylé (background `--primary-50`,
code monospace) + CTA "Reprendre + appliquer 5 %".

### Step 3 — Dernière chance — 10%

| Locale | Subject                                                            |
|--------|--------------------------------------------------------------------|
| fr-CA  | `Dernière chance — 10 % avec {coupon_code} ⏰`                     |
| fr-FR  | `Dernière offre — 10 % de réduction avec {coupon_code}`            |
| en     | `Last chance — 10% off with {coupon_code}`                         |
| es     | `Última oportunidad — 10% de descuento con {coupon_code}`          |

Body : ton urgence light (PAS dark pattern — pas de countdown trompeur),
rappel articles + coupon + CTA "Réclamer mon -10 %". Mention obligatoire :
"Cette offre est la dernière — votre panier sera archivé après cet email."

### Footer commun (obligatoire 4 templates × 3 steps)

```html
<hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0">
<p style="font-size:12px;color:#6b7280">
  Vous recevez cet email parce que vous avez ajouté des articles à votre
  panier sur {site_name}.
  <a href="${origin}/api/unsubscribe?token={unsub_token}&list=recovery"
     style="color:#6b7280;text-decoration:underline">
    Se désabonner des rappels panier
  </a>
</p>
```

Le `unsub_token` est un HMAC `customer_id + list_name` signé via
`env.RECOVERY_SECRET` (durée illimitée, idempotent). `list=recovery`
ciblé : ne désabonne PAS des emails transactionnels (factures, livraisons).

## §6 RGPD opt-out / unsubscribe

### Couche 1 — DND check côté serveur

Avant chaque `send` dans `processRecoverySequence`, lookup
`customers.dnd` (colonne booléenne existante — Sprint 3 SMS/WhatsApp
seq104) :

```sql
SELECT dnd FROM customers
WHERE id = ? AND client_id = ?
LIMIT 1;
```

- Si `dnd = 1` → **skip envoi**, INSERT attempt avec
  `status = 'skipped_dnd'` (preserve trace + count) mais **n'incrémente
  PAS** `recovery_email_sent_count` (le customer pourrait retirer dnd plus
  tard et reprendre la séquence).
- Si `dnd = 0` ou customer NULL (guest checkout) → continue envoi normal.

### Couche 2 — Lien unsubscribe obligatoire

Présent dans **tous** les templates emails recovery (footer ci-dessus).
Lookup côté `/api/unsubscribe` :
1. Vérifie HMAC signature du token.
2. `UPDATE customers SET dnd = 1 WHERE id = ? AND client_id = ?`.
3. Affiche page confirmation bilingue avec lien re-subscribe (1 click).

### Couche 3 — Loi 25 retention

`recovery_attempts_json` conservé jusqu'à `recovery_completed_at + 1 an`
(calque rétention `orders`). Au-delà : cron purge (HORS SCOPE Phase A —
TODO Phase future) qui `UPDATE carts SET recovery_attempts_json = NULL`.

### Couche 4 — Anti-spam multi-tenant

Cap absolu : **3 emails recovery / 72h / customer**. Au-delà, la séquence
est verrouillée (`recovery_email_sent_count = 3`). Pas de re-trigger
automatique si le customer abandonne un nouveau cart < 7j.

## §7 Idempotence cron technique

### Pattern UPDATE atomique conditional

```ts
const result = await env.DB.prepare(`
  UPDATE carts SET
    recovery_email_sent_count = ?,
    last_recovery_at = ?,
    recovery_attempts_json = ?,
    recovery_discount_code = COALESCE(?, recovery_discount_code)
  WHERE id = ?
    AND client_id = ?
    AND recovery_email_sent_count = ?         -- state ATTENDU (anti-race)
    AND recovered_at IS NULL                  -- E7 n'a pas tiré (anti-doublon)
    AND recovery_completed_at IS NULL         -- séquence non terminée
`).bind(
  newCount, nowIso, attemptsJsonStr, couponCodeOrNull,
  cartId, clientId, oldCount
).run();

if (result.meta.changes === 0) {
  // Course perdue : un autre run cron a déjà incrémenté, OU E7 a tiré, OU completion.
  // Skip silencieusement (idempotent).
  return false;
}
return true;
```

**Calque** : `ecommerce-cart-recovery.ts:detectAbandonedCarts` (claim
atomique single-touch) + `gift-card-engine.ts:applyTransaction` (UPDATE
conditional anti-double-decrement seq133).

### Anti-doublon coupons

```ts
await env.DB.prepare(`
  INSERT OR IGNORE INTO coupons (id, client_id, code, type, value, ...)
  VALUES (?, ?, ?, 'percentage', ?, ...)
`).bind(couponId, clientId, couponCode, discountPct).run();
```

`INSERT OR IGNORE` sur unique `(client_id, code)` — retry cron safe.
Calque seq18 + ALTER seq85 `coupons` engine existant.

### `recordRecoveryAttempt` — séquence complète

```ts
async function recordRecoveryAttempt(
  env, cartId, step, channel, couponCode
): Promise<boolean> {
  // 1. SELECT current state
  const cart = await env.DB.prepare(
    `SELECT recovery_email_sent_count, recovery_attempts_json
     FROM carts WHERE id = ? LIMIT 1`
  ).bind(cartId).first();

  if (!cart || cart.recovery_email_sent_count !== step - 1) return false;

  // 2. Parse + append attempt
  const attempts: RecoveryAttempt[] = cart.recovery_attempts_json
    ? JSON.parse(cart.recovery_attempts_json)
    : [];
  attempts.push({
    step, channel,
    ts: new Date().toISOString(),
    coupon_code: couponCode,
    opened_at: null,
    clicked_at: null,
  });

  // 3. UPDATE conditional (WHERE count = step-1)
  return (await env.DB.prepare(`
    UPDATE carts SET
      recovery_email_sent_count = ?,
      last_recovery_at = datetime('now'),
      recovery_attempts_json = ?,
      recovery_discount_code = COALESCE(?, recovery_discount_code)
    WHERE id = ? AND recovery_email_sent_count = ?
                 AND recovered_at IS NULL
                 AND recovery_completed_at IS NULL
  `).bind(step, JSON.stringify(attempts), couponCode, cartId, step - 1)
    .run()).meta.changes === 1;
}
```

## §8 Exemple complet `attempts_json`

Cart `cart_abc123` ayant traversé les 3 steps avec engagement partiel :

```json
[
  {
    "step": 1,
    "channel": "email",
    "ts": "2026-05-24T10:00:00Z",
    "coupon_code": null,
    "opened_at": "2026-05-24T10:05:00Z",
    "clicked_at": null
  },
  {
    "step": 2,
    "channel": "email",
    "ts": "2026-05-25T10:00:00Z",
    "coupon_code": "REC-abc12345-2",
    "opened_at": "2026-05-25T10:30:00Z",
    "clicked_at": "2026-05-25T10:31:00Z"
  },
  {
    "step": 3,
    "channel": "email",
    "ts": "2026-05-27T10:00:00Z",
    "coupon_code": "REC-abc12345-3",
    "opened_at": null,
    "clicked_at": null
  }
]
```

`opened_at` posé via pixel tracking transparent 1×1 GIF (`/api/recovery/
:cart_token/:step/pixel.gif` — Phase B optionnel).
`clicked_at` posé par `handleRecoveryLandingPage` quand le customer clique
le CTA email (HMAC-vérifié, idempotent).

## §9 Recovery landing page

### Route

`GET /api/recovery/:cart_token/:step` (PUBLIC, pas d'auth, HMAC-vérifié).

### Comportement

1. **Vérification HMAC** : `cart_token` format `${cart_id}.${sig8}` où
   `sig8` = HMAC-SHA256(`${cart_id}|${step}`, env.RECOVERY_SECRET).
   Mismatch ⇒ 404 (pas 401 — anti-énumération).

2. **Lookup cart** : `SELECT * FROM carts WHERE id = ? AND
   status IN ('abandoned', 'active') LIMIT 1`. Inexistant ⇒ 404.

3. **Idempotence pre-check** : si `recovery_completed_at IS NOT NULL`,
   skip mark + skip re-application coupon, redirect direct vers checkout
   (le customer a peut-être re-cliqué après checkout).

4. **Reposition cart** : `UPDATE carts SET status = 'active' WHERE id = ?`
   (réactive le panier abandonné — anti pattern : ne pas le supprimer).

5. **Mark `clicked_at`** : parse `recovery_attempts_json`, trouve
   l'attempt avec `step` matching, set `clicked_at = now`, UPDATE.

6. **Redirect 302** :
   - Sans coupon (step 1) : `Location: /storefront/checkout?cart={token}`
   - Avec coupon (step 2/3) : `Location: /storefront/checkout?cart={token}&coupon={recovery_discount_code}`

7. **Tracking** : INSERT `cart_events (type='recovery_clicked', step,
   cart_id)` pour reporting (Phase B optionnel — calque `cart_events`
   Sprint E7).

### Sécurité

- **HMAC obligatoire** : un cart_token malformé ou non-signé ⇒ 404
  silencieux (anti-IDOR + anti-énumération de cart_id).
- **Pas d'écriture côté guest** : la landing page n'écrit QUE
  `clicked_at` + `status='active'` — pas de mutation prix/items/customer.
- **Coupon validation EN AVAL** : le coupon redirect est validé par
  `ecommerce-coupons.ts` (Sprint 4) côté checkout — pas appliqué
  côté landing (sépare concerns).

## §10 Limitations connues / hors-scope v1

- **Pas de cron `scheduled()` câblé Phase A** : trigger manuel via
  `POST /api/recovery/cron/scan` (`clients.manage`). Phase B câblera
  trigger `*/15 * * * *` dans `scheduled()` worker.ts (calque
  `runReviewModerationAutoFlagCron` pattern horaire).
- **Templates email embedded en TS** : strings dans
  `composeRecoveryEmail()` lib. TODO Phase future : extraire en table
  `recovery_templates` éditable via admin (`/admin/recovery/templates`)
  avec preview HTML live + variables documentées.
- **SMS channel pas wired** : seul `channel = 'email'` est implémenté.
  Le schéma `recovery_attempts_json` supporte `channel = 'sms'` (calque
  Sprint 3 `sms_messages`) — Phase future : SMS step 2 fallback si
  `customers.email IS NULL OR customers.email_bounce_count > 3`.
- **Pas de A/B testing templates** : 1 seul variant par locale × step.
  Phase future : table `recovery_template_variants` + assignation
  hash(customer_id) % 2 → variant A/B + tracking conversion.
- **Pas de personnalisation IA** : subject/body statiques. Phase future :
  Anthropic Haiku (`reviews.ts` pattern) pour reformulation subject par
  ICP segment (`customer_segment` tag).
- **Pas de re-trigger sur nouveau abandon** : si customer abandonne
  un 2e cart < 7j après le premier (séquence terminée step 3), il NE
  reçoit PAS de nouvelle séquence (cap anti-spam). Phase future :
  cooldown configurable côté `RecoveryConfig`.
- **Pas de dashboards analytics natifs** : open rate / click rate /
  recovery rate calculables à partir de `recovery_attempts_json` +
  `recovery_completed_at` mais pas exposés dans une UI dédiée Phase A.
  TODO Phase C+ : composant `RecoveryAnalyticsDashboard` agrégant les
  KPIs par step (calque `LOT-REPORTS-D.md`).
