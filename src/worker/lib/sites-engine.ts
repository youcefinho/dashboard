// ── sites-engine.ts — helpers PURS pour LOT SITE BUILDER (Sprint 10) ────────
//
// Engine helpers RENFORCEMENT pour sites.ts. ZÉRO I/O (pas de DB, pas de
// fetch, pas de crypto.randomUUID dans les helpers d'audit). Toutes les
// fonctions sont déterministes et facilement testables.
//
// Périmètre :
//   - Validation slug applicatif (kebab-case 3-50)
//   - Validation input création/maj site (bornes)
//   - Validation page nav JSON (profondeur récursive ≤ 3)
//   - Validation SEO metadata (title ≤ 60, description ≤ 160)
//   - Pré-flight publish (au moins 1 page + SEO requis)
//
// 100% additif : sites.ts continue de fonctionner sans cet engine. Les
// handlers peuvent l'appeler EN AMONT pour valider le payload AVANT toute
// requête DB (économie + erreurs plus parlantes).

import type { SiteNavItem } from '../../lib/api';

// ── Codes d'erreur stables (calque pattern boutique/inventory engines) ──────
// Convention : 'sites.<domain>.<reason>'.
export const SITES_ERROR_CODES = {
  INVALID_SLUG: 'sites.slug.invalid',
  INVALID_NAME: 'sites.name.invalid',
  INVALID_DESCRIPTION: 'sites.description.invalid',
  INVALID_STATUS: 'sites.status.invalid',
  INVALID_NAV: 'sites.nav.invalid',
  NAV_DEPTH_EXCEEDED: 'sites.nav.depth_exceeded',
  INVALID_SEO_TITLE: 'sites.seo.title_invalid',
  INVALID_SEO_DESCRIPTION: 'sites.seo.description_invalid',
  INVALID_SEO_IMAGE: 'sites.seo.image_invalid',
  PUBLISH_NO_PAGES: 'sites.publish.no_pages',
  PUBLISH_NO_HOME: 'sites.publish.no_home',
  PUBLISH_NO_SEO: 'sites.publish.no_seo',
} as const;

// ── Bornes documentées (SEO 60/160 = pratiques Google standard) ─────────────
export const MAX_TITLE_LENGTH = 60;
export const MAX_DESC_LENGTH = 160;
export const MAX_NAV_DEPTH = 3;
export const MIN_SLUG_LENGTH = 3;
export const MAX_SLUG_LENGTH = 50;
export const MAX_SITE_NAME_LENGTH = 200;
export const MAX_SITE_DESCRIPTION_LENGTH = 500;
export const VALID_SITE_STATUSES = ['draft', 'published', 'archived'] as const;

export type SiteStatus = (typeof VALID_SITE_STATUSES)[number];

// ── Validation slug applicatif (kebab-case, 3-50) ───────────────────────────
// Calque la convention slugify() de sites.ts (lowercase, ASCII, dash). Cette
// fonction valide qu'un slug DÉJÀ slugifié respecte la grammaire publique.
export function validateSiteSlug(slug: unknown): boolean {
  if (typeof slug !== 'string') return false;
  const trimmed = slug.trim();
  if (trimmed.length < MIN_SLUG_LENGTH || trimmed.length > MAX_SLUG_LENGTH) return false;
  // Pas de leading/trailing dash, pas de double dash, kebab-case strict
  return /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/.test(trimmed);
}

// ── Validation input création/maj site ──────────────────────────────────────
// Vérifie les bornes appliquées par sanitizeInput dans sites.ts MAIS retourne
// un code d'erreur plutôt que de tronquer silencieusement.
export interface SiteInputResult {
  ok: boolean;
  error?: string;
  field?: string;
}

export function validateSiteInput(input: unknown): SiteInputResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: SITES_ERROR_CODES.INVALID_NAME, field: 'name' };
  }
  const body = input as Record<string, unknown>;

  // name : obligatoire à la création, optionnel à la maj — on accepte absence.
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_NAME, field: 'name' };
    }
    const name = body.name.trim();
    if (name.length === 0 || name.length > MAX_SITE_NAME_LENGTH) {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_NAME, field: 'name' };
    }
  }

  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_DESCRIPTION, field: 'description' };
    }
    if (body.description.length > MAX_SITE_DESCRIPTION_LENGTH) {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_DESCRIPTION, field: 'description' };
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_SITE_STATUSES.includes(body.status as SiteStatus)) {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_STATUS, field: 'status' };
    }
  }

  return { ok: true };
}

// ── Validation page nav JSON (profondeur récursive ≤ MAX_NAV_DEPTH) ─────────
// Une nav d'un site = tree d'items (label + slug/url + optional children).
// On limite la profondeur pour éviter compileNavToHtml en runaway.
export interface NavValidationResult {
  ok: boolean;
  nav?: SiteNavItem[];
  error?: string;
}

function navItemDepth(item: unknown, current = 0): number {
  if (!item || typeof item !== 'object') return current;
  const obj = item as Record<string, unknown>;
  const children = obj.children;
  if (!Array.isArray(children) || children.length === 0) return current;
  let max = current;
  for (const child of children) {
    const d = navItemDepth(child, current + 1);
    if (d > max) max = d;
  }
  return max;
}

