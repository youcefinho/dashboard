// @vitest-environment jsdom
// ── Sprint 24 — Observabilité : tests <AlertRulesPanel /> (Manager-C) ────
//
// Couvre :
//   1. Liste vide → EmptyState `alerts.empty` + bouton "Créer" visible.
//   2. Liste avec 2 règles → 2 rows rendues.
//   3. Toggle Switch → updateAlertRule(id, { enabled: !current }) + refetch.
//   4. Click "Supprimer" → confirm + deleteAlertRule(id).
//   5. Modal "Créer" : form valide → createAlertRule + refetch.
//   6. Validation client-side : name vide → formError affiché.
//   7. Validation : threshold négatif → formError.
//   8. Validation : channel=webhook sans target → formError.
//   9. condition_type='web_vital_p75' → Select metric_name visible (5 options).
//  10. condition_type='error_rate' → champ metric_name caché.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { t } from '@/lib/i18n';

// ── Mocks API ──────────────────────────────────────────────────────────────

const fetchAlertsMock = vi.fn();
const createAlertRuleMock = vi.fn();
const updateAlertRuleMock = vi.fn();
const deleteAlertRuleMock = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchAlerts: (...args: unknown[]) => fetchAlertsMock(...args),
  createAlertRule: (...args: unknown[]) => createAlertRuleMock(...args),
  updateAlertRule: (...args: unknown[]) => updateAlertRuleMock(...args),
  deleteAlertRule: (...args: unknown[]) => deleteAlertRuleMock(...args),
}));

// Imports APRÈS les mocks
import { AlertRulesPanel } from '../AlertRulesPanel';

// ── Fixtures ───────────────────────────────────────────────────────────────

function emptyAlerts() {
  return { data: { rules: [], events: [] } };
}

function makeRule(overrides: Partial<{
  id: string;
  name: string;
  enabled: boolean;
  condition_type: 'error_rate' | 'p95_latency' | 'web_vital_p75';
  metric_name: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'rule_1',
    name: overrides.name ?? 'High error rate',
    condition_type: overrides.condition_type ?? 'error_rate',
    metric_name: overrides.metric_name ?? null,
    threshold: 5,
    window_minutes: 60,
    notification_channel: 'log' as const,
    notification_target: '',
    enabled: overrides.enabled ?? true,
    created_at: '2026-05-22T10:00:00Z',
    updated_at: '2026-05-22T10:00:00Z',
  };
}

