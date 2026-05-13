// ── IntegrationsPage — Hub d'intégrations enrichi ───────────

import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Input, PageHero } from '@/components/ui';

interface IntegrationConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: 'active' | 'inactive' | 'pending';
  category: 'ads' | 'calendar' | 'data' | 'automation' | 'communications';
  fields: { key: string; label: string; placeholder: string; type?: string }[];
  docsUrl?: string;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'facebook', name: 'Facebook Lead Ads', icon: '📘', category: 'ads',
    description: 'Recevez automatiquement les leads de vos formulaires Facebook & Instagram Ads.',
    status: 'inactive',
    fields: [
      { key: 'page_id', label: 'Page ID Facebook', placeholder: '123456789' },
      { key: 'access_token', label: 'Access Token', placeholder: 'EAABs...', type: 'password' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/guides/lead-ads/',
  },
  {
    id: 'google', name: 'Google Ads Lead Forms', icon: '🔍', category: 'ads',
    description: 'Synchronisez les leads de vos extensions de formulaire Google Ads en temps réel.',
    status: 'inactive',
    fields: [
      { key: 'customer_id', label: 'Customer ID Google Ads', placeholder: '123-456-7890' },
      { key: 'webhook_key', label: 'Clé Webhook', placeholder: 'gads_...' },
    ],
  },
  {
    id: 'calendly', name: 'Calendly', icon: '📅', category: 'calendar',
    description: 'Synchronisez les rendez-vous Calendly avec le calendrier CRM automatiquement.',
    status: 'inactive',
    fields: [
      { key: 'api_key', label: 'Clé API Calendly', placeholder: 'cal_...', type: 'password' },
      { key: 'org_uri', label: 'Organization URI', placeholder: 'https://api.calendly.com/organizations/...' },
    ],
  },
  {
    id: 'apollo', name: 'Apollo.io', icon: '📊', category: 'data',
    description: 'Enrichissez automatiquement vos leads B2B avec des données d\'entreprise.',
    status: 'inactive',
    fields: [
      { key: 'api_key', label: 'Clé API Apollo', placeholder: 'ap_...', type: 'password' },
    ],
  },
  {
    id: 'resend', name: 'Resend (Email)', icon: '✉️', category: 'automation',
    description: 'Envoi d\'emails transactionnels et de templates HTML via l\'API Resend.',
    status: 'active',
    fields: [
      { key: 'api_key', label: 'Clé API Resend', placeholder: 're_...', type: 'password' },
      { key: 'from_email', label: 'Email d\'envoi', placeholder: 'noreply@intralys.com' },
    ],
  },
  {
    id: 'zapier', name: 'Zapier / Make', icon: '⚡', category: 'automation',
    description: 'Connectez le CRM à 5000+ applications via Zapier, Make.com ou n8n.',
    status: 'inactive',
    fields: [],
  },
  {
    id: 'slack', name: 'Slack', icon: '💬', category: 'automation',
    description: 'Notifications en temps réel des nouveaux leads et RDV dans un canal Slack.',
    status: 'inactive',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL Slack', placeholder: 'https://hooks.slack.com/services/...' },
    ],
  },
  {
    id: 'webchat', name: 'Webchat Widget', icon: '💬', category: 'communications',
    description: 'Ajoutez un chat en direct sur votre site web pour parler aux visiteurs.',
    status: 'inactive',
    fields: [],
  },
  {
    id: 'meta_messaging', name: 'Messenger & Instagram', icon: '📱', category: 'communications',
    description: 'Centralisez vos messages Facebook Messenger et Instagram DM.',
    status: 'inactive',
    fields: [],
  },
  {
    id: 'twilio_voice', name: 'Twilio Voice', icon: '📞', category: 'communications',
    description: 'Recevez des appels, enregistrez les messages vocaux et obtenez la transcription texte.',
    status: 'inactive',
    fields: [
      { key: 'twilio_number', label: 'Numéro Twilio', placeholder: '+1 819 555-0000' }
    ],
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  ads: '📢 Publicité',
  calendar: '📅 Calendrier',
  data: '📊 Données',
  automation: '⚡ Automation',
  communications: '💬 Communications',
};

