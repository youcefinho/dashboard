// ════════════════════════════════════════════════════════════
// S3 M1 — Réponse d'erreur de validation normalisée (FR québécois)
// ════════════════════════════════════════════════════════════
//
// ── DÉCISION DE FORMAT (M1.1 — prouvée par grep du front) ────
//
// Le front consomme une 4xx via le wrapper `apiFetch` de
// src/lib/api.ts. Au cœur (ligne ~70) :
//
//     const data = await response.json() as ApiResponse<T>;
//     if (!response.ok) {
//       return { error: data.error || `Erreur ${response.status}` };
//     }
//
// → `data.error` est lu comme une **STRING brute** et propagé tel quel
//   (toasts, états d'erreur UI). Aucun lecteur ne fait `data.error.message`
//   ni n'attend un objet. Le pattern d'erreur déjà ultra-répandu dans le
//   worker est `json({ error: '<string>' }, 4xx)` (~73 fichiers), parfois
//   enrichi d'un `message` string additionnel — toujours `error` = string.
//
// CONCLUSION : pour NE RIEN CASSER, `error` DOIT rester une string FR
// lisible à la racine. On AJOUTE seulement des champs structurés
// (`code`, `fields`) que les lecteurs actuels ignorent (rétro-compat
// totale, format strictement additif). Un format `{ error: { ... } }`
// objet aurait cassé le front → REJETÉ.
//
// Format retenu (HTTP 400) :
//   { error: "<message FR québécois>", code: "VALIDATION", fields?: string[] }
//
// `error`  : message lisible (provient de validate() → "champ: raison").
// `code`   : discriminant machine stable ('VALIDATION') — additif.
// `fields` : chemins de champs invalides (best-effort) — additif, omis
//            si non déterminable.
//
// ── CONVENTION D'INTÉGRATION (early-return, pour M2/M3 Phase B) ──
//
//   import { validate, createOrderSchema } from '../lib/schemas';
//   import { validationError } from './lib/validate-response';
//
//   const body = await request.json().catch(() => null);
//   const v = validate(createOrderSchema, body);
//   if (!v.success) return validationError(v.error);
//   // ↓ logique métier STRICTEMENT INCHANGÉE, on consomme v.data
//   const result = await createOrderCore(env, clientId, v.data, auth.userId);
//
// Le helper est l'unique point de fabrication de la réponse 400 de
// validation : M2/M3 ne dupliquent jamais ce format.

import { json } from '../helpers';

/**
 * Construit la réponse HTTP 400 normalisée pour un échec de validation.
 *
 * @param err     Message d'erreur lisible (typiquement `v.error` renvoyé
 *                 par `validate()` de src/lib/schemas.ts, déjà au format
 *                 `"chemin: raison"` en FR québécois).
 * @returns       `Response` 400 — corps :
 *                 `{ error: <string>, code: 'VALIDATION', fields?: string[] }`.
 *                 `error` reste une STRING racine (rétro-compat front
 *                 prouvée par grep — voir entête). `code`/`fields` sont
 *                 purement additifs.
 *
 * @example
 *   const v = validate(createLeadSchema, body);
 *   if (!v.success) return validationError(v.error);
 */
export function validationError(err: string): Response {
  const message = (err && err.trim()) || 'Données invalides';

  // best-effort : si validate() a préfixé le chemin du champ
  // ("champ.sous: raison"), on l'expose dans `fields` SANS retirer le
  // chemin de `error` (rétro-compat : l'UI affiche le message complet).
  const fields: string[] = [];
  const colon = message.indexOf(':');
  if (colon > 0) {
    const path = message.slice(0, colon).trim();
    // un "chemin" plausible : pas d'espace, non vide (évite de capter
    // un message libre contenant un ':').
    if (path && !/\s/.test(path)) {
      fields.push(path);
    }
  }

  const payload: { error: string; code: 'VALIDATION'; fields?: string[] } = {
    error: message,
    code: 'VALIDATION',
  };
  if (fields.length > 0) payload.fields = fields;

  return json(payload, 400);
}
