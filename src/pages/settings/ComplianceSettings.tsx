// ── ComplianceSettings — Sprint 23 W33 : KpiStrip + Textarea + useToast + Switch + row-premium
import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import {
  Card,
  Button,
  Textarea,
  Switch,
  Tag,
  KpiStrip,
  EmptyState,
  useToast,
  Icon,
} from '@/components/ui';
import { Shield, Ban, Download, Mail, Smartphone, FileCheck } from 'lucide-react';

interface Unsubscribe {
  id: string;
  email: string;
  phone: string;
  channel: string;
  reason: string;
  unsubscribed_at: string;
}

export function ComplianceSettings() {
  const { success, error: toastError } = useToast();
  const [amfCert, setAmfCert] = useState('');
  const [amfRequired, setAmfRequired] = useState(false);
  const [unsubscribes, setUnsubscribes] = useState<Unsubscribe[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Load unsubscribes
    apiFetch<Unsubscribe[]>('/unsubscribes')
      .then((res) => {
        setUnsubscribes(res.data || []);
      })
      .finally(() => setIsLoading(false));

    // Load compliance settings
    apiFetch<any>('/settings/compliance').then((res) => {
      if (res.data) {
        setAmfCert(res.data.amf_certificate || '');
        setAmfRequired(res.data.amf_disclaimer_required === 1);
      }
    });
  }, []);

  const handleSaveAmf = async () => {
    setIsSaving(true);
    try {
      await apiFetch('/settings/compliance', {
        method: 'PATCH',
        body: JSON.stringify({
          amf_certificate: amfCert,
          amf_disclaimer_required: amfRequired ? 1 : 0,
        }),
      });
      success('Mentions légales enregistrées');
    } catch (err: any) {
      toastError(err?.message || 'Erreur lors de la sauvegarde');
    }
    setIsSaving(false);
  };

  const handleExportUnsubscribes = () => {
    if (!unsubscribes || unsubscribes.length === 0) {
      toastError('Aucune donnée à exporter');
      return;
    }
    try {
      const csvContent =
        'data:text/csv;charset=utf-8,' +
        'Email,Phone,Channel,Date\n' +
        unsubscribes.map((e) => `${e.email},${e.phone},${e.channel},${e.unsubscribed_at}`).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'unsubscribes.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      success('Export CSV téléchargé');
    } catch (err: any) {
      toastError(err?.message || "Échec de l'export");
    }
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    if (diffH < 24) return `Il y a ${diffH}h`;
    return `Il y a ${diffD} jours`;
  };

  const kpis = useMemo(() => {
    const byEmail = unsubscribes.filter((u) => u.channel === 'email').length;
    const bySms = unsubscribes.filter((u) => u.channel === 'sms').length;
    return [
      { label: 'Désabonnés total', value: unsubscribes.length, color: 'danger' as const, icon: <Ban size={12} /> },
      { label: 'Email', value: byEmail, color: 'brand' as const, icon: <Mail size={12} /> },
      { label: 'SMS', value: bySms, color: 'warning' as const, icon: <Smartphone size={12} /> },
      { label: 'RGPD requests', value: 0, color: 'neutral' as const, icon: <FileCheck size={12} /> },
    ];
  }, [unsubscribes]);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="settings-page-header">
        <div>
          <h2 className="t-h2 flex items-center gap-2">
            <Icon as={Shield} size="lg" className="text-[var(--primary)]" />
            Conformité & légal
          </h2>
          <p className="t-caption text-[var(--gray-500)]">
            Listes de désabonnement (Loi 25 / CASL) et mentions légales.
          </p>
        </div>
      </header>

      <KpiStrip items={kpis} />

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
            <Shield size={16} className="text-[var(--primary)]" /> Mentions légales
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            Insertion automatique dans les courriels sortants — AMF, RBQ, OACIQ.
          </p>
        </header>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">Mentions légales automatiques</p>
            <p className="settings-toggle-row__desc">
              Active l'insertion auto dans les courriels sortants.
            </p>
          </div>
          <Switch checked={amfRequired} onCheckedChange={setAmfRequired} variant="brand" />
        </div>
        {amfRequired && (
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">
              Texte de la mention légale
            </label>
            <Textarea
              value={amfCert}
              onChange={(e) => setAmfCert(e.target.value)}
              placeholder="ex: 123456 — Cabinet enregistré auprès de l'AMF"
              maxLength={500}
              showCounter
              className="h-[88px]"
            />
            <p className="settings-helper">Numéro de permis, AMF, RBQ, OACIQ, etc.</p>
          </div>
        )}
        <div className="settings-actions">
          <Button onClick={handleSaveAmf} disabled={isSaving || (amfRequired && !amfCert)} isLoading={isSaving}>
            Enregistrer
          </Button>
        </div>
      </Card>

      <Card className="settings-card p-0 overflow-hidden">
        <header className="settings-section-header settings-section-header--inset settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Ban} size="md" className="text-[var(--danger)]" /> Liste de suppression (opt-outs)
            </h3>
            <p className="t-caption text-[var(--gray-500)]">Conformité Loi 25 / CASL.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleExportUnsubscribes} leftIcon={<Icon as={Download} size="sm" />}>
            Exporter CSV
          </Button>
        </header>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement...</div>
        ) : unsubscribes.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Ban size={28} />}
            title="Aucun contact désabonné"
            description="Les opt-outs apparaîtront ici (CASL / RGPD)."
          />
        ) : (
          <div className="p-4 space-y-2.5">
            {unsubscribes.map((unsub, idx) => (
              <div
                key={unsub.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {unsub.email || unsub.phone}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">{timeAgo(unsub.unsubscribed_at)}</p>
                </div>
                <Tag variant={unsub.channel === 'sms' ? 'warning' : 'danger'} dot>
                  {unsub.channel}
                </Tag>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
