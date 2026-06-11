// ── LeadSourcesSettings — Sprint 51 M2 : connecteur entrant générique ────────
// Sources de leads par token + mapping JSON + dry-run + log des derniers reçus.
// Stripe SUBTLE strict. FR québécois informel. Réutilise primitives existantes.
import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Button,
  Input,
  Select,
  Textarea,
  Tag,
  EmptyState,
  SlidePanel,
  useToast,
  Icon,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  Plug,
  Plus,
  Copy,
  CheckCircle2,
  RefreshCw,
  Trash2,
  FlaskConical,
  Inbox,
} from 'lucide-react';

interface LeadSource {
  id: string;
  client_id: string;
  client_name?: string;
  name: string;
  source_key: string;
  token: string;
  type: string;
  mapping_json: string | null;
  dedup_strategy: string;
  consent_default: string;
  active: number;
  created_at: string;
  last_received_at: string | null;
  lead_count: number;
}

interface IncomingLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  consent_status: string;
  utm_source: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  webhook: 'Webhook', zapier: 'Zapier', custom: 'Personnalisé',
};
const DEDUP_LABELS: Record<string, string> = {
  email: 'Courriel + client', phone: 'Téléphone + client',
  email_phone: 'Courriel ou téléphone', none: 'Aucun (toujours créer)',
};

function ingestUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/api/ingest/${token}`;
}

const SAMPLE_PAYLOAD = JSON.stringify({
  name: 'Marie Tremblay',
  email: 'marie.tremblay@exemple.ca',
  phone: '514-555-0142',
  message: 'Je veux un soumission pour rénovation cuisine',
  utm_source: 'facebook',
  utm_campaign: 'promo-printemps',
  consent: true,
}, null, 2);

export function LeadSourcesSettings() {
  const { success, error: toastError } = useToast();
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  // ── Panneau création/édition ──
  const [panelOpen, setPanelOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [fName, setFName] = useState('');
  const [fClient, setFClient] = useState('');
  const [fType, setFType] = useState('webhook');
  const [fDedup, setFDedup] = useState('email_phone');
  const [fConsent, setFConsent] = useState('unknown');
  const [fMapping, setFMapping] = useState('');
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Panneau test (dry-run) ──
  const [testOpen, setTestOpen] = useState(false);
  const [testSource, setTestSource] = useState<LeadSource | null>(null);
  const [testPayload, setTestPayload] = useState(SAMPLE_PAYLOAD);
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);

  // ── Panneau log leads entrants ──
  const [logOpen, setLogOpen] = useState(false);
  const [logSource, setLogSource] = useState<LeadSource | null>(null);
  const [logLeads, setLogLeads] = useState<IncomingLead[]>([]);

  const loadSources = useCallback(() => {
    setLoading(true);
    fetch('/api/lead-sources')
      .then((r) => r.json() as Promise<{ data?: LeadSource[] }>)
      .then((d) => setSources(d.data || []))
      .catch(() => toastError(t('set.src.loading')))
      .finally(() => setLoading(false));
  }, [toastError]);

  useEffect(() => {
    loadSources();
    fetch('/api/clients')
      .then((r) => r.json() as Promise<{ data?: { id: string; name: string }[] }>)
      .then((d) => setClients(d.data || []))
      .catch(() => { /* silencieux */ });
  }, [loadSources]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  const openCreate = () => {
    setEditId(null);
    setFName(''); setFClient(clients[0]?.id || '');
    setFType('webhook'); setFDedup('email_phone'); setFConsent('unknown');
    setFMapping(''); setMappingError(null);
    setPanelOpen(true);
  };

  const openEdit = (s: LeadSource) => {
    setEditId(s.id);
    setFName(s.name); setFClient(s.client_id);
    setFType(s.type); setFDedup(s.dedup_strategy); setFConsent(s.consent_default);
    setFMapping(s.mapping_json || ''); setMappingError(null);
    setPanelOpen(true);
  };

  const validateMapping = (raw: string): boolean => {
    if (!raw.trim()) { setMappingError(null); return true; }
    try { JSON.parse(raw); setMappingError(null); return true; }
    catch { setMappingError(t('set.src.error_json')); return false; }
  };

  const save = async () => {
    if (!fName.trim()) { toastError(t('set.src.name_label')); return; }
    if (!fClient) { toastError(t('set.src.choose_client')); return; }
    if (!validateMapping(fMapping)) { toastError(t('set.src.error_mapping')); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: fClient, name: fName, type: fType,
        dedup_strategy: fDedup, consent_default: fConsent,
        mapping_json: fMapping.trim() || null,
      };
      const res = editId
        ? await fetch(`/api/lead-sources/${editId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/lead-sources', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const d = await res.json() as { error?: string };
      if (!res.ok) { toastError(d.error || t('set.src.error_save')); return; }
      success(editId ? t('set.src.save') + ' ✓' : t('set.src.create') + ' ✓');
      setPanelOpen(false);
      loadSources();
    } catch {
      toastError(t('set.src.error_network'));
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async (s: LeadSource) => {
    if (!confirm(t('set.src.confirm_rotate'))) return;
    const res = await fetch(`/api/lead-sources/${s.id}/rotate-token`, { method: 'POST' });
    if (res.ok) { success(t('set.src.success_rotate')); loadSources(); }
    else toastError(t('set.src.error_rotate'));
  };

  const toggleActive = async (s: LeadSource) => {
    const res = await fetch(`/api/lead-sources/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: s.active ? 0 : 1 }),
    });
    if (res.ok) { success(s.active ? t('set.src.deactivated') : t('set.src.activated')); loadSources(); }
  };

  const remove = async (s: LeadSource) => {
    if (!confirm(t('set.src.confirm_delete'))) return;
    const res = await fetch(`/api/lead-sources/${s.id}`, { method: 'DELETE' });
    if (res.ok) { success(t('set.src.success_delete')); loadSources(); }
    else toastError(t('set.src.error_delete'));
  };

  const openTest = (s: LeadSource) => {
    setTestSource(s); setTestPayload(SAMPLE_PAYLOAD); setTestResult(null);
    setTestOpen(true);
  };

  const runTest = async () => {
    if (!testSource) return;
    let parsed: unknown;
    try { parsed = JSON.parse(testPayload); }
    catch { toastError(t('set.src.error_payload')); return; }
    setTesting(true);
    try {
      const res = await fetch(`/api/ingest/${testSource.token}?dryRun=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const d = await res.json();
      setTestResult(d);
      if (!res.ok) toastError((d as { error?: string }).error || t('set.src.error_test'));
    } catch {
      toastError(t('set.src.error_network'));
    } finally {
      setTesting(false);
    }
  };

  const openLog = (s: LeadSource) => {
    setLogSource(s); setLogLeads([]); setLogOpen(true);
    fetch(`/api/lead-sources/${s.id}/leads?limit=15`)
      .then((r) => r.json() as Promise<{ data?: IncomingLead[] }>)
      .then((d) => setLogLeads(d.data || []))
      .catch(() => toastError(t('set.src.error_leads')));
  };

  return (
    <div className="space-y-4 animate-stagger">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Icon as={Plug} size={18} /> {t('set.src.title')}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {t('set.src.desc')}
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Icon as={Plus} size={15} /> {t('set.src.new')}
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-[var(--text-muted)]">{t('set.src.loading')}</Card>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<Icon as={Plug} size={48} />}
          title={t('set.src.empty_title')}
          description={t('set.src.empty_desc')}
          action={<Button onClick={openCreate}><Icon as={Plus} size={15} /> {t('set.src.new')}</Button>}
        />
      ) : (
        <div className="space-y-3">
          {sources.map((s) => (
            <Card key={s.id} className="p-4 form-section-s4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{s.name}</span>
                    <Tag>{TYPE_LABELS[s.type] || s.type}</Tag>
                    {s.active
                      ? <Tag variant="success">{t('set.src.active')}</Tag>
                      : <Tag variant="neutral">{t('set.src.inactive')}</Tag>}
                    {s.client_name && (
                      <span className="text-xs text-[var(--text-muted)]">· {s.client_name}</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs bg-[var(--bg-subtle)] px-2 py-1 rounded border border-[var(--border-subtle)] truncate max-w-[420px]">
                      {ingestUrl(s.token)}
                    </code>
                    <button
                      className="lead-src-copy"
                      onClick={() => copy(ingestUrl(s.token), s.id)}
                      aria-label={t('set.src.copy_url')}
                    >
                      <Icon as={copied === s.id ? CheckCircle2 : Copy} size={14} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)] flex-wrap">
                    <span>{t('set.src.dedup')} : {DEDUP_LABELS[s.dedup_strategy] || s.dedup_strategy}</span>
                    <span>·</span>
                    <span>{s.lead_count} lead{s.lead_count > 1 ? 's' : ''} reçu{s.lead_count > 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>
                      {s.last_received_at
                        ? `${t('set.src.last_received')} : ${new Date(s.last_received_at).toLocaleString('fr-CA')}`
                        : t('set.src.never')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button variant="ghost" size="sm" className="btn-action-ghost-s1" onClick={() => openTest(s)}>
                    <Icon as={FlaskConical} size={14} /> {t('set.src.test')}
                  </Button>
                  <Button variant="ghost" size="sm" className="btn-action-ghost-s1" onClick={() => openLog(s)}>
                    <Icon as={Inbox} size={14} /> Leads
                  </Button>
                  <Button variant="ghost" size="sm" className="btn-action-ghost-s1" onClick={() => openEdit(s)}>
                    {t('set.src.modify')}
                  </Button>
                  <Button variant="ghost" size="sm" className="btn-action-ghost-s1" onClick={() => toggleActive(s)}>
                    {s.active ? t('set.src.deactivate') : t('set.src.activate')}
                  </Button>
                  <button
                    className="lead-src-icon-btn"
                    onClick={() => rotateToken(s)}
                    aria-label={t('set.src.regen_token')}
                    title={t('set.src.regen_token')}
                  >
                    <Icon as={RefreshCw} size={14} />
                  </button>
                  <button
                    className="lead-src-icon-btn lead-src-icon-btn--danger"
                    onClick={() => remove(s)}
                    aria-label={t('set.src.delete')}
                    title={t('set.src.delete')}
                  >
                    <Icon as={Trash2} size={14} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Panneau création / édition ── */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={editId ? t('set.src.edit_panel') : t('set.src.new_panel')}
      >
        <div className="space-y-4 p-1">
          <Input
            label={t('set.src.name_label')}
            value={fName}
            onChange={(e) => setFName(e.target.value)}
            placeholder={t('set.src.name_ph')}
          />
          <Select
            label={t('set.src.client')}
            value={fClient}
            onChange={(e) => setFClient(e.target.value)}
          >
            <option value="">{t('set.src.choose_client')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select label={t('set.src.type')} value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="webhook">Webhook</option>
            <option value="zapier">Zapier</option>
            <option value="custom">{t('set.src.custom')}</option>
          </Select>
          <Select
            label={t('set.src.dedup_label')}
            value={fDedup}
            onChange={(e) => setFDedup(e.target.value)}
            helper={t('set.src.dedup_helper')}
          >
            <option value="email_phone">{t('set.src.dedup_email_phone')}</option>
            <option value="email">{t('set.src.dedup_email')}</option>
            <option value="phone">{t('set.src.dedup_phone')}</option>
            <option value="none">{t('set.src.dedup_none')}</option>
          </Select>
          <Select
            label={t('set.src.consent_label')}
            value={fConsent}
            onChange={(e) => setFConsent(e.target.value)}
            helper="Si la source marketing externe n'envoie pas de champ consentement explicite. Loi 25 / CASL : « inconnu » par défaut, à confirmer ensuite."
          >
            <option value="unknown">{t('set.src.consent_unknown')}</option>
            <option value="granted">{t('set.src.consent_granted')}</option>
            <option value="denied">{t('set.src.consent_denied')}</option>
          </Select>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('set.src.mapping_label')} <span className="text-[var(--text-muted)] font-normal">({t('set.src.optional')})</span>
            </label>
            <Textarea
              value={fMapping}
              onChange={(e) => { setFMapping(e.target.value); validateMapping(e.target.value); }}
              rows={7}
              placeholder={'{\n  "name": "contact.fullName",\n  "email": "contact.email",\n  "consent": "marketing.optin",\n  "custom": { "Budget": "fields.budget" }\n}'}
              className="font-mono text-xs"
            />
            {mappingError ? (
              <p className="text-xs text-[var(--danger)] mt-1">{mappingError}</p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Vide = mapping automatique (name/nom, email/courriel, phone/téléphone, message).
                Supporte les chemins imbriqués (ex&nbsp;: <code>contact.email</code>).
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPanelOpen(false)}>{t('set.src.cancel')}</Button>
            <Button onClick={save} disabled={saving || !!mappingError}>
              {saving ? t('set.src.saving') : editId ? t('set.src.save') : t('set.src.create')}
            </Button>
          </div>
        </div>
      </SlidePanel>

      {/* ── Panneau test (dry-run) ── */}
      <SlidePanel
        open={testOpen}
        onOpenChange={setTestOpen}
        title={`Tester : ${testSource?.name || ''}`}
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-[var(--text-muted)]">
            {t('set.src.test_desc')}
          </p>
          <Textarea
            value={testPayload}
            onChange={(e) => setTestPayload(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            aria-label="Payload de test JSON"
          />
          <Button onClick={runTest} disabled={testing}>
            <Icon as={FlaskConical} size={15} /> {testing ? t('set.src.testing') : t('set.src.run_test')}
          </Button>
          {testResult != null && (
            <Card className="p-3">
              <div className="text-xs font-medium mb-1.5 text-[var(--text-muted)]">{t('set.src.result')}</div>
              <pre className="text-xs overflow-auto max-h-72 whitespace-pre-wrap">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </Card>
          )}
        </div>
      </SlidePanel>

      {/* ── Panneau log leads entrants ── */}
      <SlidePanel
        open={logOpen}
        onOpenChange={setLogOpen}
        title={`Derniers leads : ${logSource?.name || ''}`}
      >
        <div className="space-y-2 p-1">
          {logLeads.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">
              {t('set.src.no_leads')}
            </p>
          ) : (
            logLeads.map((l) => (
              <Card key={l.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{l.name || l.email}</span>
                  <Tag variant={l.consent_status === 'granted' ? 'success' : l.consent_status === 'denied' ? 'danger' : 'neutral'}>
                    {l.consent_status === 'granted' ? t('set.src.consent_ok')
                      : l.consent_status === 'denied' ? t('set.src.consent_denied') : t('set.src.consent_unknown_tag')}
                  </Tag>
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{l.email}</span>
                  {l.phone && <span>{l.phone}</span>}
                  {l.utm_source && <span>utm: {l.utm_source}</span>}
                  <span>{new Date(l.created_at).toLocaleString('fr-CA')}</span>
                </div>
              </Card>
            ))
          )}
        </div>
      </SlidePanel>
    </div>
  );
}
