// ── Landing — Sprint 47 M1 (Marketing Stripe-clean) ──────────────────────
// Refonte landing publique paradigme Stripe SUBTLE :
//   - Hero full-width clean, t-display clamp, dual CTA, trust bar logos
//   - Features grid 3-col, 6 cards iconisées, hover subtle (-2px shadow-md)
//   - Testimonials grid 6 cards FR québécois, auto-rotate carousel mobile
//   - CTA banner gradient brand SUBTLE (signature commerciale exclusive)
//   - Footer 5 cols complet (Logo+social, Produit, Ressources, Entreprise, Légal)
//   - Newsletter signup row + copyright FR québécois
//
// API publique : route `/` (remplace HomePage) — wired dans App.tsx.
// Aucun orb, no gradient brand massif (sauf banner CTA = signature exception).
// Append-only CSS Sprint 47 M1 — voir bloc dédié dans src/index.css.

import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Briefcase,
  CheckSquare,
  MessageSquare,
  BarChart3,
  Smartphone,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Play,
  X,
  Mail,
} from 'lucide-react';

// Icônes de marques sociales (retirées de lucide-react 1.x)
const FacebookIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>;
const LinkedinIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zm2-5a2 2 0 110 4 2 2 0 010-4z"/></svg>;
const InstagramIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5"/></svg>;
import { Button } from '@/components/ui/Button';
import { Icon, EmptyStateIllustration } from '@/components/ui';
import type { LucideIcon } from 'lucide-react';

// ── Data ────────────────────────────────────────────────────────────────

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: Briefcase,
    title: 'Leads & Pipeline',
    description: 'Gère tes prospects de la première rencontre à la signature, sans rien échapper.',
  },
  {
    icon: CheckSquare,
    title: 'Tâches & Calendrier',
    description: 'Suivi des rendez-vous, relances et échéances automatiques. Plus de post-its.',
  },
  {
    icon: MessageSquare,
    title: 'Messagerie unifiée',
    description: 'Email, SMS, WhatsApp, Facebook, Instagram — tout au même endroit.',
  },
  {
    icon: BarChart3,
    title: 'Rapports & Analytics',
    description: 'Tableau de bord en temps réel, dashboards personnalisables, exports PDF.',
  },
  {
    icon: Smartphone,
    title: 'Mobile natif',
    description: 'Apps iOS et Android natives, fonctionnent hors-ligne. Synchro automatique.',
  },
  {
    icon: ShieldCheck,
    title: 'Conformité Loi 25',
    description: 'CASL et Loi 25 respectées par défaut. Audit de conformité inclus.',
  },
];

interface Testimonial {
  name: string;
  role: string;
  city: string;
  quote: string;
  initials: string;
  color: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Sarah Tremblay',
    role: 'Agente immobilière',
    city: 'Gatineau',
    quote: 'Avant Intralys, je perdais des leads dans Excel. Maintenant tout est automatique, je ferme plus de ventes en moins de temps.',
    initials: 'ST',
    color: '#635BFF',
  },
  {
    name: 'Marc Bouchard',
    role: 'Coach sportif',
    city: 'Sherbrooke',
    quote: 'Mes clients reçoivent automatique leurs rappels. Plus de no-shows. Mon revenu mensuel a monté de 22% en trois mois.',
    initials: 'MB',
    color: '#635BFF',
  },
  {
    name: 'Julie Lavoie',
    role: 'Consultante stratégique',
    city: 'Trois-Rivières',
    quote: 'Le pipeline visuel m\'a fait gagner 5 heures par semaine. C\'est l\'équivalent d\'une journée de plus pour mes clients.',
    initials: 'JL',
    color: '#1AAB59',
  },
  {
    name: 'Mathieu Côté',
    role: 'Restaurateur',
    city: 'Québec',
    quote: 'Les rapports m\'aident à voir où va mon argent. J\'ai coupé 18% des dépenses inutiles dès le premier mois.',
    initials: 'MC',
    color: '#8B5CF6',
  },
  {
    name: 'Émilie Gagnon',
    role: 'Agence marketing',
    city: 'Montréal',
    quote: 'L\'équipe l\'a adopté en deux jours, c\'est intuitif. Aucune formation longue, juste des résultats.',
    initials: 'EG',
    color: '#C7912C',
  },
  {
    name: 'David Roy',
    role: 'Courtier auto',
    city: 'Drummondville',
    quote: 'Conformité Loi 25 réglée. Plus de stress, plus de paperasse manuelle. Je dors mieux.',
    initials: 'DR',
    color: '#CD3D64',
  },
];

