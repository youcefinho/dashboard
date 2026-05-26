// ── CustomFieldsSettings — Sprint 23 W33 : cards row-premium + Tag + KpiStrip + EmptyState
import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Tag,
  KpiStrip,
  EmptyState,
  DropdownMenu,
  DropdownMenuItem,
  useConfirm,
  Icon,
} from '@/components/ui';
import { GripVertical, Plus, Trash2, Save, MoreVertical, Sliders, Hash, ListChecks, Type } from 'lucide-react';

import { getCustomFields, createCustomField, deleteCustomField } from '@/lib/api';
import type { CustomFieldDef } from '@/lib/types';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

function typeVariant(t: string): 'brand' | 'info' | 'success' | 'warning' | 'accent' | 'neutral' {
  switch (t) {
    case 'text':
      return 'info';
    case 'number':
      return 'success';
    case 'select':
    case 'multiselect':
      return 'brand';
    case 'date':
      return 'accent';
    case 'boolean':
      return 'warning';
    default:
      return 'neutral';
  }
}

function typeIcon(t: string) {
  switch (t) {
    case 'number':
      return <Hash size={12} />;
    case 'select':
    case 'multiselect':
      return <ListChecks size={12} />;
    case 'text':
      return <Type size={12} />;
    default:
      return null;
  }
}

export function CustomFieldsSettings() {
  const confirm = useConfirm();
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void fetchFields();
  }, []);

  const fetchFields = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getCustomFields();
      if (res.error) {
        setLoadError(true);
        toast.error(t('customfields.toast_load_error'));
      } else if (res.data) {
        setFields(res.data as unknown as CustomFieldDef[]);
      }
    } catch {
      setLoadError(true);
      toast.error(t('customfields.toast_load_error'));
    }
    setIsLoading(false);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('customfields.confirm_title'),
      description: t('customfields.confirm_desc'),
      confirmLabel: t('customfields.confirm_yes'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteCustomField(id);
    if (res.error) toast.error(res.error);
    else {
      toast.success(t('customfields.toast_deleted'));
      void fetchFields();
    }
  };

  const handleAddMock = async () => {
    const res = await createCustomField({
      client_id: 'default',
      name: t('customfields.new_name').replace('{n}', String(fields.length + 1)),
      field_type: 'text',
      options: [],
      is_required: false,
      sort_order: fields.length,
    });
    if (res.error) toast.error(res.error);
    else {
      toast.success(t('customfields.toast_added'));
      void fetchFields();
    }
  };

  const kpis = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const f of fields) {
      byType[f.field_type] = (byType[f.field_type] || 0) + 1;
    }
    return [
      { label: t('customfields.kpi_total'), value: fields.length, color: 'brand' as const, icon: <Sliders size={12} /> },
      { label: t('customfields.kpi_text'), value: byType['text'] || 0, color: 'info' as const, icon: <Type size={12} /> },
      { label: t('customfields.kpi_number'), value: byType['number'] || 0, color: 'success' as const, icon: <Hash size={12} /> },
      {
        label: t('customfields.kpi_select'),
        value: (byType['select'] || 0) + (byType['multiselect'] || 0),
        color: 'accent' as const,
        icon: <ListChecks size={12} />,
      },
    ];
  }, [fields]);

  if (isLoading)
    return (
      <div
        className="p-8 text-center text-[var(--text-muted)]"
        role="status"
        aria-live="polite"
        data-testid="customfields-loading"
      >
        {t('customfields.loading')}
      </div>
    );

  return (
    <div className="space-y-6 animate-fade-in" data-testid="customfields-settings">
      <header className="settings-page-header">
        <div>
          <h2 className="t-h2">{t('customfields.page_title')}</h2>
          <p className="t-caption text-[var(--gray-500)]">
            {t('customfields.page_subtitle')}
          </p>
        </div>
      </header>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,rgba(239,68,68,0.08))] p-4 flex items-center justify-between gap-3"
          data-testid="customfields-load-error"
        >
          <p className="text-sm text-[var(--danger)] flex-1">
            {t('customfields.toast_load_error')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchFields()}
            data-testid="customfields-retry"
          >
            {t('customfields.retry')}
          </Button>
        </div>
      )}

      <KpiStrip items={kpis} />

      <Card className="settings-card p-6">
        {fields.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={Sliders} size={32} />}
            title={t('customfields.empty_title')}
            description={t('customfields.empty_desc')}
            action={
              <Button onClick={handleAddMock} leftIcon={<Icon as={Plus} size="sm" />}>
                {t('customfields.add_quick')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {fields.map((field, idx) => (
              <div
                key={field.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl group"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <GripVertical size={14} className="text-[var(--text-muted)] cursor-move opacity-40 group-hover:opacity-100 transition-opacity shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{field.name}</p>
                  <p className="font-mono text-[11px] text-[var(--text-muted)] truncate">{field.slug}</p>
                </div>
                <Tag variant={typeVariant(field.field_type)} dot leftIcon={typeIcon(field.field_type)}>
                  {field.field_type}
                </Tag>
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      aria-label={t('customfields.actions_aria')}
                    >
                      <MoreVertical size={16} />
                    </button>
                  }
                >
                  <DropdownMenuItem variant="danger" leftIcon={<Trash2 size={14} />} onSelect={() => handleDelete(field.id)}>
                    {t('customfields.delete')}
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </Card>

      {fields.length > 0 && (
        <button
          onClick={handleAddMock}
          className="action-chip w-full justify-center"
          style={{ borderStyle: 'dashed' }}
        >
          <Plus size={14} />
          {t('customfields.add_quick')}
        </button>
      )}

      <div className="flex justify-end pt-4 border-t border-[var(--border-subtle)]">
        <Button leftIcon={<Icon as={Save} size="md" />}>{t('customfields.save_order')}</Button>
      </div>
    </div>
  );
}
