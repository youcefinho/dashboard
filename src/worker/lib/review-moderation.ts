// ── Review moderation lib — Sprint 40 impl (2026-05-24) ────────────────────
//
// 4 helpers anti-spam / verified-buyer / auto-approve pour `product_reviews`
// seq135. Contrats FIGÉS (calque `lib/loyalty-engine.ts` /
// `lib/gift-card-engine.ts`).
//
// Politique : pas de CHECK SQL, validation enums/range côté handler
// (`product-reviews.ts`). Toute panne D1/réseau ⇒ dégradation gracieuse
// (jamais de throw — calque `lib/currency-converter.ts`).

import type { Env } from '../types';

/** Score spam heuristique (0..100). >50 ⇒ flag, >80 ⇒ auto-reject (HANDLER décide). */
export interface SpamScore {
  /** Score final 0..100. */
  score: number;
  /** Signaux déclenchés (badwords|links|caps_ratio|short_body|rate_limit). */
  reasons: string[];
}

/**
 * Calcule le score spam d'un corps d'avis selon heuristiques (badwords,
 * ratio caps, présence de liens hors-domaine, longueur, repetition).
 * PUR — pas de D1, pas de réseau. Locale pilote dictionnaire badwords
 * (fr-CA|fr-FR|en|es).
 *
 * Heuristiques :
 *   - Links count > 3       : +30
 *   - Caps ratio > 50%      : +20
 *   - Repeated chars (4+)   : +15
 *   - All caps && length>20 : +15
 *   - Length < 10           : +20
 *   - Length > 5000         : +10
 *
 * Score clampé 0..100. Reasons listent les triggers (jamais le contenu lui-même).
 *
 * Contrat FIGÉ : computeSpamScore(body, locale) -> SpamScore.
 */
export function computeSpamScore(
  body: string,
  locale: string,
): SpamScore {
  void locale; // Locale réservé pour heuristiques futures (badwords pondérés).

  const reasons: string[] = [];
  let score = 0;

  if (typeof body !== 'string' || body.length === 0) {
    return { score: 0, reasons: [] };
  }

  const len = body.length;

  // 1) Links count > 3
  const linkMatches = body.match(/https?:\/\/[^\s]+/gi) || [];
  if (linkMatches.length > 3) {
    score += 30;
    reasons.push('links');
  }

  // 2) Caps ratio > 50% (parmi caractères alpha)
  const alpha = body.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (alpha.length > 0) {
    const upper = alpha.replace(/[^A-ZÀ-Þ]/g, '');
    const capsRatio = upper.length / alpha.length;
    if (capsRatio > 0.5) {
      score += 20;
      reasons.push('caps_ratio');
    }
    // 4) All caps + length > 20 (au-dessus du caps_ratio simple)
    if (len > 20 && capsRatio > 0.9) {
      score += 15;
      reasons.push('all_caps');
    }
  }

  // 3) Repeated chars (e.g. "aaaa") — 4+ même caractère consécutif
  if (/(.)\1{3,}/.test(body)) {
    score += 15;
    reasons.push('repeated_chars');
  }

  // 5) Length < 10
  if (len < 10) {
    score += 20;
    reasons.push('short_body');
  }

  // 6) Length > 5000
  if (len > 5000) {
    score += 10;
    reasons.push('long_body');
  }

  // Clamp 0..100
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return { score, reasons };
}

// ── Dictionnaires badwords embarqués (FR/EN/ES, ~30 mots core par langue) ───
// Liste minimaliste : profanités courantes + slurs majeurs. Pas exhaustif —
// modération humaine reste obligatoire pour cas limites. JAMAIS exporté
// (évite leak du dictionnaire dans bundle public). JAMAIS loggé.
const BADWORDS_FR: readonly string[] = [
  'merde', 'putain', 'salope', 'connard', 'connasse', 'enculé', 'enculer',
  'enculée', 'enfoiré', 'enfoirée', 'bâtard', 'batard', 'pute', 'pédé',
  'pede', 'tapette', 'nègre', 'negre', 'bougnoule', 'youpin', 'fdp',
  'ntm', 'tg', 'ftg', 'chier', 'chiotte', 'couille', 'couilles', 'bite',
  'queue', 'foutre',
];

const BADWORDS_EN: readonly string[] = [
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'bitch', 'bitches',
  'bastard', 'asshole', 'assholes', 'cunt', 'dick', 'dicks', 'cock',
  'cocks', 'pussy', 'whore', 'slut', 'sluts', 'nigger', 'nigga', 'faggot',
  'fag', 'retard', 'retarded', 'damn', 'piss', 'pissed', 'crap', 'wanker',
  'twat',
];

const BADWORDS_ES: readonly string[] = [
  'mierda', 'puta', 'puto', 'putos', 'putas', 'cabrón', 'cabron', 'cabrones',
  'pendejo', 'pendeja', 'pendejos', 'verga', 'vergas', 'coño', 'cono',
  'joder', 'jodido', 'jodida', 'culero', 'culera', 'maricón', 'maricon',
  'marica', 'pinche', 'chingar', 'chingada', 'chinga', 'gilipollas',
  'imbécil', 'imbecil', 'idiota', 'mamón',
];

