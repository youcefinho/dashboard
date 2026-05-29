// ── _helpers.ts — mock D1 + fs/execSync partagé (S2/S3) ──
// ⚠ SIGNATURE FIGÉE — réutilisée par les Managers M2/M3. Ne pas casser l'API.
//
// Mock D1 :  db.prepare(sql).bind(...args).all() / .first() / .run()
//   - .all()   → { results: any[] }
//   - .first() → any | null  (1ère ligne de results, ou null)
//   - .run()   → { success: true, meta: { changes, last_row_id } }
//   - Les requêtes/bindings sont enregistrés dans `db.calls` pour assertions.
//   - `seed(sql-substring, rows)` : programme la réponse d'un SELECT contenant
//     la sous-chaîne donnée (matching insensible à la casse, 1er match gagne).

export interface MockStatement {
  bind: (...args: any[]) => MockStatement;
  all: () => Promise<{ results: any[] }> | { results: any[] };
  first: () => Promise<any> | any;
  run: () => Promise<{ success: boolean; meta: any }> | { success: boolean; meta: any };
}

export interface MockD1 {
  prepare: (sql: string) => MockStatement;
  calls: Array<{ sql: string; args: any[] }>;
  seed: (sqlSubstring: string, rows: any[]) => void;
  /** Lignes renvoyées par défaut pour tout SELECT non-seedé. */
  defaultRows: any[];
}

export function createMockD1(): MockD1 {
  const seeds: Array<{ needle: string; rows: any[] }> = [];
  const db: MockD1 = {
    calls: [],
    defaultRows: [],
    seed(sqlSubstring: string, rows: any[]) {
      seeds.push({ needle: sqlSubstring.toLowerCase(), rows });
    },
    prepare(sql: string): MockStatement {
      let boundArgs: any[] = [];
      const stmt: MockStatement = {
        bind(...args: any[]) {
          boundArgs = args;
          return stmt;
        },
        all() {
          db.calls.push({ sql, args: boundArgs });
          return { results: resolveRows(sql, boundArgs) };
        },
        first() {
          db.calls.push({ sql, args: boundArgs });
          const rows = resolveRows(sql, boundArgs);
          return rows.length ? rows[0] : null;
        },
        run() {
          db.calls.push({ sql, args: boundArgs });
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        },
      };
      return stmt;
    },
  };

  function resolveRows(sql: string, boundArgs: any[] = []): any[] {
    const lower = sql.toLowerCase();
    let selectedRows: any[] = db.defaultRows;
    
    // Si la requête contient "count", on cherche d'abord les aiguilles contenant "count"
    const hasCount = lower.includes('count');
    let matchedSeed = null;
    
    if (hasCount) {
      matchedSeed = seeds.find(s => s.needle.includes('count') && lower.includes(s.needle));
    }
    
    if (!matchedSeed) {
      // On trie par longueur de needle décroissante pour avoir le match le plus spécifique d'abord
      const sortedSeeds = seeds
        .map((s, idx) => ({ ...s, idx }))
        .sort((a, b) => {
          const lenDiff = b.needle.length - a.needle.length;
          if (lenDiff !== 0) return lenDiff;
          return b.idx - a.idx;
        });
      for (const s of sortedSeeds) {
        if (lower.includes(s.needle)) {
          matchedSeed = s;
          break;
        }
      }
    }

    if (matchedSeed) {
      selectedRows = matchedSeed.rows;
    }

    if (!selectedRows || selectedRows.length === 0) {
      return selectedRows;
    }

    // Filtrage intelligent basé sur les bindings et la clause WHERE
    const isJoinQuery = /\bjoin\b/i.test(sql);
    const isOrQuery = /\bor\b/i.test(sql);
    const isUnionQuery = /\bunion\b/i.test(sql);
    const isInQuery = /\bin\b/i.test(sql);
    const selectCount = (lower.match(/\bselect\b/g) || []).length;

    if (isJoinQuery || isUnionQuery || isInQuery || selectCount > 1) {
      // Pour les requêtes complexes (JOIN, UNION, IN, sous-requêtes), le filtrage naïf
      // provoque des collisions et des rejets abusifs de lignes. On retourne les lignes du seed directement.
      return selectedRows;
    }

    // Extraction précise des colonnes et des opérateurs associés à chaque placeholder ?
    const segments = sql.split('?');
    const columns: Array<{ col: string; op: string }> = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const match = segment.match(/([\w\.]+)\s*(=|\blike\b|>|<|>=|<=)\s*$/i);
      if (match) {
        const col = match[1].toLowerCase();
        const cleanCol = col.split('.').pop() || col;
        const op = match[2].toLowerCase();
        columns.push({ col: cleanCol, op });
      } else {
        columns.push({ col: '', op: '' });
      }
    }

    if (columns.length > 0 && boundArgs.length > 0) {
      return selectedRows.filter(row => {
        if (!row || typeof row !== 'object') return true;

        if (isOrQuery) {
          // Logique OR : on garde la ligne si au moins un des champs match son binding
          let anyMatch = false;
          let hasMatchableField = false;
          for (let i = 0; i < Math.min(columns.length, boundArgs.length); i++) {
            const { col: colName, op } = columns[i];
            if (!colName || colName === 'id' || colName === 'phone' || colName === 'email') continue;
            const boundVal = boundArgs[i];
            const rowKey = Object.keys(row).find(k => k.toLowerCase() === colName);
            if (rowKey !== undefined) {
              hasMatchableField = true;
              const rowVal = row[rowKey];
              if (op === '=') {
                if (rowVal === boundVal) { anyMatch = true; break; }
              } else if (op === '<=') {
                if (rowVal <= boundVal) { anyMatch = true; break; }
              } else if (op === '>=') {
                if (rowVal >= boundVal) { anyMatch = true; break; }
              } else if (op === '<') {
                if (rowVal < boundVal) { anyMatch = true; break; }
              } else if (op === '>') {
                if (rowVal > boundVal) { anyMatch = true; break; }
              } else if (op === 'like') {
                const cleanBound = String(boundVal).replace(/%/g, '').toLowerCase();
                if (String(rowVal).toLowerCase().includes(cleanBound)) { anyMatch = true; break; }
              }
            }
          }
          return hasMatchableField ? anyMatch : true;
        } else {
          // Logique AND classique
          for (let i = 0; i < Math.min(columns.length, boundArgs.length); i++) {
            const { col: colName, op } = columns[i];
            if (!colName || colName === 'id' || colName === 'phone' || colName === 'email') continue;
            const boundVal = boundArgs[i];
            const rowKey = Object.keys(row).find(k => k.toLowerCase() === colName);
            if (rowKey !== undefined) {
              const rowVal = row[rowKey];
              if (op === '=') {
                if (rowVal !== boundVal) return false;
              } else if (op === '<=') {
                if (!(rowVal <= boundVal)) return false;
              } else if (op === '>=') {
                if (!(rowVal >= boundVal)) return false;
              } else if (op === '<') {
                if (!(rowVal < boundVal)) return false;
              } else if (op === '>') {
                if (!(rowVal > boundVal)) return false;
              } else if (op === 'like') {
                const cleanBound = String(boundVal).replace(/%/g, '').toLowerCase();
                if (!String(rowVal).toLowerCase().includes(cleanBound)) return false;
              }
            }
          }
          return true;
        }
      });
    }

    return selectedRows;
  }

  return db;
}

