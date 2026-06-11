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
  const [showPopup, setShowPopup] = useState(false);
  const [popupConfig, setPopupConfig] = useState<any>(null);
  const [popupFormData, setPopupFormData] = useState<Record<string, string>>({});
  const [popupSubmitting, setPopupSubmitting] = useState(false);
  const [popupSuccess, setPopupSuccess] = useState(false);
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
          try {
            const theme = res.data.site.theme_json ? JSON.parse(res.data.site.theme_json) : {};
            if (theme.popup && theme.popup.enabled) {
              setPopupConfig(theme.popup);
            }
          } catch { /* ignore */ }
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
          try {
            const theme = res.data.site.theme_json ? JSON.parse(res.data.site.theme_json) : {};
            if (theme.popup && theme.popup.enabled) {
              setPopupConfig(theme.popup);
            }
          } catch { /* ignore */ }
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

  // Déclenchement sur exit-intent
  useEffect(() => {
    if (!popupConfig || !popupConfig.enabled || !popupConfig.exit_intent) return;
    
    let triggered = false;
    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY < 50 && !triggered) {
        triggered = true;
        setShowPopup(true);
      }
    };
    
    document.addEventListener('mouseleave', handleMouseLeave);
    return () => document.removeEventListener('mouseleave', handleMouseLeave);
  }, [popupConfig]);

  // Déclenchement sur timer
  useEffect(() => {
    if (!popupConfig || !popupConfig.enabled || popupConfig.exit_intent) return;
    
    const timer = setTimeout(() => {
      setShowPopup(true);
    }, (popupConfig.delay || 5) * 1000);
    
    return () => clearTimeout(timer);
  }, [popupConfig]);

  const handlePopupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!popupConfig || popupSubmitting) return;
    setPopupSubmitting(true);
    
    try {
      const res = await fetch('/api/form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: popupConfig.form_id || 'popup-default',
          data: popupFormData,
        }),
      });
      if (res.ok) {
        setPopupSuccess(true);
        setTimeout(() => {
          setShowPopup(false);
          setPopupSuccess(false);
          setPopupFormData({});
        }, 3000);
      }
    } catch {
      // best-effort
    } finally {
      setPopupSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-surface)]">
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
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-[var(--bg-surface)]">
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-surface)' }}>
      {navItems.length > 0 && (
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '14px 24px',
            borderBottom: '1px solid #e5e7eb',
            background: 'var(--bg-surface)',
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

      {showPopup && popupConfig && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16,
          animation: 'fadeIn 0.2s ease-out',
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 16,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '100%',
            maxWidth: 440,
            padding: 24,
            position: 'relative',
            animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            <button
              onClick={() => setShowPopup(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'none',
                border: 'none',
                fontSize: 20,
                cursor: 'pointer',
                color: '#6b7280',
              }}
            >
              ✕
            </button>
            
            {popupSuccess ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{
                  width: 56,
                  height: 56,
                  backgroundColor: '#ecfdf5',
                  color: '#10b981',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  fontSize: 24,
                }}>
                  ✓
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#111827' }}>Merci !</h3>
                <p style={{ fontSize: 14, color: '#4b5563', margin: 0 }}>Vos informations ont été enregistrées.</p>
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px', color: '#111827', letterSpacing: '-0.025em' }}>
                  {popupConfig.title || 'Restons en contact'}
                </h3>
                <p style={{ fontSize: 14, color: '#4b5563', margin: '0 0 20px', lineHeight: 1.5 }}>
                  {popupConfig.description || 'Laissez-nous vos coordonnées pour en savoir plus.'}
                </p>
                
                <form onSubmit={handlePopupSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Nom</label>
                    <input
                      type="text"
                      required
                      value={popupFormData.name || ''}
                      onChange={e => setPopupFormData(prev => ({ ...prev, name: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: 8,
                        fontSize: 14,
                        outline: 'none',
                        color: '#111827',
                        backgroundColor: 'var(--bg-surface)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Email</label>
                    <input
                      type="email"
                      required
                      value={popupFormData.email || ''}
                      onChange={e => setPopupFormData(prev => ({ ...prev, email: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: 8,
                        fontSize: 14,
                        outline: 'none',
                        color: '#111827',
                        backgroundColor: 'var(--bg-surface)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Téléphone</label>
                    <input
                      type="tel"
                      value={popupFormData.phone || ''}
                      onChange={e => setPopupFormData(prev => ({ ...prev, phone: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: 8,
                        fontSize: 14,
                        outline: 'none',
                        color: '#111827',
                        backgroundColor: 'var(--bg-surface)',
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={popupSubmitting}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: '#009DDB',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginTop: 8,
                      boxShadow: '0 4px 6px -1px rgba(0, 157, 219, 0.2)',
                    }}
                  >
                    {popupSubmitting ? 'Envoi...' : 'Envoyer'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Animations keyframes inline */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}
