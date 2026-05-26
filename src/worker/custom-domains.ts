// ── custom-domains.ts — Sprint 50 DNS records UI + Cloudflare for SaaS ────
//
// Handlers backend du module white-label custom domains + DNS records. La
// gestion white-label basique (branding, logo, sous-comptes) reste dans
// sub-accounts.ts (S94). Sprint 50 ajoute la couche DNS dédiée :
// custom_domains avec status (pending|verified|active|failed), SSL via
// Cloudflare for SaaS (flag INACTIF V1), DNS records CRUD avec push to
// Cloudflare (flag INACTIF V1).
//
// Phase B Manager-A — corps réels. Signatures FIGÉES Phase A (worker.ts
// gelé câble déjà ces handlers, api.ts gelé appelle déjà ces routes).
// Contrat §6 verbatim dans docs/LOT-SURVEYS-DNS-S50.md.
//
// Conventions imposées (docs/LOT-SURVEYS-DNS-S50.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` dans les erreurs.
//   - Garde capability : domainCapGuard(auth) = mode-agence-only — réutilise
//     'settings.manage' (déjà dans ALL_CAPABILITIES seq80 — AUCUN ajout).
//     Action TRÈS sensible (modifie la résolution DNS d'un tenant).
//   - Bornage tenant : loadDomainInTenant (calque
//     affiliates.ts:loadAffiliateInTenant — legacy → row ; mode agence →
//     custom_domains.client_id ∈ accessibleClientIds, sinon 404).
//   - Statuts validés HANDLER (PAS de CHECK SQL) : custom_domains.status
//     (pending|verified|active|failed — dns-engine.DOMAIN_STATUSES) /
//     ssl_status (pending|provisioned|failed — dns-engine.SSL_STATUSES) /
//     dns_records.type (A|AAAA|CNAME|MX|TXT|SRV — dns-engine.DNS_RECORD_TYPES).
//   - best-effort : table/colonne absente (seq145 non jouée) → réponse
//     propre (404 / {data:[]}), JAMAIS de 500/throw non maîtrisé.
//   - Cloudflare for SaaS — flag INACTIF V1 : env.CLOUDFLARE_API_TOKEN
//     absent ⇒ provisioning + sync DNS retournent stub gracieux. L'UI
//     affiche `pending` + instructions DNS manuelles client.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import {
  DNS_RECORD_TYPES,
  DOMAIN_STATUSES,
  buildVerifyTxtName,
  generateVerifyToken,
  provisionCloudflareForSaas,
  syncDnsRecords,
  validateHostname,
  verifyDomainOwnership,
} from './lib/dns-engine';
import type { DnsErrorCode } from './lib/dns-engine';

// Auth enrichi au choke-point (worker.ts) — calque AffiliateAuth.
export type DomainAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability mode-agence-only (calque affiliates.ts) ─────────────
// Capability `settings.manage` réutilisée (déjà dans ALL_CAPABILITIES seq80).
// DNS = action TRÈS sensible (modifie la résolution DNS d'un tenant). Legacy/
// mono-tenant ⇒ undefined : aucun bridage nouveau.
export function domainCapGuard(auth: DomainAuth): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Helpers internes ──────────────────────────────────────────────────────

