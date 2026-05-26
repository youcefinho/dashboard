// @vitest-environment jsdom
// LOT A (GIGA-PLAN-V2) — Migration PageHero au paradigme sobre Stripe.
// Assert : props rendues, pas de gradient brand sur le titre, signature
// inchangée (highlight back-compat no-op), orbs retirés du DOM.
// NON exécuté en VM (build/tests délégués Antigravity).
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PageHero } from '../PageHero';

afterEach(cleanup);

describe('LOT A — PageHero sobre Stripe', () => {
  it('rend title + meta + description', () => {
    render(
      <PageHero meta="Workspace" title="Tâches" description="Vos relances." />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tâches');
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Vos relances.')).toBeInTheDocument();
  });

  it('ne rend AUCUN gradient brand sur le titre (paradigme RESET)', () => {
    const { container } = render(<PageHero title="Leads" highlight="Leads" />);
    // Plus aucun span text-gradient-brand généré par PageHero
    expect(container.querySelector('.text-gradient-brand')).toBeNull();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('text-[var(--text-primary)]');
  });

  it('ne rend AUCUN orb décoratif dans le DOM', () => {
    const { container } = render(<PageHero title="Pipeline" />);
    expect(container.querySelector('.hero-stat-orb')).toBeNull();
  });

  it('signature back-compat : highlight accepté sans effet visuel', () => {
    // highlight === title (cas réel de 21 appelants) → titre intact, sobre
    render(<PageHero title="Rapports" highlight="Rapports" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Rapports');
    expect(h1.querySelector('.text-gradient-brand')).toBeNull();
  });

  it('compact rend t-h2, défaut rend t-h1', () => {
    const { rerender } = render(<PageHero title="A" />);
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('t-h1');
    rerender(<PageHero title="A" compact />);
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('t-h2');
  });

  it('actions rendues quand fournies', () => {
    render(<PageHero title="X" actions={<button>Nouveau</button>} />);
    expect(screen.getByRole('button', { name: 'Nouveau' })).toBeInTheDocument();
  });

  it('porte la classe override sobre .page-hero--sober', () => {
    const { container } = render(<PageHero title="X" />);
    expect(container.querySelector('.page-hero--sober')).not.toBeNull();
  });
});
