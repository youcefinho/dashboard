import { PublicLayout } from './PublicLayout';
import { Button } from '@/components/ui/Button';
import { Calendar, Mail, Clock, Users } from 'lucide-react';

export function DemoPage() {
  return (
    <PublicLayout>
      <div className="relative pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto overflow-hidden">
        {/* Orbs */}
        <div className="hero-stat-orb absolute w-[700px] h-[700px] rounded-full -top-80 left-1/2 -translate-x-1/2 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.10) 50%, transparent 75%)', filter: 'blur(80px)' }} />

        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full text-xs font-semibold"
            style={{
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(0,157,219,0.2)',
              boxShadow: '0 4px 16px -4px rgba(0,157,219,0.15)',
            }}>
            <Calendar size={12} className="text-[var(--brand-primary)]" />
            <span className="text-[var(--text-secondary)]">Démo 30 minutes · 100% gratuite</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 leading-[1.05]" style={{ letterSpacing: '-0.03em' }}>
            Réservez votre <span className="text-gradient-brand">démo</span>
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
            Découvrez comment Intralys peut transformer la gestion de votre PME avec un expert produit québécois.
          </p>
        </div>

        {/* 3 reassurance points */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 max-w-3xl mx-auto">
          {[
            { icon: Clock, label: '30 min', sub: 'Démo personnalisée' },
            { icon: Users, label: 'Expert FR', sub: 'Conseiller québécois' },
            { icon: Mail, label: 'Sans engagement', sub: 'Aucune carte requise' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3 p-4 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, #FFFFFF 0%, #F0FAFE 100%)',
                border: '1px solid rgba(0,157,219,0.2)',
                boxShadow: '0 1px 2px rgba(0,157,219,0.06), 0 4px 12px -4px rgba(0,157,219,0.12)',
              }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #009DDB 0%, #0086C0 100%)', boxShadow: '0 2px 8px rgba(0,157,219,0.4)' }}>
                <item.icon size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--text-primary)]">{item.label}</p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Calendly embed card */}
        <div className="relative rounded-2xl p-8 text-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.18)',
          }}>
          <div aria-hidden className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none opacity-60"
            style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.20) 0%, rgba(0,157,219,0.12) 50%, transparent 75%)', filter: 'blur(40px)' }} />

          <div className="relative aspect-video rounded-xl mb-8 flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #FAFBFC 0%, #F0FAFE 100%)',
              border: '1px dashed rgba(0,157,219,0.3)',
            }}>
            <div className="text-center">
              <Calendar size={48} className="mx-auto mb-3 text-[var(--brand-primary)] opacity-50" />
              <p className="text-[var(--text-muted)] font-medium">Widget Calendly d'Intralys</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Choisissez votre créneau ci-dessus</p>
            </div>
          </div>

          <Button variant="premium" size="lg" className="w-full sm:w-auto px-8 h-14 text-base" onClick={() => window.location.href = 'mailto:rochdi@intralys.com'}>
            <Mail size={16} className="mr-2" /> Contacter par courriel
          </Button>
          <p className="text-xs text-[var(--text-muted)] mt-4">Réponse sous 4h (jours ouvrables)</p>
        </div>
      </div>
    </PublicLayout>
  );
}