type FilterCategory = 'all' | 'ads' | 'calendar' | 'data' | 'automation' | 'communications';

export function IntegrationsPage() {
  const [configs, setConfigs] = useState<Record<string, Record<string, string>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [copiedUrl, setCopiedUrl] = useState(false);

  const updateConfig = (intId: string, key: string, value: string) => {
    setConfigs(prev => ({ ...prev, [intId]: { ...prev[intId], [key]: value } }));
  };

  const webhookUrl = `${window.location.origin}/api/webhook/lead`;
  const activeCount = INTEGRATIONS.filter(i => i.status === 'active').length;

  const filteredIntegrations = INTEGRATIONS.filter(i =>
    filterCategory === 'all' || i.category === filterCategory
  );

  const copyUrl = () => {
    void navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <AppLayout title="Intégrations">
      <PageHero
        meta="Insights"
        title="Intégrations"
        highlight="Intégrations"
        description={`${activeCount} active${activeCount > 1 ? 's' : ''} sur ${INTEGRATIONS.length} disponibles — Facebook, Google, Calendly, Stripe et plus.`}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--brand-primary)]">{INTEGRATIONS.length}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase">Intégrations</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--success)]">{activeCount}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase">Connectées</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--warning)]">{INTEGRATIONS.length - activeCount}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase">À configurer</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-[var(--info)]">4</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase">Catégories</p>
        </Card>
      </div>

      {/* Webhook URL */}
      <Card className="p-4 mb-6 border-l-4 border-l-[var(--brand-primary)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">🔗 URL Webhook Universelle</h3>
          <Badge color="var(--success)">Toujours active</Badge>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          Utilisez cette URL pour recevoir des leads depuis n'importe quelle source externe.
        </p>
        <div className="flex gap-2">
          <code className="flex-1 px-3 py-2 bg-[var(--bg-subtle)] rounded-[var(--radius-md)] text-xs font-mono text-[var(--brand-primary)] overflow-x-auto">
            POST {webhookUrl}
          </code>
          <Button size="sm" onClick={copyUrl}>{copiedUrl ? '✓ Copié !' : '📋 Copier'}</Button>
        </div>
        <details className="mt-3">
          <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--brand-primary)]">
            📖 Format du payload JSON + Headers requis
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-secondary)] mb-1">Headers</p>
              <pre className="p-2 bg-[var(--bg-subtle)] rounded text-[10px] font-mono text-[var(--text-secondary)]">{`Content-Type: application/json
X-Webhook-Secret: <votre_secret>
X-Client-Id: <id_sous_compte>`}</pre>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-secondary)] mb-1">Body JSON</p>
              <pre className="p-2 bg-[var(--bg-subtle)] rounded text-[10px] font-mono text-[var(--text-secondary)]">{`{
  "name": "Prénom Nom",
  "email": "lead@ex.com",
  "phone": "+1 819 555-1234",
  "type": "inbound",
  "source": "facebook"
}`}</pre>
            </div>
          </div>
        </details>
      </Card>

      {/* Filtres catégorie */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['all', 'ads', 'calendar', 'data', 'automation', 'communications'] as const).map(cat => (
          <button key={cat} onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-all ${filterCategory === cat ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>
            {cat === 'all' ? `Toutes (${INTEGRATIONS.length})` : `${CATEGORY_LABELS[cat]} (${INTEGRATIONS.filter(i => i.category === cat).length})`}
          </button>
        ))}
      </div>

      {/* Liste des intégrations */}
      <div className="space-y-3">
        {filteredIntegrations.map((integration) => {
          const isExpanded = expanded === integration.id;
          const config = configs[integration.id] || {};
          const isActive = integration.status === 'active';

          return (
            <Card key={integration.id} className={`transition-all ${isActive ? 'border-l-4 border-l-[var(--success)]' : ''} hover:border-[var(--brand-primary)]/20`}>
              <div className="p-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-[var(--radius-md)] flex items-center justify-center text-2xl shrink-0 ${isActive ? 'bg-[var(--success)]/10' : 'bg-[var(--bg-subtle)]'}`}>
                    {integration.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-semibold">{integration.name}</h3>
                      <Badge color={isActive ? 'var(--success)' : integration.status === 'pending' ? 'var(--warning)' : 'var(--text-muted)'}>
                        {isActive ? '✅ Connecté' : integration.status === 'pending' ? '⏳ En attente' : 'Non connecté'}
                      </Badge>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                        {CATEGORY_LABELS[integration.category]}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{integration.description}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {integration.docsUrl && (
                      <a href={integration.docsUrl} target="_blank" rel="noreferrer"
                        className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:text-[var(--brand-primary)] transition-colors">
                        📖 Docs
                      </a>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => setExpanded(isExpanded ? null : integration.id)}>
                      {isExpanded ? '▲ Réduire' : '⚙️ Configurer'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Configuration étendue */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-[var(--border-subtle)] pt-3 space-y-3 animate-slide-down">
                  {integration.fields.length > 0 ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {integration.fields.map((field) => (
                          <div key={field.key}>
                            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">{field.label}</label>
                            <Input type={field.type || 'text'} value={config[field.key] || ''} onChange={(e) => updateConfig(integration.id, field.key, e.target.value)} placeholder={field.placeholder} />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        <Button variant="ghost" size="sm" onClick={() => setExpanded(null)}>Annuler</Button>
                        <Button size="sm" onClick={() => setExpanded(null)}>
                          {isActive ? '💾 Mettre à jour' : '🔗 Connecter'}
                        </Button>
                      </div>
                    </>
                  ) : integration.id === 'meta_messaging' ? (
                    <div className="text-center py-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                      <p className="text-sm text-[var(--text-muted)] mb-3">Connectez-vous à Facebook pour lier votre page et compte Instagram.</p>
                      <Button onClick={() => window.location.href = '/api/meta/oauth/start'} className="bg-[#1877F2] hover:bg-[#1877F2]/90 text-white border-none">
                        Connecter avec Facebook
                      </Button>
                    </div>
                  ) : integration.id === 'webchat' ? (
                    <div className="text-center py-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                      <p className="text-sm font-medium mb-2">Code du widget à intégrer :</p>
                      <code className="block p-3 bg-black/50 text-green-400 text-xs text-left rounded overflow-x-auto whitespace-pre">
{`<script src="${window.location.origin}/api/webchat/widget.js?client_id=VOTRE_ID" defer></script>`}
                      </code>
                    </div>
                  ) : (
                    <div className="text-center py-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)]">
                      <p className="text-sm text-[var(--text-muted)]">Utilisez l'URL webhook universelle ci-dessus pour connecter cette intégration.</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">Consultez la documentation de {integration.name} pour configurer le webhook sortant.</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Documentation API enrichie */}
      <Card className="p-5 mt-6">
        <h3 className="text-sm font-semibold mb-4">📖 Documentation API</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { method: 'POST', path: '/api/webhook/lead', desc: 'Créer un lead depuis une source externe', auth: 'Secret Header' },
            { method: 'GET', path: '/api/leads', desc: 'Lister les leads avec filtres', auth: 'JWT' },
            { method: 'GET', path: '/api/appointments', desc: 'Lister les RDV avec filtres', auth: 'JWT' },
            { method: 'POST', path: '/api/workflows/:id/enroll', desc: 'Inscrire un lead dans un workflow', auth: 'JWT' },
            { method: 'GET', path: '/api/messages', desc: 'Lister les messages inbox', auth: 'JWT' },
            { method: 'GET', path: '/api/stats', desc: 'Statistiques du dashboard', auth: 'JWT' },
          ].map(endpoint => (
            <div key={endpoint.path} className="p-3 bg-[var(--bg-subtle)] rounded-[var(--radius-md)] flex items-start gap-3">
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${endpoint.method === 'POST' ? 'bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]' : 'bg-[var(--success)]/15 text-[var(--success)]'}`}>{endpoint.method}</span>
              <div>
                <p className="text-xs font-semibold font-mono">{endpoint.path}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{endpoint.desc}</p>
                <p className="text-[9px] text-[var(--text-muted)] mt-0.5">Auth : {endpoint.auth}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </AppLayout>
  );
}
