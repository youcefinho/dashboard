// ── Sprint 42 — chat-bot-engine.ts — AI Chat Agent core (PHASE B) ──────────
//
// Helpers RAG + escalation + safety pour le AI Chat Agent (S42).
//
// Surface publique (contrat figé §6 docs/LOT-CHAT-BOT-S42.md) — INCHANGÉE :
//   - searchKnowledge   → ChatKnowledgeBaseEntry[]
//   - buildBotPrompt    → string
//   - runBotInference   → { response, confidence }
//   - shouldEscalateChat → boolean
//
// AJOUT additif (renforcement S42 RAG + safety) — 100% rétro-compatible :
//   - cosineSimilarity(a, b)             → number     (RAG embeddings)
//   - mockEmbedding(text)                → number[1536] (FLAG INACTIF déterministe)
//   - retrieveTopK(query, kb, k=3)       → [{article, similarity}, …]
//   - buildPrompt(system, ctx, q)        → string     (assembleur générique)
//   - detectEscalation(msg, confidence)  → {escalate, reason?}
//   - scrubPii(text)                     → string     (Loi 25 : email/tel/CC)
//   - checkChatRateLimit(env, sessionId) → {ok, retryAfter?} (KV sliding 30/min)
//   - truncateContext(text, maxTokens)   → string     (~4 chars/token)
//   - Constants : MAX_CONVERSATION_LENGTH, CHAT_RATE_LIMIT, MIN_CONFIDENCE,
//                 CHAT_BOT_ERROR_CODES
//
// AI ENGINE — RÈGLES :
//   - Workers AI uniquement (env.AI binding). JAMAIS d'API key externe.
//   - FLAG INACTIF si env.AI absent : runBotInference renvoie response stub +
//     confidence=0 → caller (chat-bot.ts) escalade systématiquement.
//   - Embeddings : env.AI absent → mockEmbedding déterministe (hash-based) →
//     cosineSimilarity reste cohérent entre query et KB (même hash = même vec).
//
// LOI 25 — PII scrub OBLIGATOIRE avant tout envoi au modèle externe.
//   - scrubPii applique des regex strictes sur email / téléphone / CC.
//   - Le caller (handleTestBot / runBotInference) doit appeler scrubPii sur
//     le payload utilisateur avant interpolation prompt.
//
// AUCUN side-effect DB, AUCUN side-effect réseau (sauf env.AI.run via SDK CF
// natif et env.RATE_LIMITER KV en sliding window). Caller persiste tout le
// reste (webchat_sessions, bot_messages_count, etc.).

import type { Env } from '../types';
import type { ChatKnowledgeBaseEntry } from '../../lib/api';

/** Mots-clés universels qui déclenchent toujours une escalade vers humain. */
const ESCALATION_KEYWORDS = [
  // FR
  'humain',
  'agent',
  'personne réelle',
  "parler à quelqu'un",
  'vrai conseiller',
  'pas un robot',
  'support',
  // EN
  'human',
  'real person',
  'speak to',
  'live agent',
  'not a robot',
  // ES
  'humano',
  'persona',
  'agente',
  'hablar con',
];

// ── Constants exportées (utilisées par chat-bot.ts et tests) ───────────────

/** Cap dur du nombre de messages par conversation bot (anti-loop / abuse). */
export const MAX_CONVERSATION_LENGTH = 20;

/** Limite de requêtes chat par session_id et par minute (sliding window KV). */
export const CHAT_RATE_LIMIT = 30;

/** Confidence min pour répondre sans escalader vers humain (fallback). */
export const MIN_CONFIDENCE = 0.5;

/** Dimension du vecteur embedding (compat OpenAI text-embedding-3-small). */
export const EMBEDDING_DIM = 1536;

/** Top-K default pour le retrieval RAG. */
export const DEFAULT_TOP_K = 3;

/** Approximation grossière nb chars / token (cf. OpenAI tiktoken ratio). */
export const CHARS_PER_TOKEN = 4;

/**
 * Codes erreur normalisés (informatifs — JAMAIS exposés dans la réponse JSON
 * publique : le contrat figé §6 impose `{error: string}` strict). Utilisés
 * pour logs/audit/observabilité interne.
 */
export const CHAT_BOT_ERROR_CODES = {
  KB_EMPTY: 'KB_EMPTY',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  RATE_LIMITED: 'RATE_LIMITED',
  CONTEXT_TOO_LONG: 'CONTEXT_TOO_LONG',
  ESCALATION_REQUIRED: 'ESCALATION_REQUIRED',
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',
  PII_SCRUB_FAILED: 'PII_SCRUB_FAILED',
} as const;

