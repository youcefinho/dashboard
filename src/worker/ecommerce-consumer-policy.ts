// ── Politique conso — Sprint E6 M3.1 (2026-05-16) ───────────────────────────
//
// ⚠️ ZONE RÉGULÉE — revue Rochdi requise (calcul fenêtre rétractation /
// mentions obligatoires par juridiction). CE FICHIER NE REND AUCUN AVIS
// JURIDIQUE. Il expose une POLITIQUE INDICATIVE, PARAMÉTRABLE par région,
// derrière les `legal_flags` du tenant (E-R). Aucune règle codée « en dur »
// par pays au sens d'un `if (country === 'FR')` métier : la fenêtre et les
// mentions proviennent d'un RÉFÉRENTIEL CONFIG (`POLICY_BY_FLAG`) indexé par
// flag légal, surchargé proprement, et tout est ramené à l'UI avec une
// bannière « politique indicative — revue légale requise avant activation ».
//
// Contrat FIGÉ (câblé par M2 dans worker.ts au nom EXACT) :
//   handleGetOrderPolicy(env, auth, orderId)
//     → GET /api/ecommerce/orders/:id/policy
//     → { withdrawal_window_days, mentions: string[], region }
//
// Calcul fenêtre : `datetime('now')` UTC vs delivered_at (E5, shipment livré).
// Jours entiers, BORNE INCLUSIVE. Garde défensive totale : commande/région
// inconnue, aucune livraison ⇒ fenêtre 0 + mention générique (jamais 500,
// jamais d'avis trompeur).
//
// Conventions strictes projet :
//   - Multi-tenant STRICT : clientId résolu via getClientModules.
//   - Gating requireModule('ecommerce') hérité du bloc /api/ecommerce/*.
//   - Additif / non destructif : ZÉRO ALTER, ZÉRO écriture DB (lecture seule).
//   - Réutilise resolveRegionContext + parseLegalFlags (E-R) — aucune
//     réimplémentation de la résolution région.

import type { Env } from './types';
import type { ConsumerPolicy, LegalFlags, RegionContext } from '../lib/types';
import { json } from './helpers';
import { getClientModules } from './modules';
import { resolveRegionContext, parseLegalFlags } from './ecommerce-region';

type Auth = { userId: string; role: string };

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ ZONE RÉGULÉE — revue Rochdi requise
//
// Référentiel CONFIG de la politique conso PAR FLAG LÉGAL (pas par pays codé
// en dur). `window_days` et `mentions` sont des PARAMÈTRES indicatifs — la
// valeur réelle applicable doit être revue par un juriste avant activation
// commerciale. Modifier ce référentiel = changer la config, PAS le code
// métier. Priorité : le flag « le plus protecteur présent » l'emporte
// (fenêtre la plus longue) — un commerçant multi-région reste couvert.
// ════════════════════════════════════════════════════════════════════════════
interface PolicyRule {
  /** Fenêtre de rétractation indicative (jours entiers, depuis livraison). */
  window_days: number;
  /** Mentions obligatoires indicatives (FR québécois). Paramétrables. */
  mentions: string[];
}

/**
 * Config indexée par drapeau légal (E-R `legal_flags`). AUCUN `if(country)`
 * métier : on lit les flags résolus du tenant, on agrège la règle.
 *  - rgpd     → UE : droit de rétractation distance (référence indicative 14 j).
 *  - conso_dz → Algérie : protection consommateur (référence indicative).
 *  - loi25    → QC : Loi 25 = renseignements personnels (PAS un délai de
 *               rétractation conso) → fenêtre 0, mention de renvoi politique
 *               commerçant (le délai conso QC dépend du contrat marchand).
 *  - casl     → anti-pourriel : aucun délai rétractation (mention 0/—).
 */
const POLICY_BY_FLAG: Record<string, PolicyRule> = {
  rgpd: {
    window_days: 14,
    mentions: [
      'Vente à distance — un délai de rétractation indicatif de 14 jours peut s’appliquer à compter de la réception.',
      'Le client doit pouvoir exercer son droit sans pénalité ni motif, selon la politique en vigueur.',
    ],
  },
  conso_dz: {
    window_days: 7,
    mentions: [
      'Protection du consommateur — un délai de réflexion indicatif peut s’appliquer après la livraison.',
      'Les frais de retour et conditions doivent être communiqués clairement au client.',
    ],
  },
  loi25: {
    window_days: 0,
    mentions: [
      'Le délai de retour applicable suit la politique commerciale du marchand (le client doit en être informé avant l’achat).',
      'Les renseignements personnels liés au retour sont traités conformément à la politique de confidentialité (Loi 25).',
    ],
  },
  casl: {
    window_days: 0,
    mentions: [],
  },
};

/** Règle générique de repli — région/flag inconnu (jamais d'avis trompeur). */
const FALLBACK_RULE: PolicyRule = {
  window_days: 0,
  mentions: [
    'Politique de retour indicative — consulte les conditions générales du marchand. Le délai exact dépend de la politique commerciale applicable.',
  ],
};

/**
 * Agrège la règle indicative à partir des flags légaux résolus (E-R). Le flag
 * « le plus protecteur » fixe la fenêtre (la plus longue) ; les mentions de
 * tous les flags actifs sont concaténées dédupliquées. Aucun flag actif ⇒
 * repli générique. PARAMÉTRABLE : tout vient de `POLICY_BY_FLAG`.
 */
