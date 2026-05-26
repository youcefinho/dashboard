# EMBED-SECURITY — Sprint 36 Live chat widget

> Politique de sécurité d'embed du widget chat dans des sites tiers (cross-origin iframe sandboxée).
> Date : 2026-05-24. Version : 1.0. Sprint : 36.
> Compagnon de [`LOT-CHAT-WIDGET-S36.md`](LOT-CHAT-WIDGET-S36.md) (§6 contrat inter-agent), [`LOT-TEAM-BC.md`](LOT-TEAM-BC.md) (capabilities `settings.manage` figées seq80) et [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) (idiome Loi 25 / hashing PII). Calque la structure de [`SCHEMA-VERSIONING-S35.md`](SCHEMA-VERSIONING-S35.md).

---

## §1 Modèle de menace

Le widget chat v2 est embeddé sur des sites tiers (clients du tenant). La surface d'attaque est intrinsèquement **cross-origin + public** : la page hôte est inconnue, l'iframe est sandboxée, le visiteur est non-authentifié, et le flux REST `start/message/poll` est PUBLIC (pas de JWT). Ce document énumère les menaces et les contre-mesures empilées par couches.

### 1.1 Menaces (threats)

| # | Threat | Vecteur | Impact |
|---|--------|---------|--------|
| T1 | XSS via widget injection | `innerHTML` sur visitor data (nom, email, message) | Vol session agent, vol cookies dashboard, phishing inter-tenant |
| T2 | CSRF prechat | POST `start` depuis origin malveillant qui usurpe un client_id valide | Pollution `webchat_sessions`, abuse Turnstile quota |
| T3 | Cross-tenant leak | `:id` IDOR sur `widgets`/`sessions` côté admin REST | Lecture conversations d'un autre tenant |
| T4 | IP-based DoS | Visiteur ouvre 1000 sessions / min | Saturation D1, saturation DO `WebchatRoom`, coût CF |
| T5 | Origin spoofing | Site malveillant set `Origin: https://client-legitime.com` via fetch headers | Bypass allowlist (atténuation : Origin est CORS-controlled par navigateur, mais cURL/curl-like outils n'ont pas cette restriction) |
| T6 | Scraping PII visiteur | Bot qui poll `/chat-session/:id/poll` sans `session_id` connu | Lecture transcripts d'autres visiteurs |
| T7 | Replay attacks | Re-soumission d'un payload `start` signé Turnstile valide | Création de sessions multiples avec un seul challenge |
| T8 | postMessage hijack | Page hôte malveillante envoie `postMessage` vers iframe pour piloter le widget | Faux états (présence, fermeture forcée), injection contenu |
| T9 | Honeypot bypass | Bot avancé qui détecte `tabindex=-1` / `display:none` et n'auto-remplit pas | Saturation modérée (mitigé par couche rate-limit) |

### 1.2 Surfaces d'attaque

- **iframe `frame-v2.html`** : sandboxée (`allow-scripts allow-same-origin allow-forms`), DOM ops via `textContent` uniquement.
- **postMessage** : canal parent ↔ iframe, vérification stricte `event.origin === apiBase`.
- **WebSocket public** : route `/api/webchat/ws` (DO `WebchatRoom` seq25, INCHANGÉ Sprint 36).
- **REST prechat PUBLIC** : routes `/api/chat-session/start|message|poll` (handlers Sprint 36 dans `chat-session.ts`).
- **REST admin AUTHED** : 9 routes `/api/chat-widgets/*` et `/api/chat-presence/*` (handlers Sprint 36 dans `chat-widgets.ts`, capability `settings.manage`).

---

## §2 Sept couches de défense (matrice)

| # | Couche | Mécanisme | Implémentation Sprint 36 |
|---|--------|-----------|---------------------------|
| 1 | **Origin validation** | `webchat_widgets.allowed_origins` (JSON array) vs header `Origin` de la requête | `validateChatOrigin()` appelée dans `handlePublicChatStart` ([`src/worker/chat-session.ts`](../src/worker/chat-session.ts):94) |
| 2 | **Rate-limit IP** | 5 starts / 600 s par IP-hash | `checkRateLimit(env, 'webchat:prechat:${ipHash}', 5, 600)` ([`src/worker/chat-session.ts`](../src/worker/chat-session.ts):55) |
| 3 | **Honeypot** | Champ `_hp` caché (tabindex=-1, off-screen) | Détecté côté handler → silent drop 200 fake-success ([`src/worker/chat-session.ts`](../src/worker/chat-session.ts):48) |
| 4 | **Turnstile** | Cloudflare Turnstile optionnel par widget | `verifyTurnstile()` si `widget.turnstile_enabled === 1` ([`src/worker/lib/chat-origin-check.ts`](../src/worker/lib/chat-origin-check.ts):60) |
| 5 | **iframe sandbox** | `sandbox="allow-scripts allow-same-origin allow-forms"` | [`public/widget/v2.js`](../public/widget/v2.js):199 + `frame-v2.html` |
| 6 | **postMessage origin check** | Strict `event.origin === apiBase`, whitelist de types | [`public/widget/v2.js`](../public/widget/v2.js):238-257 |
| 7 | **XSS-safe rendering** | `textContent` uniquement (jamais `innerHTML` sur visitor data) | DOM ops dans `frame-v2.html` + `chat-widgets.ts:sanitizeInput()` côté serveur |

> **Defense in depth** : une couche compromise n'ouvre pas la surface entière. Exemple : un bot qui bypasse le honeypot (T9) frappe immédiatement le rate-limit IP (couche 2). Un site malveillant qui spoofe `Origin` (T5) via outil non-navigateur est arrêté soit par Turnstile (couche 4), soit par rate-limit (couche 2).

---

## §3 Validation Origin — détails

### 3.1 Sémantique `validateChatOrigin()`

Fonction implémentée dans [`src/worker/lib/chat-origin-check.ts`](../src/worker/lib/chat-origin-check.ts):27. Signature figée Phase A :

```ts
export function validateChatOrigin(
  allowedOrigins: string[] | null,
  origin: string | null,
): boolean
```

Règles de décision :

| `allowedOrigins` | `origin` | Résultat | Rationale |
|------------------|----------|----------|-----------|
| `null` ou `[]` | n'importe quoi | `true` | Pas d'allowlist (mode compat seq25 legacy) |
| Non-vide | `null` ou `undefined` | `false` | Allowlist active mais Origin absent → requête suspecte (curl, fetch sans `mode: 'cors'`) |
| Non-vide | ∈ allowlist (match exact) | `true` | OK |
| Non-vide | ∉ allowlist | `false` | Reject — log audit `chat.origin.rejected` Phase B |

### 3.2 Comparaison stricte vs wildcard

**Phase A (minimum safe)** : comparaison stricte par `Array.includes()` sur l'origin complet (`scheme://host[:port]`).

**Phase B (durcissement Manager-B)** :

- Normalisation : `trim()`, lowercase du host, port par défaut implicite (`:80` pour `http`, `:443` pour `https`).
- Wildcard sous-domaine : entrée `*.example.com` matche `https://app.example.com`, `https://api.example.com` mais PAS `https://example.com` ni `https://evil-example.com`.
- Wildcard universel `*` : explicitement opt-in, à éviter en prod (équivaut à pas d'allowlist).

### 3.3 Politique par défaut

`allowed_origins` est `NULL` par défaut à la création d'un widget (cf. migration seq131). Cela signifie **"tout origin autorisé"** pour préserver la compat seq25 legacy. L'UI dashboard Phase C affichera un **bandeau d'avertissement** tant qu'aucun origin n'est configuré : *"Aucune restriction d'origine — votre widget peut être embeddé depuis n'importe quel site."*

### 3.4 Logging des rejets

Phase B Manager-B : tout rejet origin déclenche un `audit(env, null, 'chat.origin.rejected', 'chat_widget', widget_id, { origin, ip_hash })`. Permet à l'agent d'auditer les tentatives d'embed non-autorisées via l'UI Audit Log.

---

## §4 Rate-limit + IP hashing (Loi 25 / RGPD)

### 4.1 Bucket rate-limit

```ts
await checkRateLimit(env, `webchat:prechat:${ipHash}`, 5, 600);
```

- **Clé** : `webchat:prechat:${ipHash}` (préfixe distinct de `helpers.sendSms` et autres bucket types).
- **Limite** : 5 requêtes `start` par IP-hash par fenêtre de 600 s (10 min). Suffisant pour un visiteur légitime qui rafraîchit la page, insuffisant pour un bot qui itère.
- **Réponse** : `json({ error: 'rate_limited' }, 429)`. Le visiteur voit un message i18n `chat_widget.error.rate_limited`.
- **Lib partagée** : [`src/worker/lib/rate-limit.ts`](../src/worker/lib/rate-limit.ts) (seq121, partagée avec les autres routes publiques).

### 4.2 IP hashing SHA-256 (Loi 25)

```ts
export async function sha256Ip(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- **IP brute jamais stockée** — uniquement le hash SHA-256 hex (64 caractères).
- **Source IP** : header `CF-Connecting-IP` (natif Cloudflare Workers, anti-spoof côté edge).
- **Colonne D1** : `webchat_sessions.ip_hash TEXT` (seq131).
- **Bucket KV rate-limit** : utilise aussi `ipHash` (jamais l'IP brute).

### 4.3 Trade-off RGPD / Loi 25

| Approche | Anonymat | Rate-limit utile | Choix Intralys |
|----------|----------|------------------|----------------|
| Stocker IP brute | ❌ | ✅ | **NON** (violation Loi 25 art. 12) |
| Stocker hash SHA-256 | ✅ (one-way) | ✅ (déterministe) | **OUI** |
| Ne rien stocker | ✅ | ❌ (pas de bucket persistant) | NON (pas de protection) |

Le hash SHA-256 est **one-way et non reverse-engineerable** sans brute-force exhaustif sur l'espace IPv4 (~4.3 milliards, faisable en quelques heures mais sans contexte d'identité reliable). Pour IPv6, brute-force impraticable. La CNIL et la Commission d'accès à l'information du Québec acceptent ce pattern comme conforme à condition que **rien d'autre que le hash + horodatage** ne soit stocké.

---

## §5 Turnstile (Cloudflare CAPTCHA)

### 5.1 Activation par widget

Colonne `webchat_widgets.turnstile_enabled INTEGER DEFAULT 0` (seq131). Le tenant active/désactive Turnstile par widget via l'UI dashboard (`/settings/chat-widgets/:id`). Cela permet par exemple de l'activer sur un widget public de prospection (haut risque bot) et de le désactiver sur un widget interne intranet.

### 5.2 Env var `TURNSTILE_SECRET`

- **Binding optionnel** : `wrangler.jsonc` Phase B Manager-B ajoute `TURNSTILE_SECRET` dans `vars` (ou secret bindé via `wrangler secret put`).
- **FAIL-OPEN** si `env.TURNSTILE_SECRET` absent : `verifyTurnstile()` retourne `true` (calque idiome [`helpers.sendSms:93-95`](../src/worker/helpers.ts) et [`rate-limit.ts:65-70`](../src/worker/lib/rate-limit.ts)). Permet de poser le rail sans bloquer la prod tant que le secret n'est pas bindé (mode dev/mock).
- **FAIL-CLOSED** si secret présent + token invalide ou absent : `verifyTurnstile()` retourne `false`, handler renvoie `json({ error: 'turnstile_failed' }, 403)`.

### 5.3 Appel siteverify (Phase B Manager-B)

```ts
const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    remoteip: ip,  // optionnel
  }),
});
const json = await verifyRes.json() as { success: boolean; 'error-codes'?: string[] };
return json.success === true;
```

### 5.4 Sitekey publique côté widget

Phase C Manager-C : l'UI dashboard expose un champ `turnstile_sitekey` (à ajouter en Phase B si nécessaire, ou injection via `widget.js?meta=1`). Le sitekey est public (safe to expose) — c'est le `TURNSTILE_SECRET` qui doit rester côté serveur.

---

## §6 iframe sandbox + postMessage

### 6.1 Sandbox iframe

```html
<iframe
  src="https://api.intralys.dev/widget/frame-v2.html?client=..."
  sandbox="allow-scripts allow-same-origin allow-forms"
