// ── clients-admin.ts — LOT TEAM C (2026-05-19) ─────────────────────────────
//
// CRUD sous-comptes + branding white-label + rapports cross-sous-comptes.
// CONTRAT §6.F figé — docs/LOT-TEAM-BC.md.
//
//   Corps RÉELS écrits PHASE B Manager-C. Signatures FIGÉES Phase A
//   (NE PAS changer). Bornage tenant = calque EXACT du pattern
//   team.ts (isLegacy + assertTargetInTenant + handleGetUsers mode agence) :
//     - Legacy/mono-tenant (!auth.tenant || tenant.agencyId == null) :
//       comportement byte-équivalent à l'absence historique de garde — ces
//       endpoints sont NEUFS, donc pas de scope élargi : on opère sur le
//       clientId demandé sans WHERE tenant supplémentaire (rétro-compat).
//     - Mode agence (agencyId != null) : isolation DURE — la cible doit
//       appartenir au périmètre (client_id ∈ accessibleClientIds OU
//       clients.agency_id == auth.tenant.agencyId). Sinon 404 « introuvable ».
//
//   Garde capability via requireCapability(auth.capabilities, ...) (en legacy
//   le set est LARGE ⇒ pas de régression ; le bridage viewer n'opère qu'en
//   mode agence). Réponses d'erreur = json({ error }, status) UNIQUEMENT
//   (PAS de champ `code` — §6.A). Best-effort partout : table/colonne
//   absente → réponse propre (404 / { data: [] }), JAMAIS de 500/throw.
//   Soft-delete SEUL (UPDATE is_active = 0) — JAMAIS de DELETE dur.

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';

// Vrai si l'appel est legacy/mono-tenant (calque team.ts:isLegacy / §6.A).
function isLegacy(auth?: CapAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

// Garde tenant sur un sous-compte (clients.id). Renvoie une Response 404 si
// hors périmètre agence, sinon undefined. Calque assertTargetInTenant de
// team.ts (mais cible = clients.id, pas users.id) :
//   - Legacy/mono-tenant → undefined (aucune garde nouvelle ; endpoints NEUFS,
//     rétro-compat byte-équivalente à l'absence historique de borne).
//   - Mode agence → clientId doit être ∈ accessibleClientIds OU
//     clients.agency_id == auth.tenant.agencyId. Best-effort : colonne
//     agency_id absente pré-migration 78 ⇒ fallback accessibleClientIds seul.
async function assertClientInTenant(
  env: Env,
  clientId: string,
  auth?: CapAuth,
): Promise<Response | undefined> {
  if (isLegacy(auth)) return undefined;

  const agencyId = auth!.tenant!.agencyId as string;
  const accessible = auth!.tenant!.accessibleClientIds || [];

  if (accessible.includes(clientId)) return undefined;

  let row: { agency_id: string | null } | null = null;
  try {
    row = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
      .bind(clientId)
      .first()) as { agency_id: string | null } | null;
  } catch {
    // Colonne clients.agency_id absente (pré-migration 78) : on ne peut pas
    // confirmer l'appartenance agence → on borne au seul accessibleClientIds
    // (déjà vérifié ci-dessus = échec) ⇒ hors périmètre.
    row = null;
  }

  const inTenant = !!row && row.agency_id != null && row.agency_id === agencyId;
  if (!inTenant) {
    return json({ error: 'Sous-compte introuvable' }, 404);
  }
  return undefined;
}

// ── PATCH /api/clients/:id ──────────────────────────────────────────────────
// Bornage tenant + garde clients.manage + UPDATE des champs éditables du
// sous-compte (colonnes raisonnables du schéma clients : name/email/phone/
// site_url/city/banner — PAS de colonne système : id/is_active/agency_id/
// created_at/updated_at exclues).
const EDITABLE_CLIENT_COLUMNS = [
  'name',
  'email',
  'phone',
  'site_url',
  'city',
  'banner',
] as const;

