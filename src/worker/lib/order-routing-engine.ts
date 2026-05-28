// ── order-routing-engine.ts — Engine pur pour routage intelligent des commandes e-commerce
//
// Primitives PURES (zéro D1, zéro réseau) pour évaluer les règles de routage
// selon la priorité et les conditions géographiques d'adresse de livraison.

export interface OrderRoutingCondition {
  field: 'shipping_country' | 'shipping_country_subdiv' | 'shipping_postal_code';
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with';
  value: string;
}

export interface OrderRoutingRule {
  id: string;
  client_id: string;
  name: string;
  priority: number;
  conditions_json: string; // stringified OrderRoutingCondition[]
  action_warehouse_id: string;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Évalue une condition individuelle d'adresse.
 * Insensible à la casse, tolérant sur les espaces de part et d'autre.
 */
export function evaluateCondition(address: any, cond: OrderRoutingCondition): boolean {
  if (!address || !cond) return false;

  let addressVal = '';
  if (cond.field === 'shipping_country') {
    addressVal = address.country || address.shipping_country || '';
  } else if (cond.field === 'shipping_country_subdiv') {
    addressVal = address.country_subdiv || address.state || address.province || address.shipping_country_subdiv || '';
  } else if (cond.field === 'shipping_postal_code') {
    addressVal = address.postal_code || address.zip || address.shipping_postal_code || '';
  } else {
    return false;
  }

  const aVal = addressVal.toString().trim().toLowerCase();
  const cVal = (cond.value || '').toString().trim().toLowerCase();

  switch (cond.operator) {
    case 'equals':
      return aVal === cVal;
    case 'not_equals':
      return aVal !== cVal;
    case 'contains':
      return aVal.includes(cVal);
    case 'starts_with':
      return aVal.startsWith(cVal);
    default:
      return false;
  }
}

/**
 * Évalue si une règle de routage s'applique à une adresse (AND logique sur toutes les conditions).
 */
export function evaluateRule(rule: OrderRoutingRule, address: any): boolean {
  let conditions: OrderRoutingCondition[] = [];
  try {
    conditions = JSON.parse(rule.conditions_json || '[]');
  } catch {
    return false;
  }

  if (!Array.isArray(conditions) || conditions.length === 0) {
    // Une règle active sans conditions fait office de catch-all/wildcard
    return true;
  }

  return conditions.every(cond => evaluateCondition(address, cond));
}

/**
 * Parcourt les règles actives triées par priorité décroissante (plus haute priorité d'abord).
 * Retourne le action_warehouse_id du premier match, ou null si aucun ne correspond.
 */
export function evaluateRoutingRules(
  rules: OrderRoutingRule[],
  address: any,
): string | null {
  if (!Array.isArray(rules) || rules.length === 0 || !address) {
    return null;
  }

  // Trier par priorité décroissante
  const sortedRules = [...rules]
    .filter(r => r.is_active === 1)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sortedRules) {
    if (evaluateRule(rule, address)) {
      return rule.action_warehouse_id;
    }
  }

  return null;
}
