// ── Sprint 42 — chat-bot.ts — Handlers REST AI Chat Agent (PHASE B) ─────────
// 7 handlers : 4 CRUD knowledge base + 2 config (get/upsert) + 1 test.
// Routes câblées dans worker.ts dans le bloc protected AUTHED (après bloc S41
// voice-agent ~l.3115, AVANT bloc Sprint 23 sécurité ~l.3117).
// Ordre anti-shadowing strict : /knowledge/:id AVANT /knowledge collection,
// /config seul, /test seul.
//
// Contrats GELÉS (docs/LOT-CHAT-BOT-S42.md §6) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability `settings.manage` (FIGÉE seq80) au top de chaque handler.
// resolveClientId() = calque voice-agent.ts:32 + chat-widgets.ts:26.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import type { ChatKnowledgeBaseEntry } from '../lib/api';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import {
  searchKnowledge,
  buildBotPrompt,
  runBotInference,
  shouldEscalateChat,
  // S42 renforcement (additif) — RAG + safety wire-up
  scrubPii,
  retrieveTopK,
  buildPrompt,
  detectEscalation,
  checkChatRateLimit,
  embedText,
  truncateContext,
  CHAT_BOT_ERROR_CODES,
  type KbArticleWithEmbedding,
} from './lib/chat-bot-engine';