interface FooterColumn {
  title: string;
  links: { label: string; to: string }[];
}

const FOOTER_COLS: FooterColumn[] = [
  {
    title: 'Produit',
    links: [
      { label: 'Fonctionnalités', to: '/#features' },
      { label: 'Tarifs', to: '/pricing' },
      { label: 'Démo', to: '/demo' },
      { label: 'Nouveautés', to: '/changelog' },
    ],
  },
  {
    title: 'Ressources',
    links: [
      // Sprint 47 M3 — Blog + Docs cross-links cohérents
      { label: "Centre d'aide", to: '/help' },
      { label: 'Blog', to: '/blog' },
      { label: 'API docs', to: '/help/api-introduction' },
      { label: 'Statut', to: '/help' },
    ],
  },
  {
    title: 'Entreprise',
    links: [
      { label: 'À propos', to: '/about' },
      { label: 'Carrières', to: '/about' },
      { label: 'Contact', to: '/demo' },
      { label: 'Presse', to: '/about' },
    ],
  },
  {
    title: 'Légal',
    links: [
      { label: "Conditions d'utilisation", to: '/legal/terms' },
      { label: 'Confidentialité', to: '/legal/privacy' },
      { label: 'Cookies', to: '/legal/privacy' },
      { label: 'Loi 25', to: '/legal/privacy' },
      { label: 'CASL', to: '/legal/privacy' },
    ],
  },
];

// ── Components ──────────────────────────────────────────────────────────

