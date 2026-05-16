// ── Help article — Sprint 47 M3.3 (2026-05-15) ──────────────────────────
// Layout 3 colonnes : sidebar nav gauche + main MDX + TOC droite.
// Stripe-clean SUBTLE. react-markdown lazy chunk vendor-markdown Sprint 43.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { PublicLayout } from '@/pages/landing/PublicLayout';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/ui/Icon';
import {
  ChevronRight, Rocket, Users, MessageSquare, Workflow, Code, Mail,
  BookOpen, ArrowLeft, ArrowRight, ShieldCheck,
} from 'lucide-react';
import {
  DOC_SECTIONS,
  getDocBySlug, getDocsBySection,
} from '@/content/docs';

const SECTION_ICONS: Record<string, typeof Rocket> = {
  'getting-started': Rocket,
  'leads-pipeline':  Users,
  'communication':   MessageSquare,
  'automation':      Workflow,
  'api':             Code,
  'admin':           ShieldCheck,
};

interface TocEntry { id: string; text: string; level: 2 | 3; }

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n');
  const toc: TocEntry[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence) continue;
    const m2 = line.match(/^##\s+(.+?)\s*$/);
    const m3 = line.match(/^###\s+(.+?)\s*$/);
    if (m2) toc.push({ id: slugifyHeading(m2[1]!), text: m2[1]!, level: 2 });
    else if (m3) toc.push({ id: slugifyHeading(m3[1]!), text: m3[1]!, level: 3 });
  }
  return toc;
}

export function HelpArticlePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const article = getDocBySlug(slug);

  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/docs/${slug}.md`)
      .then((res) => res.text())
      .then((text) => {
        if (cancelled) return;
        setMarkdown(text);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMarkdown('# Article introuvable\n\nDésolé, cet article n’existe pas.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  const toc = useMemo(() => extractToc(markdown), [markdown]);

  const section = article ? DOC_SECTIONS.find((s) => s.id === article.sectionId) : undefined;

  // Prev / next dans la même section
  const sectionArticles = section ? getDocsBySection(section.id) : [];
  const currentIndex = article ? sectionArticles.findIndex((a) => a.slug === article.slug) : -1;
  const prev = currentIndex > 0 ? sectionArticles[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 && currentIndex < sectionArticles.length - 1
    ? sectionArticles[currentIndex + 1]
    : undefined;

  if (!article) {
    return (
      <PublicLayout>
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <h1 className="text-2xl font-bold mb-4">Article introuvable</h1>
          <p className="text-[var(--text-secondary)] mb-6">
            Cet article n’existe pas ou a été déplacé.
          </p>
          <Link to="/help" className="text-[var(--primary)] font-semibold hover:underline">
            <Icon as={ArrowLeft} size={14} aria-hidden /> Retour au centre d’aide
          </Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <a href="#help-article-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:border focus:border-[var(--primary)] focus:rounded-md">
        Aller au contenu
      </a>

      {/* Breadcrumb */}
      <nav aria-label="Fil d’Ariane" className="help-breadcrumb">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 text-xs text-[var(--text-muted)]">
          <Link to="/" className="hover:text-[var(--primary)]">Accueil</Link>
          <span aria-hidden> / </span>
          <Link to="/help" className="hover:text-[var(--primary)]">Centre d’aide</Link>
          {section && (
            <>
              <span aria-hidden> / </span>
              <span>{section.label}</span>
            </>
          )}
          <span aria-hidden> / </span>
          <span className="text-[var(--text-secondary)] font-medium">{article.title}</span>
        </div>
      </nav>

      <div className="help-article-layout max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Sidebar nav gauche */}
        <aside className="help-article-sidebar" aria-label="Sections de la documentation">
          <p className="blog-toc-heading">Documentation</p>
          <ul className="help-section-list">
            {DOC_SECTIONS.map((s) => {
              const IconCmp = SECTION_ICONS[s.id] ?? BookOpen;
              const arts = getDocsBySection(s.id);
              const isCurrentSection = section?.id === s.id;
              return (
                <li key={s.id}>
                  <div className={`help-section-head ${isCurrentSection ? 'is-active' : ''}`}>
                    <span className="help-section-icon" aria-hidden>
                      <Icon as={IconCmp} size={12} />
                    </span>
                    <p className="help-section-label">{s.label}</p>
                  </div>
                  {arts.length > 0 && (
                    <ul className="help-article-list">
                      {arts.map((a) => (
                        <li key={a.slug}>
                          <Link
                            to="/help/$slug"
                            params={{ slug: a.slug }}
                            className={`help-article-link ${a.slug === article.slug ? 'is-active' : ''}`}
                          >
                            <Icon as={ChevronRight} size={11} aria-hidden />
                            {a.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Main content */}
        <article id="help-article-content" className="help-article-main">
          <header className="help-article-header">
            {section && (
              <p className="help-article-eyebrow">{section.label}</p>
            )}
            <h1 className="help-article-title">{article.title}</h1>
            <p className="help-article-desc">{article.description}</p>
          </header>

          {loading ? (
            <div className="blog-article-skeleton">
              <span /><span /><span /><span /><span />
            </div>
          ) : (
            <div className="help-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children, ...props }) => {
                    const text = String(children);
                    return <h2 id={slugifyHeading(text)} {...props}>{children}</h2>;
                  },
                  h3: ({ children, ...props }) => {
                    const text = String(children);
                    return <h3 id={slugifyHeading(text)} {...props}>{children}</h3>;
                  },
                }}
              >
                {markdown}
              </ReactMarkdown>
            </div>
          )}

          {/* Prev/Next */}
          <nav aria-label="Navigation entre articles" className="help-article-nav">
            {prev ? (
              <Link to="/help/$slug" params={{ slug: prev.slug }} className="help-article-nav-link">
                <Icon as={ArrowLeft} size={12} aria-hidden />
                <span>
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Précédent</span>
                  <span className="block text-sm font-semibold">{prev.title}</span>
                </span>
              </Link>
            ) : <span />}
            {next ? (
              <Link to="/help/$slug" params={{ slug: next.slug }} className="help-article-nav-link help-article-nav-link--right">
                <span>
                  <span className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Suivant</span>
                  <span className="block text-sm font-semibold">{next.title}</span>
                </span>
                <Icon as={ArrowRight} size={12} aria-hidden />
              </Link>
            ) : <span />}
          </nav>

          {/* Footer help */}
          <footer className="help-footer">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Pas trouvé ?</p>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Notre équipe support répond en français, dans la journée ouvrable.
            </p>
            <a href="mailto:support@intralys.app" className="help-footer-cta">
              <Icon as={Mail} size={12} aria-hidden /> Écrire à support@intralys.app
            </a>
          </footer>
        </article>

        {/* TOC droite */}
        <aside className="help-article-toc-right" aria-label="Sommaire de la page">
          <p className="blog-toc-heading">Sur cette page</p>
          {toc.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Pas de sections.</p>
          ) : (
            <ul className="blog-toc-list">
              {toc.map((entry) => (
                <li key={entry.id} data-level={entry.level}>
                  <a href={`#${entry.id}`} className="blog-toc-link">
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </PublicLayout>
  );
}
