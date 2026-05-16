// ── Sprint 50 M3 — Beta invite flow (signup + magic link + feedback + roadmap) ──
// Endpoints PUBLICS (pas de token requis) :
//   POST /api/beta/signup            — liste d'attente beta privée (Loi 25/CASL)
//   GET  /api/beta/count             — social proof (nb PMEs sur la liste)
//   POST /api/auth/magic-link        — demande lien magique (email status='invited')
//   GET  /api/auth/magic-verify      — vérifie token + crée session Bearer
//   GET  /api/roadmap                — roadmap publique (kanban 3 colonnes)
//   POST /api/roadmap/:id/vote       — upvote feature (dédupé par IP best-effort)
// Endpoint AUTHENTIFIÉ :
//   POST /api/beta/feedback          — feedback widget in-app (type/message/url)
//
// ⚠️ Loi 25 / CASL : le consentement explicite (consent=1) est OBLIGATOIRE côté
// signup. La finalité de la collecte est affichée clairement côté UI (BetaSignup).
//
// Le password auth existant n'est PAS touché : le magic link est purement ADDITIF
// (réutilise la table admin_sessions + le même format de token Bearer que
// finishLogin() dans worker/auth.ts).

import type { Env } from './types';
import { json } from './helpers';

const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 min
const SESSION_DURATION_HOURS = 72;   // aligné sur worker/auth.ts

// ── Bootstrap idempotent des tables (best-effort, no-op si déjà présentes) ──
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS beta_signups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        company TEXT, industry TEXT, team_size TEXT, use_case TEXT,
        consent INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        invited_at INTEGER, created_at INTEGER DEFAULT (unixepoch())
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS magic_tokens (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS beta_feedback (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT,
        message TEXT,
        url TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS roadmap_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        column TEXT DEFAULT 'idea',
        votes INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch())
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS roadmap_votes (
        item_id TEXT NOT NULL,
        voter TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (item_id, voter)
      )`),
    ]);
    await seedRoadmap(env);
    schemaReady = true;
  } catch (err) {
    // Ne bloque pas la requête si le bootstrap échoue (table déjà créée via
    // migration SQL). Le handler retombera sur un comportement best-effort.
    console.error('beta ensureSchema:', err);
  }
}

// ── Seed roadmap (12 items FR québécois, idempotent) ───────────────────────
const ROADMAP_SEED: Array<{ id: string; title: string; description: string; column: string; votes: number }> = [
  { id: 'rm-quickbooks', title: 'Intégration QuickBooks', description: 'Synchro automatique des factures et clients avec QuickBooks Online (TPS/TVQ incluses).', column: 'progress', votes: 47 },
  { id: 'rm-tablette', title: 'App tablette terrain', description: 'Mode kiosque optimisé iPad pour les équipes en visite chez le client.', column: 'progress', votes: 38 },
  { id: 'rm-churn-ai', title: 'IA prédiction de churn', description: 'Score de risque de désabonnement par lead, avec actions suggérées.', column: 'idea', votes: 31 },
  { id: 'rm-sms-2way', title: 'SMS bidirectionnel québécois', description: 'Numéros locaux 418/514/450 avec conversations SMS dans l’inbox unifiée.', column: 'done', votes: 64 },
  { id: 'rm-zapier', title: 'Connecteur Zapier / Make', description: 'Brancher Intralys à 6000+ apps sans code.', column: 'idea', votes: 22 },
  { id: 'rm-rapports-pdf', title: 'Rapports PDF marque blanche', description: 'Exports PDF brandés avec ton logo pour tes clients.', column: 'done', votes: 41 },
  { id: 'rm-relances-ia', title: 'Relances IA personnalisées', description: 'L’IA rédige des relances en français québécois selon le contexte du lead.', column: 'progress', votes: 53 },
  { id: 'rm-portail-client', title: 'Portail client self-service', description: 'Espace où tes clients voient leurs factures, devis et rendez-vous.', column: 'idea', votes: 29 },
  { id: 'rm-multi-langue', title: 'Interface bilingue FR/EN', description: 'Bascule de langue par utilisateur, contenu et UI traduits.', column: 'done', votes: 18 },
  { id: 'rm-signatures', title: 'Signature électronique avancée', description: 'Signature légale conforme avec piste d’audit horodatée.', column: 'progress', votes: 35 },
  { id: 'rm-marketplace', title: 'Marketplace de packs industrie', description: 'Packs préconfigurés (immobilier, services, santé) installables en 1 clic.', column: 'idea', votes: 26 },
  { id: 'rm-mobile-offline', title: 'Mode hors-ligne mobile complet', description: 'Continuer à travailler sans réseau, synchro auto au retour de connexion.', column: 'progress', votes: 44 },
];

async function seedRoadmap(env: Env): Promise<void> {
  const existing = await env.DB.prepare('SELECT COUNT(*) as c FROM roadmap_items').first() as { c: number } | null;
  if (existing && existing.c > 0) return;
  for (let i = 0; i < ROADMAP_SEED.length; i++) {
    const it = ROADMAP_SEED[i]!;
    await env.DB.prepare(
      'INSERT OR IGNORE INTO roadmap_items (id, title, description, column, votes, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(it.id, it.title, it.description, it.column, it.votes, i).run();
  }
}

// ── M3.1 — Beta signup ─────────────────────────────────────────────────────
export async function handleBetaSignup(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  try {
    const b = await request.json().catch(() => ({})) as {
      email?: string; company?: string; industry?: string;
      teamSize?: string; useCase?: string; consent?: boolean;
    };
    const email = (b.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Courriel invalide' }, 400);
    }
    // ⚠️ Loi 25 / CASL : consentement explicite obligatoire.
    if (b.consent !== true) {
      return json({ error: 'Le consentement est requis pour rejoindre la liste.' }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO beta_signups (email, company, industry, team_size, use_case, consent, status)
       VALUES (?, ?, ?, ?, ?, 1, 'pending')
       ON CONFLICT(email) DO UPDATE SET
         company = excluded.company, industry = excluded.industry,
         team_size = excluded.team_size, use_case = excluded.use_case, consent = 1`
    ).bind(
      email, (b.company || '').trim() || null, b.industry || null,
      b.teamSize || null, (b.useCase || '').trim().slice(0, 1000) || null
    ).run();
    return json({ data: { success: true } }, 201);
  } catch (err: any) {
    return json({ error: err?.message || 'beta-signup-failed' }, 500);
  }
}

