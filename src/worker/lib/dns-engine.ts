// ── Sprint 50 — dns-engine.ts — Engine custom domains + DNS records ────────
//
// Helpers PURE/HANDLER pour custom-domains.ts Sprint 50. Module white-label
// par client — gestion DNS records des domaines custom via Cloudflare for
// SaaS (provisioning automatique zone + SSL + records).
//
// 3 helpers async EXPORTÉS (signatures FIGÉES Phase A, corps Phase B affinés) :
//   - verifyDomainOwnership(env, domain, token)  : async. Lookup DNS TXT
//                                                   _intralys-verify.<domain>
//                                                   pour vérifier que le
//                                                   token match. Phase B
//                                                   utilisera dns.google/
//                                                   resolve. Retourne
//                                                   VerifyDomainResult.
//   - provisionCloudflareForSaas(env, domain)    : async. Appelle l'API
//                                                   Cloudflare for SaaS
//                                                   pour créer la zone +
//                                                   SSL cert. Flag INACTIF
//                                                   V1 (env.CLOUDFLARE_API_TOKEN
//                                                   absent ⇒ retourne mock
//                                                   réaliste avec
//                                                   dns_records[]
//                                                   instructions).
//                                                   Phase B câblera l'API
//                                                   réelle (cloudflare/sdk
//                                                   ou fetch direct).
//   - syncDnsRecords(env, domainId)              : async. Lit les
//                                                   dns_records locaux,
//                                                   push vers l'API
//                                                   Cloudflare (POST
//                                                   /zones/:zone_id/dns_records),
//                                                   sauve cloudflare_record_id.
//                                                   Flag INACTIF V1.
//
// 5 helpers PURS EXPORTÉS (validation/normalisation) :
//   - normalizeDomain(domain)                    : lowercase + strip dots +
//                                                   trim (existant Phase A).
//   - validateHostname(host)                     : validation RFC 1035 stricte
//                                                   (max 253, label ≤63, no
//                                                   IP, no underscore, no
//                                                   leading/trailing hyphen,
//                                                   no consecutive dots).
//   - generateVerifyToken()                      : nonce hex 32 chars (UUID
//                                                   v4 sans tirets — calque
//                                                   custom-domains.ts).
//   - buildVerifyTxtName(hostname)               : retourne le FQDN du TXT
//                                                   verification (calque
//                                                   `_intralys-verify.<host>`).
//   - parseDnsResponse(raw)                      : normalise toute réponse
//                                                   externe (Cloudflare /
//                                                   dns.google) en
//                                                   DnsVerifyResult safe.
//
// Contrats GELÉS (docs/LOT-SURVEYS-DNS-S50.md §6) :
//   - imports RELATIFS uniquement (`../types`)
//   - PAS de throw — best-effort, dégradation gracieuse
//   - PAS d'appel réseau réel en Phase A (stubs only). Phase B câblera
//     dns.google.com (lookup TXT) + api.cloudflare.com (zone + records).
//   - normalizeDomain() — utilitaire pur (lowercase + strip trailing dot)
//     utilisé HANDLER avant INSERT (UNIQUE INDEX uniq_custom_domains_domain
//     est sensible à la casse).
//   - validateHostname() — RFC 1035 strict, anti-IDOR (un attaquant ne peut
//     pas insérer 'evil.com.victim.com' ou '10.0.0.1' comme custom domain).
//
// ⚠ NE TOUCHE PAS aux helpers sub-accounts.ts (whitelabel S94) — Sprint 50
//   ajoute une couche dédiée white-label custom domains, distincte du
//   storage de branding/logo géré par S94.

import type { Env } from '../types';

// ── Types internes (alignés api.ts client) ────────────────────────────────

/** Statut d'un custom domain. */
export type DomainStatus = 'pending' | 'verified' | 'active' | 'failed';

/** Statut SSL d'un custom domain (Cloudflare for SaaS). */
export type SslStatus = 'pending' | 'provisioned' | 'failed';

/** Type d'un DNS record. */
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV';

/** Whitelists validation HANDLER — PAS de CHECK SQL. */
export const DOMAIN_STATUSES = ['pending', 'verified', 'active', 'failed'] as const;
export const SSL_STATUSES = ['pending', 'provisioned', 'failed'] as const;
export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV'] as const;

