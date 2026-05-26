// ── data-reconcile.ts — Sprint S-D2 (LOT D, Manager C) ──────────────────────
//
// Job de réconciliation d'intégrité référentielle **READ-ONLY STRICT**.
//
// Objectif : détecter (NE corrige RIEN) les FK orphelines — lignes dont la
// clé étrangère pointe vers un parent disparu. SQLite/D1 n'applique pas
// `PRAGMA foreign_keys` par défaut, et `schema.sql` n'a que ~5 `ON DELETE` ;
// des suppressions de `clients`/`leads`/`users` laissent donc des enfants
// orphelins silencieux. Cet endpoint produit un **rapport de diagnostic**.
//
// Contrat §6.5 (figé SPRINT-D.md) :
//   - Garde admin LOCALE (réplique pattern admin-analytics.ts:16-23) → 403.
//   - ZÉRO mutation : aucun INSERT/UPDATE/DELETE/ALTER. Que des SELECT COUNT(*).
//   - Best-effort : table absente / DB throw → relation sautée, JAMAIS 500.
//   - Réponse `{ data: { orphans: [{ relation, count }], checked_at } }` (200).
//   - Réutilise `json()` de helpers.ts (FIGÉ). Erreur format `{ error:<string> }`.
//
// Relations FK auditées (réelles, vérifiées par grep schema.sql +
// migration-phase1/2/4/5 + sprint3 + sprintE1-m1) — cf docs/DATA-INTEGRITY-S-D2.md.

import type { Env } from './types';
import { json } from './helpers';

const ADMIN_ROLES = new Set(['admin', 'owner']);

// Garde admin LOCALE — réplique exacte du pattern admin-analytics.ts:16-23.
// (PAS d'import cross-module du requireAdmin : défense en profondeur, copie.)
function requireAdmin(auth: { userId: string; role: string }): Response | null {
  if (!ADMIN_ROLES.has(auth.role)) {
    return json({ error: 'Accès réservé aux administrateurs.' }, 403);
  }
  return null;
}

// Catalogue des relations à risque d'orphelins.
// `child.fk NOT IN (SELECT parent.id ...)` + fk non vide → orphelin.
// On garde les requêtes simples (anti-jointure) pour rester robuste si une
// table/colonne manque (le try/catch par relation absorbe l'erreur).
interface RelationCheck {
  /** Étiquette lisible exposée dans le rapport. */
  relation: string;
  /** SELECT COUNT(*) READ-ONLY renvoyant `n` = nb d'orphelins. */
  sql: string;
}

const RELATIONS: RelationCheck[] = [
  // leads.client_id → clients.id (NOT NULL, AUCUN ON DELETE → risque fort)
  {
    relation: 'leads.client_id -> clients.id',
    sql: `SELECT COUNT(*) AS n FROM leads
          WHERE client_id IS NOT NULL AND client_id != ''
            AND client_id NOT IN (SELECT id FROM clients)`,
  },
  // messages.lead_id → leads.id (ON DELETE CASCADE déclaré mais non appliqué
  // si PRAGMA foreign_keys OFF → vérification de sûreté)
  {
    relation: 'messages.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM messages
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
  // tasks.lead_id → leads.id (ON DELETE SET NULL : NULL = OK, on ne compte
  // que les lead_id renseignés mais introuvables)
  {
    relation: 'tasks.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM tasks
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
  // notifications.user_id → users.id (AUCUNE FK déclarée, lien logique fort)
  {
    relation: 'notifications.user_id -> users.id',
    sql: `SELECT COUNT(*) AS n FROM notifications
          WHERE user_id IS NOT NULL AND user_id != ''
            AND user_id NOT IN (SELECT id FROM users)`,
  },
  // appointments.lead_id → leads.id (ON DELETE SET NULL → NULL OK)
  {
    relation: 'appointments.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM appointments
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
  // appointments.client_id → clients.id (NOT NULL, AUCUN ON DELETE)
  {
    relation: 'appointments.client_id -> clients.id',
    sql: `SELECT COUNT(*) AS n FROM appointments
          WHERE client_id IS NOT NULL AND client_id != ''
            AND client_id NOT IN (SELECT id FROM clients)`,
  },
  // conversations.lead_id → leads.id (FK déclarée, AUCUN ON DELETE)
  {
    relation: 'conversations.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM conversations
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
  // consent_log.lead_id → leads.id (NOT NULL, AUCUN ON DELETE — Loi 25)
  {
    relation: 'consent_log.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM consent_log
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
  // activity_log.lead_id → leads.id (ON DELETE CASCADE déclaré — sûreté)
  {
    relation: 'activity_log.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM activity_log
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
  // customers.lead_id → leads.id (ON DELETE SET NULL → NULL OK ; lien faible
  // réconciliation e-commerce B2)
  {
    relation: 'customers.lead_id -> leads.id',
    sql: `SELECT COUNT(*) AS n FROM customers
          WHERE lead_id IS NOT NULL AND lead_id != ''
            AND lead_id NOT IN (SELECT id FROM leads)`,
  },
];

export async function handleDataReconcile(
  _request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  // Garde admin (défense en profondeur — le dispatch worker.ts re-garde aussi).
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const orphans: Array<{ relation: string; count: number }> = [];

  for (const rel of RELATIONS) {
    try {
      // SELECT seul — aucune mutation. .first() lit la 1ère ligne.
      const row = await env.DB.prepare(rel.sql).first<{ n: number }>();
      const count = Number(row?.n ?? 0);
      // On ne reporte que les relations effectivement orphelines (> 0) :
      // un rapport vide = base saine.
      if (count > 0) {
        orphans.push({ relation: rel.relation, count });
      }
    } catch {
      // Table/colonne absente ou DB en erreur → relation sautée.
      // Best-effort strict : JAMAIS 500, on continue les autres relations.
      continue;
    }
  }

  return json({
    data: {
      orphans,
      checked_at: new Date().toISOString(),
    },
  });
}
