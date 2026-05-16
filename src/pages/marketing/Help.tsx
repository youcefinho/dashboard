// ── Help center — Sprint 47 M3.3 (2026-05-15) ───────────────────────────
// Entry point /marketing/help — nav sidebar 5 sections + search fuzzy +
// landing avec articles populaires. Stripe-clean SUBTLE.

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { PublicLayout } from '@/pages/landing/PublicLayout';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';
import {
  Search, Rocket, Users, MessageSquare, Workflow, Code,
  ChevronRight, Mail, ArrowRight, BookOpen, ShieldCheck,
} from 'lucide-react';
import { DOC_SECTIONS, DOC_ARTICLES, getDocsBySection } from '@/content/docs';

const SECTION_ICONS: Record<string, typeof Rocket> = {
  'getting-started': Rocket,
  'leads-pipeline':  Users,
  'communication':   MessageSquare,
  'automation':      Workflow,
  'api':             Code,
  'admin':           ShieldCheck,
};

export function HelpPage() {
  const [query, setQuery] = useState('');

  // ── Sprint 47 M3.4 — Flag "docs visited" pour OnboardingProgressChip ──
  // Une visite suffit à marquer l'étape "Explorer la documentation" comme done.
  useEffect(() => {
    try { localStorage.setItem('docs_visited', '1'); } catch { /* ignore */ }
  }, []);

  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return DOC_ARTICLES.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <PublicLayout>
      <a href="#help-main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:border focus:border-[var(--primary)] focus:rounded-md">
        Aller au contenu
      </a>

      {/* Hero */}
      <section className="help-hero">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-10 text-center">
          <p className="blog-eyebrow">Centre d’aide</p>
          <h1 className="blog-title">Comment pouvons-nous t’aider ?</h1>
          <p className="blog-sub">
            Guides, tutoriels et docs API. Rédigés clair, en français québécois.
          </p>
          <div className="blog-search">
            <Input
              type="search"
              placeholder="Rechercher dans la doc…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leftIcon={<Search size={16} />}
              aria-label="Rechercher dans la documentation"
            />
          </div>
        </div>
      </section>

      {/* Breadcrumb */}
      <nav aria-label="Fil d’Ariane" className="help-breadcrumb">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 text-xs text-[var(--text-muted)]">
          <Link to="/" className="hover:text-[var(--primary)]">Accueil</Link>
          <span aria-hidden> / </span>
          <span className="text-[var(--text-secondary)] font-medium">Centre d’aide</span>
        </div>
      </nav>

      <div id="help-main" className="help-layout max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* Sidebar nav */}
        <aside className="help-sidebar" aria-label="Sections de la documentation">
          <p className="blog-toc-heading">Sections</p>
          <ul className="help-section-list">
            {DOC_SECTIONS.map((section) => {
              const IconCmp = SECTION_ICONS[section.id] ?? BookOpen;
              const articles = getDocsBySection(section.id);
              return (
                <li key={section.id}>
                  <div className="help-section-head">
                    <span className="help-section-icon" aria-hidden>
                      <Icon as={IconCmp} size={14} />
                    </span>
                    <div>
                      <p className="help-section-label">{section.label}</p>
                      <p className="help-section-desc">{section.description}</p>
                    </div>
                  </div>
                  {articles.length > 0 && (
                    <ul className="help-article-list">
                      {articles.map((a) => (
                        <li key={a.slug}>
                          <Link to="/help/$slug" params={{ slug: a.slug }} className="help-article-link">
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

        {/* Main */}
        <main className="help-main">
          {filteredArticles ? (
            <section>
              <h2 className="help-section-title">
                Résultats ({filteredArticles.length})
              </h2>
              {filteredArticles.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Aucun article trouvé pour « {query} ».</p>
              ) : (
                <ul className="help-results">
                  {filteredArticles.map((a) => (
                    <li key={a.slug}>
                      <Link to="/help/$slug" params={{ slug: a.slug }} className="help-result-card">
                        <span className="help-result-title">{a.title}</span>
                        <span className="help-result-desc">{a.description}</span>
                        <Icon as={ArrowRight} size={12} className="text-[var(--text-muted)]" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <>
              {/* Featured articles */}
              <section>
                <h2 className="help-section-title">Articles populaires</h2>
                <ul className="help-grid">
                  {DOC_ARTICLES.slice(0, 4).map((a) => (
                    <li key={a.slug}>
                      <Link to="/help/$slug" params={{ slug: a.slug }} className="help-card">
                        <span className="help-card-title">{a.title}</span>
                        <span className="help-card-desc">{a.description}</span>
                        <span className="help-card-cta">
                          Lire <Icon as={ArrowRight} size={12} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Sections cards (anchors) */}
              <section className="mt-10">
                <h2 className="help-section-title">Toutes les sections</h2>
                <ul className="help-grid">
                  {DOC_SECTIONS.map((section) => {
                    const IconCmp = SECTION_ICONS[section.id] ?? BookOpen;
                    const articles = getDocsBySection(section.id);
                    const first = articles[0];
                    if (!first) return null;
                    return (
                      <li key={section.id}>
                        <Link to="/help/$slug" params={{ slug: first.slug }} className="help-card">
                          <span className="help-section-icon" aria-hidden>
                            <Icon as={IconCmp} size={14} />
                          </span>
                          <span className="help-card-title">{section.label}</span>
                          <span className="help-card-desc">{section.description}</span>
                          <span className="help-card-cta">
                            Explorer <Icon as={ArrowRight} size={12} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}

          {/* Footer help — "pas trouvé ?" */}
          <footer className="help-footer">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Pas trouvé ce que tu cherches ?</p>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Notre équipe support répond en français, dans la journée ouvrable.
            </p>
            <a href="mailto:support@intralys.app" className="help-footer-cta">
              <Icon as={Mail} size={12} aria-hidden /> Écrire à support@intralys.app
            </a>
          </footer>
        </main>
      </div>
    </PublicLayout>
  );
}
