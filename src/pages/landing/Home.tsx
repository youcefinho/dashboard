import { PublicLayout } from './PublicLayout';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { Shield, Sparkles, Zap, MessageSquare, TrendingUp, Globe } from 'lucide-react';

export function HomePage() {
  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="pt-24 pb-16 md:pt-32 md:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
        <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 tracking-tight mb-6 leading-tight">
          Le CRM tout-en-un pensé pour les <span className="text-[var(--brand-primary)]">PMEs francophones</span>
        </h1>
        <p className="text-lg md:text-xl text-slate-600 mb-10 max-w-3xl mx-auto">
          Arrêtez de jongler entre 5 outils différents. Intralys centralise vos leads, vos communications, vos calendriers et vos factures en une seule plateforme simple et puissante.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link to="/demo">
            <Button size="lg" className="w-full sm:w-auto text-base px-8 h-14">Démarrer l'essai gratuit de 14j</Button>
          </Link>
          <Link to="/pricing">
            <Button variant="secondary" size="lg" className="w-full sm:w-auto text-base px-8 h-14 bg-white border-slate-200">Voir les tarifs</Button>
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">Aucune carte de crédit requise. Annulez à tout moment.</p>
        
        {/* Screenshot mock */}
        <div className="mt-16 rounded-2xl border border-slate-200 shadow-2xl overflow-hidden bg-slate-50 p-2 max-w-5xl mx-auto">
          <div className="rounded-xl overflow-hidden border border-slate-100 bg-white">
            <div className="bg-slate-100 border-b border-slate-200 px-4 py-3 flex gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <div className="w-3 h-3 rounded-full bg-green-400"></div>
            </div>
            <div className="aspect-[16/9] bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
               {/* Un mock visuel du dashboard (image placeholder) */}
               <div className="w-full h-full bg-white rounded-lg shadow-sm border border-slate-100 flex p-4 gap-4">
                  <div className="w-48 bg-slate-50 rounded hidden md:block"></div>
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="h-20 bg-slate-50 rounded"></div>
                    <div className="flex-1 bg-slate-50 rounded"></div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-slate-50 border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Pourquoi choisir Intralys ?</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">Des fonctionnalités pensées pour accélérer votre croissance, sans la complexité des CRM traditionnels.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Shield className="text-emerald-500" />}
              title="Conformité Loi 25 & CASL"
              description="Hébergement local, gestion du consentement et politique de confidentialité intégrée nativement pour les PMEs québécoises."
            />
            <FeatureCard 
              icon={<Sparkles className="text-amber-500" />}
              title="IA Haiku 4.5"
              description="Assistant IA qui comprend le contexte québécois, qualifie vos leads et rédige vos courriels avec le bon ton."
            />
            <FeatureCard 
              icon={<Zap className="text-blue-500" />}
              title="Packs Industrie"
              description="Ne partez pas de zéro. Installez en 1 clic des pipelines, champs et emails préconfigurés pour votre métier."
            />
            <FeatureCard 
              icon={<MessageSquare className="text-purple-500" />}
              title="Boîte de réception unifiée"
              description="SMS, Courriels, Webchat, WhatsApp, Facebook, Instagram. Tous vos messages clients au même endroit."
            />
            <FeatureCard 
              icon={<TrendingUp className="text-rose-500" />}
              title="Workflows & Automatisations"
              description="Automatisez vos suivis, relances et rappels de rendez-vous avec un constructeur visuel puissant et simple."
            />
            <FeatureCard 
              icon={<Globe className="text-cyan-500" />}
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
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Ils nous font confiance</h2>
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

      {/* CTA Bottom */}
      <section className="bg-[var(--brand-primary)] py-20 text-white text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Prêt à transformer votre entreprise ?</h2>
          <p className="text-white/90 text-lg mb-10">Rejoignez des centaines de PMEs qui utilisent Intralys pour générer plus de ventes avec moins d'effort.</p>
          <Link to="/demo">
            <Button size="lg" className="bg-white text-[var(--brand-primary)] hover:bg-slate-50 px-8 h-14 text-lg">
              Démarrer gratuitement
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="w-12 h-12 bg-slate-50 rounded-lg flex items-center justify-center mb-4 border border-slate-100">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function TestimonialCard({ quote, author, role }: { quote: string, author: string, role: string }) {
  return (
    <div className="bg-slate-50 p-8 rounded-xl border border-slate-100">
      <div className="flex gap-1 text-amber-400 mb-4">
        {[...Array(5)].map((_, i) => <svg key={i} className="w-5 h-5 fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>)}
      </div>
      <p className="text-slate-700 font-medium mb-6">"{quote}"</p>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-slate-200 rounded-full"></div>
        <div>
          <div className="font-bold text-slate-900 text-sm">{author}</div>
          <div className="text-slate-500 text-xs">{role}</div>
        </div>
      </div>
    </div>
  );
}
