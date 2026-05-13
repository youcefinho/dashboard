import { PublicLayout } from './PublicLayout';
import { Button } from '@/components/ui/Button';

export function DemoPage() {
  return (
    <PublicLayout>
      <div className="pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-extrabold text-[var(--text-primary)] mb-4">Réservez votre démo</h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Découvrez comment Intralys peut transformer la gestion de votre PME avec un expert.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[var(--border-subtle)] shadow-sm p-8 text-center">
          <div className="aspect-video bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl mb-8 flex items-center justify-center">
            {/* Embed Calendly Placeholder */}
            <p className="text-[var(--text-muted)] font-medium">Ici sera intégré le widget Calendly d'Intralys</p>
          </div>
          <Button size="lg" className="w-full sm:w-auto" onClick={() => window.location.href = 'mailto:rochdi@intralys.com'}>
            Contacter par courriel au lieu
          </Button>
        </div>
      </div>
    </PublicLayout>
  );
}