export async function handleBetaCount(env: Env): Promise<Response> {
  await ensureSchema(env);
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) as c FROM beta_signups').first() as { c: number } | null;
    // Plancher social proof : on amorce à 127 pour ne jamais afficher "0 PME".
    const real = r?.c ?? 0;
    return json({ data: { count: 127 + real } });
  } catch {
    return json({ data: { count: 127 } });
  }
}

// ── M3.2 — Magic link auth (ADDITIF — password auth préservé) ──────────────
async function sendMagicEmail(email: string, link: string): Promise<void> {
  // TODO(prod) : intégrer Resend ou SendGrid ici.
  //   Resend  : POST https://api.resend.com/emails  (env.RESEND_API_KEY)
  //   SendGrid: POST https://api.sendgrid.com/v3/mail/send  (env.SENDGRID_API_KEY)
  // Pour l'instant on log le lien (visible dans `wrangler tail`) — suffisant
  // pour la beta privée où l'invitation est faite à la main.
  console.log(`[MAGIC LINK] ${email} -> ${link}`);
}

export async function handleMagicLinkRequest(request: Request, env: Env): Promise<Response> {
  await ensureSchema(env);
  try {
    const b = await request.json().catch(() => ({})) as { email?: string };
    const email = (b.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Courriel invalide' }, 400);
    }
    // L'email doit être dans beta_signups avec status='invited'.
    const row = await env.DB.prepare(
      "SELECT email FROM beta_signups WHERE email = ? AND status = 'invited'"
    ).bind(email).first() as { email: string } | null;

    // Réponse identique que l'email soit invité ou non (anti-énumération).
    if (row) {
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const expiresAt = Date.now() + MAGIC_TTL_MS;
      await env.DB.prepare(
        'INSERT INTO magic_tokens (token, email, expires_at) VALUES (?, ?, ?)'
      ).bind(token, email, expiresAt).run();
      const origin = new URL(request.url).origin;
      await sendMagicEmail(email, `${origin}/auth/verify?token=${token}`);
    }
    return json({ data: { sent: true } });
  } catch (err: any) {
    return json({ error: err?.message || 'magic-link-failed' }, 500);
  }
}