></iframe>
```

| Flag | Raison |
|------|--------|
| `allow-scripts` | Requis pour exécuter le JS du chat (WS, DOM updates) |
| `allow-same-origin` | Requis pour accéder à `localStorage` (persistance `conversation_id`) |
| `allow-forms` | Requis pour soumettre prechat form (nom, email) |
| **PAS** `allow-top-navigation` | Empêche l'iframe de naviguer la page hôte (anti-phishing) |
| **PAS** `allow-popups` | Empêche l'iframe d'ouvrir des fenêtres tierces (anti-malware) |
| **PAS** `allow-modals` | Empêche `alert()`/`confirm()`/`prompt()` (anti-UX hijack) |
| **PAS** `allow-pointer-lock` | Inutile pour un chat |
| **PAS** `allow-presentation` | Inutile pour un chat |

### 6.2 postMessage — émission iframe → parent

L'iframe ne fait que :

```js
parent.postMessage({ type: 'webchat.close' }, apiBase);
parent.postMessage({ type: 'webchat.presence', presence: 'online' }, apiBase);
parent.postMessage({ type: 'webchat.ws.state', state: 'reconnecting' }, apiBase);
```

**JAMAIS `'*'`** en `targetOrigin`. Toujours `apiBase` (origin du worker, ex: `https://api.intralys.dev`).