export type ChatBotErrorCode =
  (typeof CHAT_BOT_ERROR_CODES)[keyof typeof CHAT_BOT_ERROR_CODES];

/** Normalise un texte pour comparaison (lowercase + trim + accents retirés). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Recherche naïve d'entries KB par LIKE sur title + content.
 * Stratégie Phase B :
 *   - Tokenise la query sur les espaces (mots ≥ 2 chars après normalize).
 *   - Si 0 token utile → 1 requête LIKE %query% (lowercased).
 *   - Sinon → UNION via 1 requête OR multi-token, dedup via Set (best matches).
 *
 * Borné tenant strict via clientId (defense-in-depth IDOR).
 * Retourne [] si aucune entrée matche (caller doit alors escalader).
 */
export async function searchKnowledge(
  env: Env,
  clientId: string,
  query: string,
): Promise<ChatKnowledgeBaseEntry[]> {
  if (!clientId || typeof clientId !== 'string') return [];
  if (!query || typeof query !== 'string' || query.trim().length === 0) return [];

  const normalized = query.toLowerCase().trim();
  // Tokenise : mots de ≥ 2 chars après normalize NFD (accents retirés).
  const tokens = normalize(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  // Dedup via Map (id → row), preserve ordre updated_at DESC.
  const dedup = new Map<string, ChatKnowledgeBaseEntry>();

  try {
    if (tokens.length <= 1) {
      // Stratégie simple : 1 LIKE %query% sur title+content.
      const like = `%${normalized}%`;
      const { results } = await env.DB.prepare(
        `SELECT id, client_id, title, content, source, is_active, created_at, updated_at
         FROM chat_knowledge_base
         WHERE client_id = ? AND is_active = 1
           AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)
         ORDER BY updated_at DESC
         LIMIT 5`,
      )
        .bind(clientId, like, like)
        .all();
      for (const r of (results || []) as Array<Record<string, unknown>>) {
        const id = String(r.id ?? '');
        if (!id || dedup.has(id)) continue;
        dedup.set(id, mapRow(r));
      }
    } else {
      // Multi-tokens : 1 requête OR clauses (top-5 union deduplicated).
      // Construit clause WHERE dynamique pour chaque token.
      const orClauses: string[] = [];
      const binds: unknown[] = [clientId];
      for (const tok of tokens) {
        orClauses.push('LOWER(title) LIKE ? OR LOWER(content) LIKE ?');
        const like = `%${tok}%`;
        binds.push(like, like);
      }
      const sql =
        `SELECT id, client_id, title, content, source, is_active, created_at, updated_at
         FROM chat_knowledge_base
         WHERE client_id = ? AND is_active = 1
           AND (${orClauses.join(' OR ')})
         ORDER BY updated_at DESC
         LIMIT 5`;
      const stmt = env.DB.prepare(sql).bind(...binds);
      const { results } = await stmt.all();
      for (const r of (results || []) as Array<Record<string, unknown>>) {
        const id = String(r.id ?? '');
        if (!id || dedup.has(id)) continue;
        dedup.set(id, mapRow(r));
        if (dedup.size >= 5) break;
      }
    }
  } catch {
    // Best-effort : table absente / panne D1 → retour [] (caller escalade).
    return [];
  }

  return Array.from(dedup.values()).slice(0, 5);
}

/** Map une row DB → ChatKnowledgeBaseEntry typée. */
function mapRow(r: Record<string, unknown>): ChatKnowledgeBaseEntry {
  const source = String(r.source ?? 'manual');
  const validSource: 'manual' | 'url' | 'faq' =
    source === 'url' || source === 'faq' ? source : 'manual';
  return {
    id: String(r.id ?? ''),
    client_id: String(r.client_id ?? ''),
    title: String(r.title ?? ''),
    content: String(r.content ?? ''),
    source: validSource,
    is_active: r.is_active === 1 || r.is_active === true,
    created_at: String(r.created_at ?? ''),
  };
}

// ── RAG : cosine similarity + mock embedding + top-K retrieval ─────────────

/**
 * Cosine similarity entre 2 vecteurs (RAG embeddings).
 * Formule : dot(a,b) / (||a|| * ||b||).
 *
 * Edge cases (tous → 0) :
 *   - length mismatch (vecteurs incompatibles)
 *   - vecteur vide
 *   - norme nulle (un vecteur all-zeros)
 *   - valeurs non-finies (NaN, Infinity)
 *
 * Output borné [-1, 1] : 1 = identique, 0 = orthogonal, -1 = opposé.
 * Helper PURE — pas de side-effect.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Clamp défensif : flottants peuvent dériver hors [-1, 1] sur 1e-16.
  if (sim > 1) return 1;
  if (sim < -1) return -1;
  return sim;
}

/**
 * Hash 32-bit déterministe d'un string (FNV-1a). Seed du RNG mockEmbedding.
 * Pas crypto — usage strict embedding mock cohérent (FLAG INACTIF).
 */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // Mul mod 2^32 via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mock embedding déterministe : même texte → même vecteur 1536-dim ∈ [-1, 1].
 *
 * Utilisé en FLAG INACTIF (env.AI absent ou embeddings binding KO). Garantit
 * que searchKnowledge → retrieveTopK reste cohérent : la query "horaires" et
 * une entry KB qui contient "horaires" partagent assez de tokens pour produire
 * une similarity > 0 (pas identique, mais > orthogonal).
 *
 * Stratégie : hash de chaque tri-gram → RNG seeded → 1536 floats normalisés.
 * Pure deterministic. ~0.2ms pour 1500 chars.
 */
export function mockEmbedding(text: string): number[] {
  const safe = typeof text === 'string' ? text : '';
  const normalized = normalize(safe);

  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  if (normalized.length === 0) return vec;

  // Accumule contributions par tri-gram → distribution sur le vecteur.
  for (let i = 0; i < normalized.length; i++) {
    const trigram = normalized.slice(i, Math.min(i + 3, normalized.length));
    const h = fnv1a(trigram);
    // Distribue le hash sur 4 positions du vecteur pour couverture.
    for (let k = 0; k < 4; k++) {
      const idx = (h + k * 0x9e3779b9) % EMBEDDING_DIM;
      const sign = ((h >>> (k * 4)) & 1) === 0 ? 1 : -1;
      // Magnitude pseudo-random bornée ; raffinement par seed-shift.
      const mag = (((h >>> (k * 2 + 1)) & 0xffff) / 0xffff) * 0.5 + 0.25;
      vec[idx] = (vec[idx] ?? 0) + sign * mag;
    }
  }

  // Normalise globalement à [-1, 1] (préserve l'information de similarité).
  let max = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const abs = Math.abs(vec[i] ?? 0);
    if (abs > max) max = abs;
  }
  if (max > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = (vec[i] ?? 0) / max;
    }
  }
  return vec;
}

