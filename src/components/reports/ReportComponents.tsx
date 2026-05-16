// ── ReportComponents — Stubs reports (Sprint 23 wave 40) ──
// Chacun = mini-dashboard avec KpiStrip + Sparkline + EmptyState "bientôt"

import { Card, KpiStrip, Sparkline, EmptyState, EmptyStateIllustration, type KpiItem, Icon } from '@/components/ui';
import {
  Activity,
  Workflow,
  Mail,
  MessageSquare,
  CalendarCheck,
  ClipboardList,
  Star,
} from 'lucide-react';

export function SalesReports({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function FunnelReports({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function SourcesReports({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function PerformanceReports({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function TrendsReports({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

// ── Helper — mini-dashboard skeleton réutilisable ──
function ReportStub({
  title,
  icon,
  kpis,
  sparkData,
}: {
  title: string;
  icon: React.ReactNode;
  kpis: KpiItem[];
  sparkData: number[];
}) {
  return (
    <div className="space-y-4">
      <KpiStrip items={kpis} />
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--primary)]"
              style={{
                background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)',
              }}
            >
              {icon}
            </span>
            {title} — tendance 7 derniers jours
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Aperçu
          </span>
        </div>
        <div className="h-[88px] flex items-center">
          <Sparkline data={sparkData} color="brand" width={520} height={80} className="w-full" />
        </div>
      </Card>
      <EmptyState
        icon={<EmptyStateIllustration kind="reports" size={72} />}
        title="Rapport détaillé bientôt disponible"
        description={`Le module ${title.toLowerCase()} sera enrichi avec graphiques drill-down et exports CSV dans une prochaine itération.`}
      />
    </div>
  );
}

export function ActivityReports() {
  return (
    <ReportStub
      title="Activité des Agents"
      icon={<Icon as={Activity} size={14} />}
      kpis={[
        { label: 'Appels', value: '—', color: 'brand' },
        { label: 'Emails envoyés', value: '—', color: 'info' },
        { label: 'Tâches complétées', value: '—', color: 'success' },
      ]}
      sparkData={[4, 6, 5, 8, 7, 9, 6]}
    />
  );
}

export function WorkflowReports() {
  return (
    <ReportStub
      title="Performances Workflows"
      icon={<Icon as={Workflow} size={14} />}
      kpis={[
        { label: 'Inscriptions', value: '—', color: 'brand' },
        { label: 'Complétions', value: '—', color: 'success' },
        { label: 'Abandons', value: '—', color: 'danger' },
      ]}
      sparkData={[3, 5, 4, 7, 6, 8, 5]}
    />
  );
}

export function EmailReports() {
  return (
    <ReportStub
      title="Statistiques Emails"
      icon={<Icon as={Mail} size={14} />}
      kpis={[
        { label: 'Taux d\'ouverture', value: '—', color: 'brand' },
        { label: 'Taux de clic', value: '—', color: 'accent' },
        { label: 'Rebonds', value: '—', color: 'danger' },
      ]}
      sparkData={[2, 4, 3, 6, 5, 7, 4]}
    />
  );
}

export function SmsReports() {
  return (
    <ReportStub
      title="Statistiques SMS"
      icon={<Icon as={MessageSquare} size={14} />}
      kpis={[
        { label: 'Livrés', value: '—', color: 'success' },
        { label: 'Réponses', value: '—', color: 'brand' },
        { label: 'Erreurs', value: '—', color: 'danger' },
      ]}
      sparkData={[5, 6, 4, 8, 7, 9, 6]}
    />
  );
}

export function CalendarReports() {
  return (
    <ReportStub
      title="Rendez-vous"
      icon={<Icon as={CalendarCheck} size={14} />}
      kpis={[
        { label: 'Pris', value: '—', color: 'brand' },
        { label: 'Confirmés', value: '—', color: 'success' },
        { label: 'No-shows', value: '—', color: 'danger' },
      ]}
      sparkData={[1, 3, 2, 5, 4, 6, 3]}
    />
  );
}

export function FormsReports() {
  return (
    <ReportStub
      title="Formulaires & Quiz"
      icon={<Icon as={ClipboardList} size={14} />}
      kpis={[
        { label: 'Vues', value: '—', color: 'info' },
        { label: 'Soumissions', value: '—', color: 'brand' },
        { label: 'Taux conversion', value: '—', color: 'success' },
      ]}
      sparkData={[3, 4, 3, 6, 5, 7, 5]}
    />
  );
}

export function ReviewsReports() {
  return (
    <ReportStub
      title="Réputation"
      icon={<Icon as={Star} size={14} />}
      kpis={[
        { label: 'Avis générés', value: '—', color: 'accent' },
        { label: 'Note moyenne', value: '—', color: 'brand' },
        { label: 'Taux réponse', value: '—', color: 'success' },
      ]}
      sparkData={[2, 3, 3, 5, 4, 6, 5]}
    />
  );
}
