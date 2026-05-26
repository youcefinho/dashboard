// @vitest-environment jsdom
// ── ChatWidgetSettings.test — Sprint 36 (Agent B1) ──────────────────────────
// Couvre :
//  1. Render mode création → tous champs visibles, getChatWidgets NON appelé.
//  2. Render mode édition → load via getChatWidgets + champs préremplis.
//  3. Submit avec name vide → validation error, createChatWidget NON appelé.
//  4. Submit valide (création) → createChatWidget(args) + toast.saved.
//  5. Submit valide (édition) → updateChatWidget(id, args) + toast.saved.
//  6. Toggle turnstile → state change reflété au submit.
//  7. Tag input allowed_origins : ajout via Enter, suppression via bouton.
//  8. Snippet copy → clipboard.writeText appelé + toast copied.

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
import type { ReactNode } from 'react';

// ── Mocks api ───────────────────────────────────────────────────────────────
const getChatWidgetsMock = vi.fn();
const createChatWidgetMock = vi.fn();
const updateChatWidgetMock = vi.fn();
const deleteChatWidgetMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getChatWidgets: (...a: unknown[]) => getChatWidgetsMock(...(a as [])),
  createChatWidget: (...a: unknown[]) => createChatWidgetMock(...(a as [])),
  updateChatWidget: (...a: unknown[]) => updateChatWidgetMock(...(a as [])),
  deleteChatWidget: (...a: unknown[]) => deleteChatWidgetMock(...(a as [])),
}));

// i18n : renvoie la clé brute.
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// Button : stub pass-through.
vi.mock('../ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    type,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      data-loading={isLoading ? 'true' : 'false'}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

// Input : pass-through.
vi.mock('../ui/Input', () => ({
  Input: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    required,
    error,
    'data-testid': testId,
    type,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
    required?: boolean;
    error?: string | boolean;
    'data-testid'?: string;
    type?: string;
  }) => (
    <>
      <input
        id={id}
        type={type ?? 'text'}
        value={value ?? ''}
        onChange={onChange}
        aria-label={ariaLabel}
        required={required}
        data-testid={testId ?? `input-${id ?? 'unknown'}`}
        aria-invalid={Boolean(error) || undefined}
      />
      {typeof error === 'string' && error ? (
        <span data-testid={`${testId ?? id}-error`}>{error}</span>
      ) : null}
    </>
  ),
}));

// Textarea : pass-through.
vi.mock('../ui/Textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    'aria-label': ariaLabel,
    error,
    'data-testid': testId,
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    'aria-label'?: string;
    error?: string | boolean;
    'data-testid'?: string;
  }) => (
    <>
      <textarea
        id={id}
        value={value ?? ''}
        onChange={onChange}
        aria-label={ariaLabel}
        data-testid={testId ?? `textarea-${id ?? 'unknown'}`}
        aria-invalid={Boolean(error) || undefined}
      />
      {typeof error === 'string' && error ? (
        <span data-testid={`${testId ?? id}-error`}>{error}</span>
      ) : null}
    </>
  ),
}));

// Switch : minimal toggle.
vi.mock('../ui/Switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    label,
    id,
    'data-testid': testId,
  }: {
    checked: boolean;
    onCheckedChange: (c: boolean) => void;
    label?: string;
    id?: string;
    'data-testid'?: string;
  }) => (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
    >
      {label}
    </button>
  ),
}));

// Icon : stub.
vi.mock('../ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size)} />
  ),
}));

