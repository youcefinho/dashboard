import { PublicLayout } from './PublicLayout';
import { Heart, Globe, Zap } from 'lucide-react';

export function AboutPage() {
  return (
    <PublicLayout>
      <div className="relative pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto overflow-hidden">
        <div className="hero-stat-orb absolute w-[600px] h-[600px] rounded-full -top-72 left-1/2 -translate-x-1/2 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.16) 0%, rgba(217,110,39,0.10) 50%, transparent 75%)', filter: 'blur(80px)' }} />

        <div className="text-center mb-16">
          <p className="heading-premium mb-3">Notre histoire</p>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-[1.05]" style={{ letterSpacing: '-0.03em' }}>
            À propos d'<span className="text-gradient-brand">Intralys</span>
          </h1>
          <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-2xl mx-auto">
            Intralys est née d'un constat simple : les PMEs francophones ont besoin d'outils puissants, mais les CRM existants (GoHighLevel, HubSpot, Salesforce) sont souvent trop complexes, trop chers, ou inadaptés à la réalité locale.
          </p>
        </div>

        {/* Valeurs en 3 colonnes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {[
            { icon: Heart, title: 'Local first', desc: 'Conçu au Québec pour les PMEs francophones. Loi 25 native, support FR, hébergement local.', color: '#E93D3D', dark: '#c92424' },
            { icon: Globe, title: '100% francophone', desc: 'Interface, AI, support, contrats : tout est pensé pour le marché québécois sans compromis.', color: '#009DDB', dark: '#0086C0' },
            { icon: Zap, title: 'Sans complexité', desc: 'Onboarding 5 minutes, packs industrie 1-clic. Une PME ne devrait pas avoir besoin d\'une équipe IT.', color: '#FF9A00', dark: '#D96E27' },
          ].map((v, i) => (
            <div
              key={v.title}
              className="card-premium list-item-enter p-6 text-center"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div
                aria-hidden
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none opacity-40"
                style={{
                  background: `radial-gradient(circle, ${v.color}26 0%, ${v.color}10 50%, transparent 75%)`,
                  filter: 'blur(28px)',
                }}
              />
              <div
                className="relative w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ background: `linear-gradient(135deg, ${v.color} 0%, ${v.dark} 100%)`, boxShadow: `0 4px 12px ${v.color}60` }}
              >
                <v.icon size={20} className="text-white" />
              </div>
              <h3 className="relative text-base font-bold text-[var(--text-primary)] mb-2 tracking-tight">{v.title}</h3>
              <p className="relative text-sm text-[var(--text-secondary)] leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>

        {/* Mission — avec orbs background décoratifs */}
        <div className="relative mb-16 max-w-3xl mx-auto">
          <div
            aria-hidden
            className="absolute -top-10 -left-20 w-72 h-72 rounded-full pointer-events-none opacity-50 -z-10"
            style={{
              background:
                'radial-gradient(circle, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.10) 50%, transparent 75%)',
              filter: 'blur(60px)',
            }}
          />
          <div
            aria-hidden
            className="absolute -bottom-10 -right-20 w-64 h-64 rounded-full pointer-events-none opacity-45 -z-10"
            style={{
              background:
                'radial-gradient(circle, rgba(217,110,39,0.22) 0%, rgba(0,157,219,0.10) 50%, transparent 75%)',
              filter: 'blur(60px)',
            }}
          />
          <p className="heading-premium mb-3 text-center">Notre mission</p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-6 text-center tracking-tight">
            Démocratiser l'automatisation pour les <span className="text-gradient-brand">PMEs locales</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] leading-relaxed text-center">
            Pour les courtiers, cliniques, coachs et entreprises de services locaux. Nous croyons qu'une PME ne devrait pas avoir besoin d'une équipe technique pour automatiser ses suivis et convertir ses leads.
          </p>
        </div>

        {/* L'équipe — card founder premium */}
        <div className="max-w-3xl mx-auto">
          <p className="heading-premium mb-3 text-center">L'équipe</p>
          <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-8 text-center tracking-tight">
            Au cœur du <span className="text-gradient-brand">projet</span>
          </h2>

          <div
            className="card-premium p-8 flex flex-col sm:flex-row gap-6 items-center"
            style={{
              background: 'linear-gradient(135deg, #FFFFFF 0%, #F0FAFE 50%, #FFF1DD 100%)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 16px 48px -12px rgba(0,157,219,0.22)',
            }}
          >
            <div aria-hidden className="absolute -top-12 -right-12 w-44 h-44 rounded-full pointer-events-none opacity-60"
              style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.22) 0%, rgba(0,157,219,0.14) 50%, transparent 75%)', filter: 'blur(40px)' }} />
            <div className="relative w-32 h-32 rounded-full shrink-0 flex items-center justify-center text-white font-bold text-4xl"
              style={{
                background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                boxShadow: '0 8px 32px rgba(0,157,219,0.45), 0 0 40px rgba(217,110,39,0.3)',
              }}>
              RD
            </div>
            <div className="relative">
              <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Rochdi Dahmani</h3>
              <p className="text-sm font-semibold mb-3" style={{
                background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>Fondateur & CEO</p>
              <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                Développeur et entrepreneur, Rochdi a créé Intralys pour offrir une alternative moderne, performante et 100% francophone aux solutions américaines complexes. Basé à Montréal.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
