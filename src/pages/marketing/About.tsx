// ── Sprint 47 M2.3 — About page Stripe SUBTLE ────────────────────────────────
// Hero + mission + équipe + timeline + investisseurs. Coexiste avec
// `landing/About.tsx` (legacy, plus dramatic) qui reste linké depuis le
// footer existant. Cette nouvelle page vit sous `/marketing/about`.

import { PublicLayout } from '../landing/PublicLayout';
import { MarketingMeta } from './_meta';

interface TeamMember {
  initials: string;
  name: string;
  role: string;
  bio: string;
}

const TEAM: TeamMember[] = [
  {
    initials: 'RD',
    name: 'Rochdi Dahmani',
    role: 'Fondateur & CEO',
    bio: "Développeur full-stack, 8 ans d'expérience CRM & automatisation. Bâtit Intralys pour offrir aux PMEs québécoises une alternative locale aux outils américains.",
  },
  {
    initials: 'ML',
    name: 'Marie-Ève Lavoie',
    role: 'VP Produit',
    bio: 'Ex-Shopify, spécialiste UX produit B2B. Pilote la vision produit et l\'expérience utilisateur. Basée à Montréal.',
  },
  {
    initials: 'JT',
    name: 'Julien Tremblay',
    role: 'Lead Engineering',
    bio: 'Architecte logiciel, ex-Lightspeed. Responsable de l\'infrastructure scalable et de la performance de la plateforme.',
  },
  {
    initials: 'AP',
    name: 'Amélie Picard',
    role: 'Head of Customer Success',
    bio: 'Ancienne consultante PME, accompagne les clients dès l\'onboarding jusqu\'à l\'optimisation continue.',
  },
  {
    initials: 'KB',
    name: 'Karim Benabdallah',
    role: 'AI & Data Lead',
    bio: 'Doctorat NLP, spécialisé en modèles francophones. Conçoit l\'assistant AI Intralys et les fonctionnalités prédictives.',
  },
  {
    initials: 'SG',
    name: 'Sophie Gagnon',
    role: 'Compliance & Legal',
    bio: 'Avocate spécialisée en droit numérique au Québec. Garante de la conformité Loi 25, CASL et confidentialité.',
  },
];

interface TimelineEvent {
  year: string;
  title: string;
  body: string;
}

const TIMELINE: TimelineEvent[] = [
  {
    year: '2024',
    title: 'Fondation',
    body: "Naissance d'Intralys à Montréal, avec une idée fixe : un CRM moderne, francophone, conforme aux lois canadiennes, accessible aux PMEs.",
  },
  {
    year: '2025',
    title: 'V1 — Beta privée',
    body: "Premiers 50 clients québécois (immobilier, cliniques, agences). Itérations rapides avec feedback terrain.",
  },
  {
    year: '2026',
    title: 'Beta publique',
    body: "Ouverture au grand public. Plateforme mature : Loi 25, CASL, AI FR, 12 intégrations natives, application mobile.",
  },
];

const PARTNERS = ['Cloudflare', 'Stripe', 'Twilio', 'Mapbox', 'Anthropic', 'OpenAI'];

export function AboutMarketingPage() {
  return (
    <PublicLayout>
      <MarketingMeta
        title="À propos — Intralys CRM"
        description="Intralys est une équipe québécoise qui bâtit un CRM moderne pour les PMEs francophones. Découvre notre mission, notre équipe et nos partenaires."
        path="/marketing/about"
      />

      <div className="mk-about">
        {/* Hero */}
        <section className="mk-about__hero">
          <p className="mk-about__eyebrow">À propos</p>
          <h1 className="mk-about__title">Une équipe québécoise qui croit aux PMEs.</h1>
          <p className="mk-about__sub">
            On bâtit le CRM qu'on aurait voulu utiliser quand on gérait nos propres entreprises — simple, francophone, conforme.
          </p>
        </section>

        {/* Mission */}
        <section className="mk-about__mission" aria-label="Mission">
          <h2 className="mk-section-title">Notre mission</h2>
          <div className="mk-about__mission-body">
            <p>
              Les PMEs québécoises et canadiennes méritent mieux que des CRM américains traduits à la va-vite, ou des solutions <em>« universelles »</em> qui ignorent la réalité fiscale, légale et culturelle d'ici.
            </p>
            <p>
              On construit un outil pensé dès la première ligne de code pour la <strong>Loi 25</strong>, la <strong>CASL</strong>, la <strong>TPS/TVQ</strong>, et le français québécois — pas comme une option, comme un point de départ.
            </p>
            <p>
              Notre engagement est simple : que chaque dirigeant de PME, peu importe sa taille ou son niveau technique, puisse automatiser sa relation client sans avoir besoin d'une équipe IT ou d'un consultant à 200$/h.
            </p>
          </div>
        </section>

        {/* Équipe */}
        <section className="mk-about__team" aria-label="Équipe">
          <h2 className="mk-section-title">L'équipe</h2>
          <p className="mk-section-sub">Six personnes, basées au Québec et à distance, alignées sur une seule chose : la réussite de nos clients.</p>

          <div className="mk-team-grid">
            {TEAM.map((m) => (
              <article key={m.initials} className="mk-team-card">
                <div className="mk-team-card__avatar" aria-hidden>{m.initials}</div>
                <h3 className="mk-team-card__name">{m.name}</h3>
                <p className="mk-team-card__role">{m.role}</p>
                <p className="mk-team-card__bio">{m.bio}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Timeline */}
        <section className="mk-about__timeline" aria-label="Notre parcours">
          <h2 className="mk-section-title">Notre parcours</h2>
          <ol className="mk-timeline">
            {TIMELINE.map((t, i) => (
              <li key={i} className="mk-timeline__item">
                <div className="mk-timeline__marker" aria-hidden>
                  <span className="mk-timeline__dot" />
                </div>
                <div className="mk-timeline__body">
                  <div className="mk-timeline__year">{t.year}</div>
                  <h3 className="mk-timeline__title">{t.title}</h3>
                  <p className="mk-timeline__desc">{t.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Partenaires / investisseurs */}
        <section className="mk-about__partners" aria-label="Partenaires technologiques">
          <h2 className="mk-section-title">Nos partenaires technologiques</h2>
          <p className="mk-section-sub">On s'appuie sur les meilleures infrastructures pour livrer un service fiable.</p>
          <ul className="mk-partners-grid">
            {PARTNERS.map((p) => (
              <li key={p} className="mk-partner-cell">{p}</li>
            ))}
          </ul>
        </section>
      </div>
    </PublicLayout>
  );
}

export default AboutMarketingPage;
