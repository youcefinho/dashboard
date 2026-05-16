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
      .then((r) => r.json())
      .then((d: { data?: LeadSource[] }) => setSources(d.data || []))
      .catch(() => toastError('Impossible de charger les sources'))
      .finally(() => setLoading(false));
  }, [toastError]);

  useEffect(() => {
    loadSources();
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d: { data?: { id: string; name: string }[] }) => setClients(d.data || []))
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
    catch { setMappingError('JSON invalide — vérifiez la syntaxe'); return false; }
  };

  const save = async () => {
    if (!fName.trim()) { toastError('Le nom est requis'); return; }
    if (!fClient) { toastError('Choisissez un client'); return; }
    if (!validateMapping(fMapping)) { toastError('Le mapping JSON est invalide'); return; }
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
      if (!res.ok) { toastError(d.error || 'Échec de l\'enregistrement'); return; }
      success(editId ? 'Source mise à jour' : 'Source créée — token généré');
      setPanelOpen(false);
      loadSources();
    } catch {
      toastError('Erreur réseau');
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async (s: LeadSource) => {
    if (!confirm(`Régénérer le token de "${s.name}" ? L'ancien cessera de fonctionner.`)) return;
    const res = await fetch(`/api/lead-sources/${s.id}/rotate-token`, { method: 'POST' });
    if (res.ok) { success('Nouveau token généré'); loadSources(); }
    else toastError('Échec de la rotation');
  };

  const toggleActive = async (s: LeadSource) => {
    const res = await fetch(`/api/lead-sources/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: s.active ? 0 : 1 }),
    });
    if (res.ok) { success(s.active ? 'Source désactivée' : 'Source activée'); loadSources(); }
  };

  const remove = async (s: LeadSource) => {
    if (!confirm(`Supprimer la source "${s.name}" ? Les leads déjà reçus sont conservés.`)) return;
    const res = await fetch(`/api/lead-sources/${s.id}`, { method: 'DELETE' });
    if (res.ok) { success('Source supprimée'); loadSources(); }
    else toastError('Échec de la suppression');
  };

  const openTest = (s: LeadSource) => {
    setTestSource(s); setTestPayload(SAMPLE_PAYLOAD); setTestResult(null);
    setTestOpen(true);
  };

  const runTest = async () => {
    if (!testSource) return;
    let parsed: unknown;
    try { parsed = JSON.parse(testPayload); }
    catch { toastError('Payload JSON invalide'); return; }
    setTesting(true);
    try {
      const res = await fetch(`/api/ingest/${testSource.token}?dryRun=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const d = await res.json();
      setTestResult(d);
      if (!res.ok) toastError((d as { error?: string }).error || 'Test échoué');
    } catch {
      toastError('Erreur réseau pendant le test');
    } finally {
      setTesting(false);
    }
  };

  const openLog = (s: LeadSource) => {
    setLogSource(s); setLogLeads([]); setLogOpen(true);
    fetch(`/api/lead-sources/${s.id}/leads?limit=15`)
      .then((r) => r.json())
      .then((d: { data?: IncomingLead[] }) => setLogLeads(d.data || []))
      .catch(() => toastError('Impossible de charger les leads'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Icon as={Plug} size={18} /> Sources de leads
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Connecte n'importe quel outil (Zapier, Facebook, formulaire externe) avec un
            token unique. Le consentement est capturé à la source — conforme Loi&nbsp;25 / CASL.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Icon as={Plus} size={15} /> Nouvelle source
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement…</Card>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<Icon as={Plug} size={48} />}
          title="Aucune source configurée"
          description="Crée ta première source pour recevoir des leads depuis un outil externe via un endpoint sécurisé."
          action={<Button onClick={openCreate}><Icon as={Plus} size={15} /> Nouvelle source</Button>}
        />
      ) : (
        <div className="space-y-3">
          {sources.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{s.name}</span>
                    <Tag>{TYPE_LABELS[s.type] || s.type}</Tag>
                    {s.active
                      ? <Tag variant="success">Active</Tag>
                      : <Tag variant="neutral">Inactive</Tag>}
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
                      aria-label="Copier l'URL d'ingestion"
                    >
                      <Icon as={copied === s.id ? CheckCircle2 : Copy} size={14} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)] flex-wrap">
                    <span>Dédoublonnage&nbsp;: {DEDUP_LABELS[s.dedup_strategy] || s.dedup_strategy}</span>
                    <span>·</span>
                    <span>{s.lead_count} lead{s.lead_count > 1 ? 's' : ''} reçu{s.lead_count > 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>
                      {s.last_received_at
                        ? `Dernier reçu : ${new Date(s.last_received_at).toLocaleString('fr-CA')}`
                        : 'Jamais reçu'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => openTest(s)}>
                    <Icon as={FlaskConical} size={14} /> Tester
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openLog(s)}>
                    <Icon as={Inbox} size={14} /> Leads
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                    Modifier
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>
                    {s.active ? 'Désactiver' : 'Activer'}
                  </Button>
                  <button
                    className="lead-src-icon-btn"
                    onClick={() => rotateToken(s)}
                    aria-label="Régénérer le token"
                    title="Régénérer le token"
                  >
                    <Icon as={RefreshCw} size={14} />
                  </button>
                  <button
                    className="lead-src-icon-btn lead-src-icon-btn--danger"
                    onClick={() => remove(s)}
                    aria-label="Supprimer la source"
                    title="Supprimer"
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
        title={editId ? 'Modifier la source' : 'Nouvelle source de leads'}
      >
        <div className="space-y-4 p-1">
          <Input
            label="Nom de la source"
            value={fName}
            onChange={(e) => setFName(e.target.value)}
            placeholder="Ex : Campagne Facebook printemps"
          />
          <Select
            label="Client"
            value={fClient}
            onChange={(e) => setFClient(e.target.value)}
          >
            <option value="">— Choisir un client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select label="Type" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="webhook">Webhook</option>
            <option value="zapier">Zapier</option>
            <option value="custom">Personnalisé</option>
          </Select>
          <Select
            label="Stratégie de dédoublonnage"
            value={fDedup}
            onChange={(e) => setFDedup(e.target.value)}
            helper="Évite les doublons quand un lead arrive plusieurs fois."
          >
            <option value="email_phone">Courriel ou téléphone (recommandé)</option>
            <option value="email">Courriel + client</option>
            <option value="phone">Téléphone + client</option>
            <option value="none">Aucun (toujours créer)</option>
          </Select>
          <Select
            label="Consentement par défaut"
            value={fConsent}
            onChange={(e) => setFConsent(e.target.value)}
            helper="Si la source marketing externe n'envoie pas de champ consentement explicite. Loi 25 / CASL : « inconnu » par défaut, à confirmer ensuite."
          >
            <option value="unknown">Inconnu (à confirmer)</option>
            <option value="granted">Accordé (la source garantit l'opt-in)</option>
            <option value="denied">Refusé</option>
          </Select>
          <div>
            <label className="block text-sm font-medium mb-1">
              Mapping JSON <span className="text-[var(--text-muted)] font-normal">(optionnel)</span>
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
            <Button variant="ghost" onClick={() => setPanelOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving || !!mappingError}>
              {saving ? 'Enregistrement…' : editId ? 'Enregistrer' : 'Créer la source'}
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
            Envoie un payload exemple. <strong>Aucun lead n'est créé</strong> — tu vois
            seulement le lead qui <em>serait</em> créé (mode dry-run).
          </p>
          <Textarea
            value={testPayload}
            onChange={(e) => setTestPayload(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            aria-label="Payload de test JSON"
          />
          <Button onClick={runTest} disabled={testing}>
            <Icon as={FlaskConical} size={15} /> {testing ? 'Test en cours…' : 'Lancer le test'}
          </Button>
          {testResult != null && (
            <Card className="p-3">
              <div className="text-xs font-medium mb-1.5 text-[var(--text-muted)]">Résultat (dry-run)</div>
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
              Aucun lead reçu via cette source pour l'instant.
            </p>
          ) : (
            logLeads.map((l) => (
              <Card key={l.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{l.name || l.email}</span>
                  <Tag variant={l.consent_status === 'granted' ? 'success' : l.consent_status === 'denied' ? 'danger' : 'neutral'}>
                    {l.consent_status === 'granted' ? 'Consentement OK'
                      : l.consent_status === 'denied' ? 'Refusé' : 'Consentement inconnu'}
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
