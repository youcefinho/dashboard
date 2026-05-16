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
  STATE_STORE?: KVNamespace; // KV namespace pour nonces CSRF OAuth (TTL 10min)
  DEV_BYPASS_AUTH?: string; // 'true' = bypass login + rate limit + password (UNIQUEMENT en dev local via .dev.vars, JAMAIS en prod)
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
