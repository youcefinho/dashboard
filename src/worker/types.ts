/// <reference types="@cloudflare/workers-types" />
// ── Types partagés Worker ────────────────────────────────────

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  RESEND_API_KEY?: string;
  OPENAI_API_KEY?: string;
  WEBHOOK_SECRET: string;
  NOTIFICATION_EMAIL: string;
  ALLOWED_ORIGINS: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  TWILIO_API_KEY?: string;
  TWILIO_API_SECRET?: string;
  TWILIO_TWIML_APP_SID?: string;
  // ── Sprint SMS/WHATSAPP seq 104 — WhatsApp Business (Meta Cloud API) ───────
  // FLAGS INACTIFS par défaut. Tous OPTIONNELS : tant que WHATSAPP_ACCESS_TOKEN
  // est ABSENT, sendWhatsAppTemplate retourne { success:false } SANS appel
  // réseau (calque EXACT helpers.sendSms:93-95 / telephony.placeCall:85-88).
  // WHATSAPP_VERIFY_TOKEN sert au handshake GET du webhook Meta (hub.challenge) ;
  // sans lui le verify renvoie 403 (jamais 500). Secrets fournis via bindings
  // Wrangler (`wrangler secret put`) — JAMAIS hardcodés.
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  ANTHROPIC_API_KEY: string;
  USE_MOCKS: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  FILES: R2Bucket;
  WEBCHAT_ROOMS: DurableObjectNamespace;
  // Sprint 46 M3.4 — Durable Object rooms pour push WebSocket notifications par user.
  // Optionnel : si non bindé dans wrangler, broadcast skip silencieusement.
  NOTIFICATION_ROOMS?: DurableObjectNamespace;
  BROADCAST_QUEUE: Queue;
  WEBHOOK_QUEUE?: Queue;
  RATE_LIMITER?: KVNamespace;
  GHL_CLIENT_ID?: string;
  GHL_CLIENT_SECRET?: string;
  GHL_REDIRECT_URI?: string;
  TOKEN_KEY?: string; // 32-char string pour AES-GCM chiffrement tokens OAuth
  COMMUNITY_SALT?: string; // S45 — salt SHA-256 hashIp votes (Loi 25). Fallback 'intralys-default-salt' dev. Production ENV-set.
  STATE_STORE?: KVNamespace; // KV namespace pour nonces CSRF OAuth (TTL 10min)
  DEV_BYPASS_AUTH?: string; // 'true' = bypass login + rate limit + password (UNIQUEMENT en dev local via .dev.vars, JAMAIS en prod)
  /**
   * FCM Server Key (push notifications mobile).
   * Sprint 27 push registers — Sprint 30 typage propre.
   * NB : FCM Legacy HTTP API deprecated juin 2024 — migration FCM v1 OAuth
   *      backlog post-RC, cf. docs/TECH-DEBT-RC.md P0-02.
   */
  FCM_SERVER_KEY?: string;
  // ── Sprint E4 — Paiement marchand e-commerce (providers M2/M3) ───────────
  // ⚠️ ZONE RÉGULÉE. Secrets fournis via bindings Wrangler (secret put) —
  // JAMAIS hardcodés, JAMAIS stockés en clair dans D1. DISTINCT du billing
  // SaaS (billing.ts, intouchable). Optionnels : si non bindés, l'init/webhook
  // paiement reste inoffensif (provider non branché → refus/no-op).
  STRIPE_SECRET_KEY?: string;       // clé secrète Stripe marchand (E4, M2)
  STRIPE_WEBHOOK_SECRET?: string;   // secret de signature webhook Stripe (E4, M2)
  // ── Sprint E8 — Omnicanal concurrent (canaux Shopify / WooCommerce) ───────
  // ⚠️ Secrets OAuth fournis via bindings Wrangler (`wrangler secret put`) —
  // JAMAIS hardcodés, JAMAIS stockés en clair dans D1. `sales_channels.config_ref`
  // pointe l'un de ces bindings par RÉFÉRENCE (ex config_ref='SHOPIFY'). Le push
  // / pull réel des plateformes est branché par M2 (ecommerce-channel-*).
  // Optionnels : si non bindés, le canal externe reste inerte (no-op).
  SHOPIFY_CLIENT_ID?: string;       // App OAuth Shopify — client id (E8, M2)
  SHOPIFY_CLIENT_SECRET?: string;   // App OAuth Shopify — client secret (E8, M2)
  SHOPIFY_WEBHOOK_SECRET?: string;  // secret de signature webhook Shopify (E8, M2)
  WOO_CLIENT_ID?: string;           // WooCommerce REST — consumer key (E8, M2)
  WOO_CLIENT_SECRET?: string;       // WooCommerce REST — consumer secret (E8, M2)
  WOO_WEBHOOK_SECRET?: string;      // secret de signature webhook Woo (E8, M2)
  // ── LOT G9 — White-label custom domain (FLAGS INACTIFS par défaut) ────────
  // Deux drapeaux string OPTIONNELS. Tant qu'ils ne valent pas exactement
  // 'true', le squelette white-label reste 100% NO-OP réseau : statut hostname
  // 'pending' (provisionCustomHostname) + from email défaut byte-identique
  // (resolveFromAddress). Provisioning réel Cloudflare for SaaS + from/DKIM par
  // tenant sont branchés Phase B UNIQUEMENT derrière ces flags.
  WHITELABEL_PROVISIONING_ENABLED?: string; // 'true' = active provisioning CF for SaaS
  WHITELABEL_DKIM_ENABLED?: string;         // 'true' = active from/DKIM par tenant
  // ── LOT G4 — OAuth natives (FLAG PAR PROVIDER via credentials) ────────────
  // Connexions OAuth natives par tenant (oauth_connections seq 95) : Google
  // Calendar + Slack (v1). Credentials OPTIONNELS fournis via bindings Wrangler
  // (`wrangler secret put`). Tant que les DEUX (id+secret) d'un provider sont
  // ABSENTS, le handler authorize de ce provider renvoie 400 'non configuré'
  // (PAS 500, calque _v2-backlog/gcal.ts:28) et le callback est no-op : ZÉRO
  // appel réseau. Tokens stockés CHIFFRÉS via TOKEN_KEY (déjà déclaré l.30 —
  // AES-GCM ; clair si absent, limite documentée). State CSRF via STATE_STORE
  // (KV, déjà déclaré l.31). Distinct de GHL_* / META_* / GOOGLE_* (gcal V2
  // backlog, débranché).
  GOOGLE_OAUTH_CLIENT_ID?: string;     // App OAuth Google (Calendar) — client id (G4)
  GOOGLE_OAUTH_CLIENT_SECRET?: string; // App OAuth Google (Calendar) — client secret (G4)
  SLACK_CLIENT_ID?: string;            // App OAuth Slack — client id (G4)
  SLACK_CLIENT_SECRET?: string;        // App OAuth Slack — client secret (G4)
  // ── Sprint 33 — Calendar sync (Outlook + Google Calendar dédié) ──────────
  // Bindings OPTIONNELS. Tant qu'absents, les handlers OAuth respectifs
  // renvoient 400 'non configuré' (no-op réseau — calque G4 ci-dessus).
  // MS_OAUTH_* = Microsoft Identity Platform (Outlook/Microsoft 365).
  // GCAL_SYNC_OAUTH_* = app Google dédiée sync calendar (DISTINCTE de
  // GOOGLE_OAUTH_* G4 et de GHL_/META_/GBP_). Tokens chiffrés TOKEN_KEY.
  MS_OAUTH_CLIENT_ID?: string;
  MS_OAUTH_CLIENT_SECRET?: string;
  MS_OAUTH_TENANT?: string;
  GCAL_SYNC_OAUTH_CLIENT_ID?: string;
  GCAL_SYNC_OAUTH_CLIENT_SECRET?: string;
  // ── Sprint 36 — Live chat widget (Cloudflare Turnstile anti-bot) ─────────
  // OPTIONNEL. Tant que TURNSTILE_SECRET est ABSENT, verifyTurnstile()
  // retourne FAIL-OPEN (true) sans appel réseau (calque idiome
  // helpers.sendSms:93-95 / rate-limit.ts:65-70). Activé Phase B Manager-B
  // UNIQUEMENT si secret bindé + colonne widget.turnstile_enabled=1.
  TURNSTILE_SECRET?: string;
  // V2 backlog (désactivés Sprint Consolidation)
  // OPENAI_API_KEY: string;
  // GOOGLE_CLIENT_ID: string;
  // GOOGLE_CLIENT_SECRET: string;
  // GOOGLE_REDIRECT_URI: string;
  // GBP_API_KEY: string;
}

