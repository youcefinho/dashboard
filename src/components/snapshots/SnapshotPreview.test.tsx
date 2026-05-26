// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
// En jsdom, navigator.language = 'en-US' → la locale auto-detect tombe sur 'en'
// et les headers afficheraient "Created/Skipped/Failed". Le test exige les
// libelles fr-CA ("Crees/Ignores/Echoues"). On force la locale via setLocale()
// APRES import du module i18n (t() lit _currentLocale au call-time).
import { setLocale } from '../../lib/i18n';
setLocale('fr-CA', { reloadAfterChange: false });

import { SnapshotPreview } from './SnapshotPreview';
import type {
  ImportSummary,
  ImportLogEntry,
  SnapshotEntityName,
} from '../../lib/api';

const emptyMapping = {} as ImportSummary['id_mapping'];

function buildSummary(
  totals: Partial<Record<SnapshotEntityName, { created: number; skipped: number; failed: number }>>,
): ImportSummary {
  return {
    total_entities: Object.keys(totals).length,
    totals: totals as ImportSummary['totals'],
    id_mapping: emptyMapping,
  };
}

describe('SnapshotPreview — Sprint 35', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders one row per entity with created/skipped/failed/total cells + footer totals', () => {
    const summary = buildSummary({
      workflows: { created: 5, skipped: 2, failed: 0 },
      forms: { created: 3, skipped: 0, failed: 1 },
    });
    const log: ImportLogEntry[] = [];

    render(<SnapshotPreview summary={summary} log={log} />);

    // Table headers (i18n applied)
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Créés')).toBeTruthy();
    expect(screen.getByText('Ignorés')).toBeTruthy();
    expect(screen.getByText('Échoués')).toBeTruthy();

    // Two entity rows present
    const workflowRow = screen.getByTestId('snapshot-preview-row-workflows');
    const formsRow = screen.getByTestId('snapshot-preview-row-forms');
    expect(workflowRow).toBeTruthy();
    expect(formsRow).toBeTruthy();

    // workflows row cells: 5, 2, 0, total=7
    const workflowCells = within(workflowRow).getAllByRole('cell');
    expect(workflowCells[0]!.textContent).toBe('workflows');
    expect(workflowCells[1]!.textContent).toBe('5');
    expect(workflowCells[2]!.textContent).toBe('2');
    expect(workflowCells[3]!.textContent).toBe('0');
    expect(workflowCells[4]!.textContent).toBe('7');

    // forms row cells: 3, 0, 1, total=4
    const formsCells = within(formsRow).getAllByRole('cell');
    expect(formsCells[1]!.textContent).toBe('3');
    expect(formsCells[2]!.textContent).toBe('0');
    expect(formsCells[3]!.textContent).toBe('1');
    expect(formsCells[4]!.textContent).toBe('4');

    // Footer grand totals : created=8, skipped=2, failed=1, total=11
    const footer = screen.getByRole('table').querySelector('tfoot');
    expect(footer).toBeTruthy();
    const footerCells = footer!.querySelectorAll('td');
    expect(footerCells[0]!.textContent).toBe('Total');
    expect(footerCells[1]!.textContent).toBe('8');
    expect(footerCells[2]!.textContent).toBe('2');
    expect(footerCells[3]!.textContent).toBe('1');
    expect(footerCells[4]!.textContent).toBe('11');
  });

  it('opens the drawer with filtered log entries when an entity row is clicked', () => {
    const summary = buildSummary({
      workflows: { created: 1, skipped: 0, failed: 1 },
      forms: { created: 1, skipped: 0, failed: 0 },
    });
    const log: ImportLogEntry[] = [
      { entity: 'workflows', action: 'created', old_id: 'wf_old_1', new_id: 'wf_new_1' },
      {
        entity: 'workflows',
        action: 'failed',
        old_id: 'wf_old_2',
        new_id: null,
        reason: 'validation_error',
      },
      { entity: 'forms', action: 'created', old_id: 'fm_old_1', new_id: 'fm_new_1' },
    ];

    render(<SnapshotPreview summary={summary} log={log} />);

    // Drawer is not present before click
    expect(screen.queryByTestId('snapshot-preview-drawer-workflows')).toBeNull();

    // Click workflows row
    const workflowRow = screen.getByTestId('snapshot-preview-row-workflows');
    expect(workflowRow.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(workflowRow);

    // Drawer appears with workflow entries only
    const drawer = screen.getByTestId('snapshot-preview-drawer-workflows');
    expect(drawer).toBeTruthy();
    expect(workflowRow.getAttribute('aria-expanded')).toBe('true');

    // Workflow log entries visible
    expect(within(drawer).getByText(/wf_old_1/)).toBeTruthy();
    expect(within(drawer).getByText(/wf_old_2/)).toBeTruthy();
    expect(within(drawer).getByText('validation_error')).toBeTruthy();

    // Forms entry NOT in workflows drawer
    expect(within(drawer).queryByText(/fm_old_1/)).toBeNull();

    // Forms drawer not opened
    expect(screen.queryByTestId('snapshot-preview-drawer-forms')).toBeNull();

    // Click again on the row → drawer collapses
    fireEvent.click(workflowRow);
    expect(screen.queryByTestId('snapshot-preview-drawer-workflows')).toBeNull();
    expect(workflowRow.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the empty-state message when summary has no totals > 0', () => {
    const emptySummary: ImportSummary = {
      total_entities: 0,
      totals: {} as ImportSummary['totals'],
      id_mapping: emptyMapping,
    };

    render(<SnapshotPreview summary={emptySummary} log={[]} />);

    expect(screen.getByText('Aucun changement')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('also renders empty-state when all totals sum to zero', () => {
    const summary = buildSummary({
      workflows: { created: 0, skipped: 0, failed: 0 },
    });

    render(<SnapshotPreview summary={summary} log={[]} />);

    expect(screen.getByText('Aucun changement')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders status badges with the correct intent class per column', () => {
    const summary = buildSummary({
      workflows: { created: 5, skipped: 2, failed: 1 },
    });

    render(<SnapshotPreview summary={summary} log={[]} />);

    const row = screen.getByTestId('snapshot-preview-row-workflows');
    const cells = within(row).getAllByRole('cell');

    // created cell → success badge (text-success-700)
    const createdBadge = cells[1]!.querySelector('span');
    expect(createdBadge).toBeTruthy();
    expect(createdBadge!.className).toMatch(/success/);

    // skipped cell → warning badge
    const skippedBadge = cells[2]!.querySelector('span');
    expect(skippedBadge!.className).toMatch(/warning/);

    // failed cell → danger badge
    const failedBadge = cells[3]!.querySelector('span');
    expect(failedBadge!.className).toMatch(/danger/);
  });
});
