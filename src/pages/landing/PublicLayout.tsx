import { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex flex-col font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--bg-surface)]/80 backdrop-blur-md border-b border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 group">
              {/* Logo Intralys avec halo brand (wave 41) */}
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute -inset-1.5 rounded-[10px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(99,91,255,0.45) 0%, rgba(139,92,246,0.20) 60%, transparent 80%)',
                    filter: 'blur(10px)',
                  }}
                />
                <div
                  className="relative w-8 h-8 text-white rounded-[var(--radius-sm)] flex items-center justify-center font-bold text-lg"
                  style={{
                    background:
                      'linear-gradient(135deg, #635BFF 0%, #5851E5 60%, #8B5CF6 100%)',
                    boxShadow:
                      '0 2px 8px rgba(99,91,255,0.45), 0 0 16px -4px rgba(139,92,246,0.30)',
                  }}
                >
                  I
                </div>
              </div>
              <span className="font-bold text-xl tracking-tight text-[var(--text-primary)]">Intralys</span>
            </Link>
            <nav className="hidden md:flex gap-2 text-sm font-medium">
              <Link to="/" className="chip-btn chip-btn--label">Accueil</Link>
              <Link to="/pricing" className="chip-btn chip-btn--label">Tarifs</Link>
              <Link to="/about" className="chip-btn chip-btn--label">À propos</Link>
              {/* Sprint 47 M3 — Blog + Centre d'aide marketing */}
              <Link to="/blog" className="chip-btn chip-btn--label">Blog</Link>
              <Link to="/help" className="chip-btn chip-btn--label">Centre d'aide</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="chip-btn chip-btn--label hidden sm:inline-flex">
              Connexion
            </Link>
            <Link to="/demo">
              <Button variant="premium">Essai gratuit 14j</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Footer — mini-section cards (wave 41) */}
      <footer className="relative bg-[var(--bg-subtle)] border-t border-[var(--border-subtle)] py-14 mt-20 overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-20 -left-20 w-[420px] h-[420px] rounded-full pointer-events-none opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(99,91,255,0.20) 0%, rgba(139,92,246,0.10) 50%, transparent 75%)',
            filter: 'blur(70px)',
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Brand + tagline — col span 1 sur md */}
            <div className="md:col-span-1">
              <div className="card-premium p-5">
                <div className="relative flex items-center gap-2 mb-4">
                  <div
                    className="w-7 h-7 text-white rounded-[var(--radius-xs)] flex items-center justify-center font-bold text-sm"
                    style={{
                      background:
                        'linear-gradient(135deg, #635BFF 0%, #5851E5 60%, #8B5CF6 100%)',
                      boxShadow: '0 2px 8px rgba(99,91,255,0.45)',
                    }}
                  >
                    I
                  </div>
                  <span className="font-bold text-base text-[var(--text-primary)] tracking-tight">
                    Intralys CRM
                  </span>
                </div>
                <p className="relative text-[var(--text-muted)] text-xs leading-relaxed mb-3">
                  Le CRM tout-en-un pensé pour les PMEs francophones.
                </p>
                <p className="relative text-[var(--text-muted)] text-[10px] uppercase tracking-wider font-semibold">
                  © {new Date().getFullYear()} Intralys
                </p>
              </div>
            </div>

            {/* Produit */}
            <FooterMiniSection
              title="Produit"
              links={[
                { to: '/pricing', label: 'Tarifs' },
                { to: '/demo', label: 'Réserver une démo' },
                { to: '/changelog', label: 'Nouveautés' },
                // Sprint 47 M3 — Blog cross-link
                { to: '/blog', label: 'Blog' },
                // Sprint 50 M3 — Beta privée + roadmap publique
                { to: '/roadmap', label: 'Roadmap' },
                { to: '/beta', label: 'Rejoindre la beta' },
              ]}
            />

            {/* Légal & Aide — Sprint 47 M2 : +cookies, loi-25, casl */}
            <FooterMiniSection
              title="Légal & Aide"
              links={[
                { to: '/help', label: "Centre d'aide" },
                { to: '/legal/privacy', label: 'Confidentialité' },
                { to: '/legal/terms', label: "Conditions d'utilisation" },
                { to: '/legal/cookies', label: 'Cookies' },
                { to: '/legal/loi-25', label: 'Loi 25 (Québec)' },
                { to: '/legal/casl', label: 'CASL' },
              ]}
            />

            {/* À propos — Sprint 47 M2 : Contact dédié */}
            <FooterMiniSection
              title="Entreprise"
              links={[
                { to: '/about', label: 'À propos' },
                { to: '/contact', label: 'Nous contacter' },
                { to: '/', label: 'Accueil' },
              ]}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}

interface FooterLink {
  to: string;
  label: string;
}

function FooterMiniSection({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div className="card-premium p-5">
      <h3
        className="relative font-bold text-sm mb-3 tracking-tight"
        style={{
          background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {title}
      </h3>
      <ul className="relative flex flex-wrap gap-1.5">
        {links.map((l) => (
          <li key={l.to + l.label}>
            <Link to={l.to} className="chip-btn chip-btn--label chip-btn--sm">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
