import { useState, useEffect, useMemo } from 'react';
import { t } from '@/lib/i18n';
import { PublicLayout } from '../landing/PublicLayout';
import { Search, Book, FileText, Video, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Input } from '@/components/ui/Input';
import { Tag } from '@/components/ui/Tag';
import { KpiStrip } from '@/components/ui/KpiStrip';

const categories = [
  { id: 'getting-started', icon: <Book size={16} /> },
  { id: 'leads', icon: <FileText size={16} /> },
  { id: 'workflows', icon: <Video size={16} /> },
  { id: 'integrations', icon: <ChevronRight size={16} /> },
  { id: 'billing', icon: <FileText size={16} /> },
];

const CATEGORY_NAME_KEYS: Record<string, string> = {
  'getting-started': 'help.cat_getting_started',
  'leads': 'help.cat_leads',
  'workflows': 'help.cat_workflows',
  'integrations': 'help.cat_integrations',
  'billing': 'help.cat_billing',
};

function categoryName(id: string): string {
  const key = CATEGORY_NAME_KEYS[id];
  return key ? t(key) : id;
}

const articles: Record<string, { title: string; category: string; file: string }> = {
  // Getting started (5)
  'intro': { title: "Qu'est-ce qu'Intralys ?", category: 'getting-started', file: 'intro.md' },
  'quickstart': { title: 'Démarrage rapide en 5 minutes', category: 'getting-started', file: 'quickstart.md' },
  'first-lead': { title: 'Créer votre premier lead', category: 'getting-started', file: 'first-lead.md' },
  'invite-team': { title: 'Inviter votre équipe', category: 'getting-started', file: 'invite-team.md' },
  'mobile-app': { title: 'Utiliser Intralys sur mobile', category: 'getting-started', file: 'mobile-app.md' },
  // Leads (8)
  'import-leads': { title: 'Importer des leads (CSV)', category: 'leads', file: 'import-leads.md' },
  'create-lead': { title: 'Créer un lead manuellement', category: 'leads', file: 'create-lead.md' },
  'lead-statuses': { title: 'Statuts et étapes du pipeline', category: 'leads', file: 'lead-statuses.md' },
  'lead-tags': { title: 'Organiser avec les tags', category: 'leads', file: 'lead-tags.md' },
  'lead-notes': { title: 'Notes et activités sur un lead', category: 'leads', file: 'lead-notes.md' },
  'lead-pipeline': { title: 'Gérer le pipeline Kanban', category: 'leads', file: 'lead-pipeline.md' },
  'export-leads': { title: 'Exporter vos leads', category: 'leads', file: 'export-leads.md' },
  'lead-scoring': { title: 'Scoring et priorité des leads', category: 'leads', file: 'lead-scoring.md' },
  // Workflows (6)
  'create-workflow': { title: 'Créer votre premier workflow', category: 'workflows', file: 'create-workflow.md' },
  'workflow-triggers': { title: 'Déclencheurs disponibles', category: 'workflows', file: 'workflow-triggers.md' },
  'workflow-conditions': { title: 'Ajouter des conditions', category: 'workflows', file: 'workflow-conditions.md' },
  'workflow-email': { title: 'Envoyer des emails automatiques', category: 'workflows', file: 'workflow-email.md' },
  'workflow-notifications': { title: 'Notifications et alertes', category: 'workflows', file: 'workflow-notifications.md' },
  'workflow-templates': { title: 'Bibliothèque de templates', category: 'workflows', file: 'workflow-templates.md' },
  // Integrations (4)
  'integration-google': { title: 'Connecter Google Calendar', category: 'integrations', file: 'integration-google.md' },
  'integration-gmail': { title: 'Synchroniser Gmail', category: 'integrations', file: 'integration-gmail.md' },
  'integration-stripe': { title: 'Paiements avec Stripe', category: 'integrations', file: 'integration-stripe.md' },
  'integration-zapier': { title: 'Automatiser avec Zapier', category: 'integrations', file: 'integration-zapier.md' },
  // Billing (3)
  'billing-plans': { title: 'Plans et tarification', category: 'billing', file: 'billing-plans.md' },
  'billing-payment': { title: 'Méthodes de paiement', category: 'billing', file: 'billing-payment.md' },
  'billing-invoices': { title: 'Consulter vos factures', category: 'billing', file: 'billing-invoices.md' },
};