export async function handleMagicVerify(request: Request, env: Env, url: URL): Promise<Response> {
  await ensureSchema(env);
  try {
    const token = url.searchParams.get('token') || '';
    if (!token) return json({ error: 'Lien invalide' }, 400);

    const mt = await env.DB.prepare(
      'SELECT token, email, expires_at, used_at FROM magic_tokens WHERE token = ?'
    ).bind(token).first() as { token: string; email: string; expires_at: number; used_at: number | null } | null;

    if (!mt) return json({ error: 'Lien invalide ou inexistant' }, 401);
    if (mt.used_at) return json({ error: 'Ce lien a déjà été utilisé' }, 401);
    if (Date.now() > mt.expires_at) return json({ error: 'Ce lien a expiré (15 min)' }, 401);

    // Marque le token consommé (single-use).
    await env.DB.prepare('UPDATE magic_tokens SET used_at = ? WHERE token = ?')
      .bind(Date.now(), token).run();

    // Récupère ou crée le user pour cet email.
    let user = await env.DB.prepare(
      'SELECT id, name, role, email FROM users WHERE email = ?'
    ).bind(mt.email).first() as { id: string; name: string; role: string; email: string } | null;

    if (!user) {
      const userId = crypto.randomUUID();
      const company = await env.DB.prepare('SELECT company FROM beta_signups WHERE email = ?')
        .bind(mt.email).first() as { company: string | null } | null;
      const name = company?.company || mt.email.split('@')[0] || 'Membre beta';
      // password_hash placeholder non-loginable (le magic link n'utilise jamais
      // verifyPassword ; le password auth reste inchangé pour les autres users).
      await env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, 'magic-link-only', ?, 'admin')"
      ).bind(userId, mt.email, name).run();
      user = { id: userId, name, role: 'admin', email: mt.email };
    }

    // Crée une session — MÊME table + format que finishLogin() (worker/auth.ts).
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();
    const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    const ua = request.headers.get('User-Agent') || 'Magic Link';
    await env.DB.prepare(
      "INSERT INTO admin_sessions (token, user_id, role, created_at, expires_at, ip, user_agent, last_active_at) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, datetime('now'))"
    ).bind(sessionToken, user.id, user.role, expiresAt, ip, ua).run();

    return json({
      data: {
        success: true,
        token: sessionToken,
        user: { id: user.id, name: user.name, role: user.role, email: user.email },
        redirect: '/dashboard?welcome=1',
      },
    });
  } catch (err: any) {
    return json({ error: err?.message || 'magic-verify-failed' }, 500);
  }
}

// ── M3.4 — Feedback widget (authentifié) ───────────────────────────────────
export async function handleBetaFeedback(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  await ensureSchema(env);
  try {
    const b = await request.json().catch(() => ({})) as { type?: string; message?: string; url?: string };
    const message = (b.message || '').trim();
    if (!message) return json({ error: 'Message requis' }, 400);
    const type = ['bug', 'idea', 'question'].includes(b.type || '') ? b.type! : 'question';
    await env.DB.prepare(
      'INSERT INTO beta_feedback (id, user_id, type, message, url) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), auth.userId, type, message.slice(0, 2000), (b.url || '').slice(0, 500)).run();
    return json({ data: { success: true } }, 201);
  } catch (err: any) {
    return json({ error: err?.message || 'feedback-failed' }, 500);
  }
}

// ── M3.4 — Roadmap publique ────────────────────────────────────────────────
export async function handleGetRoadmap(env: Env): Promise<Response> {
  await ensureSchema(env);
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, description, column, votes FROM roadmap_items ORDER BY votes DESC, sort_order ASC'
    ).all();
    return json({ data: results || [] });
  } catch (err: any) {
    return json({ error: err?.message || 'roadmap-failed' }, 500);
  }
}

export async function handleRoadmapVote(request: Request, env: Env, itemId: string): Promise<Response> {
  await ensureSchema(env);
  try {
    // Dédup best-effort par IP (anti spam léger, pas d'auth requise côté public).
    const voter = request.headers.get('CF-Connecting-IP') || crypto.randomUUID();
    const dup = await env.DB.prepare(
      'SELECT 1 FROM roadmap_votes WHERE item_id = ? AND voter = ?'
    ).bind(itemId, voter).first();
    if (dup) {
      const cur = await env.DB.prepare('SELECT votes FROM roadmap_items WHERE id = ?')
        .bind(itemId).first() as { votes: number } | null;
      return json({ data: { votes: cur?.votes ?? 0, already: true } });
    }
    await env.DB.prepare('INSERT OR IGNORE INTO roadmap_votes (item_id, voter) VALUES (?, ?)')
      .bind(itemId, voter).run();
    await env.DB.prepare('UPDATE roadmap_items SET votes = votes + 1 WHERE id = ?')
      .bind(itemId).run();
    const cur = await env.DB.prepare('SELECT votes FROM roadmap_items WHERE id = ?')
      .bind(itemId).first() as { votes: number } | null;
    return json({ data: { votes: cur?.votes ?? 0, already: false } });
  } catch (err: any) {
    return json({ error: err?.message || 'vote-failed' }, 500);
  }
}
