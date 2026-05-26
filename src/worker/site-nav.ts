// ── site-nav.ts — LOT SITE BUILDER (Sprint 10) ──────────────────────────────
//
// Compilateur de la BARRE DE NAVIGATION d'un site multi-pages → HTML <nav>
// XSS-safe. NEUF (le moteur de blocs funnel-blocks.ts est GELÉ — on ne l'édite
// PAS ; pour compiler une nav on crée CE fichier). esc/safeUrl sont
// RÉIMPLÉMENTÉS LOCALEMENT (calque EXACT funnel-blocks.ts:esc/safeUrl + route-
// meta-ssr.ts:escapeHtml) — on n'importe PAS depuis le fichier gelé pour éviter
// tout couplage (esc/safeUrl y sont privés, non exportés).
//
// ⚠ STUB PHASE A — SIGNATURE FIGÉE (Manager-A SOLO). Corps réel Phase B
//   (Manager-B). Le stub renvoie déjà un <nav> valide et XSS-safe (suffisant
//   pour ne pas casser le build) ; Phase B enrichit (page active, responsive).
//
// Sécurité XSS : TOUT contenu utilisateur (label, url) DOIT être échappé. Non
// négociable (rendu public). Calque funnel-blocks.ts.

import type { SiteNavItem } from '../lib/api';

// Échappement HTML — CALQUE EXACT funnel-blocks.ts:esc / route-meta-ssr.ts:escapeHtml.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sanitize URL : seulement http(s), mailto, tel, ancres, chemins relatifs.
// Toute autre valeur (javascript:, data:, vbscript:…) → '#'. CALQUE EXACT
// funnel-blocks.ts:safeUrl.
function safeUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '#';
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(s)) return esc(s);
  return '#';
}

// ── Compilateur principal — CORPS PHASE B ───────────────────────────────────
// SIGNATURE FIGÉE Phase A. Compile une liste d'items de navigation en <nav>
// XSS-safe. Chaque item a un `label` + soit `page_slug` (lien interne
// `/site/:siteSlug/:page_slug` — `siteSlug` fourni par opts) soit `url` (lien
// externe). page_slug prioritaire si les deux sont fournis. Items au label vide
// ignorés. STUB Phase A : rendu minimal valide ; Phase B affine (page active
// via opts.activeSlug, accessibilité, responsive).
export function compileNavToHtml(
  navItems: SiteNavItem[],
  opts?: { siteSlug?: string; activeSlug?: string },
): string {
  const items = Array.isArray(navItems) ? navItems : [];
  const siteSlug = String(opts?.siteSlug || '').trim();
  const links = items
    .filter((it) => it && String(it.label || '').trim())
    .map((it) => {
      const label = esc(it.label);
      let href: string;
      if (it.page_slug) {
        // Lien interne : /site/:siteSlug/:page_slug (slugs déjà slugifiés serveur).
        href = safeUrl(
          siteSlug
            ? `/site/${encodeURIComponent(siteSlug)}/${encodeURIComponent(String(it.page_slug))}`
            : `#${esc(it.page_slug)}`,
        );
      } else {
        href = safeUrl(it.url);
      }
      return `<a class="site-nav-link" href="${href}">${label}</a>`;
    })
    .join('\n      ');
  if (!links) return '';
  return `<nav class="site-nav" aria-label="Navigation du site">
  <div class="site-nav-inner">
      ${links}
  </div>
</nav>`;
}