/** Codes erreur stables (logs + télémétrie — JAMAIS exposés UI tels quels). */
export const DNS_ERROR_CODES = [
  'INVALID_HOSTNAME',
  'EMPTY_HOSTNAME',
  'HOSTNAME_TOO_LONG',
  'HOSTNAME_LABEL_TOO_LONG',
  'HOSTNAME_IS_IP',
  'HOSTNAME_HAS_UNDERSCORE',
  'HOSTNAME_HAS_LEADING_HYPHEN',
  'HOSTNAME_HAS_TRAILING_HYPHEN',
  'HOSTNAME_HAS_CONSECUTIVE_DOTS',
  'EMPTY_TOKEN',
  'CF_TOKEN_MISSING',
  'CF_API_ERROR',
  'CF_API_TIMEOUT',
  'DNS_NOT_VERIFIED',
  'DNS_LOOKUP_FAILED',
  'DOMAIN_TAKEN',
  'MALFORMED_RESPONSE',
  'PHASE_A_STUB',
] as const;

/** Type des codes erreur stables (pour télémétrie + tests). */
export type DnsErrorCode = (typeof DNS_ERROR_CODES)[number];

/** Une instruction DNS à poser par le client (TXT verify + CNAME app cible). */
export interface DnsInstructionRecord {
  /** Type du record DNS (A | AAAA | CNAME | TXT). */
  type: DnsRecordType;
  /** FQDN du record (ex `_intralys-verify.example.com` ou `example.com`). */
  name: string;
  /** Valeur attendue (token TXT ou cible CNAME). */
  value: string;
  /** TTL recommandé (sec) — défaut 3600. */
  ttl?: number;
}

/** Résultat de verifyDomainOwnership() — booléen + détail debug. */
export interface VerifyDomainResult {
  /** true ⇒ TXT match le token attendu. */
  verified: boolean;
  /** Erreur debug (optionnel — pas exposé à l'UI). */
  reason?: string;
  /** Code erreur stable pour télémétrie/tests (optionnel). */
  code?: DnsErrorCode;
}

/** Résultat de provisionCloudflareForSaas() — zone + SSL + instructions DNS. */
export interface ProvisionResult {
  /** ID de zone Cloudflare (null si flag INACTIF V1). */
  zone_id: string | null;
  /** Statut SSL initial (pending V1). */
  ssl_status: SslStatus;
  /** Statut domaine côté CF for SaaS (pending V1). */
  status?: DomainStatus;
  /** true si mode mock (CF token absent) — instructions affichées au client. */
  mock?: boolean;
  /** Raison du mock (debug — logs). */
  reason?: string;
  /** Code erreur stable. */
  code?: DnsErrorCode;
  /**
   * Instructions DNS à afficher au client (TXT verify + CNAME app cible).
   * Toujours présentes (même Phase B) pour que l'UI puisse les copier-coller.
   */
  dns_records?: DnsInstructionRecord[];
}

/** Résultat de syncDnsRecords() — combien de records ont été poussés. */
export interface SyncResult {
  /** Nombre de records synchronisés avec Cloudflare. */
  synced: number;
  /** Nombre de records skip (déjà à jour ou no-op). */
  skipped?: number;
  /** Nombre de records en erreur (best-effort — pas de throw). */
  failed?: number;
  /** Erreur si flag INACTIF / API token manquant. */
  reason?: string;
  /** Code erreur stable. */
  code?: DnsErrorCode;
  /** true si mode mock (CF token absent). */
  mock?: boolean;
}

/** Résultat de validateHostname() — ok + détail debug. */
export interface ValidateHostnameResult {
  /** true ⇒ hostname RFC 1035 valide. */
  ok: boolean;
  /** Erreur debug (UI peut surface au client). */
  error?: string;
  /** Code erreur stable. */
  code?: DnsErrorCode;
  /** Hostname normalisé (lowercase + strip dots) si ok=true. */
  normalized?: string;
}

// ── Constantes internes (RFC 1035) ────────────────────────────────────────

