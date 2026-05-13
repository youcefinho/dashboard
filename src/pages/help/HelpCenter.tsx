import { useState, useEffect } from 'react';
import { PublicLayout } from '../landing/PublicLayout';
import { Search, Book, FileText, Video, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const categories = [
  { id: 'getting-started', name: 'Premiers pas', icon: <Book size={20} /> },
  { id: 'leads', name: 'Gestion des Leads', icon: <FileText size={20} /> },
  { id: 'workflows', name: 'Automatisations', icon: <Video size={20} /> },
  { id: 'integrations', name: 'Intégrations', icon: <ChevronRight size={20} /> },
  { id: 'billing', name: 'Facturation', icon: <FileText size={20} /> },
];

const articles: Record<string, { title: string, category: string, file: string }> = {
  // Getting started (5)
  'intro': { title: 'Qu\'est-ce qu\'Intralys ?', category: 'getting-started', file: 'intro.md' },
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
  const [markdownContent, setMarkdownContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (selectedArticle) {
      setIsLoading(true);
      fetch(`/help/${articles[selectedArticle]!.file}`)
        .then(res => res.text())
        .then(text => {
          setMarkdownContent(text);
          setIsLoading(false);
        })
        .catch(() => {
          setMarkdownContent('# Erreur\nImpossible de charger cet article.');
          setIsLoading(false);
        });
    }
  }, [selectedArticle]);

  return (
    <PublicLayout>
      {/* Sprint 23 hero centre d'aide */}
      <div className="relative pt-20 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #009DDB 0%, #0086C0 50%, #D96E27 100%)' }}>
        <div aria-hidden className="absolute inset-0 opacity-30 pointer-events-none">
          <div className="hero-stat-orb absolute w-[700px] h-[700px] rounded-full -top-60 -right-40"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)', filter: 'blur(80px)' }} />
          <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -bottom-32 -left-32"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 70%)', filter: 'blur(60px)', animationDelay: '4s' }} />
        </div>
        <div className="relative max-w-3xl mx-auto text-center z-10">
          <p className="text-xs font-semibold text-white/80 uppercase tracking-[0.18em] mb-3">Centre d'aide Intralys</p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-8 tracking-tight" style={{ letterSpacing: '-0.02em' }}>
            Comment pouvons-nous vous aider ?
          </h1>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={20} />
            <input
              type="text"
              placeholder="Rechercher des articles, des tutoriels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-14 pr-4 py-4 rounded-2xl border-none focus:outline-none text-[var(--text-primary)] font-medium"
              style={{
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.4)',
              }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="md:col-span-1 space-y-8">
            {categories.map(cat => (
              <div key={cat.id}>
                <h3 className="font-bold text-[var(--text-primary)] flex items-center gap-2 mb-3">
                  {cat.icon} {cat.name}
                </h3>
                <ul className="space-y-2">
                  {Object.entries(articles)
                    .filter(([, article]) => article.category === cat.id)
                    .map(([id, article]) => (
                    <li key={id}>
                      <button 
                        onClick={() => setSelectedArticle(id)}
                        className={`text-sm text-left w-full hover:text-[var(--brand-primary)] transition-colors ${selectedArticle === id ? 'text-[var(--brand-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}
                      >
                        {article.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="md:col-span-3">
            {selectedArticle ? (
              <div className="bg-white rounded-2xl border border-[var(--border-subtle)] shadow-sm p-8 min-h-[500px]">
                <button onClick={() => setSelectedArticle(null)} className="text-sm text-[var(--brand-primary)] font-medium flex items-center gap-1 mb-6 hover:underline">
                  <ChevronRight size={16} className="rotate-180" /> Retour à l'accueil du centre d'aide
                </button>
                {isLoading ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-[var(--bg-muted)] rounded w-1/3"></div>
                    <div className="h-4 bg-[var(--bg-muted)] rounded w-full mt-8"></div>
                    <div className="h-4 bg-[var(--bg-muted)] rounded w-5/6"></div>
                    <div className="h-4 bg-[var(--bg-muted)] rounded w-4/6"></div>
                  </div>
                ) : (
                  <article className="prose prose-neutral max-w-none prose-headings:text-[var(--text-primary)] prose-a:text-[var(--brand-primary)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {markdownContent}
                    </ReactMarkdown>
                  </article>
                )}
              </div>
            ) : (
              <div className="bg-[var(--bg-subtle)] rounded-2xl border border-[var(--border-subtle)] p-12 text-center h-full flex flex-col items-center justify-center">
                <Book className="text-[var(--text-muted)] mb-4" size={48} />
                <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Sélectionnez un article</h2>
                <p className="text-[var(--text-muted)]">Choisissez un sujet dans le menu de gauche pour commencer votre lecture.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
