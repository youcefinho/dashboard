// ── Sprint 47 M2.2 — Legal layout commun ─────────────────────────────────────
// Sidebar TOC sticky + main content + toolbar (Imprimer / Download PDF).
// Stripe paradigm SUBTLE : surfaces white, border-subtle, type-prose sober.
// Pas d'orbs, pas de gradients massifs — pages legal doivent être imprimables.

import { useEffect, useState, type ReactNode } from 'react';
import { Printer, FileDown, Link2 } from 'lucide-react';
import { PublicLayout } from '../../landing/PublicLayout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { triggerPdfExport } from '@/lib/pdfExport';
import { MarketingMeta } from '../_meta';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface LegalLayoutProps {
  /** Titre page H1, ex: "Conditions d'utilisation". */
  pageTitle: string;
  /** Sous-titre court sous H1. */
  subtitle?: string;
  /** Date dernière maj affichée header (ex: "15 mai 2026"). */
  lastUpdated: string;
  /** Sections du document — chacune avec id (slug) + titre + body. */
  sections: LegalSection[];
  /** SEO meta title. */
  metaTitle: string;
  /** SEO meta description. */
  metaDescription: string;
  /** SEO canonical path (ex: "/marketing/legal/terms"). */
  metaPath: string;
}

export function LegalLayout({
  pageTitle,
  subtitle,
  lastUpdated,
  sections,
  metaTitle,
  metaDescription,
  metaPath,
}: LegalLayoutProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');

  // Scroll-spy : active section TOC item selon position scroll.
  useEffect(() => {
    if (typeof window === 'undefined' || sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: '-20% 0% -60% 0%', threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [sections]);

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  const handlePdf = () => {
    triggerPdfExport('report');
  };

  return (
    <PublicLayout>
      <MarketingMeta title={metaTitle} description={metaDescription} path={metaPath} />

      <div className="mk-legal">
        {/* Header */}
        <header className="mk-legal__header">
          <p className="mk-legal__eyebrow">Mentions légales</p>
          <h1 className="mk-legal__title">{pageTitle}</h1>
          {subtitle && <p className="mk-legal__subtitle">{subtitle}</p>}

          <div className="mk-legal__meta-row">
            <span className="mk-legal__updated">Dernière mise à jour : {lastUpdated}</span>
            <div className="mk-legal__actions print-hide">
              <Button variant="secondary" size="sm" leftIcon={<Icon as={Printer} size={14} />} onClick={handlePrint}>
                Imprimer
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Icon as={FileDown} size={14} />} onClick={handlePdf}>
                Télécharger PDF
              </Button>
            </div>
          </div>
        </header>

        {/* Body : sidebar TOC + main content */}
        <div className="mk-legal__body">
          <aside className="mk-legal__toc print-hide">
            <div className="mk-legal__toc-inner">
              <p className="mk-legal__toc-title">Sommaire</p>
              <nav aria-label="Sommaire du document">
                <ol className="mk-legal__toc-list">
                  {sections.map((s, i) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className={`mk-legal__toc-link${activeId === s.id ? ' mk-legal__toc-link--active' : ''}`}
                      >
                        <span className="mk-legal__toc-num">{i + 1}.</span>
                        <span>{s.title}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
          </aside>

          <article className="mk-legal__content">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="mk-legal__section">
                <h2 className="mk-legal__h2">
                  <a href={`#${s.id}`} className="mk-legal__anchor" aria-label={`Lien vers ${s.title}`}>
                    <Icon as={Link2} size={14} />
                  </a>
                  <span className="mk-legal__h2-num">{i + 1}.</span>
                  {s.title}
                </h2>
                <div className="mk-legal__prose">{s.body}</div>
              </section>
            ))}
          </article>
        </div>
      </div>
    </PublicLayout>
  );
}
