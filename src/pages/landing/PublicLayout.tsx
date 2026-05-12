import { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[var(--text-primary)] flex flex-col font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[var(--brand-primary)] text-white rounded-[var(--radius-sm)] flex items-center justify-center font-bold text-lg">
                I
              </div>
              <span className="font-bold text-xl tracking-tight text-slate-900">Intralys</span>
            </Link>
            <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-600">
              <Link to="/" className="hover:text-[var(--brand-primary)] transition-colors">Accueil</Link>
              <Link to="/pricing" className="hover:text-[var(--brand-primary)] transition-colors">Tarifs</Link>
              <Link to="/about" className="hover:text-[var(--brand-primary)] transition-colors">À propos</Link>
              <Link to="/help" className="hover:text-[var(--brand-primary)] transition-colors">Centre d'aide</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-[var(--brand-primary)]">
              Connexion
            </Link>
            <Link to="/demo">
              <Button>Essai gratuit 14j</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 bg-[var(--brand-primary)] text-white rounded-[var(--radius-xs)] flex items-center justify-center font-bold text-sm">
                  I
                </div>
                <span className="font-bold text-lg text-slate-900">Intralys CRM</span>
              </div>
              <p className="text-slate-500 text-sm max-w-sm mb-6">
                Le CRM tout-en-un pensé pour les PMEs francophones. Simplifiez votre gestion de leads, automatisez vos processus et convertissez plus de clients.
              </p>
              <p className="text-slate-400 text-sm">
                © {new Date().getFullYear()} Intralys. Tous droits réservés.
              </p>
            </div>
            
            <div>
              <h3 className="font-bold text-slate-900 mb-4">Produit</h3>
              <ul className="space-y-3 text-sm text-slate-600">
                <li><Link to="/pricing" className="hover:text-[var(--brand-primary)]">Tarifs</Link></li>
                <li><Link to="/demo" className="hover:text-[var(--brand-primary)]">Réserver une démo</Link></li>
                <li><Link to="/changelog" className="hover:text-[var(--brand-primary)]">Nouveautés (Changelog)</Link></li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-bold text-slate-900 mb-4">Légal & Aide</h3>
              <ul className="space-y-3 text-sm text-slate-600">
                <li><Link to="/help" className="hover:text-[var(--brand-primary)]">Centre d'aide</Link></li>
                <li><Link to="/legal/privacy" className="hover:text-[var(--brand-primary)]">Politique de confidentialité (Loi 25)</Link></li>
                <li><Link to="/legal/terms" className="hover:text-[var(--brand-primary)]">Conditions d'utilisation</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
