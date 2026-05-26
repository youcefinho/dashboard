// ── Tests src/worker/lib/sites-engine.ts — LOT SITE BUILDER (Sprint 10) ────
// Helpers PURS de validation : slug applicatif, input bornes, nav profondeur,
// SEO bornes Google (60/160), pré-flight publish. ZÉRO I/O — pas de mock D1.
import { describe, it, expect } from 'vitest';
import {
  SITES_ERROR_CODES,
  MAX_TITLE_LENGTH,
  MAX_DESC_LENGTH,
  MAX_NAV_DEPTH,
  validateSiteSlug,
  validateSiteInput,
  validatePageNav,
  validateSeoMetadata,
  canPublishSite,
  normalizeSiteSlug,
} from '../lib/sites-engine';

describe('validateSiteSlug — kebab-case 3-50', () => {
  it('accepte un slug propre simple', () => {
    expect(validateSiteSlug('mon-site')).toBe(true);
    expect(validateSiteSlug('site-2024')).toBe(true);
    expect(validateSiteSlug('abc')).toBe(true);
  });

  it('refuse les slugs trop courts ou trop longs', () => {
    expect(validateSiteSlug('ab')).toBe(false);
    expect(validateSiteSlug('a'.repeat(51))).toBe(false);
  });

  it('refuse les slugs avec leading/trailing dash ou double dash', () => {
    expect(validateSiteSlug('-leading')).toBe(false);
    expect(validateSiteSlug('trailing-')).toBe(false);
    expect(validateSiteSlug('double--dash')).toBe(false);
  });

  it('refuse les caractères non autorisés (majuscules, espaces, accents)', () => {
    expect(validateSiteSlug('Mon-Site')).toBe(false);
    expect(validateSiteSlug('mon site')).toBe(false);
    expect(validateSiteSlug('café')).toBe(false);
    expect(validateSiteSlug('mon_site')).toBe(false);
  });

  it('refuse les non-strings et valeurs vides', () => {
    expect(validateSiteSlug(null)).toBe(false);
    expect(validateSiteSlug(undefined)).toBe(false);
    expect(validateSiteSlug(123)).toBe(false);
    expect(validateSiteSlug('')).toBe(false);
  });
});

describe('validateSiteInput — bornes name/description/status', () => {
  it('accepte un input minimal valide', () => {
    expect(validateSiteInput({ name: 'Mon Site' }).ok).toBe(true);
    expect(validateSiteInput({}).ok).toBe(true);
  });

  it('refuse un name vide ou > 200 chars', () => {
    expect(validateSiteInput({ name: '' }).ok).toBe(false);
    const long = 'a'.repeat(201);
    expect(validateSiteInput({ name: long }).ok).toBe(false);
  });

  it('refuse une description > 500 chars', () => {
    const r = validateSiteInput({ description: 'a'.repeat(501) });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('description');
  });

  it('refuse un status hors enum', () => {
    const r = validateSiteInput({ status: 'invalid' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SITES_ERROR_CODES.INVALID_STATUS);
  });

  it('accepte les 3 statuts valides', () => {
    expect(validateSiteInput({ status: 'draft' }).ok).toBe(true);
    expect(validateSiteInput({ status: 'published' }).ok).toBe(true);
    expect(validateSiteInput({ status: 'archived' }).ok).toBe(true);
  });

  it('refuse un non-objet', () => {
    expect(validateSiteInput(null).ok).toBe(false);
    expect(validateSiteInput('string').ok).toBe(false);
  });
});

describe('validatePageNav — profondeur récursive bornée', () => {
  it('accepte une nav vide', () => {
    const r = validatePageNav([]);
    expect(r.ok).toBe(true);
    expect(r.nav).toEqual([]);
  });

  it('accepte une nav flat valide (page_slug)', () => {
    const nav = [
      { label: 'Accueil', page_slug: 'home' },
      { label: 'Contact', page_slug: 'contact' },
    ];
    expect(validatePageNav(nav).ok).toBe(true);
  });

  it('accepte une nav avec URL externe', () => {
    const nav = [{ label: 'Externe', url: 'https://example.com' }];
    expect(validatePageNav(nav).ok).toBe(true);
  });

  it('refuse un item sans label', () => {
    expect(validatePageNav([{ page_slug: 'home' }]).ok).toBe(false);
  });

  it('refuse un item sans slug ni url', () => {
    expect(validatePageNav([{ label: 'Vide' }]).ok).toBe(false);
  });

  it('refuse un input non-array', () => {
    expect(validatePageNav({ label: 'x' }).ok).toBe(false);
    expect(validatePageNav(null).ok).toBe(false);
    expect(validatePageNav(42).ok).toBe(false);
  });

  it('parse une string JSON valide', () => {
    const json = JSON.stringify([{ label: 'A', page_slug: 'a' }]);
    expect(validatePageNav(json).ok).toBe(true);
  });

  it('refuse une string JSON invalide', () => {
    expect(validatePageNav('not-json{').ok).toBe(false);
  });

  it(`refuse une nav avec profondeur > ${MAX_NAV_DEPTH - 1}`, () => {
    // children=2 niveaux + root = depth 2 → MAX_NAV_DEPTH-1=2, OK
    // children=3 niveaux + root = depth 3 → > 2, REFUSÉ
    const deep = [
      {
        label: 'L0',
        page_slug: 'l0',
        children: [
          {
            label: 'L1',
            page_slug: 'l1',
            children: [
              {
                label: 'L2',
                page_slug: 'l2',
                children: [{ label: 'L3', page_slug: 'l3' }],
              },
            ],
          },
        ],
      },
    ];
    const r = validatePageNav(deep);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SITES_ERROR_CODES.NAV_DEPTH_EXCEEDED);
  });
});