function rulesAndEvents() {
  return {
    data: {
      rules: [
        makeRule({ id: 'rule_1', name: 'High error rate', enabled: true }),
        makeRule({ id: 'rule_2', name: 'Slow LCP', enabled: false, condition_type: 'web_vital_p75', metric_name: 'LCP' }),
      ],
      events: [
        {
          id: 'evt_1',
          rule_id: 'rule_1',
          triggered_at: '2026-05-22T11:00:00Z',
          payload: {},
          resolved_at: null,
        },
        {
          id: 'evt_2',
          rule_id: 'rule_2',
          triggered_at: '2026-05-22T10:30:00Z',
          payload: {},
          resolved_at: '2026-05-22T10:45:00Z',
        },
      ],
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('<AlertRulesPanel /> — Sprint 24', () => {
  beforeEach(() => {
    fetchAlertsMock.mockResolvedValue(emptyAlerts());
    createAlertRuleMock.mockResolvedValue({ data: { rule: makeRule() } });
    updateAlertRuleMock.mockResolvedValue({ data: { rule: makeRule() } });
    deleteAlertRuleMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. liste vide → EmptyState alerts.empty + bouton Créer visible', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    expect(await screen.findByText(t('alerts.empty'))).toBeInTheDocument();
    // Le bouton "Créer une règle" est rendu (header).
    const createButtons = screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') });
    expect(createButtons.length).toBeGreaterThan(0);
  });

  it('2. liste avec 2 règles → 2 rows rendues', async () => {
    fetchAlertsMock.mockResolvedValue(rulesAndEvents());
    render(<AlertRulesPanel />);

    expect(await screen.findByText('High error rate')).toBeInTheDocument();
    expect(await screen.findByText('Slow LCP')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-row-rule_1')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rule-row-rule_2')).toBeInTheDocument();
  });

  it('3. toggle Switch → updateAlertRule appelé + refetch', async () => {
    fetchAlertsMock.mockResolvedValue(rulesAndEvents());
    render(<AlertRulesPanel />);
    await screen.findByText('High error rate');

    const row1 = screen.getByTestId('alert-rule-row-rule_1');
    const switchBtn = within(row1).getByRole('switch');
    fireEvent.click(switchBtn);

    await waitFor(() => {
      expect(updateAlertRuleMock).toHaveBeenCalledWith('rule_1', { enabled: false });
    });
    // Refetch après l'update
    await waitFor(() => {
      expect(fetchAlertsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('4. click Supprimer → confirm() + deleteAlertRule appelé', async () => {
    fetchAlertsMock.mockResolvedValue(rulesAndEvents());
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmSpy);

    render(<AlertRulesPanel />);
    await screen.findByText('High error rate');

    const row1 = screen.getByTestId('alert-rule-row-rule_1');
    const deleteBtn = within(row1).getByRole('button', {
      name: new RegExp(t('alerts.delete'), 'i'),
    });
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteAlertRuleMock).toHaveBeenCalledWith('rule_1');
    });
  });

  it('5. modal "Créer" : form valide → createAlertRule appelé + refetch', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    // Ouvre la modal
    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') })[0],
    );

    // Remplir le nom + threshold valide
    const nameInput = await screen.findByLabelText(t('alerts.name'));
    fireEvent.change(nameInput, { target: { value: 'New alert' } });

    const thresholdInput = screen.getByLabelText(t('alerts.threshold'));
    fireEvent.change(thresholdInput, { target: { value: '10' } });

    // Soumettre via le bouton "Créer une règle" dans la modal (le second
    // — le premier est l'ouverture dans le header)
    const allCreateBtns = screen.getAllByRole('button', {
      name: new RegExp(t('alerts.create'), 'i'),
    });
    // Le dernier bouton "Créer" est celui de la modal (soumission)
    fireEvent.click(allCreateBtns[allCreateBtns.length - 1]);

    await waitFor(() => {
      expect(createAlertRuleMock).toHaveBeenCalled();
    });
    const callArg = createAlertRuleMock.mock.calls[0][0];
    expect(callArg.name).toBe('New alert');
    expect(callArg.threshold).toBe(10);
    expect(callArg.condition_type).toBe('error_rate');
  });

  it('6. validation : name vide → formError affiché', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') })[0],
    );

    // Pas de name renseigné → soumission directe
    const allCreateBtns = await screen.findAllByRole('button', {
      name: new RegExp(t('alerts.create'), 'i'),
    });
    fireEvent.click(allCreateBtns[allCreateBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(t('alerts.error_invalid'))).toBeInTheDocument();
    });
    expect(createAlertRuleMock).not.toHaveBeenCalled();
  });

  it('7. validation : threshold négatif → formError', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') })[0],
    );

    const nameInput = await screen.findByLabelText(t('alerts.name'));
    fireEvent.change(nameInput, { target: { value: 'Bad threshold' } });

    const thresholdInput = screen.getByLabelText(t('alerts.threshold'));
    fireEvent.change(thresholdInput, { target: { value: '-5' } });

    const allCreateBtns = screen.getAllByRole('button', {
      name: new RegExp(t('alerts.create'), 'i'),
    });
    fireEvent.click(allCreateBtns[allCreateBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(t('alerts.error_invalid'))).toBeInTheDocument();
    });
    expect(createAlertRuleMock).not.toHaveBeenCalled();
  });

  it('8. validation : channel=webhook sans target → formError', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') })[0],
    );

    const nameInput = await screen.findByLabelText(t('alerts.name'));
    fireEvent.change(nameInput, { target: { value: 'Webhook missing url' } });

    const channelSelect = screen.getByLabelText(t('alerts.channel'));
    fireEvent.change(channelSelect, { target: { value: 'webhook' } });

    // target_url visible mais vide
    const targetInput = await screen.findByLabelText(t('alerts.target_url'));
    expect(targetInput).toBeInTheDocument();
    expect((targetInput as HTMLInputElement).value).toBe('');

    const allCreateBtns = screen.getAllByRole('button', {
      name: new RegExp(t('alerts.create'), 'i'),
    });
    fireEvent.click(allCreateBtns[allCreateBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(t('alerts.error_invalid'))).toBeInTheDocument();
    });
    expect(createAlertRuleMock).not.toHaveBeenCalled();
  });

  it('9. condition_type=web_vital_p75 → Select metric_name visible (5 options)', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') })[0],
    );

    const conditionSelect = await screen.findByLabelText(t('alerts.condition_type'));
    fireEvent.change(conditionSelect, { target: { value: 'web_vital_p75' } });

    const metricSelect = await screen.findByLabelText(t('alerts.metric_name'));
    expect(metricSelect).toBeInTheDocument();

    // 5 options (LCP/CLS/INP/TTFB/FCP) + 1 placeholder "—" = 6 options
    const options = within(metricSelect as HTMLSelectElement).getAllByRole('option');
    expect(options.length).toBe(6);
    const optionValues = options.map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toContain('LCP');
    expect(optionValues).toContain('CLS');
    expect(optionValues).toContain('INP');
    expect(optionValues).toContain('TTFB');
    expect(optionValues).toContain('FCP');
  });

  it('10. condition_type=error_rate → champ metric_name absent', async () => {
    render(<AlertRulesPanel />);
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalled());

    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp(t('alerts.create'), 'i') })[0],
    );

    // Par défaut, condition_type === 'error_rate' → pas de metric_name input
    await screen.findByLabelText(t('alerts.condition_type'));
    expect(screen.queryByLabelText(t('alerts.metric_name'))).not.toBeInTheDocument();
  });
});