export function HelpCenterPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('getting-started');
  const [markdownContent, setMarkdownContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (selectedArticle) {
      setIsLoading(true);
      fetch(`/help/${articles[selectedArticle]!.file}`)
        .then((res) => res.text())
        .then((text) => {
          setMarkdownContent(text);
          setIsLoading(false);
        })
        .catch(() => {
          setMarkdownContent(t('help.load_error'));
          setIsLoading(false);
        });
    }
  }, [selectedArticle]);

  // Recherche : filtre tous les articles par titre (case-insensitive)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return Object.entries(articles).filter(([, a]) => a.title.toLowerCase().includes(q));
  }, [searchQuery]);

  // Articles visibles dans le panneau central : si search => résultats, sinon catégorie active
  const visibleArticles = useMemo(() => {
    if (searchResults) return searchResults;
    return Object.entries(articles).filter(([, a]) => a.category === activeCategory);
  }, [searchResults, activeCategory]);

  const totalArticles = Object.keys(articles).length;
  const totalCategories = categories.length;

  return (
    <PublicLayout>
      {/* Hero */}
      <div
        className="relative pt-20 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, #635BFF 0%, #5851E5 50%, #8B5CF6 100%)',
        }}
      >
        <div aria-hidden className="absolute inset-0 opacity-30 pointer-events-none">
          <div
            className="hero-stat-orb absolute w-[700px] h-[700px] rounded-full -top-60 -right-40"
            style={{
              background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
              filter: 'blur(80px)',
            }}
          />
          <div
            className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -bottom-32 -left-32"
            style={{
              background: 'radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 70%)',
              filter: 'blur(60px)',
              animationDelay: '4s',
            }}
          />
        </div>
        <div className="relative max-w-3xl mx-auto text-center z-10">
          <p className="text-xs font-semibold text-white/80 uppercase tracking-[0.18em] mb-3">
            {t('help.hero_meta')}
          </p>
          <h1
            className="text-3xl md:text-5xl font-extrabold text-white mb-8 tracking-tight"
            style={{ letterSpacing: '-0.02em' }}
          >
            {t('help.hero_title')}
          </h1>
          {/* Input premium (wave 41) */}
          <div className="max-w-xl mx-auto">
            <Input
              type="search"
              placeholder={t('help.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search size={16} />}
              className="h-12 text-base bg-[var(--bg-surface)]/95"
              aria-label={t('help.search_aria')}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* KpiStrip optionnel (wave 41) */}
        <KpiStrip
          items={[
            { label: t('help.kpi_articles'), value: totalArticles, color: 'brand' },
            { label: t('help.kpi_categories'), value: totalCategories, color: 'info' },
            { label: t('help.kpi_popular'), value: 8, color: 'accent' },
          ]}
          className="mb-8"
        />

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-8">
          {/* Sidebar categories — style sidebar-nav-item adapté light */}
          <aside className="md:sticky md:top-24 self-start">
            <p className="heading-premium mb-3">{t('help.sidebar_categories')}</p>
            <nav>
              <ul className="space-y-1.5">
                {categories.map((cat) => {
                  const isActive = !searchResults && cat.id === activeCategory;
                  return (
                    <li key={cat.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCategory(cat.id);
                          setSelectedArticle(null);
                          setSearchQuery('');
                        }}
                        className={`help-cat-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all ${
                          isActive ? 'is-active' : ''
                        }`}
                      >
                        <span className="help-cat-icon shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all">
                          {cat.icon}
                        </span>
                        <span className="truncate">{categoryName(cat.id)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          {/* Articles list ou article content */}
          <div>
            {selectedArticle ? (
              <div className="card-premium p-8 min-h-[500px]">
                <button
                  onClick={() => setSelectedArticle(null)}
                  className="relative text-sm text-[var(--primary)] font-semibold flex items-center gap-1 mb-6 hover:underline"
                >
                  <ChevronRight size={16} className="rotate-180" /> {t('help.back_to_articles')}
                </button>
                <div className="relative mb-4">
                  <Tag size="xs" variant="brand">
                    {categories.find((c) => c.id === articles[selectedArticle]!.category) ? categoryName(articles[selectedArticle]!.category) : t('help.tag_fallback')}
                  </Tag>
                </div>
                {isLoading ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-[var(--bg-muted)] rounded w-1/3"></div>
                    <div className="h-4 bg-[var(--bg-muted)] rounded w-full mt-8"></div>
                    <div className="h-4 bg-[var(--bg-muted)] rounded w-5/6"></div>
                    <div className="h-4 bg-[var(--bg-muted)] rounded w-4/6"></div>
                  </div>
                ) : (
                  <article className="prose prose-neutral max-w-none prose-headings:text-[var(--text-primary)] prose-a:text-[var(--primary)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
                  </article>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                    {searchResults
                      ? t('help.results').replace('{n}', String(visibleArticles.length))
                      : (categories.find((c) => c.id === activeCategory) ? categoryName(activeCategory) : t('help.articles_fallback'))}
                  </h2>
                  {searchResults && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-xs text-[var(--primary)] font-semibold hover:underline"
                    >
                      {t('help.reset')}
                    </button>
                  )}
                </div>

                {visibleArticles.length === 0 ? (
                  <div className="card-premium p-12 text-center">
                    <Book className="mx-auto mb-4 text-[var(--text-muted)]" size={40} />
                    <p className="text-sm text-[var(--text-muted)]">
                      {t('help.no_results')}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--border-subtle)] rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    {visibleArticles.map(([id, a], i) => (
                      <li
                        key={id}
                        className="row-premium list-item-enter"
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedArticle(id)}
                          className="w-full flex items-center gap-3 pl-5 pr-4 py-3.5 text-left"
                        >
                          <span
                            aria-hidden
                            className="shrink-0 w-2 h-2 rounded-full"
                            style={{
                              background:
                                'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                              boxShadow: '0 0 8px rgba(99,91,255,0.45)',
                            }}
                          />
                          <span className="flex-1 text-sm font-medium text-[var(--text-primary)] truncate">
                            {a.title}
                          </span>
                          {searchResults && (
                            <Tag size="xs" variant="neutral">
                              {categories.find((c) => c.id === a.category) ? categoryName(a.category) : a.category}
                            </Tag>
                          )}
                          <ChevronRight
                            size={16}
                            className="text-[var(--text-muted)] shrink-0"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .help-cat-item {
          background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-subtle) 100%);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }
        .help-cat-item .help-cat-icon {
          background: rgba(99,91,255,0.08);
          border: 1px solid rgba(99,91,255,0.18);
          color: var(--primary);
        }
        .help-cat-item:hover {
          background: linear-gradient(90deg, rgba(99,91,255,0.10) 0%, rgba(139,92,246,0.04) 100%);
          border-color: rgba(99,91,255,0.40);
          color: var(--primary);
          transform: translateX(2px);
          box-shadow: 0 4px 14px -4px rgba(99,91,255,0.30);
        }
        .help-cat-item:hover .help-cat-icon {
          background: linear-gradient(135deg, rgba(99,91,255,0.20) 0%, rgba(139,92,246,0.12) 100%);
          border-color: rgba(99,91,255,0.45);
          box-shadow: 0 0 12px rgba(99,91,255,0.35);
        }
        .help-cat-item.is-active {
          background: linear-gradient(90deg, rgba(99,91,255,0.18) 0%, rgba(139,92,246,0.08) 100%);
          border-color: rgba(99,91,255,0.55);
          color: var(--primary);
          box-shadow:
            0 4px 16px -4px rgba(99,91,255,0.40),
            0 0 24px -8px rgba(139,92,246,0.28);
        }
        .help-cat-item.is-active .help-cat-icon {
          background: linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%);
          border-color: rgba(99,91,255,0.65);
          color: #FFFFFF;
          box-shadow: 0 0 14px rgba(99,91,255,0.55);
        }
        .help-cat-item:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(99,91,255,0.55), 0 0 14px rgba(139,92,246,0.30);
        }
        @media (prefers-reduced-motion: reduce) {
          .help-cat-item:hover { transform: none !important; }
        }
      `}</style>
    </PublicLayout>
  );
}
