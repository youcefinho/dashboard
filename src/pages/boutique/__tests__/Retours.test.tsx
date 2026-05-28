// @vitest-environment jsdom
// ── Retours.test — Sprint 69 (Gestion de Retours & RMA) ───────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import type { ReturnRequest, Order } from '../../../lib/types';

// ── Mocks api & auth ─────────────────────────────────────────────────────────
const listAllReturnsMock = vi.fn();
const updateOrderReturnMock = vi.fn();
const getEcommerceOrderMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock('../../../lib/api', () => ({
  listAllReturns: (...a: any[]) => listAllReturnsMock(...a),
  updateOrderReturn: (...a: any[]) => updateOrderReturnMock(...a),
  getEcommerceOrder: (...a: any[]) => getEcommerceOrderMock(...a),
  rmaStatusKey: (s: string) => `shop.rma.st_${s}`,
}));

vi.mock('../../../lib/auth', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../../lib/i18n', () => ({
  t: (k: string) => k,
  getLocale: () => 'fr-CA',
}));

vi.mock('../../../lib/i18n/datetime', () => ({
  formatDate: (d: string) => d.split('T')[0],
}));

// ── Mocks UI Components ──────────────────────────────────────────────────────
vi.mock('../../../components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../../../components/ui/PageHero', () => ({
  PageHero: ({ title, description }: { title: string; description?: string }) => (
    <header data-testid="page-hero">
      <h1 data-testid="page-hero-title">{title}</h1>
      {description && <p data-testid="page-hero-description">{description}</p>}
    </header>
  ),
}));

vi.mock('../../../components/ui/Card', () => ({
  Card: ({ children, className, ...props }: any) => (
    <div data-testid="card-stub" className={className} {...props}>
      {children}
    </div>
  ),
}));

vi.mock('../../../components/ui/EmptyState', () => ({
  EmptyState: ({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
      <div data-testid="empty-action">{action}</div>
    </div>
  ),
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, leftIcon, className }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid="button-stub" className={className}>
      {leftIcon && <span data-testid="button-left-icon">{leftIcon}</span>}
      {children}
    </button>
  ),
}));

vi.mock('../../../components/ui/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton-stub" className={className} />
  ),
}));

vi.mock('../../../components/ui/Tag', () => ({
  Tag: ({ children, variant, dot }: any) => (
    <span data-testid="tag-stub" data-variant={variant} data-dot={String(dot ?? '')}>
      {children}
    </span>
  ),
}));

