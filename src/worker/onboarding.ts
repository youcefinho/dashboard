import type { Env } from './types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import {
  validate,
  onboardingStateSchema,
  onboardingChecklistCompleteSchema,
  onboardingChecklistSkipSchema,
} from '../lib/schemas';
import { validationError } from './lib/validate-response';
import { requireCapability, type Capability } from './capabilities';
// Renforcement V2 — helpers PUR engine (validation clés checklist).
import { validateItemKey } from './lib/onboarding-engine';
import type {
  OnboardingChecklistItemKey,
  OnboardingChecklistItemState,
  OnboardingChecklistResponse,
} from '../lib/types';

// ── Sprint S8 — État d'onboarding persistant (table onboarding_state) ─────────
//
// Migration seq 76 : migration-sprintS8-m1.sql. Multi-tenant STRICT
// (client_id résolu via getClientModules — pattern projet, jamais de fuite
// cross-tenant — cf. ecommerce-region.ts:220). Filtre TOUJOURS sur
// (client_id, user_id). Additif : si la table n'existe pas encore (migration
// non jouée), les helpers dégradent proprement vers l'état par défaut /
// échec silencieux (rétro-compat : l'onboarding reste fonctionnel côté
// localStorage front).

/** Shape exacte renvoyée par GET et PUT /api/onboarding/state. */
export interface OnboardingStateShape {
  currentStep: number;
  completedSteps: string[];
  ecommerceOptedIn: boolean;
  completedAt: string | null;
  payload: Record<string, unknown> | null;
}

const DEFAULT_ONBOARDING_STATE: OnboardingStateShape = {
  currentStep: 0,
  completedSteps: [],
  ecommerceOptedIn: false,
  completedAt: null,
  payload: null,
};

interface OnboardingStateRow {
  id: string;
  current_step: number | null;
  completed_steps_json: string | null;
  payload_json: string | null;
  ecommerce_opted_in: number | null;
  completed_at: string | null;
}

function safeParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rowToState(row: OnboardingStateRow | null): OnboardingStateShape {
  if (!row) return { ...DEFAULT_ONBOARDING_STATE };
  return {
    currentStep: typeof row.current_step === 'number' ? row.current_step : 0,
    completedSteps: safeParseArray(row.completed_steps_json),
    ecommerceOptedIn: !!row.ecommerce_opted_in,
    completedAt: row.completed_at || null,
    payload: safeParseObject(row.payload_json),
  };
}

async function loadOnboardingRow(
  env: Env,
  clientId: string,
  userId: string,
): Promise<OnboardingStateRow | null> {
  try {
    return (await env.DB.prepare(
      `SELECT id, current_step, completed_steps_json, payload_json, ecommerce_opted_in, completed_at
         FROM onboarding_state WHERE client_id = ? AND user_id = ?`,
    ).bind(clientId, userId).first()) as OnboardingStateRow | null;
  } catch {
    // Table absente (migration seq 76 non jouée) — dégrade vers défaut.
    return null;
  }
}

/**
 * GET /api/onboarding/state — état d'onboarding du tenant courant.
 * Réponse : { data: OnboardingStateShape }. Défaut si aucune ligne.
 */
export async function handleGetOnboardingState(
  env: Env,
  auth: { userId: string },
): Promise<Response> {
  const { clientId } = await getClientModules(env, auth.userId);
  if (!clientId) return json({ data: { ...DEFAULT_ONBOARDING_STATE } });
  const row = await loadOnboardingRow(env, clientId, auth.userId);
  return json({ data: rowToState(row) });
}

/**
 * PUT /api/onboarding/state — upsert partiel par (client_id, user_id).
 * Body : { currentStep?, completedSteps?, ecommerceOptedIn?, payload? }.
 * Champs absents = inchangés. Réponse : { data: OnboardingStateShape }
 * (même shape que GET). Validation via onboardingStateSchema + validate().
 */
