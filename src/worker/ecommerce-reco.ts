// ── Sprint E9 M2 — Reco produits + prédiction churn (DERNIER sprint roadmap) ──
//
//   - GET /api/ecommerce/reco/products/:id      → cross/up-sell d'un produit
//   - GET /api/ecommerce/reco/churn/:customerId → score de churn client
//
// ⚠️ FALLBACK DÉTERMINISTE OBLIGATOIRE (Chaman) :
//   La reco et le churn DOIVENT toujours renvoyer un résultat exploitable SANS
//   LLM (co-achat / même catégorie pour la reco ; heuristique RFM/recency pour
//   le churn). Le LLM ne fait QU'ENRICHIR (réordonner / formuler les raisons) —
//   il n'est JAMAIS bloquant. `USE_MOCKS` ou clé absente ⇒ heuristique seule.
//
// ⚠️ ai.ts INTOUCHÉ : callLLM y est PRIVÉ (non exporté). On RECOPIE LOCALEMENT
//   le pattern (fetch Anthropic + fallback sûr) — on n'importe/modifie/exporte
//   PAS ai.ts. Aucune dépendance croisée.
//
// Conventions strictes : multi-tenant STRICT (WHERE client_id = ?), lectures
// BORNÉES (LIMIT + index), money en cents, additif/lecture seule (zéro ALTER,
// zéro écriture). reports.ts INTOUCHÉ.

import type { Env, ProductRecoRow, ChurnPrediction } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

const RECO_LIMIT = 8;          // nb de recos retournées (borné)
const CO_PURCHASE_SCAN = 2000; // borne dure de lignes co-achat scannées

// ── LLM local (pattern recopié d'ai.ts — ai.ts NON importé/modifié) ──────────

/**
 * Appel Claude Haiku (Anthropic) — RECOPIE LOCALE du pattern ai.ts (callLLM y
 * est privé non exporté). Fallback SÛR : USE_MOCKS / clé absente / erreur ⇒
 * null (l'appelant retombe sur l'heuristique déterministe, jamais bloquant).
 */
async function tryLLM(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const useMock = env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
  if (useMock) return null; // pas de LLM ⇒ déterministe seul

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.error('reco LLM error', res.status);
      return null;
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text: string }> };
    return data.content?.[0]?.text || null;
  } catch (err) {
    console.error('reco LLM exception', err);
    return null; // non bloquant — heuristique déterministe prend le relais
  }
}

// ── Helpers tenant / réponses (style projet) ─────────────────────────────────

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

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — GET /api/ecommerce/reco/products/:id
// ════════════════════════════════════════════════════════════════════════════

/**
 * Recommandations produits pour `productId` (variant_id).
 *
 * FALLBACK DÉTERMINISTE OBLIGATOIRE (toujours appliqué d'abord) :
 *   1. CO-ACHAT : variants apparus dans les mêmes commandes que productId
 *      (order_items joints sur order_id), classés par nb de co-occurrences.
 *   2. MÊME CATÉGORIE : complète avec des variants du même produit/catégorie
 *      si la liste co-achat est trop courte.
 * LLM OPTIONNEL : si dispo, réordonne le classement (jamais bloquant — toute
 * absence/erreur ⇒ on garde l'ordre déterministe). Multi-tenant strict, borné.
 */