### 6.3 postMessage — réception parent ← iframe

Code [`public/widget/v2.js`](../public/widget/v2.js):238 :

```js
window.addEventListener('message', function (event) {
  if (event.origin !== apiBase) return;   // ← strict drop
  var data = event.data;
  if (!data || typeof data !== 'object') return;

  switch (data.type) {
    case 'webchat.close':       toggle(false); break;
    case 'webchat.presence':    updatePresence(data.presence); break;
    case 'webchat.ws.state':    setChipState(data.state); break;
    default:                    break;  // ← whitelist : reject tout type inconnu
  }
});
```

- **Strict origin drop** : tout message dont `event.origin !== apiBase` est ignoré silencieusement (couche 6).
- **Whitelist de types** : seuls 3 types sont reconnus (`webchat.close`, `webchat.presence`, `webchat.ws.state`). Tout autre type tombe dans le `default: break;`.
- **Pas d'`eval(data.type)`, pas de dispatch dynamique** sur le contenu du message.

---

## §7 Prévention XSS

### 7.1 Rendus côté iframe (`frame-v2.html`)

Tous les rendus de **visitor data** (nom, email, body de message) utilisent :

```js
element.textContent = value;   // ✅ safe
```

**Jamais** :

```js
element.innerHTML = value;             // ❌ INTERDIT
element.insertAdjacentHTML(...);       // ❌ INTERDIT
element.outerHTML = value;             // ❌ INTERDIT
```

