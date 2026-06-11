import { PublicLayout } from './PublicLayout';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Shield, Sparkles, Zap, MessageSquare, TrendingUp, Globe } from 'lucide-react';
import { Icon } from '@/components/ui';

export function HomePage() {
  return (
    <PublicLayout>
      {/* Hero Section — Sprint 23 immersive marketing */}
      <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center overflow-hidden">
        {/* Orbs décoratifs marketing */}
        <div className="hero-stat-orb absolute w-[800px] h-[800px] rounded-full -top-80 left-1/2 -translate-x-1/2 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.10) 40%, transparent 70%)', filter: 'blur(80px)' }} />
        <div className="hero-stat-orb absolute w-[400px] h-[400px] rounded-full top-40 -right-40 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(circle, rgba(55,202,55,0.12) 0%, transparent 70%)', filter: 'blur(60px)', animationDelay: '3s' }} />

        {/* Pill badge social proof */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full text-xs font-semibold"
          style={{
            background: 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,157,219,0.2)',
            boxShadow: '0 4px 16px -4px rgba(0,157,219,0.15)',
          }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#37CA37', boxShadow: '0 0 6px rgba(55,202,55,0.6)' }} />
          <span className="text-[var(--text-secondary)]">CRM #1 des PMEs québécoises</span>
          <span className="text-[var(--primary)]">→</span>
        </div>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 leading-[1.05]" style={{ letterSpacing: '-0.03em' }}>
          Le CRM tout-en-un pensé pour les{' '}
          <span className="text-gradient-brand">PMEs francophones</span>
        </h1>
        <p className="text-lg md:text-xl text-[var(--text-secondary)] mb-10 max-w-3xl mx-auto leading-relaxed">
          Arrêtez de jongler entre 5 outils différents. Intralys centralise vos leads, vos communications, vos calendriers et vos factures en une seule plateforme simple et puissante.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link to="/demo">
            <Button variant="premium" size="lg" className="w-full sm:w-auto text-base px-8 h-14">Démarrer l'essai gratuit de 14j</Button>
          </Link>
          <Link to="/pricing">
            <Button variant="secondary" size="lg" className="w-full sm:w-auto text-base px-8 h-14">Voir les tarifs</Button>
          </Link>
        </div>
        <p className="mt-4 text-sm text-[var(--text-muted)]">✓ Aucune carte de crédit requise · ✓ Annulez à tout moment · ✓ Support FR québécois</p>
        
        {/* Screenshot mock */}
        <div className="mt-16 rounded-2xl border border-[var(--border-subtle)] shadow-2xl overflow-hidden bg-[var(--bg-subtle)] p-2 max-w-5xl mx-auto">
          <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] px-4 py-3 flex gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <div className="w-3 h-3 rounded-full bg-green-400"></div>
            </div>
            <div className="aspect-[16/9] bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
               {/* Un mock visuel du dashboard (image placeholder) */}
               <div className="w-full h-full bg-[var(--bg-surface)] rounded-lg shadow-sm border border-[var(--border-subtle)] flex p-4 gap-4">
                  <div className="w-48 bg-[var(--bg-subtle)] rounded hidden md:block"></div>
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="h-20 bg-[var(--bg-subtle)] rounded"></div>
                    <div className="flex-1 bg-[var(--bg-subtle)] rounded"></div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-[var(--bg-subtle)] border-t border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">Pourquoi choisir Intralys ?</h2>
            <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">Des fonctionnalités pensées pour accélérer votre croissance, sans la complexité des CRM traditionnels.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Icon as={Shield} size={24} className="text-emerald-500" />}
              title="Conformité Loi 25 & CASL"
              description="Hébergement local, gestion du consentement et politique de confidentialité intégrée nativement pour les PMEs québécoises."
            />
            <FeatureCard 
              icon={<Icon as={Sparkles} size={24} className="text-amber-500" />}
              title="IA Haiku 4.5"
              description="Assistant IA qui comprend le contexte québécois, qualifie vos leads et rédige vos courriels avec le bon ton."
            />
            <FeatureCard 
              icon={<Icon as={Zap} size={24} className="text-blue-500" />}
              title="Packs Industrie"
              description="Ne partez pas de zéro. Installez en 1 clic des pipelines, champs et emails préconfigurés pour votre métier."
            />
            <FeatureCard 
              icon={<Icon as={MessageSquare} size={24} className="text-purple-500" />}
              title="Boîte de réception unifiée"
              description="SMS, Courriels, Webchat, WhatsApp, Facebook, Instagram. Tous vos messages clients au même endroit."
            />
            <FeatureCard 
              icon={<Icon as={TrendingUp} size={24} className="text-rose-500" />}
              title="Workflows & Automatisations"
              description="Automatisez vos suivis, relances et rappels de rendez-vous avec un constructeur visuel puissant et simple."
            />
            <FeatureCard 
              icon={<Icon as={Globe} size={24} className="text-cyan-500" />}
              title="Bilingue FR/EN"
              description="Interface et communications entièrement bilingues. Servez vos clients dans la langue de leur choix sans effort."
            />
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">Ils nous font confiance</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <TestimonialCard 
              quote="Intralys a remplacé 4 outils qu'on payait séparément. C'est simple, c'est en français, et le support est exceptionnel."
              author="Marc Tremblay"
              role="Courtier Immobilier"
            />
            <TestimonialCard 
              quote="La boîte de réception unifiée a changé notre façon de communiquer. On ne perd plus aucun prospect Facebook."
              author="Sophie Dubois"
              role="Clinique Dentaire"
            />
            <TestimonialCard 
              quote="Les automatisations SMS nous ont permis de réduire les no-shows de 40% en deux semaines."
              author="Jean-Philippe Roy"
              role="Propriétaire, Garage Roy"
            />
          </div>
        </div>
      </section>

      {/* CTA Bottom Sprint 23 — gradient + orbs */}
      <section className="relative py-24 text-white text-center overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #009DDB 0%, #0086C0 50%, #D96E27 100%)' }}>
        <div className="absolute inset-0 pointer-events-none opacity-30">
          <div className="hero-stat-orb absolute w-[600px] h-[600px] rounded-full -top-40 -left-40"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -bottom-32 -right-32"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 70%)', filter: 'blur(60px)', animationDelay: '4s' }} />
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 z-10">
          <h2 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight" style={{ letterSpacing: '-0.02em' }}>
            Prêt à transformer votre entreprise ?
          </h2>
          <p className="text-white/90 text-lg mb-10 leading-relaxed">Rejoignez des centaines de PMEs qui utilisent Intralys pour générer plus de ventes avec moins d'effort.</p>
          <Link to="/demo">
            <Button size="lg" className="bg-[var(--bg-surface)] text-[var(--primary)] hover:bg-[var(--bg-subtle)] px-10 h-14 text-lg font-bold shadow-[0_8px_32px_rgba(0,0,0,0.2)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.25)] transition-all hover:scale-[1.02]">
              Démarrer gratuitement
            </Button>
          </Link>
          <p className="mt-4 text-sm text-white/70">✓ 14 jours gratuits · ✓ Sans engagement · ✓ Support inclus</p>
        </div>
      </section>
    </PublicLayout>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="group relative bg-[var(--bg-surface)] p-6 rounded-2xl border border-[var(--border-subtle)] transition-all duration-300 hover:-translate-y-1 overflow-hidden"
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)' }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,157,219,0.06), 0 16px 40px -8px rgba(0,157,219,0.22)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)'; }}>
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.15) 0%, transparent 70%)', filter: 'blur(20px)' }} />
      <div className="relative w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{
          background: 'linear-gradient(135deg, #FFFFFF 0%, #F0FAFE 100%)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 2px rgba(0,157,219,0.06), 0 0 16px rgba(0,157,219,0.08)',
        }}>
        {icon}
      </div>
      <h3 className="relative text-lg font-bold text-[var(--text-primary)] mb-2 tracking-tight">{title}</h3>
      <p className="relative text-[var(--text-secondary)] text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function TestimonialCard({ quote, author, role }: { quote: string, author: string, role: string }) {
  return (
    <div className="relative p-8 rounded-2xl transition-all duration-300 hover:-translate-y-1 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)',
      }}>
      {/* Quote mark décoratif */}
      <div aria-hidden className="absolute top-2 right-4 text-7xl font-bold leading-none pointer-events-none opacity-15"
        style={{
          background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>"</div>
      <div className="relative flex gap-1 mb-4">
        {[...Array(5)].map((_, i) => (
          <svg key={i} className="w-5 h-5" viewBox="0 0 20 20" style={{ filter: 'drop-shadow(0 1px 2px rgba(255,154,0,0.4))' }}>
            <defs>
              <linearGradient id={`star-${i}-${author.replace(/\s/g, '')}`} x1="0" y1="0" x2="20" y2="20">
                <stop offset="0%" stopColor="#FF9A00" />
                <stop offset="100%" stopColor="#D96E27" />
              </linearGradient>
            </defs>
            <path fill={`url(#star-${i}-${author.replace(/\s/g, '')})`} d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
      <p className="relative text-[var(--text-secondary)] font-medium mb-6 leading-relaxed">"{quote}"</p>
      <div className="relative flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{
            background: `linear-gradient(135deg, #009DDB 0%, #D96E27 100%)`,
            boxShadow: '0 2px 8px rgba(0,157,219,0.3)',
          }}>
          {author.charAt(0)}
        </div>
        <div>
          <div className="font-bold text-[var(--text-primary)] text-sm">{author}</div>
          <div className="text-[var(--text-muted)] text-xs">{role}</div>
        </div>
      </div>
    </div>
  );
}