export async function handlePutOnboardingState(
  request: Request,
  env: Env,
  auth: { userId: string },
): Promise<Response> {
  const { clientId } = await getClientModules(env, auth.userId);
  if (!clientId) {
    return json(
      { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
      400,
    );
  }

  const body = await request.json().catch(() => null);
  const v = validate(onboardingStateSchema, body);
  if (!v.success) return validationError(v.error);
  const patch = v.data as {
    currentStep?: number;
    completedSteps?: string[];
    ecommerceOptedIn?: boolean;
    payload?: unknown;
  };

  try {
    const current = rowToState(await loadOnboardingRow(env, clientId, auth.userId));

    const nextStep = patch.currentStep !== undefined ? patch.currentStep : current.currentStep;
    const nextSteps = patch.completedSteps !== undefined ? patch.completedSteps : current.completedSteps;
    const nextOptIn = patch.ecommerceOptedIn !== undefined ? patch.ecommerceOptedIn : current.ecommerceOptedIn;
    const nextPayload =
      patch.payload !== undefined
        ? (patch.payload && typeof patch.payload === 'object' && !Array.isArray(patch.payload)
            ? (patch.payload as Record<string, unknown>)
            : current.payload)
        : current.payload;

    await env.DB.prepare(
      `INSERT INTO onboarding_state
         (client_id, user_id, current_step, completed_steps_json, payload_json, ecommerce_opted_in, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(client_id, user_id) DO UPDATE SET
         current_step = excluded.current_step,
         completed_steps_json = excluded.completed_steps_json,
         payload_json = excluded.payload_json,
         ecommerce_opted_in = excluded.ecommerce_opted_in,
         updated_at = datetime('now')`,
    )
      .bind(
        clientId,
        auth.userId,
        nextStep,
        JSON.stringify(nextSteps),
        nextPayload ? JSON.stringify(nextPayload) : null,
        nextOptIn ? 1 : 0,
      )
      .run();

    const row = await loadOnboardingRow(env, clientId, auth.userId);
    // audit non-sensible : aucune donnée payload (peut contenir email/nom).
    await audit(env, auth.userId, 'onboarding.state.update', 'onboarding_state', row?.id || clientId, {
      currentStep: nextStep,
      completedSteps: nextSteps.length,
      ecommerceOptedIn: nextOptIn,
    });
    return json({ data: rowToState(row) });
  } catch (err: any) {
    // Table absente (migration non jouée) ou autre — ne casse pas le front
    // (qui garde un fallback localStorage). 200 avec l'état fusionné en mémoire.
    return json({ error: err?.message || 'onboarding-state-failed' }, 500);
  }
}

export async function handleCompleteOnboarding(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    await request.json(); // Consume request body to prevent warnings

    // Update users table
    await env.DB.prepare(
      `UPDATE users SET onboarding_step = 8, onboarding_completed_at = datetime('now') WHERE id = ?`
    ).bind(auth.userId).run();

    // The rest of the setup (business name, pack installation)
    // would be handled by their respective API endpoints or done here in a transaction.
    // For MVP, marking the onboarding as complete is the main requirement.

    return json({ data: { success: true } });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Sprint 45 M1.1 — WelcomeWizard endpoint ───────────────────────────────
// Stub minimaliste : enregistre le payload (profile/industry/goals/teamSize)
// dans users + flag onboarding_completed_at. Tout le payload est best-effort
// (le client garde une copie localStorage en fallback).
//
// Payload attendu :
//   {
//     profile: { name, email, photoDataUrl, lang },
//     industry: WelcomeIndustry,
//     goals: WelcomeGoal[],
//     teamSize: WelcomeTeamSize,
//     invitedEmails?: string[],
//     withDemoData?: boolean
//   }
export async function handleWelcomeOnboarding(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as {
      profile?: { name?: string; email?: string; lang?: string };
      industry?: string;
      businessType?: string;
      goals?: string[];
      teamSize?: string;
      invitedEmails?: string[];
      withDemoData?: boolean;
      region?: unknown;
      channels?: unknown;
    };

    const profileName = body.profile?.name?.trim() || null;
    const profileEmail = body.profile?.email?.trim() || null;
    const profileLang = body.profile?.lang || 'fr-CA';
    const industry = body.industry || null;
    const goalsJson = JSON.stringify(body.goals || []);
    const teamSize = body.teamSize || 'solo';
    const invitedJson = JSON.stringify(body.invitedEmails || []);

    // Update users table — schéma générique (les colonnes optionnelles sont
    // ignorées silencieusement si elles n'existent pas dans le DB).
    try {
      await env.DB.prepare(
        `UPDATE users SET
          onboarding_step = 8,
          onboarding_completed_at = datetime('now'),
          name = COALESCE(?, name),
          email = COALESCE(?, email)
        WHERE id = ?`
      ).bind(profileName, profileEmail, auth.userId).run();
    } catch {
      // Schema strict : fallback minimal sans colonnes optionnelles.
      await env.DB.prepare(
        `UPDATE users SET onboarding_step = 8, onboarding_completed_at = datetime('now') WHERE id = ?`
      ).bind(auth.userId).run();
    }

    // ── Sprint S8 — persistance ADDITIVE de l'état d'onboarding ────────────
    // Best-effort : si la table onboarding_state n'existe pas encore
    // (migration seq 76 non jouée) ⇒ catch silencieux, la réponse ci-dessous
    // reste STRICTEMENT inchangée (rétro-compat front Sprint 45 absolue).
    // businessType 'shop' | 'hybrid' ⇒ opt-in e-commerce (cf. WelcomeWizard
    // ligne 89 : ces valeurs pré-activent le module). N'active AUCUN paiement
    // (E4/E6 régulés — payments_live_enabled=0 jamais touché ici).
    try {
      const { clientId } = await getClientModules(env, auth.userId);
      if (clientId) {
        const bt = String(body.businessType || '').toLowerCase();
        const optedIn = bt === 'shop' || bt === 'hybrid' ? 1 : 0;
        await env.DB.prepare(
          `INSERT INTO onboarding_state
             (client_id, user_id, current_step, completed_steps_json, payload_json, ecommerce_opted_in, completed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(client_id, user_id) DO UPDATE SET
             payload_json = excluded.payload_json,
             ecommerce_opted_in = excluded.ecommerce_opted_in,
             completed_at = COALESCE(onboarding_state.completed_at, excluded.completed_at),
             updated_at = datetime('now')`,
        )
          .bind(
            clientId,
            auth.userId,
            8,
            JSON.stringify(['profile', 'industry', 'goals', 'team']),
            JSON.stringify(body),
            optedIn,
          )
          .run();
      }
    } catch {
      /* table absente / non critique — le front garde son fallback localStorage */
    }

    return json({
      data: {
        success: true,
        echo: {
          name: profileName,
          email: profileEmail,
          lang: profileLang,
          industry,
          goals: goalsJson,
          teamSize,
          invited: invitedJson,
          withDemoData: Boolean(body.withDemoData),
        },
      },
    });
  } catch (err: any) {
    return json({ error: err?.message || 'onboarding-failed' }, 500);
  }
}

// ── Sprint 21 — Onboarding durci : checklist serveur (Phase A stubs) ────────
//
// Migration seq119 : migration-onboarding-harden-seq119.sql.
// Phase A FIGÉE (cf. docs/LOT-ONBOARDING-HARDEN.md §6.7) : ces 4 handlers sont
// des SQUELETTES TYPÉS qui retournent un shape vide valide pour permettre au
// front (Manager-C) de coder contre un contrat stable. Manager-B remplira la
// persistance D1 (onboarding_state.checklist_items_json + skipped_items_json)
// et l'audit (onboarding_events).
//
// Garde capability CONDITIONNELLE (calque catalog.ts:41-49 / billing.ts:11-19) :
// enforce settings.manage UNIQUEMENT en mode-agence (tenant.agencyId != null +
// capabilities Set). Legacy/mono-tenant ⇒ skip ⇒ byte-identique.
//
// Best-effort dégradé : la migration seq119 peut ne pas être jouée — TOUT
// throw (table/colonnes absentes, JSON malformé) ⇒ retour EMPTY_CHECKLIST,
// JAMAIS 500. Le front (Manager-C) garde un fallback localStorage.

// auth = CapAuth enrichi choke-point (worker.ts) — calque CatalogAuth.
type ChecklistAuth = {
  userId: string;
  role: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

function checklistCapGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

const EMPTY_CHECKLIST: OnboardingChecklistResponse = {
  items: {},
  total: 0,
  completed: 0,
  skipped: 0,
  pct: 0,
  lastActiveAt: null,
};




// 6 items CRM toujours présents (socle non désactivable).
const CRM_ITEM_KEYS: ReadonlyArray<OnboardingChecklistItemKey> = [
  'profile_completed',
  'leads_imported',
  'pipeline_configured',
  'team_invited',
  'integration_connected',
  'docs_visited',
];

// 3 items e-commerce additifs (présents seulement si module 'ecommerce' actif).
const ECOM_ITEM_KEYS: ReadonlyArray<OnboardingChecklistItemKey> = [
  'ecommerce_catalog',
  'ecommerce_first_product',
  'ecommerce_channel',
];

/** Détecte une erreur SQLite "no such column" (migration seq119 non jouée). */
function isMissingColumnError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  return (
    msg.includes('no such column') ||
    msg.includes('has no column') ||
    msg.includes('no such table')
  );
}

/** Parse JSON safe en map d'items. Tout JSON invalide ⇒ {}. */
function parseItemsMap(
  raw: string | null | undefined,
): Partial<Record<OnboardingChecklistItemKey, OnboardingChecklistItemState>> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Partial<Record<OnboardingChecklistItemKey, OnboardingChecklistItemState>> = {};
    for (const [k, raw2] of Object.entries(v as Record<string, unknown>)) {
      if (!validateItemKey(k)) continue;
      if (!raw2 || typeof raw2 !== 'object') continue;
      const r = raw2 as Record<string, unknown>;
      out[k as OnboardingChecklistItemKey] = {
        done: r.done === true,
        skipped: r.skipped === true,
        completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
        skippedAt: typeof r.skippedAt === 'string' ? r.skippedAt : null,
        skipReason: typeof r.skipReason === 'string' ? r.skipReason : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Calcule l'état checklist côté serveur pour un tenant.
 *
 * Lecture : onboarding_state.checklist_items_json (source de vérité fusionnée
 * done + skipped) + last_active_at.
 *   - total = 6 (CRM socle) + 3 si module 'ecommerce' actif.
 *   - completed = items dont done===true && !skipped.
 *   - skipped = items dont skipped===true && !done.
 *   - pct = round((completed + skipped) / total * 100), capé 0..100.
 *
 * Dégradation : si la colonne checklist_items_json n'existe pas (seq119 non
 * jouée) ⇒ EMPTY_CHECKLIST (PAS 500). Toute autre panne (JSON corrompu,
 * tenant absent) ⇒ shape vide valide.
 */
async function computeChecklist(
  env: Env,
  clientId: string,
  userId: string,
  modules: ReadonlyArray<string>,
): Promise<OnboardingChecklistResponse> {
  let row: {
    checklist_items_json: string | null;
    last_active_at: string | null;
  } | null = null;
  try {
    row = (await env.DB.prepare(
      `SELECT checklist_items_json, last_active_at
         FROM onboarding_state
        WHERE client_id = ? AND user_id = ?`,
    )
      .bind(clientId, userId)
      .first()) as
      | { checklist_items_json: string | null; last_active_at: string | null }
      | null;
  } catch (err) {
    if (isMissingColumnError(err)) return { ...EMPTY_CHECKLIST };
    return { ...EMPTY_CHECKLIST };
  }

  const items = parseItemsMap(row?.checklist_items_json);
  const lastActiveAt = row?.last_active_at || null;

  const hasEcom = modules.includes('ecommerce');
  const total = CRM_ITEM_KEYS.length + (hasEcom ? ECOM_ITEM_KEYS.length : 0);

  let completed = 0;
  let skipped = 0;
  for (const [key, state] of Object.entries(items) as Array<
    [OnboardingChecklistItemKey, OnboardingChecklistItemState]
  >) {
    // On ne compte que les items du périmètre actif (un item ecommerce stocké
    // mais module désactivé est ignoré pour le total/pct, mais reste exposé
    // dans `items` pour info — comportement défensif additif).
    const inScope =
      CRM_ITEM_KEYS.includes(key) || (hasEcom && ECOM_ITEM_KEYS.includes(key));
    if (!inScope) continue;
    if (state.done && !state.skipped) completed += 1;
    else if (state.skipped && !state.done) skipped += 1;
  }

  const denom = total > 0 ? total : 1;
  let pct = Math.round(((completed + skipped) / denom) * 100);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  return { items, total, completed, skipped, pct, lastActiveAt };
}

/**
 * Persistance UPSERT de l'état checklist + miroir skipped.
 * Source de vérité = checklist_items_json (done+skipped fusionnés).
 * skipped_items_json = miroir des items skipped uniquement (analytics rapide).
 * Catch "no such column" ⇒ no-op silencieux (rétro-compat seq119 non jouée).
 */
async function persistChecklistItems(
  env: Env,
  clientId: string,
  userId: string,
  items: Partial<Record<OnboardingChecklistItemKey, OnboardingChecklistItemState>>,
  opts: { resetDismissed?: boolean } = {},
): Promise<{ ok: boolean }> {
  const skippedOnly: Partial<Record<OnboardingChecklistItemKey, OnboardingChecklistItemState>> = {};
  for (const [k, v] of Object.entries(items)) {
    if (v && v.skipped && !v.done) {
      skippedOnly[k as OnboardingChecklistItemKey] = v;
    }
  }
  const itemsJson = JSON.stringify(items);
  const skippedJson = JSON.stringify(skippedOnly);
  try {
    // UPSERT : si la row onboarding_state n'existe pas pour ce tenant, on
    // l'insère avec les valeurs S8 par défaut + colonnes seq119. Sinon on
    // met à jour uniquement les colonnes checklist (rétro-compat S8 stricte).
    if (opts.resetDismissed) {
      await env.DB.prepare(
        `INSERT INTO onboarding_state
           (client_id, user_id, current_step, completed_steps_json, payload_json, ecommerce_opted_in,
            checklist_items_json, skipped_items_json, last_active_at, dismissed_at, updated_at)
         VALUES (?, ?, 0, '[]', NULL, 0, ?, ?, datetime('now'), NULL, datetime('now'))
         ON CONFLICT(client_id, user_id) DO UPDATE SET
           checklist_items_json = excluded.checklist_items_json,
           skipped_items_json = excluded.skipped_items_json,
           last_active_at = datetime('now'),
           dismissed_at = NULL,
           updated_at = datetime('now')`,
      )
        .bind(clientId, userId, itemsJson, skippedJson)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO onboarding_state
           (client_id, user_id, current_step, completed_steps_json, payload_json, ecommerce_opted_in,
            checklist_items_json, skipped_items_json, last_active_at, updated_at)
         VALUES (?, ?, 0, '[]', NULL, 0, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(client_id, user_id) DO UPDATE SET
           checklist_items_json = excluded.checklist_items_json,
           skipped_items_json = excluded.skipped_items_json,
           last_active_at = datetime('now'),
           updated_at = datetime('now')`,
      )
        .bind(clientId, userId, itemsJson, skippedJson)
        .run();
    }
    return { ok: true };
  } catch (err) {
    if (isMissingColumnError(err)) return { ok: false };
    return { ok: false };
  }
}

/** Reset complet : NULL sur les 2 colonnes JSON + dismissed_at + last_active_at. */
async function persistChecklistReset(
  env: Env,
  clientId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  try {
    await env.DB.prepare(
      `UPDATE onboarding_state
          SET checklist_items_json = NULL,
              skipped_items_json = NULL,
              dismissed_at = NULL,
              last_active_at = datetime('now'),
              updated_at = datetime('now')
        WHERE client_id = ? AND user_id = ?`,
    )
      .bind(clientId, userId)
      .run();
    return { ok: true };
  } catch (err) {
    if (isMissingColumnError(err)) return { ok: false };
    return { ok: false };
  }
}

/** INSERT best-effort dans onboarding_events. event_type validé HANDLER. */
async function logChecklistEvent(
  env: Env,
  clientId: string,
  userId: string,
  eventType: 'item.completed' | 'item.skipped' | 'checklist.reset',
  itemKey: OnboardingChecklistItemKey | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO onboarding_events
         (client_id, user_id, event_type, item_key, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        clientId,
        userId,
        eventType,
        itemKey,
        metadata ? JSON.stringify(metadata) : null,
      )
      .run();
  } catch {
    /* table seq119 absente ou autre — non critique (le state reste lu OK). */
  }
}

/**
 * GET /api/onboarding/checklist — état de la checklist serveur du tenant courant.
 *
 * Lit onboarding_state.(checklist_items_json, last_active_at), parse safe,
 * calcule total (6 CRM + 3 ecom si module actif), completed, skipped, pct.
 *
 * Best-effort : tenant absent ⇒ EMPTY_CHECKLIST. Migration seq119 non jouée
 * ⇒ EMPTY_CHECKLIST (PAS 500). Cross-tenant impossible (filtre strict
 * client_id+user_id).
 */
export async function handleGetChecklist(
  _request: Request,
  env: Env,
  auth: ChecklistAuth,
): Promise<Response> {
  const cg = checklistCapGuard(auth, 'settings.manage');
  if (cg) return cg;
  try {
    const { clientId, modules } = await getClientModules(env, auth.userId);
    if (!clientId) return json({ data: { ...EMPTY_CHECKLIST } });
    const data = await computeChecklist(env, clientId, auth.userId, modules);
    return json({ data });
  } catch {
    return json({ data: { ...EMPTY_CHECKLIST } });
  }
}

/**
 * POST /api/onboarding/checklist/complete — marque un item comme fait.
 * Body : { itemKey: OnboardingChecklistItemKey }.
 *
 * Idempotent : si l'item est déjà `done`, on conserve le `completedAt`
 * initial (pas de réécriture du timestamp). Insère un event analytics
 * 'item.completed' et met à jour last_active_at.
 *
 * Best-effort : migration seq119 non jouée ⇒ EMPTY_CHECKLIST (PAS 500).
 */
export async function handleCompleteChecklistItem(
  request: Request,
  env: Env,
  auth: ChecklistAuth,
): Promise<Response> {
  const cg = checklistCapGuard(auth, 'settings.manage');
  if (cg) return cg;
  try {
    const body = await request.json().catch(() => ({}));
    const v = validate(onboardingChecklistCompleteSchema, body);
    if (!v.success) return validationError(v.error);
    const itemKey = v.data.itemKey;
    if (!validateItemKey(itemKey)) {
      return json({ error: 'Unknown itemKey' }, 400);
    }
    const typedKey = itemKey as OnboardingChecklistItemKey;

    const { clientId, modules } = await getClientModules(env, auth.userId);
    if (!clientId) return json({ data: { ...EMPTY_CHECKLIST } });

    // Lit l'état actuel pour idempotence (préserve completedAt si déjà done).
    const current = await computeChecklist(env, clientId, auth.userId, modules);
    const existing = current.items[typedKey];
    const nowIso = new Date().toISOString();
    const completedAt =
      existing && existing.done && existing.completedAt
        ? existing.completedAt
        : nowIso;

    const nextItems = { ...current.items };
    nextItems[typedKey] = {
      done: true,
      skipped: false,
      completedAt,
      skippedAt: null,
      // skipReason omis (undefined) — pas de fuite d'un ancien skip.
    };

    const persisted = await persistChecklistItems(env, clientId, auth.userId, nextItems);
    if (!persisted.ok) {
      // Migration seq119 absente : dégrade silencieusement (le front garde
      // un fallback localStorage). Pas d'event, pas d'audit.
      return json({ data: { ...EMPTY_CHECKLIST } });
    }

    await logChecklistEvent(env, clientId, auth.userId, 'item.completed', typedKey, null);
    await audit(
      env,
      auth.userId,
      'onboarding.checklist.item_completed',
      'onboarding_state',
      clientId,
      { itemKey: typedKey },
    );

    const next = await computeChecklist(env, clientId, auth.userId, modules);
    return json({ data: next });
  } catch {
    return json({ data: { ...EMPTY_CHECKLIST } });
  }
}

/**
 * POST /api/onboarding/checklist/skip — marque un item comme passé.
 * Body : { itemKey: OnboardingChecklistItemKey, reason?: string }.
 *
 * Skip remplace l'état précédent (done passe à false, skipped=true, raison
 * tronquée à 280 chars par le schema). Insère un event 'item.skipped'
 * avec metadata { reason } et met à jour last_active_at.
 */
export async function handleSkipChecklistItem(
  request: Request,
  env: Env,
  auth: ChecklistAuth,
): Promise<Response> {
  const cg = checklistCapGuard(auth, 'settings.manage');
  if (cg) return cg;
  try {
    const body = await request.json().catch(() => ({}));
    const v = validate(onboardingChecklistSkipSchema, body);
    if (!v.success) return validationError(v.error);
    const itemKey = v.data.itemKey;
    if (!validateItemKey(itemKey)) {
      return json({ error: 'Unknown itemKey' }, 400);
    }
    const typedKey = itemKey as OnboardingChecklistItemKey;
    const reason = v.data.reason || undefined;

    const { clientId, modules } = await getClientModules(env, auth.userId);
    if (!clientId) return json({ data: { ...EMPTY_CHECKLIST } });

    const current = await computeChecklist(env, clientId, auth.userId, modules);
    const nowIso = new Date().toISOString();

    const nextItems = { ...current.items };
    nextItems[typedKey] = {
      done: false,
      skipped: true,
      completedAt: null,
      skippedAt: nowIso,
      skipReason: reason,
    };

    const persisted = await persistChecklistItems(env, clientId, auth.userId, nextItems);
    if (!persisted.ok) {
      return json({ data: { ...EMPTY_CHECKLIST } });
    }

    await logChecklistEvent(
      env,
      clientId,
      auth.userId,
      'item.skipped',
      typedKey,
      reason ? { reason } : null,
    );
    await audit(
      env,
      auth.userId,
      'onboarding.checklist.item_skipped',
      'onboarding_state',
      clientId,
      { itemKey: typedKey, hasReason: !!reason },
    );

    const next = await computeChecklist(env, clientId, auth.userId, modules);
    return json({ data: next });
  } catch {
    return json({ data: { ...EMPTY_CHECKLIST } });
  }
}

/**
 * POST /api/onboarding/checklist/reset — réinitialise la checklist.
 *
 * UPDATE onboarding_state SET checklist_items_json=NULL,
 *   skipped_items_json=NULL, dismissed_at=NULL,
 *   last_active_at=datetime('now'). Insère event 'checklist.reset'.
 *
 * Best-effort : migration seq119 non jouée ⇒ EMPTY_CHECKLIST (PAS 500).
 */
export async function handleResetChecklist(
  _request: Request,
  env: Env,
  auth: ChecklistAuth,
): Promise<Response> {
  const cg = checklistCapGuard(auth, 'settings.manage');
  if (cg) return cg;
  try {
    const { clientId, modules } = await getClientModules(env, auth.userId);
    if (!clientId) return json({ data: { ...EMPTY_CHECKLIST } });

    const persisted = await persistChecklistReset(env, clientId, auth.userId);
    if (!persisted.ok) {
      return json({ data: { ...EMPTY_CHECKLIST } });
    }

    await logChecklistEvent(env, clientId, auth.userId, 'checklist.reset', null, null);
    await audit(
      env,
      auth.userId,
      'onboarding.checklist.reset',
      'onboarding_state',
      clientId,
      {},
    );

    const next = await computeChecklist(env, clientId, auth.userId, modules);
    return json({ data: next });
  } catch {
    return json({ data: { ...EMPTY_CHECKLIST } });
  }
}
