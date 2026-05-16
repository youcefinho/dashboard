// ── BillingSettings — Sprint 23 W32 : row-premium + DropdownMenu + KpiStrip
import {
  Card,
  Button,
  Tag,
  KpiStrip,
  DropdownMenu,
  DropdownMenuItem,
  Icon,
} from '@/components/ui';
import { CreditCard, DollarSign, Calendar, BarChart3, MoreVertical, Download, Mail } from 'lucide-react';

const HISTORY = [
  { id: 'inv-202605', date: '1 Mai 2026', amount: '99.00 $', status: 'Payé' },
  { id: 'inv-202604', date: '1 Avril 2026', amount: '99.00 $', status: 'Payé' },
  { id: 'inv-202603', date: '1 Mars 2026', amount: '99.00 $', status: 'Payé' },
];

export function BillingSettings() {
  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          { label: 'Plan actuel', value: 'Pro', color: 'brand', icon: <CreditCard size={12} /> },
          { label: 'MRR', value: '99 $', color: 'success', icon: <DollarSign size={12} /> },
          { label: 'Prochaine facture', value: '1 Juin', color: 'info', icon: <Calendar size={12} /> },
          { label: 'Usage emails', value: '84%', color: 'warning', icon: <BarChart3 size={12} /> },
        ]}
      />

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3">Plan actuel</h3>
            <p className="t-caption text-[var(--gray-500)]">Ton abonnement mensuel Intralys.</p>
          </div>
          <Tag variant="brand" size="sm">Pro · 99$/mois</Tag>
        </header>

        <div className="settings-usage-grid">
          <div className="settings-usage-meter">
            <p className="settings-usage-meter__label">Contacts</p>
            <p className="settings-usage-meter__value">
              1 245 <span className="settings-usage-meter__quota">/ 5 000</span>
            </p>
            <div className="settings-usage-meter__bar">
              <div className="settings-usage-meter__bar-fill settings-usage-meter__bar-fill--primary" style={{ width: '25%' }} />
            </div>
          </div>
          <div className="settings-usage-meter">
            <p className="settings-usage-meter__label">Courriels envoyés (mois)</p>
            <p className="settings-usage-meter__value">
              8 430 <span className="settings-usage-meter__quota">/ 10 000</span>
            </p>
            <div className="settings-usage-meter__bar">
              <div className="settings-usage-meter__bar-fill settings-usage-meter__bar-fill--warning" style={{ width: '84%' }} />
            </div>
          </div>
          <div className="settings-usage-meter">
            <p className="settings-usage-meter__label">SMS envoyés (mois)</p>
            <p className="settings-usage-meter__value">
              142 <span className="settings-usage-meter__quota">/ 500</span>
            </p>
            <div className="settings-usage-meter__bar">
              <div className="settings-usage-meter__bar-fill settings-usage-meter__bar-fill--info" style={{ width: '28%' }} />
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <Button variant="secondary">Gérer via Stripe</Button>
          <Button>Mettre à niveau</Button>
        </div>
      </Card>

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3">Historique de facturation</h3>
          <p className="t-caption text-[var(--gray-500)]">Les 12 derniers mois.</p>
        </header>
        <div className="space-y-2.5">
          {HISTORY.map((inv, idx) => (
            <div
              key={inv.id}
              className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
              style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{inv.date}</p>
                <p className="text-[11px] text-[var(--text-muted)] font-mono">#{inv.id}</p>
              </div>
              <div className="font-mono text-sm font-bold tabular-nums text-[var(--text-primary)] min-w-[80px] text-right">
                {inv.amount}
              </div>
              <Tag color="var(--success)" size="sm">{inv.status}</Tag>
              <DropdownMenu
                trigger={
                  <button
                    type="button"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                    aria-label="Actions"
                  >
                    <Icon as={MoreVertical} size={16} />
                  </button>
                }
              >
                <DropdownMenuItem leftIcon={<Icon as={Download} size={14} />}>Télécharger PDF</DropdownMenuItem>
                <DropdownMenuItem leftIcon={<Icon as={Mail} size={14} />}>Envoyer par email</DropdownMenuItem>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
