// ── aiCompose — Sprint 49 M1.1 — Inline ghost-text suggestions ──────────────
// Gmail-style "Smart Compose" : suggère les prochains mots en ghost text.
//
// API publique :
//   - suggestCompose(args): Promise<string>   (backend Claude Haiku, max 12 mots)
//   - localComposeFallback(draft): string     (heuristique offline instant)
//
// Robustesse : fallback heuristique TOUJOURS (offline / API down / 4xx-5xx).
// Pattern réseau identique à aiDrafts.ts (token bearer + try/catch silencieux).

export interface ComposeSuggestArgs {
  /** Texte déjà tapé par l'utilisateur dans le composer. */
  currentDraft: string;
  /** Contexte conversation (dernier message inbound + historique court). */
  conversationContext?: string;
  /** Locale i18n active (fr-CA / fr-FR / en / es). */
  locale?: string;
  /** AbortSignal pour annuler une requête obsolète (debounce race). */
  signal?: AbortSignal;
}

// ── Fallback heuristique : continuations fréquentes FR/EN ───────────────────
// Map : derniers mots tapés (lowercase, sans accents/ponct) → suite proposée.
// Ordre = priorité (premier match gagne). Volontairement court & sûr.

interface FallbackRule {
  /** Regex testé sur la fin du draft normalisé (lowercase). */
  test: RegExp;
  /** Suite proposée (commence par un espace si on enchaîne un mot). */
  suggestion: string;
}

const FR_FALLBACKS: FallbackRule[] = [
  { test: /\bmerci\s*$/, suggestion: ' de votre message, je reviens vers vous rapidement.' },
  { test: /\bmerci de\s*$/, suggestion: ' votre message' },
  { test: /\bje reviens\s*$/, suggestion: ' vers vous rapidement' },
  { test: /\bje vous\s*$/, suggestion: ' reviens rapidement avec une réponse' },
  { test: /\bn'?hesitez\s*$/, suggestion: ' pas à me contacter pour toute question.' },
  { test: /\bnhesitez pas\s*$/, suggestion: ' à me contacter pour toute question.' },
  { test: /\bau plaisir\s*$/, suggestion: ' de vous lire' },
  { test: /\bbien recu\s*$/, suggestion: ', je m\'en occupe et reviens vers vous.' },
  { test: /\bbonjour\s*$/, suggestion: ', merci de votre message.' },
  { test: /\bje suis disponible\s*$/, suggestion: ' cette semaine pour un court appel.' },
  { test: /\best-?ce que\s*$/, suggestion: ' cet horaire vous conviendrait ?' },
  { test: /\bje vous remercie\s*$/, suggestion: ' pour votre patience' },
  { test: /\bje vous propose\s*$/, suggestion: ' un court appel de 15 minutes' },
];

const EN_FALLBACKS: FallbackRule[] = [
  { test: /\bthank you\s*$/, suggestion: ' for your message, I\'ll get back to you shortly.' },
  { test: /\bthanks\s*$/, suggestion: ' for reaching out!' },
  { test: /\bi'?ll get\s*$/, suggestion: ' back to you shortly' },
  { test: /\bi'?m available\s*$/, suggestion: ' this week for a quick call.' },
  { test: /\bplease\s*$/, suggestion: ' let me know if you have any questions.' },
  { test: /\blet me\s*$/, suggestion: ' know if you have any questions.' },
  { test: /\bfeel free\s*$/, suggestion: ' to reach out anytime.' },
  { test: /\blooking forward\s*$/, suggestion: ' to hearing from you' },
];

function normalizeTail(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/\s+/g, ' ');
}

function isEnglishish(s: string): boolean {
  // Heuristique grossière : présence de stop-words anglais fréquents.
  return /\b(the|you|your|please|thanks|thank|hello|hi|regards|i'?ll|i'?m)\b/i.test(s);
}

/**
 * Suggestion heuristique locale instant — zéro réseau.
 * Retourne '' si aucune règle ne matche (pas de ghost text affiché).
 */
export function localComposeFallback(draft: string, locale?: string): string {
  const trimmed = (draft || '').replace(/\s+$/, ' '); // garde 1 espace de fin si présent
  if (!trimmed.trim()) return '';
  const tail = normalizeTail(trimmed.slice(-60));

  const useEn = (locale || '').toLowerCase().startsWith('en') || isEnglishish(tail);
  const rules = useEn ? EN_FALLBACKS : FR_FALLBACKS;

  for (const rule of rules) {
    if (rule.test.test(tail)) return rule.suggestion;
  }
  return '';
}

// ── Backend fetch ───────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('intralys_token');
  } catch {
    return null;
  }
}

/**
 * Suggestion next-words via backend Claude Haiku (max 12 mots, low latency).
 * Retombe sur localComposeFallback() si offline / API KO / abort.
 *
 * Le résultat est nettoyé : pas de guillemets, pas de retour ligne,
 * cap dur à 12 mots côté client (défense en profondeur vs backend).
 */
export async function suggestCompose(args: ComposeSuggestArgs): Promise<string> {
  const draft = (args.currentDraft || '').trim();
  // Min 3 mots tapés — sinon pas assez de contexte, fallback local seul.
  const wordCount = draft ? draft.split(/\s+/).filter(Boolean).length : 0;
  if (wordCount < 3) return '';

  if (typeof fetch === 'undefined') {
    return localComposeFallback(args.currentDraft, args.locale);
  }

  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch('/api/ai/compose-suggest', {
      method: 'POST',
      headers,
      signal: args.signal,
      body: JSON.stringify({
        currentDraft: draft,
        conversationContext: args.conversationContext || '',
        locale: args.locale || 'fr-CA',
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { suggestion?: string } };
      const raw = (json.data?.suggestion || '').replace(/[\r\n]+/g, ' ').trim();
      const cleaned = raw.replace(/^["«»']+/, '').replace(/["«»']+$/, '');
      if (cleaned) {
        // Cap dur 12 mots
        const words = cleaned.split(/\s+/);
        const capped = words.slice(0, 12).join(' ');
        // Préserve un espace de jointure si le draft ne finit pas par un espace
        const needsLeadingSpace =
          !/\s$/.test(args.currentDraft) && !/^[\s.,;:!?'-]/.test(capped);
        return needsLeadingSpace ? ` ${capped}` : capped;
      }
    }
  } catch {
    /* abort ou réseau KO → fallback */
  }
  return localComposeFallback(args.currentDraft, args.locale);
}