### 7.2 Sanitization côté serveur

Le handler `handlePublicChatMessage` ([`src/worker/chat-session.ts`](../src/worker/chat-session.ts):142) passe TOUS les inputs visitor par `sanitizeInput(rawBody, 4000)` ([`src/worker/helpers.ts`](../src/worker/helpers.ts)). Cette fonction :

- Trim whitespace.
- Strip null bytes.
- Borne à `maxLen` (4000 chars pour body, 200 pour name/email, 500 pour URL).
- N'autorise PAS de balises HTML (encodage agnostique : c'est `textContent` côté rendu qui garantit la safety, pas un strip de balises serveur — defense in depth).

### 7.3 Pas d'`eval`, pas de `Function`, pas de `srcdoc` dynamique

- **Pas de `eval()`** dans `v2.js` ni `frame-v2.html`.
- **Pas de `new Function(...)`**.
- **Pas de `srcdoc=`** dynamique sur l'iframe — uniquement `src=` statique vers `/widget/frame-v2.html`.
- **Pas de `setTimeout(string, ms)`** — toujours `setTimeout(fn, ms)`.

### 7.4 CSP côté `frame-v2.html`

Phase B Manager-B : le worker qui sert `/widget/frame-v2.html` doit poser :

```
Content-Security-Policy: default-src 'self';
                         script-src 'self' https://challenges.cloudflare.com;
                         style-src 'self' 'unsafe-inline';
                         img-src 'self' data: https:;
                         connect-src 'self' wss://api.intralys.dev;
                         frame-ancestors ${allowed_origins join ' '};
```