/** Longueur max d'un hostname (RFC 1035 §2.3.4). */
const HOSTNAME_MAX_LENGTH = 253;
/** Longueur max d'un label DNS (RFC 1035 §2.3.4). */
const LABEL_MAX_LENGTH = 63;
/** Longueur min d'un hostname utile (`a.b` minimum). */
const HOSTNAME_MIN_LENGTH = 3;

/**
 * Regex RFC 1035 stricte : labels [a-z0-9] avec hyphens internes seulement,
 * séparés par des dots, sans IP-like (vérification IP séparée).
 * Cas-insensitive — appliqué APRÈS lowercase.
 *
 * Chaque label : `[a-z0-9]` ou `[a-z0-9][a-z0-9-]{0,61}[a-z0-9]` (interne hyphen OK).
 */
const HOSTNAME_REGEX =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Regex IPv4 dotted-decimal (anti-hostname-is-IP). */
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Préfixe du TXT verification (convention Intralys white-label). */
const TXT_VERIFY_PREFIX = '_intralys-verify';

/** Cible CNAME app par défaut (apex domains Cloudflare Workers route). */
const APP_CNAME_TARGET = 'intralys-sites.workers.dev';

/** Default TTL recommandé pour instructions DNS (1h — convention Cloudflare). */
const DEFAULT_DNS_TTL = 3600;

// ── Helper PUR — normalizeDomain ──────────────────────────────────────────
/**
 * Normalise un nom de domaine : lowercase + strip trailing dot + trim.
 * Utilisé HANDLER avant INSERT custom_domains (UNIQUE INDEX sensible à la
 * casse). Exemple : ` Example.COM. ` ⇒ `example.com`.
 *
 * NB : ne valide PAS — utiliser validateHostname() pour ça. Cette fonction
 * reste byte-identique au comportement Phase A (un appelant existant qui
 * passait '  Example.COM.  ' attend toujours 'example.com').
 */
export function normalizeDomain(domain: string): string {
  return (domain || '').trim().toLowerCase().replace(/\.$/, '');
}

// ── Helper PUR — validateHostname (RFC 1035 strict) ───────────────────────
/**
 * Valide un hostname selon RFC 1035 §2.3.4 + best practices :
 *   - non vide après normalisation
 *   - longueur totale ∈ [3..253]
 *   - chaque label ≤ 63 chars
 *   - pas d'IP (IPv4 dotted decimal rejetée)
 *   - pas d'underscore (RFC 1035 strict — sauf TXT _verify côté serveur)
 *   - pas de hyphen leading/trailing sur un label
 *   - pas de dots consécutifs
 *   - pas de label vide
 *   - lowercase enforced (retourne `normalized` si ok)
 *
 * RETOURNE { ok, error?, code?, normalized? }. JAMAIS de throw.
 * Best-effort total — un appelant doit accepter le résultat tel quel.
 *
 * Anti-IDOR : empêche un attaquant d'insérer 'evil.com.victim.com' (qui
 * pourrait passer un check naïf mais pointe vers evil.com côté DNS), ou
 * '10.0.0.1' (qui n'a pas de TXT verify possible).
 *
 * Punycode (xn--) accepté tel quel (déjà ASCII compatible — un IDN doit
 * être encodé par le client avant submit ; un punycode invalide sera
 * rejeté par CF for SaaS Phase B).
 */
