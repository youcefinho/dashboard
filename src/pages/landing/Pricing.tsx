import { PublicLayout } from './PublicLayout';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Check } from 'lucide-react';

export function PricingPage() {
  return (
    <PublicLayout>
      <div className="pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-extrabold text-[var(--text-primary)] mb-4">Des tarifs simples et transparents</h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Pas de frais cachés. Annulez quand vous voulez. Tout ce dont vous avez besoin pour faire croître votre PME.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Starter */}
          <div className="bg-white rounded-2xl border border-[var(--border-subtle)] shadow-sm p-8 flex flex-col">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Starter</h3>
            <p className="text-[var(--text-muted)] text-sm mb-6">Pour les solos et petites équipes qui démarrent.</p>
            <div className="mb-6">
              <span className="text-4xl font-extrabold text-[var(--text-primary)]">47$</span>
              <span className="text-[var(--text-muted)]">/mois</span>
            </div>
            <Link to="/demo" className="mt-auto mb-8">
              <Button variant="secondary" className="w-full">Commencer l'essai</Button>
            </Link>
            <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Jusqu'à 1,000 contacts</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> 2 utilisateurs inclus</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Boîte de réception (Email + Web)</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> 1 Pack Industrie au choix</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Calendrier basique</li>
            </ul>
          </div>

          {/* Pro */}
          <div className="bg-white rounded-2xl border-2 border-[var(--brand-primary)] shadow-md p-8 flex flex-col relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--brand-primary)] text-white text-xs font-bold px-3 py-1 rounded-full">
              LE PLUS POPULAIRE
            </div>
            <h3 className="text-xl font-bold text-[var(--brand-primary)] mb-2">Pro</h3>
            <p className="text-[var(--text-muted)] text-sm mb-6">Pour les entreprises en croissance qui veulent automatiser.</p>
            <div className="mb-6">
              <span className="text-4xl font-extrabold text-[var(--text-primary)]">97$</span>
              <span className="text-[var(--text-muted)]">/mois</span>
            </div>
            <Link to="/demo" className="mt-auto mb-8">
              <Button className="w-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/90 text-white">Commencer l'essai</Button>
            </Link>
            <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Jusqu'à 10,000 contacts</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> 5 utilisateurs inclus</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Boîte de réception Omnicanal (SMS, FB, IG)</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Workflows illimités & IA basique</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Devis et Facturation</li>
            </ul>
          </div>

          {/* Business */}
          <div className="bg-white rounded-2xl border border-[var(--border-subtle)] shadow-sm p-8 flex flex-col">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Business</h3>
            <p className="text-[var(--text-muted)] text-sm mb-6">Pour les agences et grandes équipes avec besoins avancés.</p>
            <div className="mb-6">
              <span className="text-4xl font-extrabold text-[var(--text-primary)]">197$</span>
              <span className="text-[var(--text-muted)]">/mois</span>
            </div>
            <Link to="/demo" className="mt-auto mb-8">
              <Button variant="secondary" className="w-full">Commencer l'essai</Button>
            </Link>
            <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Contacts illimités</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Utilisateurs illimités</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Accès API complet</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> Support prioritaire (SLA 4h)</li>
              <li className="flex items-start gap-3"><Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> IA avancée (Haiku 4.5)</li>
            </ul>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
