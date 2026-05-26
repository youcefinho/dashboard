// ── clients-engine.test.ts — Tests RENFORCEMENT clients-engine.ts ──────────
//
// Couvre helpers PURS multi-tenant clients :
//   - CLIENT_ERROR_CODES + VALID_MODULES + CORE_MODULES + MODULE_DEPENDENCIES
//   - validateSlug + generateSlugFromName + validateHostname
//   - validateClientInput (champs requis/optionnels/format)
//   - provisionClientPayload (10 inserts prep)
//   - validateModuleActivation / validateModuleDeactivation
//   - isLegacyTenant / isClientInTenantScope

import { describe, it, expect } from 'vitest';
import {
  CLIENT_ERROR_CODES,
  VALID_MODULES,
  CORE_MODULES,
  MODULE_DEPENDENCIES,
  VALID_COUNTRIES,
  validateSlug,
  generateSlugFromName,
  validateHostname,
  validateClientInput,
  provisionClientPayload,
  validateModuleActivation,
  validateModuleDeactivation,
  isLegacyTenant,
  isClientInTenantScope,
} from '../lib/clients-engine';

// ════════════════════════════════════════════════════════════════════════════
// Error codes + frozen lists
// ════════════════════════════════════════════════════════════════════════════

describe('CLIENT_ERROR_CODES', () => {
  it('expose >= 10 codes', () => {
    expect(Object.keys(CLIENT_ERROR_CODES).length).toBeGreaterThanOrEqual(10);
  });
  it('codes critiques', () => {
    expect(CLIENT_ERROR_CODES.MISSING_NAME).toBe('MISSING_NAME');
    expect(CLIENT_ERROR_CODES.INVALID_SLUG).toBe('INVALID_SLUG');
    expect(CLIENT_ERROR_CODES.TENANT_FORBIDDEN).toBe('TENANT_FORBIDDEN');
    expect(CLIENT_ERROR_CODES.MODULE_DEPENDENCY).toBe('MODULE_DEPENDENCY');
  });
});

