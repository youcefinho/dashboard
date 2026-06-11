// ── DnsRecordsEditor — Sprint 50 (Agent B2) ────────────────────────────────
// Tableau CRUD des DNS records d'un custom domain. Consommé par
// CustomDomainsManager (slide-over drawer "Records") + par tout autre composant
// qui souhaite éditer les DNS d'un domaine donné (props : { domainId }).
//
// API back FIGÉE (Phase A) :
//   listDnsRecords(domainId)                  → ApiResponse<DnsRecord[]>
//   createDnsRecord(domainId, body)           → ApiResponse<DnsRecord>
//   updateDnsRecord(id, body)                 → ApiResponse<DnsRecord>
//   deleteDnsRecord(id)                       → ApiResponse<{ deleted }>
//
// Layout :
//   1. Header avec bouton "Ajouter un enregistrement"
//   2. Tableau : Type badge / Name / Content / TTL / Priority (si MX/SRV)
//      / Proxied badge (si A/AAAA/CNAME) / Actions (Edit / Delete)
//   3. Modal CRUD : Select type, Input name, Input content, Input ttl,
//      Input priority (visible si MX/SRV), Switch proxied (visible si
//      A/AAAA/CNAME)
//
// Style : Stripe-clean (calque VoiceAgentSettings). Imports RELATIFS conformes
// consigne Sprint 50 (Agent B2). aria-labels via t(). Aucun console.log
// (CLAUDE.md).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Pencil,
  Trash2,
  Plus,
  Globe2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  type DnsRecord,
  type DnsRecordType,
  type DnsRecordCreateInput,
  type DnsRecordUpdateInput,
} from '../../lib/api';

// ── Constantes ────────────────────────────────────────────────────────────

const DNS_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV'];
const DEFAULT_TTL = 3600;
const DEFAULT_PRIORITY = 10;

/** Type qui requiert le champ `priority` (HANDLER createDnsRecord). */
function typeRequiresPriority(type: DnsRecordType): boolean {
  return type === 'MX' || type === 'SRV';
}

/** Type qui peut être proxied via Cloudflare orange cloud. */
function typeSupportsProxied(type: DnsRecordType): boolean {
  return type === 'A' || type === 'AAAA' || type === 'CNAME';
}

/** Mapping Badge intent par type — couleurs cohérentes Stripe. */
function typeBadgeIntent(type: DnsRecordType | null | undefined): 'brand' | 'info' | 'success' | 'warning' | 'neutral' {
  switch (type) {
    case 'A':
    case 'AAAA':
      return 'brand';
    case 'CNAME':
      return 'info';
    case 'MX':
      return 'success';
    case 'TXT':
      return 'warning';
    case 'SRV':
    default:
      return 'neutral';
  }
}

// ── Props ─────────────────────────────────────────────────────────────────

interface DnsRecordsEditorProps {
  domainId: string;
}

// ── Composant ─────────────────────────────────────────────────────────────

