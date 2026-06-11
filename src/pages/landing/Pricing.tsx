import { PublicLayout } from './PublicLayout';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/Tag';
import { KpiStrip } from '@/components/ui/KpiStrip';
import { Check, Sparkles, Users, Zap, ShieldCheck } from 'lucide-react';
import { Icon } from '@/components/ui';

interface Plan {
  name: string;
  description: string;
  price: string;
  features: string[];
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Starter',
    description: 'Pour les solos et petites équipes qui démarrent.',
    price: '47',
    features: ['Jusqu\'à 1,000 contacts', '2 utilisateurs inclus', 'Boîte de réception (Email + Web)', '1 Pack Industrie au choix', 'Calendrier basique'],
  },
  {
    name: 'Pro',
    description: 'Pour les entreprises en croissance qui veulent automatiser.',
    price: '97',
    features: ['Jusqu\'à 10,000 contacts', '5 utilisateurs inclus', 'Boîte de réception Omnicanal (SMS, FB, IG)', 'Workflows illimités & IA basique', 'Devis et Facturation'],
    popular: true,
  },
  {
    name: 'Business',
    description: 'Pour les agences et grandes équipes avec besoins avancés.',
    price: '197',
    features: ['Contacts illimités', 'Utilisateurs illimités', 'Accès API complet', 'Support prioritaire (SLA 4h)', 'IA avancée (Haiku 4.5)'],
  },
];

export function PricingPage() {
  return (
    <PublicLayout>
      <div className="relative pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto overflow-hidden">
        {/* Orbs marketing */}
        <div className="hero-stat-orb absolute w-[700px] h-[700px] rounded-full -top-72 left-1/2 -translate-x-1/2 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(circle, rgba(99,91,255,0.16) 0%, rgba(139,92,246,0.10) 50%, transparent 75%)', filter: 'blur(80px)' }} />

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full text-xs font-semibold"
            style={{
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(99,91,255,0.2)',
              boxShadow: '0 4px 16px -4px rgba(99,91,255,0.15)',
            }}>
            <Icon as={Sparkles} size={12} className="text-[var(--primary)]" />
            <span className="text-[var(--text-secondary)]">14 jours gratuits sur tous les plans</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 leading-[1.05]" style={{ letterSpacing: '-0.03em' }}>
            Des tarifs <span className="text-gradient-brand">simples</span> et transparents
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            Pas de frais cachés. Annulez quand vous voulez. Tout ce dont vous avez besoin pour faire croître votre PME.
          </p>
        </div>

        {/* KpiStrip header — preuve sociale (Sprint 23 wave 41) */}
        <div className="max-w-5xl mx-auto mb-10">
          <KpiStrip
            items={[
              { label: 'PMEs Québec', value: 220, color: 'brand', icon: <Icon as={Users} size={12} /> },
              { label: 'Intégrations natives', value: 18, color: 'info', icon: <Icon as={Zap} size={12} /> },
              { label: 'Conformité Loi 25', value: '100%', color: 'success', icon: <Icon as={ShieldCheck} size={12} /> },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {PLANS.map(plan => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </div>

        <div className="text-center mt-16">
          <p className="text-sm text-[var(--text-muted)]">
            Besoin d'un plan custom (white-label, multi-marques) ? <Link to="/demo" className="text-[var(--primary)] font-semibold hover:underline">Parlons-en →</Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}

function PricingCard({ plan }: { plan: Plan }) {
  const isPopular = plan.popular;
  return (
    <div
      className="card-premium p-8 flex flex-col"
      style={
        isPopular
          ? {
              background: 'linear-gradient(135deg, #FFFFFF 0%, #F0EFFE 50%, #EDE9FE 100%)',
              borderColor: 'rgba(99,91,255,0.55)',
              borderWidth: '1.5px',
              boxShadow:
                '0 1px 2px rgba(99,91,255,0.08), 0 24px 64px -12px rgba(99,91,255,0.32), 0 0 40px -8px rgba(139,92,246,0.18)',
              // Permet au badge "LE PLUS POPULAIRE" de dépasser au-dessus de la card
              overflow: 'visible',
            }
          : undefined
      }
    >
      {/* Orb décoratif sur plan populaire */}
      {isPopular && (
        <div aria-hidden className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none opacity-60"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.25) 0%, rgba(99,91,255,0.15) 50%, transparent 75%)', filter: 'blur(40px)' }} />
      )}

      {/* Badge populaire — Tag brand solid (wave 41) */}
      {isPopular && (
        <div className="absolute top-0 right-4 -translate-y-1/2 z-10">
          <Tag variant="brand" solid size="sm" className="tracking-wider">
            ★ LE PLUS POPULAIRE
          </Tag>
        </div>
      )}

      <div className="relative">
        <h3 className={`text-xl font-bold mb-2 ${isPopular ? 'text-gradient-brand' : 'text-[var(--text-primary)]'}`}>
          {plan.name}
        </h3>
        <p className="text-[var(--text-muted)] text-sm mb-6 leading-relaxed">{plan.description}</p>
        <div className="mb-6">
          <span className={`text-5xl font-extrabold tabular-nums ${isPopular ? 'text-gradient-brand' : 'text-[var(--text-primary)]'}`}
            style={{ letterSpacing: '-0.02em' }}>
            {plan.price}<span className="text-2xl">$</span>
          </span>
          <span className="text-[var(--text-muted)] ml-1">/mois</span>
        </div>
        <Link to="/demo" className="block mb-8">
          <Button variant={isPopular ? 'premium' : 'secondary'} className="w-full" size="lg">
            Commencer l'essai
          </Button>
        </Link>
        <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
          {plan.features.map((f, i) => (
            <li key={i} className="flex items-start gap-3">
              {/* Check disk gradient brand (wave 41) */}
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
                  boxShadow: '0 2px 6px -1px rgba(99,91,255,0.40), 0 0 10px -2px rgba(139,92,246,0.28)',
                }}>
                <Icon as={Check} size={12} className="text-white" strokeWidth={3} />
              </div>
              <span className="leading-relaxed">{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