export async function handleUpdateClient(
  request: Request,
  env: Env,
  auth: CapAuth,
  clientId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'clients.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const col of EDITABLE_CLIENT_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      sets.push(`${col} = ?`);
      binds.push(body[col] == null ? '' : String(body[col]));
    }
  }

  if (sets.length === 0) {
    return json({ error: 'Aucun champ modifiable' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  binds.push(clientId);

  try {
    await env.DB.prepare(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return json({ data: { success: true } });
  } catch {
    // Best-effort : colonne absente / panne D1 → réponse propre, pas de 500.
    return json({ error: 'Sous-compte introuvable' }, 404);
  }
}

// ── DELETE /api/clients/:id ─────────────────────────────────────────────────
// SOFT delete : UPDATE clients SET is_active = 0 (colonne is_active EXISTE
// déjà schema.sql:27, DEFAULT 1 — JAMAIS de DELETE dur). Même bornage +
// garde clients.manage.
export async function handleDeleteClient(
  _request: Request,
  env: Env,
  auth: CapAuth,
  clientId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'clients.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  try {
    await env.DB.prepare(
      "UPDATE clients SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(clientId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Sous-compte introuvable' }, 404);
  }
}

// ── GET /api/clients/:id/branding ───────────────────────────────────────────
// SELECT branding, logo_url, primary_color, accent_color (colonnes seq 81),
// borné tenant + garde clients.manage (lecture config sensible). Best-effort :
// colonnes seq 81 absentes → réponse propre (valeurs null), jamais de throw.
export async function handleGetClientBranding(
  env: Env,
  auth: CapAuth,
  clientId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'clients.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  try {
    const row = (await env.DB.prepare(
      'SELECT branding, logo_url, primary_color, accent_color FROM clients WHERE id = ?',
    )
      .bind(clientId)
      .first()) as
      | {
          branding: string | null;
          logo_url: string | null;
          primary_color: string | null;
          accent_color: string | null;
        }
      | null;
    return json({
      data: {
        branding: row?.branding ?? null,
        logo_url: row?.logo_url ?? null,
        primary_color: row?.primary_color ?? null,
        accent_color: row?.accent_color ?? null,
      },
    });
  } catch {
    // Colonnes seq 81 absentes (migration non jouée) : réponse propre vide.
    return json({
      data: {
        branding: null,
        logo_url: null,
        primary_color: null,
        accent_color: null,
      },
    });
  }
}

// ── PATCH /api/clients/:id/branding ─────────────────────────────────────────
// UPDATE colonnes branding seq 81, borné tenant + garde clients.manage.
export async function handleUpdateClientBranding(
  request: Request,
  env: Env,
  auth: CapAuth,
  clientId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'clients.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  // Patch partiel : ne met à jour que les colonnes branding fournies.
  const BRANDING_COLUMNS = [
    'branding',
    'logo_url',
    'primary_color',
    'accent_color',
  ] as const;
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const col of BRANDING_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      sets.push(`${col} = ?`);
      binds.push(body[col] == null ? null : String(body[col]));
    }
  }

  if (sets.length === 0) {
    return json({ error: 'Aucun champ modifiable' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  binds.push(clientId);

  try {
    await env.DB.prepare(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return json({ data: { success: true } });
  } catch {
    // Colonnes seq 81 absentes / panne D1 : réponse propre, pas de 500.
    return json({ error: 'Sous-compte introuvable' }, 404);
  }
}

// ── GET /api/reports/agency ─────────────────────────────────────────────────
// Agrégat cross-sous-comptes borné à auth.tenant.accessibleClientIds. Garde
// reports.view. Si accessibleClientIds vide → { data: [] }. Agrège par
// sous-compte : nb leads + nb leads convertis (status 'won') + nom du
// sous-compte. Requêtes D1 réelles bornées (placeholders), jamais de données
// fabriquées. Tables absentes → { data: [] } best-effort.
export async function handleGetAgencyReports(
  env: Env,
  auth: CapAuth,
  _url: URL,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'reports.view',
  );
  if (g) return g;

  const accessible = auth?.tenant?.accessibleClientIds || [];
  if (accessible.length === 0) {
    return json({ data: [] });
  }

  const placeholders = accessible.map(() => '?').join(',');

  try {
    // Agrégat leads par sous-compte borné aux clients accessibles.
    const { results } = await env.DB.prepare(
      `SELECT c.id AS client_id,
              c.name AS client_name,
              COUNT(l.id) AS lead_count,
              SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won_count
         FROM clients c
         LEFT JOIN leads l ON l.client_id = c.id
        WHERE c.id IN (${placeholders})
        GROUP BY c.id, c.name
        ORDER BY lead_count DESC`,
    )
      .bind(...accessible)
      .all();

    const data = (results || []).map((r) => {
      const row = r as {
        client_id: string;
        client_name: string | null;
        lead_count: number | null;
        won_count: number | null;
      };
      const leads = Number(row.lead_count) || 0;
      const won = Number(row.won_count) || 0;
      return {
        client_id: row.client_id,
        client_name: row.client_name || '',
        lead_count: leads,
        won_count: won,
        conversion: leads > 0 ? Math.round((won / leads) * 100) : 0,
      };
    });

    return json({ data });
  } catch {
    // Table leads/clients absente ou colonne manquante : best-effort vide.
    return json({ data: [] });
  }
}

// ── LOT G9 WHITE-LABEL custom domain (squelette transverse, Phase A) ─────────
//
// CONTRAT §6 figé — docs/LOT-WHITELABEL-G9.md.
//   Signatures FIGÉES Phase A (NE PAS changer). Corps RÉELS écrits PHASE B
//   Manager-B (lookup hostname fallback tenant-context.ts + corps des 3
//   handlers ci-dessous). Garde capability `settings.manage` (RÉUTILISÉE —
//   ZÉRO ajout à ALL_CAPABILITIES) + bornage assertClientInTenant (calque
//   exact des handlers branding ci-dessus). Best-effort partout : table
//   custom_hostnames absente (migration 94 non jouée) → réponse propre
//   ({ data: [] } / 404 / { success:true }), JAMAIS de 500/throw.
//
// ⚠ Provisioning Cloudflare for SaaS = FLAG INACTIF env.WHITELABEL_PROVISIONING_ENABLED.
//   provisionCustomHostname est un NO-OP (retourne { status:'pending' }) tant
//   que flag !== 'true' — AUCUN appel réseau Phase A. DKIM/from par tenant =
//   FLAG INACTIF env.WHITELABEL_DKIM_ENABLED ; resolveFromAddress retourne le
//   from défaut byte-identique tant que flag off OU pas de hostname active.

// no-op Phase A : provisioning Cloudflare for SaaS DERRIÈRE flag inactif.
// Flag OFF (défaut) ⇒ aucun appel réseau, statut reste 'pending'. Corps réel
// (appel API CF for SaaS) branché Phase B Manager-B UNIQUEMENT si flag === 'true'.
export async function provisionCustomHostname(
  env: Env,
  hostname: string,
): Promise<{ status: string; provider_ref?: string }> {
  if (env.WHITELABEL_PROVISIONING_ENABLED !== 'true') {
    // FLAG INACTIF (défaut) : no-op, ZÉRO réseau. Statut reste 'pending'.
    return { status: 'pending' };
  }
  // ── Phase B (Manager-B) : appel réel Cloudflare for SaaS, gardé flag === 'true'.
  // Défensif : les credentials/binding (CF_API_TOKEN / CF_ZONE_ID) n'existent
  // pas encore au niveau Env ⇒ on lit en best-effort depuis un cast d'Env et,
  // SI absents OU si l'appel échoue, on retombe sur 'pending' (jamais de throw,
  // jamais de 500 remonté à l'appelant). Le flag ne sera basculé 'true' qu'une
  // fois ces secrets posés ; tant qu'ils manquent le comportement reste 'pending'.
  const e = env as unknown as Record<string, string | undefined>;
  const token = e.CF_API_TOKEN;
  const zoneId = e.CF_ZONE_ID;
  if (!token || !zoneId) {
    // Secrets non posés : pas d'appel réseau possible, statut 'pending'.
    return { status: 'pending' };
  }
  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname,
          ssl: { method: 'http', type: 'dv' },
        }),
      },
    );
    const out = (await resp.json().catch(() => null)) as
      | { success?: boolean; result?: { id?: string; status?: string } }
      | null;
    if (out && out.success && out.result) {
      return {
        status: out.result.status || 'pending',
        provider_ref: out.result.id,
      };
    }
    return { status: 'pending' };
  } catch {
    // Panne réseau / API : best-effort, statut reste 'pending'. Jamais de throw.
    return { status: 'pending' };
  }
}