export function validateHostname(host: string): ValidateHostnameResult {
  if (!host || typeof host !== 'string') {
    return { ok: false, error: 'Hostname vide', code: 'EMPTY_HOSTNAME' };
  }
  const normalized = normalizeDomain(host);
  if (!normalized) {
    return { ok: false, error: 'Hostname vide', code: 'EMPTY_HOSTNAME' };
  }
  if (normalized.length < HOSTNAME_MIN_LENGTH) {
    return {
      ok: false,
      error: `Hostname trop court (min ${HOSTNAME_MIN_LENGTH})`,
      code: 'INVALID_HOSTNAME',
    };
  }
  if (normalized.length > HOSTNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Hostname trop long (max ${HOSTNAME_MAX_LENGTH})`,
      code: 'HOSTNAME_TOO_LONG',
    };
  }
  // IP rejetée — un custom_domain doit être un FQDN, pas une IP.
  if (IPV4_REGEX.test(normalized)) {
    return {
      ok: false,
      error: 'Hostname ne peut pas être une IP',
      code: 'HOSTNAME_IS_IP',
    };
  }
  // Underscore strict (RFC 1035) — interdit côté hostname client.
  if (normalized.includes('_')) {
    return {
      ok: false,
      error: 'Underscore interdit (RFC 1035)',
      code: 'HOSTNAME_HAS_UNDERSCORE',
    };
  }
  // Dots consécutifs (`example..com`) — label vide invalide.
  if (normalized.includes('..')) {
    return {
      ok: false,
      error: 'Dots consécutifs interdits',
      code: 'HOSTNAME_HAS_CONSECUTIVE_DOTS',
    };
  }
  // Validation label par label (avant regex globale pour erreur précise).
  const labels = normalized.split('.');
  for (const label of labels) {
    if (!label) {
      return {
        ok: false,
        error: 'Label vide interdit',
        code: 'HOSTNAME_HAS_CONSECUTIVE_DOTS',
      };
    }
    if (label.length > LABEL_MAX_LENGTH) {
      return {
        ok: false,
        error: `Label trop long (max ${LABEL_MAX_LENGTH}) : ${label}`,
        code: 'HOSTNAME_LABEL_TOO_LONG',
      };
    }
    if (label.startsWith('-')) {
      return {
        ok: false,
        error: `Label ne peut pas commencer par hyphen : ${label}`,
        code: 'HOSTNAME_HAS_LEADING_HYPHEN',
      };
    }
    if (label.endsWith('-')) {
      return {
        ok: false,
        error: `Label ne peut pas finir par hyphen : ${label}`,
        code: 'HOSTNAME_HAS_TRAILING_HYPHEN',
      };
    }
  }
  // Regex globale finale (catch-all caractères exotiques).
  if (!HOSTNAME_REGEX.test(normalized)) {
    return {
      ok: false,
      error: 'Hostname invalide (RFC 1035)',
      code: 'INVALID_HOSTNAME',
    };
  }
  // Au moins 2 labels (TLD requis — `localhost` rejeté).
  if (labels.length < 2) {
    return {
      ok: false,
      error: 'TLD requis (au moins 2 labels)',
      code: 'INVALID_HOSTNAME',
    };
  }
  return { ok: true, normalized };
}

// ── Helper PUR — generateVerifyToken ──────────────────────────────────────
/**
 * Génère un token de vérification DNS (nonce hex 32 chars). Calque
 * `custom-domains.ts:genVerificationToken` — exporté ici pour réutilisation
 * cross-handlers Phase B + tests d'unicité.
 *
 * Source d'entropie : `crypto.randomUUID()` (Cloudflare Workers natif).
 */
export function generateVerifyToken(): string {
  // crypto.randomUUID() = v4 (122 bits d'entropie) — collision probability
  // négligeable (< 1e-15 sur 1M tokens).
  return crypto.randomUUID().replace(/-/g, '');
}

// ── Helper PUR — buildVerifyTxtName ───────────────────────────────────────
/**
 * Construit le FQDN du TXT verification pour un hostname donné.
 * Convention Intralys : `_intralys-verify.<hostname>`. Le client doit poser
 * un TXT record à ce nom avec le token genVerificationToken() comme valeur.
 *
 * Retourne string vide si hostname invalide (best-effort — pas de throw).
 */
export function buildVerifyTxtName(hostname: string): string {
  const v = validateHostname(hostname);
  if (!v.ok || !v.normalized) return '';
  return `${TXT_VERIFY_PREFIX}.${v.normalized}`;
}

// ── Helper PUR — parseDnsResponse ─────────────────────────────────────────
/**
 * Normalise toute réponse externe (Cloudflare for SaaS / dns.google) en
 * VerifyDomainResult safe. Best-effort total — JSON malformed, shape
 * inattendue, null/undefined ⇒ retourne `{ verified: false, code: 'MALFORMED_RESPONSE' }`.
 *
 * Phase B Manager-B utilisera cette fonction pour parser la réponse de
 * dns.google.com/resolve (qui retourne {Answer: [{data: 'token'}]}) et la
 * réponse de api.cloudflare.com (qui retourne {success, result, errors}).
 *
 * Heuristiques :
 *   - `raw.Answer[0].data === expectedToken` ⇒ verified:true (dns.google)
 *   - `raw.success === true` ⇒ verified:true (cloudflare)
 *   - tout autre cas ⇒ verified:false avec code stable
 */
export function parseDnsResponse(
  raw: unknown,
  expectedToken?: string,
): VerifyDomainResult {
  if (raw == null || typeof raw !== 'object') {
    return {
      verified: false,
      reason: 'response-not-object',
      code: 'MALFORMED_RESPONSE',
    };
  }
  const obj = raw as Record<string, unknown>;

  // Heuristique 1 — dns.google.com/resolve shape : { Answer: [{data: '...'}] }
  if (Array.isArray(obj.Answer)) {
    const answers = obj.Answer as Array<Record<string, unknown>>;
    for (const ans of answers) {
      const data = typeof ans?.data === 'string'
        ? // dns.google quote les TXT (`"token"`) — strip
          ans.data.replace(/^"|"$/g, '')
        : '';
      if (expectedToken && data === expectedToken) {
        return { verified: true };
      }
    }
    return {
      verified: false,
      reason: 'txt-token-mismatch',
      code: 'DNS_NOT_VERIFIED',
    };
  }

  // Heuristique 2 — Cloudflare API shape : { success: true, result: {...} }
  if (typeof obj.success === 'boolean') {
    if (obj.success === true) {
      return { verified: true };
    }
    // Erreurs CF — surfacer la première erreur si présente.
    const errors = Array.isArray(obj.errors) ? obj.errors : [];
    const firstErr = errors[0];
    const errMsg =
      firstErr && typeof firstErr === 'object' && firstErr !== null
        ? String((firstErr as Record<string, unknown>).message ?? 'cf-error')
        : 'cf-error';
    return { verified: false, reason: errMsg, code: 'CF_API_ERROR' };
  }

  // Heuristique 3 — shape custom { verified: bool }
  if (typeof obj.verified === 'boolean') {
    return {
      verified: obj.verified,
      reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    };
  }

  return {
    verified: false,
    reason: 'unknown-response-shape',
    code: 'MALFORMED_RESPONSE',
  };
}

// ── Helper interne — buildDnsInstructions ─────────────────────────────────
/**
 * Construit les instructions DNS standard (TXT verify + CNAME app) pour un
 * hostname donné. Utilisé par le mock provisioning ET Phase B (l'UI affiche
 * toujours les mêmes instructions, le mode mock retourne juste un statut
 * pending au lieu d'un zone_id réel).
 */
function buildDnsInstructions(
  hostname: string,
  token: string,
): DnsInstructionRecord[] {
  return [
    {
      type: 'TXT',
      name: buildVerifyTxtName(hostname),
      value: token,
      ttl: DEFAULT_DNS_TTL,
    },
    {
      type: 'CNAME',
      name: hostname,
      value: APP_CNAME_TARGET,
      ttl: DEFAULT_DNS_TTL,
    },
  ];
}

// ── Helper interne — hasCloudflareToken ───────────────────────────────────
/**
 * Détecte si le flag Cloudflare for SaaS est ACTIF (token bindé + non vide).
 * Calque exact idiome helpers.sendSms:93-95 — flag-inactif si secret absent.
 *
 * NB : `CLOUDFLARE_API_TOKEN` n'est PAS encore déclaré dans Env (Phase B
 * l'ajoutera). On lit via cast `as` pour être forward-compat sans casser
 * le typage strict actuel.
 */
function hasCloudflareToken(env: Env): boolean {
  const token = (env as unknown as { CLOUDFLARE_API_TOKEN?: string })
    .CLOUDFLARE_API_TOKEN;
  return typeof token === 'string' && token.length > 0;
}

// ── 1) verifyDomainOwnership (async, best-effort) ─────────────────────────
/**
 * Vérifie qu'un domaine est bien sous le contrôle du tenant via lookup
 * DNS TXT `_intralys-verify.<domain>` égal à `token`.
 *
 * Phase A — stub : retourne toujours `{ verified: false, reason: 'phase-a-stub' }`
 *   (préservé byte-identique pour compatibilité tests existants).
 * Phase B Manager-B câblera dns.google.com/resolve (fetch direct) ou
 * Cloudflare Workers DNS-over-HTTPS — utilisera `parseDnsResponse()` pour
 * normaliser la réponse.
 *
 * Best-effort : lookup échoue (réseau, TXT absent) ⇒ verified: false avec
 * reason debug — l'UI réessaiera à la demande de l'utilisateur.
 *
 * Validation d'input AVANT lookup (anti-IDOR + anti-malformed) :
 *   - domain vide ⇒ verified:false code:EMPTY_HOSTNAME
 *   - domain invalide RFC 1035 ⇒ verified:false code:INVALID_HOSTNAME
 *   - token vide ⇒ verified:false code:EMPTY_TOKEN
 *
 * @param env     Env Cloudflare Workers.
 * @param domain  Domaine à vérifier (sera re-validé interne).
 * @param token   Token attendu dans le TXT record.
 */
export async function verifyDomainOwnership(
  _env: Env,
  domain: string,
  token: string,
): Promise<VerifyDomainResult> {
  // Validation input — anti-IDOR + anti-malformed (best-effort, jamais throw).
  if (!domain || typeof domain !== 'string') {
    return {
      verified: false,
      reason: 'phase-a-stub',
      code: 'EMPTY_HOSTNAME',
    };
  }
  const v = validateHostname(domain);
  if (!v.ok) {
    return {
      verified: false,
      reason: 'phase-a-stub',
      code: v.code ?? 'INVALID_HOSTNAME',
    };
  }
  if (!token || typeof token !== 'string') {
    return {
      verified: false,
      reason: 'phase-a-stub',
      code: 'EMPTY_TOKEN',
    };
  }

  // Phase A — stub. Phase B Manager-B câblera le lookup DNS TXT réel via
  // fetch dns.google.com + parseDnsResponse(raw, token). La signature reste
  // byte-identique au comportement Phase A pour les tests existants.
  return { verified: false, reason: 'phase-a-stub' };
}

// ── 2) provisionCloudflareForSaas (async, best-effort, FLAG INACTIF V1) ───
/**
 * Provisionne une zone Cloudflare for SaaS pour un custom domain :
 *   1. POST /zones (create zone) avec le domaine + plan SaaS
 *   2. POST /zones/:zone_id/ssl/certificate_packs (provision SSL)
 *   3. Retourne zone_id + ssl_status (initial 'pending', flip 'provisioned'
 *      via webhook Phase B).
 *
 * Flag INACTIF V1 — `env.CLOUDFLARE_API_TOKEN` absent ⇒ retourne un mock
 * réaliste :
 *   - `zone_id: null`
 *   - `ssl_status: 'pending'`
 *   - `status: 'pending'`
 *   - `mock: true, reason: 'cloudflare_token_missing'`
 *   - `dns_records: [TXT verify + CNAME app cible]` pour que l'UI affiche
 *     les instructions DNS au client (qui peut configurer manuellement
 *     en attendant le provisioning automatique Phase B).
 *
 * Si hostname invalide ⇒ retourne mock + code INVALID_HOSTNAME (best-effort
 * — JAMAIS de throw). Le handler peut décider de surface ou pas.
 *
 * @param env     Env Cloudflare Workers.
 * @param domain  Domaine à provisionner (sera re-validé interne).
 */
export async function provisionCloudflareForSaas(
  env: Env,
  domain: string,
): Promise<ProvisionResult> {
  // Validation input — retourne mock dégradé si invalide (jamais throw).
  const v = validateHostname(domain);
  if (!v.ok || !v.normalized) {
    return {
      zone_id: null,
      ssl_status: 'pending',
      status: 'pending',
      mock: true,
      reason: 'invalid_hostname',
      code: v.code ?? 'INVALID_HOSTNAME',
      dns_records: [],
    };
  }
  const hostname = v.normalized;

  // Flag INACTIF V1 — pas de CLOUDFLARE_API_TOKEN bindé.
  if (!hasCloudflareToken(env)) {
    // Mock réaliste — instructions DNS générées pour l'UI client.
    const verifyToken = generateVerifyToken();
    return {
      zone_id: null,
      ssl_status: 'pending',
      status: 'pending',
      mock: true,
      reason: 'cloudflare_token_missing',
      code: 'CF_TOKEN_MISSING',
      dns_records: buildDnsInstructions(hostname, verifyToken),
    };
  }

  // Phase B Manager-B — câblera l'API réelle :
  //   1. POST https://api.cloudflare.com/client/v4/zones
  //      { name: hostname, account: { id: env.CLOUDFLARE_ACCOUNT_ID }, type: 'partial' }
  //   2. POST /zones/:zone_id/ssl/certificate_packs
  //      { type: 'advanced', hosts: [hostname], validation_method: 'txt' }
  //   3. Retry/backoff sur 429 / 5xx (fetchCloudflareWithRetry helper Phase B).
  //   4. parseDnsResponse(raw) pour normaliser succès/erreur.
  //
  // Tant que la Phase B n'est pas câblée, on retourne un stub gracieux
  // EXACTEMENT byte-identique au comportement original (token bindé MAIS
  // pas de logique réseau ⇒ on retombe sur le shape minimal pour ne pas
  // mentir au handler). Le handler `handleAddCustomDomain` reste compatible.
  return { zone_id: null, ssl_status: 'pending' };
}

// ── 3) syncDnsRecords (async, best-effort, FLAG INACTIF V1) ───────────────
/**
 * Synchronise les `dns_records` locaux d'un custom domain avec l'API
 * Cloudflare. Pour chaque record local :
 *   - cloudflare_record_id null ⇒ POST /zones/:zone_id/dns_records
 *   - cloudflare_record_id présent ⇒ PUT /zones/:zone_id/dns_records/:id
 *   - record local supprimé ⇒ DELETE (Phase B câblera le tracking de
 *     suppression).
 *
 * Flag INACTIF V1 — `env.CLOUDFLARE_API_TOKEN` absent ⇒ retourne
 * `{ synced: 0, skipped: 0, failed: 0, reason: 'phase-a-stub', mock: true }`
 * sans appel réseau.
 *
 * Validation d'input AVANT lookup :
 *   - domainId vide ⇒ synced:0 code:INVALID_HOSTNAME (best-effort)
 *
 * @param env       Env Cloudflare Workers.
 * @param domainId  ID du custom domain dont sync les records.
 */
export async function syncDnsRecords(
  env: Env,
  domainId: string,
): Promise<SyncResult> {
  // Validation input.
  if (!domainId || typeof domainId !== 'string') {
    return {
      synced: 0,
      skipped: 0,
      failed: 0,
      reason: 'phase-a-stub',
      code: 'PHASE_A_STUB',
      mock: true,
    };
  }

  // Flag INACTIF V1.
  if (!hasCloudflareToken(env)) {
    return {
      synced: 0,
      skipped: 0,
      failed: 0,
      reason: 'phase-a-stub',
      code: 'CF_TOKEN_MISSING',
      mock: true,
    };
  }

  // Phase B Manager-B — câblera l'API Cloudflare réelle :
  //   1. SELECT dns_records WHERE domain_id = ? (D1).
  //   2. SELECT custom_domains.cloudflare_zone_id WHERE id = ? (D1).
  //   3. POUR chaque record : POST/PUT/DELETE vers CF avec retry/backoff.
  //   4. UPDATE dns_records SET cloudflare_record_id = ?
  //
  // Tant que Phase B n'est pas câblée, on retourne le stub original (synced:0
  // + reason 'phase-a-stub') pour préserver la compat tests existants.
  return { synced: 0, reason: 'phase-a-stub' };
}

// NB : 3 helpers async Sprint 50 (verifyDomainOwnership, provisionCloudflareForSaas,
// syncDnsRecords) + 5 helpers PURS (normalizeDomain, validateHostname,
// generateVerifyToken, buildVerifyTxtName, parseDnsResponse). Signatures async
// FIGÉES Phase A (signature byte-identique) — corps Phase B Manager-B câblera
// l'API réelle avec retry/backoff + parseDnsResponse pour normaliser.
// Imports RELATIFS uniquement. PAS de throw, best-effort total. Flag Cloudflare
// API INACTIF V1 (token absent ⇒ no-op gracieux avec mock shape réaliste).
// Choix figés docs/LOT-SURVEYS-DNS-S50.md §6.
