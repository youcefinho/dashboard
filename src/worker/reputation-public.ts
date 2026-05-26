// ── reputation-public.ts — LOT REPUTATION (Sprint 8) ───────────────────────
//
// Page PUBLIQUE de dépôt d'avis 1st-party hébergée Intralys (le différenciateur
// GHL) : invitation résolue par TOKEN → page no-auth /r/:token → dépôt note +
// commentaire → ROUTING INTELLIGENT. Fichier NEUF et ISOLÉ — N'ÉTEND PAS et NE
// MODIFIE PAS reviews.ts (existant) : le nouveau flux 1st-party est SÉPARÉ (les
// 7 routes /api/reviews/* et review_requests/reviews_cache restent intacts ;
// reputation-public.ts ne fait que LIRE clients.google_place_id / reviews_cache
// et INSÉRER dans reviews_cache(source_origin='internal') / private_feedback).
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS : worker.ts
//   (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ Phase A) appelle
//   les endpoints. Contrat §6 verbatim dans docs/LOT-REPUTATION.md (Phase B/C ne
//   lisent QUE ce document + le CODE, jamais le brief).
//
// Conventions imposées (docs/LOT-REPUTATION.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur. JAMAIS
//     de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Routes PUBLIQUES = AUCUNE auth, AUCUNE capability. Bornage tenant STRICT
//     par TOKEN : resolveInvitationToken(token) résout review_invitations.token →
//     l'invitation (+ client_id). Token introuvable ⇒ 404 (jamais de 500/throw
//     nu, anti-fuite). Calque /api/form/:slug & storefront-public.ts.
//   - ROUTING INTELLIGENT au submit (handlePublicSubmitReview) :
//       1. charge reputation_settings.rating_threshold du client (défaut 4) ;
//       2. si rating ≥ threshold ⇒ routed='public' : INSERT reviews_cache
//          (source_origin='internal') + renvoie redirect_url
//          (reputation_settings.public_redirect_url, sinon URL Google construite
//          depuis clients.google_place_id, sinon null) ;
//       3. si rating < threshold ⇒ routed='private' : INSERT private_feedback +
//          message remerciement privé (aucune URL publique renvoyée) ;
//       4. dans les 2 cas, marque review_invitations : status='submitted',
//          rating_submitted, comment_submitted, routed_to, submitted_at.
//     ⚠ Le seuil N'EST JAMAIS exposé au front (PublicReviewPage ne le contient
//       pas). Anti-rejeu : une invitation déjà 'submitted' ⇒ 409 (ou idempotent).
//   - Google Business Profile / Facebook INACTIFS (_v2-backlog) : le « public »
//     se fait par URL CONFIGURÉE, JAMAIS par une API GBP/FB live (pas d'appel
//     externe). source_origin='internal' pour tout avis 1st-party.
//   - best-effort : table/colonne absente → réponse propre (404 / message), JAMAIS
//     de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

/** Invitation résolue (projection minimale du bornage tenant public). */
export interface ResolvedInvitation {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  token: string;
  channel: string | null;
  status: string;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER DE BORNAGE TENANT — résolution token → invitation (anti-fuite)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Résout l'invitation propriétaire du `token` (review_invitations.token →
 * la row). Borne tenant de TOUTES les routes publiques réputation : un token
 * inconnu renvoie null ⇒ le handler répond 404, JAMAIS de fuite cross-tenant.
 * Best-effort : toute erreur DB (ex. table seq 109 non jouée) ⇒ null.
 *
 * NOTE Manager-B : ce helper est le SEUL point d'entrée tenant pour le public.
 * Aucune auth ici — le client_id vient de l'invitation, jamais d'un auth.userId.
 */