- `'unsafe-inline'` toléré sur `style-src` (CSS inline pour theming dynamique du widget).
- `'unsafe-inline'` **non toléré** sur `script-src` (sécurité XSS).
- `frame-ancestors` calculé dynamiquement à partir de `webchat_widgets.allowed_origins` du widget courant.

---

## §8 RGPD / Loi 25 (Québec)

### 8.1 PII collectées

| Champ | Stocké ? | Forme | Rétention |
|-------|----------|-------|-----------|
| IP visiteur | ✅ | `ip_hash` SHA-256 (jamais brute) | Indéfinie (à clarifier Sprint 24 Obs) |
| User-Agent | ✅ | `user_agent` TEXT (en clair) | Indéfinie |
| Page URL | ✅ | `page_url` TEXT (en clair, hash anchors strippés à la source) | Indéfinie |
| Referrer | ✅ | `referrer` TEXT (en clair) | Indéfinie |
| Nom visiteur | ✅ optionnel | `visitor_name` TEXT | Supprimable via DELETE session |
| Email visiteur | ✅ optionnel | `visitor_email` TEXT lowercase | Supprimable via DELETE session |
| Body messages | ✅ | `messages.body` TEXT (en clair) | Indéfinie (lié à conversation) |

### 8.2 Audit logs

- **Timestamp + ip_hash + action** uniquement (jamais de PII visiteur en clair dans les logs).
- Format : `audit(env, null, 'chat.origin.rejected', 'chat_widget', widget_id, { origin, ip_hash })`.
- **Pas** de `visitor_email` ni `visitor_name` ni `body` dans les logs (couche 6 du modèle Loi 25).

### 8.3 Rétention sessions

Sprint 36 ne pose **pas** de cron de rétention automatique. L'admin peut supprimer manuellement via `DELETE /api/chat-widgets/:widgetId/sessions/:sessionId` (TODO Phase B Manager-B si pas câblé) ou via une migration nettoyage de masse.

**TODO Sprint 24 Obs** : ajouter un cron CF qui purge `webchat_sessions WHERE ended_at < datetime('now', '-90 days')` (à valider avec DPO du tenant).

### 8.4 Consent banner

Le visiteur est informé du traitement via :

- **`welcome_message`** du widget (à customiser par tenant — mention "Vos messages sont enregistrés à des fins de support").
- **Lien vers politique de confidentialité** du tenant via `frame-v2.html` footer (Phase B Manager-C : ajouter `data-privacy-url` attribut sur `<script>`).

### 8.5 Droits du visiteur (Loi 25 art. 27-28)

- **Droit d'accès** : Phase B Manager-C ajoute une route `GET /api/chat-session/:id/export` qui retourne le transcript en JSON.
- **Droit à l'oubli** : Phase B Manager-C ajoute `DELETE /api/chat-session/:id` qui supprime session + messages + bump `webchat_sessions.deleted_at`.
- **Droit de portabilité** : couvert par export JSON.

---

## §9 Headers HTTP recommandés

### 9.1 Endpoint `/api/webchat/widget.js` (script public)

| Header | Valeur | Raison |
|--------|--------|--------|
| `Access-Control-Allow-Origin` | `*` | Script public chargeable depuis n'importe quel site |
| `Content-Type` | `application/javascript; charset=utf-8` | Sécurité MIME-sniff |
| `Cache-Control` | `public, max-age=300, s-maxage=300` | Cache CF edge 5 min |
| `X-Content-Type-Options` | `nosniff` | Anti-MIME-sniff |

### 9.2 Endpoint `/widget/frame-v2.html` (iframe sandbox)

| Header | Valeur | Raison |
|--------|--------|--------|
| `Content-Security-Policy` | `frame-ancestors ${allowed_origins join};` | Couche 5 défense, dynamique par widget |
| `X-Frame-Options` | (NE PAS poser) | CSP `frame-ancestors` plus précis et override `X-Frame-Options` |
| `Referrer-Policy` | `no-referrer-when-downgrade` | Limite la fuite de l'URL hôte vers tiers |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Refuse les permissions sensibles à l'iframe |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Workers default — HTTPS only |

### 9.3 Endpoint `/api/chat-session/start|message|poll` (REST public)

