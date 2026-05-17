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
      toastError('Échec de création de la clé');
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
      success('Webhook créé');
      resetWhWizard();
    } else {
      toastError('Échec de création du webhook');
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
    if (res.ok) success('Webhook test envoyé');
    else toastError('Échec du test webhook');
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setKeyCopied(true);
      success('Clé copiée');
    } catch {
      toastError('Copie impossible');
    }
  };

  const failingWebhook = webhooks.find((w) => (w.fail_count || 0) > 5);

  // ── Wizard steps : API Key ──────────────────────────────────
  const keyWizardSteps: WizardStep[] = useMemo(
    () => [
      {
        id: 'name',
        label: 'Nom & usage',
        isValid: () => newKeyName.trim().length >= 2,
        content: (
          <div className="space-y-4">
            <div>
              <label className="t-label-form mb-1.5 block">Nom de la clé</label>
              <Input
                placeholder="Ex: Zapier — Production"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
              />
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                Utilisez un nom descriptif pour identifier facilement où la clé est utilisée.
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'scopes',
        label: 'Permissions',
        isValid: () => newKeyScopes.length >= 1,
        content: (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-muted)]">
              Choisissez les permissions accordées à cette clé. Restreindre au strict nécessaire pour limiter
              l'impact d'une fuite.
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
        label: 'URL cible',
        isValid: () => /^https?:\/\/.{4,}/i.test(newWhUrl.trim()),
        content: (
          <div className="space-y-4">
            <div>
              <label className="t-label-form mb-1.5 block">URL du webhook</label>
              <Input
                placeholder="https://votre-serveur.com/webhook"
                value={newWhUrl}
                onChange={(e) => setNewWhUrl(e.target.value)}
                autoFocus
              />
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                Cette URL recevra une requête POST JSON pour chaque évènement sélectionné.
                HTTPS recommandé pour la production.
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'events',
        label: 'Évènements',
        isValid: () => newWhEvents.length >= 1,
        content: (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-muted)]">
              Sélectionnez les évènements qui déclencheront ce webhook. Choisir "Tous" garantit qu'aucun
              futur évènement ne sera manqué.
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
          title="Webhook qui échoue souvent"
          description={`${failingWebhook.url} a échoué ${failingWebhook.fail_count} fois. Vérifiez la cible.`}
          action={{
            label: 'Voir logs',
            onClick: () => void fetchDeliveries(failingWebhook.id),
          }}
        />
      )}

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={KeyRound} size="md" className="text-[var(--primary)]" /> Clés API
            </h3>
            <p className="t-caption text-[var(--gray-500)]">Authentifie tes intégrations externes.</p>
          </div>
          <Button onClick={openKeyWizard} size="sm" leftIcon={<Icon as={Plus} size="sm" />}>
            Créer une clé
          </Button>
        </header>
        {keys.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={KeyRound} size={28} />}
            title="Aucune clé API"
            description="Créez une clé pour intégrer Intralys avec vos outils externes (Zapier, Make...)."
            action={
              <Button onClick={openKeyWizard} leftIcon={<Plus size={14} />}>
                Créer une clé
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
                    Créée le {new Date(k.created_at).toLocaleDateString()} • {k.scopes || 'aucun scope'}
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
                    Révoquer
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
              <Icon as={Webhook} size="md" className="text-[var(--primary)]" /> Webhooks sortants
            </h3>
            <p className="t-caption text-[var(--gray-500)]">Push événements vers tes systèmes externes.</p>
          </div>
          <Button onClick={openWhWizard} size="sm" leftIcon={<Icon as={Plus} size="sm" />}>
            Ajouter
          </Button>
        </header>
        {webhooks.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Webhook size={28} />}
            title="Aucun webhook configuré"
            description="Connectez vos systèmes externes pour recevoir des notifications en temps réel."
            action={
              <Button onClick={openWhWizard} leftIcon={<Plus size={14} />}>
                Ajouter un webhook
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
                          {w.fail_count} échecs
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
                      Tester
                    </DropdownMenuItem>
                    <DropdownMenuItem leftIcon={<FileText size={14} />} onSelect={() => fetchDeliveries(w.id)}>
                      Logs
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="danger" leftIcon={<Trash2 size={14} />} onSelect={() => deleteWebhook(w.id)}>
                      Supprimer
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
        title="Créer une clé API"
        description="Définissez un nom puis sélectionnez les permissions accordées."
        completeLabel="Générer la clé"
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
        title="Clé API générée"
      >
        {createdKey && (
          <div>
            <div className="settings-info-banner settings-info-banner--warning">
              <AlertTriangle size={16} className="settings-info-banner__icon" />
              <p className="settings-info-banner__body">
                Copie cette clé maintenant — elle ne sera plus jamais affichée. Stocke-la dans un gestionnaire
                de secrets sécurisé.
              </p>
            </div>
            <div className="flex gap-2 mt-3">
              <Input value={createdKey} readOnly className="font-mono text-xs bg-[var(--gray-50)] flex-1" />
              <Button
                variant="secondary"
                onClick={() => void copyCreatedKey()}
                leftIcon={keyCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              >
                {keyCopied ? 'Copié' : 'Copier'}
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
              J'ai copié ma clé
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
        title="Ajouter un webhook"
        description="Configurez l'URL cible et les évènements à écouter."
        completeLabel="Créer le webhook"
      />

      <Modal open={showLogsModal} onOpenChange={() => setShowLogsModal(false)} title="Logs de livraison Webhook">
        <div className="max-h-[60vh] overflow-y-auto space-y-3">
          {deliveries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">Aucune livraison enregistrée.</p>
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
