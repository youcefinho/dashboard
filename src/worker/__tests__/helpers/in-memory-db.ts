/**
 * Helper : simule une base de données D1 en mémoire pour les tests d'idempotence.
 * Stocke les rows dans un Map avec vérification de contraintes UNIQUE réelles.
 */

type Row = Record<string, unknown>;

interface Table {
  rows: Row[];
  uniqueConstraints: string[][]; // Ex: [['client_id', 'intralys_resource', 'external_source', 'external_id']]
}

export function createInMemoryDB() {
  const tables = new Map<string, Table>();

  // Initialiser les tables de migration
  tables.set('leads', {
    rows: [],
    uniqueConstraints: [['client_id', 'email']] // Simplifié pour les tests
  });

  tables.set('migration_id_map', {
    rows: [],
    uniqueConstraints: [['client_id', 'intralys_resource', 'external_source', 'external_id']]
  });

  tables.set('lead_tags', {
    rows: [],
    uniqueConstraints: [['lead_id', 'tag']]
  });

  tables.set('messages', {
    rows: [],
    uniqueConstraints: [['client_id', 'external_id']]
  });

  tables.set('migration_sessions', {
    rows: [],
    uniqueConstraints: [['id']]
  });

  tables.set('custom_field_defs', {
    rows: [],
    uniqueConstraints: [['client_id', 'slug']]
  });

  tables.set('custom_field_values', {
    rows: [],
    uniqueConstraints: [] // REPLACE = pas de contrainte bloquante
  });

  function checkUnique(table: Table, row: Row, isOrIgnore: boolean): boolean {
    for (const constraint of table.uniqueConstraints) {
      const existing = table.rows.find(r =>
        constraint.every(col => r[col] === row[col] && row[col] !== '' && row[col] != null)
      );
      if (existing) {
        if (isOrIgnore) return false; // Silencieux
        throw new Error(`UNIQUE constraint failed: ${constraint.join(', ')}`);
      }
    }
    return true;
  }

  // Wrapper compatible D1
  const db = {
    prepare(sql: string) {
      let boundParams: unknown[] = [];
      return {
        bind(...params: unknown[]) {
          boundParams = params;
          return this;
        },
        async run() {
          // Détection simple du type de requête
          const sqlLower = sql.toLowerCase().trim();
          const isOrIgnore = sqlLower.includes('or ignore');
          const isOrReplace = sqlLower.includes('or replace');

          if (sqlLower.startsWith('insert')) {
            // Extraire le nom de la table
            const tableMatch = sql.match(/into\s+(\w+)/i);
            const tableName = tableMatch?.[1];
            if (!tableName || !tables.has(tableName)) {
              return { success: true, meta: { changes: 0 } };
            }

            // Extraire les noms de colonnes
            const colMatch = sql.match(/\(([^)]+)\)\s*values/i);
            const columns = colMatch?.[1]?.split(',').map(c => c.trim()) || [];

            const row: Row = {};
            columns.forEach((col, idx) => {
              row[col] = boundParams[idx] ?? null;
            });

            const table = tables.get(tableName)!;
            
            if (isOrReplace) {
              // Supprimer l'existant si contrainte touchée, puis insérer
              for (const constraint of table.uniqueConstraints) {
                const existingIdx = table.rows.findIndex(r =>
                  constraint.every(col => r[col] === row[col] && row[col] !== '' && row[col] != null)
                );
                if (existingIdx !== -1) {
                  table.rows.splice(existingIdx, 1);
                }
              }
              table.rows.push(row);
              return { success: true, meta: { changes: 1 } };
            }

            const canInsert = checkUnique(table, row, isOrIgnore);
            if (canInsert) {
              table.rows.push(row);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }

          if (sqlLower.startsWith('select')) {
            // Simplification : on ne parse pas les WHERE, on retourne tout
            return { success: true, results: [] };
          }

          if (sqlLower.startsWith('update')) {
            return { success: true, meta: { changes: 0 } };
          }

          return { success: true, meta: { changes: 0 } };
        },
        async first() {
          const sqlLower = sql.toLowerCase().trim();
          if (sqlLower.includes('from leads') && sqlLower.includes('where')) {
            const tableName = 'leads';
            const table = tables.get(tableName)!;
            // Cherche par email + client_id (params[0] = email, params[1] = client_id pour notre cas)
            const found = table.rows.find(r => 
              r.email === boundParams[0] && r.client_id === boundParams[1]
            );
            return found ? { id: found.id } : null;
          }
          return null;
        },
        async all() {
          return { results: [], success: true };
        }
      };
    },

    // Helper pour inspecter les tables dans les tests
    _getTable(name: string) {
      return tables.get(name);
    },
    _getRowCount(name: string) {
      return tables.get(name)?.rows.length || 0;
    }
  };

  return db;
}
