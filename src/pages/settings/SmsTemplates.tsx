// ── SmsTemplates — gestion des modèles SMS (LOT SMS/WHATSAPP seq 104, Phase C)
//
// Page settings CRUD : liste + créer / éditer / supprimer des modèles SMS.
// Calque la page settings existante (CustomFieldsSettings) : header, Card,
// row-premium, EmptyState, useConfirm + toast. Consomme UNIQUEMENT les helpers
// FIGÉS Phase A (api.ts) : getSmsTemplates / createSmsTemplate /
// updateSmsTemplate / deleteSmsTemplate. Libellés via les clés `smsTemplate.*`
// posées Phase A (aucune clé inventée). Style Stripe sobre, primitives ui
// existantes, ZÉRO nouveau CSS.

import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Modal,
  Input,
  Textarea,
  EmptyState,
  DropdownMenu,
  DropdownMenuItem,
  useConfirm,
  Icon,
} from '@/components/ui';
import { MessageSquare, Plus, Pencil, Trash2, MoreVertical } from 'lucide-react';
import {
  getSmsTemplates,
  createSmsTemplate,
  updateSmsTemplate,
  deleteSmsTemplate,
} from '@/lib/api';
import type { SmsTemplate } from '@/lib/types';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

export function SmsTemplates() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Composeur create/edit (modal unique). editing = null ⇒ création.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getSmsTemplates();
      if (res.error) {
        setLoadError(true);
        toast.error(t('smsTemplate.toast_load_error'));
      } else if (res.data) {
        setTemplates(res.data);
      }
    } catch {
      setLoadError(true);
      toast.error(t('smsTemplate.toast_load_error'));
    }
    setIsLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setBody('');
    setModalOpen(true);
  };

  const openEdit = (tpl: SmsTemplate) => {
    setEditing(tpl);
    setName(tpl.name);
    setBody(tpl.body);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) return;
    setBusy(true);
    const payload = { name: name.trim(), body: body.trim() };
    const res = editing
      ? await updateSmsTemplate(editing.id, payload)
      : await createSmsTemplate(payload);
    setBusy(false);
    if (res.error || !res.data) {
      toast.error(res.error || t('campaign.status_failed'));
      return;
    }
    toast.success(editing ? t('smsTemplate.edit') : t('smsTemplate.create'));
    setModalOpen(false);
    void fetchTemplates();
  };

  const handleDelete = async (tpl: SmsTemplate) => {
    const ok = await confirm({
      title: t('smsTemplate.delete'),
      description: tpl.name,
      danger: true,
      confirmLabel: t('smsTemplate.delete'),
    });
    if (!ok) return;
    const res = await deleteSmsTemplate(tpl.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(t('smsTemplate.delete'));
    void fetchTemplates();
  };

  if (isLoading) {
    return (
      <div
        className="p-8 text-center text-[var(--text-muted)]"
        role="status"
        aria-live="polite"
        data-testid="sms-templates-loading"
      >
        {t('customfields.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" data-testid="sms-templates-page">
      <header className="settings-page-header flex items-center justify-between gap-4">
        <div>
          <h2 className="t-h2">{t('smsTemplate.title')}</h2>
        </div>
        <Button
          onClick={openCreate}
          leftIcon={<Icon as={Plus} size="sm" />}
          data-testid="sms-templates-create"
        >
          {t('smsTemplate.create')}
        </Button>
      </header>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,rgba(239,68,68,0.08))] p-4 flex items-center justify-between gap-3"
          data-testid="sms-templates-load-error"
        >
          <p className="text-sm text-[var(--danger)] flex-1">
            {t('smsTemplate.toast_load_error')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchTemplates()}
            data-testid="sms-templates-retry"
          >
            {t('smsTemplate.retry')}
          </Button>
        </div>
      )}

      <Card className="settings-card p-6">
        {templates.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={MessageSquare} size={32} />}
            title={t('smsTemplate.title')}
            action={
              <Button onClick={openCreate} leftIcon={<Icon as={Plus} size="sm" />}>
                {t('smsTemplate.create')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {templates.map((tpl, idx) => (
              <div
                key={tpl.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl group"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {tpl.name}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">
                    {tpl.body}
                  </p>
                </div>
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      aria-label={t('smsTemplate.edit')}
                    >
                      <MoreVertical size={16} />
                    </button>
                  }
                >
                  <DropdownMenuItem
                    leftIcon={<Pencil size={14} />}
                    onSelect={() => openEdit(tpl)}
                  >
                    {t('smsTemplate.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="danger"
                    leftIcon={<Trash2 size={14} />}
                    onSelect={() => handleDelete(tpl)}
                  >
                    {t('smsTemplate.delete')}
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Composeur create/edit */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? t('smsTemplate.edit') : t('smsTemplate.create')}
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('smsTemplate.name')}</label>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="prop-label">{t('smsTemplate.body')}</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              resize="none"
              aria-label={t('smsTemplate.body_aria')}
              data-testid="sms-template-body"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!name.trim() || !body.trim()}
              onClick={() => void handleSave()}
            >
              {editing ? t('smsTemplate.edit') : t('smsTemplate.create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
