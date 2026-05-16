// ── DesktopOnlyBanner — Sprint 9 ────────────────────────────
// Affiché sur mobile quand une page nécessite un écran large (builders)

import { Monitor } from 'lucide-react';
import { Icon } from '@/components/ui';

export function DesktopOnlyBanner() {
  return (
    <div className="lg:hidden flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--brand-tint)', color: 'var(--primary)' }}>
        <Icon as={Monitor} size={32} />
      </div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Écran plus large requis
      </h2>
      <p className="text-sm max-w-xs" style={{ color: 'var(--text-secondary)' }}>
        Cette fonctionnalité nécessite un écran plus large pour fonctionner correctement.
        Ouvrez Intralys sur un ordinateur ou une tablette en mode paysage.
      </p>
    </div>
  );
}
