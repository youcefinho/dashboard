// @vitest-environment jsdom
// LOT RÉEL (Manager B) — primitive LoadMore (docs/LOT-REEL.md §6.A B.3).
// Couvre les 3 états mutuellement exclusifs + libellés via i18n (clés
// `leads.pagination.*` figées Manager A, fr-CA par défaut) + onLoadMore.
// NON exécuté en VM (build/tests délégués Antigravity).
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { setLocale } from '@/lib/i18n';
import { LoadMore } from '../LoadMore';

// jsdom simule un navigateur EN → t() rend en anglais par défaut.
// On force fr-CA explicitement comme le ferait l'app au boot.
beforeAll(() => {
  setLocale('fr-CA', { reloadAfterChange: false });
});

afterEach(cleanup);

describe('LOT RÉEL — LoadMore primitive', () => {
  it('hasMore && !loading : bouton load_more + sous-texte loaded {{shown}}', () => {
    const onLoadMore = vi.fn();
    render(
      <LoadMore onLoadMore={onLoadMore} loading={false} hasMore loadedCount={42} />
    );
    // Libellé bouton = clé i18n leads.pagination.load_more (fr-CA : "Charger plus")
    expect(screen.getByRole('button', { name: 'Charger plus' })).toBeInTheDocument();
    // Sous-texte interpolé {{shown}} → "42 leads chargés"
    expect(screen.getByText('42 leads chargés')).toBeInTheDocument();
  });

  it('label custom override le défaut i18n', () => {
    render(
      <LoadMore onLoadMore={() => {}} loading={false} hasMore loadedCount={1} label="Voir plus" />
    );
    expect(screen.getByRole('button', { name: 'Voir plus' })).toBeInTheDocument();
  });

  it('click bouton déclenche onLoadMore', () => {
    const onLoadMore = vi.fn();
    render(
      <LoadMore onLoadMore={onLoadMore} loading={false} hasMore loadedCount={10} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('loading : texte loading, AUCUN bouton', () => {
    render(
      <LoadMore onLoadMore={() => {}} loading hasMore loadedCount={5} />
    );
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('!hasMore : texte all_loaded + compteur, AUCUN bouton', () => {
    render(
      <LoadMore onLoadMore={() => {}} loading={false} hasMore={false} loadedCount={7} />
    );
    expect(screen.getByText('Tous les leads sont chargés')).toBeInTheDocument();
    expect(screen.getByText('7 leads chargés')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