describe('VALID_MODULES + CORE_MODULES', () => {
  it('VALID_MODULES inclut crm/leads/pipeline + ecommerce', () => {
    expect(VALID_MODULES).toContain('crm');
    expect(VALID_MODULES).toContain('leads');
    expect(VALID_MODULES).toContain('pipeline');
    expect(VALID_MODULES).toContain('ecommerce');
    expect(VALID_MODULES).toContain('booking');
    expect(VALID_MODULES.length).toBeGreaterThanOrEqual(10);
  });
  it('CORE_MODULES = crm/leads/pipeline', () => {
    expect(CORE_MODULES.has('crm')).toBe(true);
    expect(CORE_MODULES.has('leads')).toBe(true);
    expect(CORE_MODULES.has('pipeline')).toBe(true);
    expect(CORE_MODULES.has('ecommerce')).toBe(false);
  });
  it('MODULE_DEPENDENCIES.ecommerce requiert invoicing', () => {
    expect(MODULE_DEPENDENCIES.ecommerce).toContain('invoicing');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateSlug
// ════════════════════════════════════════════════════════════════════════════

describe('validateSlug', () => {
  it('kebab-case 3-50 chars OK', () => {
    expect(validateSlug('mon-client')).toBe(true);
    expect(validateSlug('mathis-guimont')).toBe(true);
    expect(validateSlug('abc')).toBe(true);
    expect(validateSlug('client-2026-pro')).toBe(true);
  });
  it('rejette < 3 chars', () => {
    expect(validateSlug('ab')).toBe(false);
    expect(validateSlug('a')).toBe(false);
  });
  it('rejette > 50 chars', () => {
    expect(validateSlug('a'.repeat(51))).toBe(false);
  });
  it('rejette uppercase', () => {
    expect(validateSlug('Mon-Client')).toBe(false);
  });
  it('rejette underscores et espaces', () => {
    expect(validateSlug('mon_client')).toBe(false);
    expect(validateSlug('mon client')).toBe(false);
  });
  it('rejette tirets en début/fin/doubles', () => {
    expect(validateSlug('-mon-client')).toBe(false);
    expect(validateSlug('mon-client-')).toBe(false);
    expect(validateSlug('mon--client')).toBe(false);
  });
  it('rejette caractères spéciaux', () => {
    expect(validateSlug('mon.client')).toBe(false);
    expect(validateSlug('mon@client')).toBe(false);
  });
  it('rejette non-string', () => {
    expect(validateSlug(null)).toBe(false);
    expect(validateSlug(42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// generateSlugFromName
// ════════════════════════════════════════════════════════════════════════════

describe('generateSlugFromName', () => {
  it('nom simple → kebab', () => {
    expect(generateSlugFromName('Mon Client')).toBe('mon-client');
  });
  it('strip accents', () => {
    expect(generateSlugFromName('Mathis Guimont')).toBe('mathis-guimont');
    expect(generateSlugFromName('Émile Lévesque')).toBe('emile-levesque');
  });
  it('strip caractères spéciaux', () => {
    expect(generateSlugFromName('Acme & Co., Inc.')).toBe('acme-co-inc');
  });
  it('non-string → ""', () => {
    expect(generateSlugFromName(null as never)).toBe('');
  });
  it('cap à 50 chars', () => {
    const slug = generateSlugFromName('a'.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateHostname
// ════════════════════════════════════════════════════════════════════════════

describe('validateHostname', () => {
  it('hostnames valides', () => {
    expect(validateHostname('example.com')).toBe(true);
    expect(validateHostname('crm.intralys.com')).toBe(true);
    expect(validateHostname('a-b.c-d.example.com')).toBe(true);
  });
  it('hostnames invalides', () => {
    expect(validateHostname('')).toBe(false);
    expect(validateHostname('localhost')).toBe(false); // pas de TLD
    expect(validateHostname('http://example.com')).toBe(false);
    expect(validateHostname('-bad.com')).toBe(false);
  });
  it('rejette non-string', () => {
    expect(validateHostname(null)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateClientInput
// ════════════════════════════════════════════════════════════════════════════

describe('validateClientInput', () => {
  it('input minimal valide → OK', () => {
    const r = validateClientInput({ name: 'Mon Client' });
    expect(r.ok).toBe(true);
  });
  it('missing name → MISSING_NAME', () => {
    const r = validateClientInput({});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_NAME');
  });
  it('name trop court → MISSING_NAME', () => {
    const r = validateClientInput({ name: 'A' });
    expect(r.ok).toBe(false);
  });
  it('name trop long → NAME_TOO_LONG', () => {
    const r = validateClientInput({ name: 'A'.repeat(121) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NAME_TOO_LONG');
  });
  it('slug valide OK', () => {
    const r = validateClientInput({ name: 'Acme', slug: 'mon-client' });
    expect(r.ok).toBe(true);
  });
  it('slug invalide → INVALID_SLUG', () => {
    const r = validateClientInput({ name: 'Acme', slug: 'Mon Slug!' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_SLUG');
  });
  it('country supporté OK', () => {
    const r = validateClientInput({ name: 'Acme', country: 'CA' });
    expect(r.ok).toBe(true);
  });
  it('country non supporté → INVALID_COUNTRY', () => {
    const r = validateClientInput({ name: 'Acme', country: 'ZZ' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_COUNTRY');
  });
  it('email invalide → INVALID_INPUT', () => {
    const r = validateClientInput({ name: 'Acme', email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('email');
  });
  it('email valide OK', () => {
    const r = validateClientInput({ name: 'Acme', email: 'contact@example.com' });
    expect(r.ok).toBe(true);
  });
  it('modules array invalide → INVALID_MODULE', () => {
    const r = validateClientInput({ name: 'Acme', modules: ['crm', 'xxx'] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_MODULE');
  });
  it('modules array valide OK', () => {
    const r = validateClientInput({ name: 'Acme', modules: ['crm', 'leads', 'ecommerce'] });
    expect(r.ok).toBe(true);
  });
  it('primary_color hex 6 OK', () => {
    const r = validateClientInput({ name: 'Acme', primary_color: '#aabbcc' });
    expect(r.ok).toBe(true);
  });
  it('primary_color hex sans # OK', () => {
    const r = validateClientInput({ name: 'Acme', primary_color: 'aabbcc' });
    expect(r.ok).toBe(true);
  });
  it('primary_color invalide → INVALID_INPUT', () => {
    const r = validateClientInput({ name: 'Acme', primary_color: 'red' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('primary_color');
  });
  it('site_url URL OK', () => {
    const r = validateClientInput({ name: 'Acme', site_url: 'https://example.com' });
    expect(r.ok).toBe(true);
  });
  it('site_url hostname brut OK', () => {
    const r = validateClientInput({ name: 'Acme', site_url: 'example.com' });
    expect(r.ok).toBe(true);
  });
  it('site_url invalide → INVALID_INPUT', () => {
    const r = validateClientInput({ name: 'Acme', site_url: 'not a url' });
    expect(r.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// provisionClientPayload
// ════════════════════════════════════════════════════════════════════════════

describe('provisionClientPayload', () => {
  it('génère 4 payloads (clientRow + settings + pipeline + modules)', () => {
    const out = provisionClientPayload({ name: 'Mon Client', country: 'CA' }, 'cl_1');
    expect(out.clientRow.id).toBe('cl_1');
    expect(out.clientRow.name).toBe('Mon Client');
    expect(out.defaultSettings.client_id).toBe('cl_1');
    expect(out.defaultPipeline.client_id).toBe('cl_1');
    expect(out.defaultModules).toBeDefined();
  });
  it('slug auto-généré depuis name', () => {
    const out = provisionClientPayload({ name: 'Mon Client' }, 'cl_1');
    expect(out.clientRow.slug).toBe('mon-client');
  });
  it('slug fourni respecté', () => {
    const out = provisionClientPayload({ name: 'Acme', slug: 'custom-slug' }, 'cl_1');
    expect(out.clientRow.slug).toBe('custom-slug');
  });
  it('country CA → fr-CA + CAD + Toronto', () => {
    const out = provisionClientPayload({ name: 'Acme', country: 'CA' }, 'cl_1');
    expect(out.defaultSettings.language).toBe('fr-CA');
    expect(out.defaultSettings.currency).toBe('CAD');
    expect(out.defaultSettings.timezone).toBe('America/Toronto');
  });
  it('country FR → fr-CA + EUR + Paris', () => {
    const out = provisionClientPayload({ name: 'Acme', country: 'FR' }, 'cl_1');
    expect(out.defaultSettings.language).toBe('fr-CA');
    expect(out.defaultSettings.currency).toBe('EUR');
    expect(out.defaultSettings.timezone).toBe('Europe/Paris');
  });
  it('country US → en-US + USD + UTC', () => {
    const out = provisionClientPayload({ name: 'Acme', country: 'US' }, 'cl_1');
    expect(out.defaultSettings.language).toBe('en-US');
    expect(out.defaultSettings.currency).toBe('USD');
    expect(out.defaultSettings.timezone).toBe('UTC');
  });
  it('agencyId injecté', () => {
    const out = provisionClientPayload({ name: 'Acme' }, 'cl_1', 'ag_42');
    expect(out.clientRow.agency_id).toBe('ag_42');
  });
  it('CORE_MODULES toujours inclus', () => {
    const out = provisionClientPayload({ name: 'Acme' }, 'cl_1');
    expect(out.defaultModules).toContain('crm');
    expect(out.defaultModules).toContain('leads');
    expect(out.defaultModules).toContain('pipeline');
  });
  it('modules user ajoutés sans dupliquer core', () => {
    const out = provisionClientPayload(
      { name: 'X', modules: ['crm', 'ecommerce'] as never },
      'cl_1',
    );
    // crm = core, ecommerce = ajouté. Pas de doublon.
    const crmCount = out.defaultModules.filter((m) => m === 'crm').length;
    expect(crmCount).toBe(1);
    expect(out.defaultModules).toContain('ecommerce');
  });
  it('pipeline default = 5 stages', () => {
    const out = provisionClientPayload({ name: 'Acme' }, 'cl_1');
    expect(out.defaultPipeline.stages).toHaveLength(5);
    expect(out.defaultPipeline.stages[0].key).toBe('new');
    expect(out.defaultPipeline.stages[4].key).toBe('lost');
  });
  it('primary_color sans # normalisé', () => {
    const out = provisionClientPayload({ name: 'Acme', primary_color: 'aabbcc' }, 'cl_1');
    expect(out.clientRow.primary_color).toBe('#aabbcc');
  });
  it('primary_color invalide → null', () => {
    const out = provisionClientPayload({ name: 'Acme', primary_color: 'red' }, 'cl_1');
    expect(out.clientRow.primary_color).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateModuleActivation
// ════════════════════════════════════════════════════════════════════════════

describe('validateModuleActivation', () => {
  it('activate module nouveau OK', () => {
    const r = validateModuleActivation(['crm', 'leads', 'pipeline'], 'booking');
    expect(r.ok).toBe(true);
  });
  it('activate déjà actif → already_active', () => {
    const r = validateModuleActivation(['crm', 'leads', 'pipeline', 'booking'], 'booking');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('already_active');
  });
  it('activate core idempotent OK', () => {
    const r = validateModuleActivation(['crm', 'leads', 'pipeline'], 'crm');
    expect(r.ok).toBe(true);
  });
  it('activate ecommerce sans invoicing → missing_dependency', () => {
    const r = validateModuleActivation(['crm', 'leads', 'pipeline'], 'ecommerce');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_dependency');
    expect(r.alsoActivate).toContain('invoicing');
  });
  it('activate ecommerce avec invoicing OK', () => {
    const r = validateModuleActivation(
      ['crm', 'leads', 'pipeline', 'invoicing'],
      'ecommerce',
    );
    expect(r.ok).toBe(true);
  });
  it('module inconnu → invalid_module', () => {
    const r = validateModuleActivation(['crm'], 'xxx');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_module');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateModuleDeactivation
// ════════════════════════════════════════════════════════════════════════════

describe('validateModuleDeactivation', () => {
  it('deactivate module non-core actif OK', () => {
    const r = validateModuleDeactivation(['crm', 'leads', 'pipeline', 'booking'], 'booking');
    expect(r.ok).toBe(true);
  });
  it('deactivate core → core_module', () => {
    const r = validateModuleDeactivation(['crm', 'leads', 'pipeline'], 'crm');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('core_module');
  });
  it('deactivate module inactif → not_active', () => {
    const r = validateModuleDeactivation(['crm', 'leads', 'pipeline'], 'booking');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_active');
  });
  it('deactivate invoicing qui a un dependant ecommerce → dependency_in_use', () => {
    const r = validateModuleDeactivation(
      ['crm', 'leads', 'pipeline', 'invoicing', 'ecommerce'],
      'invoicing',
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dependency_in_use');
  });
  it('deactivate invoicing sans ecommerce OK', () => {
    const r = validateModuleDeactivation(
      ['crm', 'leads', 'pipeline', 'invoicing'],
      'invoicing',
    );
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Tenant helpers
// ════════════════════════════════════════════════════════════════════════════

describe('isLegacyTenant + isClientInTenantScope', () => {
  it('auth absent → legacy', () => {
    expect(isLegacyTenant(undefined)).toBe(true);
  });
  it('auth sans tenant → legacy', () => {
    expect(isLegacyTenant({})).toBe(true);
  });
  it('auth tenant agencyId null → legacy', () => {
    expect(isLegacyTenant({ tenant: { agencyId: null } })).toBe(true);
  });
  it('auth tenant agencyId set → NOT legacy', () => {
    expect(isLegacyTenant({ tenant: { agencyId: 'ag_1' } })).toBe(false);
  });
  it('legacy : scope toujours OK', () => {
    expect(isClientInTenantScope(undefined, 'cl_1')).toBe(true);
  });
  it('mode agence : clientId in accessibleClientIds → OK', () => {
    const auth = { tenant: { agencyId: 'ag_1', accessibleClientIds: ['cl_1', 'cl_2'] } };
    expect(isClientInTenantScope(auth, 'cl_1')).toBe(true);
    expect(isClientInTenantScope(auth, 'cl_3')).toBe(false);
  });
  it('mode agence : accessible vide → false', () => {
    const auth = { tenant: { agencyId: 'ag_1', accessibleClientIds: [] } };
    expect(isClientInTenantScope(auth, 'cl_1')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALID_COUNTRIES sanity
// ════════════════════════════════════════════════════════════════════════════

describe('VALID_COUNTRIES', () => {
  it('inclut CA/US/FR + plusieurs autres', () => {
    expect(VALID_COUNTRIES).toContain('CA');
    expect(VALID_COUNTRIES).toContain('US');
    expect(VALID_COUNTRIES).toContain('FR');
    expect(VALID_COUNTRIES.length).toBeGreaterThanOrEqual(10);
  });
});