/** Escape regex meta-chars d'un mot avant insertion dans pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sélectionne dictionnaire selon locale :
 *   fr-* / fr      → FR
 *   en-* / en      → EN
 *   es-* / es      → ES
 *   sinon          → EN (défaut le plus défensif).
 */
function pickDictionary(locale: string): readonly string[] {
  const norm = (locale || '').toLowerCase().slice(0, 2);
  if (norm === 'fr') return BADWORDS_FR;
  if (norm === 'es') return BADWORDS_ES;
  return BADWORDS_EN;
}

/**
 * Vérifie présence de badwords dans le corps selon locale. PUR.
 *
 * Regex word-boundary `\b${word}\b` case-insensitive. JAMAIS log les
 * mots détectés (pas de leak dans logs / observability). Retourne juste
 * un boolean — le handler décide quoi en faire (score +N ou flag direct).
 *
 * Contrat FIGÉ : containsBadWords(body, locale) -> boolean.
 */
export function containsBadWords(
  body: string,
  locale: string,
): boolean {
  if (typeof body !== 'string' || body.length === 0) return false;

  const dict = pickDictionary(locale);

  // Construit un seul regex alternatif pour perf (vs N matches successifs).
  // \b ne marche pas bien pour accents Unicode → utilise lookarounds non-word.
  const pattern = dict.map(escapeRegex).join('|');
  if (!pattern) return false;

  const re = new RegExp(`(?:^|[^\\p{L}])(?:${pattern})(?=[^\\p{L}]|$)`, 'iu');
  // NB : on NE log PAS le résultat ni le match. Juste boolean.
  return re.test(body);
}

/**
 * Détermine si le submitter est un acheteur vérifié pour le produit.
 * Match : (customer_id IS NOT NULL ET orders.status='paid' avec ce
 * product_id) OU (email match customers.email avec orders livrés).
 *
 * Best-effort : panne D1 ⇒ { verified: false, orderId: null } (jamais throw).
 *
 * Contrat FIGÉ : checkVerifiedBuyer(env, clientId, productId, customerId, email)
 * -> Promise<{ verified, orderId }>.
 */
export async function checkVerifiedBuyer(
  env: Env,
  clientId: string,
  productId: string,
  customerId: string | null,
  email: string,
): Promise<{ verified: boolean; orderId: string | null }> {
  try {
    if (!clientId || !productId) {
      return { verified: false, orderId: null };
    }

    let row: { id: string } | null = null;

    if (customerId) {
      // Match par customer_id : plus fiable (auth confirmée).
      row = await env.DB
        .prepare(
          `SELECT o.id AS id
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             JOIN product_variants pv ON pv.id = oi.variant_id
            WHERE o.customer_id = ?
              AND o.client_id = ?
              AND o.status = 'paid'
              AND pv.product_id = ?
            LIMIT 1`,
        )
        .bind(customerId, clientId, productId)
        .first<{ id: string }>();
    } else if (email) {
      // Fallback email : match best-effort si guest order.
      row = await env.DB
        .prepare(
          `SELECT o.id AS id
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             JOIN product_variants pv ON pv.id = oi.variant_id
             JOIN customers c ON c.id = o.customer_id
            WHERE c.email = ?
              AND c.client_id = ?
              AND o.client_id = ?
              AND o.status = 'paid'
              AND pv.product_id = ?
            LIMIT 1`,
        )
        .bind(email, clientId, clientId, productId)
        .first<{ id: string }>();
    }

    return {
      verified: !!row,
      orderId: row?.id ?? null,
    };
  } catch {
    // Dégradation gracieuse (calque `lib/currency-converter.ts`) — jamais throw.
    return { verified: false, orderId: null };
  }
}

/**
 * Décide automatiquement du statut d'un avis nouvellement soumis selon
 * (rating, verified_buyer, spam_score).
 *
 * Matrix décision (ordre des règles compte) :
 *   1. verified=true && rating>=4 && spamScore<20 → 'approved' (fast-track).
 *   2. rating <= 2                                → 'flagged' (low-rating
 *      systematic moderation, évite brigading).
 *   3. spamScore >= 50                            → 'flagged' (spam fort).
 *   4. sinon                                      → 'pending' (modération
 *      manuelle standard).
 *
 * Contrat FIGÉ : autoApproveDecision(rating, verified, spamScore)
 * -> 'approved'|'pending'|'flagged'.
 */
export function autoApproveDecision(
  rating: number,
  verified: boolean,
  spamScore: number,
): 'approved' | 'pending' | 'flagged' {
  // 1. Fast-track : acheteur vérifié + rating haut + score spam bas.
  if (verified && rating >= 4 && spamScore < 20) {
    return 'approved';
  }
  // 2. Low rating ⇒ modération systématique (anti-brigading).
  if (rating <= 2) {
    return 'flagged';
  }
  // 3. Spam fort ⇒ flag.
  if (spamScore >= 50) {
    return 'flagged';
  }
  // 4. Défaut : modération manuelle.
  return 'pending';
}
