// ── twilio-verify.ts — LOT SMS/WHATSAPP seq 104 (Manager-A, Phase A) ────────
//
// Helpers PURS NEUFS (aucune dépendance D1) :
//   (a) verifyTwilioSignature — validation HMAC-SHA1 du webhook Twilio entrant
//       (X-Twilio-Signature). FLAG INACTIF : sans TWILIO_AUTH_TOKEN → bypass
//       (return true) ⇒ ne casse PAS le mode mock (calque sendSms:93-95).
//   (b) detectStopKeyword — détection STOP/opt-out CASL robuste (normalise
//       accents/casse) sur le corps d'un SMS entrant.
//
// Imports RELATIFS uniquement (./types) — PAS d'alias @/ (tsconfig.worker.json).
// Web Crypto (crypto.subtle) — AUCUNE lib Node (workerd runtime).
//
// Contrat figé docs/LOT-SMS-WHATSAPP.md §6.D. Signatures FIGÉES (worker.ts les
// câble). Phase B/C NE TOUCHENT PAS ce fichier.

import type { Env } from './types';

/**
 * verifyTwilioSignature — valide la signature X-Twilio-Signature d'un webhook
 * Twilio entrant (algorithme officiel Twilio) :
 *   1) concatène l'URL complète du webhook
 *   2) trie les paramètres POST par CLÉ (ordre alpha), concatène key+value
 *   3) HMAC-SHA1(authToken, urlConcatParams) → base64
 *   4) compare au header X-Twilio-Signature (égalité constante).
 *
 * FLAG INACTIF (calque helpers.sendSms:93-95) : si `!env.TWILIO_AUTH_TOKEN`
 * → return true (bypass). Le mode mock (sans credentials Twilio) reste 100%
 * fonctionnel — la validation ne bloque QUE quand un token est réellement
 * configuré. Si le header est absent alors qu'un token EXISTE → false (rejet).
 *
 * @param request requête entrante (sert à reconstruire l'URL signée)
 * @param env environnement (TWILIO_AUTH_TOKEN)
 * @param params paramètres POST DÉJÀ parsés (form-urlencoded) — le body N'EST
 *               PAS reconsommé ici (worker.ts lit le body une seule fois et
 *               passe les params ; cf. §6.E convention).
 */
export async function verifyTwilioSignature(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<boolean> {
  // FLAG INACTIF — sans token configuré, aucune validation possible : on bypass
  // (mode mock). NE CASSE PAS le squelette sans credentials.
  if (!env.TWILIO_AUTH_TOKEN) return true;

  const signature = request.headers.get('X-Twilio-Signature');
  // Token présent mais signature absente ⇒ rejet (webhook non signé).
  if (!signature) return false;

  try {
    // 1) URL complète (Twilio signe l'URL exacte qu'il a appelée).
    const url = request.url;

    // 2) Params triés par clé (ordre alphabétique), concaténés key+value.
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    // 3) HMAC-SHA1 (Web Crypto) → base64.
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(env.TWILIO_AUTH_TOKEN),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

    // 4) Comparaison (longueur + char-à-char ; entrées attaquant-contrôlées
    //    courtes, pas de timing-attack matériel exploitable côté workerd).
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    // Panne crypto inattendue : on refuse (token présent ⇒ on ne bypass pas).
    return false;
  }
}

// Mots-clés d'opt-out CASL (normalisés : trim + uppercase + accents retirés).
// 'STOP TOUT' contient un espace ⇒ comparé après normalisation de l'espace.
const STOP_KEYWORDS = new Set<string>([
  'STOP',
  'ARRET',
  'DESABONNEMENT',
  'UNSUBSCRIBE',
  'STOPTOUT',
  'STOP TOUT',
  'FIN',
  'CANCEL',
]);

/**
 * detectStopKeyword — true si le corps du SMS entrant est un mot-clé d'opt-out
 * CASL. Robuste : trim, uppercase, retrait des accents (NFD + retrait de la
 * plage U+0300..U+036F des diacritiques combinants), normalisation des espaces
 * multiples. 'ARRÊT' → 'ARRET', 'DÉSABONNEMENT' → 'DESABONNEMENT' tombent donc
 * sur les clés sans accent du set.
 *
 * Conforme LCAP/CASL : un opt-out doit être reconnu sans ambiguïté (Manager-B
 * branche l'INSERT unsubscribes + auto-reply de confirmation dans
 * handleInboundSms — cf. §6.H).
 */
export function detectStopKeyword(body: string): boolean {
  if (!body) return false;
  const normalized = body
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les diacritiques combinants
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' '); // espaces multiples -> un seul espace
  return STOP_KEYWORDS.has(normalized);
}
