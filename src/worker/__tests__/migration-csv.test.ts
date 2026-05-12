import { describe, it, expect } from 'vitest';
import { parseCsvRobust } from '../migration-ghl-csv';

describe('GHL Migration CSV', () => {
  it('parseCsvRobust - séparateur virgule', () => {
    const csv = `name,email,phone\nJohn Doe,john@test.com,123456`;
    const rows = parseCsvRobust(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(['name', 'email', 'phone']);
    expect(rows[1]).toEqual(['John Doe', 'john@test.com', '123456']);
  });

  it('parseCsvRobust - séparateur point-virgule', () => {
    const csv = `name;email;phone\nJohn Doe;john@test.com;123456`;
    const rows = parseCsvRobust(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(['name', 'email', 'phone']);
    expect(rows[1]).toEqual(['John Doe', 'john@test.com', '123456']);
  });

  it('parseCsvRobust - guillemets avec virgules internes', () => {
    const csv = `name,address\nJohn,"123 Main St, Apt 4"`;
    const rows = parseCsvRobust(csv);
    expect(rows[1]).toEqual(['John', '123 Main St, Apt 4']);
  });

  it('parseCsvRobust - gestion du BOM UTF-8', () => {
    const csv = String.fromCharCode(0xFEFF) + `name,email\nJohn,john@test.com`;
    const rows = parseCsvRobust(csv);
    expect(rows[0]).toEqual(['name', 'email']);
  });
});