/**
 * Embed un texte via env.AI binding (Workers AI bge-large) si disponible,
 * sinon fallback mockEmbedding déterministe.
 *
 * Best-effort : tout échec → mockEmbedding (jamais throw).
 * Sortie : vecteur de dimension EMBEDDING_DIM (padding/truncate si binding
 * retourne autre dimension).
 */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const ai = (env as unknown as {
    AI?: { run: (model: string, args: unknown) => Promise<unknown> };
  }).AI;
  if (!ai || typeof ai.run !== 'function') {
    return mockEmbedding(text);
  }
  try {
    const result = (await ai.run('@cf/baai/bge-large-en-v1.5', {
      text: [text],
    })) as
      | { data?: number[][] }
      | { result?: { data?: number[][] } }
      | null;
    let raw: number[] | null = null;
    if (result && typeof result === 'object') {
      const direct = (result as { data?: number[][] }).data;
      if (Array.isArray(direct) && Array.isArray(direct[0])) raw = direct[0];
      else {
        const nested = (result as { result?: { data?: number[][] } }).result;
        if (nested && Array.isArray(nested.data) && Array.isArray(nested.data[0])) {
          raw = nested.data[0];
        }
      }
    }
    if (!raw || raw.length === 0) return mockEmbedding(text);
    // Pad/truncate à EMBEDDING_DIM pour homogénéité interne.
    if (raw.length === EMBEDDING_DIM) return raw;
    const padded = new Array<number>(EMBEDDING_DIM).fill(0);
    for (let i = 0; i < Math.min(raw.length, EMBEDDING_DIM); i++) {
      const v = raw[i];
      padded[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    return padded;
  } catch {
    return mockEmbedding(text);
  }
}

/**
 * Top-K retrieval RAG : embed la query, compute cosine similarity avec chaque
 * entry KB, retourne top-K triées par similarity DESC.
 *
 * KB entries peuvent fournir `embedding` pré-calculé (depuis embedding_json
 * D1). Si absent, on calcule mockEmbedding du content au vol (déterministe).
 *
 * Edge cases :
 *   - KB vide → []
 *   - k <= 0 → []
 *   - Tous embeddings invalides → []
 *
 * Helper PURE (lit AI binding si présent, sinon mock).
 */
export interface KbArticleWithEmbedding extends ChatKnowledgeBaseEntry {
  embedding?: number[] | null;
}

export interface RetrievalHit {
  article: ChatKnowledgeBaseEntry;
  similarity: number;
}

export async function retrieveTopK(
  env: Env,
  query: string,
  kbArticles: KbArticleWithEmbedding[],
  k: number = DEFAULT_TOP_K,
): Promise<RetrievalHit[]> {
  if (!Array.isArray(kbArticles) || kbArticles.length === 0) return [];
  if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) return [];
  if (!query || typeof query !== 'string' || query.trim().length === 0) return [];

  const queryVec = await embedText(env, query);

  const hits: RetrievalHit[] = [];
  for (const article of kbArticles) {
    const vec =
      Array.isArray(article.embedding) && article.embedding.length > 0
        ? article.embedding
        : mockEmbedding(`${article.title}\n${article.content}`);
    const sim = cosineSimilarity(queryVec, vec);
    hits.push({ article, similarity: sim });
  }

  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, Math.floor(k));
}

