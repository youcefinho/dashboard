// ── Sprint 36 — chat-origin-check.ts — Helpers anti-bot / allowlist origin ──
// Phase A SOLO : SIGNATURES FIGÉES (inter-agent contract docs/LOT-CHAT-WIDGET-S36.md §6).
// Phase B Manager-B remplit la logique réelle. Pour la Phase A, fonctions
// sécurisées par défaut (validateChatOrigin = true si allowlist NULL/[], false
// si origin null ; sha256Ip = vrai SHA-256 immédiatement utile ; verifyTurnstile
// = FAIL-OPEN si TURNSTILE_SECRET absent — calque helpers.sendSms:93-95 +
// rate-limit.ts:65-70).
//
// ZÉRO appel réseau Phase A. ZÉRO dépendance worker fragile.

import type { Env } from '../types';

/**
 * Valide l'origin d'une requête publique webchat contre l'allowlist du widget.
 *
 * Sémantique (FIGÉE Phase A — Manager-B doit s'y tenir) :
 *   - `allowedOrigins` NULL ou `[]`  ⇒ pas d'allowlist (mode legacy /
 *     compat seq25) → return `true` (tout origin autorisé).
 *   - `allowedOrigins` non-vide + `origin` null/undefined → return `false`
 *     (allowlist active mais origin absent = requête suspecte).
 *   - `allowedOrigins` non-vide + `origin` ∈ allowlist → return `true`.
 *   - sinon → return `false`.
 *
 * Comparaison stricte sur l'origin tel qu'envoyé par le navigateur (scheme +
 * host + port, sans path), Manager-B normalise (trim, lowercase host).
 */
export function validateChatOrigin(
  allowedOrigins: string[] | null,
  origin: string | null,
): boolean {
  // Phase A : implémentation minimale safe. Manager-B durcit (normalisation
  // host case-insensitive, wildcard sous-domaine `*.example.com`, etc.).
  if (!allowedOrigins || allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/**
 * Hash SHA-256 d'une IP brute, hex-encodé. Utilisé pour stocker
 * `webchat_sessions.ip_hash` SANS jamais persister l'IP brute (Loi 25 / RGPD).
 *
 * Implémentation immédiate (crypto.subtle natif Workers) — pas un stub :
 * Manager-B peut l'utiliser directement Phase B sans modification.
 */
export async function sha256Ip(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Vérifie un token Cloudflare Turnstile auprès du endpoint Cloudflare.
 *
 * FAIL-OPEN si TURNSTILE_SECRET absent (calque idiome helpers.sendSms:93-95 +
 * rate-limit.ts:65-70). Permet de poser le rail sans bloquer la prod tant que
 * le secret n'est pas bindé. Phase B Manager-B branche le vrai POST vers
 * https://challenges.cloudflare.com/turnstile/v0/siteverify.
 */
export async function verifyTurnstile(
  env: Env,
  token: string | null,
  _ip?: string,
): Promise<boolean> {
  // Phase A stub safe : pas de secret = pas de vérif (FAIL-OPEN).
  if (!env.TURNSTILE_SECRET) return true;
  // Sécurité Phase A : si secret présent mais token absent → reject.
  // Manager-B Phase B remplace par appel réseau réel (siteverify).
  if (!token || typeof token !== 'string' || token.length < 10) return false;
  // Stub Phase A : on accepte si secret + token apparent. Manager-B met le
  // vrai POST + parsing { success, 'error-codes' }.
  return true;
}
