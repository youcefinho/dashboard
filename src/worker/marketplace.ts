// ── marketplace.ts — LOT G7 Marketplace templates (Phase A SOLO) ────────────
//
// Handlers backend du marketplace de TEMPLATES partageables cross-tenant
// (kind = 'funnel' | 'workflow' | 'sequence'). Un publisher fige un SNAPSHOT
// STRIPPÉ de la structure d'une de ses entités ; les autres tenants installent
// = CLONE chez eux via la create-logic EXISTANTE (funnels.ts / workflows.ts /
// sequences.ts — moteurs NON réécrits).
//
// ⚠ CORPS RÉELS PHASE B (Manager-B) — signatures FIGÉES Phase A. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS : worker.ts
//   (gelé Phase A) câble déjà ces handlers. Contrat §6 verbatim dans
//   docs/LOT-MARKETPLACE-G7.md.
//
// ⚠ FLAG #1 CROSS-TENANT (Phase B) — `stripContentForPublish` est LE choke-point
//   de sécurité. content_json est exposé PUBLIQUEMENT : il ne doit contenir QUE
//   la STRUCTURE (allowlist). JAMAIS : client_id/agency_id, lead/email/enrollment
//   réel, id interne réutilisable. Strip par kind :
//     - funnel   → calque EXACTEMENT funnels.ts:756 handlePublicFunnelGet
//                  ({name,description,industry,steps[{name,step_type,position,
//                   page:{title,blocks,seo}}]}). ids RE-GÉNÉRÉS à l'install.
//     - workflow → QUE {name, trigger_type, trigger_config, steps[{step_order,
//                  step_type, config}]}. config steps email/sms : garder QUE
//                  subject/body TEMPLATE (placeholders {{}}), JAMAIS adresse/lead
//                  réel. trigger_config NEUTRALISÉ (pas d'ids de listes tenant).
//     - sequence → identique workflow (sequence = workflow is_sequence=1).
//
// Conventions imposées (docs/LOT-MARKETPLACE-G7.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS).
//   - Garde capability : requireCapability(auth.capabilities, 'workflows.manage')
//     en tête des handlers PROTÉGÉS (réutilise la capability EXISTANTE — AUCUN
//     ajout à ALL_CAPABILITIES). GET listing(s) = PUBLIC (pré-requireAuth, AUCUN
//     auth).
//   - Bornage tenant : publisher/installer/reviewer_client_id viennent TOUJOURS
//     de l'auth (jamais du body). Install clone chez auth.tenant.clientId.
//   - Monétisation HORS v1 : price_cents jamais lu pour un paiement (zéro E4/E6).
//   - packs.ts / funnels.ts / workflows.ts / sequences.ts = READ-ONLY (réutilisés
//     en lecture / via leur create-logic à l'install).
//   - best-effort : table seq 96 absente / panne D1 → réponse propre
//     ({data:[]} / 404), JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { handleCreateFunnel, handleSaveFunnelPage } from './funnels';
import { handleCreateWorkflow } from './workflows';
import { handleCreateSequence } from './sequences';

// Auth enrichi au choke-point (worker.ts) — calque funnels.ts:FunnelAuth.
type MarketplaceAuth = CapAuth & { capabilities?: Set<string> };

// kind d'un template marketplace (validé HANDLER, pas par CHECK SQL).
export type MarketplaceKind = 'funnel' | 'workflow' | 'sequence';

const KINDS: ReadonlySet<string> = new Set(['funnel', 'workflow', 'sequence']);

