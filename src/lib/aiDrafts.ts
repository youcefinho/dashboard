// ── aiDrafts — Sprint 32 vague 32-2A / Sprint 43 M3.3 backend ────────────────
// 3 brouillons de réponse (short / detailed / awaiting).
//
// Sprint 43 M3.3 : bascule POST /api/ai/drafts (Claude Haiku 4.5 backend).
// Heuristiques locales conservées en fallback (offline / dev / API rate limit).
//
// API publique 100% back-compat :
//   - generateDrafts(lastMessage, leadCtx?): DraftOption[]              (sync — heuristique locale, instant UX)
//   - generateDraftsAsync(lastMessage, leadCtx?): Promise<DraftOption[]>  (nouveau — backend Claude Haiku 4.5)
//   - DRAFT_TONE_LABELS

export type DraftTone = 'short' | 'detailed' | 'awaiting';

export interface DraftOption {
  id: string;
  title: string;
  body: string;
  tone: DraftTone;
}

export interface DraftLeadCtx {
  /** ID du lead — utilisé par le backend pour charger contexte (status, source, brand_voice) */
  id?: string | null;
  /** Prénom ou nom complet du lead — utilisé dans la salutation détaillée */
  name?: string | null;
  /** Étape pipeline (ex: "Qualification") — mentionnée dans draft détaillé */
  stage?: string | null;
  /** Historique récent (6 derniers messages max envoyés au backend) */
  conversationContext?: string[];
  /**
   * Sprint 49 M1.4 — langue cible de la réponse (locale i18n : 'en' / 'es' / 'fr-CA').
   * Si fourni, le backend rédige les brouillons dans cette langue (multi-lingue).
   */
  targetLang?: string;
}

// ── Helpers internes ──────────────────────────────────────────────────────

function firstName(name?: string | null): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  return parts[0] ?? '';
}

function hasQuestion(msg: string): boolean {
  return /[?？]/.test(msg);
}

function inferTopic(msg: string): string {
  const cleaned = msg
    .replace(/[\n\r]+/g, ' ')
    .replace(/[?!.,;:]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return 'votre demande';
  const STOP = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'à', 'au', 'aux', 'en', 'sur', 'pour', 'par', 'avec', 'mais', 'donc', 'car', 'que', 'qui', 'quoi', 'est', 'sont', 'bonjour', 'allo', 'salut', 'hi', 'hello']);
  const words = cleaned.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return words.slice(0, 4).join(' ') || 'votre demande';
}

// ── Backend fetch ───────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem('intralys_token'); } catch { return null; }
}

async function fetchBackend(input: string, init?: RequestInit): Promise<Response | null> {
  if (typeof fetch === 'undefined') return null;
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    return await fetch(input, { ...init, headers });
  } catch {
    return null;
  }
}

// ── API publique ──────────────────────────────────────────────────────────

/**
 * Heuristique locale instant — 3 brouillons sync sans appel réseau.
 * Préserve compat Sprint 32 (UX instant fallback offline).
 */
export function generateDrafts(
  lastMessage: string,
  leadCtx?: DraftLeadCtx,
): DraftOption[] {
  const msg = (lastMessage || '').trim();
  const fname = firstName(leadCtx?.name);
  const greeting = fname ? `Bonjour ${fname},` : 'Bonjour,';
  const topic = inferTopic(msg);
  const isQuestion = hasQuestion(msg);
  const stage = leadCtx?.stage?.trim();

  const shortBody = isQuestion
    ? `Merci pour votre question ! Je regarde ça et je reviens vers vous d'ici la fin de journée. Est-ce que cet horaire vous convient ?`
    : `Bien reçu, merci ! Je m'en occupe et reviens vers vous rapidement. Avez-vous une date butoir précise en tête ?`;

  const stageMention = stage
    ? ` Vous êtes actuellement à l'étape « ${stage} » de notre suivi`
    : '';
  const detailedBody = `${greeting}

Merci pour votre message concernant ${topic}.${stageMention}${stage ? ', et' : ' Et'} je tiens à m'assurer qu'on avance ensemble dans la bonne direction.

Je vais regarder en détail les éléments que vous mentionnez et je vous reviens avec une réponse complète aujourd'hui ou demain matin au plus tard. Si entre-temps vous avez d'autres précisions à partager, n'hésitez surtout pas.

Au plaisir,`;

  const awaitingBody = `${greeting}

Merci pour votre retour ! Pour vous proposer la meilleure réponse, j'aurais besoin de quelques précisions supplémentaires sur ${topic}.

Est-ce qu'un court appel de 15 minutes cette semaine vous conviendrait ? Ça nous permettrait de cadrer les choses rapidement. Sinon, vous pouvez aussi me répondre par écrit, ce qui vous arrange.

Merci d'avance,`;

  return [
    {
      id: 'draft-short',
      tone: 'short',
      title: 'Courte & directe',
      body: shortBody,
    },
    {
      id: 'draft-detailed',
      tone: 'detailed',
      title: 'Détaillée & professionnelle',
      body: detailedBody,
    },
    {
      id: 'draft-awaiting',
      tone: 'awaiting',
      title: 'En attente d\'info — propose call',
      body: awaitingBody,
    },
  ];
}

/**
 * Backend Claude Haiku 4.5 — 3 brouillons générés en parallèle worker-side.
 * Retombe sur generateDrafts() local si backend KO / offline / 4xx-5xx.
 *
 * Recommandation UX : afficher generateDrafts() immédiatement, puis remplacer
 * par generateDraftsAsync() quand la promesse résout (typiquement 1-3s).
 */
export async function generateDraftsAsync(
  lastMessage: string,
  leadCtx?: DraftLeadCtx,
): Promise<DraftOption[]> {
  const msg = (lastMessage || '').trim();
  if (!msg) return generateDrafts(lastMessage, leadCtx);

  const payload = {
    lead_id: leadCtx?.id || undefined,
    last_message: msg,
    conversation_context: leadCtx?.conversationContext || [],
    tones: ['short', 'detailed', 'awaiting'] as DraftTone[],
    // Sprint 49 M1.4 — langue cible (multi-lingue reply)
    target_lang: leadCtx?.targetLang || undefined,
  };

  const res = await fetchBackend('/api/ai/drafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (res && res.ok) {
    try {
      const json = await res.json() as { data?: { drafts?: DraftOption[] } };
      const drafts = json.data?.drafts;
      if (Array.isArray(drafts) && drafts.length > 0) {
        return drafts;
      }
    } catch { /* fallback */ }
  }
  // Fallback heuristique locale
  return generateDrafts(lastMessage, leadCtx);
}

/** Libellé court d'un tone (chip color-coded). */
export const DRAFT_TONE_LABELS: Record<DraftTone, string> = {
  short: 'Concis',
  detailed: 'Détaillé',
  awaiting: 'Clarifier',
};