// no-op Phase A : from email par tenant DERRIÈRE flag inactif. Flag OFF (défaut)
// OU pas de hostname active ⇒ from défaut BYTE-IDENTIQUE à workflows.ts:614,622.
// Corps réel (SELECT hostname active du tenant + from personnalisé) branché
// Phase B Manager-B UNIQUEMENT si flag === 'true'.
export async function resolveFromAddress(
  env: Env,
  clientId: string | null,
): Promise<string> {
  const DEFAULT_FROM = 'Intralys CRM <noreply@intralys.com>';
  if (env.WHITELABEL_DKIM_ENABLED !== 'true') {
    // FLAG INACTIF (défaut) : from défaut, BYTE-IDENTIQUE au hardcode historique
    // (workflows.ts:614,622). ZÉRO requête D1.
    return DEFAULT_FROM;
  }
  // ── Phase B (Manager-B) : flag === 'true' → résolution hostname active du
  // tenant + from personnalisé. Fallback DEFAULT_FROM byte-identique si pas de
  // clientId, pas de hostname active, ou panne D1 (best-effort, jamais de throw).
  if (!clientId) return DEFAULT_FROM;
  try {
    const row = (await env.DB.prepare(
      "SELECT hostname FROM custom_hostnames WHERE client_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    )
      .bind(clientId)
      .first()) as { hostname: string | null } | null;
    const hostname = (row?.hostname || '').trim().toLowerCase();
    if (hostname) {
      return `Intralys CRM <noreply@${hostname}>`;
    }
    return DEFAULT_FROM;
  } catch {
    // Table custom_hostnames absente / panne D1 : fallback défaut byte-identique.
    return DEFAULT_FROM;
  }
}

// ── GET /api/clients/:id/custom-domain ───────────────────────────────────────
// Liste les hostnames personnalisés du tenant. Borné tenant + garde
// settings.manage. État : IMPLÉMENTÉ (corps réel présent).
export async function handleGetCustomDomains(
  env: Env,
  auth: CapAuth,
  clientId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'settings.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, hostname, status, dkim_status, provider_ref, created_at
         FROM custom_hostnames
        WHERE client_id = ?
        ORDER BY created_at DESC`,
    )
      .bind(clientId)
      .all();
    return json({ data: results || [] });
  } catch {
    // Table custom_hostnames absente (migration 94 non jouée) : réponse propre.
    return json({ data: [] });
  }
}

// Validation hostname basique (format domaine) : labels alphanum + tirets,
// au moins un point, longueur raisonnable. Pas de regex exotique — borne le
// strictement nécessaire pour éviter une valeur garbage en base.
function isValidHostname(h: string): boolean {
  if (!h || h.length > 253) return false;
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h);
}

// ── POST /api/clients/:id/custom-domain ──────────────────────────────────────
// Ajoute un hostname personnalisé pour le tenant (provisioning DERRIÈRE flag,
// no-op si OFF). Borné tenant + garde settings.manage. État : IMPLÉMENTÉ
// (corps réel présent).
export async function handleAddCustomDomain(
  request: Request,
  env: Env,
  auth: CapAuth,
  clientId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'settings.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const hostname = String(body.hostname ?? '').trim().toLowerCase();
  if (!isValidHostname(hostname)) {
    return json({ error: 'Nom de domaine invalide' }, 400);
  }

  // agency_id du tenant courant (NULL en legacy/mono-tenant).
  const agencyId = auth?.tenant?.agencyId ?? null;
  const id = crypto.randomUUID();

  // Provisioning DERRIÈRE flag : no-op + 'pending' si OFF (zéro réseau).
  const prov = await provisionCustomHostname(env, hostname);

  try {
    await env.DB.prepare(
      `INSERT INTO custom_hostnames (id, client_id, agency_id, hostname, status, provider_ref)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, agencyId, hostname, prov.status, prov.provider_ref ?? null)
      .run();
    return json({ data: { id, status: prov.status } });
  } catch {
    // Table custom_hostnames absente / panne D1 : réponse propre, pas de 500.
    return json({ error: 'Domaine introuvable' }, 404);
  }
}