export interface AuthContext {
  userId: string;
  role: string;
}

export const SESSION_DURATION_HOURS = 24;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_WINDOW_HOURS = 1;

// ── E9 analytics/reco ──────────────────────────────────────────────────────
// Types backend du DERNIER sprint roadmap e-commerce (analytics multi-devise +
// reco produits + prédiction churn). ADDITIF — aucun type existant modifié.
// Convention figée projet : money en cents, multi-devise JAMAIS sommée
// (ventilation par devise — aucune conversion FX en base = hardcode interdit),
// multi-tenant strict (client_id partout), fallback déterministe TOUJOURS pour
// reco/churn (LLM optionnel non bloquant).

/** Agrégat revenu NET-of-refunds pour UNE devise (jamais sommé cross-devise). */
export interface RevenueByCurrency {
  currency: string;
  gross: number;   // SUM(orders.total_cents) statuts comptés (cents)
  refunds: number; // SUM(refunds.amount_cents 'succeeded') (cents)
  net: number;     // max(0, gross − refunds) (cents)
  orders: number;  // nb de commandes comptées
  aov: number;     // net / orders, arrondi (cents) — 0 si aucune commande
}

/** Une cohorte d'acquisition (mois 'YYYY-MM') + rétention mensuelle [0..N]. */
export interface CohortRow {
  month: string;        // mois d'acquisition (1re commande comptée) 'YYYY-MM'
  size: number;         // nb de clients acquis ce mois
  retention: number[];  // % actifs au mois M+i (retention[0] = 100 par déf.)
}