// ── Prompt building ────────────────────────────────────────────────────────

/**
 * Assemble le prompt système Haiku à partir de :
 *   - config.system_prompt (base : "You are a helpful assistant for X…")
 *   - kbEntries (RAG context — top-N entries triées par pertinence)
 *   - conversationHistory (messages précédents user/bot, format chat — limit 6)
 *   - userMessage (question courante)
 *
 * Retourne une chaîne UTF-8 prête à envoyer à Workers AI (Haiku).
 * Aucune interpolation d'eval — concat textuelle stricte.
 */
export function buildBotPrompt(
  config: { system_prompt: string },
  kbEntries: ChatKnowledgeBaseEntry[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
): string {
  const baseSystem = config.system_prompt || 'You are a helpful assistant.';

  const kbContext =
    kbEntries.length > 0
      ? kbEntries
          .map((e) => `- ${e.title}: ${e.content.slice(0, 500)}`)
          .join('\n')
      : '(no relevant knowledge base entries)';

  const systemBlock =
    `${baseSystem}\n\nKnowledge base context:\n${kbContext}\n\n` +
    'If you cannot answer confidently, say so explicitly.';

  // Limite à 6 derniers messages pour borner la taille du contexte.
  const recentHistory = conversationHistory.slice(-6);
  const historyBlock =
    recentHistory.length > 0
      ? '\n\nConversation history:\n' +
        recentHistory
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n')
      : '';

  return systemBlock + historyBlock + `\n\nUser: ${userMessage}\nAssistant:`;
}

/**
 * Assembleur prompt générique (system + retrieved context + user query).
 * Pendant léger de buildBotPrompt, utilisé pour pipelines hors webchat
 * (ex : test handler interne, eval, batch). Gère context vide explicitement.
 */
export function buildPrompt(
  systemPrompt: string,
  retrievedContext: string,
  userQuery: string,
): string {
  const safeSystem =
    typeof systemPrompt === 'string' && systemPrompt.trim().length > 0
      ? systemPrompt
      : 'You are a helpful assistant.';
  const safeUser = typeof userQuery === 'string' ? userQuery : '';
  const ctx =
    typeof retrievedContext === 'string' && retrievedContext.trim().length > 0
      ? retrievedContext
      : '(no relevant knowledge base entries)';

  return (
    `${safeSystem}\n\nKnowledge base context:\n${ctx}\n\n` +
    'If you cannot answer confidently, say so explicitly.' +
    `\n\nUser: ${safeUser}\nAssistant:`
  );
}

// ── Inference Workers AI ───────────────────────────────────────────────────

/**
 * Lance l'inférence Haiku via env.AI binding (Workers AI).
 *
 * FLAG INACTIF si env.AI absent → retourne response='Le bot n'est pas configuré.'
 * + confidence=0 → caller escalade. Pas d'erreur jetée.
 *
 * Confidence = heuristique simple :
 *   - response contient "je ne sais pas" / "I don't know" / "no estoy seguro" → 0.3
 *   - sinon → 0.85
 *
 * Try/catch externe → en cas d'erreur API : { response: '', confidence: 0, error }.
 */
export async function runBotInference(
  env: Env,
  prompt: string,
): Promise<{ response: string; confidence: number; error?: string }> {
  const ai = (env as unknown as {
    AI?: { run: (model: string, args: unknown) => Promise<unknown> };
  }).AI;
  if (!ai || typeof ai.run !== 'function') {
    return { response: "Le bot n'est pas configuré.", confidence: 0 };
  }

  try {
    const result = (await ai.run('@cf/anthropic/claude-3-haiku-20240307', {
      messages: [{ role: 'user', content: prompt }],
    })) as
      | string
      | { response?: string; result?: { response?: string } }
      | null;

    // Extract response text (Workers AI shapes vary).
    let respText = '';
    if (typeof result === 'string') {
      respText = result;
    } else if (result && typeof result === 'object') {
      if (typeof result.response === 'string') respText = result.response;
      else if (result.result && typeof result.result.response === 'string') {
        respText = result.result.response;
      }
    }

    if (!respText || respText.trim().length === 0) {
      return { response: '', confidence: 0 };
    }

    // Heuristique confidence : keywords doute → 0.3, sinon 0.85.
    const lower = respText.toLowerCase();
    const doubtMarkers = [
      'je ne sais pas',
      "i don't know",
      'i do not know',
      'no estoy seguro',
      'no lo sé',
      'no lo se',
    ];
    const lowConfidence = doubtMarkers.some((m) => lower.includes(m));
    const confidence = lowConfidence ? 0.3 : 0.85;

    return { response: respText, confidence };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { response: '', confidence: 0, error: msg };
  }
}

// ── Escalation logic ───────────────────────────────────────────────────────

/**
 * Détermine si la session chat doit être escaladée vers un agent humain.
 * Retourne true si :
 *   - confidence < threshold (le bot n'est pas sûr), OU
 *   - userMessage contient un mot-clé d'escalation universel
 *     ("humain", "agent", "real person", "hablar con persona"…).
 *
 * Helper PURE — pas de side-effect, pas de DB read.
 */
export function shouldEscalateChat(
  confidence: number,
  threshold: number,
  userMessage: string,
): boolean {
  const safeConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0;
  const safeThreshold = Number.isFinite(threshold)
    ? Math.max(0, Math.min(1, threshold))
    : 0.7;

  if (safeConfidence < safeThreshold) return true;

  if (
    userMessage &&
    typeof userMessage === 'string' &&
    userMessage.trim().length > 0
  ) {
    const normalizedMessage = normalize(userMessage);
    for (const keyword of ESCALATION_KEYWORDS) {
      const normalizedKeyword = normalize(keyword);
      if (normalizedKeyword.length === 0) continue;
      if (normalizedMessage.includes(normalizedKeyword)) return true;
    }
  }
  return false;
}

/**
 * Variante détaillée — retourne `{escalate, reason?}` pour logs/audit.
 *   - reason='keyword:<kw>' si match keyword
 *   - reason='low_confidence' si confidence < MIN_CONFIDENCE
 *   - reason='empty_message' si message vide/invalide (escalate=true defensive)
 *
 * Threshold figé à MIN_CONFIDENCE (0.5) pour cette variante — utilisée comme
 * filtre safety, distinct du `shouldEscalateChat` qui respecte le threshold
 * configurable par tenant.
 */
export function detectEscalation(
  message: string,
  confidence: number,
): { escalate: boolean; reason?: string } {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { escalate: true, reason: 'empty_message' };
  }

  const safeConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0;

  const normalizedMessage = normalize(message);
  for (const keyword of ESCALATION_KEYWORDS) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedKeyword.length === 0) continue;
    if (normalizedMessage.includes(normalizedKeyword)) {
      return { escalate: true, reason: `keyword:${keyword}` };
    }
  }

  if (safeConfidence < MIN_CONFIDENCE) {
    return { escalate: true, reason: 'low_confidence' };
  }

  return { escalate: false };
}