// Toast : capture success/error.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('../ui/Toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    toast: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Imports APRÈS les mocks.
import { ChatWidgetSettings } from './ChatWidgetSettings';
import type { ChatWidget } from '../../lib/api';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeWidget(over: Partial<ChatWidget> = {}): ChatWidget {
  return {
    id: over.id ?? 'cw_1',
    client_id: over.client_id ?? 'cli_1',
    agency_id: over.agency_id ?? null,
    name: over.name ?? 'Mon widget',
    primary_color: over.primary_color ?? '#FF5733',
    welcome_message: over.welcome_message ?? 'Bonjour !',
    offline_message: over.offline_message ?? 'On revient bientôt.',
    position: over.position ?? 'bottom-left',
    allowed_origins: over.allowed_origins ?? ['https://example.com'],
    avatar_url: over.avatar_url ?? null,
    show_powered_by: over.show_powered_by ?? 1,
    business_hours_json: over.business_hours_json ?? null,
    bot_initial_replies_json: over.bot_initial_replies_json ?? null,
    turnstile_enabled: over.turnstile_enabled ?? 0,
    is_active: over.is_active ?? 1,
    created_at: over.created_at ?? '2026-05-22T10:00:00Z',
    updated_at: over.updated_at ?? null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<ChatWidgetSettings /> — Sprint 36 B1', () => {
  beforeEach(() => {
    getChatWidgetsMock.mockResolvedValue({ data: [makeWidget()] });
    createChatWidgetMock.mockResolvedValue({
      data: makeWidget({ id: 'cw_new', name: 'New widget' }),
    });
    updateChatWidgetMock.mockResolvedValue({
      data: makeWidget({ name: 'Updated' }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. mode création → tous champs visibles, getChatWidgets NON appelé', () => {
    render(<ChatWidgetSettings />);

    expect(getChatWidgetsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('cw-input-name')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-color')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-color-hex')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-position')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-welcome')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-offline')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-origin')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-avatar')).toBeInTheDocument();
    expect(screen.getByTestId('cw-switch-powered-by')).toBeInTheDocument();
    expect(screen.getByTestId('cw-switch-turnstile')).toBeInTheDocument();
    expect(screen.getByTestId('cw-input-hours')).toBeInTheDocument();
    expect(screen.getByTestId('cw-btn-submit')).toBeInTheDocument();
  });

  it('2. mode édition → load via getChatWidgets + champs préremplis', async () => {
    render(<ChatWidgetSettings widgetId="cw_1" />);

    await waitFor(() =>
      expect(getChatWidgetsMock).toHaveBeenCalledTimes(1),
    );

    await waitFor(() => {
      const nameInput = screen.getByTestId('cw-input-name') as HTMLInputElement;
      expect(nameInput.value).toBe('Mon widget');
    });
    const pos = screen.getByTestId('cw-input-position') as unknown as HTMLSelectElement;
    expect(pos.value).toBe('bottom-left');
    // Le tag origin est rendu.
    expect(
      screen.getByTestId('cw-origin-tag-https://example.com'),
    ).toBeInTheDocument();
    // Snippet panel apparaît une fois loadedWidget posé.
    expect(await screen.findByTestId('cw-snippet-pre')).toBeInTheDocument();
  });

  it('3. submit avec name vide → createChatWidget NON appelé (HTML required + guard)', () => {
    render(<ChatWidgetSettings />);

    const submitBtn = screen.getByTestId('cw-btn-submit');
    // Bouton disabled tant que name est vide (guard logique).
    expect(submitBtn).toBeDisabled();

    // Tentative quand même : injecter espace puis revider via guard.
    const nameInput = screen.getByTestId('cw-input-name');
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(submitBtn).toBeDisabled();

    expect(createChatWidgetMock).not.toHaveBeenCalled();
  });

  it('4. submit valide (création) → createChatWidget(args) + toast.saved + onSaved()', async () => {
    const onSavedMock = vi.fn();
    render(<ChatWidgetSettings onSaved={onSavedMock} />);

    const nameInput = screen.getByTestId('cw-input-name');
    fireEvent.change(nameInput, { target: { value: 'New widget' } });

    const welcome = screen.getByTestId('cw-input-welcome');
    fireEvent.change(welcome, { target: { value: 'Hello!' } });

    const submitBtn = screen.getByTestId('cw-btn-submit');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createChatWidgetMock).toHaveBeenCalledTimes(1);
    });
    const args = createChatWidgetMock.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      name: 'New widget',
      position: 'bottom-right',
      welcome_message: 'Hello!',
      show_powered_by: true,
      turnstile_enabled: false,
    });
    expect(args.primary_color).toBeDefined();
    expect(Array.isArray(args.allowed_origins)).toBe(true);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('toast.saved');
    });
    expect(onSavedMock).toHaveBeenCalledTimes(1);
    expect(updateChatWidgetMock).not.toHaveBeenCalled();
  });

  it('5. submit valide (édition) → updateChatWidget(id, args) + toast.saved', async () => {
    render(<ChatWidgetSettings widgetId="cw_1" />);

    await waitFor(() => {
      const nameInput = screen.getByTestId('cw-input-name') as HTMLInputElement;
      expect(nameInput.value).toBe('Mon widget');
    });

    const nameInput = screen.getByTestId('cw-input-name');
    fireEvent.change(nameInput, { target: { value: 'Updated' } });

    fireEvent.click(screen.getByTestId('cw-btn-submit'));

    await waitFor(() => {
      expect(updateChatWidgetMock).toHaveBeenCalledTimes(1);
    });
    expect(updateChatWidgetMock.mock.calls[0]?.[0]).toBe('cw_1');
    expect(updateChatWidgetMock.mock.calls[0]?.[1]).toMatchObject({
      name: 'Updated',
    });
    expect(createChatWidgetMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('toast.saved');
    });
  });

  it('6. toggle turnstile → state change reflété au submit', async () => {
    render(<ChatWidgetSettings />);

    const nameInput = screen.getByTestId('cw-input-name');
    fireEvent.change(nameInput, { target: { value: 'Anti-bot test' } });

    const switchEl = screen.getByTestId('cw-switch-turnstile');
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(switchEl);
    expect(switchEl).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByTestId('cw-btn-submit'));

    await waitFor(() => {
      expect(createChatWidgetMock).toHaveBeenCalled();
    });
    const args = createChatWidgetMock.mock.calls[0]?.[0];
    expect(args.turnstile_enabled).toBe(true);
  });

  it('7. tag input allowed_origins : ajout via Enter, suppression via bouton', () => {
    render(<ChatWidgetSettings />);

    const originInput = screen.getByTestId('cw-input-origin');
    fireEvent.change(originInput, {
      target: { value: 'https://buteau.ca' },
    });
    fireEvent.keyDown(originInput, { key: 'Enter' });

    expect(
      screen.getByTestId('cw-origin-tag-https://buteau.ca'),
    ).toBeInTheDocument();
    // Le draft est vidé.
    expect((originInput as HTMLInputElement).value).toBe('');

    // Ajout d'un 2e tag via virgule.
    fireEvent.change(originInput, {
      target: { value: 'https://serujan.com' },
    });
    fireEvent.keyDown(originInput, { key: ',' });
    expect(
      screen.getByTestId('cw-origin-tag-https://serujan.com'),
    ).toBeInTheDocument();

    // Suppression du premier tag via le bouton X.
    const tag1 = screen.getByTestId('cw-origin-tag-https://buteau.ca');
    const removeBtn = within(tag1).getByRole('button');
    fireEvent.click(removeBtn);

    expect(
      screen.queryByTestId('cw-origin-tag-https://buteau.ca'),
    ).toBeNull();
    expect(
      screen.getByTestId('cw-origin-tag-https://serujan.com'),
    ).toBeInTheDocument();
  });

  it('8. snippet copy → clipboard.writeText appelé + toast copied', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: writeTextMock },
    });

    render(<ChatWidgetSettings widgetId="cw_1" />);
    // Attendre que loadedWidget soit posé → snippet visible.
    const snippet = await screen.findByTestId('cw-snippet-pre');
    expect(snippet.textContent ?? '').toContain('cli_1');
    expect(snippet.textContent ?? '').toContain('widget.js');

    fireEvent.click(screen.getByTestId('cw-btn-copy'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    const copied = writeTextMock.mock.calls[0]?.[0];
    expect(copied).toContain('cli_1');
    expect(copied).toContain('<script');
    expect(copied).toContain('defer');

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('toast.copied');
    });
  });
});
