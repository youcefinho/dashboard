// ── WelcomeWizard — Sprint 45 M1.1 (2026-05-15) ──────────────────────────────
// Onboarding personnalisé 4 steps via la primitive <Wizard> (Sprint 26/30).
// Stripe-clean SUBTLE : no glow, no gradient massif sur surfaces, FR-QC informel.
//
// Steps :
//   1. Profile     — nom + email + photo upload + langue
//   2. Industrie   — grid 8 cards icon
//   3. Goals       — multi-select 5 objectifs
//   4. Team        — segmented control (Solo/2-5/6-20/20+) + invite emails optional
//                    + bouton "Commencer avec données démo"
//
// Trigger : `localStorage.getItem('onboarding_completed') !== '1'` (géré par parent).
// onComplete : POST /api/onboarding (best-effort) + localStorage set + Toast.
//
// Le composant gère son propre state ; AppLayout / parent fournit `open` + `onClose`.

import { useState, type ChangeEvent } from 'react';
import {
  Wizard,
  useToast,
  type WizardStep,
} from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import {
  User, Mail, Upload, Globe, Briefcase, Code, UtensilsCrossed,
  Sparkles, Scissors, Wrench, ShoppingBag, MoreHorizontal,
  Clock, TrendingUp, ListChecks, Zap, BarChart3,
  Users, Plus, X, Trash2,
} from 'lucide-react';
import { importDemoData } from '@/lib/demoData';
// Sprint E1 M2.4 — pré-activation module e-commerce selon le type d'activité
import { patchModule } from '@/lib/api';
import { announceSR } from '@/lib/announce';
import { cn } from '@/lib/cn';
// Sprint 48 M2.4 — sync langue wizard avec préférence i18n globale
import { getLocale, setLocale, type Locale } from '@/lib/i18n';

// ── Types ────────────────────────────────────────────────────────────────────

export type WelcomeLang = 'fr-CA' | 'fr-FR' | 'en' | 'es';
export type WelcomeIndustry = 'real-estate' | 'saas' | 'restaurant' | 'coaching' | 'beauty' | 'services' | 'retail' | 'other';
export type WelcomeGoal = 'save-time' | 'more-leads' | 'better-followup' | 'automate' | 'reporting';
export type WelcomeTeamSize = 'solo' | '2-5' | '6-20' | '20+';
// Sprint E1 M2.4 — type d'activité : pilote la pré-activation du module e-commerce
export type WelcomeBusinessType = 'crm' | 'shop' | 'hybrid';

export interface WelcomeProfile {
  name: string;
  email: string;
  photoDataUrl: string | null;
  lang: WelcomeLang;
}

export interface WelcomePayload {
  profile: WelcomeProfile;
  industry: WelcomeIndustry;
  /** Sprint E1 M2.4 — CRM / Boutique / Hybride (pré-active le module e-commerce) */
  businessType: WelcomeBusinessType;
  goals: WelcomeGoal[];
  teamSize: WelcomeTeamSize;
  invitedEmails: string[];
  withDemoData: boolean;
}

interface WelcomeWizardProps {
  open: boolean;
  /** Appelé après POST /api/onboarding réussi (ou fallback) + localStorage set. */
  onComplete: (payload: WelcomePayload) => void;
  /** Initiale email — généralement user.email */
  initialEmail?: string;
  /** Initiale name — généralement user.name */
  initialName?: string;
}

// ── Industries (8 cards) ─────────────────────────────────────────────────────

const INDUSTRIES: Array<{ id: WelcomeIndustry; label: string; icon: typeof Briefcase; description: string }> = [
  { id: 'real-estate', label: 'Immobilier', icon: Briefcase, description: 'Courtiers, agences' },
  { id: 'saas', label: 'SaaS / Tech', icon: Code, description: 'Logiciel, startup' },
  { id: 'restaurant', label: 'Restauration', icon: UtensilsCrossed, description: 'Resto, traiteur' },
  { id: 'coaching', label: 'Coaching', icon: Sparkles, description: 'Coach, consultant' },
  { id: 'beauty', label: 'Beauté', icon: Scissors, description: 'Salon, esthétique' },
  { id: 'services', label: 'Services', icon: Wrench, description: 'Plomberie, ménage' },
  { id: 'retail', label: 'Commerce', icon: ShoppingBag, description: 'Boutique, e-com' },
  { id: 'other', label: 'Autre', icon: MoreHorizontal, description: 'Autre activité' },
];

