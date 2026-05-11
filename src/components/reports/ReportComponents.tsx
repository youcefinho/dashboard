import { Card } from '@/components/ui';

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

export function ActivityReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Activité des Agents</h3><p className="text-sm text-[var(--text-muted)]">Nombre d'appels, emails envoyés, tâches complétées.</p></Card>;
}

export function WorkflowReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Performances Workflows</h3><p className="text-sm text-[var(--text-muted)]">Inscriptions, complétions, abandons par workflow.</p></Card>;
}

export function EmailReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Statistiques Emails</h3><p className="text-sm text-[var(--text-muted)]">Taux d'ouverture, de clics, de rebond, désabonnements.</p></Card>;
}

export function SmsReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Statistiques SMS</h3><p className="text-sm text-[var(--text-muted)]">Taux de livraison, réponses, erreurs.</p></Card>;
}

export function CalendarReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Rendez-vous</h3><p className="text-sm text-[var(--text-muted)]">Rendez-vous pris, confirmés, annulés, no-shows.</p></Card>;
}

export function FormsReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Formulaires & Quiz</h3><p className="text-sm text-[var(--text-muted)]">Vues, soumissions, taux de conversion.</p></Card>;
}

export function ReviewsReports() {
  return <Card className="p-5"><h3 className="text-sm font-semibold mb-4">Réputation</h3><p className="text-sm text-[var(--text-muted)]">Avis Google générés, note moyenne, taux de réponse.</p></Card>;
}
