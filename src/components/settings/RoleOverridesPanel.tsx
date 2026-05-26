// ── RoleOverridesPanel — Sprint 23 Sécurité / conformité ────────────────────
// Selector user (TeamUsers) + matrice 12 capabilities × Switch ON/OFF
// (granted=1) / OFF (granted=0) / Inherit (pas d'override → effet du rôle).
//
// CapGuard front : on lit l'auth user et on vérifie role admin/owner
// (proxy fonctionnel pour la capability `team.manage`). Si non-admin →
// <EmptyState> "Accès refusé". Le worker fait l'autorité d'autorisation
// (back-end) ; ce guard est uniquement UX (évite d'afficher des contrôles
// que l'API refusera ensuite).

import { useEffect, useState } from 'react';
import {
  getCapabilityOverrides,
  setCapabilityOverride,
  deleteCapabilityOverride,
  getTeamUsers,
  type TeamUser,
} from '@/lib/api';
import type { CapabilityOverride } from '@/lib/types';
import { Card, Switch, Select, EmptyState, Button, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Shield, RotateCcw } from 'lucide-react';

// Liste figée des 12 capacités (cohérent avec le contrat backend §6).
const ALL_CAPS = [
  'leads.read',
  'leads.write',
  'leads.delete',
  'export',
  'team.manage',
  'billing.view',
  'clients.manage',
  'reports.view',
  'workflows.manage',
  'invoices.write',
  'settings.manage',
  'ai.use',
] as const;

const ADMIN_ROLES = new Set(['admin', 'owner']);

export function RoleOverridesPanel() {
  const { user } = useAuth();
  const canManage = !!user?.role && ADMIN_ROLES.has(user.role);

  if (!canManage) {
    return (
      <EmptyState
        icon={<Shield size={28} />}
        title={t('rbac.override.empty')}
        description={t('rbac.override.scope_help')}
      />
    );
  }

  return <RoleOverridesPanelInner />;
}

function RoleOverridesPanelInner() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');

  const [overrides, setOverrides] = useState<CapabilityOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingCap, setPendingCap] = useState<string | null>(null);

  // Charge la liste users une fois
  useEffect(() => {
    let cancelled = false;
    getTeamUsers()
      .then((res) => {
        if (cancelled) return;
        setUsers(res.data ?? []);
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Charge les overrides pour l'utilisateur sélectionné
  useEffect(() => {
    if (!userId) {
      setOverrides([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCapabilityOverrides(userId)
      .then((res) => {
        if (cancelled) return;
        setOverrides(res.data ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function getCurrent(cap: string): 0 | 1 | null {
    const o = overrides.find((x) => x.capability === cap);
    return o ? o.granted : null;
  }

  async function refresh() {
    if (!userId) return;
    const res = await getCapabilityOverrides(userId);
    setOverrides(res.data ?? []);
  }

  async function toggle(cap: string, granted: boolean) {
    if (!userId) return;
    setPendingCap(cap);
    try {
      await setCapabilityOverride(userId, cap, granted);
      await refresh();
    } finally {
      setPendingCap(null);
    }
  }

  async function reset(cap: string) {
    if (!userId) return;
    setPendingCap(cap);
    try {
      await deleteCapabilityOverride(userId, cap);
      await refresh();
    } finally {
      setPendingCap(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          {t('rbac.override.title')}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {t('rbac.override.subtitle')}
        </p>
      </div>

      <Card className="p-5">
        {usersLoading ? (
          <Skeleton className="h-9 w-full max-w-md rounded-md" />
        ) : (
          <Select
            label={t('rbac.override.user_label')}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            containerClassName="max-w-md"
          >
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ? `${u.name} (${u.email})` : u.email}
              </option>
            ))}
          </Select>
        )}
      </Card>

      {userId && (
        <Card className="p-5">
          {loading ? (
            <div className="space-y-3">
              {ALL_CAPS.map((c) => (
                <Skeleton key={c} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {ALL_CAPS.map((cap) => {
                const curr = getCurrent(cap);
                const isOn = curr === 1;
                const hasOverride = curr !== null;
                const isPending = pendingCap === cap;
                return (
                  <div
                    key={cap}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)] font-mono">
                        {cap}
                      </p>
                      {!hasOverride && (
                        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          {t('rbac.override.scope_help')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Switch
                        checked={isOn}
                        onCheckedChange={(c) => void toggle(cap, c)}
                        disabled={isPending}
                        size="sm"
                        variant={isOn ? 'success' : 'brand'}
                      />
                      {hasOverride && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void reset(cap)}
                          disabled={isPending}
                          leftIcon={<RotateCcw size={12} />}
                        >
                          {t('rbac.override.reset')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