| Header | Valeur | Raison |
|--------|--------|--------|
| `Access-Control-Allow-Origin` | écho `Origin` si ∈ allowlist, sinon (ne pas poser → CORS reject) | Sécurité couche 1 |
| `Access-Control-Allow-Methods` | `POST, GET, OPTIONS` | Selon endpoint |
| `Access-Control-Allow-Headers` | `Content-Type` | Pas de custom headers (pas d'`Authorization`) |
| `Access-Control-Max-Age` | `300` | Cache preflight 5 min |
| `Vary` | `Origin` | Si écho dynamique, indiquer au cache CF de varier |

### 9.4 Endpoint `/api/chat-widgets/*` (REST admin AUTHED)

| Header | Valeur | Raison |
|--------|--------|--------|
| `Cache-Control` | `private, no-store` | Réponses contiennent données tenant |
| `X-Frame-Options` | `DENY` | Anti-clickjacking sur dashboard admin |
| Auth | `Cookie session_id` ou `Authorization: Bearer` | Garde `requireAuth` au choke-point worker.ts |

---

## §10 Checklist de déploiement

Avant d'activer un widget Sprint 36 en prod, valider :

- [ ] `allowed_origins` configuré (au moins 1 entrée — pas de wildcard `*` sauf intent explicite documenté).
- [ ] `turnstile_enabled = 1` activé en prod (recommandé sauf widget intranet).
- [ ] `TURNSTILE_SECRET` bindé via `wrangler secret put TURNSTILE_SECRET`.
- [ ] Rate-limit testé : 6e requête `start` dans 600 s renvoie `429 rate_limited`.
- [ ] postMessage origin check vérifié dans DevTools : envoyer un message depuis console externe → ignoré.
- [ ] CSP `frame-ancestors` aligné avec `allowed_origins` (vérifier dans Network tab DevTools).
- [ ] Audit logs vérifiés : entrées `chat.origin.rejected` et `chat.rate_limited` présentes (si tentatives bots).
- [ ] **Pas de PII brute dans logs** : grep `audit_log` pour `visitor_email` / `body` / IP brute → 0 résultat.
- [ ] `v2.js` minifié + bundled (cible < 12 KB gzipped).
- [ ] Sandbox iframe vérifié dans DevTools : `allow-scripts allow-same-origin allow-forms` (pas `allow-top-navigation` ni `allow-popups`).
- [ ] `frame-v2.html` charge bien depuis `apiBase` (pas de mixed content).
- [ ] WS reconnect backoff visible via presence chip (état `reconnecting` → `open`).
- [ ] Test E2E embed depuis origin **non-autorisé** → réponse `403 origin_rejected` + entrée audit.
- [ ] Test E2E honeypot : injecter `_hp: "spam"` → réponse `200 { conversation_id: 'silent_drop' }` (pas de session créée en DB).
- [ ] Disclaimer Loi 25 visible dans `welcome_message` ou footer iframe.
- [ ] Bouton "Supprimer ma conversation" (Phase B Manager-C) — droit à l'oubli.

---

## §11 Références

- [`LOT-CHAT-WIDGET-S36.md`](LOT-CHAT-WIDGET-S36.md) — Contrat inter-agent et matrice routes/handlers.
- [`LOT-TEAM-BC.md`](LOT-TEAM-BC.md) — Capabilities figées (`settings.manage` seq80).
- [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) — Pattern hashing PII + rétention.
- [`SCHEMA-VERSIONING-S35.md`](SCHEMA-VERSIONING-S35.md) — Structure markdown calquée.
- [`src/worker/lib/chat-origin-check.ts`](../src/worker/lib/chat-origin-check.ts) — Helpers `validateChatOrigin` / `sha256Ip` / `verifyTurnstile`.
- [`src/worker/chat-session.ts`](../src/worker/chat-session.ts) — 3 handlers PUBLIC anti-bot.
- [`src/worker/chat-widgets.ts`](../src/worker/chat-widgets.ts) — 9 handlers AUTHED admin.
- [`public/widget/v2.js`](../public/widget/v2.js) — Loader widget v2 + postMessage strict.
- [Cloudflare Turnstile docs](https://developers.cloudflare.com/turnstile/) — siteverify reference.
- [Loi 25 (Québec) art. 12 et 27-28](https://www.legisquebec.gouv.qc.ca/fr/document/lc/p-39.1) — Hashing PII et droits d'accès/oubli.