vi.mock('../../../components/ui/Input', () => ({
  Input: ({ value, onChange, placeholder, className }: any) => (
    <input
      data-testid="input-stub"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: ({ value, onChange, children, className }: any) => (
    <select data-testid="select-stub" value={value} onChange={onChange} className={className}>
      {children}
    </select>
  ),
}));

vi.mock('../../../components/ui/Icon', () => ({
  Icon: ({ as: IconComponent, size }: any) => (
    <span data-testid="icon-stub" data-size={size}>
      {IconComponent && <IconComponent size={14} />}
    </span>
  ),
}));

vi.mock('../../../components/ui/SlidePanel', () => ({
  SlidePanel: ({ open, title, children }: any) =>
    open ? (
      <div data-testid="slidepanel-stub" role="dialog" aria-label={title}>
        <div data-testid="slidepanel-title">{title}</div>
        {children}
      </div>
    ) : null,
}));

// Toast mock
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

// Imports après les mocks
import { RetoursPage } from '../Retours';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const mockReturns: ReturnRequest[] = [
  {
    id: 'ret_11111111',
    client_id: 'cli_1',
    order_id: 'ord_11111111',
    status: 'pending',
    reason: 'Trop grand',
    created_at: '2026-05-28T10:00:00Z',
    updated_at: '2026-05-28T10:00:00Z',
    items: [
      {
        id: 'rit_1',
        order_item_id: 'oi_1',
        quantity: 1,
        restock: true,
      },
    ],
  },
  {
    id: 'ret_22222222',
    client_id: 'cli_1',
    order_id: 'ord_22222222',
    status: 'approved',
    reason: 'Mauvais coloris',
    created_at: '2026-05-27T10:00:00Z',
    updated_at: '2026-05-27T11:00:00Z',
    items: [
      {
        id: 'rit_2',
        order_item_id: 'oi_2',
        quantity: 2,
        restock: false,
      },
    ],
  },
];

const mockOrder1: Order = {
  id: 'ord_11111111',
  order_number: 'CMD-1001',
  customer_email: 'customer1@example.com',
  email: 'customer1@example.com',
  items: [
    {
      id: 'oi_1',
      product_title_snapshot: 'T-shirt premium',
      variant_title_snapshot: 'Rouge / L',
      sku_snapshot: 'TS-PREM-RD-L',
    },
  ],
};

const mockOrder2: Order = {
  id: 'ord_22222222',
  order_number: 'CMD-1002',
  customer_email: 'customer2@example.com',
  email: 'customer2@example.com',
  items: [
    {
      id: 'oi_2',
      product_title_snapshot: 'Pantalon Cargo',
      variant_title_snapshot: 'Kaki / 32',
      sku_snapshot: 'PT-CARG-KK-32',
    },
  ],
};

describe('<RetoursPage /> — Sprint 69 (Gestion de Retours & RMA)', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: 'usr_1', role: 'admin' } });
    listAllReturnsMock.mockResolvedValue({ data: mockReturns });
    getEcommerceOrderMock.mockImplementation((orderId: string) => {
      if (orderId === 'ord_11111111') return Promise.resolve({ data: mockOrder1 });
      if (orderId === 'ord_22222222') return Promise.resolve({ data: mockOrder2 });
      return Promise.resolve({ data: null });
    });
    updateOrderReturnMock.mockResolvedValue({ data: { success: true } });
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. Rendu initial en cours de chargement → affiche les skeletons', () => {
    // On force listAllReturnsMock à ne pas résoudre immédiatement
    listAllReturnsMock.mockReturnValue(new Promise(() => {}));
    render(<RetoursPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton-stub')).toHaveLength(30); // 5 th + 5 * 5 tr-skeletons
  });

  it('2. Liste des retours chargée avec succès → affiche la table et les lignes', async () => {
    render(<RetoursPage />);
    await waitFor(() => {
      expect(listAllReturnsMock).toHaveBeenCalledTimes(1);
    });
    
    // Vérifier les lignes de la table
    expect(screen.getByText('#ret_1111')).toBeInTheDocument();
    expect(screen.getByText('#ret_2222')).toBeInTheDocument();
    expect(screen.getByText('#ord_1111')).toBeInTheDocument();
    expect(screen.getByText('#ord_2222')).toBeInTheDocument();
    expect(screen.getByText('Trop grand')).toBeInTheDocument();
    expect(screen.getByText('Mauvais coloris')).toBeInTheDocument();
  });

  it('3. Recherche côté client fonctionne sur ID retour et commande', async () => {
    render(<RetoursPage />);
    await waitFor(() => {
      expect(listAllReturnsMock).toHaveBeenCalledTimes(1);
    });

    const searchInput = screen.getByPlaceholderText('shop.returns.search');
    
    // Recherche de ret_11111111
    fireEvent.change(searchInput, { target: { value: 'ret_1111' } });
    
    // Attendre le debounce de 320ms
    await waitFor(() => {
      expect(screen.getByText('#ret_1111')).toBeInTheDocument();
      expect(screen.queryByText('#ret_2222')).not.toBeInTheDocument();
    });

    // Reset recherche
    fireEvent.change(searchInput, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByText('#ret_2222')).toBeInTheDocument();
    });
  });

  it('4. Clic sur une ligne → Ouvre le SlidePanel de détail et charge la commande associée', async () => {
    render(<RetoursPage />);
    await waitFor(() => {
      expect(listAllReturnsMock).toHaveBeenCalled();
    });

    // Clic sur le premier retour
    fireEvent.click(screen.getByText('#ret_1111'));

    // Attendre l'ouverture du slidepanel
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('slidepanel-title')).toHaveTextContent('shop.returns.detail_title #ret_1111');

    // Vérifier que la commande a été fetchée
    await waitFor(() => {
      expect(getEcommerceOrderMock).toHaveBeenCalledWith('ord_11111111');
    });

    // Vérifier le rendu des infos de la commande
    expect(screen.getByText('shop.order.title CMD-1001')).toBeInTheDocument();
    expect(screen.getByText('customer1@example.com')).toBeInTheDocument();

    // Vérifier le rendu de l'article retourné
    expect(screen.getByText('T-shirt premium')).toBeInTheDocument();
    expect(screen.getByText('Rouge / L')).toBeInTheDocument();
    expect(screen.getByText('SKU: TS-PREM-RD-L')).toBeInTheDocument();
    expect(screen.getByText('Qté: 1')).toBeInTheDocument();
    expect(screen.getByText('shop.returns.restock_yes')).toBeInTheDocument();
  });

  it('5. Actions admin sur retour PENDING → affiche Approuver et Rejeter', async () => {
    render(<RetoursPage />);
    await waitFor(() => {
      expect(listAllReturnsMock).toHaveBeenCalled();
    });

    // Clic sur le retour 'pending' (ret_11111111)
    fireEvent.click(screen.getByText('#ret_1111'));
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(getEcommerceOrderMock).toHaveBeenCalled();
    });

    // L'admin doit voir "Approuver" (act_approve) et "Rejeter" (act_reject)
    const approveButton = screen.getByRole('button', { name: /shop\.returns\.act_approve/ });
    const rejectButton = screen.getByRole('button', { name: /shop\.returns\.act_reject/ });
    expect(approveButton).toBeInTheDocument();
    expect(rejectButton).toBeInTheDocument();

    // Clic sur Approuver
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(updateOrderReturnMock).toHaveBeenCalledWith('ret_11111111', 'approve');
      expect(toastSuccessMock).toHaveBeenCalledWith('shop.rma.updated');
      expect(listAllReturnsMock).toHaveBeenCalledTimes(2); // rechargement
    });
  });

  it('6. Actions admin sur retour APPROVED → affiche Recevoir et Rejeter', async () => {
    render(<RetoursPage />);
    await waitFor(() => {
      expect(listAllReturnsMock).toHaveBeenCalled();
    });

    // Clic sur le retour 'approved' (ret_22222222)
    fireEvent.click(screen.getByText('#ret_2222'));
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(getEcommerceOrderMock).toHaveBeenCalled();
    });

    // L'admin doit voir "Recevoir" (act_receive) et "Rejeter" (act_reject)
    const receiveButton = screen.getByRole('button', { name: /shop\.returns\.act_receive/ });
    const rejectButton = screen.getByRole('button', { name: /shop\.returns\.act_reject/ });
    expect(receiveButton).toBeInTheDocument();
    expect(rejectButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /shop\.returns\.act_approve/ })).not.toBeInTheDocument();

    // Clic sur Recevoir
    fireEvent.click(receiveButton);

    await waitFor(() => {
      expect(updateOrderReturnMock).toHaveBeenCalledWith('ret_22222222', 'receive');
      expect(toastSuccessMock).toHaveBeenCalledWith('shop.rma.updated');
    });
  });

  it('7. Actions d\'administration masquées pour un utilisateur non-admin', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'usr_2', role: 'user' } }); // Simple utilisateur
    render(<RetoursPage />);
    await waitFor(() => {
      expect(listAllReturnsMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('#ret_1111'));
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(getEcommerceOrderMock).toHaveBeenCalled();
    });

    // Ne doit pas afficher d'actions d'administration
    expect(screen.queryByRole('button', { name: /shop\.returns\.act_/ })).not.toBeInTheDocument();
  });
});