// ── Mock execSync — file un faux "wrangler" déterministe ──
// behavior: ((cmd) => string) | ((cmd) => throw Error)
export interface MockExecSync {
  fn: (cmd: string, opts?: any) => string;
  calls: string[];
  /** Programme une erreur si la commande contient `needle`. */
  failOn: (needle: string, errorMessage: string) => void;
  /** Réponse JSON par défaut pour les commandes --json. */
  jsonResult: any;
}

export function createMockExecSync(): MockExecSync {
  const failures: Array<{ needle: string; message: string }> = [];
  const mock: MockExecSync = {
    calls: [],
    jsonResult: [{ results: [] }],
    failOn(needle: string, message: string) {
      failures.push({ needle, message });
    },
    fn(cmd: string) {
      mock.calls.push(cmd);
      for (const f of failures) {
        if (cmd.includes(f.needle)) {
          const err: any = new Error(f.message);
          err.stderr = f.message;
          err.stdout = '';
          throw err;
        }
      }
      if (cmd.includes('--json')) return JSON.stringify(mock.jsonResult);
      return '';
    },
  };
  return mock;
}

// ── Mock fs — readdirSync / readFileSync / existsSync en mémoire ──
export interface MockFs {
  files: Record<string, string>;
  dirs: Record<string, string[]>;
  readdirSync: (dir: string) => string[];
  readFileSync: (path: string, enc?: any) => string;
  existsSync: (path: string) => boolean;
}

export function createMockFs(init?: {
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
}): MockFs {
  const fs: MockFs = {
    files: init?.files ?? {},
    dirs: init?.dirs ?? {},
    readdirSync(dir: string) {
      return fs.dirs[dir] ?? [];
    },
    readFileSync(path: string) {
      if (!(path in fs.files)) {
        throw new Error(`ENOENT mock: ${path}`);
      }
      return fs.files[path];
    },
    existsSync(path: string) {
      return path in fs.files;
    },
  };
  return fs;
}