/** Top produit agrégé (order_items joints) ventilé par devise de commande. */
export interface TopProductRow {
  variant_id: string;
  title: string;
  qty: number;
  revenue_cents: number;
  currency: string;
}

/** Recommandation produit (co-achat déterministe ± réordonnée LLM). */
export interface ProductRecoRow {
  variant_id: string;
  title: string;
  reason: 'co_purchase' | 'same_category';
  score: number; // score de pertinence déterministe (co-occurrences)
}

/** Prédiction de churn client (heuristique RFM/recency ± enrichie LLM). */
export interface ChurnPrediction {
  customer_id: string;
  score: number;             // 0..100 (plus haut = plus à risque)
  risk: 'low' | 'med' | 'high';
  reasons: string[];
  fallback: boolean;         // true = heuristique seule (LLM indispo/skip)
}

// ── Sprint SMS/WHATSAPP seq 104 — modèles backend (ADDITIF) ─────────────────
// Le front a ses propres miroirs dans src/lib/types.ts (SmsTemplate /
// WhatsAppConnection). client_id = bornage tenant APPLICATIF (PAS de FK).

/** Modèle de SMS réutilisable (table sms_templates seq 104). */
export interface SmsTemplate {
  id: string;
  client_id?: string | null;
  name: string;
  body: string;
  created_at?: string | null;
}

/** Connexion WhatsApp Business par tenant (table whatsapp_connections seq 104).
 *  status 'inactive' par défaut tant qu'access_token absent (squelette
 *  flag-inactif — aucun appel réseau Meta). */
export interface WhatsAppConnection {
  id: string;
  client_id?: string | null;
  phone_number_id?: string | null;
  access_token?: string | null;
  status: string;
  created_at?: string | null;
}

// ── Sprint 24 — Observabilité (types worker) ─────────────────────────────
// Ligne miroir avec migration-observability-seq122.sql (3 tables).
// Aucun ajout à l'interface Env (pas de nouveau binding requis).

export interface RequestMetricRow {
  bucket_start: string;
  route: string;
  method: string;
  status: number;
  tenant_id: string | null;
  count: number;
  latency_sum_ms: number;
  latency_max_ms: number;
}

export type AlertConditionType = 'error_rate' | 'p95_latency' | 'web_vital_p75';
export type AlertChannel = 'log' | 'webhook';

export interface AlertRuleRow {
  id: string;
  name: string;
  condition_type: AlertConditionType;
  metric_name: string | null;
  threshold: number;
  window_minutes: number;
  notification_channel: AlertChannel;
  notification_target: string;
  enabled: 0 | 1;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEventRow {
  id: string;
  rule_id: string;
  triggered_at: string;
  payload: string;
  resolved_at: string | null;
}

// ── Sprint 75 — Sparkle Weekly Analytics Reports ────────────────────────────
export interface WeeklyAiInsight {
  id: string;
  client_id: string;
  content: string;
  metric_changes_json: string;
  created_at: string;
}