// ── DELETE /api/clients/:id/custom-domain/:hid ───────────────────────────────
// Supprime un hostname personnalisé du tenant. Borné tenant + garde
// settings.manage. État : IMPLÉMENTÉ (corps réel présent — DELETE
// custom_hostnames WHERE id = :hid AND client_id = :id — re-borne par ID).
export async function handleDeleteCustomDomain(
  env: Env,
  auth: CapAuth,
  clientId: string,
  hostId: string,
): Promise<Response> {
  const g = requireCapability(
    (auth as CapAuth & { capabilities?: Set<string> }).capabilities,
    'settings.manage',
  );
  if (g) return g;

  const guard = await assertClientInTenant(env, clientId, auth);
  if (guard) return guard;

  try {
    // Re-borne par ID : le hostname doit appartenir AU clientId du tenant.
    const row = (await env.DB.prepare(
      'SELECT id FROM custom_hostnames WHERE id = ? AND client_id = ?',
    )
      .bind(hostId, clientId)
      .first()) as { id: string } | null;
    if (!row) {
      return json({ error: 'Domaine introuvable' }, 404);
    }
    await env.DB.prepare(
      'DELETE FROM custom_hostnames WHERE id = ? AND client_id = ?',
    )
      .bind(hostId, clientId)
      .run();
    return json({ data: { success: true } });
  } catch {
    // Table custom_hostnames absente / panne D1 : réponse propre, pas de 500.
    return json({ error: 'Domaine introuvable' }, 404);
  }
}
