// ── ai-content.ts — SPRINT 12 « IA contenu — atelier centralisé » ───────────
//   NEUF (owned Manager-B). Corps réels Phase B (Manager-B). Signatures FIGÉES
//   (worker.ts les câble déjà). Imports worker RELATIFS, jamais `@/`.
//
// Atelier IA centralisé : générateur (RÉUTILISE le moteur de handleAiGenerate —
// system prompts ai.ts:219, AJOUTE formats blog/landing + rewrite 'expand'),
// CRUD bibliothèque ai_content_items, CRUD ai_brand_voices, pont use-as-template
// (INSERT email_templates / sms_templates depuis un contenu).
//
// CONTRAT (docs/LOT-AI-CONTENT.md §6) :
//   - Routes GARDÉES : auth + capGuard 'ai.use' (EXISTANTE — ZÉRO ajout à
//     ALL_CAPABILITIES). Calque social-ai.ts:capGuard.
//   - Bornage tenant STRICT : client_id / user_id TOUJOURS depuis l'AUTH
//     (auth.tenant?.clientId ?? auth.clientId / auth.userId), JAMAIS le body
//     (le legacy /api/ai/generate lit client_id du body = smell NON reproduit).
//   - LLM : callClaude + isAiContentMockMode (llm-common.ts) — jamais 500 brut.
//   - Succès json({ data }), erreur json({ error }, status) — JAMAIS `code`.
//   - NE PAS casser ai.ts / social-ai.ts / aiDrafts.ts (réutilisés en lecture).
//   - format validé HANDLER (email|sms|social|blog|landing), pas de CHECK SQL.
//   - use-as-template : email_templates.category sous CHECK SQL (valeur DOIT ∈
//     {welcome,followup,reminder,notification,marketing,general}) ; sms_templates.id
//     SANS DEFAULT → généré côté handler. Renvoie { template_id, kind } (§6.A).

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { callClaude } from './llm-common';

export type AiContentAuth = CapAuth & { capabilities?: Set<string> };

// Garde capability : 'ai.use' (EXISTANTE — calque social-ai.ts).
function capGuard(auth: AiContentAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'ai.use');
}

