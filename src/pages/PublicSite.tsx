// ── PublicSite — site multi-pages publié (LOT SITE BUILDER, Sprint 10) ───────
//
// Manager-C Phase B (frontend) — fichier NOUVEAU (§6.G/§6.H), export
// `PublicSitePage`. SPA hydraté public — PAS de SSR React (crawler =
// maybeServeSiteSsr méta-only côté worker, Manager-B). CALQUE le pattern de
// src/pages/PublicFunnel.tsx : pas d'auth, fetch brut via helpers api FIGÉS
// (getPublicSite / getPublicSitePage), spinner loading, écran succès,
// interception du submit de form. AJOUT vs PublicFunnel : barre de navigation
// rendue depuis nav (SiteNavItem[]) + routing par slug de page (params
// $slug / $page). Le HTML des blocs est compilé par compileBlocksToHtml
// (DÉJÀ sanitisé/échappé côté funnel-blocks.ts) → dangerouslySetInnerHTML sûr.
// i18n t('site.public.*') (clés figées Phase A — AUCUNE création).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  getPublicSite,
  getPublicSitePage,
  type Site,
  type SitePage,
  type SiteNavItem,
} from '@/lib/api';
import { compileBlocksToHtml } from '@/worker/funnel-blocks';
import { t } from '@/lib/i18n';

export function PublicSitePage() {
  const { slug, page } = useParams({ strict: false }) as {
    slug: string;
    page?: string;
  };

  const [site, setSite] = useState<Site | null>(null);
  const [pageData, setPageData] = useState<SitePage | null>(null);
  const [nav, setNav] = useState<SiteNavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ message: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Chargement public (calque PublicFunnel.tsx:38-59). Si `:page` présent →
  // getPublicSitePage (page interne par slug) ; sinon getPublicSite (accueil,
  // résout la page is_home=1 côté worker / parmi pages).
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    const run = async () => {
      if (page) {
        const res = await getPublicSitePage(slug, page);
        if (!alive) return;
        if (res.error || !res.data) {
          setError(res.error || t('site.public.not_found'));
        } else {
          setSite(res.data.site);
          setPageData(res.data.page);
          setNav(Array.isArray(res.data.nav) ? res.data.nav : []);
        }
      } else {
        const res = await getPublicSite(slug);
        if (!alive) return;
        if (res.error || !res.data) {
          setError(res.error || t('site.public.not_found'));
        } else {
          setSite(res.data.site);
          const pgs = res.data.pages || [];
          const home = pgs.find((p) => p.is_home) || pgs[0] || null;
          setPageData(home);
          setNav(Array.isArray(res.data.nav) ? res.data.nav : []);
        }
      }
    };
    run().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [slug, page]);

  const html = useMemo(
    () =>
      pageData
        ? compileBlocksToHtml(pageData.blocks || [], {
            slug,
            title: pageData.title || site?.name || undefined,
          })
        : '',
    [pageData, slug, site?.name],
  );

  // Le HTML compilé contient un <form data-fb-form>. On intercepte son submit
  // (calque PublicFunnel.tsx:88-127). Le form compilé poste vers
  // /api/p/:slug/submit (cible embarquée par compileBlocksToHtml) ; on relaie
  // best-effort puis on affiche le message de succès (data-fb-success).
  const handleFormSubmit = useCallback(
    async (form: HTMLFormElement) => {
      if (submitting) return;
      setSubmitting(true);
      const fd = new FormData(form);
      const data: Record<string, unknown> = {};
      fd.forEach((v, k) => {
        data[k] = v;
      });
      const successMsg = form.getAttribute('data-fb-success') || '';
      const redirect = form.getAttribute('data-fb-redirect') || '';
      let ok = true;
      try {
        // Soumission relayée vers le pipeline public site (source='site' côté worker).
        // Best-effort — ne bloque jamais l'écran de succès.
        const res = await fetch(`/api/site/${slug}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_slug: pageData?.slug, data }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      setSubmitting(false);
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      if (!ok && !successMsg) {
        // Échec sans message dédié : on laisse le formulaire (pas d'écran).
        return;
      }
      setDone({ message: successMsg || t('site.public.not_found') });
      window.scrollTo({ top: 0 });
    },
    [slug, pageData?.slug, submitting],
  );

  // Délégation submit sur le contenu hydraté (calque PublicFunnel.tsx:131-143).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (form && form.matches?.('form[data-fb-form]')) {
        e.preventDefault();
        void handleFormSubmit(form);
      }
    };
    el.addEventListener('submit', onSubmit, true);
    return () => el.removeEventListener('submit', onSubmit, true);
  }, [handleFormSubmit, html]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid rgba(0,157,219,0.2)',
            borderTopColor: '#009DDB',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error && !done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {t('site.public.not_found')}
          </h1>
          <p style={{ color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-white">
        <div style={{ maxWidth: 480 }}>
          <div
            style={{
              width: 64,
              height: 64,
              background: '#ecfdf5',
              color: '#10b981',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: 28,
            }}
          >
            ✓
          </div>
          <p style={{ color: '#6b7280', whiteSpace: 'pre-wrap' }}>
            {done.message}
          </p>
        </div>
      </div>
    );
  }

  // Barre de nav : lien interne page_slug prioritaire → /site/:slug/:page_slug,
  // sinon lien externe url. (Calque la sémantique site-nav.ts:compileNavToHtml
  // côté worker — ici rendu React pour le SPA hydraté.)
  const navItems = nav.filter((n) => n.label && (n.page_slug || n.url));

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {navItems.length > 0 && (
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '14px 24px',
            borderBottom: '1px solid #e5e7eb',
            background: '#fff',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 16, marginRight: 'auto' }}>
            {site?.name}
          </span>
          {navItems.map((item, i) => {
            const href = item.page_slug
              ? `/site/${slug}/${item.page_slug}`
              : item.url || '#';
            const isActive =
              !!item.page_slug &&
              ((page && item.page_slug === page) ||
                (!page && item.page_slug === pageData?.slug));
            return (
              <a
                key={i}
                href={href}
                {...(item.page_slug ? {} : { rel: 'noopener noreferrer' })}
                style={{
                  fontSize: 14,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#009DDB' : '#374151',
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      )}

      <div
        ref={containerRef}
        // HTML déjà sanitisé/échappé par compileBlocksToHtml (esc/safeUrl) —
        // sécurité XSS assurée à la compilation, pas ici.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