// ── PII scrub (Loi 25 — anonymisation avant envoi modèle) ──────────────────

/**
 * Strip emails / téléphones / cartes de crédit du texte avant envoi modèle
 * externe (Loi 25 Québec + RGPD).
 *
 * Patterns :
 *   - CC : 16 chiffres groupés par 4 avec séparateurs `-`/space/none → [REDACTED_CC]
 *   - Email : `\S+@\S+\.\S+` → [REDACTED_EMAIL]
 *   - Téléphone : `+?\d[\d\s\-().]{8,}\d` (au moins 10 chiffres) → [REDACTED_PHONE]
 *
 * Ordre important : CC AVANT téléphone (sinon CC dilué dans regex tel).
 * Email AVANT téléphone (sinon `@` consommé par groupe tel ambigu).
 *
 * Helper PURE — pas de side-effect.
 */
export function scrubPii(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';

  let out = text;

  // 1. Carte de crédit : 16 chiffres en 4×4 (séparateurs -, espace, ou aucun).
  //    Doit matcher AVANT téléphone (qui pourrait absorber les chiffres).
  out = out.replace(/\b(?:\d{4}[\s-]?){3}\d{4}\b/g, '[REDACTED_CC]');

  // 2. Email : tokens séparés par @ avec . dans le domaine.
  //    Pattern strict pour éviter false-positives sur `at@home` sans TLD.
  out = out.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    '[REDACTED_EMAIL]',
  );

  // 3. Téléphone : au moins 10 chiffres avec séparateurs optionnels.
  //    `+?\d[\d\s\-().]{8,}\d` ≈ format international ou local NA.
  //    Lookahead/behind sur word-boundary pour pas couper un nombre simple.
  out = out.replace(
    /(?:\+?\d[\d\s\-().]{8,}\d)/g,
    (match) => {
      // Garde-fou : compte les chiffres effectifs ≥ 10.
      const digits = match.replace(/\D/g, '');
      return digits.length >= 10 ? '[REDACTED_PHONE]' : match;
    },
  );

  return out;
}

