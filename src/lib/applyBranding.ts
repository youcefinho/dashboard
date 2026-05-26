// ── applyBranding — propagation front du branding tenant (LOT WHITE-LABEL APPLY, Sprint 20)
// ════════════════════════════════════════════════════════════════════════════
// NEUF — FIGÉ Phase A (Manager-A). Manager-C l'APPELLE (AppLayout/Sidebar) ; il
// ne le modifie PAS. 100% ADDITIF, AUCUNE migration : ne lit que du branding
// DÉJÀ stocké (couleurs seq 81 + clés du JSON `branding` extensible).
//
// CONTRAT (rétro-compat BYTE) :
//   • applyTenantBranding(branding) — pose les overrides DOM (--primary/--accent,
//     favicon, suffixe document.title) UNIQUEMENT pour les valeurs VALIDES
//     présentes. Branding null/undefined/vide ⇒ NO-OP TOTAL ⇒ couleurs Intralys
//     (vars CSS :root index.css), favicon index.html, title inchangés.
//   • resetTenantBranding() — retire les overrides posés (retour aux défauts).
//
// BORNÉ TENANT : ce helper applique le branding du SEUL tenant qu'on lui passe.
// L'appelant (Manager-C) résout le branding du sous-compte ACTIF (getClientBranding)
// AVANT d'appeler — jamais de cross-tenant ici.
//
// ROBUSTE : tout est try/catch, validation hex stricte, aucune exception ne
// remonte (un branding malformé NE casse JAMAIS le boot). SSR-safe (garde
// typeof document).

import type { TenantBranding } from './types';

// Validation hex stricte (#rgb ou #rrggbb). On NE pose une var couleur QUE si la
// valeur matche — sinon on conserve la couleur Intralys par défaut (rétro-compat).
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

// id du <link rel="icon"> override posé par ce helper — distinct des favicons
// statiques d'index.html (qu'on ne supprime jamais), pour pouvoir le retirer
// proprement dans resetTenantBranding sans toucher au favicon Intralys de base.
const WL_FAVICON_ID = 'wl-tenant-favicon';

// Marqueur du suffixe de titre posé, pour le retirer idempotemment.
let appliedTitleSuffix: string | null = null;

/**
 * Propage le branding d'UN tenant sur les surfaces front globales.
 * NO-OP si `branding` est null/undefined ou ne contient aucune valeur valide
 * (couleurs Intralys par défaut conservées). Robuste : n'émet jamais d'exception.
 */
export function applyTenantBranding(branding: TenantBranding | null | undefined): void {
  if (typeof document === 'undefined') return; // SSR-safe
  if (!branding) return; // NO-OP : défaut Intralys (rétro-compat byte)

  try {
    const root = document.documentElement;

    // ── Couleurs : --primary / --accent (seulement si hex valide). ──
    // Une valeur absente/invalide laisse la var :root Intralys intacte.
    if (isValidHex(branding.primary_color)) {
      root.style.setProperty('--primary', branding.primary_color.trim());
    }
    if (isValidHex(branding.accent_color)) {
      root.style.setProperty('--accent', branding.accent_color.trim());
    }

    // ── Favicon : <link rel="icon"> dédié (id WL_FAVICON_ID). ──
    // On NE touche PAS aux <link> favicon statiques d'index.html : on ajoute
    // (ou met à jour) un link override identifiable, retirable au reset.
    const favicon = branding.favicon;
    if (typeof favicon === 'string' && favicon.trim().length > 0) {
      try {
        let link = document.getElementById(WL_FAVICON_ID) as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement('link');
          link.id = WL_FAVICON_ID;
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = favicon.trim();
      } catch {
        /* favicon best-effort : un échec ne casse pas la propagation */
      }
    }

    // ── document.title : suffixe « · <company_name> ». ──
    // Idempotent : on retire l'éventuel suffixe précédent avant d'en poser un
    // nouveau, pour ne jamais empiler à chaque appel (re-render / re-boot).
    const name = typeof branding.company_name === 'string' ? branding.company_name.trim() : '';
    if (appliedTitleSuffix && document.title.endsWith(appliedTitleSuffix)) {
      document.title = document.title.slice(0, -appliedTitleSuffix.length);
    }
    appliedTitleSuffix = null;
    if (name.length > 0) {
      const suffix = ` · ${name}`;
      if (!document.title.endsWith(suffix)) {
        document.title = document.title + suffix;
      }
      appliedTitleSuffix = suffix;
    }
  } catch {
    /* propagation best-effort : un branding malformé ne casse jamais le boot */
  }
}

/**
 * Retire les overrides de branding posés par applyTenantBranding (retour aux
 * défauts Intralys : vars :root, favicon index.html, titre sans suffixe).
 * Idempotent et robuste. À appeler ex. au changement de sous-compte / logout.
 */
export function resetTenantBranding(): void {
  if (typeof document === 'undefined') return; // SSR-safe
  try {
    const root = document.documentElement;
    // removeProperty rétablit la valeur :root Intralys (cascade CSS).
    root.style.removeProperty('--primary');
    root.style.removeProperty('--accent');

    // Retire le favicon override (le(s) favicon(s) index.html restent intacts).
    try {
      const link = document.getElementById(WL_FAVICON_ID);
      if (link && link.parentNode) link.parentNode.removeChild(link);
    } catch {
      /* best-effort */
    }

    // Retire le suffixe de titre posé.
    if (appliedTitleSuffix && document.title.endsWith(appliedTitleSuffix)) {
      document.title = document.title.slice(0, -appliedTitleSuffix.length);
    }
    appliedTitleSuffix = null;
  } catch {
    /* best-effort : reset ne casse jamais */
  }
}
