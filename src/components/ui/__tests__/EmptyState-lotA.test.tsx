// @vitest-environment jsdom
// LOT A (GIGA-PLAN-V2) — EmptyState : contrat figé §6.b robuste pour Phase B.
// Assert : role=status + aria-live=polite, slot illustration prioritaire,
// pattern canonique <EmptyState illustration={...} title=.. description=.. />.
// NON exécuté en VM (build/tests délégués Antigravity).
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

afterEach(cleanup);

describe('LOT A — EmptyState contrat Phase B', () => {
  it('expose role="status" aria-live="polite" (a11y SR)', () => {
    render(<EmptyState title="Aucun lead" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('pattern canonique : illustration slot prioritaire sur icon', () => {
    render(
      <EmptyState
        icon={<span data-testid="legacy-icon" />}
        illustration={<svg data-testid="illu" />}
        title="Boîte vide"
        description="Rien ici pour l'instant."
      />
    );
    expect(screen.getByTestId('illu')).toBeInTheDocument();
    // icon non rendu quand illustration fournie
    expect(screen.queryByTestId('legacy-icon')).toBeNull();
    expect(screen.getByText('Boîte vide')).toBeInTheDocument();
    expect(screen.getByText("Rien ici pour l'instant.")).toBeInTheDocument();
  });

  it('fallback icon quand pas d illustration', () => {
    render(<EmptyState icon={<span data-testid="ic" />} title="T" />);
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });

  it('variants first-time / filtered ajoutent leur classe sans casser layout', () => {
    const { container, rerender } = render(
      <EmptyState title="T" variant="first-time" />
    );
    expect(container.querySelector('.empty-state--first-time')).not.toBeNull();
    rerender(<EmptyState title="T" variant="filtered" />);
    expect(container.querySelector('.empty-state--filtered')).not.toBeNull();
  });

  it('action + secondaryAction + tips rendus', () => {
    render(
      <EmptyState
        title="T"
        action={<button>Créer</button>}
        secondaryAction={<a href="#">Doc</a>}
        tips={['Astuce 1', 'Astuce 2']}
      />
    );
    expect(screen.getByRole('button', { name: 'Créer' })).toBeInTheDocument();
    expect(screen.getByText('Astuce 1')).toBeInTheDocument();
    expect(screen.getByText('Astuce 2')).toBeInTheDocument();
  });
});
