import { Card, Button, Badge } from '@/components/ui';

export function BillingSettings() {
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-base font-semibold">Plan Actuel</h3>
            <p className="text-sm text-[var(--text-muted)]">Votre abonnement mensuel Intralys</p>
          </div>
          <Badge color="var(--brand-primary)">Pro (99$/mois)</Badge>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-[var(--bg-subtle)] rounded-lg">
            <p className="text-xs text-[var(--text-muted)] mb-1">Contacts</p>
            <p className="text-xl font-bold">1,245 <span className="text-sm font-normal text-[var(--text-muted)]">/ 5,000</span></p>
            <div className="w-full bg-[var(--border-subtle)] h-1.5 rounded-full mt-2 overflow-hidden">
              <div className="bg-[var(--brand-primary)] h-full" style={{ width: '25%' }}></div>
            </div>
          </div>
          <div className="p-4 bg-[var(--bg-subtle)] rounded-lg">
            <p className="text-xs text-[var(--text-muted)] mb-1">Emails envoyés (Mois)</p>
            <p className="text-xl font-bold">8,430 <span className="text-sm font-normal text-[var(--text-muted)]">/ 10,000</span></p>
            <div className="w-full bg-[var(--border-subtle)] h-1.5 rounded-full mt-2 overflow-hidden">
              <div className="bg-[var(--warning)] h-full" style={{ width: '84%' }}></div>
            </div>
          </div>
          <div className="p-4 bg-[var(--bg-subtle)] rounded-lg">
            <p className="text-xs text-[var(--text-muted)] mb-1">SMS envoyés (Mois)</p>
            <p className="text-xl font-bold">142 <span className="text-sm font-normal text-[var(--text-muted)]">/ 500</span></p>
            <div className="w-full bg-[var(--border-subtle)] h-1.5 rounded-full mt-2 overflow-hidden">
              <div className="bg-[var(--info)] h-full" style={{ width: '28%' }}></div>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-3">
          <Button variant="secondary">Gérer via Stripe</Button>
          <Button>Mettre à niveau</Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-base font-semibold mb-4">Historique de facturation</h3>
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
            <tr>
              <th className="py-2">Date</th>
              <th className="py-2">Montant</th>
              <th className="py-2">Statut</th>
              <th className="py-2 text-right">Facture</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            <tr>
              <td className="py-3">1 Mai 2026</td>
              <td className="py-3">99.00 $</td>
              <td className="py-3"><Badge color="var(--success)">Payé</Badge></td>
              <td className="py-3 text-right"><Button variant="ghost" className="h-6 px-2 text-xs">PDF</Button></td>
            </tr>
            <tr>
              <td className="py-3">1 Avril 2026</td>
              <td className="py-3">99.00 $</td>
              <td className="py-3"><Badge color="var(--success)">Payé</Badge></td>
              <td className="py-3 text-right"><Button variant="ghost" className="h-6 px-2 text-xs">PDF</Button></td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
