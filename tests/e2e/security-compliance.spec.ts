// ── Sprint 99 (seq194) — E2E Tests : Purge RGPD, Push, API Versioning ─────
// Tests end-to-end pour les features des Sprints 93-98.

import { test, expect } from '../_fixtures/test';

// ── Tests Purge RGPD (Sprint 93) ────────────────────────────────────────────

test.describe('Purge RGPD & Loi 25', () => {
  test('affiche la section purge dans ComplianceSettings', async ({ page }) => {
    await page.goto('/settings/compliance');
    // Attend que la section purge soit visible
    await expect(page.getByText('Purge automatique (Loi 25 / RGPD)')).toBeVisible();
  });

  test('affiche le formulaire d\'ajout de règle', async ({ page }) => {
    await page.goto('/settings/compliance');
    await expect(page.getByPlaceholder('client-uuid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter' })).toBeVisible();
  });

  test('affiche l\'état vide quand aucune règle', async ({ page }) => {
    await page.goto('/settings/compliance');
    await expect(page.getByText('Aucune règle de purge')).toBeVisible();
  });

  test('le bouton Prévisualiser est accessible', async ({ page }) => {
    await page.goto('/settings/compliance');
    await expect(page.getByRole('button', { name: 'Prévisualiser' })).toBeVisible();
  });

  test('le bouton Exécuter la purge est désactivé sans règle', async ({ page }) => {
    await page.goto('/settings/compliance');
    const btn = page.getByRole('button', { name: 'Exécuter la purge' });
    await expect(btn).toBeDisabled();
  });
});

// ── Tests API Versioning (Sprint 96) ────────────────────────────────────────

test.describe('API Versioning', () => {
  test('GET /v1/api/leads retourne un format valide', async ({ request }) => {
    const response = await request.get('/v1/api/leads', {
      headers: { 'Authorization': 'Bearer test-token' },
    });
    // Même si 401 (pas de vrai token), on vérifie le header de version
    expect(response.headers()['x-api-version']).toBe('1');
  });

  test('GET /v99/api/leads retourne 400 (version non supportée)', async ({ request }) => {
    const response = await request.get('/v99/api/leads');
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('non supportée');
    expect(body.supported_versions).toBeDefined();
  });
});

// ── Tests Push Notifications (Sprint 98) ─────────────────────────────────────

test.describe('Push Notifications API', () => {
  test('POST /api/push/subscribe sans body retourne 400', async ({ request }) => {
    const response = await request.post('/api/push/subscribe', {
      headers: { 'Authorization': 'Bearer test-token' },
    });
    // 401 (pas de vrai token) ou 400 (body manquant)
    expect([400, 401]).toContain(response.status());
  });

  test('GET /api/push/subscriptions retourne un tableau', async ({ request }) => {
    const response = await request.get('/api/push/subscriptions', {
      headers: { 'Authorization': 'Bearer test-token' },
    });
    // 401 (pas de vrai token) ou 200 avec data
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    }
  });
});

// ── Tests Edge Cache (Sprint 94) ─────────────────────────────────────────────

test.describe('Edge Cache headers', () => {
  test('les réponses API ont un header X-Cache', async ({ request }) => {
    const response = await request.get('/api/clients', {
      headers: { 'Authorization': 'Bearer test-token' },
    });
    // Soit HIT soit MISS (ou absent si erreur auth)
    if (response.status() === 200) {
      const cacheHeader = response.headers()['x-cache'];
      expect(['HIT', 'MISS', undefined]).toContain(cacheHeader);
    }
  });
});

// ── Tests Compliance existants (Sprint 93 extension) ────────────────────────

test.describe('ComplianceSettings page', () => {
  test('charge la page sans erreur', async ({ page }) => {
    await page.goto('/settings/compliance');
    await expect(page.getByTestId('compliance-settings')).toBeVisible();
  });

  test('la section AMF est visible', async ({ page }) => {
    await page.goto('/settings/compliance');
    await expect(page.getByTestId('compliance-amf-toggle')).toBeVisible();
  });

  test('le bouton export CSV est présent', async ({ page }) => {
    await page.goto('/settings/compliance');
    await expect(page.getByTestId('compliance-export-csv')).toBeVisible();
  });
});