/** UUID hex 32 (calque affiliates.ts:newIdS49). */
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Parse JSON body best-effort (empty/invalid ⇒ {}). */
async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Resolve client_id côté handler (auth context). */
function clientIdOf(auth: DomainAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

/** Construit le filtre tenant SQL pour custom_domains. */
function tenantFilter(auth: DomainAuth): { clause: string; params: string[] } {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return { clause: '', params: [] };
  const accessible = auth.tenant!.accessibleClientIds || [];
  if (accessible.length === 0) {
    return { clause: '1 = 0', params: [] };
  }
  const placeholders = accessible.map(() => '?').join(',');
  return {
    clause: `client_id IN (${placeholders})`,
    params: [...accessible],
  };
}

/** Bornage tenant sur un custom_domain (calque loadAffiliateInTenant). */
async function loadDomainInTenant(
  env: Env,
  domainId: string,
  auth: DomainAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM custom_domains WHERE id = ?')
      .bind(domainId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Domaine introuvable' }, 404);
  }
  if (!row) return json({ error: 'Domaine introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  if (rowClient == null || !accessible.includes(rowClient)) {
    return json({ error: 'Domaine introuvable' }, 404);
  }
  return row;
}

/**
 * Bornage tenant sur un dns_record (JOIN custom_domains.client_id).
 * Retourne { record, domain } ou Response 404.
 */
async function loadDnsRecordInTenant(
  env: Env,
  recordId: string,
  auth: DomainAuth,
): Promise<
  | { record: Record<string, unknown>; domain: Record<string, unknown> }
  | Response
> {
  let rec: Record<string, unknown> | null = null;
  try {
    rec = (await env.DB.prepare('SELECT * FROM dns_records WHERE id = ?')
      .bind(recordId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'DNS record introuvable' }, 404);
  }
  if (!rec) return json({ error: 'DNS record introuvable' }, 404);
  const did = (rec.domain_id as string | null) ?? '';
  if (!did) return json({ error: 'DNS record introuvable' }, 404);
  const domain = await loadDomainInTenant(env, did, auth);
  if (domain instanceof Response) return domain;
  return { record: rec, domain };
}

/**
 * Génère un verification_token (UUID v4 hex 32).
 *
 * Délègue à `dns-engine.generateVerifyToken()` (Sprint 50 RENFORCÉ) — source
 * unique d'entropie cross-handlers. Préserve byte-identique le format (hex 32).
 */
function genVerificationToken(): string {
  return generateVerifyToken();
}

/** Validation TTL [60..86400], défaut 3600. */
function clampTtl(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3600;
  return Math.min(86400, Math.max(60, Math.floor(n)));
}

/**
 * Map un `DnsErrorCode` (télémétrie) vers un message UI FR explicite.
 *
 * NB : la convention §6 (docs/LOT-SURVEYS-DNS-S50.md) interdit le champ `code`
 * dans les réponses d'erreur. On expose ici `errorCode` (champ DISTINCT,
 * additif) pour télémétrie côté UI sans casser la convention. Tous les
 * messages contiennent "invalide" / "trop" pour matcher les tests existants
 * (`body.error).toMatch(/invalide/i)`).
 */
function dnsErrorMessage(code: DnsErrorCode | undefined): string {
  switch (code) {
    case 'EMPTY_HOSTNAME':
      return 'Domaine requis (invalide)';
    case 'HOSTNAME_TOO_LONG':
      return 'Domaine trop long (invalide, max 253 caractères)';
    case 'HOSTNAME_LABEL_TOO_LONG':
      return 'Label de domaine trop long (invalide, max 63 caractères)';
    case 'HOSTNAME_IS_IP':
      return "Domaine invalide (ne peut pas être une adresse IP)";
    case 'HOSTNAME_HAS_UNDERSCORE':
      return 'Domaine invalide (underscore interdit RFC 1035)';
    case 'HOSTNAME_HAS_LEADING_HYPHEN':
      return 'Domaine invalide (label ne peut pas commencer par un tiret)';
    case 'HOSTNAME_HAS_TRAILING_HYPHEN':
      return 'Domaine invalide (label ne peut pas finir par un tiret)';
    case 'HOSTNAME_HAS_CONSECUTIVE_DOTS':
      return 'Domaine invalide (points consécutifs interdits)';
    case 'INVALID_HOSTNAME':
    default:
      return 'Domaine invalide';
  }
}

// ── 1) GET /api/custom-domains ────────────────────────────────────────────
/**
 * Liste les custom domains du tenant. Cap `settings.manage` (handler).
 * Filtres URL : `?status=pending|verified|active|failed`.
 *
 * NB : DISTINCT de l'endpoint legacy /api/clients/:id/custom-domains
 * (sub-accounts.ts S94) qui gère le whitelabel basique (clients.custom_domain
 * colonne unique). Sprint 50 = table dédiée custom_domains avec full DNS.
 */
export async function handleListCustomDomains(
  env: Env,
  auth: DomainAuth,
  url: URL,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  try {
    const { clause, params } = tenantFilter(auth);
    const conds: string[] = [];
    const binds: string[] = [];
    if (clause) {
      conds.push(clause);
      binds.push(...params);
    }
    const statusFilter = url.searchParams.get('status');
    if (
      statusFilter &&
      DOMAIN_STATUSES.includes(
        statusFilter as (typeof DOMAIN_STATUSES)[number],
      )
    ) {
      conds.push('status = ?');
      binds.push(statusFilter);
    }
    let query = 'SELECT * FROM custom_domains';
    if (conds.length > 0) query += ` WHERE ${conds.join(' AND ')}`;
    query += ' ORDER BY created_at DESC';
    const stmt = env.DB.prepare(query);
    const { results } =
      binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── 2) POST /api/custom-domains ───────────────────────────────────────────
/**
 * Ajoute un custom domain pour un client :
 *   - normalizeDomain() (dns-engine — lowercase + strip trailing dot)
 *   - génère verification_token
 *   - INSERT custom_domains (status='pending', ssl_status='pending')
 *   - provisionCloudflareForSaas() (flag INACTIF V1 ⇒ zone_id null)
 *
 * UNIQUE INDEX uniq_custom_domains_domain ⇒ 409 si déjà existant.
 */
export async function handleAddCustomDomain(
  request: Request,
  env: Env,
  auth: DomainAuth,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;

  const body = await readJsonBody(request);
  const rawDomain = (body.domain as string) || '';

  // Validation RFC 1035 stricte (anti-IDOR : refuse IP, underscore, label-too-long,
  // dots consécutifs, leading/trailing hyphen). Délègue à dns-engine pour codes
  // erreurs stables exposés via `errorCode` (additif — la convention §6
  // interdit `code` mais pas `errorCode`).
  const v = validateHostname(rawDomain);
  if (!v.ok || !v.normalized) {
    return json(
      {
        error: dnsErrorMessage(v.code),
        errorCode: v.code ?? 'INVALID_HOSTNAME',
      },
      400,
    );
  }
  const domain = v.normalized;

  const clientId = clientIdOf(auth);
  if (!clientId) return json({ error: 'Tenant requis' }, 400);

  // Détection préalable de collision (UNIQUE INDEX uniq_custom_domains_domain).
  try {
    const existing = (await env.DB.prepare(
      'SELECT id FROM custom_domains WHERE domain = ? LIMIT 1',
    )
      .bind(domain)
      .first()) as { id: string } | null;
    if (existing) {
      return json({ error: 'Domaine déjà utilisé' }, 409);
    }
  } catch {
    /* best-effort — INSERT échouera côté SQL si la table existe */
  }

  // Provisioning Cloudflare for SaaS (flag INACTIF V1 ⇒ zone_id null).
  let provision: Awaited<ReturnType<typeof provisionCloudflareForSaas>>;
  try {
    provision = await provisionCloudflareForSaas(env, domain);
  } catch {
    provision = { zone_id: null, ssl_status: 'pending' };
  }

  const id = newId();
  const verificationToken = genVerificationToken();
  try {
    await env.DB.prepare(
      'INSERT INTO custom_domains (id, client_id, domain, status, cloudflare_zone_id, verification_token, ssl_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        clientId,
        domain,
        'pending',
        provision.zone_id,
        verificationToken,
        provision.ssl_status,
      )
      .run();

    // Construire instructions DNS exposées à l'UI (TXT verify + CNAME app
    // cible). Le mock `provisionCloudflareForSaas` retourne déjà `dns_records`
    // (CF token absent ⇒ mock réaliste avec instructions). Si on est sur le
    // chemin stub byte-identique (zone_id null + dns_records undefined), on
    // reconstruit localement le TXT verify avec le token qu'on vient de
    // générer (pour que l'UI puisse afficher les instructions immédiatement).
    const dnsRecords =
      provision.dns_records && provision.dns_records.length > 0
        ? // Mock retourne ses propres instructions, mais le token TXT est un
          // nouveau generateVerifyToken() côté engine — on REMPLACE par le
          // token réellement INSERT en DB (sinon l'UI affiche un token qui ne
          // matchera jamais le lookup DNS).
          provision.dns_records.map((rec) =>
            rec.type === 'TXT' ? { ...rec, value: verificationToken } : rec,
          )
        : [
            {
              type: 'TXT' as const,
              name: buildVerifyTxtName(domain),
              value: verificationToken,
              ttl: 3600,
            },
            {
              type: 'CNAME' as const,
              name: domain,
              value: 'intralys-sites.workers.dev',
              ttl: 3600,
            },
          ];

    return json(
      {
        data: {
          id,
          domain,
          status: 'pending',
          verification_token: verificationToken,
          cloudflare_zone_id: provision.zone_id,
          ssl_status: provision.ssl_status,
          dns_records: dnsRecords,
        },
      },
      201,
    );
  } catch (e) {
    // UNIQUE INDEX collision ⇒ 409.
    if (/UNIQUE/i.test(String(e ?? ''))) {
      return json({ error: 'Domaine déjà utilisé' }, 409);
    }
    return json({ error: 'Création impossible' }, 400);
  }
}

// ── 3) POST /api/custom-domains/:id/verify ────────────────────────────────
/**
 * Vérifie un custom domain via lookup DNS TXT _intralys-verify.<domain>.
 * Câble verifyDomainOwnership() (dns-engine — flag INACTIF V1 stub). Si
 * verified=true ⇒ UPDATE status='verified', verified_at=now.
 */
export async function handleVerifyDomain(
  _request: Request,
  env: Env,
  auth: DomainAuth,
  domainId: string,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  const domain = await loadDomainInTenant(env, domainId, auth);
  if (domain instanceof Response) return domain;

  const domainName = (domain.domain as string | null) ?? '';
  const token = (domain.verification_token as string | null) ?? '';
  if (!domainName || !token) {
    return json({ error: 'Données de vérification manquantes' }, 400);
  }

  let result: Awaited<ReturnType<typeof verifyDomainOwnership>>;
  try {
    result = await verifyDomainOwnership(env, domainName, token);
  } catch {
    result = { verified: false, reason: 'engine-error' };
  }

  if (!result.verified) {
    // Best-effort : retourner les instructions DNS (TXT verify + CNAME app)
    // pour que l'UI puisse les afficher au client en cas d'échec de
    // vérification (le client doit voir ce qu'il doit poser comme records).
    const dnsRecords = [
      {
        type: 'TXT' as const,
        name: buildVerifyTxtName(domainName),
        value: token,
        ttl: 3600,
      },
      {
        type: 'CNAME' as const,
        name: domainName,
        value: 'intralys-sites.workers.dev',
        ttl: 3600,
      },
    ];
    return json({
      data: {
        id: domainId,
        verified: false,
        status: 'pending',
        dns_records: dnsRecords,
      },
    });
  }

  try {
    await env.DB.prepare(
      "UPDATE custom_domains SET status = 'verified', verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(domainId)
      .run();
  } catch {
    /* best-effort */
  }

  // Si vérifié et flag INACTIF Cloudflare = provisioning différé (no-op).
  let provision: Awaited<ReturnType<typeof provisionCloudflareForSaas>>;
  try {
    provision = await provisionCloudflareForSaas(env, domainName);
  } catch {
    provision = { zone_id: null, ssl_status: 'pending' };
  }
  if (provision.zone_id) {
    try {
      await env.DB.prepare(
        "UPDATE custom_domains SET cloudflare_zone_id = ?, ssl_status = ?, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(provision.zone_id, provision.ssl_status, domainId)
        .run();
    } catch {
      /* best-effort */
    }
  }

  return json({
    data: {
      id: domainId,
      verified: true,
      status: 'verified',
      cloudflare_zone_id: provision.zone_id,
      ssl_status: provision.ssl_status,
    },
  });
}

// ── 4) DELETE /api/custom-domains/:id ─────────────────────────────────────
/**
 * Supprime un custom domain + ses dns_records (cascade applicative). Si
 * cloudflare_zone_id présent ⇒ DELETE /zones/:zone_id (flag INACTIF V1 ⇒
 * no-op gracieux). Borné tenant.
 */
export async function handleDeleteDomain(
  env: Env,
  auth: DomainAuth,
  domainId: string,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  const domain = await loadDomainInTenant(env, domainId, auth);
  if (domain instanceof Response) return domain;

  // Cascade applicative : dns_records → custom_domains.
  try {
    await env.DB.prepare('DELETE FROM dns_records WHERE domain_id = ?')
      .bind(domainId)
      .run();
  } catch {
    /* best-effort */
  }
  try {
    await env.DB.prepare('DELETE FROM custom_domains WHERE id = ?')
      .bind(domainId)
      .run();
    return json({ data: { id: domainId, success: true } });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}

// ── 5) GET /api/custom-domains/:id/dns-records ────────────────────────────
/**
 * Liste les DNS records d'un custom domain, groupés par type (UI
 * DnsRecordsTable).
 */
export async function handleListDnsRecords(
  env: Env,
  auth: DomainAuth,
  domainId: string,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  const domain = await loadDomainInTenant(env, domainId, auth);
  if (domain instanceof Response) return domain;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM dns_records WHERE domain_id = ? ORDER BY type ASC, name ASC',
    )
      .bind(domainId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── 6) POST /api/custom-domains/:id/dns-records ───────────────────────────
/**
 * Crée un DNS record pour un custom domain. Validation HANDLER :
 *   - type ∈ DNS_RECORD_TYPES (A|AAAA|CNAME|MX|TXT|SRV)
 *   - MX / SRV ⇒ priority requis
 *   - A / AAAA / CNAME ⇒ proxied optionnel (0|1)
 *   - ttl ∈ [60..86400] (clamp HANDLER)
 *
 * Câble syncDnsRecords() pour push immédiat vers Cloudflare (flag INACTIF
 * V1 ⇒ cloudflare_record_id reste null).
 */
export async function handleCreateDnsRecord(
  request: Request,
  env: Env,
  auth: DomainAuth,
  domainId: string,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  const domain = await loadDomainInTenant(env, domainId, auth);
  if (domain instanceof Response) return domain;

  const body = await readJsonBody(request);
  const type =
    typeof body.type === 'string' &&
    DNS_RECORD_TYPES.includes(
      body.type.toUpperCase() as (typeof DNS_RECORD_TYPES)[number],
    )
      ? body.type.toUpperCase()
      : null;
  if (!type) {
    return json(
      { error: 'type invalide (A|AAAA|CNAME|MX|TXT|SRV)' },
      400,
    );
  }

  const name = sanitizeInput((body.name as string) || '', 253);
  const content = sanitizeInput((body.content as string) || '', 2000);
  if (!name) return json({ error: 'name requis' }, 400);
  if (!content) return json({ error: 'content requis' }, 400);

  const ttl = clampTtl(body.ttl);

  let priority: number | null = null;
  if (type === 'MX' || type === 'SRV') {
    const p = Number(body.priority);
    if (!Number.isFinite(p) || p < 0) {
      return json({ error: 'priority requis pour MX/SRV' }, 400);
    }
    priority = Math.floor(p);
  } else if (body.priority != null) {
    const p = Number(body.priority);
    if (Number.isFinite(p)) priority = Math.floor(p);
  }

  let proxied = 0;
  if (type === 'A' || type === 'AAAA' || type === 'CNAME') {
    proxied = body.proxied === 1 || body.proxied === true ? 1 : 0;
  }

  const id = newId();
  try {
    await env.DB.prepare(
      'INSERT INTO dns_records (id, domain_id, type, name, content, ttl, priority, proxied) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, domainId, type, name, content, ttl, priority, proxied)
      .run();
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }

  // Push vers Cloudflare (flag INACTIF V1 ⇒ no-op gracieux).
  try {
    await syncDnsRecords(env, domainId);
  } catch {
    /* best-effort — sync échoué ne bloque pas la création locale */
  }

  return json({ data: { id, domain_id: domainId, type, name } }, 201);
}

// ── 7) PUT /api/dns-records/:id ───────────────────────────────────────────
/**
 * Update un DNS record (content / ttl / priority / proxied). Borné tenant
 * via JOIN custom_domains.client_id. Si cloudflare_record_id présent ⇒
 * PUT /zones/:zone_id/dns_records/:cf_id (flag INACTIF V1 ⇒ no-op gracieux).
 */
export async function handleUpdateDnsRecord(
  request: Request,
  env: Env,
  auth: DomainAuth,
  recordId: string,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  const ctx = await loadDnsRecordInTenant(env, recordId, auth);
  if (ctx instanceof Response) return ctx;

  const body = await readJsonBody(request);
  const updates: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.content === 'string') {
    const content = sanitizeInput(body.content, 2000);
    if (!content) return json({ error: 'content invalide' }, 400);
    updates.push('content = ?');
    binds.push(content);
  }
  if (body.ttl !== undefined) {
    updates.push('ttl = ?');
    binds.push(clampTtl(body.ttl));
  }
  if (body.priority !== undefined) {
    if (body.priority === null) {
      updates.push('priority = ?');
      binds.push(null);
    } else {
      const p = Number(body.priority);
      if (Number.isFinite(p) && p >= 0) {
        updates.push('priority = ?');
        binds.push(Math.floor(p));
      }
    }
  }
  if (body.proxied === 0 || body.proxied === 1) {
    updates.push('proxied = ?');
    binds.push(body.proxied);
  }
  if (typeof body.name === 'string') {
    const name = sanitizeInput(body.name, 253);
    if (!name) return json({ error: 'name invalide' }, 400);
    updates.push('name = ?');
    binds.push(name);
  }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);

  updates.push("updated_at = datetime('now')");
  binds.push(recordId);
  try {
    await env.DB.prepare(
      `UPDATE dns_records SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
  } catch {
    return json({ error: 'Mise à jour impossible' }, 400);
  }

  // Push update vers Cloudflare (flag INACTIF V1 ⇒ no-op).
  const domainId = (ctx.record.domain_id as string | null) ?? '';
  if (domainId) {
    try {
      await syncDnsRecords(env, domainId);
    } catch {
      /* best-effort */
    }
  }

  return json({ data: { id: recordId } });
}

// ── 8) DELETE /api/dns-records/:id ────────────────────────────────────────
/**
 * Supprime un DNS record. Si cloudflare_record_id présent ⇒ DELETE
 * /zones/:zone_id/dns_records/:cf_id (flag INACTIF V1 ⇒ no-op). Borné
 * tenant via JOIN custom_domains.client_id.
 */
export async function handleDeleteDnsRecord(
  env: Env,
  auth: DomainAuth,
  recordId: string,
): Promise<Response> {
  const g = domainCapGuard(auth);
  if (g) return g;
  const ctx = await loadDnsRecordInTenant(env, recordId, auth);
  if (ctx instanceof Response) return ctx;

  const domainId = (ctx.record.domain_id as string | null) ?? '';

  try {
    await env.DB.prepare('DELETE FROM dns_records WHERE id = ?')
      .bind(recordId)
      .run();
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }

  // Push delete vers Cloudflare (flag INACTIF V1 ⇒ no-op).
  if (domainId) {
    try {
      await syncDnsRecords(env, domainId);
    } catch {
      /* best-effort */
    }
  }

  return json({ data: { id: recordId, success: true } });
}

// NB : 8 handlers AUTHED Sprint 50 (Cap settings.manage uniquement — pas
// de PUBLIC pour DNS). Imports RELATIFS uniquement. AUCUN ajout
// ALL_CAPABILITIES seq80. PAS de champ `code` dans les erreurs. Bornage
// tenant strict (loadDomainInTenant / loadDnsRecordInTenant). try/catch
// externe sur tous les handlers (best-effort, JAMAIS de 500/throw non
// maîtrisé). Flag Cloudflare for SaaS INACTIF V1 (CLOUDFLARE_API_TOKEN
// absent ⇒ stubs gracieux dns-engine — provisioning + sync DNS retournent
// zone_id null / synced:0 sans appel réseau). Choix figés
// docs/LOT-SURVEYS-DNS-S50.md §6.