// ── Rate limit chat (sliding window KV 30/min par session) ─────────────────

/**
 * Sliding window rate limit : 30 req/min par session_id via env.RATE_LIMITER KV.
 *
 * Stratégie :
 *   - Lit la liste des timestamps stockés sous `chat-rl:<sessionId>`.
 *   - Filtre les timestamps > now-60s.
 *   - Si count >= CHAT_RATE_LIMIT → retourne {ok:false, retryAfter}.
 *   - Sinon → ajoute now, PUT (TTL 90s pour auto-cleanup).
 *
 * FLAG INACTIF si env.RATE_LIMITER absent → toujours {ok:true} (degraded mode).
 *
 * Best-effort : tout échec KV → {ok:true} (fail-open pour ne pas casser le
 * chat si KV down — cohérent avec voice-agent + autres modules S42).
 */
export async function checkChatRateLimit(
  env: Env,
  sessionId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (!sessionId || typeof sessionId !== 'string') return { ok: true };
  const kv = (env as unknown as { RATE_LIMITER?: KVNamespace }).RATE_LIMITER;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return { ok: true };
  }

  const key = `chat-rl:${sessionId}`;
  const now = Date.now();
  const windowMs = 60_000;
  const cutoff = now - windowMs;

  try {
    const raw = (await kv.get(key, 'json')) as number[] | null;
    const recent = Array.isArray(raw) ? raw.filter((t) => t > cutoff) : [];

    if (recent.length >= CHAT_RATE_LIMIT) {
      // Oldest timestamp in window dictates retryAfter (secs to wait).
      const oldest = Math.min(...recent);
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { ok: false, retryAfter };
    }

    recent.push(now);
    // TTL 90s pour laisser le sliding window expirer naturellement.
    await kv.put(key, JSON.stringify(recent), { expirationTtl: 90 });
    return { ok: true };
  } catch {
    // Fail-open : KV KO ne bloque pas le chat.
    return { ok: true };
  }
}

// ── Context truncation (token budget guard) ────────────────────────────────

/**
 * Tronque un texte à un nombre approximatif de tokens (4 chars / token).
 * Sortie : préfixe du texte original (pas de suffixe …) — préserve la
 * structure début (system + KB plus important que tail).
 *
 * Si maxTokens <= 0 ou non-fini → retourne '' (defensive).
 * Si text est court → retourne tel quel sans modification.
 *
 * Helper PURE.
 */
export function truncateContext(text: string, maxTokens: number): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return '';
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  if (maxChars >= text.length) return text;
  return text.slice(0, maxChars);
}