// ── Business types (Sprint E1 M2.4) ──────────────────────────────────────────
// "shop" et "hybrid" pré-activent le module e-commerce au onComplete.
const BUSINESS_TYPES: Array<{ id: WelcomeBusinessType; label: string; description: string; icon: typeof Briefcase }> = [
  { id: 'crm', label: 'CRM / Lead-gen', description: 'Capter et suivre des prospects', icon: TrendingUp },
  { id: 'shop', label: 'Boutique en ligne', description: 'Vendre des produits', icon: ShoppingBag },
  { id: 'hybrid', label: 'Les deux', description: 'CRM + boutique e-commerce', icon: Briefcase },
];

// ── Goals (5 multi-select) ───────────────────────────────────────────────────

const GOALS: Array<{ id: WelcomeGoal; label: string; icon: typeof Clock; description: string }> = [
  { id: 'save-time', label: 'Gagner du temps', icon: Clock, description: 'Moins de saisie, plus de ventes' },
  { id: 'more-leads', label: 'Plus de leads', icon: TrendingUp, description: 'Capter et qualifier mieux' },
  { id: 'better-followup', label: 'Meilleur suivi', icon: ListChecks, description: 'Ne jamais perdre un lead' },
  { id: 'automate', label: 'Automatiser', icon: Zap, description: 'Workflows, relances auto' },
  { id: 'reporting', label: 'Reporting', icon: BarChart3, description: 'Voir ce qui marche' },
];

// ── Team sizes ───────────────────────────────────────────────────────────────