type ChatBotAuth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout le client_id du tenant courant (calque voice-agent.ts:32). */
async function resolveClientId(
  env: Env,
  auth: ChatBotAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Whitelist des sources KB (validation HANDLER, pas de CHECK SQL). */
const VALID_SOURCES = new Set(['manual', 'url', 'faq']);

/** Default system prompt si tenant n'a pas encore configuré. */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_ESCALATION_MSG = 'Un agent va vous répondre sous peu.';
const DEFAULT_MAX_MSG = 20;

/** Normalise une row KB → objet API typé. */
function mapKbRow(row: Record<string, unknown>): Record<string, unknown> {
  const source = String(row.source ?? 'manual');
  return {
    id: String(row.id ?? ''),
    client_id: String(row.client_id ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    source: VALID_SOURCES.has(source) ? source : 'manual',
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/** Normalise une row config bot → objet API typé. */
function mapConfigRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id ?? ''),
    client_id: String(row.client_id ?? ''),
    widget_id: row.widget_id == null ? null : String(row.widget_id),
    system_prompt: String(row.system_prompt ?? DEFAULT_SYSTEM_PROMPT),
    confidence_threshold:
      typeof row.confidence_threshold === 'number'
        ? row.confidence_threshold
        : DEFAULT_THRESHOLD,
    escalation_message: String(row.escalation_message ?? DEFAULT_ESCALATION_MSG),
    enabled: row.enabled === 1 || row.enabled === true,
    max_messages_per_session:
      typeof row.max_messages_per_session === 'number'
        ? row.max_messages_per_session
        : DEFAULT_MAX_MSG,
  };
}

// ── 4 handlers CRUD knowledge base ─────────────────────────────────────────

/** GET /api/chat-bot/knowledge — liste KB entries du tenant courant. */
export async function handleListKnowledge(
  env: Env,
  auth: ChatBotAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, title, content, source, is_active, created_at, updated_at
       FROM chat_knowledge_base
       WHERE client_id = ?
       ORDER BY updated_at DESC`,
    )
      .bind(clientId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapKbRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/chat-bot/knowledge — créer une KB entry. */
export async function handleCreateKnowledge(
  request: Request,
  env: Env,
  auth: ChatBotAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const title = sanitizeInput(
      typeof body.title === 'string' ? body.title : '',
      200,
    );
    if (!title) {
      return json({ error: 'Le titre est requis' }, 400);
    }

    const content =
      typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return json({ error: 'Le contenu est requis' }, 400);
    }

    const sourceRaw =
      typeof body.source === 'string' && body.source.length > 0
        ? body.source
        : 'manual';
    if (!VALID_SOURCES.has(sourceRaw)) {
      return json(
        { error: 'source invalide (valeurs : manual|url|faq)' },
        400,
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Generate embedding for RAG retrieval (Workers AI bge-large or mockEmbedding
    // fallback). Best-effort : tout échec → '[]' (caller retombe sur LIKE
    // search + mockEmbedding au vol côté retrieveTopK).
    let embeddingJson = '[]';
    try {
      const vec = await embedText(env, `${title}\n${content}`);
      if (Array.isArray(vec) && vec.length > 0) {
        embeddingJson = JSON.stringify(vec);
      }
    } catch {
      // CHAT_BOT_ERROR_CODES.EMBEDDING_FAILED — silently fallback to '[]'.
    }

    await env.DB.prepare(
      `INSERT INTO chat_knowledge_base
         (id, client_id, title, content, source, is_active, created_at, updated_at, embedding_json)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(id, clientId, title, content, sourceRaw, now, now, embeddingJson)
      .run();

    await audit(env, auth.userId, 'create', 'chat_knowledge_base', id, {
      title,
      source: sourceRaw,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        title,
        content,
        source: sourceRaw,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/chat-bot/knowledge/:id — update partial d'une KB entry. */
export async function handleUpdateKnowledge(
  request: Request,
  env: Env,
  auth: ChatBotAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;
  if (!id || typeof id !== 'string') {
    return json({ error: 'id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Vérif appartenance tenant (defense-in-depth IDOR).
    const existing = (await env.DB.prepare(
      `SELECT id FROM chat_knowledge_base WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .first()) as { id: string } | null;
    if (!existing) {
      return json({ error: 'Entrée introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const updates: string[] = [];
    const binds: unknown[] = [];
    const patched: Record<string, unknown> = {};

    if (typeof body.title === 'string') {
      const title = sanitizeInput(body.title, 200);
      if (!title) {
        return json({ error: 'Le titre ne peut pas être vide' }, 400);
      }
      updates.push('title = ?');
      binds.push(title);
      patched.title = title;
    }

    if (typeof body.content === 'string') {
      const content = body.content.trim();
      if (!content) {
        return json({ error: 'Le contenu ne peut pas être vide' }, 400);
      }
      updates.push('content = ?');
      binds.push(content);
      patched.content = content;
    }

    if (typeof body.source === 'string') {
      if (!VALID_SOURCES.has(body.source)) {
        return json(
          { error: 'source invalide (valeurs : manual|url|faq)' },
          400,
        );
      }
      updates.push('source = ?');
      binds.push(body.source);
      patched.source = body.source;
    }

    if (typeof body.is_active === 'boolean') {
      updates.push('is_active = ?');
      binds.push(body.is_active ? 1 : 0);
      patched.is_active = body.is_active;
    }

    if (updates.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    // Si title OU content a changé → regen embedding RAG (best-effort).
    if (patched.title !== undefined || patched.content !== undefined) {
      try {
        // Lire valeurs courantes pour rebuild texte embedding.
        const current = (await env.DB.prepare(
          `SELECT title, content FROM chat_knowledge_base
           WHERE id = ? AND client_id = ? LIMIT 1`,
        )
          .bind(id, clientId)
          .first()) as { title?: string; content?: string } | null;

        const finalTitle = (patched.title as string | undefined) ?? current?.title ?? '';
        const finalContent =
          (patched.content as string | undefined) ?? current?.content ?? '';
        const vec = await embedText(env, `${finalTitle}\n${finalContent}`);
        const embeddingJson =
          Array.isArray(vec) && vec.length > 0 ? JSON.stringify(vec) : '[]';
        updates.push('embedding_json = ?');
        binds.push(embeddingJson);
      } catch {
        // CHAT_BOT_ERROR_CODES.EMBEDDING_FAILED — skip embedding update silencieusement.
      }
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    binds.push(now);

    // Bornage WHERE client_id + id strict.
    binds.push(id, clientId);
    await env.DB.prepare(
      `UPDATE chat_knowledge_base SET ${updates.join(', ')}
       WHERE id = ? AND client_id = ?`,
    )
      .bind(...binds)
      .run();

    await audit(env, auth.userId, 'update', 'chat_knowledge_base', id, patched);

    return json({
      data: {
        id,
        client_id: clientId,
        ...patched,
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** DELETE /api/chat-bot/knowledge/:id — soft-disable (is_active=0). */
export async function handleDeleteKnowledge(
  env: Env,
  auth: ChatBotAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;
  if (!id || typeof id !== 'string') {
    return json({ error: 'id invalide' }, 400);
  }

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const existing = (await env.DB.prepare(
      `SELECT id FROM chat_knowledge_base WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .first()) as { id: string } | null;
    if (!existing) {
      return json({ error: 'Entrée introuvable' }, 404);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE chat_knowledge_base
       SET is_active = 0, updated_at = ?
       WHERE id = ? AND client_id = ?`,
    )
      .bind(now, id, clientId)
      .run();

    await audit(env, auth.userId, 'delete', 'chat_knowledge_base', id, {
      soft: true,
    });

    return json({ data: { id, deleted: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 2 handlers config (get + upsert) ───────────────────────────────────────

/** GET /api/chat-bot/config — récupère la config bot du tenant (1 row). */
export async function handleGetConfig(
  env: Env,
  auth: ChatBotAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const existing = (await env.DB.prepare(
      `SELECT id, client_id, widget_id, system_prompt, confidence_threshold,
              escalation_message, enabled, max_messages_per_session,
              created_at, updated_at
       FROM chat_bot_config
       WHERE client_id = ?
       LIMIT 1`,
    )
      .bind(clientId)
      .first()) as Record<string, unknown> | null;

    if (existing) {
      return json({ data: mapConfigRow(existing) });
    }

    // Pas de config → INSERT ligne par défaut, puis return.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO chat_bot_config
         (id, client_id, widget_id, system_prompt, confidence_threshold,
          escalation_message, enabled, max_messages_per_session,
          created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        DEFAULT_SYSTEM_PROMPT,
        DEFAULT_THRESHOLD,
        DEFAULT_ESCALATION_MSG,
        DEFAULT_MAX_MSG,
        now,
        now,
      )
      .run();

    return json({
      data: {
        id,
        client_id: clientId,
        widget_id: null,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        confidence_threshold: DEFAULT_THRESHOLD,
        escalation_message: DEFAULT_ESCALATION_MSG,
        enabled: false,
        max_messages_per_session: DEFAULT_MAX_MSG,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * PUT /api/chat-bot/config — upsert config bot (1 row par tenant).
 * Stratégie : SELECT existing → si oui UPDATE, si non INSERT.
 */
export async function handleUpdateConfig(
  request: Request,
  env: Env,
  auth: ChatBotAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    // Validation partial des champs reçus.
    const patched: Record<string, unknown> = {};

    if (typeof body.system_prompt === 'string') {
      const sp = body.system_prompt.trim();
      if (!sp) {
        return json({ error: 'system_prompt ne peut pas être vide' }, 400);
      }
      if (sp.length > 5000) {
        return json({ error: 'system_prompt trop long (max 5000 chars)' }, 400);
      }
      patched.system_prompt = sp;
    }

    if (body.confidence_threshold !== undefined) {
      const ct = Number(body.confidence_threshold);
      if (!Number.isFinite(ct) || ct < 0 || ct > 1) {
        return json(
          { error: 'confidence_threshold doit être un nombre entre 0 et 1' },
          400,
        );
      }
      patched.confidence_threshold = ct;
    }

    if (typeof body.escalation_message === 'string') {
      const em = sanitizeInput(body.escalation_message, 500);
      if (!em) {
        return json({ error: 'escalation_message ne peut pas être vide' }, 400);
      }
      patched.escalation_message = em;
    }

    if (typeof body.enabled === 'boolean') {
      patched.enabled = body.enabled ? 1 : 0;
    }

    if (body.max_messages_per_session !== undefined) {
      const mm = Number(body.max_messages_per_session);
      if (!Number.isFinite(mm) || mm < 1 || mm > 1000 || !Number.isInteger(mm)) {
        return json(
          { error: 'max_messages_per_session doit être un entier entre 1 et 1000' },
          400,
        );
      }
      patched.max_messages_per_session = mm;
    }

    const now = new Date().toISOString();

    // SELECT existing pour décider INSERT vs UPDATE.
    const existing = (await env.DB.prepare(
      `SELECT id, client_id, widget_id, system_prompt, confidence_threshold,
              escalation_message, enabled, max_messages_per_session
       FROM chat_bot_config
       WHERE client_id = ?
       LIMIT 1`,
    )
      .bind(clientId)
      .first()) as Record<string, unknown> | null;

    if (existing) {
      // UPDATE bornée tenant.
      const updates: string[] = [];
      const binds: unknown[] = [];
      for (const [k, v] of Object.entries(patched)) {
        updates.push(`${k} = ?`);
        binds.push(v);
      }
      if (updates.length > 0) {
        updates.push('updated_at = ?');
        binds.push(now);
        binds.push(clientId);
        await env.DB.prepare(
          `UPDATE chat_bot_config SET ${updates.join(', ')}
           WHERE client_id = ?`,
        )
          .bind(...binds)
          .run();
      }

      const merged = {
        ...mapConfigRow(existing),
        ...(patched.system_prompt !== undefined
          ? { system_prompt: patched.system_prompt }
          : {}),
        ...(patched.confidence_threshold !== undefined
          ? { confidence_threshold: patched.confidence_threshold }
          : {}),
        ...(patched.escalation_message !== undefined
          ? { escalation_message: patched.escalation_message }
          : {}),
        ...(patched.enabled !== undefined
          ? { enabled: patched.enabled === 1 }
          : {}),
        ...(patched.max_messages_per_session !== undefined
          ? { max_messages_per_session: patched.max_messages_per_session }
          : {}),
      };

      await audit(
        env,
        auth.userId,
        'update',
        'chat_bot_config',
        String(existing.id ?? ''),
        patched,
      );

      return json({ data: merged });
    }

    // INSERT : ligne neuve avec defaults + valeurs patched.
    const id = crypto.randomUUID();
    const systemPrompt =
      (patched.system_prompt as string | undefined) ?? DEFAULT_SYSTEM_PROMPT;
    const threshold =
      (patched.confidence_threshold as number | undefined) ?? DEFAULT_THRESHOLD;
    const escalation =
      (patched.escalation_message as string | undefined) ?? DEFAULT_ESCALATION_MSG;
    const enabled = (patched.enabled as number | undefined) ?? 0;
    const maxMsg =
      (patched.max_messages_per_session as number | undefined) ?? DEFAULT_MAX_MSG;

    await env.DB.prepare(
      `INSERT INTO chat_bot_config
         (id, client_id, widget_id, system_prompt, confidence_threshold,
          escalation_message, enabled, max_messages_per_session,
          created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        systemPrompt,
        threshold,
        escalation,
        enabled,
        maxMsg,
        now,
        now,
      )
      .run();

    await audit(env, auth.userId, 'create', 'chat_bot_config', id, patched);

    return json({
      data: {
        id,
        client_id: clientId,
        widget_id: null,
        system_prompt: systemPrompt,
        confidence_threshold: threshold,
        escalation_message: escalation,
        enabled: enabled === 1,
        max_messages_per_session: maxMsg,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 1 handler test (prédiction sans persistance) ───────────────────────────

/**
 * POST /api/chat-bot/test — teste le bot avec un message échantillon.
 * Retourne la réponse prédite (response + confidence + would_escalate +
 * kb_matched) SANS persister webchat_sessions / bot_messages_count.
 *
 * S42 RENFORCEMENT pipeline (additif) :
 *   1. checkChatRateLimit     → 429 si > 30 req/min (CHAT_BOT_ERROR_CODES.RATE_LIMITED)
 *   2. scrubPii(userMessage)  → strip email/tel/CC AVANT envoi LLM (Loi 25)
 *   3. searchKnowledge        → DB pre-filter (LIKE) borné tenant
 *   4. retrieveTopK           → re-rank cosine top-3 sur résultats DB
 *   5. buildPrompt            → system + retrieved context + scrubbed query
 *   6. truncateContext        → cap ~3000 tokens (anti overflow)
 *   7. runBotInference        → Workers AI Haiku (ou flag INACTIF)
 *   8. detectEscalation       → escalation_required override response si match
 */
export async function handleTestBot(
  request: Request,
  env: Env,
  auth: ChatBotAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const message =
      typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return json({ error: 'message est requis' }, 400);
    }
    if (message.length > 4000) {
      return json({ error: 'message trop long (max 4000 chars)' }, 400);
    }

    // ── 1. Rate limit sliding window 30/min par session ────────────────────
    // En test handler : pas de webchat_session réel → on dérive un sessionId
    // stable depuis (clientId + userId). Permet de rate-limiter l'usage du
    // testeur par tenant sans toucher webchat_sessions.
    const testSessionId =
      typeof body.session_id === 'string' && body.session_id.length > 0
        ? body.session_id
        : `test:${clientId}:${auth.userId}`;
    const rl = await checkChatRateLimit(env, testSessionId);
    if (!rl.ok) {
      // Code interne stable pour observabilité (contrat figé §6 expose
      // `error` string ; on ajoute `code` + `retryAfter` en additif non-breaking).
      return json(
        {
          error: 'Trop de requêtes — réessayez dans quelques instants.',
          code: CHAT_BOT_ERROR_CODES.RATE_LIMITED,
          retryAfter: rl.retryAfter,
        },
        429,
      );
    }

    // Validation conversation_history (optionnel, array de {role, content}).
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (Array.isArray(body.conversation_history)) {
      for (const m of body.conversation_history) {
        if (
          m &&
          typeof m === 'object' &&
          !Array.isArray(m) &&
          (((m as { role?: unknown }).role === 'user') ||
            ((m as { role?: unknown }).role === 'assistant')) &&
          typeof (m as { content?: unknown }).content === 'string'
        ) {
          history.push({
            role: (m as { role: 'user' | 'assistant' }).role,
            content: String((m as { content: string }).content),
          });
        }
      }
    }

    // ── 2. PII scrub AVANT envoi LLM (Loi 25 Québec / RGPD) ────────────────
    const scrubbedMessage = scrubPii(message);
    const scrubbedHistory = history.map((h) => ({
      role: h.role,
      content: scrubPii(h.content),
    }));

    // Load config (best-effort : si pas trouvée → defaults).
    const configRow = (await env.DB.prepare(
      `SELECT id, client_id, widget_id, system_prompt, confidence_threshold,
              escalation_message, enabled, max_messages_per_session
       FROM chat_bot_config
       WHERE client_id = ?
       LIMIT 1`,
    )
      .bind(clientId)
      .first()) as Record<string, unknown> | null;

    const config = configRow
      ? mapConfigRow(configRow)
      : {
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          confidence_threshold: DEFAULT_THRESHOLD,
        };

    // ── 3. searchKnowledge (DB pre-filter LIKE) ────────────────────────────
    // Borné tenant strict. Si KB vide → retrieveTopK retournera [].
    const kbEntries = await searchKnowledge(env, clientId, scrubbedMessage);

    // ── 3b. Recherche RAG sur la FAQ générale (kb_embeddings) ───────────────
    let faqHits: Array<{ text_chunk: string; source_title: string; source_id: string; similarity: number }> = [];
    try {
      const { searchKbRag } = await import('./lib/kb-rag-engine');
      faqHits = await searchKbRag(env, clientId, scrubbedMessage, 3);
    } catch (err) {
      console.error('[RAG] Recherche RAG sur FAQ échouée:', err);
    }

    // ── 4. retrieveTopK (re-rank cosine top-3 sur résultats DB) ────────────
    // Lecture embedding_json depuis DB pour chaque entry retrouvée par LIKE.
    // OPTIMISATION : on ne lance retrieveTopK QUE si au moins une entry
    // possède un embedding stocké (sinon LIKE order suffit ; évite un appel
    // AI.run pour la query qui n'apporterait rien — toutes les entries
    // utiliseraient mockEmbedding au vol → re-ranking sans information).
    let topHits: Array<{ article: ChatKnowledgeBaseEntry; similarity: number }> = [];
    if (kbEntries.length > 0) {
      // Fetch embedding_json pour chaque entry trouvée (best-effort, 1 query).
      const ids = kbEntries.map((e) => e.id).filter((s) => s && s.length > 0);
      const placeholders = ids.map(() => '?').join(',');
      let embedMap = new Map<string, number[] | null>();
      let hasAnyEmbedding = false;
      if (ids.length > 0) {
        try {
          const { results } = await env.DB.prepare(
            `SELECT id, embedding_json FROM chat_knowledge_base
             WHERE client_id = ? AND id IN (${placeholders})`,
          )
            .bind(clientId, ...ids)
            .all();
          for (const r of (results || []) as Array<Record<string, unknown>>) {
            const rid = String(r.id ?? '');
            const raw = r.embedding_json;
            if (typeof raw === 'string' && raw.length > 0 && raw !== '[]') {
              try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  embedMap.set(rid, parsed as number[]);
                  hasAnyEmbedding = true;
                  continue;
                }
              } catch {
                /* parse fail → null */
              }
            }
            embedMap.set(rid, null);
          }
        } catch {
          // Best-effort : si colonne embedding_json absente (migration pas run)
          // → embedMap reste vide → on skip retrieveTopK (LIKE order conservé).
          embedMap = new Map();
          hasAnyEmbedding = false;
        }
      }
      if (hasAnyEmbedding) {
        const articlesWithEmbed: KbArticleWithEmbedding[] = kbEntries.map((e) => ({
          ...e,
          embedding: embedMap.get(e.id) ?? null,
        }));
        topHits = await retrieveTopK(env, scrubbedMessage, articlesWithEmbed, 3);
      }
    }

    // ── 5. buildPrompt (system + retrieved context + scrubbed query) ───────
    const systemPrompt = String(config.system_prompt ?? DEFAULT_SYSTEM_PROMPT);
    // Re-rank si retrieveTopK a fourni un ordre, sinon LIKE order (kbEntries).
    const orderedKb: ChatKnowledgeBaseEntry[] =
      topHits.length > 0 ? topHits.map((h) => h.article) : kbEntries;

    const retrievedContext =
      orderedKb.length > 0
        ? orderedKb
            .map((a) => `- ${a.title}: ${a.content.slice(0, 500)}`)
            .join('\n')
        : '';

    const retrievedFaqContext =
      faqHits.length > 0
        ? faqHits
            .map((h) => `- [FAQ] ${h.source_title}: ${h.text_chunk.slice(0, 500)}`)
            .join('\n')
        : '';

    // Concaténation des deux sources de connaissances
    const combinedContext = [retrievedContext, retrievedFaqContext]
      .filter((c) => c.trim().length > 0)
      .join('\n\n');

    // Conserve buildBotPrompt si on a un historique (signature retro-compat) ;
    // sinon utilise buildPrompt générique (plus simple, sans bloc history).
    let prompt: string;
    if (scrubbedHistory.length > 0) {
      // buildBotPrompt expose le bloc Conversation history.
      prompt = buildBotPrompt(
        { system_prompt: systemPrompt },
        orderedKb,
        scrubbedHistory,
        scrubbedMessage,
      );
      // Injection de la FAQ générale dans le prompt historique si dispo
      if (retrievedFaqContext) {
        prompt = prompt.replace('Knowledge base context:', `Knowledge base context:\n${retrievedFaqContext}\n`);
      }
    } else {
      prompt = buildPrompt(systemPrompt, combinedContext, scrubbedMessage);
    }

    // ── 6. truncateContext (cap ~3000 tokens / ~12000 chars) ───────────────
    prompt = truncateContext(prompt, 3000);

    // ── 7. runBotInference (Workers AI Haiku ou flag INACTIF) ──────────────
    const { response, confidence } = await runBotInference(env, prompt);

    // ── 8. detectEscalation (override response si match keyword/low conf) ──
    // detectEscalation = filtre safety (MIN_CONFIDENCE 0.5 figé) ; on l'utilise
    // pour bool escalation_required + reason.
    // shouldEscalateChat reste l'évaluation respectant le threshold tenant
    // (would_escalate exposé pour compat avec tests existants).
    const threshold =
      typeof config.confidence_threshold === 'number'
        ? config.confidence_threshold
        : DEFAULT_THRESHOLD;
    const wouldEscalate = shouldEscalateChat(confidence, threshold, scrubbedMessage);
    const escalation = detectEscalation(scrubbedMessage, confidence);

    return json({
      data: {
        response,
        confidence,
        would_escalate: wouldEscalate,
        kb_matched: kbEntries.length,
        // RAG enrichissement (additif, non-breaking) :
        kb_retrieved: topHits.length,
        faq_matched: faqHits.length,
        faq_hits: faqHits.map(h => ({
          title: h.source_title,
          chunk: h.text_chunk.slice(0, 100) + '...',
          score: h.similarity
        })),
        // Safety check
        escalation_required: escalation.escalate,
        ...(escalation.reason ? { escalation_reason: escalation.reason } : {}),
        // Loi 25 — annonce explicite que message a été scrubed avant LLM.
        pii_scrubbed: scrubbedMessage !== message,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * GET /api/chat-bot/sessions — Liste les sessions chatbot du tenant courant.
 */
export async function handleListChatbotSessions(
  env: Env,
  auth: ChatBotAuth
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'unauthorized' }, 401);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, session_token, is_active, confidence_avg, client_id, created_at, updated_at
       FROM chatbot_sessions
       WHERE client_id = ?
       ORDER BY updated_at DESC`
    ).bind(clientId).all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * PUT /api/chat-bot/sessions/:id — Active ou désactive (escalade) une session chatbot.
 */
export async function handleToggleChatbotSession(
  request: Request,
  env: Env,
  auth: ChatBotAuth,
  id: string
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'unauthorized' }, 401);
    }

    const body = await request.json() as { is_active?: number };
    const isActive = body.is_active === 1 ? 1 : 0;

    // Charger la session chatbot
    const chatbotSession = await env.DB.prepare(
      `SELECT session_token FROM chatbot_sessions WHERE id = ? AND client_id = ? LIMIT 1`
    ).bind(id, clientId).first() as { session_token: string } | null;

    if (!chatbotSession) {
      return json({ error: 'session_not_found' }, 404);
    }

    // Mettre à jour chatbot_sessions
    await env.DB.prepare(
      `UPDATE chatbot_sessions
       SET is_active = ?, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`
    ).bind(isActive, id, clientId).run();

    // Si on désactive (escalade vers humain), on bascule la session webchat
    if (isActive === 0) {
      await env.DB.prepare(
        `UPDATE webchat_sessions
         SET bot_handled = 0
         WHERE id = ?`
      ).bind(chatbotSession.session_token).run();
    } else {
      // Si on réactive le bot
      await env.DB.prepare(
        `UPDATE webchat_sessions
         SET bot_handled = 1
         WHERE id = ?`
      ).bind(chatbotSession.session_token).run();
    }

    return json({ data: { success: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

