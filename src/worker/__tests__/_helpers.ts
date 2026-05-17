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
          return { results: resolveRows(sql) };
        },
        first() {
          db.calls.push({ sql, args: boundArgs });
          const rows = resolveRows(sql);
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

  function resolveRows(sql: string): any[] {
    const lower = sql.toLowerCase();
    for (const s of seeds) {
      if (lower.includes(s.needle)) return s.rows;
    }
    return db.defaultRows;
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