export async function resolveInvitationToken(
  env: Env,
  token: string,
): Promise<ResolvedInvitation | null> {
  const clean = sanitizeInput(token || '', 200);
  if (!clean) return null;
  try {
    const row = (await env.DB.prepare(
      `SELECT id, client_id, lead_id, token, channel, status
         FROM review_invitations WHERE token = ?`,
    ).bind(clean).first()) as ResolvedInvitation | null;
    return row && row.id ? row : null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STUBS → CORPS RÉELS Phase B (Manager-B). Signatures FIGÉES Phase A.
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/r/:token — page PUBLIQUE de dépôt d'avis (no-auth, par token).
 * Renvoie PublicReviewPage { business_name, message?, status? }. N'EXPOSE
 * JAMAIS le seuil de routing. Token introuvable ⇒ 404.
 *
 * Corps réel Phase B (Manager-B) : resolveInvitationToken(token) ⇒ 404 si null ;
 * charge le nom du business (clients) + message éventuel ; renvoie le statut de
 * l'invitation (le front grise le formulaire si déjà 'submitted').
 */
export async function handlePublicGetReviewPage(
  env: Env,
  token: string,
): Promise<Response> {
  const inv = await resolveInvitationToken(env, token);
  if (!inv) return json({ error: 'Invitation introuvable' }, 404);

  // Nom du business depuis clients (borné par le client_id de l'invitation —
  // JAMAIS d'auth.userId). Best-effort : client absent ⇒ nom vide.
  let businessName = '';
  if (inv.client_id) {
    try {
      const client = (await env.DB.prepare(
        'SELECT name FROM clients WHERE id = ?',
      ).bind(inv.client_id).first()) as { name?: string } | null;
      businessName = (client?.name as string) || '';
    } catch { /* best-effort : table/colonne absente ⇒ nom vide */ }
  }

  // Message d'accueil éventuel (configuré par le tenant). On NE renvoie JAMAIS le
  // seuil de routing (rating_threshold reste serveur — §6.I-5). Le statut permet
  // au front de griser le formulaire si l'invitation est déjà 'submitted'.
  return json({
    data: {
      business_name: businessName,
      message: null,
      status: inv.status,
    },
  });
}

/**
 * POST /api/r/:token/submit — dépôt d'un avis PUBLIC + ROUTING INTELLIGENT.
 * Body { rating, comment? }. Token introuvable ⇒ 404.
 *
 * Corps réel Phase B (Manager-B) : applique le routing décrit en tête de fichier
 * (seuil reputation_settings.rating_threshold, défaut 4) et renvoie
 * { routed:'public'|'private', redirect_url?, message? }. Marque l'invitation
 * (status/rating_submitted/comment_submitted/routed_to/submitted_at).
 */
export async function handlePublicSubmitReview(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  const inv = await resolveInvitationToken(env, token);
  if (!inv) return json({ error: 'Invitation introuvable' }, 404);

  // Anti-rejeu : invitation déjà soumise ⇒ 409 idempotent (§6.H / en-tête fichier).
  if (inv.status === 'submitted') {
    return json({ error: 'Avis déjà soumis pour cette invitation' }, 409);
  }

  // Parse { rating, comment? }. rating attendu 1-5 ; borne défensive.
  const body = (await request.json().catch(() => null)) as
    | { rating?: unknown; comment?: unknown }
    | null;
  const rating = Math.round(Number(body?.rating));
  if (!rating || rating < 1 || rating > 5) {
    return json({ error: 'Note invalide (1 à 5)' }, 400);
  }
  const comment = sanitizeInput(typeof body?.comment === 'string' ? body.comment : '', 2000) || null;

  // Charge le seuil de routing du client (défaut 4). Le seuil ne fuit JAMAIS au
  // front : il n'est lu QUE ici, serveur, pour décider du routing.
  let threshold = 4;
  let publicRedirectUrl: string | null = null;
  if (inv.client_id) {
    try {
      const settings = (await env.DB.prepare(
        'SELECT rating_threshold, public_redirect_url FROM reputation_settings WHERE client_id = ?',
      ).bind(inv.client_id).first()) as
        | { rating_threshold?: number; public_redirect_url?: string | null }
        | null;
      if (settings) {
        if (settings.rating_threshold != null) threshold = Number(settings.rating_threshold);
        publicRedirectUrl = (settings.public_redirect_url as string) || null;
      }
    } catch { /* best-effort : table seq 109 absente ⇒ défauts */ }
  }

  // Auteur depuis le lead (best-effort).
  let authorName = '';
  if (inv.lead_id) {
    try {
      const lead = (await env.DB.prepare(
        'SELECT name FROM leads WHERE id = ?',
      ).bind(inv.lead_id).first()) as { name?: string } | null;
      authorName = (lead?.name as string) || '';
    } catch { /* best-effort */ }
  }

  // ── ROUTING INTELLIGENT ──────────────────────────────────────────────────
  let routedTo: 'public' | 'private';
  let redirectUrl: string | null = null;

  if (rating >= threshold) {
    // SATISFAIT (note ≥ seuil) → avis PUBLIC : on archive en interne dans
    // reviews_cache (source_origin='internal' — avis 1st-party Intralys) puis on
    // redirige vers Google/FB. external_id UNIQUE ⇒ valeur unique 'internal_'+uuid
    // pour ne JAMAIS violer la contrainte UNIQUE de reviews_cache (seq 12).
    routedTo = 'public';
    try {
      await env.DB.prepare(
        `INSERT INTO reviews_cache (id, client_id, source, source_origin, author_name, rating, comment, review_date, external_id)
         VALUES (?, ?, 'internal', 'internal', ?, ?, ?, datetime('now'), ?)`,
      ).bind(
        crypto.randomUUID(),
        inv.client_id,
        authorName,
        rating,
        comment,
        'internal_' + crypto.randomUUID(),
      ).run();
    } catch (err) {
      console.error('reputation submit reviews_cache insert failed (best-effort):', err);
    }

    // URL publique = public_redirect_url configuré, sinon URL Google construite
    // depuis clients.google_place_id (calque reviews.ts l.69), sinon null.
    // AUCUN appel externe GBP/FB (routes 404 _v2-backlog) — §6.I-7.
    if (publicRedirectUrl) {
      redirectUrl = publicRedirectUrl;
    } else if (inv.client_id) {
      try {
        const client = (await env.DB.prepare(
          'SELECT google_place_id FROM clients WHERE id = ?',
        ).bind(inv.client_id).first()) as { google_place_id?: string } | null;
        if (client?.google_place_id) {
          redirectUrl = `https://search.google.com/local/writereview?placeid=${client.google_place_id}`;
        }
      } catch { /* best-effort */ }
    }
  } else {
    // INSATISFAIT (note < seuil) → feedback PRIVÉ interne : ne part JAMAIS vers
    // Google/FB. Aucune URL renvoyée, message de remerciement privé.
    routedTo = 'private';
    try {
      await env.DB.prepare(
        `INSERT INTO private_feedback (id, client_id, lead_id, invitation_id, rating, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        inv.client_id,
        inv.lead_id,
        inv.id,
        rating,
        comment,
      ).run();
    } catch (err) {
      console.error('reputation submit private_feedback insert failed (best-effort):', err);
    }
  }

  // Dans les 2 cas : marque l'invitation (best-effort, ne casse pas la réponse).
  try {
    await env.DB.prepare(
      `UPDATE review_invitations
          SET status = 'submitted', rating_submitted = ?, comment_submitted = ?,
              routed_to = ?, submitted_at = datetime('now')
        WHERE id = ?`,
    ).bind(rating, comment, routedTo, inv.id).run();
  } catch (err) {
    console.error('reputation submit invitation update failed (best-effort):', err);
  }

  return json({
    data: {
      routed: routedTo,
      redirect_url: redirectUrl,
      message: routedTo === 'private'
        ? 'Merci pour votre retour ! Votre commentaire nous aide à nous améliorer.'
        : 'Merci pour votre avis !',
    },
  });
}
