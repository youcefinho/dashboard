// ── Sprint 34 vague 34-1A — PDF export helper ─────────────
// Centralise la logique window.print() + body class toggling pour les templates
// PDF premium (Invoice / Report / Lead-sheet / Dashboard). Append-only, safe SSR.
//
// Pattern :
//   1. add body class `pdf-mode-<kind>` → masque chrome AppLayout, applique CSS print premium
//   2. setTimeout 80ms → laisse React/styles flush avant que le navigateur snapshot
//   3. window.print() → ouvre la dialog d'impression / "Save as PDF" du navigateur
//   4. remove body class après que afterprint fire (ou fallback 1500ms)
//
// Sprint 46 M1.4 — Ajout mode `dashboard` (multi-page, 1-4 widgets / page).
// Optionnel : passer un `dashboardId` pour ajouter un data-attribute lisible
// dans le CSS print (`body[data-pdf-dashboard-id="..."]`), utile pour tracking.

export type PdfMode = 'invoice' | 'report' | 'lead-sheet' | 'dashboard';

/**
 * Déclenche un export PDF premium en appliquant un body class temporaire qui
 * révèle le CSS print Sprint 34/46 (cover page, footer, etc.) puis appelle
 * window.print(). Le class est retiré au `afterprint` event ou en fallback.
 *
 * @param mode  Template print à activer
 * @param ctx   Contexte optionnel (dashboardId pour mode='dashboard')
 */
export function triggerPdfExport(mode: PdfMode, ctx?: { dashboardId?: string | number }): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const bodyClass = `pdf-mode-${mode}`;
  document.body.classList.add(bodyClass);
  document.body.classList.add('pdf-mode-active');

  // Sprint 46 M1.4 — Expose le dashboardId au CSS (data-attr) si présent
  if (mode === 'dashboard' && ctx?.dashboardId !== undefined && ctx.dashboardId !== null) {
    document.body.setAttribute('data-pdf-dashboard-id', String(ctx.dashboardId));
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove(bodyClass);
    document.body.classList.remove('pdf-mode-active');
    document.body.removeAttribute('data-pdf-dashboard-id');
    window.removeEventListener('afterprint', cleanup);
  };

  // `afterprint` fire après que la dialog est fermée (print OU annuler)
  window.addEventListener('afterprint', cleanup, { once: true });

  // Petite latence pour laisser CSS appliquer avant le snapshot du navigateur
  window.setTimeout(() => {
    try {
      window.print();
    } catch {
      // fail silent
    }
    // Fallback : certains navigateurs ne fire pas afterprint (Safari iOS notamment)
    window.setTimeout(cleanup, 1500);
  }, 80);
}
