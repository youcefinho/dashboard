// ── Confidentialité (Loi 25 / GDPR) — actions par lead ──────────────
//   Expose les outils backend EXISTANTS (exportLeadPii, forgetLead) qui
//   n'avaient aucune UI. Gating admin, confirm fort (requireText) sur le
//   droit à l'oubli, feedback inline (role=alert) + toasts, a11y (aria-busy).
//   100% additif : aucun import api.ts modifié, clés i18n privacy.* uniquement.

import { useState } from 'react';
import { Card, Button, Icon, useToast, useConfirm } from '@/components/ui';
import { t } from '@/lib/i18n';
import { exportLeadPii, forgetLead } from '@/lib/api';
import { Download, ShieldOff } from 'lucide-react';

interface LeadPrivacyActionsProps {
  leadId: string;
  /** Nom du lead — sert de texte de confirmation pour le droit à l'oubli. */
  leadName: string;
  /** Email du lead — affiché comme fallback si le nom est vide. */
  leadEmail?: string;
  /** Vrai si l'utilisateur courant est admin (gating). */
  isAdmin: boolean;
  /** Appelé après une anonymisation réussie (ex : redirection). */
  onForgotten?: () => void;
}

/**
 * Carte « Confidentialité (Loi 25) » : export des données personnelles +
 * droit à l'oubli (anonymisation irréversible). Réservée aux admins.
 */
export function LeadPrivacyActions({ leadId, leadName, leadEmail, isAdmin, onForgotten }: LeadPrivacyActionsProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [isExporting, setIsExporting] = useState(false);
  const [isForgetting, setIsForgetting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Gating : seuls les admins voient ces outils de conformité.
  if (!isAdmin) return null;

  const confirmLabel = leadName?.trim() || leadEmail?.trim() || leadId;
  const busy = isExporting || isForgetting;

  const handleExport = async () => {
    setErrorMsg(null);
    setIsExporting(true);
    const res = await exportLeadPii(leadId);
    setIsExporting(false);
    if (res.error || !res.data) {
      const msg = res.error || t('privacy.lead.export.error');
      setErrorMsg(msg);
      toastError(msg);
      return;
    }
    // Déclenche un téléchargement JSON côté navigateur (best-effort).
    try {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lead-pii-${leadId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      success(t('privacy.lead.export.success'));
    } catch {
      const msg = t('privacy.lead.export.error');
      setErrorMsg(msg);
      toastError(msg);
    }
  };

  const handleForget = async () => {
    setErrorMsg(null);
    const ok = await confirm({
      title: t('privacy.lead.forget.confirm.title'),
      description: t('privacy.lead.forget.confirm.desc'),
      requireText: confirmLabel,
      confirmLabel: t('privacy.lead.forget.confirm.cta'),
      cancelLabel: t('privacy.lead.forget.confirm.cancel'),
      danger: true,
    });
    if (!ok) return;
    setIsForgetting(true);
    const res = await forgetLead(leadId);
    setIsForgetting(false);
    if (res.error || !res.data?.success) {
      const msg = res.error || t('privacy.lead.forget.error');
      setErrorMsg(msg);
      toastError(msg);
      return;
    }
    success(t('privacy.lead.forget.success'));
    onForgotten?.();
  };

  return (
    <Card className="p-4" aria-busy={busy}>
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
        {t('privacy.lead.title')}
      </h3>
      <p className="text-[10px] text-[var(--text-muted)] leading-snug mb-3">
        {t('privacy.lead.subtitle')}
      </p>

      {errorMsg && (
        <p role="alert" className="text-xs text-[var(--danger)] mb-3 leading-snug">
          {errorMsg}
        </p>
      )}

      <div className="space-y-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full justify-center"
          disabled={busy}
          aria-busy={isExporting}
          onClick={() => void handleExport()}
        >
          <Icon as={Download} size={13} className="mr-1.5" />
          {isExporting ? t('privacy.lead.export.loading') : t('privacy.lead.export.action')}
        </Button>

        <Button
          size="sm"
          className="w-full justify-center bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)]"
          disabled={busy}
          aria-busy={isForgetting}
          onClick={() => void handleForget()}
        >
          <Icon as={ShieldOff} size={13} className="mr-1.5" />
          {isForgetting ? t('privacy.lead.forget.loading') : t('privacy.lead.forget.action')}
        </Button>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] leading-snug mt-2">
        {t('privacy.lead.forget.help')}
      </p>
    </Card>
  );
}
