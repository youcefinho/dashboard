import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { Check, ChevronRight, Upload, Building, Palette, Settings, UserPlus, HelpCircle, X } from 'lucide-react';
import { toast } from 'sonner';

interface OnboardingWizardProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 8;

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Business info state
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [teamSize, setTeamSize] = useState('1');

  // Branding state
  const [primaryColor, setPrimaryColor] = useState('#009DDB');
  
  // Pack state
  const [selectedPack, setSelectedPack] = useState('pack-generic-b2b');

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
      onComplete();
    } catch (e) {
      toast.error("Erreur lors de la sauvegarde.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={() => {}} title="" hideCloseButton={true}>
      <div className="w-[600px] max-w-full">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-[var(--text-muted)] mb-2 font-medium">
            <span>Étape {step} sur {TOTAL_STEPS}</span>
            <span>{Math.round((step / TOTAL_STEPS) * 100)}% complété</span>
          </div>
          <div className="w-full h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[var(--brand-primary)] rounded-full transition-all duration-300 ease-out"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="min-h-[300px] mb-8">
          {step === 1 && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Check size={32} />
              </div>
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
                Bienvenue, {user?.name?.split(' ')[0] || 'Rochdi'} 👋
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
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-lg">
                  <Building size={20} />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Parlez-nous de votre entreprise</h2>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Nom de l'entreprise</label>
                  <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Ex: Agence Tremblay" className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--brand-primary)]" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Type d'industrie</label>
                  <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--brand-primary)]">
                    <option value="">Sélectionnez une industrie...</option>
                    <option value="real-estate">Courtage immobilier</option>
                    <option value="local-services">Services locaux (Plomberie, Ménage...)</option>
                    <option value="health">Santé & Mieux-être (Dentiste, Massage...)</option>
                    <option value="coaching">Coaching & Consulting</option>
                    <option value="generic-b2b">Autre (Générique B2B)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Taille de l'équipe</label>
                  <div className="flex gap-2">
                    {['1', '2-5', '6-15', '16+'].map(size => (
                      <button key={size} onClick={() => setTeamSize(size)} className={`flex-1 py-2 text-sm font-medium rounded-[var(--radius-sm)] border transition-colors ${teamSize === size ? 'bg-[var(--brand-tint)] text-[var(--brand-primary)] border-[var(--brand-primary)]' : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)] hover:border-[var(--border-hover)]'}`}>
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
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-lg">
                  <Palette size={20} />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Personnalisez votre CRM</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">Couleur principale</label>
                  <div className="flex flex-wrap gap-3">
                    {['#009DDB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B', '#0F172A'].map(color => (
                      <button key={color} onClick={() => setPrimaryColor(color)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${primaryColor === color ? 'ring-2 ring-offset-2 ring-[var(--brand-primary)]' : ''}`} style={{ backgroundColor: color }}>
                        {primaryColor === color && <Check size={16} className="text-white" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">Logo de l'entreprise</label>
                  <div className="border-2 border-dashed border-[var(--border-default)] rounded-xl p-6 text-center hover:border-[var(--brand-primary)] hover:bg-[var(--brand-tint)] transition-colors cursor-pointer group">
                    <div className="w-12 h-12 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-white group-hover:text-[var(--brand-primary)] transition-colors">
                      <Upload size={20} />
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
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-lg">
                  <Settings size={20} />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Pack Industrie Recommandé</h2>
              </div>
              
              <p className="text-[var(--text-secondary)] mb-6">
                Basé sur votre industrie, nous avons préconfiguré un ensemble de champs, pipelines et automatisations adaptés à votre métier.
              </p>

              <div className="bg-[var(--brand-tint)] border border-[var(--brand-primary)]/20 rounded-xl p-5 mb-4">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-[var(--brand-primary)] text-lg mb-1">Pack Courtage Immobilier</h3>
                    <p className="text-sm text-[var(--brand-primary)]/80">Optimisé pour le marché québécois (OACIQ)</p>
                  </div>
                  <div className="px-2.5 py-1 bg-white/50 rounded-full text-xs font-semibold text-[var(--brand-primary)]">Recommandé</div>
                </div>
                <ul className="space-y-2 text-sm text-[var(--brand-primary)]/90">
                  <li className="flex items-center gap-2"><Check size={16} /> Pipeline Achat & Vente préconfiguré</li>
                  <li className="flex items-center gap-2"><Check size={16} /> Champs personnalisés (Budget, Quartier...)</li>
                  <li className="flex items-center gap-2"><Check size={16} /> 3 automatisations de relance SMS/Email</li>
                  <li className="flex items-center gap-2"><Check size={16} /> Modèles d'emails conformes Loi 25</li>
                </ul>
              </div>

              <button onClick={() => toast.success("Pack installé avec succès !")} className="w-full py-3 bg-white border border-[var(--border-default)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] text-[var(--text-primary)] font-medium rounded-[var(--radius-sm)] transition-colors flex justify-center items-center gap-2 shadow-sm">
                <Settings size={18} />
                Installer le pack (Optionnel)
              </button>
            </div>
          )}

          {step === 5 && (
            <div className="animate-fade-in text-center py-6">
              <div className="w-16 h-16 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-6">
                <UserPlus size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Créons votre premier prospect (Lead)</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                Le moyen le plus rapide d'apprendre est de pratiquer. Ajoutons un prospect test pour voir comment Intralys gère le cycle de vie.
              </p>
              
              <div className="max-w-xs mx-auto space-y-4 text-left">
                <input type="text" placeholder="Nom complet" className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--brand-primary)]" />
                <input type="email" placeholder="Email" className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--brand-primary)]" />
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
                <UserPlus size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Invitez votre équipe</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                Collaborez avec vos agents et assistants. Vous pouvez aussi faire cette étape plus tard depuis les paramètres.
              </p>
              
              <div className="max-w-sm mx-auto flex gap-2">
                <input type="email" placeholder="adresse@email.com" className="flex-1 px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-[var(--radius-sm)] focus:outline-none focus:border-[var(--brand-primary)]" />
                <Button>Inviter</Button>
              </div>
            </div>
          )}

          {step === 8 && (
            <div className="animate-fade-in text-center py-8">
              <div className="w-20 h-20 bg-[var(--success)]/10 text-[var(--success)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Check size={40} />
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
            <Button onClick={handleNext} disabled={isSubmitting} className="min-w-[120px]">
              {step === TOTAL_STEPS ? (
                isSubmitting ? 'Finalisation...' : 'Commencer le tour'
              ) : (
                <span className="flex items-center gap-1">Suivant <ChevronRight size={16} /></span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