const TEAM_SIZES: Array<{ id: WelcomeTeamSize; label: string }> = [
  { id: 'solo', label: 'Solo' },
  { id: '2-5', label: '2-5' },
  { id: '6-20', label: '6-20' },
  { id: '20+', label: '20+' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';
const ONBOARDING_PAYLOAD_KEY = 'onboarding_payload';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read fail'));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function WelcomeWizard({ open, onComplete, initialEmail = '', initialName = '' }: WelcomeWizardProps) {
  const toast = useToast();

  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Profile
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  // Sprint 48 M2.4 — initial sync sur locale détectée (auto-detect navigator au boot)
  const [lang, setLang] = useState<WelcomeLang>(() => {
    const current = getLocale();
    // Map locales supportées i18n → WelcomeLang (en-CA/en-US ramené à 'en')
    if (current === 'fr-CA' || current === 'fr-FR' || current === 'en' || current === 'es') {
      return current as WelcomeLang;
    }
    return 'fr-CA';
  });

  // Step 2 — Industry
  const [industry, setIndustry] = useState<WelcomeIndustry>('real-estate');
  // Sprint E1 M2.4 — type d'activité (défaut CRM : zéro changement comportement)
  const [businessType, setBusinessType] = useState<WelcomeBusinessType>('crm');

  // Step 3 — Goals
  const [goals, setGoals] = useState<WelcomeGoal[]>(['save-time', 'more-leads']);

  // Step 4 — Team + invites + demo data
  const [teamSize, setTeamSize] = useState<WelcomeTeamSize>('solo');
  const [inviteInput, setInviteInput] = useState('');
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);
  const [withDemoData, setWithDemoData] = useState(false);

  // ── Step changes : announce SR ─────────────────────────────────────────────
  const handleStepChange = (next: number) => {
    setStepIndex(next);
    const labels = ['Profil', 'Industrie', 'Objectifs', 'Équipe'];
    if (labels[next]) announceSR(`Étape ${next + 1} sur 4 : ${labels[next]}`, 'polite');
  };

  // ── Photo upload ────────────────────────────────────────────────────────────
  const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Photo trop lourde (max 2 Mo)');
      return;
    }
    try {
      const url = await readFileAsDataUrl(file);
      setPhotoDataUrl(url);
    } catch {
      toast.error('Impossible de lire la photo');
    }
  };

  // ── Invite emails ───────────────────────────────────────────────────────────
  const addInvite = () => {
    const v = inviteInput.trim();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      toast.error('Adresse courriel invalide');
      return;
    }
    if (invitedEmails.includes(v)) {
      setInviteInput('');
      return;
    }
    setInvitedEmails((prev) => [...prev, v]);
    setInviteInput('');
  };

  const removeInvite = (e: string) => {
    setInvitedEmails((prev) => prev.filter((x) => x !== e));
  };

  // ── Goals multi-select ──────────────────────────────────────────────────────
  const toggleGoal = (g: WelcomeGoal) => {
    setGoals((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  // ── Complete ────────────────────────────────────────────────────────────────
  const handleComplete = async () => {
    setSubmitting(true);

    // Sprint 48 M2.4 — persiste la langue choisie sans reload (parent va
    // afficher le toast + dismisser le wizard ; le reload eût été abrupt).
    try {
      if (lang === 'fr-CA' || lang === 'fr-FR' || lang === 'en' || lang === 'es') {
        const currentI18nLocale = getLocale();
        if (currentI18nLocale !== lang) {
          setLocale(lang as Locale, { reloadAfterChange: false });
        }
      }
    } catch {
      /* noop — langue persistée best-effort */
    }

    const payload: WelcomePayload = {
      profile: { name: name.trim(), email: email.trim(), photoDataUrl, lang },
      industry,
      businessType,
      goals,
      teamSize,
      invitedEmails,
      withDemoData,
    };

    // Sprint E1 M2.4 — pré-active le module e-commerce si Boutique/Hybride
    // (best-effort : un échec ne bloque jamais la fin de l'onboarding ;
    // l'admin pourra l'activer manuellement via Paramètres → Modules).
    if (businessType === 'shop' || businessType === 'hybrid') {
      try {
        await patchModule('ecommerce', true);
      } catch {
        /* non bloquant */
      }
    }

    // POST /api/onboarding best-effort
    try {
      const token = localStorage.getItem('intralys_token');
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      /* fallback localStorage seul */
    }

    // Local persistence
    try {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
      localStorage.setItem(
        ONBOARDING_PAYLOAD_KEY,
        JSON.stringify({ ...payload, profile: { ...payload.profile, photoDataUrl: null } }),
      );
      if (payload.profile.name) localStorage.setItem('profile_completed', '1');
    } catch { /* ignore */ }

    // Import demo data (background) si demandé
    if (withDemoData) {
      void importDemoData()
        .then((summary) => {
          toast.success(`Données démo importées (${summary.leads} leads, ${summary.tasks} tâches)`);
        })
        .catch(() => { /* déjà silent en interne */ });
    }

    toast.success('Bienvenue sur Intralys !', { hero: true });
    announceSR('Configuration terminée. Bienvenue sur Intralys.', 'assertive');

    setSubmitting(false);
    onComplete(payload);
  };

  // ── Steps definition ────────────────────────────────────────────────────────
  const steps: WizardStep[] = [
    {
      id: 'profile',
      label: 'Profil',
      icon: <Icon as={User} size={14} />,
      isValid: () => name.trim().length >= 2 && EMAIL_RE.test(email.trim()),
      content: (
        <div className="welcome-step-profile space-y-5 pt-1">
          <div>
            <h3 className="t-h2 mb-1">Faisons connaissance</h3>
            <p className="text-xs text-[var(--text-muted)]">
              On va personnaliser ton Intralys en 2 minutes. Promis, on garde ça simple.
            </p>
          </div>

          {/* Photo upload */}
          <div className="flex items-center gap-4">
            <label
              htmlFor="welcome-photo-input"
              className="welcome-photo-uploader"
              aria-label="Ajouter une photo de profil"
            >
              {photoDataUrl ? (
                <img src={photoDataUrl} alt="Photo de profil" />
              ) : (
                <Icon as={Upload} size={20} className="text-[var(--text-muted)]" />
              )}
            </label>
            <div className="flex-1">
              <input
                id="welcome-photo-input"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handlePhotoChange}
              />
              <label
                htmlFor="welcome-photo-input"
                className="text-xs font-semibold text-[var(--primary)] cursor-pointer hover:underline"
              >
                {photoDataUrl ? 'Remplacer la photo' : 'Ajouter une photo'}
              </label>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">PNG, JPG (max 2 Mo)</p>
            </div>
          </div>

          {/* Name */}
          <div className="welcome-form-row">
            <label htmlFor="welcome-name" className="welcome-label">
              <Icon as={User} size={12} /> Nom complet
            </label>
            <input
              id="welcome-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Émilie Tremblay"
              className="welcome-input"
              autoComplete="name"
            />
          </div>

          {/* Email */}
          <div className="welcome-form-row">
            <label htmlFor="welcome-email" className="welcome-label">
              <Icon as={Mail} size={12} /> Adresse courriel
            </label>
            <input
              id="welcome-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="emilie@maboite.ca"
              className="welcome-input"
              autoComplete="email"
            />
          </div>

          {/* Lang */}
          <div className="welcome-form-row">
            <label htmlFor="welcome-lang" className="welcome-label">
              <Icon as={Globe} size={12} /> Langue préférée
            </label>
            <select
              id="welcome-lang"
              value={lang}
              onChange={(e) => setLang(e.target.value as WelcomeLang)}
              className="welcome-input"
            >
              <option value="fr-CA">Français (Québec)</option>
              <option value="fr-FR">Français (France)</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
        </div>
      ),
    },
    {
      id: 'industry',
      label: 'Industrie',
      icon: <Icon as={Briefcase} size={14} />,
      isValid: () => Boolean(industry),
      content: (
        <div className="welcome-step-industry pt-1">
          <div className="mb-4">
            <h3 className="t-h2 mb-1">Dans quel domaine tu travailles ?</h3>
            <p className="text-xs text-[var(--text-muted)]">
              On va préconfigurer tes pipelines et tags selon ton industrie.
            </p>
          </div>
          <div className="welcome-industry-grid">
            {INDUSTRIES.map((ind) => {
              const active = industry === ind.id;
              return (
                <button
                  key={ind.id}
                  type="button"
                  onClick={() => setIndustry(ind.id)}
                  aria-pressed={active}
                  className={cn('welcome-industry-card', active && 'is-active')}
                >
                  <span className="welcome-industry-icon" aria-hidden>
                    <Icon as={ind.icon} size={18} />
                  </span>
                  <span className="welcome-industry-label">{ind.label}</span>
                  <span className="welcome-industry-desc">{ind.description}</span>
                </button>
              );
            })}
          </div>

          {/* Sprint E1 M2.4 — Type d'activité : pilote la pré-activation du
              module Boutique. Défaut "CRM" ⇒ comportement onboarding inchangé. */}
          <div className="mt-5">
            <p className="welcome-label mb-2">
              <Icon as={ShoppingBag} size={12} /> Type d'activité
            </p>
            <div
              className="welcome-team-segmented"
              role="radiogroup"
              aria-label="Type d'activité"
            >
              {BUSINESS_TYPES.map((bt) => {
                const active = businessType === bt.id;
                return (
                  <button
                    key={bt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setBusinessType(bt.id)}
                    title={bt.description}
                    className={cn('welcome-team-seg-btn', active && 'is-active')}
                  >
                    {bt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">
              {businessType === 'crm'
                ? 'CRM seul : leads, pipeline, automatisations.'
                : 'Le module Boutique sera activé. Tu pourras le gérer dans Paramètres → Modules.'}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'goals',
      label: 'Objectifs',
      icon: <Icon as={TrendingUp} size={14} />,
      isValid: () => goals.length > 0,
      content: (
        <div className="welcome-step-goals pt-1">
          <div className="mb-4">
            <h3 className="t-h2 mb-1">Qu'est-ce que tu veux atteindre ?</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Choisis tout ce qui s'applique. On adaptera tes recommandations.
            </p>
          </div>
          <div className="space-y-2">
            {GOALS.map((g) => {
              const active = goals.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGoal(g.id)}
                  aria-pressed={active}
                  className={cn('welcome-goal-row', active && 'is-active')}
                >
                  <span className="welcome-goal-check" aria-hidden>
                    {active ? <Icon as={ListChecks} size={14} strokeWidth={3} /> : <Icon as={g.icon} size={14} />}
                  </span>
                  <span className="flex-1 text-left">
                    <span className="welcome-goal-label">{g.label}</span>
                    <span className="welcome-goal-desc">{g.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ),
    },
    {
      id: 'team',
      label: 'Équipe',
      icon: <Icon as={Users} size={14} />,
      isValid: () => Boolean(teamSize),
      content: (
        <div className="welcome-step-team pt-1">
          <div className="mb-4">
            <h3 className="t-h2 mb-1">Combien vous êtes dans l'équipe ?</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Tu pourras toujours inviter d'autres membres plus tard depuis les Paramètres.
            </p>
          </div>

          {/* Segmented control */}
          <div className="welcome-team-segmented" role="radiogroup" aria-label="Taille de l'équipe">
            {TEAM_SIZES.map((t) => {
              const active = teamSize === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTeamSize(t.id)}
                  className={cn('welcome-team-seg-btn', active && 'is-active')}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Invite emails (optional) */}
          {teamSize !== 'solo' && (
            <div className="mt-5">
              <label htmlFor="welcome-invite" className="welcome-label">
                <Icon as={Mail} size={12} /> Inviter des membres (optionnel)
              </label>
              <div className="flex gap-2">
                <input
                  id="welcome-invite"
                  type="email"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addInvite();
                    }
                  }}
                  placeholder="collègue@maboite.ca"
                  className="welcome-input flex-1"
                />
                <button
                  type="button"
                  onClick={addInvite}
                  className="welcome-invite-btn"
                  aria-label="Ajouter cette invitation"
                >
                  <Icon as={Plus} size={14} strokeWidth={2.5} />
                </button>
              </div>
              {invitedEmails.length > 0 && (
                <ul className="welcome-invite-list" aria-label="Invitations en attente">
                  {invitedEmails.map((e) => (
                    <li key={e} className="welcome-invite-chip">
                      <span className="truncate">{e}</span>
                      <button
                        type="button"
                        onClick={() => removeInvite(e)}
                        aria-label={`Retirer ${e}`}
                      >
                        <Icon as={X} size={11} strokeWidth={2.5} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Demo data toggle */}
          <div className="welcome-demo-card mt-5">
            <div className="welcome-demo-card-head">
              <Icon as={Sparkles} size={14} className="text-[var(--primary)]" />
              <span className="font-semibold text-[13px] text-[var(--text-primary)]">
                Commencer avec des données démo
              </span>
            </div>
            <p className="text-[12px] text-[var(--text-muted)] leading-relaxed mt-1">
              20 leads, 10 tâches, 5 conversations et 3 pipelines préchargés pour explorer Intralys.
              Tu pourras tout effacer en un clic depuis les Paramètres.
            </p>
            <label className="welcome-demo-toggle mt-3">
              <input
                type="checkbox"
                checked={withDemoData}
                onChange={(e) => setWithDemoData(e.target.checked)}
              />
              <span className="welcome-demo-toggle-track" aria-hidden>
                <span className="welcome-demo-toggle-thumb" />
              </span>
              <span className="text-[12px] font-medium">
                {withDemoData ? 'Importer les données démo' : 'Importer les données démo'}
              </span>
            </label>
            {withDemoData && (
              <p className="text-[11px] text-[var(--primary)] mt-2 flex items-center gap-1">
                <Icon as={Trash2} size={10} />
                Bouton "Effacer données démo" dispo dans Paramètres.
              </p>
            )}
          </div>
        </div>
      ),
    },
  ];

  return (
    <Wizard
      open={open && !submitting}
      onOpenChange={() => { /* parent contrôle la fermeture via onComplete uniquement */ }}
      steps={steps}
      currentIndex={stepIndex}
      onStepChange={handleStepChange}
      onComplete={handleComplete}
      title="Bienvenue sur Intralys"
      description="Configure ton CRM en 4 étapes"
      completeLabel={withDemoData ? 'Importer + Commencer' : 'Commencer'}
      modal
    />
  );
}