describe('validateSeoMetadata — bornes Google (60/160)', () => {
  it('accepte SEO vide ou null', () => {
    expect(validateSeoMetadata({}).ok).toBe(true);
    expect(validateSeoMetadata({ title: null, description: null }).ok).toBe(true);
  });

  it('accepte des valeurs sous les bornes', () => {
    expect(
      validateSeoMetadata({
        title: 'A'.repeat(MAX_TITLE_LENGTH),
        description: 'B'.repeat(MAX_DESC_LENGTH),
      }).ok,
    ).toBe(true);
  });

  it('refuse un title > 60 chars', () => {
    const r = validateSeoMetadata({ title: 'A'.repeat(61) });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('seo_title');
  });

  it('refuse une description > 160 chars', () => {
    const r = validateSeoMetadata({ description: 'B'.repeat(161) });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('seo_description');
  });

  it('accepte une og_image en https ou chemin relatif', () => {
    expect(validateSeoMetadata({ og_image: 'https://example.com/og.jpg' }).ok).toBe(true);
    expect(validateSeoMetadata({ og_image: '/static/og.jpg' }).ok).toBe(true);
  });

  it('refuse une og_image non-URL/non-path', () => {
    const r = validateSeoMetadata({ og_image: 'invalid' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('seo_image');
  });
});

describe('canPublishSite — pré-flight publish', () => {
  it('refuse un site sans pages', () => {
    const r = canPublishSite({ pages: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(SITES_ERROR_CODES.PUBLISH_NO_PAGES);
  });

  it('refuse un site sans page is_home', () => {
    const r = canPublishSite({
      pages: [{ id: 'p1', is_home: 0, seo_title: 'Page' }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(SITES_ERROR_CODES.PUBLISH_NO_HOME);
  });

  it('refuse un site sans SEO title sur aucune page', () => {
    const r = canPublishSite({
      pages: [{ id: 'p1', is_home: 1, seo_title: '' }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(SITES_ERROR_CODES.PUBLISH_NO_SEO);
  });

  it('accepte un site avec home + SEO', () => {
    const r = canPublishSite({
      pages: [
        { id: 'p1', is_home: 1, seo_title: 'Accueil — Mon Site' },
        { id: 'p2', is_home: 0, seo_title: '' },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('refuse un site undefined', () => {
    const r = canPublishSite(undefined);
    expect(r.ok).toBe(false);
  });
});

describe('normalizeSiteSlug — idempotent + ASCII', () => {
  it('normalise un nom avec accents et espaces', () => {
    expect(normalizeSiteSlug('Mon Café 2024')).toBe('mon-cafe-2024');
  });

  it('renvoie "site" sur input vide', () => {
    expect(normalizeSiteSlug('')).toBe('site');
    expect(normalizeSiteSlug('!!!')).toBe('site');
  });

  it('est idempotent : normalize(normalize(x)) === normalize(x)', () => {
    const x = 'Mon Beau Site';
    const once = normalizeSiteSlug(x);
    expect(normalizeSiteSlug(once)).toBe(once);
  });

  it('clamp à 50 chars max', () => {
    const out = normalizeSiteSlug('a'.repeat(100));
    expect(out.length).toBeLessThanOrEqual(50);
  });
});
