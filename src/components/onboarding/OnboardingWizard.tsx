import { useState, lazy, Suspense } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth';
import { Check, ChevronRight, Upload, Building, Palette, Settings, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

// Sprint 24 vague 5B — lazy load du tour interactif (step 8 = "Commencer le tour")
const InteractiveTour = lazy(() =>
  import('@/components/onboarding/InteractiveTour').then((m) => ({ default: m.InteractiveTour }))
);

// ── Sprint 24 vague 4B — Industries (Combobox, anticipe 20+ futures) ──
const INDUSTRY_OPTIONS: ComboboxOption[] = [
  { value: 'real-estate', label: 'Courtage immobilier', icon: '🏘️', description: 'Agents, courtiers, agences immo' },
  { value: 'local-services', label: 'Services locaux', icon: '🔧', description: 'Plomberie, ménage, électricité…' },
  { value: 'health', label: 'Santé & Mieux-être', icon: '🩺', description: 'Dentiste, massage, physio, naturo' },
  { value: 'coaching', label: 'Coaching & Consulting', icon: '💼', description: 'Coach business, vie, consultant' },
  { value: 'beauty', label: 'Beauté & Esthétique', icon: '💅', description: 'Salon, esthéticienne, spa' },
  { value: 'fitness', label: 'Fitness & Sport', icon: '🏋️', description: 'Gym, coach sportif, studio yoga' },
  { value: 'legal', label: 'Services juridiques', icon: '⚖️', description: 'Avocats, notaires, médiateurs' },
  { value: 'accounting', label: 'Comptabilité & Fiscalité', icon: '📊', description: 'CPA, fiscaliste, paie' },
  { value: 'restaurant', label: 'Restauration & Bouche', icon: '🍽️', description: 'Resto, traiteur, food truck' },
  { value: 'education', label: 'Éducation & Formation', icon: '🎓', description: 'École, tuteur, formateur en ligne' },
  { value: 'automotive', label: 'Automobile', icon: '🚗', description: 'Garage, vente, esthétique auto' },
  { value: 'construction', label: 'Construction & Rénovation', icon: '🏗️', description: 'Entrepreneur général, rénovateur' },
  { value: 'agency', label: 'Agence marketing / digital', icon: '📣', description: 'Marketing, SEO, web, design' },
  { value: 'photo-video', label: 'Photographie & Vidéo', icon: '📸', description: 'Photographe événements, vidéaste' },
  { value: 'events', label: 'Événementiel', icon: '🎉', description: 'Planificateur mariages, événements' },
  { value: 'tech', label: 'Tech & SaaS', icon: '💻', description: 'Startup tech, SaaS, dev' },
  { value: 'finance', label: 'Finance & Assurance', icon: '🏦', description: 'Conseiller financier, assureur' },
  { value: 'nonprofit', label: 'OBNL / Communautaire', icon: '🤝', description: 'Organisme sans but lucratif' },
  { value: 'retail', label: 'Commerce de détail', icon: '🛍️', description: 'Boutique, e-commerce, distribution' },
  { value: 'generic-b2b', label: 'Autre (Générique B2B)', icon: '🏢', description: 'Toute autre activité B2B' },
];

interface OnboardingWizardProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 8;

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sprint 24 vague 5B — déclenche le tour interactif après step 8 ("Commencer le tour")
  const [tourOpen, setTourOpen] = useState(false);

  // Form state
  const [businessName, setBusinessName] = useState(user?.name ? `${user.name} Inc.` : '');
  const [businessType, setBusinessType] = useState('real-estate');
  const [teamSize, setTeamSize] = useState('1');
  const [primaryColor, setPrimaryColor] = useState('#009DDB');
  
  // Pack state
  const [selectedPack] = useState('pack-generic-b2b');

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(s => s + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    toast.info("Onboarding ignoré. Vous pouvez le reprendre plus tard.");
    onComplete();
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('intralys_token')}`
        },
        body: JSON.stringify({
          businessName, businessType, teamSize, primaryColor, packSlug: selectedPack
        })
      });
      toast.success("Configuration terminée ! Bienvenue dans Intralys.");
      // Sprint 24 vague 5B — au lieu de juste fermer, déclenche le tour interactif
      setTourOpen(true);
    } catch (e) {
      toast.error("Erreur lors de la sauvegarde.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Sprint 24 vague 5B — Modal cachée quand le tour démarre (sinon overlap visuel avec Coachmark) */}
      <Modal open={!tourOpen} onOpenChange={(open) => { if (!open && !tourOpen) onComplete(); }} title="Bienvenue sur Intralys">
      <div className="w-[600px] max-w-full">
        {/* Progress Bar Sprint 23 — gradient + glow */}
        <div className="mb-8">
          <div className="flex justify-between text-xs mb-2 font-semibold">
            <span className="text-[var(--primary)]">Étape {step} sur {TOTAL_STEPS}</span>
            <span className="text-[var(--text-muted)] tabular-nums">{Math.round((step / TOTAL_STEPS) * 100)}% complété</span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,157,219,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${(step / TOTAL_STEPS) * 100}%`,
                background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
                boxShadow: '0 0 12px rgba(0,157,219,0.5), 0 0 6px rgba(217,110,39,0.4)',
              }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="min-h-[300px] mb-8">
          {step === 1 && (
            <div className="text-center animate-fade-in">
              <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{
                  background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                  boxShadow: '0 8px 32px rgba(0,157,219,0.45), 0 0 40px rgba(217,110,39,0.3)',
                  animation: 'hot-lead-pulse 3s ease-in-out infinite',
                }}>
                <Icon as={Check} size={36} className="text-white" strokeWidth={3} />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4">
                <span className="text-gradient-brand">Bienvenue</span>, {user?.name?.split(' ')[0] || 'Rochdi'} 👋
              </h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                Nous sommes ravis de vous accueillir dans Intralys CRM. Prenons 2 minutes pour configurer votre compte afin de vous offrir la meilleure expérience possible.
              </p>
              
              <div className="aspect-video bg-[var(--bg-subtle)] rounded-xl border border-[var(--border-subtle)] flex items-center justify-center mb-6 relative overflow-hidden group">
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white">
                    <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </div>
                <span className="text-[var(--text-muted)]">Mot du fondateur (30s)</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg">
                  <Icon as={Building} size="lg" />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Parlez-nous de votre entreprise</h2>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Nom de l'entreprise</label>
                  <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Ex: Agence Tremblay" className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--primary)]" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Type d'industrie</label>
                  {/* Sprint 24 vague 4B — Combobox autocomplete (anticipe 20+ industries) */}
                  <Combobox
                    options={INDUSTRY_OPTIONS}
                    value={businessType}
                    onChange={setBusinessType}
                    placeholder="Cherchez votre industrie..."
                    ariaLabel="Type d'industrie"
                    emptyLabel="Aucune industrie trouvée"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Taille de l'équipe</label>
                  <div className="flex gap-2">
                    {['1', '2-5', '6-15', '16+'].map(size => (
                      <button key={size} onClick={() => setTeamSize(size)} className={`flex-1 py-2 text-sm font-medium rounded-[var(--radius-sm)] border transition-colors ${teamSize === size ? 'bg-[var(--brand-tint)] text-[var(--primary)] border-[var(--primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)] hover:border-[var(--border-hover)]'}`}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg">
                  <Icon as={Palette} size="lg" />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Personnalisez votre CRM</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">Couleur principale</label>
                  <div className="flex flex-wrap gap-3">
                    {['#009DDB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B', '#0F172A'].map(color => (
                      <button key={color} onClick={() => setPrimaryColor(color)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${primaryColor === color ? 'ring-2 ring-offset-2 ring-[var(--primary)]' : ''}`} style={{ backgroundColor: color }}>
                        {primaryColor === color && <Icon as={Check} size="md" className="text-white" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">Logo de l'entreprise</label>
                  <div className="border-2 border-dashed border-[var(--border-default)] rounded-xl p-6 text-center hover:border-[var(--primary)] hover:bg-[var(--brand-tint)] transition-colors cursor-pointer group">
                    <div className="w-12 h-12 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-white group-hover:text-[var(--primary)] transition-colors">
                      <Icon as={Upload} size="lg" />
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Cliquez pour uploader</p>
                    <p className="text-xs text-[var(--text-muted)]">PNG, JPG ou SVG (max 2MB)</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg">
                  <Icon as={Settings} size="lg" />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Pack Industrie Recommandé</h2>
              </div>
              
              <p className="text-[var(--text-secondary)] mb-6">
                Basé sur votre industrie, nous avons préconfiguré un ensemble de champs, pipelines et automatisations adaptés à votre métier.
              </p>

              <div className="bg-[var(--brand-tint)] border border-[var(--primary)]/20 rounded-xl p-5 mb-4">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-[var(--primary)] text-lg mb-1">Pack Courtage Immobilier</h3>
                    <p className="text-sm text-[var(--primary)]/80">Optimisé pour le marché québécois (OACIQ)</p>
                  </div>
                  <div className="px-2.5 py-1 bg-white/50 rounded-full text-xs font-semibold text-[var(--primary)]">Recommandé</div>
                </div>
                <ul className="space-y-2 text-sm text-[var(--primary)]/90">
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> Pipeline Achat & Vente préconfiguré</li>
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> Champs personnalisés (Budget, Quartier...)</li>
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> 3 automatisations de relance SMS/Email</li>
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> Modèles d'emails conformes Loi 25</li>
                </ul>
              </div>

              <button onClick={() => toast.success("Pack installé avec succès !")} className="w-full py-3 bg-white border border-[var(--border-default)] hover:border-[var(--primary)] hover:text-[var(--primary)] text-[var(--text-primary)] font-medium rounded-[var(--radius-sm)] transition-all flex justify-center items-center gap-2 shadow-[var(--shadow-brand-xs)] hover:shadow-[var(--shadow-brand-md)] hover:-translate-y-0.5">
                <Icon as={Settings} size={18} />
                Installer le pack (Optionnel)
              </button>
            </div>
          )}

          {step === 5 && (
            <div className="animate-fade-in text-center py-6">
              <div className="w-16 h-16 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Icon as={UserPlus} size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Créons votre premier prospect (Lead)</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                Le moyen le plus rapide d'apprendre est de pratiquer. Ajoutons un prospect test pour voir comment Intralys gère le cycle de vie.
              </p>
              
              <div className="max-w-xs mx-auto space-y-4 text-left">
                <input type="text" placeholder="Nom complet" className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--primary)]" />
                <input type="email" placeholder="Email" className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--primary)]" />
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Connecter vos courriels</h2>
              <p className="text-[var(--text-secondary)] mb-6">
                Intralys a besoin de se connecter à votre adresse email pour envoyer des campagnes et notifications automatiques de la part de votre domaine.
              </p>
              
              <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 mb-4 shadow-sm text-center">
                <div className="font-medium text-[var(--text-primary)] mb-2">Connexion Resend / SMTP</div>
                <p className="text-sm text-[var(--text-muted)] mb-4">Configuration technique requise (DNS)</p>
                <Button variant="secondary" className="w-full">Générer les enregistrements DNS</Button>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="animate-fade-in text-center py-6">
              <div className="w-16 h-16 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Icon as={UserPlus} size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Invitez votre équipe</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                Collaborez avec vos agents et assistants. Vous pouvez aussi faire cette étape plus tard depuis les paramètres.
              </p>
              
              <div className="max-w-sm mx-auto flex gap-2">
                <input type="email" placeholder="adresse@email.com" className="flex-1 px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--primary)]" />
                <Button>Inviter</Button>
              </div>
            </div>
          )}

          {step === 8 && (
            <div className="animate-fade-in text-center py-8">
              <div className="w-20 h-20 bg-[var(--success)]/10 text-[var(--success)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Icon as={Check} size={40} />
              </div>
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">Tout est prêt !</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                Votre CRM est configuré. Prêt à faire un rapide tour du propriétaire pour découvrir les fonctionnalités clés ?
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-6 border-t border-[var(--border-subtle)]">
          <button onClick={handleSkip} className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            Ignorer cette étape
          </button>
          
          <div className="flex gap-3">
            {step > 1 && (
              <Button variant="secondary" onClick={() => setStep(s => s - 1)}>
                Précédent
              </Button>
            )}
            <Button variant="premium" onClick={handleNext} disabled={isSubmitting} className="min-w-[120px]">
              {step === TOTAL_STEPS ? (
                isSubmitting ? 'Finalisation...' : 'Commencer le tour'
              ) : (
                <span className="flex items-center gap-1">Suivant <Icon as={ChevronRight} size="md" /></span>
              )}
            </Button>
          </div>
        </div>
      </div>
      </Modal>
      {/* Sprint 24 vague 5B — Tour interactif post-onboarding */}
      {tourOpen && (
        <Suspense fallback={null}>
          <InteractiveTour
            open={tourOpen}
            onClose={() => {
              setTourOpen(false);
              onComplete();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
