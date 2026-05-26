// ── Module Touchpoints — Intralys CRM ───────────────────────
// LOT ATTRIBUTION-D — capture des touchpoints d'acquisition d'un lead
// (multi-touch PROSPECTIF). Écrit dans la table NEUVE `lead_touchpoints`
// (migration seq 100). Appelé en best-effort (import dynamique + try/catch
// TOTAL avalant) depuis le hook d'ingestion `leads.ts` (création + merge) —
// un échec ici n'échoue JAMAIS la création/l'enrichissement du lead.
//
// État : IMPLÉMENTÉ (corps réel ci-dessous — 1 INSERT additif borné tenant,
//    touch_order création=0 / merge=SELECT MAX(touch_order)+1). Signature FIGÉE ;
//    les points d'appel `leads.ts` (création + merge) s'y conforment.
//
// Bornage tenant DUR : `clientId` est TOUJOURS passé par l'appelant depuis
// l'auth/itération (jamais le body). `leadId` est l'id du lead créé/mergé.
// `attribution` = sous-objet UTM/referrer déjà normalisé par lead-mapping.ts.
import type { Env } from './types';

/** Sous-objet d'attribution marketing capturé à l'ingestion (calque
 *  lead-mapping.ts `attribution`). Tous les champs sont best-effort/nullable. */
export interface TouchpointAttribution {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  referrer?: string | null;
}

/**
 * Enregistre un touchpoint d'acquisition pour un lead (best-effort).
 *
 * IMPLÉMENTÉ : INSERT réel dans `lead_touchpoints` borné `client_id`, avec calcul
 * de `touch_order` (0 à la création, MAX+1 au merge via sentinel -1).
 *
 * @param env       Bindings Worker (DB).
 * @param leadId    Id du lead créé/mergé.
 * @param clientId  Tenant borné (auth/itération — JAMAIS body).
 * @param attribution Touch UTM/referrer normalisé.
 * @param touchOrder  Ordre du touch CONTRAT FIGÉ Phase A :
 *                    - `0`  → création (premier touch du lead) ;
 *                    - `-1` → merge (SENTINEL « append » : Phase B résout en
 *                             SELECT MAX(touch_order)+1 pour ce (client,lead)).
 *                    Tout autre n ≥ 0 = ordre explicite (réservé).
 */
export async function recordTouchpoint(
  env: Env,
  leadId: string,
  clientId: string,
  attribution: TouchpointAttribution,
  touchOrder = 0,
): Promise<void> {
  // ── Phase B Manager-B — corps réel. BEST-EFFORT TOTAL : ne throw JAMAIS
  //    (le hook leads.ts enveloppe déjà en try/catch, mais on est défensif ici
  //    aussi pour ne jamais propager d'erreur dans l'ingestion).
  try {
    // Garde-fous d'entrée : sans tenant ni lead, aucun touch traçable.
    if (!clientId || !leadId) return;

    // Normalisation des champs d'attribution (string non vide ou null).
    const norm = (v: string | null | undefined): string | null => {
      if (v == null) return null;
      const s = String(v).trim();
      return s.length > 0 ? s : null;
    };
    const source = norm(attribution?.utm_source);
    const medium = norm(attribution?.utm_medium);
    const campaign = norm(attribution?.utm_campaign);
    const referrer = norm(attribution?.referrer);

    // SKIP si tous les champs d'attribution sont vides — pas de touch sans
    // donnée (évite de polluer la table avec des lignes vides à chaque lead
    // sans UTM/referrer).
    if (!source && !medium && !campaign && !referrer) return;

    // Résolution du sentinel merge (-1) → MAX(touch_order)+1 pour ce
    // (client, lead). Création (0) ou ordre explicite (n ≥ 0) : conservé tel quel.
    let order = touchOrder;
    if (touchOrder === -1) {
      const row = (await env.DB.prepare(
        'SELECT MAX(touch_order) AS mx FROM lead_touchpoints WHERE client_id = ? AND lead_id = ?',
      )
        .bind(clientId, leadId)
        .first()) as { mx: number | null } | null;
      const mx = row?.mx;
      order = mx == null ? 0 : Number(mx) + 1;
    }

    // INSERT additif borné tenant (client_id depuis l'appelant — JAMAIS le body).
    // occurred_at = datetime('now') (convention projet). id auto (randomblob).
    await env.DB.prepare(
      `INSERT INTO lead_touchpoints
         (client_id, lead_id, touch_order, source, medium, campaign, referrer, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(clientId, leadId, order, source, medium, campaign, referrer)
      .run();
  } catch {
    // Table absente / colonne manquante / D1 indispo : best-effort silencieux.
    // La capture de touchpoint n'échoue JAMAIS l'ingestion du lead.
  }
}
