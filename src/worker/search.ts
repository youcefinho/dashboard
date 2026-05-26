// ── Module Recherche globale — Intralys CRM (LOT B / S-B2, Manager A) ──
// Recherche cross-entités performante (leads, clients, tasks, conversations).
// 100% additif : s'appuie sur les index S9 (seq 77) via LIKE, AUCUNE migration.
// Multi-tenant STRICT : pattern client_id réutilisé verbatim de messages.ts:194-200.
import type { Env } from './types';
import { json } from './helpers';

export type SearchEntityType = 'leads' | 'clients' | 'tasks' | 'conversations';

const ALL_TYPES: SearchEntityType[] = ['leads', 'clients', 'tasks', 'conversations'];

interface SearchResult {
  type: 'lead' | 'client' | 'task' | 'conversation';
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

/**
 * GET /api/search — recherche globale cross-entités (route AUTHENTIFIÉE).
 *
 * Query params :
 *  - q       : terme recherché. `q.trim().length < 2` → { data:{results:[],total:0} } direct.
 *  - limit   : 1..50 (clampé), défaut 20 — appliqué PAR type.
 *  - types   : CSV optionnel parmi leads,clients,tasks,conversations — défaut tous.
 *
 * Réponse rétro-compat : { data: { results: SearchResult[], total } }.
 * Erreur : { error:<string FR>, code:'SEARCH' }.
 */
export async function handleGlobalSearch(
  env: Env,
  auth: { userId: string; role: string },
  url: URL
): Promise<Response> {
  try {
    const qRaw = url.searchParams.get('q') || '';
    const q = qRaw.trim();
    if (q.length < 2) {
      return json({ data: { results: [], total: 0 } });
    }

    // limit borné [1..50], défaut 20
    let limit = parseInt(url.searchParams.get('limit') || '20', 10);
    if (!Number.isFinite(limit) || Number.isNaN(limit)) limit = 20;
    limit = Math.max(1, Math.min(50, limit));

    // types whitelist (CSV optionnel) — défaut tous
    const typesParam = url.searchParams.get('types');
    let types: SearchEntityType[] = ALL_TYPES;
    if (typesParam) {
      const requested = typesParam
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter((s): s is SearchEntityType => (ALL_TYPES as string[]).includes(s));
      types = requested.length > 0 ? requested : ALL_TYPES;
    }

    // ── Multi-tenant STRICT (pattern messages.ts:194-200) ──────────────
    // Si compte standard, résoudre le client_id de l'user puis filtrer
    // CHAQUE entité dessus. Admin = aucun filtre (tout).
    let tenantClientId: string | null = null;
    if (auth.role !== 'admin') {
      const user = await env.DB
        .prepare('SELECT client_id FROM users WHERE id = ?')
        .bind(auth.userId)
        .first() as Record<string, unknown> | null;
      // Non-admin sans client_id → aucune donnée visible (jamais cross-tenant).
      tenantClientId = (user?.client_id as string) ?? '__no_tenant__';
    }

    const like = `%${q}%`;
    const results: SearchResult[] = [];

    // ── Leads ──────────────────────────────────────────────────────────
    if (types.includes('leads')) {
      let sql = `SELECT id, name, email, phone, status, client_id
                 FROM leads
                 WHERE deleted_at IS NULL
                   AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)`;
      const params: (string | number)[] = [like, like, like];
      if (tenantClientId !== null) {
        sql += ' AND client_id = ?';
        params.push(tenantClientId);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const { results: rows } = await env.DB.prepare(sql).bind(...params).all();
      for (const r of (rows || []) as Record<string, unknown>[]) {
        const id = String(r.id);
        results.push({
          type: 'lead',
          id,
          title: String(r.name || '(sans nom)'),
          subtitle: [r.email, r.phone, r.status].filter(Boolean).join(' · '),
          url: `/leads/${id}`,
        });
      }
    }

    // ── Clients ────────────────────────────────────────────────────────
    if (types.includes('clients')) {
      let sql = `SELECT id, name, email, phone, city
                 FROM clients
                 WHERE (name LIKE ? OR email LIKE ? OR phone LIKE ? OR city LIKE ?)`;
      const params: (string | number)[] = [like, like, like, like];
      // Un non-admin ne voit que SON propre client.
      if (tenantClientId !== null) {
        sql += ' AND id = ?';
        params.push(tenantClientId);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const { results: rows } = await env.DB.prepare(sql).bind(...params).all();
      for (const r of (rows || []) as Record<string, unknown>[]) {
        const id = String(r.id);
        results.push({
          type: 'client',
          id,
          title: String(r.name || '(sans nom)'),
          subtitle: [r.email, r.city].filter(Boolean).join(' · '),
          url: `/clients/${id}/leads`,
        });
      }
    }

    // ── Tasks ──────────────────────────────────────────────────────────
    if (types.includes('tasks')) {
      let sql = `SELECT id, title, description, status, client_id
                 FROM tasks
                 WHERE (title LIKE ? OR description LIKE ?)`;
      const params: (string | number)[] = [like, like];
      if (tenantClientId !== null) {
        sql += ' AND client_id = ?';
        params.push(tenantClientId);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const { results: rows } = await env.DB.prepare(sql).bind(...params).all();
      for (const r of (rows || []) as Record<string, unknown>[]) {
        const id = String(r.id);
        results.push({
          type: 'task',
          id,
          title: String(r.title || '(sans titre)'),
          subtitle: [r.status, r.description].filter(Boolean).join(' · ').slice(0, 120),
          url: '/tasks',
        });
      }
    }

    // ── Conversations ──────────────────────────────────────────────────
    if (types.includes('conversations')) {
      let sql = `SELECT id, subject, channel, status, last_message_preview, client_id
                 FROM conversations
                 WHERE (subject LIKE ? OR last_message_preview LIKE ?)`;
      const params: (string | number)[] = [like, like];
      if (tenantClientId !== null) {
        sql += ' AND client_id = ?';
        params.push(tenantClientId);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const { results: rows } = await env.DB.prepare(sql).bind(...params).all();
      for (const r of (rows || []) as Record<string, unknown>[]) {
        const id = String(r.id);
        results.push({
          type: 'conversation',
          id,
          title: String(r.subject || r.last_message_preview || '(conversation)'),
          subtitle: [r.channel, r.status].filter(Boolean).join(' · '),
          url: '/conversations',
        });
      }
    }

    return json({ data: { results, total: results.length } });
  } catch (err) {
    console.error('Erreur recherche globale:', err);
    return json({ error: 'Erreur lors de la recherche. Réessaie plus tard.', code: 'SEARCH' }, 500);
  }
}