function resolvePolicyRule(flags: LegalFlags): PolicyRule {
  const active: PolicyRule[] = [];
  if (flags.rgpd) active.push(POLICY_BY_FLAG.rgpd!);
  if (flags.conso_dz) active.push(POLICY_BY_FLAG.conso_dz!);
  if (flags.loi25) active.push(POLICY_BY_FLAG.loi25!);
  if (flags.casl) active.push(POLICY_BY_FLAG.casl!);

  if (active.length === 0) return FALLBACK_RULE;

  const window_days = Math.max(...active.map((r) => r.window_days), 0);
  const mentions: string[] = [];
  for (const r of active) {
    for (const m of r.mentions) {
      if (!mentions.includes(m)) mentions.push(m);
    }
  }
  if (mentions.length === 0) mentions.push(...FALLBACK_RULE.mentions);
  return { window_days, mentions };
}

/**
 * Jours entiers (borne inclusive) écoulés entre `deliveredAt` (UTC) et
 * maintenant. Défensif : date absente/invalide ⇒ null (l'appelant traite
 * comme « pas encore livré » → fenêtre non démarrée).
 */
function daysSinceDelivery(deliveredAt: string | null): number | null {
  if (!deliveredAt) return null;
  const d = Date.parse(deliveredAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d)) {
    const d2 = Date.parse(deliveredAt);
    if (Number.isNaN(d2)) return null;
    return Math.max(0, Math.floor((Date.now() - d2) / 86_400_000));
  }
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

interface OrderPolicyRow {
  id: string;
  delivered_at: string | null;
}

/**
 * GET /api/ecommerce/orders/:id/policy — politique de rétractation INDICATIVE
 * applicable à la commande. ⚠️ ZONE RÉGULÉE : sortie purement informative,
 * revue légale requise avant activation commerciale (la bannière UI le dit).
 *
 * Résout la région via `resolveRegionContext` (E-R) puis agrège la règle
 * paramétrable selon les `legal_flags` du tenant. La date de départ de la
 * fenêtre = `delivered_at` du shipment livré le plus récent (E5) ; non livré
 * ⇒ fenêtre annoncée mais non démarrée (mention dédiée). Garde défensive
 * totale : commande introuvable / région indéterminée ⇒ règle de repli.
 *
 * Contrat FIGÉ : { withdrawal_window_days, mentions: string[], region }.
 */
export async function handleGetOrderPolicy(
  env: Env, auth: Auth, orderId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // Commande du tenant (multi-tenant strict). Introuvable ⇒ repli neutre.
  const order = (await env.DB.prepare(
    'SELECT id FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as { id: string } | null;
  if (!order) {
    const fallback: ConsumerPolicy = {
      withdrawal_window_days: 0,
      mentions: FALLBACK_RULE.mentions,
      region: 'UNKNOWN',
    };
    return json({ data: fallback });
  }

  // Région résolue (E-R) — défensif si la résolution échoue (tenant legacy).
  let ctx: RegionContext | null = null;
  try {
    ctx = await resolveRegionContext(env, clientId);
  } catch {
    ctx = null;
  }

  // Flags légaux résolus : on relit la colonne brute pour réutiliser le parse
  // E-R officiel (parseLegalFlags) — pas de réimplémentation. Absente/NULL ⇒
  // dérivée du régime via le contexte (repli neutre si indéterminé).
  let flags: LegalFlags = {};
  try {
    const row = (await env.DB.prepare(
      'SELECT legal_flags_json FROM clients WHERE id = ?',
    ).bind(clientId).first()) as { legal_flags_json: string | null } | null;
    flags = parseLegalFlags(row?.legal_flags_json);
    // Repli : flags vides + régime connu ⇒ déduit le flag dominant (E-R aligne
    // déjà les défauts ; ici on reste indicatif, jamais bloquant).
    if (Object.keys(flags).length === 0 && ctx) {
      if (ctx.tax_regime === 'eu') flags = { rgpd: true };
      else if (ctx.tax_regime === 'dz') flags = { conso_dz: true };
      else if (ctx.tax_regime === 'qc') flags = { loi25: true };
    }
  } catch {
    flags = {};
  }

  const rule = resolvePolicyRule(flags);

  // delivered_at = shipment livré le plus récent (E5). Aucun ⇒ non livré.
  const shipped = (await env.DB.prepare(
    `SELECT delivered_at FROM shipments
       WHERE order_id = ? AND client_id = ? AND delivered_at IS NOT NULL
       ORDER BY delivered_at DESC LIMIT 1`,
  ).bind(orderId, clientId).first()) as { delivered_at: string | null } | null;

  const deliveredAt = shipped?.delivered_at ?? null;
  const elapsed = daysSinceDelivery(deliveredAt);

  const mentions = [...rule.mentions];
  if (deliveredAt === null) {
    mentions.push(
      'Le délai de rétractation n’a pas encore débuté : il court à compter de la livraison effective.',
    );
  } else if (elapsed !== null && rule.window_days > 0) {
    const remaining = Math.max(0, rule.window_days - elapsed);
    mentions.push(
      remaining > 0
        ? `Il resterait environ ${remaining} jour(s) sur la fenêtre indicative de ${rule.window_days} jour(s).`
        : `La fenêtre indicative de ${rule.window_days} jour(s) semble dépassée (livraison il y a ${elapsed} jour(s)).`,
    );
  }

  const policy: ConsumerPolicy = {
    withdrawal_window_days: rule.window_days,
    mentions,
    region: (ctx?.region || 'UNKNOWN'),
  };
  return json({ data: policy });
}
