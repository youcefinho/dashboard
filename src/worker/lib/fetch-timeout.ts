// ── fetch-timeout.ts — Sprint S-D (LOT D, Manager A) ────────────────────────
//
// Wrapper `fetch` borné par AbortController, calqué EXACTEMENT sur le patron
// éprouvé de `src/worker/webhooks-dispatch.ts:119-157` (timeout 10s + abort +
// clearTimeout en sortie). Sortie unique pour LOT D : Manager C l'importe pour
// ceinturer les appels sortants best-effort de `ai.ts` / `push.ts` /
// `tracking.ts` SANS toucher leur logique métier (leur try/catch existant
// continue de capter l'erreur propagée ici).
//
// Contrat (§6.1, figé pour B/C) :
//   fetchWithTimeout(input, init?, timeoutMs = 10000): Promise<Response>
//   - résout la Response si le fetch aboutit avant `timeoutMs`
//   - rejette si le réseau échoue OU si le timeout expire (AbortError)
//   - `clearTimeout` TOUJOURS appelé (succès comme échec) — zéro timer fuyant
//   - propage l'erreur telle quelle : l'APPELANT garde son try/catch
//     best-effort (zéro changement de logique métier côté appelant)
//
// Pur, zéro dépendance cross-module, zéro accès DB/env.

export async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  // AbortController pour timeout (évite qu'un endpoint lent bloque le worker).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      ...(init || {}),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res;
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    const errMsg = fetchErr?.name === 'AbortError'
      ? `Timeout après ${timeoutMs}ms`
      : fetchErr?.message || 'Erreur réseau';
    throw new Error(errMsg);
  }
}
