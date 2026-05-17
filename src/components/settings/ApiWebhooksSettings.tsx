// ── ApiWebhooksSettings — Sprint 23 W32 : card-premium + DropdownMenu actions + SmartBanner warning
// ── Sprint 30 vague 30-2B : création via <Wizard> 2 steps + <ScopePicker> primitive
// Note : on garde fetch() direct (pas migrer vers apiFetch — risque CORS)
import { useMemo, useState, useEffect } from 'react';
import {
  Card,
  Button,
  Input,
  Tag,
  SmartBanner,
  EmptyState,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  useToast,
  Wizard,
  ScopePicker,
  API_SCOPES,
  WEBHOOK_EVENTS,
  type WizardStep,
  Icon,
} from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import {
  KeyRound,
  Webhook,
  MoreVertical,
  Send,
  FileText,
  Trash2,
  Plus,
  AlertTriangle,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { t } from '@/lib/i18n';

export function ApiWebhooksSettings() {
  const { success, error: toastError } = useToast();
  const [keys, setKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);

  // ── Wizard state (clé API) ──
  const [keyWizardOpen, setKeyWizardOpen] = useState(false);
  const [keyWizardStep, setKeyWizardStep] = useState(0);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // ── Wizard state (webhook) ──
  const [whWizardOpen, setWhWizardOpen] = useState(false);
  const [whWizardStep, setWhWizardStep] = useState(0);
  const [newWhUrl, setNewWhUrl] = useState('');
  const [newWhEvents, setNewWhEvents] = useState<string[]>(['*']);

  useEffect(() => {
    fetch('/api/settings/api-keys')
      .then((res) => res.json())
      .then((data: any) => setKeys(data.data || []));
    fetch('/api/settings/webhooks')
      .then((res) => res.json())
      .then((data: any) => setWebhooks(data.data || []));
  }, []);

  // ── Helpers ─────────────────────────────────────────────────
  const resetKeyWizard = () => {
    setKeyWizardOpen(false);
    setKeyWizardStep(0);
    setNewKeyName('');
    setNewKeyScopes([]);
    setKeyCopied(false);
  };

  const openKeyWizard = () => {
    setNewKeyName('');
    setNewKeyScopes([]);
    setKeyWizardStep(0);
    setCreatedKey(null);
    setKeyCopied(false);
    setKeyWizardOpen(true);
  };

  const resetWhWizard = () => {
    setWhWizardOpen(false);
    setWhWizardStep(0);
    setNewWhUrl('');
    setNewWhEvents(['*']);
  };

  const openWhWizard = () => {
    setNewWhUrl('');
    setNewWhEvents(['*']);
    setWhWizardStep(0);
    setWhWizardOpen(true);
  };

  const createApiKey = async () => {
    const res = await fetch('/api/settings/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName, scopes: newKeyScopes.join(',') }),
    });
    const data: any = await res.json();
    if (data.data) {
      setKeys([...keys, data.data]);
      setCreatedKey(data.data.key);
    } else {
      toastError(t('set.api.key_fail'));
    }
  };

  const createWebhook = async () => {
    const eventsStr = newWhEvents.includes('*') ? '*' : newWhEvents.join(',');
    const res = await fetch('/api/settings/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newWhUrl, events: eventsStr }),
    });
    const data: any = await res.json();
    if (data.data) {
      setWebhooks([...webhooks, data.data]);
      success(t('set.api.wh_created'));
      resetWhWizard();
    } else {
      toastError(t('set.api.wh_fail'));
    }
  };

  const deleteKey = async (id: string) => {
    await fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE' });
    setKeys(keys.filter((k) => k.id !== id));
  };

  const deleteWebhook = async (id: string) => {
    await fetch(`/api/settings/webhooks/${id}`, { method: 'DELETE' });
    setWebhooks(webhooks.filter((w) => w.id !== id));
  };

  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);

  const fetchDeliveries = async (webhookId: string) => {
    const res = await fetch(`/api/settings/webhooks/${webhookId}/deliveries`);
    if (res.ok) {
      const data = (await res.json()) as any;
      setDeliveries(data.data || []);
      setShowLogsModal(true);
    }
  };

  const testWebhook = async (webhookId: string) => {
    const res = await fetch(`/api/settings/webhooks/${webhookId}/test`, { method: 'POST' });
    if (res.ok) success(t('set.api.test_sent'));
    else toastError(t('set.api.test_fail'));
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setKeyCopied(true);
      success(t('set.api.key_copy_ok'));
    } catch {
      toastError(t('set.api.copy_fail'));
    }
  };

  const failingWebhook = webhooks.find((w) => (w.fail_count || 0) > 5);

  // ── Wizard steps : API Key ──────────────────────────────────
  const keyWizardSteps: WizardStep[] = useMemo(
    () => [
      {
        id: 'name',
        label: t('set.api.name_usage'),
        isValid: () => newKeyName.trim().length >= 2,
        content: (
          <div className="space-y-4">
            <div>
              <label className="t-label-form mb-1.5 block">{t('set.api.key_name')}</label>
              <Input
                placeholder="Ex: Zapier — Production"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
              />
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                {t('set.api.key_name_hint')}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'scopes',
        label: t('set.api.permissions'),
        isValid: () => newKeyScopes.length >= 1,
        content: (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-muted)]">
              {t('set.api.permissions_hint')}
              
            </p>
            <ScopePicker
              mode="scope"
              value={newKeyScopes}
              onChange={setNewKeyScopes}
              categories={API_SCOPES}
            />
          </div>
        ),
      },
    ],
    [newKeyName, newKeyScopes],
  );

  // ── Wizard steps : Webhook ──────────────────────────────────
  const whWizardSteps: WizardStep[] = useMemo(
    () => [
      {
        id: 'url',
        label: t('set.api.target_url'),
        isValid: () => /^https?:\/\/.{4,}/i.test(newWhUrl.trim()),
        content: (
          <div className="space-y-4">
            <div>
              <label className="t-label-form mb-1.5 block">{t('set.api.wh_url')}</label>
              <Input
                placeholder="https://votre-serveur.com/webhook"
                value={newWhUrl}
                onChange={(e) => setNewWhUrl(e.target.value)}
                autoFocus
              />
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                {t('set.api.wh_url_hint')}
                
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'events',
        label: t('set.api.events'),
        isValid: () => newWhEvents.length >= 1,
        content: (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-muted)]">
              {t('set.api.events_hint')}
              
            </p>
            <ScopePicker
              mode="event"
              value={newWhEvents}
              onChange={setNewWhEvents}
              categories={WEBHOOK_EVENTS}
            />
          </div>
        ),
      },
    ],
    [newWhUrl, newWhEvents],
  );

  return (
    <div className="space-y-6">
      {failingWebhook && (
        <SmartBanner
          variant="warning"
          icon={<AlertTriangle size={16} />}
          title={t('set.api.failing_wh')}
          description={`${failingWebhook.url} a échoué ${failingWebhook.fail_count} fois. Vérifiez la cible.`}
          action={{
            label: t('set.api.see_logs'),
            onClick: () => void fetchDeliveries(failingWebhook.id),
          }}
        />
      )}

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={KeyRound} size="md" className="text-[var(--primary)]" /> {t('set.api.keys_title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('set.api.keys_desc')}</p>
          </div>
          <Button onClick={openKeyWizard} size="sm" leftIcon={<Icon as={Plus} size="sm" />}>
            Créer une clé
          </Button>
        </header>
        {keys.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={KeyRound} size={28} />}
            title={t('set.api.no_key')}
            description={t('set.api.no_key_desc')}
            action={
              <Button onClick={openKeyWizard} leftIcon={<Plus size={14} />}>
                {t('set.api.create_key')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {keys.map((k, idx) => (
              <div
                key={k.id}
                className="card-premium list-item-enter flex justify-between items-center p-4 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{k.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t('set.api.created_on')} {new Date(k.created_at).toLocaleDateString()} • {k.scopes || t('set.api.no_scopes')}
                  </p>
                </div>
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      aria-label="Actions"
                    >
                      <MoreVertical size={16} />
                    </button>
                  }
                >
                  <DropdownMenuItem variant="danger" leftIcon={<Trash2 size={14} />} onSelect={() => deleteKey(k.id)}>
                    {t('set.api.revoke')}
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Webhook} size="md" className="text-[var(--primary)]" /> {t('set.api.webhooks_title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('set.api.webhooks_desc')}</p>
          </div>
          <Button onClick={openWhWizard} size="sm" leftIcon={<Icon as={Plus} size="sm" />}>
            {t('set.api.add')}
          </Button>
        </header>
        {webhooks.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Webhook size={28} />}
            title={t('set.api.no_webhook')}
            description={t('set.api.no_webhook_desc')}
            action={
              <Button onClick={openWhWizard} leftIcon={<Plus size={14} />}>
                {t('set.api.add_webhook')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {webhooks.map((w, idx) => {
              const isFailing = (w.fail_count || 0) > 5;
              return (
                <div
                  key={w.id}
                  className="card-premium list-item-enter flex justify-between items-center p-4 rounded-xl gap-3"
                  style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate text-[var(--text-primary)]">{w.url}</p>
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      <Tag variant="neutral" size="sm">{w.events}</Tag>
                      {w.fail_count > 0 && (
                        <Tag color={isFailing ? 'var(--danger)' : 'var(--warning)'} size="sm">
                          {w.fail_count} {t('set.api.failures')}
                        </Tag>
                      )}
                    </div>
                  </div>
                  <DropdownMenu
                    trigger={
                      <button
                        type="button"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                        aria-label="Actions"
                      >
                        <MoreVertical size={16} />
                      </button>
                    }
                  >
                    <DropdownMenuItem leftIcon={<Send size={14} />} onSelect={() => testWebhook(w.id)}>
                      {t('set.api.test')}
                    </DropdownMenuItem>
                    <DropdownMenuItem leftIcon={<FileText size={14} />} onSelect={() => fetchDeliveries(w.id)}>
                      {t('set.api.logs')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="danger" leftIcon={<Trash2 size={14} />} onSelect={() => deleteWebhook(w.id)}>
                      {t('set.api.delete')}
                    </DropdownMenuItem>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Wizard création clé API (2 steps) ───────────────────── */}
      <Wizard
        open={keyWizardOpen}
        onOpenChange={(o) => {
          if (!o && !createdKey) resetKeyWizard();
          else setKeyWizardOpen(o);
        }}
        steps={keyWizardSteps}
        currentIndex={keyWizardStep}
        onStepChange={setKeyWizardStep}
        onComplete={() => void createApiKey()}
        onCancel={() => {
          if (!createdKey) resetKeyWizard();
        }}
        title={t('set.api.key_wizard_title')}
        description={t('set.api.key_wizard_desc')}
        completeLabel={t('set.api.gen_key')}
      />

      {/* ── Modal one-time : clé créée (non-mergée dans wizard pour highlight sécurité) ── */}
      <Modal
        open={Boolean(createdKey)}
        onOpenChange={(o) => {
          if (!o) {
            setCreatedKey(null);
            resetKeyWizard();
          }
        }}
        title={t('set.api.key_generated')}
      >
        {createdKey && (
          <div>
            <div className="settings-info-banner settings-info-banner--warning">
              <AlertTriangle size={16} className="settings-info-banner__icon" />
              <p className="settings-info-banner__body">
                {t('set.api.key_warn')}
                
              </p>
            </div>
            <div className="flex gap-2 mt-3">
              <Input value={createdKey} readOnly className="font-mono text-xs bg-[var(--gray-50)] flex-1" />
              <Button
                variant="secondary"
                onClick={() => void copyCreatedKey()}
                leftIcon={keyCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              >
                {keyCopied ? t('set.api.copied') : t('set.api.copy')}
              </Button>
            </div>
            <Button
              className="mt-4 w-full"
              variant="primary"
              onClick={() => {
                setCreatedKey(null);
                resetKeyWizard();
              }}
            >
              {t('set.api.key_copied')}
            </Button>
          </div>
        )}
      </Modal>

      {/* ── Wizard création webhook (2 steps) ───────────────────── */}
      <Wizard
        open={whWizardOpen}
        onOpenChange={(o) => {
          if (!o) resetWhWizard();
          else setWhWizardOpen(o);
        }}
        steps={whWizardSteps}
        currentIndex={whWizardStep}
        onStepChange={setWhWizardStep}
        onComplete={() => void createWebhook()}
        onCancel={resetWhWizard}
        title={t('set.api.wh_wizard_title')}
        description={t('set.api.wh_wizard_desc')}
        completeLabel={t('set.api.create_wh')}
      />

      <Modal open={showLogsModal} onOpenChange={() => setShowLogsModal(false)} title={t('set.api.wh_logs')}>
        <div className="max-h-[60vh] overflow-y-auto space-y-3">
          {deliveries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">{t('set.api.no_delivery')}</p>
          ) : (
            deliveries.map((d) => (
              <div key={d.id} className="p-3 border border-[var(--border-subtle)] rounded text-xs space-y-1">
                <div className="flex justify-between font-medium">
                  <span>{d.event_type}</span>
                  <span className={d.status === 'delivered' ? 'text-green-600' : 'text-red-600'}>
                    {d.status} ({d.response_code || '---'})
                  </span>
                </div>
                <p className="text-[var(--text-muted)]">{new Date(d.created_at).toLocaleString()}</p>
                {d.response_body && (
                  <pre className="bg-[var(--bg-subtle)] p-2 mt-2 rounded overflow-x-auto max-w-full text-[10px]">
                    {d.response_body}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