// Bornage tenant STRICT depuis l'AUTH (jamais le body). client_id NULLABLE
// (legacy/mono-tenant → null), user_id depuis l'auth.
function scopeClientId(auth: AiContentAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// ── Constantes de domaine (validées HANDLER — zéro CHECK SQL, §6.I.2) ────────
const CONTENT_FORMATS = new Set(['email', 'sms', 'social', 'blog', 'landing']);
const REWRITE_MODES = new Set(['improve', 'shorten', 'expand', 'formalize', 'casualize', 'retone']);

// Génération d'id (calque seq 91 / use-as-template : lower(hex(randomblob(16)))
// est le DEFAULT SQL ; côté handler crypto.randomUUID est équivalent et utilisé
// par helpers.ts:createNotification).
function genId(): string {
  return crypto.randomUUID();
}

// System prompt de base (RÉUTILISE l'esprit de handleAiGenerate ai.ts:260,
// FR québécois). brandVoice = description du preset (ai_brand_voices) OU
// fallback clients.brand_voice (LECTURE seule, optionnel) OU défaut.
function baseSystem(brandVoice: string): string {
  return (
    `Tu es un assistant IA pour une PME au Québec. ` +
    `Ton du client : ${brandVoice}. ` +
    `Utilise un français québécois naturel (pas parisien), chaleureux et professionnel. ` +
    `Garde les messages concis et orientés vers l'action.`
  );
}

// Consigne format-spécifique. RÉUTILISE les system prompts de handleAiGenerate
// (ai.ts:268) pour email/sms/social ; AJOUTE blog/landing (manquants legacy, §0).
function formatHint(format: string): string {
  switch (format) {
    case 'email':
      return ' Génère un email professionnel : objet implicite clair, corps structuré, ' +
        'appel à l\'action net. Max 200 mots.';
    case 'sms':
      return ' Génère un SMS court et amical (max 160 caractères). Inclus un appel à ' +
        'l\'action clair. Pas d\'emojis excessifs.';
    case 'social':
      return ' Génère un post pour Facebook/Instagram. Ton engageant, local (Québec), ' +
        'avec 3-5 hashtags pertinents et un appel à l\'action. Max 200 mots.';
    case 'blog':
      // AJOUT Sprint 12 — absent du moteur legacy.
      return ' Génère un article de blogue structuré : titre, introduction, sous-sections ' +
        'avec intertitres (##), exemples concrets pour une PME, et une conclusion avec appel ' +
        'à l\'action. Format Markdown.';
    case 'landing':
      // AJOUT Sprint 12 — absent du moteur legacy.
      return ' Génère le contenu d\'une page d\'atterrissage (landing page) : titre principal ' +
        'percutant, sous-titre de promesse de valeur, 3 bénéfices clés en puces, et un libellé ' +
        'de bouton d\'action. Concis et orienté conversion.';
    default:
      return ' Génère un contenu de qualité adapté au contexte.';
  }
}

// Charge le ton à injecter : preset ai_brand_voices (tenant-borné) si
// tone_preset_id, sinon fallback clients.brand_voice (LECTURE seule, NON mutant,
// §6.H), sinon défaut. clientId nullable → comparaison SQL null-safe (`IS ?`).
async function loadBrandVoice(
  env: Env, clientId: string | null, tonePresetId: string | null,
): Promise<string> {
  // 1) Preset explicite, borné au tenant.
  if (tonePresetId) {
    try {
      const row = await env.DB.prepare(
        'SELECT description FROM ai_brand_voices WHERE id = ? AND client_id IS ? LIMIT 1',
      ).bind(tonePresetId, clientId).first() as { description?: string | null } | null;
      if (row?.description && row.description.trim()) return row.description.trim();
    } catch { /* best-effort */ }
  }
  // 2) Fallback legacy clients.brand_voice (LECTURE seule — jamais d'écriture).
  if (clientId) {
    try {
      const client = await env.DB.prepare(
        'SELECT brand_voice FROM clients WHERE id = ?',
      ).bind(clientId).first() as { brand_voice?: string | null } | null;
      if (client?.brand_voice && client.brand_voice.trim()) return client.brand_voice.trim();
    } catch { /* best-effort */ }
  }
  // 3) Défaut (calque ai.ts:241).
  return 'Professionnel, rassurant et québécois naturel.';
}

// ── POST /api/ai/content/generate — génération centralisée ──────────────────
export async function handleGenerateAiContent(
  request: Request, env: Env, auth: AiContentAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  let body: { format?: string; brief?: string; tone_preset_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const format = (body.format || '').trim();
  if (!CONTENT_FORMATS.has(format)) {
    return json({ error: `Format non supporté. Formats : ${[...CONTENT_FORMATS].join(', ')}` }, 400);
  }
  const brief = sanitizeInput(body.brief, 4000);
  if (!brief) return json({ error: 'Brief requis' }, 400);

  const clientId = scopeClientId(auth);
  const tonePresetId = body.tone_preset_id?.trim() || null;

  const brandVoice = await loadBrandVoice(env, clientId, tonePresetId);
  const system = baseSystem(brandVoice) + formatHint(format);
  const userPrompt = `Demande : ${brief}`;

  // callClaude commun (mock-safe, jamais 500 brut — llm-common.ts).
  const content = await callClaude(env, system, userPrompt, { maxTokens: 1024 });

  return json({ data: { content, source_action: `generate:${format}` } });
}

// ── POST /api/ai/content/rewrite — réécriture inline ────────────────────────
export async function handleRewriteAiContent(
  request: Request, env: Env, auth: AiContentAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  let body: { content?: string; mode?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const mode = (body.mode || '').trim();
  if (!REWRITE_MODES.has(mode)) {
    return json({ error: `Mode non supporté. Modes : ${[...REWRITE_MODES].join(', ')}` }, 400);
  }
  const content = sanitizeInput(body.content, 8000);
  if (!content) return json({ error: 'Contenu requis pour la réécriture' }, 400);

  // System prompts de réécriture (RÉUTILISE l'esprit de handleAiGenerate
  // ai.ts:294 inline ; AJOUTE 'expand' et 'retone' — absents du legacy).
  const REWRITE_HINT: Record<string, string> = {
    improve: 'Améliore le texte fourni : corrige les fautes, clarifie le sens, garde la longueur similaire et préserve l\'intention.',
    shorten: 'Raccourcis le texte fourni d\'environ 50%. Garde l\'essentiel et l\'intention.',
    expand: 'Développe et allonge le texte fourni : enrichis-le de précisions utiles et d\'exemples concrets, en gardant l\'intention et le ton.',
    formalize: 'Réécris le texte fourni en registre formel et professionnel québécois. Garde l\'intention et la longueur similaire.',
    casualize: 'Réécris le texte fourni en registre amical et chaleureux québécois (sans vulgarité). Garde l\'intention et la longueur similaire.',
    retone: 'Réécris le texte fourni en ajustant le ton pour qu\'il soit chaleureux, naturel et québécois, tout en préservant fidèlement le message.',
  };

  const system =
    `Tu es un assistant de réécriture pour une PME au Québec. ` +
    `Utilise un français québécois naturel. ${REWRITE_HINT[mode]} ` +
    `Retourne UNIQUEMENT le texte transformé, sans préambule ni guillemets.`;

  // Format SOURCE conservé (calque ai.ts:310 / generateMockContent ai.ts:63).
  const userPrompt = `Texte source :\n${content}`;

  const rewritten = await callClaude(env, system, userPrompt, { maxTokens: 1024 });

  return json({ data: { content: rewritten } });
}

// ── GET /api/ai/content/items — bibliothèque (tenant-bornée) ────────────────
export async function handleListAiContentItems(
  request: Request, env: Env, auth: AiContentAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  const clientId = scopeClientId(auth);
  const url = new URL(request.url);
  const fmt = url.searchParams.get('format');
  const status = url.searchParams.get('status');

  // Bornage tenant STRICT : client_id (null-safe `IS ?`) ET user_id depuis l'auth.
  let sql =
    'SELECT id, client_id, user_id, format, title, brief, content, tone_preset_id, ' +
    'source_action, status, created_at, updated_at FROM ai_content_items ' +
    'WHERE client_id IS ? AND user_id IS ?';
  const params: unknown[] = [clientId, auth.userId ?? null];

  if (fmt && CONTENT_FORMATS.has(fmt)) { sql += ' AND format = ?'; params.push(fmt); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY updated_at DESC, created_at DESC';

  try {
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return json({ data: { items: results || [] } });
  } catch (err) {
    console.error('handleListAiContentItems:', err);
    return json({ data: { items: [] } });
  }
}

// ── POST /api/ai/content/items — sauvegarde un contenu ──────────────────────
export async function handleSaveAiContentItem(
  request: Request, env: Env, auth: AiContentAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  let body: {
    format?: string; content?: string; title?: string; brief?: string;
    tone_preset_id?: string; source_action?: string; status?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const format = (body.format || '').trim();
  if (!CONTENT_FORMATS.has(format)) {
    return json({ error: `Format non supporté. Formats : ${[...CONTENT_FORMATS].join(', ')}` }, 400);
  }
  const content = sanitizeInput(body.content, 50000);
  if (!content) return json({ error: 'Contenu requis' }, 400);

  const clientId = scopeClientId(auth);
  const id = genId();
  const title = body.title ? sanitizeInput(body.title, 300) : null;
  const brief = body.brief ? sanitizeInput(body.brief, 4000) : null;
  const tonePresetId = body.tone_preset_id?.trim() || null;
  const sourceAction = body.source_action ? sanitizeInput(body.source_action, 120) : null;
  const status = (body.status && body.status.trim()) ? body.status.trim() : 'draft';

  try {
    // client_id / user_id DEPUIS L'AUTH (jamais le body — §6.I.5).
    await env.DB.prepare(
      'INSERT INTO ai_content_items ' +
      '(id, client_id, user_id, format, title, brief, content, tone_preset_id, source_action, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      id, clientId, auth.userId ?? null, format, title, brief, content,
      tonePresetId, sourceAction, status,
    ).run();

    const item = await env.DB.prepare(
      'SELECT id, client_id, user_id, format, title, brief, content, tone_preset_id, ' +
      'source_action, status, created_at, updated_at FROM ai_content_items WHERE id = ?',
    ).bind(id).first();

    return json({ data: { item } });
  } catch (err) {
    console.error('handleSaveAiContentItem:', err);
    return json({ error: 'Échec de la sauvegarde' }, 500);
  }
}

// ── DELETE /api/ai/content/items/:id ────────────────────────────────────────
export async function handleDeleteAiContentItem(
  request: Request, env: Env, auth: AiContentAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  void request;

  if (!id) return json({ error: 'Identifiant requis' }, 400);
  const clientId = scopeClientId(auth);

  try {
    // Re-borne tenant : id + client_id (null-safe) + user_id depuis l'auth.
    const res = await env.DB.prepare(
      'DELETE FROM ai_content_items WHERE id = ? AND client_id IS ? AND user_id IS ?',
    ).bind(id, clientId, auth.userId ?? null).run();

    const changes = (res.meta?.changes ?? 0) as number;
    if (!changes) return json({ error: 'Contenu introuvable' }, 404);
    return json({ data: { deleted: true } });
  } catch (err) {
    console.error('handleDeleteAiContentItem:', err);
    return json({ error: 'Échec de la suppression' }, 500);
  }
}

// ── POST /api/ai/content/items/:id/use-as-template — pont IA→templates ──────
export async function handleUseAsTemplate(
  request: Request, env: Env, auth: AiContentAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  void request;

  if (!id) return json({ error: 'Identifiant requis' }, 400);
  const clientId = scopeClientId(auth);

  // Charge l'item, borné tenant (id + client_id null-safe + user_id auth).
  let item: { format?: string | null; title?: string | null; content?: string | null } | null;
  try {
    item = await env.DB.prepare(
      'SELECT format, title, content FROM ai_content_items ' +
      'WHERE id = ? AND client_id IS ? AND user_id IS ?',
    ).bind(id, clientId, auth.userId ?? null).first() as typeof item;
  } catch (err) {
    console.error('handleUseAsTemplate (load):', err);
    return json({ error: 'Échec du chargement' }, 500);
  }
  if (!item) return json({ error: 'Contenu introuvable' }, 404);

  const format = (item.format || '').trim();
  const content = item.content || '';
  const name = (item.title && item.title.trim()) ? item.title.trim() : 'Contenu IA';
  const templateId = genId();

  try {
    if (format === 'email') {
      // email_templates : name/subject/body_html NOT NULL ; category SOUS CHECK
      // SQL → 'marketing' (valeur VALIDE ∈ {welcome,followup,reminder,
      // notification,marketing,general}). is_active=1.
      await env.DB.prepare(
        'INSERT INTO email_templates ' +
        '(id, client_id, name, subject, body_html, category, is_active) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(templateId, clientId, name, name, content, 'marketing', 1).run();
      return json({ data: { template_id: templateId, kind: 'email' } });
    }

    if (format === 'sms') {
      // sms_templates : id SANS DEFAULT → généré côté handler (§6.I.11).
      await env.DB.prepare(
        'INSERT INTO sms_templates (id, client_id, name, body) VALUES (?, ?, ?, ?)',
      ).bind(templateId, clientId, name, content).run();
      return json({ data: { template_id: templateId, kind: 'sms' } });
    }

    // social/blog/landing : pas de table de templates dédiée → non transposable.
    return json({ error: 'Ce format ne peut pas être converti en template' }, 400);
  } catch (err) {
    console.error('handleUseAsTemplate (insert):', err);
    return json({ error: 'Échec de la création du template' }, 500);
  }
}

// ── GET /api/ai/content/brand-voices — presets du tenant ────────────────────
export async function handleListBrandVoices(
  request: Request, env: Env, auth: AiContentAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  void request;

  const clientId = scopeClientId(auth);
  try {
    // Tenant-borné (null-safe). NE LIT PAS clients.brand_voice (legacy intouché).
    const { results } = await env.DB.prepare(
      'SELECT id, client_id, user_id, name, description, is_default, created_at, updated_at ' +
      'FROM ai_brand_voices WHERE client_id IS ? ORDER BY is_default DESC, updated_at DESC',
    ).bind(clientId).all();
    // is_default : INTEGER 0|1 → booléen (type AiBrandVoice §6.B).
    const voices = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      return { ...row, is_default: !!row.is_default };
    });
    return json({ data: { voices } });
  } catch (err) {
    console.error('handleListBrandVoices:', err);
    return json({ data: { voices: [] } });
  }
}

// Démarque tous les autres presets du tenant (unicité applicative du défaut).
async function clearDefaultVoices(env: Env, clientId: string | null, exceptId?: string): Promise<void> {
  if (exceptId) {
    await env.DB.prepare(
      'UPDATE ai_brand_voices SET is_default = 0 WHERE client_id IS ? AND id != ?',
    ).bind(clientId, exceptId).run();
  } else {
    await env.DB.prepare(
      'UPDATE ai_brand_voices SET is_default = 0 WHERE client_id IS ?',
    ).bind(clientId).run();
  }
}

// ── POST /api/ai/content/brand-voices — crée un preset ──────────────────────
export async function handleCreateBrandVoice(
  request: Request, env: Env, auth: AiContentAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  let body: { name?: string; description?: string; is_default?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const name = sanitizeInput(body.name, 200);
  if (!name) return json({ error: 'Nom requis' }, 400);
  const description = body.description ? sanitizeInput(body.description, 4000) : null;
  const isDefault = body.is_default === true ? 1 : 0;

  const clientId = scopeClientId(auth);
  const id = genId();

  try {
    if (isDefault) await clearDefaultVoices(env, clientId);
    await env.DB.prepare(
      'INSERT INTO ai_brand_voices (id, client_id, user_id, name, description, is_default) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, clientId, auth.userId ?? null, name, description, isDefault).run();

    const row = await env.DB.prepare(
      'SELECT id, client_id, user_id, name, description, is_default, created_at, updated_at ' +
      'FROM ai_brand_voices WHERE id = ?',
    ).bind(id).first() as Record<string, unknown> | null;
    const voice = row ? { ...row, is_default: !!row.is_default } : null;
    return json({ data: { voice } });
  } catch (err) {
    console.error('handleCreateBrandVoice:', err);
    return json({ error: 'Échec de la création' }, 500);
  }
}

// ── PATCH /api/ai/content/brand-voices/:id ──────────────────────────────────
export async function handleUpdateBrandVoice(
  request: Request, env: Env, auth: AiContentAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;

  if (!id) return json({ error: 'Identifiant requis' }, 400);

  let body: { name?: string; description?: string; is_default?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const clientId = scopeClientId(auth);

  // Vérifie l'existence + ownership tenant AVANT update (404 si non-owned).
  const existing = await env.DB.prepare(
    'SELECT id FROM ai_brand_voices WHERE id = ? AND client_id IS ?',
  ).bind(id, clientId).first();
  if (!existing) return json({ error: 'Preset introuvable' }, 404);

  // Construit l'UPDATE des champs fournis uniquement.
  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.name === 'string') {
    const name = sanitizeInput(body.name, 200);
    if (!name) return json({ error: 'Nom invalide' }, 400);
    sets.push('name = ?'); params.push(name);
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?'); params.push(sanitizeInput(body.description, 4000));
  }
  let setDefault = false;
  if (typeof body.is_default === 'boolean') {
    setDefault = body.is_default;
    sets.push('is_default = ?'); params.push(body.is_default ? 1 : 0);
  }

  try {
    // Unicité du défaut : si on passe ce preset en défaut, démarque les autres.
    if (setDefault) await clearDefaultVoices(env, clientId, id);

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(id, clientId);
      await env.DB.prepare(
        `UPDATE ai_brand_voices SET ${sets.join(', ')} WHERE id = ? AND client_id IS ?`,
      ).bind(...params).run();
    }

    const row = await env.DB.prepare(
      'SELECT id, client_id, user_id, name, description, is_default, created_at, updated_at ' +
      'FROM ai_brand_voices WHERE id = ?',
    ).bind(id).first() as Record<string, unknown> | null;
    const voice = row ? { ...row, is_default: !!row.is_default } : null;
    return json({ data: { voice } });
  } catch (err) {
    console.error('handleUpdateBrandVoice:', err);
    return json({ error: 'Échec de la mise à jour' }, 500);
  }
}

// ── DELETE /api/ai/content/brand-voices/:id ─────────────────────────────────
export async function handleDeleteBrandVoice(
  request: Request, env: Env, auth: AiContentAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  void request;

  if (!id) return json({ error: 'Identifiant requis' }, 400);
  const clientId = scopeClientId(auth);

  try {
    // Re-borne tenant (null-safe).
    const res = await env.DB.prepare(
      'DELETE FROM ai_brand_voices WHERE id = ? AND client_id IS ?',
    ).bind(id, clientId).run();

    const changes = (res.meta?.changes ?? 0) as number;
    if (!changes) return json({ error: 'Preset introuvable' }, 404);
    return json({ data: { deleted: true } });
  } catch (err) {
    console.error('handleDeleteBrandVoice:', err);
    return json({ error: 'Échec de la suppression' }, 500);
  }
}
