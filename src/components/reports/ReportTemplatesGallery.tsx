// ── ReportTemplatesGallery — Onglet « Modèles » de Reports.tsx ──────────────
// LOT REPORT-TEMPLATES (Sprint 15) — Phase B Manager-C (front exclusif).
// Galerie de modèles de dashboard clonables : getReportTemplates() → cartes
// (nom, description, catégorie, badge système). « Utiliser ce modèle » →
// applyReportTemplate(id) → clone un dashboard côté worker (Manager-B) →
// navigue vers l'onglet builder (pas de route /dashboards/:id dédiée :
// les dashboards vivent dans l'onglet builder de /reports, ouverts via state).
// Helpers + type + clés i18n FIGÉS Phase A (api.ts / types.ts / reports.templates.*).
// SUBTLE Stripe-grade : réutilise Card / Tag / Button / EmptyState / Skeleton.
// ApiResponse INCHANGÉ → on lit `data` / `error` (jamais `code`).

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Card, Tag, Button, EmptyState, EmptyStateIllustration, Skeleton,
  useToast, Icon,
} from '@/components/ui';
import { getReportTemplates, applyReportTemplate } from '@/lib/api';
import type { ReportTemplate } from '@/lib/types';
import { t } from '@/lib/i18n';
import { LayoutGrid as LayoutIcon, Sparkles, Plus } from 'lucide-react';

export function ReportTemplatesGallery() {
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  // id du template en cours de clonage (désactive uniquement sa carte).
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getReportTemplates();
    // Best-effort : données absentes / erreur ⇒ liste vide, pas de crash.
    if (res.data) setTemplates(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleApply = async (tpl: ReportTemplate) => {
    setApplyingId(tpl.id);
    const res = await applyReportTemplate(tpl.id);
    setApplyingId(null);
    if (res.data?.dashboard_id) {
      success(t('reports.templates.applied'));
      // Le clone matérialise un dashboard borné tenant (Manager-B). Il n'existe
      // pas de route /dashboards/:id : les dashboards s'ouvrent dans l'onglet
      // builder de /reports (via state interne). On bascule donc sur le builder
      // où le dashboard fraîchement cloné apparaît dans la liste (loadDashboards
      // se relance à l'entrée de l'onglet).
      void navigate({ to: '/reports?view=builder' });
    } else {
      toastError(t('reports.toast.save_error'));
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 rounded-lg" />
        <div className="db-list-grid">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon as={LayoutIcon} size={15} className="text-[var(--primary)]" />
          {t('reports.templates.title')}
        </h3>
      </div>

      {templates.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            variant="first-time"
            illustration={<EmptyStateIllustration kind="reports" size={160} />}
            title={t('reports.templates.empty')}
            description={t('reports.templates.title')}
          />
        </Card>
      ) : (
        <div className="db-list-grid">
          {templates.map(tpl => (
            <Card key={tpl.id} className="db-list-card">
              <div className="db-list-card__head">
                <h4 className="db-list-card__title" title={tpl.name}>{tpl.name}</h4>
                {tpl.is_system === 1 && (
                  <Tag size="sm" variant="brand" className="inline-flex items-center gap-1">
                    <Icon as={Sparkles} size={11} /> {t('reports.templates.title')}
                  </Tag>
                )}
              </div>

              {tpl.description ? (
                <p className="db-list-card__meta">{tpl.description}</p>
              ) : null}

              {tpl.category ? (
                <div className="db-list-card__meta">
                  <Tag size="sm" variant="neutral">
                    {t('reports.templates.category')} : {tpl.category}
                  </Tag>
                </div>
              ) : null}

              <div className="db-list-card__actions">
                <Button
                  variant="primary"
                  onClick={() => handleApply(tpl)}
                  isLoading={applyingId === tpl.id}
                  disabled={applyingId !== null}
                  className="text-xs gap-1.5"
                >
                  <Icon as={Plus} size={14} /> {t('reports.templates.use_this')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