export async function handleProductRecommendations(
  env: Env,
  auth: Auth,
  productId: string,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();
    if (!productId) {
      return json({ data: { source_variant_id: '', recommendations: [], fallback: true } });
    }

    // 1) CO-ACHAT déterministe : autres variants des commandes contenant
    //    productId (multi-tenant via jointure orders.client_id). Borné.
    const { results: coRows } = await env.DB.prepare(
      `SELECT oi2.variant_id AS variant_id,
              MAX(COALESCE(NULLIF(oi2.product_title_snapshot, ''), 'Produit')) AS title,
              COUNT(*) AS co_count
         FROM order_items oi1
         JOIN orders o ON o.id = oi1.order_id AND o.client_id = ?
         JOIN order_items oi2 ON oi2.order_id = oi1.order_id
        WHERE oi1.variant_id = ?
          AND oi2.variant_id IS NOT NULL
          AND oi2.variant_id <> ?
        GROUP BY oi2.variant_id
        ORDER BY co_count DESC
        LIMIT ?`,
    )
      .bind(clientId, productId, productId, RECO_LIMIT)
      .all();

    const recos = new Map<string, ProductRecoRow>();
    for (const r of (coRows || []) as Array<{
      variant_id: string;
      title: string;
      co_count: number;
    }>) {
      recos.set(String(r.variant_id), {
        variant_id: String(r.variant_id),
        title: String(r.title || 'Produit'),
        reason: 'co_purchase',
        score: Math.max(1, Math.round(r.co_count || 1)),
      });
    }

    // 2) MÊME CATÉGORIE déterministe (complète si liste courte). On retrouve
    //    le produit parent du variant source puis ses variants frères / les
    //    variants de la même catégorie (product_category_links). Borné.
    if (recos.size < RECO_LIMIT) {
      const need = RECO_LIMIT - recos.size;
      const exclude = [productId, ...Array.from(recos.keys())];
      const ph = exclude.map(() => '?').join(', ');
      const { results: catRows } = await env.DB.prepare(
        `SELECT pv.id AS variant_id,
                COALESCE(NULLIF(p.title, ''), 'Produit') AS title
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id AND p.client_id = ?
          WHERE pv.product_id IN (
                  SELECT pcl2.product_id
                    FROM product_category_links pcl1
                    JOIN product_category_links pcl2
                      ON pcl2.category_id = pcl1.category_id
                   WHERE pcl1.product_id = (
                           SELECT product_id FROM product_variants WHERE id = ?
                         )
                )
            AND pv.id NOT IN (${ph})
          LIMIT ?`,
      )
        .bind(clientId, productId, ...exclude, need)
        .all();
      let scoreSeed = 0;
      for (const r of (catRows || []) as Array<{ variant_id: string; title: string }>) {
        const vid = String(r.variant_id);
        if (recos.has(vid)) continue;
        recos.set(vid, {
          variant_id: vid,
          title: String(r.title || 'Produit'),
          reason: 'same_category',
          score: 1 + scoreSeed,
        });
        scoreSeed = Math.max(0, scoreSeed - 0); // ordre stable d'insertion
      }
    }

    // Liste déterministe finale (co-achat d'abord, score décroissant).
    let recommendations = Array.from(recos.values()).sort((a, b) => {
      if (a.reason !== b.reason) return a.reason === 'co_purchase' ? -1 : 1;
      return b.score - a.score;
    });

    // 3) LLM OPTIONNEL — réordonne UNIQUEMENT (jamais bloquant, jamais
    //    générateur de nouveaux IDs). Toute erreur ⇒ on garde le déterministe.
    let fallback = true;
    if (recommendations.length > 1) {
      const llm = await tryLLM(
        env,
        "Tu es un moteur de reco e-commerce. On te donne une liste de variant_id avec titres et raisons (co_purchase/same_category). Renvoie UNIQUEMENT un tableau JSON des variant_id réordonnés du plus pertinent au moins pertinent pour du cross/up-sell. N'invente AUCUN id, n'en retire AUCUN.",
        JSON.stringify(
          recommendations.map((r) => ({
            variant_id: r.variant_id,
            title: r.title,
            reason: r.reason,
          })),
        ),
      );
      if (llm) {
        try {
          const match = llm.match(/\[[\s\S]*\]/);
          const order = match ? (JSON.parse(match[0]) as string[]) : null;
          if (Array.isArray(order) && order.length > 0) {
            const byId = new Map(recommendations.map((r) => [r.variant_id, r]));
            const reordered: ProductRecoRow[] = [];
            for (const id of order) {
              const item = byId.get(String(id));
              if (item) {
                reordered.push(item);
                byId.delete(String(id));
              }
            }
            // Reliquat non cité par le LLM = appended (aucun id perdu).
            for (const left of byId.values()) reordered.push(left);
            if (reordered.length === recommendations.length) {
              recommendations = reordered;
              fallback = false;
            }
          }
        } catch {
          /* parse LLM raté ⇒ on garde l'ordre déterministe (fallback) */
        }
      }
    }

    return json({
      data: { source_variant_id: productId, recommendations, fallback },
    });
  } catch (err) {
    console.error('handleProductRecommendations failed', err);
    return json({ data: { source_variant_id: productId, recommendations: [], fallback: true } });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M2.4 — GET /api/ecommerce/reco/churn/:customerId
// ════════════════════════════════════════════════════════════════════════════

interface CustomerChurnRow {
  id: string;
  rfm_segment: string | null;
  last_order_at: string | null;
  orders_count: number | null;
  total_spent_cents: number | null;
}

/**
 * Heuristique churn DÉTERMINISTE (toujours calculée) :
 *   - RECENCY : jours depuis last_order_at (plus c'est vieux, plus à risque).
 *   - RFM : segment 'at_risk'/'hibernating'/'lost' ⇒ pénalité ; 'champion'/
 *     'loyal' ⇒ bonus (réduit le score).
 *   - FRÉQUENCE : orders_count faible (0-1) ⇒ pénalité ; ≥ 4 ⇒ bonus.
 * Score borné 0..100, risk = low(<34) / med(<67) / high(≥67). reasons[]
 * lisibles FR. LLM OPTIONNEL : reformule/enrichit reasons (fallback:true si
 * indispo — le score reste 100% déterministe).
 */
export async function handleCustomerChurnPredict(
  env: Env,
  auth: Auth,
  customerId: string,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) return noClient();
    if (!customerId) {
      const empty: ChurnPrediction = {
        customer_id: '',
        score: 0,
        risk: 'low',
        reasons: ['Client introuvable.'],
        fallback: true,
      };
      return json({ data: empty });
    }

    const c = (await env.DB.prepare(
      `SELECT id, rfm_segment, last_order_at, orders_count, total_spent_cents
         FROM customers
        WHERE id = ? AND client_id = ?`,
    )
      .bind(customerId, clientId)
      .first()) as CustomerChurnRow | null;

    if (!c) {
      const nf: ChurnPrediction = {
        customer_id: customerId,
        score: 0,
        risk: 'low',
        reasons: ['Client introuvable pour ce compte.'],
        fallback: true,
      };
      return json({ data: nf }, 404);
    }

    const reasons: string[] = [];
    let score = 0;

    // RECENCY (poids fort) — jours depuis la dernière commande.
    let recencyDays: number | null = null;
    if (c.last_order_at) {
      const last = Date.parse(String(c.last_order_at).replace(' ', 'T') + 'Z');
      if (Number.isFinite(last)) {
        recencyDays = Math.max(0, Math.round((Date.now() - last) / 86400000));
      }
    }
    if (recencyDays === null) {
      score += 45;
      reasons.push('Aucune commande enregistrée — engagement non confirmé.');
    } else if (recencyDays > 180) {
      score += 50;
      reasons.push(`Dernière commande il y a ${recencyDays} jours (> 6 mois).`);
    } else if (recencyDays > 90) {
      score += 30;
      reasons.push(`Dernière commande il y a ${recencyDays} jours (> 3 mois).`);
    } else if (recencyDays > 45) {
      score += 15;
      reasons.push(`Dernière commande il y a ${recencyDays} jours.`);
    } else {
      reasons.push(`Client récent — commande il y a ${recencyDays} jours.`);
    }

    // RFM segment.
    const seg = String(c.rfm_segment || '').toLowerCase();
    if (['lost', 'hibernating', 'at_risk', 'about_to_sleep'].includes(seg)) {
      score += 25;
      reasons.push(`Segment RFM « ${seg} » — signal de désengagement.`);
    } else if (['champion', 'champions', 'loyal', 'loyal_customers'].includes(seg)) {
      score -= 15;
      reasons.push(`Segment RFM « ${seg} » — client fidèle (risque réduit).`);
    } else if (seg) {
      reasons.push(`Segment RFM « ${seg} ».`);
    }

    // FRÉQUENCE.
    const oc = Math.max(0, Math.round(c.orders_count || 0));
    if (oc <= 1) {
      score += 18;
      reasons.push(
        oc === 0 ? 'Aucune commande comptée.' : 'Une seule commande — pas encore fidélisé.',
      );
    } else if (oc >= 4) {
      score -= 12;
      reasons.push(`${oc} commandes — relation établie (risque réduit).`);
    } else {
      reasons.push(`${oc} commandes.`);
    }

    // Clamp 0..100.
    score = Math.max(0, Math.min(100, Math.round(score)));
    const risk: ChurnPrediction['risk'] =
      score >= 67 ? 'high' : score >= 34 ? 'med' : 'low';

    // LLM OPTIONNEL — reformule/synthétise les reasons (n'altère JAMAIS le
    // score déterministe). fallback:true si LLM indispo/échoue.
    let finalReasons = reasons;
    let fallback = true;
    const llm = await tryLLM(
      env,
      "Tu es un analyste rétention e-commerce québécois. On te donne un score de churn déterministe (0-100) et des signaux bruts. Renvoie UNIQUEMENT un tableau JSON de 2 à 4 phrases courtes en français québécois professionnel expliquant le risque, SANS inventer de chiffres absents des signaux.",
      JSON.stringify({ score, risk, signals: reasons }),
    );
    if (llm) {
      try {
        const match = llm.match(/\[[\s\S]*\]/);
        const arr = match ? (JSON.parse(match[0]) as unknown[]) : null;
        if (Array.isArray(arr) && arr.length > 0) {
          const cleaned = arr
            .map((x) => String(x).trim())
            .filter((s) => s.length > 0)
            .slice(0, 4);
          if (cleaned.length > 0) {
            finalReasons = cleaned;
            fallback = false;
          }
        }
      } catch {
        /* parse LLM raté ⇒ reasons déterministes (fallback:true) */
      }
    }

    const out: ChurnPrediction = {
      customer_id: customerId,
      score,
      risk,
      reasons: finalReasons,
      fallback,
    };
    return json({ data: out });
  } catch (err) {
    console.error('handleCustomerChurnPredict failed', err);
    const safe: ChurnPrediction = {
      customer_id: customerId,
      score: 0,
      risk: 'low',
      reasons: ['Analyse indisponible temporairement.'],
      fallback: true,
    };
    return json({ data: safe });
  }
}