// ── Garde capability (calque funnels.ts:capGuard) ───────────────────────────
// Réutilise 'workflows.manage' (déjà dans ALL_CAPABILITIES). Legacy/mono-tenant
// → set LARGE ⇒ pas de régression ; bridage viewer actif seulement en agence.
function capGuard(auth: MarketplaceAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// client_id de bornage du tenant courant (calque funnels.ts:170). En legacy/
// mono-tenant ⇒ null (jointure publisher/installer/reviewer NULLABLE). JAMAIS
// lu depuis le body — toujours depuis l'auth.
function tenantClientId(auth: MarketplaceAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// ── FLAG #1 — strip allowlist AU PUBLISH (choke-point cross-tenant) ──────────
// Sérialise QUE la STRUCTURE de `sourceData` selon `kind` (allowlist stricte —
// cf. en-tête FLAG #1). Renvoie l'objet à stocker dans content_json. JAMAIS de
// donnée tenant (client_id/agency_id/lead/email réel/id interne réutilisable).
// Construction CHAMP PAR CHAMP (allowlist, jamais de spread d'objet brut).

// Sous-strip d'une config de step workflow/sequence : neutralise toute
// référence tenant (template_id de mail/email réelle/ids de listes/tags). On
// GARDE QUE les champs « template » sûrs (subject/body avec placeholders {{}},
// message SMS template, delais/branches structurels). AUCUN id réutilisable.
function stripWorkflowStepConfig(rawConfig: unknown): Record<string, unknown> {
  let cfg: Record<string, unknown> = {};
  if (typeof rawConfig === 'string') {
    try {
      const parsed = JSON.parse(rawConfig);
      if (parsed && typeof parsed === 'object') cfg = parsed as Record<string, unknown>;
    } catch {
      cfg = {};
    }
  } else if (rawConfig && typeof rawConfig === 'object') {
    cfg = rawConfig as Record<string, unknown>;
  }

  const out: Record<string, unknown> = {};
  // Contenu TEMPLATE textuel (placeholders {{}} préservés tels quels).
  if (typeof cfg.subject === 'string') out.subject = cfg.subject;
  if (typeof cfg.body === 'string') out.body = cfg.body;
  if (typeof cfg.message === 'string') out.message = cfg.message;
  // Structure de contrôle de flux (zéro donnée tenant) : délais, branches,
  // opérateurs de condition, libellés. On NE garde QUE des primitives sûres.
  if (typeof cfg.delay_minutes === 'number') out.delay_minutes = cfg.delay_minutes;
  if (typeof cfg.wait_type === 'string') out.wait_type = cfg.wait_type;
  if (typeof cfg.wait_time === 'string') out.wait_time = cfg.wait_time;
  if (typeof cfg.field === 'string') out.field = cfg.field;
  if (typeof cfg.operator === 'string') out.operator = cfg.operator;
  if (typeof cfg.value === 'string') out.value = cfg.value;
  if (typeof cfg.tag === 'string') out.tag = cfg.tag;
  if (typeof cfg.status === 'string') out.status = cfg.status;
  if (typeof cfg.title === 'string') out.title = cfg.title;
  if (typeof cfg.description === 'string') out.description = cfg.description;
  if (typeof cfg.priority === 'string') out.priority = cfg.priority;
  // SUPPRIMÉ EXPLICITEMENT (jamais sérialisé) : template_id, to_email, url,
  // workflow_id, field_id, assigned_to, stage_id, pipeline_id, deal_value,
  // tout id de liste/tag/lead/destinataire référençant la base du tenant.
  return out;
}

// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
export function stripContentForPublish(
  kind: MarketplaceKind,
  sourceData: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === 'funnel') {
    // Calque EXACTEMENT funnels.ts:756 handlePublicFunnelGet (strip PROUVÉ) :
    // {name, description, industry, steps[{name, step_type, position,
    //  page:{title, blocks, seo_*}}]}. AUCUN id interne / client_id / agency_id.
    const stepsIn = Array.isArray(sourceData.steps)
      ? (sourceData.steps as Array<Record<string, unknown>>)
      : [];
    const steps = stepsIn.map((s, idx) => {
      const pageIn =
        s.page && typeof s.page === 'object'
          ? (s.page as Record<string, unknown>)
          : null;
      let blocks: unknown = [];
      if (pageIn) {
        if (Array.isArray(pageIn.blocks)) blocks = pageIn.blocks;
        else if (typeof pageIn.blocks === 'string') {
          try {
            blocks = JSON.parse(pageIn.blocks || '[]');
          } catch {
            blocks = [];
          }
        }
      }
      return {
        name: typeof s.name === 'string' ? s.name : 'Étape',
        step_type: typeof s.step_type === 'string' ? s.step_type : 'content',
        position: typeof s.position === 'number' ? s.position : idx,
        page: pageIn
          ? {
              title: typeof pageIn.title === 'string' ? pageIn.title : '',
              blocks,
              seo_title:
                typeof pageIn.seo_title === 'string' ? pageIn.seo_title : null,
              seo_description:
                typeof pageIn.seo_description === 'string'
                  ? pageIn.seo_description
                  : null,
              seo_image:
                typeof pageIn.seo_image === 'string' ? pageIn.seo_image : null,
            }
          : null,
      };
    });
    return {
      name: typeof sourceData.name === 'string' ? sourceData.name : '',
      description:
        typeof sourceData.description === 'string' ? sourceData.description : '',
      industry:
        typeof sourceData.industry === 'string' ? sourceData.industry : null,
      steps,
    };
  }

  // workflow | sequence : {name, trigger_type, trigger_config NEUTRALISÉ,
  // steps[{step_order, step_type, config strippé}]}. trigger_config est
  // RAMENÉ À {} (il peut contenir des ids de listes/tags/quiet_hours tenant —
  // neutralisation totale ; seul le type de déclencheur est porteur de sens).
  const stepsIn = Array.isArray(sourceData.steps)
    ? (sourceData.steps as Array<Record<string, unknown>>)
    : [];
  const steps = stepsIn.map((s, idx) => ({
    step_order: typeof s.step_order === 'number' ? s.step_order : idx,
    step_type: typeof s.step_type === 'string' ? s.step_type : 'wait',
    config: stripWorkflowStepConfig(s.config),
  }));
  return {
    name: typeof sourceData.name === 'string' ? sourceData.name : '',
    trigger_type:
      typeof sourceData.trigger_type === 'string'
        ? sourceData.trigger_type
        : 'manual',
    trigger_config: {},
    steps,
  };
}

// ── Charge une entité source BORNÉE au tenant courant (publish). ─────────────
// funnel  → funnel + steps (ordonnés) + pages (relation 1:1) reconstruits comme
//           handleGetFunnel, pour que stripContentForPublish('funnel', …)
//           reçoive {name, description, industry, steps[{…, page}]}.
// workflow→ workflow (is_sequence=0) + steps ordonnés.
// sequence→ workflow is_sequence=1 + steps ordonnés.
// Bornage : legacy/mono-tenant (agencyId == null) ⇒ pas de garde nouvelle ;
// mode agence ⇒ client_id ∈ accessibleClientIds OU agency_id == tenant.
// Renvoie l'objet source (à stripper) ou null (introuvable / hors tenant).
async function loadSourceForPublish(
  env: Env,
  kind: MarketplaceKind,
  sourceId: string,
  auth: MarketplaceAuth,
): Promise<Record<string, unknown> | null> {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  const inTenant = (
    rowClient: string | null,
    rowAgency: string | null,
  ): boolean => {
    if (isLegacy) return true;
    const agencyId = auth.tenant!.agencyId as string;
    const accessible = auth.tenant!.accessibleClientIds || [];
    return (
      (rowClient != null && accessible.includes(rowClient)) ||
      (rowAgency != null && rowAgency === agencyId)
    );
  };

  try {
    if (kind === 'funnel') {
      const funnel = (await env.DB.prepare('SELECT * FROM funnels WHERE id = ?')
        .bind(sourceId)
        .first()) as Record<string, unknown> | null;
      if (!funnel) return null;
      if (
        !inTenant(
          (funnel.client_id as string | null) ?? null,
          (funnel.agency_id as string | null) ?? null,
        )
      ) {
        return null;
      }
      const { results: stepRows } = await env.DB.prepare(
        'SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY position ASC',
      )
        .bind(sourceId)
        .all();
      const { results: pageRows } = await env.DB.prepare(
        'SELECT * FROM funnel_pages WHERE funnel_id = ?',
      )
        .bind(sourceId)
        .all();
      const pagesByStep = new Map<string, Record<string, unknown>>();
      for (const p of (pageRows || []) as Array<Record<string, unknown>>) {
        pagesByStep.set(p.step_id as string, p);
      }
      const steps = ((stepRows || []) as Array<Record<string, unknown>>).map(
        (s) => ({ ...s, page: pagesByStep.get(s.id as string) ?? null }),
      );
      return { ...funnel, steps };
    }

    // workflow | sequence : même table workflows (is_sequence discrimine).
    const wantSequence = kind === 'sequence' ? 1 : 0;
    const workflow = (await env.DB.prepare(
      'SELECT * FROM workflows WHERE id = ?',
    )
      .bind(sourceId)
      .first()) as Record<string, unknown> | null;
    if (!workflow) return null;
    // Le kind demandé doit correspondre au flag is_sequence (un workflow n'est
    // pas publiable comme 'sequence' et vice-versa).
    if (Number(workflow.is_sequence || 0) !== wantSequence) return null;
    // Bornage : workflows porte client_id (pas d'agency_id) — agence ⇒ doit
    // appartenir au périmètre client.
    if (!inTenant((workflow.client_id as string | null) ?? null, null)) {
      return null;
    }
    const { results: stepRows } = await env.DB.prepare(
      'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC',
    )
      .bind(sourceId)
      .all();
    return { ...workflow, steps: stepRows || [] };
  } catch {
    // Table absente / panne D1 : best-effort → introuvable.
    return null;
  }
}

// ── PUBLIC : liste des templates publiés (cross-tenant, lecture seule) ───────
// GET /api/marketplace/listings — SANS content_json lourd (juste métadonnées
// + compteurs). Pré-requireAuth : AUCUN auth, AUCUN bornage (catalogue public).
// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
export async function handleGetMarketplaceListings(
  env: Env,
  url: URL,
): Promise<Response> {
  try {
    // Projection liste : PAS de content_json (lourd) ni de publisher_*_id
    // (donnée tenant). Filtres optionnels kind/category.
    const conds: string[] = ["status = 'published'"];
    const binds: unknown[] = [];
    const kind = url.searchParams.get('kind');
    if (kind && KINDS.has(kind)) {
      conds.push('kind = ?');
      binds.push(kind);
    }
    const category = url.searchParams.get('category');
    if (category) {
      conds.push('category = ?');
      binds.push(sanitizeInput(category, 80));
    }
    // Recherche texte ?q= : LIKE sur title/description (colonnes EXISTANTES).
    // STRICTEMENT param-bindé (sanitizeInput puis %…% en bind) — JAMAIS
    // d'interpolation de la valeur user dans le SQL. Combinable avec kind/category.
    const q = url.searchParams.get('q');
    if (q && q.trim() !== '') {
      const like = `%${sanitizeInput(q, 120)}%`;
      conds.push('(title LIKE ? OR description LIKE ?)');
      binds.push(like, like);
    }
    // Tri ?sort= WHITELISTÉ : mapping en dur vers une clause ORDER BY CONSTANTE
    // (anti-injection — la valeur user n'est JAMAIS interpolée dans le SQL).
    // Inconnu / absent ⇒ tri par défaut ACTUEL (popular) PRÉSERVÉ.
    const sort = url.searchParams.get('sort');
    let orderBy: string;
    switch (sort) {
      case 'recent':
        orderBy = 'created_at DESC';
        break;
      case 'rating':
        orderBy = 'rating_avg DESC, rating_count DESC';
        break;
      case 'popular':
      default:
        orderBy = 'install_count DESC, created_at DESC';
        break;
    }
    const sql = `SELECT id, kind, title, description, category, install_count,
         rating_avg, rating_count, created_at
       FROM marketplace_listings
       WHERE ${conds.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 200`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch {
    // Table seq 96 absente / panne D1 : best-effort → catalogue vide.
    return json({ data: [] });
  }
}

// ── PUBLIC : détail d'un listing publié (content_json STRIPPÉ + reviews) ─────
// GET /api/marketplace/listings/:id — content_json déjà strippé au publish
// (FLAG #1) ⇒ exposable tel quel. Pré-requireAuth.
// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
export async function handleGetMarketplaceListing(
  env: Env,
  id: string,
): Promise<Response> {
  try {
    // PAS de publisher_*_id exposé (donnée tenant) ; content_json déjà strippé.
    const listing = (await env.DB.prepare(
      `SELECT id, kind, title, description, category, content_json,
         install_count, rating_avg, rating_count, created_at
       FROM marketplace_listings WHERE id = ? AND status = 'published'`,
    )
      .bind(id)
      .first()) as Record<string, unknown> | null;
    if (!listing) return json({ error: 'Template introuvable' }, 404);

    // content_json → objet (déjà strippé au publish ; best-effort si corrompu).
    let content: unknown = {};
    try {
      content = JSON.parse((listing.content_json as string) || '{}');
    } catch {
      content = {};
    }

    const { results: reviews } = await env.DB.prepare(
      `SELECT id, rating, comment, created_at
       FROM marketplace_reviews WHERE listing_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(id)
      .all();

    return json({
      data: {
        listing: { ...listing, content_json: undefined, content },
        reviews: reviews || [],
      },
    });
  } catch {
    return json({ error: 'Template introuvable' }, 404);
  }
}

// ── PROTÉGÉ : publier un template au marketplace ─────────────────────────────
// POST /api/marketplace/listings — body { kind, source_id, title, description,
// category, status? }. Charge l'entité source BORNÉE au tenant (auth), applique
// stripContentForPublish (FLAG #1), INSERT marketplace_listings
// (publisher_client_id depuis auth, status='published' par défaut). capGuard.
// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
export async function handlePublishMarketplaceListing(
  request: Request,
  env: Env,
  auth: MarketplaceAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const kind = body.kind as string;
  if (!KINDS.has(kind)) {
    return json({ error: 'Type de template invalide' }, 400);
  }
  const sourceId = sanitizeInput(body.source_id as string, 100);
  if (!sourceId) {
    return json({ error: 'source_id requis' }, 400);
  }

  // Charge la source BORNÉE au tenant courant (404 si hors périmètre / absente).
  const source = await loadSourceForPublish(
    env,
    kind as MarketplaceKind,
    sourceId,
    auth,
  );
  if (!source) return json({ error: 'Source introuvable' }, 404);

  // FLAG #1 — strip allowlist (zéro donnée tenant) AVANT toute persistance.
  const stripped = stripContentForPublish(kind as MarketplaceKind, source);

  const id = crypto.randomUUID();
  const title = sanitizeInput(
    (body.title as string) || (stripped.name as string) || 'Template',
    200,
  );
  const description = sanitizeInput((body.description as string) || '', 1000);
  const category = sanitizeInput((body.category as string) || kind, 80);
  // status : 'draft' explicite OU 'published' (défaut).
  const status = body.status === 'draft' ? 'draft' : 'published';

  // Bornage : publisher_*_id TOUJOURS depuis l'auth (JAMAIS le body).
  const publisherClientId = tenantClientId(auth);
  const publisherAgencyId = auth.tenant?.agencyId ?? null;

  try {
    await env.DB.prepare(
      `INSERT INTO marketplace_listings
         (id, publisher_client_id, publisher_agency_id, kind, title, description,
          category, content_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        publisherClientId,
        publisherAgencyId,
        kind,
        title,
        description,
        category,
        JSON.stringify(stripped),
        status,
      )
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Publication impossible' }, 404);
  }
}

// ── PROTÉGÉ : installer un template (CLONE chez le tenant courant) ────────────
// POST /api/marketplace/listings/:id/install — clone l'entité depuis le
// content_json STRIPPÉ via la create-logic EXISTANTE (handleCreateFunnel +
// handleSaveFunnelPage / handleCreateWorkflow / handleCreateSequence). Le
// installer_client_id vient de auth (JAMAIS du body). INSERT marketplace_installs
// + UPDATE install_count. capGuard.
// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
//
// La create-logic existante consomme `request.json()` ⇒ on lui fournit un
// Request SYNTHÉTIQUE portant le body construit depuis le content_json strippé
// (zéro réécriture du moteur de création). Le request d'install d'origine n'est
// PAS réutilisé (son body est l'install, pas la définition d'entité).
function synthRequest(payload: Record<string, unknown>): Request {
  return new Request('https://internal/marketplace-install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function handleInstallMarketplaceListing(
  _request: Request,
  env: Env,
  auth: MarketplaceAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  // Charge le listing publié (404 sinon).
  let listing: Record<string, unknown> | null = null;
  try {
    listing = (await env.DB.prepare(
      "SELECT id, kind, content_json FROM marketplace_listings WHERE id = ? AND status = 'published'",
    )
      .bind(id)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Template introuvable' }, 404);
  }
  if (!listing) return json({ error: 'Template introuvable' }, 404);

  const kind = listing.kind as MarketplaceKind;
  let content: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse((listing.content_json as string) || '{}');
    if (parsed && typeof parsed === 'object') {
      content = parsed as Record<string, unknown>;
    }
  } catch {
    content = {};
  }

  const installerClientId = tenantClientId(auth);
  let installedId = '';

  try {
    if (kind === 'funnel') {
      // CLONE via handleCreateFunnel (pose client_id/agency_id depuis l'auth).
      // Étapes créées sans page (la page strippée est réécrite ensuite via
      // handleSaveFunnelPage, par stepId retourné dans le détail).
      const stepsIn = Array.isArray(content.steps)
        ? (content.steps as Array<Record<string, unknown>>)
        : [];
      const createRes = await handleCreateFunnel(
        synthRequest({
          name: content.name || 'Template installé',
          description: content.description || '',
          industry: content.industry || '',
          status: 'draft',
          steps: stepsIn.map((s) => ({
            name: s.name,
            step_type: s.step_type,
          })),
        }),
        env,
        auth as never,
      );
      if (createRes.status !== 201) return createRes;
      const created = (await createRes.clone().json()) as {
        data?: { id?: string };
      };
      const funnelId = created?.data?.id || '';
      installedId = funnelId;

      // Réécrit les blocs/SEO de chaque page via handleSaveFunnelPage
      // (best-effort : on récupère les stepIds neufs depuis funnel_steps).
      if (funnelId && stepsIn.length > 0) {
        try {
          const { results: newSteps } = await env.DB.prepare(
            'SELECT id, position FROM funnel_steps WHERE funnel_id = ? ORDER BY position ASC',
          )
            .bind(funnelId)
            .all();
          const stepArr = (newSteps || []) as Array<{
            id: string;
            position: number;
          }>;
          for (let i = 0; i < stepArr.length && i < stepsIn.length; i++) {
            const src = stepsIn[i];
            const page =
              src && src.page && typeof src.page === 'object'
                ? (src.page as Record<string, unknown>)
                : null;
            if (!page) continue;
            await handleSaveFunnelPage(
              synthRequest({
                title: page.title || '',
                blocks: Array.isArray(page.blocks) ? page.blocks : [],
                seo_title: page.seo_title || '',
                seo_description: page.seo_description || '',
                seo_image: page.seo_image || '',
              }),
              env,
              auth as never,
              funnelId,
              stepArr[i]!.id,
            );
          }
        } catch {
          /* best-effort : le funnel est créé même si une page échoue */
        }
      }
    } else {
      // workflow | sequence : CLONE via la create-logic existante. On force
      // client_id = tenant courant dans le body synthétique (bornage strict —
      // handleCreateWorkflow lit client_id du body ; on n'y met JAMAIS de
      // valeur issue d'un autre tenant). trigger_config est neutralisé ('{}').
      const stepsIn = Array.isArray(content.steps)
        ? (content.steps as Array<Record<string, unknown>>)
        : [];
      const payload = {
        name: content.name || 'Template installé',
        description: '',
        trigger_type: content.trigger_type || 'manual',
        trigger_config: '{}',
        client_id: installerClientId,
        steps: stepsIn.map((s, idx) => ({
          step_order: typeof s.step_order === 'number' ? s.step_order : idx,
          step_type: s.step_type || 'wait',
          config: JSON.stringify(
            s.config && typeof s.config === 'object' ? s.config : {},
          ),
        })),
      };
      const createRes =
        kind === 'sequence'
          ? await handleCreateSequence(synthRequest(payload), env, auth as never)
          : await handleCreateWorkflow(synthRequest(payload), env, auth as never);
      if (createRes.status !== 201) return createRes;
      const created = (await createRes.clone().json()) as {
        data?: { id?: string };
      };
      installedId = created?.data?.id || '';
    }

    // Trace d'install + compteur dénormalisé (installer_client_id depuis auth).
    try {
      await env.DB.prepare(
        `INSERT INTO marketplace_installs
           (id, listing_id, installer_client_id, installed_kind, installed_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), id, installerClientId, kind, installedId)
        .run();
      await env.DB.prepare(
        'UPDATE marketplace_listings SET install_count = install_count + 1, updated_at = datetime(\'now\') WHERE id = ?',
      )
        .bind(id)
        .run();
    } catch {
      /* best-effort : l'entité clonée existe même si la trace échoue */
    }

    return json({ data: { installed_id: installedId } }, 201);
  } catch {
    return json({ error: 'Installation impossible' }, 404);
  }
}

// ── PROTÉGÉ : noter un template (review) ─────────────────────────────────────
// POST /api/marketplace/listings/:id/reviews — body { rating (1..5), comment }.
// reviewer_client_id depuis auth (JAMAIS body). Unicité 1 review/tenant/listing
// APPLICATIVE (UPDATE l'existante au lieu d'un doublon). MAJ rating_avg /
// rating_count dénormalisés. capGuard.
// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
export async function handleReviewMarketplaceListing(
  request: Request,
  env: Env,
  auth: MarketplaceAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const rating = Math.round(Number(body.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return json({ error: 'Note invalide (1 à 5)' }, 400);
  }
  const comment = sanitizeInput((body.comment as string) || '', 2000);
  const reviewerClientId = tenantClientId(auth);

  try {
    // Le listing doit exister et être publié (review d'un template public).
    const listing = (await env.DB.prepare(
      "SELECT id FROM marketplace_listings WHERE id = ? AND status = 'published'",
    )
      .bind(id)
      .first()) as { id: string } | null;
    if (!listing) return json({ error: 'Template introuvable' }, 404);

    // Unicité APPLICATIVE : 1 review / tenant / listing. UPDATE si déjà présent.
    const existing = (await env.DB.prepare(
      'SELECT id FROM marketplace_reviews WHERE listing_id = ? AND reviewer_client_id IS ? LIMIT 1',
    )
      .bind(id, reviewerClientId)
      .first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        'UPDATE marketplace_reviews SET rating = ?, comment = ? WHERE id = ?',
      )
        .bind(rating, comment, existing.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO marketplace_reviews
           (id, listing_id, reviewer_client_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), id, reviewerClientId, rating, comment)
        .run();
    }

    // Recalcul des agrégats dénormalisés (source de vérité = la table reviews).
    const agg = (await env.DB.prepare(
      'SELECT COUNT(*) as cnt, AVG(rating) as avg FROM marketplace_reviews WHERE listing_id = ?',
    )
      .bind(id)
      .first()) as { cnt: number; avg: number | null } | null;
    const ratingCount = Number(agg?.cnt || 0);
    const ratingAvg = agg?.avg != null ? Number(agg.avg) : 0;
    await env.DB.prepare(
      "UPDATE marketplace_listings SET rating_avg = ?, rating_count = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(ratingAvg, ratingCount, id)
      .run();

    return json({ data: { rating_avg: ratingAvg, rating_count: ratingCount } });
  } catch {
    return json({ error: 'Avis impossible' }, 404);
  }
}

// ── PROTÉGÉ : mes publications (listings du tenant courant) ──────────────────
// GET /api/marketplace/my-listings — listings dont publisher_client_id = tenant
// courant (draft + published). capGuard.
// CORPS RÉEL Phase B Manager-B — signature FIGÉE.
export async function handleGetMyMarketplaceListings(
  env: Env,
  auth: MarketplaceAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const clientId = tenantClientId(auth);
  try {
    // Bornage : publisher_client_id = tenant courant (depuis auth). En legacy
    // (clientId null) on retourne les listings publiés avec publisher null
    // (mono-tenant : tout lui appartient — IS ? gère NULL proprement).
    const { results } = await env.DB.prepare(
      `SELECT id, kind, title, description, category, status, install_count,
         rating_avg, rating_count, created_at, updated_at
       FROM marketplace_listings
       WHERE publisher_client_id IS ?
       ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(clientId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}