function isValidNavItem(item: unknown): item is SiteNavItem {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  // label obligatoire (string non-vide)
  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) return false;
  // au moins un page_slug OU url (SiteNavItem shape — api.ts:4725)
  const hasSlug = typeof obj.page_slug === 'string' && obj.page_slug.trim().length > 0;
  const hasUrl = typeof obj.url === 'string' && obj.url.trim().length > 0;
  if (!hasSlug && !hasUrl) return false;
  // children optionnel (extension forward-compat). Si présent, doit être array
  // d'items valides — utilisé pour valider la profondeur récursive.
  if (obj.children !== undefined) {
    if (!Array.isArray(obj.children)) return false;
    for (const child of obj.children) {
      if (!isValidNavItem(child)) return false;
    }
  }
  return true;
}

export function validatePageNav(navJson: unknown): NavValidationResult {
  // Accepte string JSON ou array direct
  let parsed: unknown = navJson;
  if (typeof navJson === 'string') {
    try {
      parsed = JSON.parse(navJson);
    } catch {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_NAV };
    }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: SITES_ERROR_CODES.INVALID_NAV };
  }
  // Empty nav = ok (site sans menu)
  if (parsed.length === 0) return { ok: true, nav: [] };

  for (const item of parsed) {
    if (!isValidNavItem(item)) {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_NAV };
    }
    if (navItemDepth(item) > MAX_NAV_DEPTH - 1) {
      return { ok: false, error: SITES_ERROR_CODES.NAV_DEPTH_EXCEEDED };
    }
  }
  return { ok: true, nav: parsed as SiteNavItem[] };
}

// ── Validation SEO metadata (bornes Google) ─────────────────────────────────
export interface SeoMetadata {
  title?: string | null;
  description?: string | null;
  og_image?: string | null;
}

export interface SeoValidationResult {
  ok: boolean;
  error?: string;
  field?: string;
}

export function validateSeoMetadata(seo: SeoMetadata): SeoValidationResult {
  if (seo.title != null) {
    if (typeof seo.title !== 'string') {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_SEO_TITLE, field: 'seo_title' };
    }
    if (seo.title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: SITES_ERROR_CODES.INVALID_SEO_TITLE, field: 'seo_title' };
    }
  }
  if (seo.description != null) {
    if (typeof seo.description !== 'string') {
      return {
        ok: false,
        error: SITES_ERROR_CODES.INVALID_SEO_DESCRIPTION,
        field: 'seo_description',
      };
    }
    if (seo.description.length > MAX_DESC_LENGTH) {
      return {
        ok: false,
        error: SITES_ERROR_CODES.INVALID_SEO_DESCRIPTION,
        field: 'seo_description',
      };
    }
  }
  if (seo.og_image != null) {
    if (typeof seo.og_image !== 'string') {
      return {
        ok: false,
        error: SITES_ERROR_CODES.INVALID_SEO_IMAGE,
        field: 'seo_image',
      };
    }
    // URL minimale : http(s):// ou path relatif /
    const v = seo.og_image.trim();
    if (v.length > 0 && !/^https?:\/\//i.test(v) && !v.startsWith('/')) {
      return {
        ok: false,
        error: SITES_ERROR_CODES.INVALID_SEO_IMAGE,
        field: 'seo_image',
      };
    }
  }
  return { ok: true };
}

// ── Pré-flight publish (state machine guard) ────────────────────────────────
// Refuse de publier un site sans page OU sans SEO minimal. Ne renvoie PAS
// d'erreur 4xx : c'est au handler (sites.ts:handlePublishSite) de décider.
export interface PublishablePage {
  id?: string;
  is_home?: number | boolean | null;
  seo_title?: string | null;
  seo_description?: string | null;
}

export interface PublishGuardResult {
  ok: boolean;
  reason?: string;
}

export function canPublishSite(
  site: { pages: PublishablePage[] } | undefined,
): PublishGuardResult {
  if (!site || !Array.isArray(site.pages) || site.pages.length === 0) {
    return { ok: false, reason: SITES_ERROR_CODES.PUBLISH_NO_PAGES };
  }
  // au moins une page home (is_home=1) sinon le rendu retombe sur la 1re par
  // position (déjà géré dans sites.ts), MAIS pour valider un publish "propre"
  // on demande explicitement une home — soft check : sites.ts garde sa logique.
  const hasHome = site.pages.some((p) => Number(p.is_home) === 1);
  if (!hasHome) {
    return { ok: false, reason: SITES_ERROR_CODES.PUBLISH_NO_HOME };
  }
  // Au moins une page avec SEO title (pour le partage social / index Google).
  const hasSeo = site.pages.some(
    (p) =>
      typeof p.seo_title === 'string' &&
      p.seo_title.trim().length > 0,
  );
  if (!hasSeo) {
    return { ok: false, reason: SITES_ERROR_CODES.PUBLISH_NO_SEO };
  }
  return { ok: true };
}

// ── Helper : normalise un slug applicatif (calque sites.ts:slugify) ─────────
// Pur, idempotent, sans dépendance Worker — utile pour les tests + une
// migration future de sites.ts qui réutiliserait cette fonction.
export function normalizeSiteSlug(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
  return base || 'site';
}
