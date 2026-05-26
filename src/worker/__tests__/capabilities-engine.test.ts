// ── capabilities-engine.test.ts — Tests RENFORCEMENT capabilities-engine ───
//
// Couvre helpers PURS RBAC : CAPABILITY_LIST (figé 12 caps seq80),
// ROLE_CAPABILITIES, hasCapability, hasAnyCapability, canAccessTenant,
// assertCapability throw, applyCapabilityOverrides, intersectCapabilities,
// filterValidCapabilities.

import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_LIST,
  CAPABILITY_SET,
  ROLE_CAPABILITIES,
  GENERIC_ROLES,
  isCapability,
  isGenericRole,
  capabilitiesForRole,
  hasCapability,
  hasAnyCapability,
  canAccessTenant,
  assertCapability,
  CapabilityError,
  intersectCapabilities,
  filterValidCapabilities,
  applyCapabilityOverrides,
} from '../lib/capabilities-engine';
import { ALL_CAPABILITIES } from '../capabilities';

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY_LIST — figé 12 caps seq80, ALIGNÉ avec capabilities.ts
// ════════════════════════════════════════════════════════════════════════════

describe('CAPABILITY_LIST', () => {
  it('contient exactement 12 capabilities', () => {
    expect(CAPABILITY_LIST.length).toBe(12);
  });
  it('strictement identique à ALL_CAPABILITIES de capabilities.ts (source)', () => {
    expect([...CAPABILITY_LIST].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });
  it('frozen — Object.isFrozen', () => {
    expect(Object.isFrozen(CAPABILITY_LIST)).toBe(true);
  });
  it('CAPABILITY_SET expose lookup O(1) sur les mêmes membres', () => {
    expect(CAPABILITY_SET.size).toBe(12);
    expect(CAPABILITY_SET.has('leads.read')).toBe(true);
    expect(CAPABILITY_SET.has('settings.manage')).toBe(true);
    expect(CAPABILITY_SET.has('not.a.cap')).toBe(false);
  });
});

describe('isCapability', () => {
  it('true pour caps connues', () => {
    expect(isCapability('leads.read')).toBe(true);
    expect(isCapability('ai.use')).toBe(true);
  });
  it('false pour invalides', () => {
    expect(isCapability('hack.everything')).toBe(false);
    expect(isCapability('')).toBe(false);
    expect(isCapability(null)).toBe(false);
    expect(isCapability(42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROLE_CAPABILITIES + capabilitiesForRole
// ════════════════════════════════════════════════════════════════════════════

describe('ROLE_CAPABILITIES', () => {
  it('owner = toutes', () => {
    expect(ROLE_CAPABILITIES.owner.size).toBe(12);
  });
  it('admin manque settings.manage uniquement', () => {
    expect(ROLE_CAPABILITIES.admin.has('settings.manage')).toBe(false);
    expect(ROLE_CAPABILITIES.admin.has('leads.delete')).toBe(true);
  });
  it('manager n\'a pas billing.view ni clients.manage', () => {
    expect(ROLE_CAPABILITIES.manager.has('billing.view')).toBe(false);
    expect(ROLE_CAPABILITIES.manager.has('clients.manage')).toBe(false);
    expect(ROLE_CAPABILITIES.manager.has('leads.write')).toBe(true);
  });
  it('member = leads.read/write + reports.view + ai.use uniquement', () => {
    expect(ROLE_CAPABILITIES.member.size).toBe(4);
    expect(ROLE_CAPABILITIES.member.has('leads.read')).toBe(true);
    expect(ROLE_CAPABILITIES.member.has('leads.delete')).toBe(false);
  });
  it('viewer = reports.view UNIQUEMENT', () => {
    expect(ROLE_CAPABILITIES.viewer.size).toBe(1);
    expect(ROLE_CAPABILITIES.viewer.has('reports.view')).toBe(true);
    expect(ROLE_CAPABILITIES.viewer.has('leads.read')).toBe(false);
  });
});

describe('capabilitiesForRole', () => {
  it('retourne un NOUVEAU Set (copy, mutation safe)', () => {
    const a = capabilitiesForRole('viewer');
    a.add('hack.cap');
    expect(ROLE_CAPABILITIES.viewer.has('hack.cap')).toBe(false);
  });
  it('Set vide pour rôle inconnu', () => {
    expect(capabilitiesForRole('hacker').size).toBe(0);
    expect(capabilitiesForRole(null).size).toBe(0);
    expect(capabilitiesForRole(undefined).size).toBe(0);
  });
});

describe('GENERIC_ROLES + isGenericRole', () => {
  it('5 rôles figés', () => {
    expect(GENERIC_ROLES.length).toBe(5);
  });
  it('isGenericRole', () => {
    expect(isGenericRole('owner')).toBe(true);
    expect(isGenericRole('viewer')).toBe(true);
    expect(isGenericRole('superuser')).toBe(false);
    expect(isGenericRole(null)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// hasCapability
// ════════════════════════════════════════════════════════════════════════════

describe('hasCapability', () => {
  it('exact match dans Set', () => {
    expect(hasCapability(new Set(['leads.read']), 'leads.read')).toBe(true);
  });
  it('match dans array', () => {
    expect(hasCapability(['leads.read', 'export'], 'export')).toBe(true);
  });
  it('missing cap → false', () => {
    expect(hasCapability(new Set(['leads.read']), 'leads.delete')).toBe(false);
  });
  it('Set vide → false', () => {
    expect(hasCapability(new Set(), 'leads.read')).toBe(false);
  });
  it('userCaps null/undefined → false', () => {
    expect(hasCapability(null, 'leads.read')).toBe(false);
    expect(hasCapability(undefined, 'leads.read')).toBe(false);
  });
  it('AND-logic sur array required : tout doit matcher', () => {
    const caps = new Set(['leads.read', 'export']);
    expect(hasCapability(caps, ['leads.read', 'export'])).toBe(true);
    expect(hasCapability(caps, ['leads.read', 'team.manage'])).toBe(false);
  });
  it('array required vide → false', () => {
    expect(hasCapability(new Set(['leads.read']), [])).toBe(false);
  });
});

describe('hasAnyCapability', () => {
  it('true si au moins une matche', () => {
    const caps = new Set(['leads.read']);
    expect(hasAnyCapability(caps, ['leads.read', 'team.manage'])).toBe(true);
  });
  it('false si aucune ne matche', () => {
    const caps = new Set(['leads.read']);
    expect(hasAnyCapability(caps, ['team.manage', 'export'])).toBe(false);
  });
  it('null → false', () => {
    expect(hasAnyCapability(null, ['leads.read'])).toBe(false);
  });
  it('required vide → false', () => {
    expect(hasAnyCapability(new Set(['leads.read']), [])).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// canAccessTenant
// ════════════════════════════════════════════════════════════════════════════

describe('canAccessTenant', () => {
  it('userTenant null (legacy) → toujours OK', () => {
    expect(canAccessTenant(null, 'client_X')).toBe(true);
    expect(canAccessTenant(undefined, 'client_X')).toBe(true);
  });
  it('targetClient null → OK (ressource non-tenant)', () => {
    expect(canAccessTenant({ clientId: 'client_A' }, null)).toBe(true);
  });
  it('même clientId → OK', () => {
    expect(canAccessTenant({ clientId: 'client_A' }, 'client_A')).toBe(true);
  });
  it('clientId différent + non-owner → REJET', () => {
    expect(canAccessTenant({ clientId: 'client_A', role: 'manager' }, 'client_B')).toBe(false);
    expect(canAccessTenant({ clientId: 'client_A', role: 'viewer' }, 'client_B')).toBe(false);
  });
  it('owner d\'agence → OK même clientId différent (DB lookup à charge du caller)', () => {
    expect(canAccessTenant(
      { clientId: 'client_A', role: 'owner', agencyId: 'agency_1' },
      'client_B',
    )).toBe(true);
  });
  it('owner sans agencyId → REJET (cohérence : pas d\'agence = pas de cross-client)', () => {
    expect(canAccessTenant(
      { clientId: 'client_A', role: 'owner', agencyId: null },
      'client_B',
    )).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// assertCapability + CapabilityError
// ════════════════════════════════════════════════════════════════════════════

describe('assertCapability', () => {
  it('ne throw pas si capability présente', () => {
    expect(() => assertCapability({ capabilities: new Set(['leads.read']) }, 'leads.read')).not.toThrow();
  });
  it('throw CapabilityError si missing', () => {
    expect(() => assertCapability({ capabilities: new Set(['leads.read']) }, 'leads.delete'))
      .toThrow(CapabilityError);
  });
  it('throw si auth null', () => {
    expect(() => assertCapability(null, 'leads.read')).toThrow(CapabilityError);
  });
  it('throw si capabilities absent de auth', () => {
    expect(() => assertCapability({}, 'leads.read')).toThrow(CapabilityError);
  });
  it('CapabilityError expose code + missing', () => {
    try {
      assertCapability({}, 'leads.delete');
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError);
      expect((e as CapabilityError).code).toBe('CAPABILITY_DENIED');
      expect((e as CapabilityError).missing).toBe('leads.delete');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// intersectCapabilities + filterValidCapabilities + applyCapabilityOverrides
// ════════════════════════════════════════════════════════════════════════════

describe('intersectCapabilities', () => {
  it('intersection correcte', () => {
    const user = new Set(['leads.read', 'export', 'ai.use']);
    expect(intersectCapabilities(user, ['leads.read', 'team.manage', 'ai.use']))
      .toEqual(['leads.read', 'ai.use']);
  });
  it('userCaps null → array vide', () => {
    expect(intersectCapabilities(null, ['leads.read'])).toEqual([]);
  });
});

describe('filterValidCapabilities', () => {
  it('élimine les capabilities inconnues', () => {
    expect(filterValidCapabilities(['leads.read', 'fake.cap', 'export']))
      .toEqual(['leads.read', 'export']);
  });
  it('null/empty → []', () => {
    expect(filterValidCapabilities(null)).toEqual([]);
    expect(filterValidCapabilities([])).toEqual([]);
  });
});

describe('applyCapabilityOverrides', () => {
  it('granted=1 ajoute', () => {
    const base = new Set<string>(['leads.read']);
    const r = applyCapabilityOverrides(base, [{ capability: 'export', granted: 1 }]);
    expect(r.has('export')).toBe(true);
    expect(r.has('leads.read')).toBe(true);
  });
  it('granted=0 retire', () => {
    const base = new Set<string>(['leads.read', 'export']);
    const r = applyCapabilityOverrides(base, [{ capability: 'export', granted: 0 }]);
    expect(r.has('export')).toBe(false);
    expect(r.has('leads.read')).toBe(true);
  });
  it('override sur capability invalide ignoré', () => {
    const base = new Set<string>(['leads.read']);
    const r = applyCapabilityOverrides(base, [{ capability: 'fake.cap', granted: 1 }]);
    expect(r.has('fake.cap')).toBe(false);
    expect(r.size).toBe(1);
  });
  it('immutabilité : ne mute pas le base', () => {
    const base = new Set<string>(['leads.read']);
    applyCapabilityOverrides(base, [{ capability: 'export', granted: 1 }]);
    expect(base.has('export')).toBe(false);
  });
  it('combine ajout + retrait', () => {
    const base = new Set<string>(['leads.read', 'export']);
    const r = applyCapabilityOverrides(base, [
      { capability: 'export', granted: 0 },
      { capability: 'ai.use', granted: 1 },
      { capability: 'team.manage', granted: 1 },
    ]);
    expect([...r].sort()).toEqual(['ai.use', 'leads.read', 'team.manage']);
  });
});
