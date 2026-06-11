import React, { useState, lazy, Suspense } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth';
import { Check, ChevronRight, Upload, Building, Palette, Settings, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

// Sprint 24 vague 5B — lazy load du tour interactif (step 8 = "Commencer le tour")
const InteractiveTour = lazy(() =>
  import('@/components/onboarding/InteractiveTour').then((m) => ({ default: m.InteractiveTour }))
);

// ── Sprint 24 vague 4B — Industries (Combobox, anticipe 20+ futures) ──
// LOT C — label/description résolus AU RENDER via t('onboarding.ind_*') ;
// value→clé : '-' → '_'. icon emoji inchangé.
const INDUSTRY_BASE: Array<{ value: string; icon: string }> = [
  { value: 'real-estate', icon: '🏘️' },
  { value: 'local-services', icon: '🔧' },
  { value: 'health', icon: '🩺' },
  { value: 'coaching', icon: '💼' },
  { value: 'beauty', icon: '💅' },
  { value: 'fitness', icon: '🏋️' },
  { value: 'legal', icon: '⚖️' },
  { value: 'accounting', icon: '📊' },
  { value: 'restaurant', icon: '🍽️' },
  { value: 'education', icon: '🎓' },
  { value: 'automotive', icon: '🚗' },
  { value: 'construction', icon: '🏗️' },
  { value: 'agency', icon: '📣' },
  { value: 'photo-video', icon: '📸' },
  { value: 'events', icon: '🎉' },
  { value: 'tech', icon: '💻' },
  { value: 'finance', icon: '🏦' },
  { value: 'nonprofit', icon: '🤝' },
  { value: 'retail', icon: '🛍️' },
  { value: 'generic-b2b', icon: '🏢' },
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

  // LOT C — options industrie localisées au render (value→clé : '-' → '_')
  const industryOptions: ComboboxOption[] = INDUSTRY_BASE.map((o) => {
    const k = `onboarding.ind_${o.value.replace(/-/g, '_')}`;
    return { value: o.value, icon: o.icon, label: t(k), description: t(`${k}_d`) };
  });

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(s => s + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    toast.info(t('onboarding.wiz_skip_info'));
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
      toast.success(t('onboarding.wiz_done'));
      // Sprint 24 vague 5B — au lieu de juste fermer, déclenche le tour interactif
      setTourOpen(true);
    } catch (e) {
      toast.error(t('onboarding.wiz_save_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Sprint 24 vague 5B — Modal cachée quand le tour démarre (sinon overlap visuel avec Coachmark) */}
      <Modal open={!tourOpen} onOpenChange={(open) => { if (!open && !tourOpen) onComplete(); }} title={t('onboarding.wiz_title')}>
      <div className="w-[600px] max-w-full">
        {/* Progress Ring + Step Dots — Sprint Deep 5A */}
        <div className="flex flex-col items-center mb-8">
          <div className="progress-ring-wrap">
            <svg viewBox="0 0 80 80">
              <circle className="progress-ring-bg" cx="40" cy="40" r="36" />
              <circle
                className="progress-ring-fill"
                cx="40" cy="40" r="36"
                strokeDasharray={`${(step / TOTAL_STEPS) * 226.2} 226.2`}
              />
            </svg>
            <span className="progress-ring-text">{step}/{TOTAL_STEPS}</span>
          </div>
          <div className="step-dots">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <React.Fragment key={i}>
                {i > 0 && <div className={`step-connector ${i < step ? 'is-done' : ''}`} />}
                <div className={`step-dot ${i + 1 < step ? 'is-done' : i + 1 === step ? 'is-active' : ''}`} />
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content — animation slide Sprint Deep 5A */}
        <div className="min-h-[300px] mb-8 step-content-enter" key={step}>
          {step === 1 && (
            <div className="text-center animate-stagger stagger-1">
              <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{
                  background: 'var(--primary)',
                  boxShadow: 'var(--shadow-md)',
                }}>
                <Icon as={Check} size={36} className="text-white" strokeWidth={3} />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4">
                <span className="text-gradient-brand">{t('onboarding.wiz_welcome')}</span>, {user?.name?.split(' ')[0] || t('onboarding.wiz_default_name')} 👋
              </h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                {t('onboarding.wiz_welcome_body')}
              </p>
              
              <div className="aspect-video bg-[var(--bg-subtle)] rounded-xl border border-[var(--border-subtle)] flex items-center justify-center mb-6 relative overflow-hidden group">
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-12 h-12 bg-[var(--bg-surface)]/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white">
                    <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </div>
                <span className="text-[var(--text-muted)]">{t('onboarding.wiz_founder_word')}</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-stagger stagger-1">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg">
                  <Icon as={Building} size="lg" />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('onboarding.wiz_company_title')}</h2>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">{t('onboarding.wiz_company_name')}</label>
                  <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={t('onboarding.wiz_company_name_ph')} className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border)] rounded-[var(--radius-md)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-ring)]" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">{t('onboarding.wiz_industry_label')}</label>
                  {/* Sprint 24 vague 4B — Combobox autocomplete (anticipe 20+ industries) */}
                  <Combobox
                    options={industryOptions}
                    value={businessType}
                    onChange={setBusinessType}
                    placeholder={t('onboarding.wiz_industry_search')}
                    ariaLabel={t('onboarding.wiz_industry_label')}
                    emptyLabel={t('onboarding.wiz_industry_empty')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">{t('onboarding.wiz_team_size')}</label>
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
            <div className="animate-stagger stagger-1">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg">
                  <Icon as={Palette} size="lg" />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('onboarding.wiz_customize_title')}</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">{t('onboarding.wiz_primary_color')}</label>
                  <div className="flex flex-wrap gap-3">
                    {['#009DDB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B', '#0F172A'].map(color => (
                      <button key={color} onClick={() => setPrimaryColor(color)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${primaryColor === color ? 'ring-2 ring-offset-2 ring-[var(--primary)]' : ''}`} style={{ backgroundColor: color }}>
                        {primaryColor === color && <Icon as={Check} size="md" className="text-white" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">{t('onboarding.wiz_logo')}</label>
                  <div className="border-2 border-dashed border-[var(--border-default)] rounded-xl p-6 text-center hover:border-[var(--primary)] hover:bg-[var(--brand-tint)] transition-colors cursor-pointer group">
                    <div className="w-12 h-12 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-[var(--bg-surface)] group-hover:text-[var(--primary)] transition-colors">
                      <Icon as={Upload} size="lg" />
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{t('onboarding.wiz_upload_click')}</p>
                    <p className="text-xs text-[var(--text-muted)]">{t('onboarding.wiz_upload_hint')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="animate-stagger stagger-1">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg">
                  <Icon as={Settings} size="lg" />
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('onboarding.wiz_pack_title')}</h2>
              </div>

              <p className="text-[var(--text-secondary)] mb-6">
                {t('onboarding.wiz_pack_desc')}
              </p>

              <div className="bg-[var(--brand-tint)] border border-[var(--primary)]/20 rounded-xl p-5 mb-4">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-[var(--primary)] text-lg mb-1">{t('onboarding.wiz_pack_name')}</h3>
                    <p className="text-sm text-[var(--primary)]/80">{t('onboarding.wiz_pack_sub')}</p>
                  </div>
                  <div className="px-2.5 py-1 bg-[var(--bg-surface)]/50 rounded-full text-xs font-semibold text-[var(--primary)]">{t('onboarding.wiz_pack_recommended')}</div>
                </div>
                <ul className="space-y-2 text-sm text-[var(--primary)]/90">
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> {t('onboarding.wiz_pack_f1')}</li>
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> {t('onboarding.wiz_pack_f2')}</li>
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> {t('onboarding.wiz_pack_f3')}</li>
                  <li className="flex items-center gap-2"><Icon as={Check} size="md" /> {t('onboarding.wiz_pack_f4')}</li>
                </ul>
              </div>

              <button onClick={() => toast.success(t('onboarding.wiz_pack_installed'))} className="w-full py-3 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] text-[var(--text-primary)] font-medium rounded-[var(--radius-md)] transition-all flex justify-center items-center gap-2 hover:shadow-[var(--shadow-sm)] hover:-translate-y-0.5">
                <Icon as={Settings} size={18} />
                {t('onboarding.wiz_pack_install_btn')}
              </button>
            </div>
          )}

          {step === 5 && (
            <div className="animate-stagger stagger-1 text-center py-6">
              <div className="w-16 h-16 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Icon as={UserPlus} size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t('onboarding.wiz_lead_title')}</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                {t('onboarding.wiz_lead_desc')}
              </p>

              <div className="max-w-xs mx-auto space-y-4 text-left">
                <input type="text" placeholder={t('onboarding.wiz_fullname_ph')} className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border)] rounded-[var(--radius-md)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-ring)]" />
                <input type="email" placeholder={t('onboarding.wiz_email_ph')} className="w-full px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border)] rounded-[var(--radius-md)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-ring)]" />
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="animate-stagger stagger-1">
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t('onboarding.wiz_emails_title')}</h2>
              <p className="text-[var(--text-secondary)] mb-6">
                {t('onboarding.wiz_emails_desc')}
              </p>

              <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 mb-4 shadow-sm text-center">
                <div className="font-medium text-[var(--text-primary)] mb-2">{t('onboarding.wiz_resend')}</div>
                <p className="text-sm text-[var(--text-muted)] mb-4">{t('onboarding.wiz_resend_desc')}</p>
                <Button variant="secondary" className="w-full">{t('onboarding.wiz_gen_dns')}</Button>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="animate-stagger stagger-1 text-center py-6">
              <div className="w-16 h-16 bg-[var(--bg-muted)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Icon as={UserPlus} size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t('onboarding.wiz_team_title')}</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                {t('onboarding.wiz_team_desc')}
              </p>

              <div className="max-w-sm mx-auto flex gap-2">
                <input type="email" placeholder={t('onboarding.wiz_invite_email_ph')} className="flex-1 px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border)] rounded-[var(--radius-md)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-ring)]" />
                <Button>{t('onboarding.wiz_invite')}</Button>
              </div>
            </div>
          )}

          {step === 8 && (
            <div className="animate-stagger stagger-1 text-center py-8">
              <div className="w-20 h-20 bg-[var(--success)]/10 text-[var(--success)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Icon as={Check} size={40} />
              </div>
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">{t('onboarding.wiz_ready_title')}</h2>
              <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
                {t('onboarding.wiz_ready_desc')}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-6 border-t border-[var(--border-subtle)]">
          <button onClick={handleSkip} className="skip-step-btn">
            {t('onboarding.wiz_skip_step')}
          </button>

          <div className="flex gap-3">
            {step > 1 && (
              <Button variant="secondary" onClick={() => setStep(s => s - 1)}>
                {t('onboarding.wiz_prev')}
              </Button>
            )}
            <Button variant="premium" onClick={handleNext} disabled={isSubmitting} className="min-w-[120px]">
              {step === TOTAL_STEPS ? (
                isSubmitting ? t('onboarding.wiz_finalizing') : t('onboarding.wiz_start_tour')
              ) : (
                <span className="flex items-center gap-1">{t('onboarding.wiz_next')} <Icon as={ChevronRight} size="md" /></span>
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