export function DnsRecordsEditor({ domainId }: DnsRecordsEditorProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // ── État liste ─────────────────────────────────────────────────────────
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // ── État modal CRUD ────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formType, setFormType] = useState<DnsRecordType>('A');
  const [formName, setFormName] = useState<string>('');
  const [formContent, setFormContent] = useState<string>('');
  const [formTtl, setFormTtl] = useState<number>(DEFAULT_TTL);
  const [formPriority, setFormPriority] = useState<number>(DEFAULT_PRIORITY);
  const [formProxied, setFormProxied] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Erreur de chargement (distincte des erreurs d'action — affichage inline).
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Chargement initial ─────────────────────────────────────────────────
  const loadRecords = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listDnsRecords(domainId);
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setRecords([]);
    } else if (res.data) {
      setRecords(res.data);
    }
    setLoading(false);
  }, [domainId, toastError]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  // ── Modal helpers ──────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditId(null);
    setFormType('A');
    setFormName('');
    setFormContent('');
    setFormTtl(DEFAULT_TTL);
    setFormPriority(DEFAULT_PRIORITY);
    setFormProxied(false);
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((record: DnsRecord) => {
    setEditId(record.id);
    setFormType((record.type ?? 'A') as DnsRecordType);
    setFormName(record.name ?? '');
    setFormContent(record.content ?? '');
    setFormTtl(record.ttl ?? DEFAULT_TTL);
    setFormPriority(record.priority ?? DEFAULT_PRIORITY);
    setFormProxied((record.proxied ?? 0) === 1);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(
    (open: boolean) => {
      if (!open) resetForm();
      setModalOpen(open);
    },
    [resetForm],
  );

  // ── Submit CRUD ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = formName.trim();
      const content = formContent.trim();
      if (!name || !content) {
        toastError(t('dns.records.required'));
        return;
      }

      const ttl = Number.isFinite(formTtl) && formTtl > 0 ? Math.floor(formTtl) : DEFAULT_TTL;
      const requiresPrio = typeRequiresPriority(formType);
      const supportsProxy = typeSupportsProxied(formType);

      setSubmitting(true);
      let res;
      if (editId) {
        // Update : type ne change pas (HANDLER ignore type) — on envoie
        // uniquement les champs mutables (content/ttl/priority/proxied).
        const body: DnsRecordUpdateInput = {
          content,
          ttl,
        };
        if (requiresPrio) body.priority = Math.floor(formPriority);
        if (supportsProxy) body.proxied = formProxied ? 1 : 0;
        res = await updateDnsRecord(editId, body);
      } else {
        const body: DnsRecordCreateInput = {
          type: formType,
          name,
          content,
          ttl,
        };
        if (requiresPrio) body.priority = Math.floor(formPriority);
        if (supportsProxy) body.proxied = formProxied ? 1 : 0;
        res = await createDnsRecord(domainId, body);
      }
      setSubmitting(false);

      if (res.error) {
        toastError(res.error);
        return;
      }
      success(editId ? t('dns.records.edit') : t('dns.records.add'));
      setModalOpen(false);
      resetForm();
      await loadRecords();
    },
    [
      domainId,
      editId,
      formType,
      formName,
      formContent,
      formTtl,
      formPriority,
      formProxied,
      loadRecords,
      resetForm,
      success,
      toastError,
    ],
  );

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (record: DnsRecord) => {
      const ok = await confirm({
        title: t('dns.records.delete'),
        description: `${t('dns.records.delete.confirm')} — ${record.type ?? ''} ${record.name ?? ''} → ${record.content ?? ''}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      const res = await deleteDnsRecord(record.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('dns.records.delete'));
      await loadRecords();
    },
    [confirm, loadRecords, success, toastError],
  );

  // ── Memo : visibilité conditionnelle des champs ────────────────────────
  const requiresPrio = useMemo(() => typeRequiresPriority(formType), [formType]);
  const supportsProxy = useMemo(() => typeSupportsProxied(formType), [formType]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5" data-testid="dns-records-editor">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="t-h3">{t('dns.records.title')}</h3>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="sm" />}
          aria-label={t('dns.records.add')}
          data-testid="dns-records-btn-create"
        >
          {t('dns.records.add')}
        </Button>
      </header>

      {/* Tableau */}
      {loading ? (
        <div
          className="space-y-2"
          data-testid="dns-records-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('dns.records.title')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="dns-records-error"
        >
          <p className="font-medium mb-1">{t('common.loading_error')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadRecords()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : records.length === 0 ? (
        <EmptyState
          icon={<Icon as={Globe2} size={40} />}
          title={t('dns.records.empty')}
          variant="first-time"
          action={
            <Button
              onClick={handleOpenCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
              aria-label={t('dns.records.add')}
            >
              {t('dns.records.add')}
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <table
            className="w-full text-sm"
            aria-label={t('dns.records.title')}
            data-testid="dns-records-table"
          >
            <thead className="bg-[var(--gray-50)] text-[var(--text-muted)] text-xs uppercase tracking-wide">
              <tr>
                <th scope="col" className="text-left px-3 py-2 font-medium">
                  {t('dns.records.type')}
                </th>
                <th scope="col" className="text-left px-3 py-2 font-medium">
                  {t('dns.records.name')}
                </th>
                <th scope="col" className="text-left px-3 py-2 font-medium">
                  {t('dns.records.content')}
                </th>
                <th scope="col" className="text-right px-3 py-2 font-medium">
                  {t('dns.records.ttl')}
                </th>
                <th scope="col" className="text-right px-3 py-2 font-medium">
                  {t('dns.records.priority')}
                </th>
                <th scope="col" className="text-left px-3 py-2 font-medium">
                  {t('dns.records.proxied')}
                </th>
                <th scope="col" className="text-right px-3 py-2 font-medium">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const type = (record.type ?? 'A') as DnsRecordType;
                const isProxied = (record.proxied ?? 0) === 1;
                const supportsProx = typeSupportsProxied(type);
                const needsPrio = typeRequiresPriority(type);
                return (
                  <tr
                    key={record.id}
                    data-testid={`dns-records-row-${record.id}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="px-3 py-2">
                      <Badge intent={typeBadgeIntent(type)} fill="soft" size="sm">
                        {type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)] truncate max-w-[180px]">
                      {record.name ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)] truncate max-w-[260px]">
                      {record.content ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {record.ttl ?? DEFAULT_TTL}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {needsPrio ? record.priority ?? '—' : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {supportsProx ? (
                        <Badge
                          intent={isProxied ? 'warning' : 'neutral'}
                          fill="soft"
                          size="sm"
                          dot
                        >
                          {isProxied ? t('dns.records.proxied.on') : t('dns.records.proxied.off')}
                        </Badge>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(record)}
                          leftIcon={<Icon as={Pencil} size="sm" />}
                          aria-label={`${t('dns.records.edit')} — ${record.name ?? record.id}`}
                          data-testid={`dns-records-btn-edit-${record.id}`}
                        >
                          <span className="sr-only">{t('dns.records.edit')}</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDelete(record)}
                          leftIcon={<Icon as={Trash2} size="sm" />}
                          aria-label={`${t('dns.records.delete')} — ${record.name ?? record.id}`}
                          data-testid={`dns-records-btn-delete-${record.id}`}
                        >
                          <span className="sr-only">{t('dns.records.delete')}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={handleCloseModal}
        size="md"
        title={editId ? t('dns.records.edit') : t('dns.records.add')}
      >
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="p-5 space-y-4"
          data-testid="dns-records-form"
        >
          <Select
            label={t('dns.records.type')}
            value={formType}
            onChange={(e) => setFormType(e.target.value as DnsRecordType)}
            disabled={!!editId}
            aria-label={t('dns.records.type')}
            data-testid="dns-records-form-type"
          >
            {DNS_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </Select>

          <Input
            label={t('dns.records.name')}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('dns.records.name.placeholder')}
            disabled={!!editId}
            required
            aria-label={t('dns.records.name')}
            data-testid="dns-records-form-name"
          />

          <Input
            label={t('dns.records.content')}
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder={
              formType === 'A'
                ? '192.0.2.1'
                : formType === 'AAAA'
                  ? '2001:db8::1'
                  : formType === 'CNAME'
                    ? 'target.example.com'
                    : formType === 'MX'
                      ? 'mail.example.com'
                      : formType === 'TXT'
                        ? 'v=spf1 include:_spf.example.com ~all'
                        : '0 5 5060 sip.example.com'
            }
            required
            aria-label={t('dns.records.content')}
            data-testid="dns-records-form-content"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              label={t('dns.records.ttl')}
              value={String(formTtl)}
              onChange={(e) => setFormTtl(Number(e.target.value))}
              min={60}
              max={86400}
              aria-label={t('dns.records.ttl')}
              data-testid="dns-records-form-ttl"
            />
            {requiresPrio ? (
              <Input
                type="number"
                label={t('dns.records.priority')}
                value={String(formPriority)}
                onChange={(e) => setFormPriority(Number(e.target.value))}
                min={0}
                max={65535}
                aria-label={t('dns.records.priority')}
                data-testid="dns-records-form-priority"
              />
            ) : null}
          </div>

          {supportsProxy ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--gray-50)] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t('dns.records.proxied')}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {t('dns.records.proxied.help')}
                </p>
              </div>
              <Switch
                checked={formProxied}
                onCheckedChange={setFormProxied}
                size="sm"
                aria-label={t('dns.records.proxied')}
                data-testid="dns-records-form-proxied"
              />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleCloseModal(false)}
              aria-label={t('action.cancel')}
              data-testid="dns-records-form-cancel"
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={submitting}
              aria-label={editId ? t('action.save') : t('action.create')}
              data-testid="dns-records-form-submit"
            >
              {editId ? t('action.save') : t('action.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default DnsRecordsEditor;
