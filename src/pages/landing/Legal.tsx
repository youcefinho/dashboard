import { useMemo } from 'react';
import { PublicLayout } from './PublicLayout';
import { Link2, ShieldCheck, FileText } from 'lucide-react';

interface Section {
  id: string;
  title: string;
  body: string;
}

const PRIVACY_SECTIONS: Section[] = [
  {
    id: 'loi-25',
    title: '1. Conformité Loi 25',
    body: "Conformément à la Loi 25 du Québec, Intralys s'engage à protéger les renseignements personnels de ses utilisateurs et de leurs clients. Le Responsable de la protection des renseignements personnels est Rochdi Dahmani.",
  },
  {
    id: 'collecte',
    title: '2. Collecte des données',
    body: "Nous collectons uniquement les informations nécessaires au bon fonctionnement du CRM : nom, courriel, téléphone, et les données de vos prospects (leads) que vous choisissez d'importer ou de générer.",
  },
  {
    id: 'hebergement',
    title: '3. Hébergement et Sécurité',
    body: 'Les données sont hébergées de manière sécurisée via l\'infrastructure Cloudflare (D1, Workers). Des mesures de chiffrement et de contrôle d\'accès stricts sont en place.',
  },
];

const TERMS_SECTIONS: Section[] = [
  {
    id: 'acceptation',
    title: '1. Acceptation des conditions',
    body: "En utilisant Intralys CRM, vous acceptez les présentes conditions d'utilisation.",
  },
  {
    id: 'utilisation',
    title: '2. Utilisation du service',
    body: 'Vous êtes responsable de maintenir la confidentialité de votre compte et de votre mot de passe. Le service est fourni "tel quel" sans garantie implicite de revenus ou de résultats commerciaux.',
  },
  {
    id: 'resiliation',
    title: '3. Résiliation',
    body: 'Vous pouvez annuler votre abonnement à tout moment. Les données associées à votre compte seront conservées pendant 30 jours après résiliation avant d\'être définitivement supprimées.',
  },
];

export function LegalPage({ type }: { type: 'privacy' | 'terms' }) {
  const sections = useMemo(() => (type === 'privacy' ? PRIVACY_SECTIONS : TERMS_SECTIONS), [type]);
  const Icon = type === 'privacy' ? ShieldCheck : FileText;

  return (
    <PublicLayout>
      <div className="relative pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto overflow-hidden">
        <div
          className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -top-60 right-0 pointer-events-none -z-10"
          style={{
            background: 'radial-gradient(circle, rgba(0,157,219,0.10) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />

        <p className="heading-premium mb-3">Mentions légales</p>
        <h1
          className="legal-h1 text-4xl md:text-5xl font-extrabold tracking-tight mb-3 leading-[1.05]"
          style={{ letterSpacing: '-0.03em' }}
        >
          {type === 'privacy' ? (
            <>
              <span className="text-gradient-brand">Confidentialité</span> &amp; Loi 25
            </>
          ) : (
            <>
              <span className="text-gradient-brand">Conditions</span> d'Utilisation
            </>
          )}
        </h1>
        {/* Accent line sous H1 */}
        <div
          aria-hidden
          className="h-1 w-24 rounded-full mb-6"
          style={{
            background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
            boxShadow: '0 0 12px rgba(0,157,219,0.45)',
          }}
        />
        <p className="text-[var(--text-muted)] text-sm mb-10">
          Dernière mise à jour : {new Date().toLocaleDateString('fr-CA')}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-10">
          {/* TOC sticky — style sidebar-nav-item adapté light */}
          <aside className="lg:sticky lg:top-24 self-start">
            <div className="card-premium p-4">
              <div
                aria-hidden
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none opacity-50"
                style={{
                  background:
                    'radial-gradient(circle, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.10) 50%, transparent 75%)',
                  filter: 'blur(28px)',
                }}
              />
              <p className="relative heading-premium mb-3 flex items-center gap-2">
                <Icon size={12} className="text-[var(--primary)]" />
                Sommaire
              </p>
              <nav className="relative">
                <ul className="space-y-1">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="legal-toc-item flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] transition-all"
                      >
                        <span
                          aria-hidden
                          className="legal-toc-dot inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-all"
                          style={{
                            background:
                              'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                          }}
                        />
                        <span className="truncate">{s.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </aside>

          {/* Prose premium — h2 avec ancre visible au hover */}
          <article className="legal-prose prose prose-slate max-w-none">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="legal-section scroll-mt-24 mb-8">
                <h2 className="legal-h2 group flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-3">
                  <a
                    href={`#${s.id}`}
                    aria-label={`Lien vers ${s.title}`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--primary)]"
                  >
                    <Link2 size={16} />
                  </a>
                  {s.title}
                </h2>
                <p className="text-[var(--text-secondary)] leading-relaxed">{s.body}</p>
              </section>
            ))}
          </article>
        </div>
      </div>

      {/* Styles scoped : TOC hover/active gradient brand, prose typo premium.
       * Légers, inline via <style> JSX-safe (pas dans index.css car page-specifique). */}
      <style>{`
        .legal-toc-item:hover {
          background: linear-gradient(90deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.04) 100%);
          color: var(--primary);
          transform: translateX(2px);
          box-shadow: 0 2px 8px -4px rgba(0,157,219,0.25);
        }
        .legal-toc-item:hover .legal-toc-dot {
          box-shadow: 0 0 10px rgba(0,157,219,0.65);
          transform: scale(1.4);
        }
        .legal-toc-item:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgba(0,157,219,0.55), 0 0 12px rgba(217,110,39,0.25);
        }
        .legal-prose h2 { margin-top: 0; }
        .legal-section + .legal-section h2 {
          border-top: 1px dashed rgba(0,157,219,0.18);
          padding-top: 1.5rem;
        }
      `}</style>
    </PublicLayout>
  );
}
