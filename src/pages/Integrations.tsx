// ── IntegrationsPage — Hub d'intégrations enrichi ───────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Select, SlidePanel, PageHero, KpiStrip, type KpiItem, Tag, Icon, useToast } from '@/components/ui';
import { Plug, CheckCircle2, AlertCircle, Layers, Trash2, Plus } from 'lucide-react';
import { apiFetch, getClients } from '@/lib/api';

interface IntegrationConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: 'active' | 'inactive' | 'pending';
  category: 'ads' | 'calendar' | 'data' | 'automation' | 'communications';
  fields: { key: string; label: string; placeholder: string; type?: string }[];
  docsUrl?: string;
  // Sprint 51 M3.4 — état honnête : 'live' = backend réel ; 'soon' = pas encore branché
  availability?: 'live' | 'soon';
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'facebook', name: 'Facebook Lead Ads', icon: '📘', category: 'ads',
    description: 'Recevez automatiquement les leads de vos formulaires Facebook & Instagram Ads.',
    status: 'inactive', availability: 'live',
    fields: [
      { key: 'page_id', label: 'Page ID Facebook', placeholder: '123456789' },
      { key: 'access_token', label: 'Access Token', placeholder: 'EAABs...', type: 'password' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/guides/lead-ads/',
  },
  {
    id: 'google', name: 'Google Ads Lead Forms', icon: '🔍', category: 'ads',
    description: 'Synchronisez les leads de vos extensions de formulaire Google Ads en temps réel.',
    status: 'inactive', availability: 'live',
    fields: [
      { key: 'customer_id', label: 'Customer ID Google Ads', placeholder: '123-456-7890' },
      { key: 'webhook_key', label: 'Clé Webhook', placeholder: 'gads_...' },
    ],
  },
  {
    id: 'calendly', name: 'Calendly', icon: '📅', category: 'calendar',
    description: 'Synchronisez les rendez-vous Calendly avec le calendrier CRM automatiquement.',
    status: 'inactive', availability: 'soon',
    fields: [
      { key: 'api_key', label: 'Clé API Calendly', placeholder: 'cal_...', type: 'password' },
      { key: 'org_uri', label: 'Organization URI', placeholder: 'https://api.calendly.com/organizations/...' },
    ],
  },
  {
    id: 'apollo', name: 'Apollo.io', icon: '📊', category: 'data',
    description: 'Enrichissez automatiquement vos leads B2B avec des données d\'entreprise.',
    status: 'inactive', availability: 'soon',
    fields: [
      { key: 'api_key', label: 'Clé API Apollo', placeholder: 'ap_...', type: 'password' },
    ],
  },
  {
    id: 'resend', name: 'Resend (Email)', icon: '✉️', category: 'automation',
    description: 'Envoi d\'emails transactionnels et de templates HTML via l\'API Resend.',
    status: 'active', availability: 'live',
    fields: [
      { key: 'api_key', label: 'Clé API Resend', placeholder: 're_...', type: 'password' },
      { key: 'from_email', label: 'Email d\'envoi', placeholder: 'noreply@intralys.com' },
    ],
  },
  {
    id: 'zapier', name: 'Zapier / Make', icon: '⚡', category: 'automation',
    description: 'Connectez le CRM à 5000+ applications via Zapier, Make.com ou n8n. Possible dès maintenant via une source de leads entrante (token webhook).',
    status: 'inactive', availability: 'soon',
    fields: [],
  },
  {
    id: 'slack', name: 'Slack', icon: '💬', category: 'automation',
    description: 'Notifications en temps réel des nouveaux leads et RDV dans un canal Slack.',
    status: 'inactive', availability: 'soon',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL Slack', placeholder: 'https://hooks.slack.com/services/...' },
    ],
  },
  {
    id: 'webchat', name: 'Webchat Widget', icon: '💬', category: 'communications',
    description: 'Ajoutez un chat en direct sur votre site web pour parler aux visiteurs.',
    status: 'inactive', availability: 'live',
    fields: [],
  },
  {
    id: 'meta_messaging', name: 'Messenger & Instagram', icon: '📱', category: 'communications',
    description: 'Centralisez vos messages Facebook Messenger et Instagram DM.',
    status: 'inactive', availability: 'live',
    fields: [],
  },
  {
    id: 'twilio_voice', name: 'Twilio Voice', icon: '📞', category: 'communications',
    description: 'Recevez des appels, enregistrez les messages vocaux et obtenez la transcription texte.',
    status: 'inactive', availability: 'soon',
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

// ── Sprint 51 M1.4 — Panneau config Meta / Google Lead Ads ──────
type LeadProvider = 'meta' | 'google';
interface ClientLite { id: string; name: string }
interface MetaConn { id: string; client_id: string; page_id: string; page_name: string; field_mapping: string | null; active: number }
interface GoogleConn { id: string; client_id: string; webhook_key: string; label: string; field_mapping: string | null; active: number }

// Champs Lead cibles pour le mapping
const LEAD_TARGET_FIELDS = [
  { value: 'name', label: 'Nom complet' },
  { value: 'email', label: 'Courriel' },
  { value: 'phone', label: 'Téléphone' },
  { value: 'message', label: 'Message / note' },
];

function LeadAdsConfigPanel({
  provider, open, onClose,
}: { provider: LeadProvider; open: boolean; onClose: () => void }) {
  const { success, error: toastError } = useToast();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [metaConns, setMetaConns] = useState<MetaConn[]>([]);
  const [googleConns, setGoogleConns] = useState<GoogleConn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [clientId, setClientId] = useState('');
  const [pageId, setPageId] = useState('');
  const [pageName, setPageName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [webhookKey, setWebhookKey] = useState('');
  const [label, setLabel] = useState('');
  const [mappingRows, setMappingRows] = useState<{ src: string; target: string }[]>([
    { src: '', target: 'name' },
  ]);

  const isMeta = provider === 'meta';

  const load = useCallback(async () => {
    setLoading(true);
    const [clRes, connRes] = await Promise.all([
      getClients(),
      apiFetch<{ meta: MetaConn[]; google: GoogleConn[] }>('/api/integrations/meta-lead/connections'),
    ]);
    if (clRes.data) setClients((clRes.data as ClientLite[]).map(c => ({ id: c.id, name: c.name })));
    if (connRes.data) {
      setMetaConns(connRes.data.meta || []);
      setGoogleConns(connRes.data.google || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const resetForm = () => {
    setPageId(''); setPageName(''); setAccessToken('');
    setWebhookKey(''); setLabel('');
    setMappingRows([{ src: '', target: 'name' }]);
  };

  const buildMapping = (): Record<string, string> | undefined => {
    const m: Record<string, string> = {};
    for (const r of mappingRows) {
      if (r.src.trim()) m[r.src.trim()] = r.target;
    }
    return Object.keys(m).length ? m : undefined;
  };

  const save = async () => {
    if (!clientId) { toastError('Choisis un sous-compte client'); return; }
    if (isMeta && (!pageId.trim() || !accessToken.trim())) {
      toastError('Page ID et Access Token requis'); return;
    }
    if (!isMeta && !webhookKey.trim()) { toastError('Clé webhook requise'); return; }

    setSaving(true);
    const payload = isMeta
      ? { provider: 'meta', client_id: clientId, page_id: pageId.trim(), page_name: pageName.trim(), page_access_token: accessToken.trim(), field_mapping: buildMapping() }
      : { provider: 'google', client_id: clientId, webhook_key: webhookKey.trim(), label: label.trim(), field_mapping: buildMapping() };

    const res = await apiFetch('/api/integrations/meta-lead/connections', {
      method: 'POST', body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.error) { toastError(res.error); return; }
    success('Connexion enregistrée');
    resetForm();
    void load();
  };

  const remove = async (id: string) => {
    const res = await apiFetch(`/api/integrations/meta-lead/connections/${provider}/${id}`, { method: 'DELETE' });
    if (res.error) { toastError(res.error); return; }
    success('Connexion supprimée');
    void load();
  };

  const conns = isMeta ? metaConns : googleConns;
  const title = isMeta ? 'Facebook / Instagram Lead Ads' : 'Google Lead Forms';
  const googleWebhookUrl = `${window.location.origin}/api/webhook/google-leadform`;

  return (
    <SlidePanel open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={title} size="lg"
      description={isMeta
        ? 'Reçois automatiquement les leads de tes formulaires Meta Ads dans le CRM.'
        : 'Synchronise les leads de tes extensions de formulaire Google Ads.'}>
      <div className="space-y-6">
        {!isMeta && (
          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
            <p className="text-[10px] font-semibold text-[var(--text-secondary)] mb-1">URL Webhook à coller dans Google Ads</p>
            <code className="block text-xs font-mono text-[var(--primary)] break-all">{googleWebhookUrl}</code>
          </div>
        )}

        {/* Formulaire nouvelle connexion */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Nouvelle connexion</h4>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Sous-compte client</label>
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Sous-compte client">
              <option value="">— Choisir un client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>

          {isMeta ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Page ID Facebook</label>
                <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="123456789" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Nom de la page (optionnel)</label>
                <Input value={pageName} onChange={(e) => setPageName(e.target.value)} placeholder="Ma Page Facebook" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Page Access Token</label>
                <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAABs..." />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Clé webhook (google_key)</label>
                <Input value={webhookKey} onChange={(e) => setWebhookKey(e.target.value)} placeholder="gads_secret_..." />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">Libellé (optionnel)</label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Campagne Été 2026" />
              </div>
            </div>
          )}

          {/* Éditeur de mapping champs */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1 block">
              Correspondance des champs (optionnel — sinon détection auto)
            </label>
            <div className="space-y-2">
              {mappingRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={row.src}
                    onChange={(e) => setMappingRows(rows => rows.map((r, j) => j === i ? { ...r, src: e.target.value } : r))}
                    placeholder="Nom du champ source (ex: full_name)"
                    aria-label="Champ source"
                    containerClassName="flex-1"
                  />
                  <span className="text-xs text-[var(--text-muted)]" aria-hidden="true">→</span>
                  <Select
                    value={row.target}
                    onChange={(e) => setMappingRows(rows => rows.map((r, j) => j === i ? { ...r, target: e.target.value } : r))}
                    aria-label="Champ Lead cible"
                    containerClassName="w-40"
                  >
                    {LEAD_TARGET_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Select>
                  <button
                    type="button"
                    onClick={() => setMappingRows(rows => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                    aria-label="Retirer cette correspondance"
                  >
                    <Icon as={Trash2} size={13} />
                  </button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setMappingRows(rows => [...rows, { src: '', target: 'message' }])}>
                <Icon as={Plus} size={12} /> Ajouter une correspondance
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer la connexion'}
            </Button>
          </div>
        </div>

        {/* Liste connexions actives */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <h4 className="text-sm font-semibold mb-2">Connexions actives ({conns.length})</h4>
          {loading ? (
            <p className="text-xs text-[var(--text-muted)]">Chargement…</p>
          ) : conns.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Aucune connexion configurée pour l'instant.</p>
          ) : (
            <div className="space-y-2">
              {conns.map((c) => {
                const cl = clients.find(x => x.id === c.client_id);
                return (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)]">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {isMeta ? ((c as MetaConn).page_name || (c as MetaConn).page_id) : ((c as GoogleConn).label || 'Connexion Google')}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {cl?.name || c.client_id}
                        {c.active ? '' : ' · inactive'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Tag dot size="xs" variant={c.active ? 'success' : 'neutral'}>
                        {c.active ? 'Active' : 'Inactive'}
                      </Tag>
                      <button
                        type="button"
                        onClick={() => void remove(c.id)}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                        aria-label="Supprimer cette connexion"
                      >
                        <Icon as={Trash2} size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}

// ── Sprint 51 M3.4 — Encart "Sources de leads entrantes" + mini feed ────
interface LeadSourceLite {
  id: string; name: string; source_key: string; type: string;
  active: number; lead_count: number; last_received_at: string | null;
}
interface RecvLeadLite {
  id: string; name: string; email: string; status: string;
  utm_source: string | null; created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function LeadSourcesCallout() {
  const [sources, setSources] = useState<LeadSourceLite[] | null>(null);
  const [recent, setRecent] = useState<RecvLeadLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Aligné sur LeadSourcesSettings (M2) : fetch natif vers /api/lead-sources
    void (async () => {
      try {
        const r = await fetch('/api/lead-sources');
        const d = await r.json() as { data?: LeadSourceLite[] };
        if (cancelled) return;
        const list = d.data || [];
        setSources(list);
        const active = [...list]
          .filter(s => s.last_received_at)
          .sort((a, b) => (b.last_received_at || '').localeCompare(a.last_received_at || ''));
        if (active[0]) {
          const lr = await fetch(`/api/lead-sources/${active[0].id}/leads?limit=5`);
          const ld = await lr.json() as { data?: RecvLeadLite[] };
          if (!cancelled && ld.data) setRecent(ld.data);
        }
      } catch {
        if (!cancelled) setSources([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const total = sources?.length ?? 0;

  return (
    <Card className="p-4 mb-6 border-l-4 border-l-[var(--brand-cyan,var(--primary))]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold mb-1">📥 Sources de leads entrantes</h3>
          <p className="text-xs text-[var(--text-muted)] max-w-prose">
            Connecteur universel par token : créez une source (Zapier, Make, webhook custom),
            configurez le mapping des champs et la déduplication. Chaque source a son propre
            jeton sécurisé. Gestion complète dans les paramètres.
          </p>
        </div>
        <a
          href="/settings?tab=sources_leads"
          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--primary)] text-white hover:opacity-90 transition-opacity shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Gérer les sources{total > 0 ? ` (${total})` : ''}
        </a>
      </div>

      {recent.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
          <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Derniers leads reçus
          </p>
          <ul className="space-y-1.5">
            {recent.map(l => (
              <li key={l.id} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] shrink-0" aria-hidden="true" />
                <span className="font-medium truncate max-w-[40%]">{l.name || l.email || 'Lead'}</span>
                {l.utm_source && <Tag variant="neutral" size="xs">{l.utm_source}</Tag>}
                <span className="text-[var(--text-muted)] ml-auto shrink-0">{timeAgo(l.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const [configs, setConfigs] = useState<Record<string, Record<string, string>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // Sprint 51 M1.4 — panneau dédié Meta/Google Lead Ads
  const [leadAdsPanel, setLeadAdsPanel] = useState<LeadProvider | null>(null);
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

      {/* KPIs — KpiStrip premium */}
      <KpiStrip
        items={[
          { label: 'Total intégrations', value: INTEGRATIONS.length, color: 'brand', icon: <Icon as={Plug} size={11} /> },
          { label: 'Connectées', value: activeCount, color: 'success', icon: <Icon as={CheckCircle2} size={11} /> },
          { label: 'À configurer', value: INTEGRATIONS.length - activeCount, color: 'warning', icon: <Icon as={AlertCircle} size={11} /> },
          { label: 'Catégories', value: Object.keys(CATEGORY_LABELS).length, color: 'info', icon: <Icon as={Layers} size={11} /> },
        ] as KpiItem[]}
      />

      {/* Webhook URL */}
      <Card className="p-4 mb-6 border-l-4 border-l-[var(--primary)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">🔗 URL Webhook Universelle</h3>
          <Tag dot size="sm" variant="success">Toujours active</Tag>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          Utilisez cette URL pour recevoir des leads depuis n'importe quelle source externe.
        </p>
        <div className="flex gap-2">
          <code className="flex-1 px-3 py-2 bg-[var(--bg-subtle)] rounded-[var(--radius-md)] text-xs font-mono text-[var(--primary)] overflow-x-auto">
            POST {webhookUrl}
          </code>
          <Button size="sm" onClick={copyUrl}>{copiedUrl ? '✓ Copié !' : '📋 Copier'}</Button>
        </div>
        <details className="mt-3">
          <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--primary)]">
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

      {/* Sprint 51 M3.4 — Encart Sources de leads entrantes + mini feed */}
      <LeadSourcesCallout />

      {/* Filtres catégorie — action-chip group premium */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['all', 'ads', 'calendar', 'data', 'automation', 'communications'] as const).map(cat => {
          const isActive = filterCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(cat)}
              className={`action-chip ${isActive ? 'action-chip--accent' : ''}`}
              aria-pressed={isActive}
            >
              {cat === 'all' ? `Toutes (${INTEGRATIONS.length})` : `${CATEGORY_LABELS[cat]} (${INTEGRATIONS.filter(i => i.category === cat).length})`}
            </button>
          );
        })}
      </div>

      {/* Liste des intégrations */}
      <div className="space-y-3">
        {filteredIntegrations.map((integration, idx) => {
          const isExpanded = expanded === integration.id;
          const config = configs[integration.id] || {};
          const isActive = integration.status === 'active';
          // Sprint 51 M3.4 — honnêteté : 'soon' = pas de backend réel → pas de faux toggle
          const isSoon = integration.availability === 'soon';

          return (
            <Card
              key={integration.id}
              className={`card-premium list-item-enter transition-all ${isActive ? 'border-l-4 border-l-[var(--success)]' : ''}`}
              style={{
                animationDelay: `${Math.min(idx, 20) * 30}ms`,
                ...(isActive
                  ? {
                      background:
                        'linear-gradient(135deg, #FFFFFF 0%, rgba(55,202,55,0.06) 60%, rgba(0,157,219,0.06) 100%)',
                    }
                  : {}),
              }}
            >
              <div className="p-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-[var(--radius-md)] flex items-center justify-center text-2xl shrink-0"
                    style={
                      isActive
                        ? {
                            background: 'linear-gradient(135deg, rgba(55,202,55,0.22) 0%, rgba(0,157,219,0.18) 100%)',
                            border: '1px solid rgba(55,202,55,0.35)',
                            boxShadow: '0 0 16px -4px rgba(55,202,55,0.35)',
                          }
                        : { background: 'var(--bg-subtle)' }
                    }
                  >
                    {integration.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm font-semibold">{integration.name}</h3>
                      {isActive ? (
                        <Tag variant="success" size="xs">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)] mr-1 align-middle" />
                          Connecté
                        </Tag>
                      ) : isSoon ? (
                        <Tag dot size="xs" variant="neutral">Bientôt disponible</Tag>
                      ) : (
                        <Tag dot size="xs" variant={integration.status === 'pending' ? 'warning' : 'neutral'}>
                          {integration.status === 'pending' ? 'En attente' : 'Non connecté'}
                        </Tag>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                        {CATEGORY_LABELS[integration.category]}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{integration.description}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {integration.docsUrl && (
                      <a href={integration.docsUrl} target="_blank" rel="noreferrer"
                        className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:text-[var(--primary)] transition-colors">
                        📖 Docs
                      </a>
                    )}
                    {integration.id === 'facebook' || integration.id === 'google' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setLeadAdsPanel(integration.id === 'facebook' ? 'meta' : 'google')}
                      >
                        ⚙️ Configurer
                      </Button>
                    ) : isSoon ? (
                      <Button variant="ghost" size="sm" disabled aria-label={`${integration.name} — bientôt disponible`}>
                        Bientôt
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setExpanded(isExpanded ? null : integration.id)}>
                        {isExpanded ? '▲ Réduire' : '⚙️ Configurer'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Configuration étendue (sauf facebook/google → SlidePanel dédié) */}
              {isExpanded && integration.id !== 'facebook' && integration.id !== 'google' && (
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
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${endpoint.method === 'POST' ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--success)]/15 text-[var(--success)]'}`}>{endpoint.method}</span>
              <div>
                <p className="text-xs font-semibold font-mono">{endpoint.path}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{endpoint.desc}</p>
                <p className="text-[9px] text-[var(--text-muted)] mt-0.5">Auth : {endpoint.auth}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sprint 51 M1.4 — Panneau config Meta / Google Lead Ads */}
      {leadAdsPanel && (
        <LeadAdsConfigPanel
          provider={leadAdsPanel}
          open={!!leadAdsPanel}
          onClose={() => setLeadAdsPanel(null)}
        />
      )}
    </AppLayout>
  );
}