function PublicHeader() {
  return (
    <header className="mkt-header">
      <div className="mkt-header__inner">
        <Link to="/" className="mkt-header__logo" aria-label="Intralys accueil">
          <span className="mkt-logo-mark" aria-hidden>I</span>
          <span className="mkt-logo-wordmark">Intralys</span>
        </Link>
        <nav className="mkt-header__nav" aria-label="Navigation principale">
          <a href="#features" className="mkt-nav-link">Fonctionnalités</a>
          <Link to="/pricing" className="mkt-nav-link">Tarifs</Link>
          <Link to="/demo" className="mkt-nav-link">Démo</Link>
          <Link to="/about" className="mkt-nav-link">À propos</Link>
          <Link to="/help" className="mkt-nav-link">Aide</Link>
        </nav>
        <div className="mkt-header__actions">
          <Link to="/login" className="mkt-nav-link mkt-nav-link--ghost">Connexion</Link>
          <Link to="/demo">
            <Button variant="primary" size="md">Essai gratuit 14j</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function HeroSection({ onOpenDemo }: { onOpenDemo: () => void }) {
  return (
    <section className="mkt-hero" aria-labelledby="hero-title">
      <div className="mkt-hero__inner">
        <div className="mkt-hero__content">
          <span className="mkt-hero__eyebrow">
            <span className="mkt-hero__eyebrow-dot" aria-hidden />
            CRM #1 des PMEs québécoises
          </span>
          <h1 id="hero-title" className="mkt-hero__title">
            Le CRM québécois qui simplifie la vie des PME
          </h1>
          <p className="mkt-hero__subtitle">
            Pipeline, leads, factures, automation. Conformité Loi 25 inclue. Sans complications.
          </p>
          <div className="mkt-hero__ctas">
            <Link to="/demo">
              <Button variant="primary" size="lg" className="mkt-cta-primary">
                Essai gratuit 14 jours
              </Button>
            </Link>
            <button
              type="button"
              className="mkt-cta-secondary"
              onClick={onOpenDemo}
              aria-label="Voir la démo vidéo"
            >
              <Icon as={Play} size={14} />
              <span>Voir la démo</span>
            </button>
          </div>
          <p className="mkt-hero__finepriint">
            Aucune carte de crédit · Annule quand tu veux · Support FR québécois
          </p>
          <div className="mkt-trust">
            <span className="mkt-trust__label">+150 PMEs québécoises nous font confiance</span>
            <div className="mkt-trust__logos" aria-hidden>
              <span className="mkt-trust__logo">ACME Immo</span>
              <span className="mkt-trust__logo">Studio Boréal</span>
              <span className="mkt-trust__logo">Coop des Bois</span>
              <span className="mkt-trust__logo">Garage Roy</span>
            </div>
          </div>
        </div>
        <div className="mkt-hero__visual" aria-hidden>
          <div className="mkt-hero__screen">
            <div className="mkt-hero__screen-bar">
              <span className="mkt-hero__screen-dot" />
              <span className="mkt-hero__screen-dot" />
              <span className="mkt-hero__screen-dot" />
              <span className="mkt-hero__screen-url">intralys.app/dashboard</span>
            </div>
            <div className="mkt-hero__screen-body">
              <EmptyStateIllustration kind="pipeline" size={200} />
              <div className="mkt-hero__screen-rows">
                <div className="mkt-hero__screen-row" />
                <div className="mkt-hero__screen-row mkt-hero__screen-row--accent" />
                <div className="mkt-hero__screen-row" />
                <div className="mkt-hero__screen-row mkt-hero__screen-row--short" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mkt-modal-backdrop" role="dialog" aria-modal="true" aria-label="Démo Intralys" onClick={onClose}>
      <div className="mkt-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mkt-modal__close" onClick={onClose} aria-label="Fermer la démo">
          <Icon as={X} size={16} />
        </button>
        <div className="mkt-modal__video">
          <div className="mkt-modal__placeholder">
            <Icon as={Play} size={48} />
            <span>Aperçu vidéo 90 sec</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section className="mkt-features" id="features" aria-labelledby="features-title">
      <div className="mkt-section__inner">
        <header className="mkt-section__head">
          <h2 id="features-title" className="mkt-section__title">
            Toutes les fonctionnalités qu'il te faut, rien de plus
          </h2>
          <p className="mkt-section__subtitle">
            Pensé pour les PME, validé par +150 entreprises québécoises.
          </p>
        </header>
        <div className="mkt-features__grid">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="mkt-feature-card" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="mkt-feature-card__icon" aria-hidden>
                <Icon as={f.icon} size={20} />
              </div>
              <h3 className="mkt-feature-card__title">{f.title}</h3>
              <p className="mkt-feature-card__desc">{f.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-rotate 6s, pause on hover, respect reduce-motion
  useEffect(() => {
    if (paused) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
    timerRef.current = setInterval(() => {
      setActive((a) => (a + 1) % TESTIMONIALS.length);
    }, 6000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused]);

  const go = (delta: number) => {
    setActive((a) => (a + delta + TESTIMONIALS.length) % TESTIMONIALS.length);
  };

  return (
    <section
      className="mkt-testimonials"
      aria-labelledby="testi-title"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mkt-section__inner">
        <header className="mkt-section__head">
          <h2 id="testi-title" className="mkt-section__title">
            Ce qu'en disent les PMEs québécoises
          </h2>
          <p className="mkt-section__subtitle">
            Des vrais entrepreneurs, des vrais résultats, du Québec.
          </p>
        </header>

        {/* Grid desktop (6 cards) */}
        <div className="mkt-testi__grid" role="list">
          {TESTIMONIALS.map((t) => (
            <article key={t.name} className="mkt-testi-card" role="listitem">
              <p className="mkt-testi-card__quote">« {t.quote} »</p>
              <footer className="mkt-testi-card__footer">
                <span
                  className="mkt-testi-card__avatar"
                  aria-hidden
                  style={{ background: t.color }}
                >
                  {t.initials}
                </span>
                <div className="mkt-testi-card__person">
                  <span className="mkt-testi-card__name">{t.name}</span>
                  <span className="mkt-testi-card__role">{t.role} · {t.city}</span>
                </div>
              </footer>
            </article>
          ))}
        </div>

        {/* Carousel mobile (one card at a time) */}
        <div className="mkt-testi__carousel" aria-roledescription="carrousel">
          <button
            type="button"
            className="mkt-testi__nav mkt-testi__nav--prev"
            onClick={() => go(-1)}
            aria-label="Témoignage précédent"
          >
            <Icon as={ChevronLeft} size={16} />
          </button>
          {(() => {
            const t = TESTIMONIALS[active]!;
            return (
          <article
            key={t.name}
            className="mkt-testi-card mkt-testi-card--feature"
            aria-live="polite"
          >
            <p className="mkt-testi-card__quote">« {t.quote} »</p>
            <footer className="mkt-testi-card__footer">
              <span
                className="mkt-testi-card__avatar"
                aria-hidden
                style={{ background: t.color }}
              >
                {t.initials}
              </span>
              <div className="mkt-testi-card__person">
                <span className="mkt-testi-card__name">{t.name}</span>
                <span className="mkt-testi-card__role">
                  {t.role} · {t.city}
                </span>
              </div>
            </footer>
          </article>
            );
          })()}
          <button
            type="button"
            className="mkt-testi__nav mkt-testi__nav--next"
            onClick={() => go(1)}
            aria-label="Témoignage suivant"
          >
            <Icon as={ChevronRight} size={16} />
          </button>
        </div>

        <div className="mkt-testi__dots" role="tablist" aria-label="Choisir un témoignage">
          {TESTIMONIALS.map((t, i) => (
            <button
              key={t.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Afficher témoignage ${i + 1}`}
              className={`mkt-testi__dot ${i === active ? 'mkt-testi__dot--active' : ''}`}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBanner() {
  return (
    <section className="mkt-cta-banner" aria-labelledby="cta-banner-title">
      <div className="mkt-cta-banner__inner">
        <h2 id="cta-banner-title" className="mkt-cta-banner__title">
          Prêt à essayer ?
        </h2>
        <p className="mkt-cta-banner__subtitle">
          14 jours d'essai gratuit. Aucune carte de crédit. Annule quand tu veux.
        </p>
        <Link to="/demo">
          <Button variant="primary" size="lg" className="mkt-cta-banner__btn">
            Démarrer gratuitement
          </Button>
        </Link>
      </div>
    </section>
  );
}

function FooterSection() {
  const [emailValue, setEmailValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submitNewsletter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValue || !emailValue.includes('@')) return;
    setSubmitted(true);
    setEmailValue('');
    setTimeout(() => setSubmitted(false), 4000);
  };

  return (
    <footer className="mkt-footer" aria-labelledby="footer-title">
      <h2 id="footer-title" className="sr-only">Pied de page</h2>
      <div className="mkt-footer__inner">
        <div className="mkt-footer__cols">
          {/* Col 1 — Brand + tagline + social */}
          <div className="mkt-footer__brand">
            <div className="mkt-footer__logo">
              <span className="mkt-logo-mark" aria-hidden>I</span>
              <span className="mkt-logo-wordmark">Intralys</span>
            </div>
            <p className="mkt-footer__tagline">
              Le CRM tout-en-un pensé pour les PMEs francophones du Québec.
            </p>
            <div className="mkt-footer__social" aria-label="Réseaux sociaux">
              <a href="#" className="mkt-footer__social-link" aria-label="Facebook">
                <FacebookIcon />
              </a>
              <a href="#" className="mkt-footer__social-link" aria-label="LinkedIn">
                <LinkedinIcon />
              </a>
              <a href="#" className="mkt-footer__social-link" aria-label="Instagram">
                <InstagramIcon />
              </a>
            </div>
          </div>

          {/* Cols 2-5 — Links */}
          {FOOTER_COLS.map((col) => (
            <div key={col.title} className="mkt-footer__col">
              <h3 className="mkt-footer__col-title">{col.title}</h3>
              <ul className="mkt-footer__col-links">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to.startsWith('/#') ? (
                      <a href={l.to.replace('/', '')} className="mkt-footer__link">{l.label}</a>
                    ) : (
                      <Link to={l.to} className="mkt-footer__link">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Newsletter signup row */}
        <div className="mkt-footer__newsletter">
          <div className="mkt-footer__newsletter-text">
            <h3 className="mkt-footer__newsletter-title">Reste à l'affût</h3>
            <p className="mkt-footer__newsletter-desc">
              Nouveautés produit, conseils pour PMEs. Une fois par mois. Zéro spam.
            </p>
          </div>
          <form className="mkt-footer__newsletter-form" onSubmit={submitNewsletter}>
            <label className="mkt-footer__newsletter-field">
              <Icon as={Mail} size={14} />
              <input
                type="email"
                className="mkt-footer__newsletter-input"
                placeholder="ton@courriel.ca"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                aria-label="Adresse courriel newsletter"
                required
              />
            </label>
            <Button type="submit" variant="primary" size="md">
              {submitted ? 'Merci !' : "S'inscrire"}
            </Button>
          </form>
        </div>

        {/* Bottom row */}
        <div className="mkt-footer__bottom">
          <span className="mkt-footer__copy">
            © {new Date().getFullYear()} Intralys. Fait au Québec.
          </span>
          <div className="mkt-footer__bottom-links">
            <Link to="/legal/privacy" className="mkt-footer__bottom-link">Confidentialité</Link>
            <Link to="/legal/terms" className="mkt-footer__bottom-link">Conditions</Link>
            <Link to="/help" className="mkt-footer__bottom-link">Aide</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ── Main export ─────────────────────────────────────────────────────────

export function LandingPage() {
  const [demoOpen, setDemoOpen] = useState(false);

  return (
    <div className="mkt-page">
      <a href="#main" className="mkt-skip-link">Aller au contenu principal</a>
      <PublicHeader />
      <main id="main">
        <HeroSection onOpenDemo={() => setDemoOpen(true)} />
        <FeaturesSection />
        <TestimonialsSection />
        <CtaBanner />
      </main>
      <FooterSection />
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}

export default LandingPage;
