// ── RolesPermissionsSettings — LOT TEAM B (Phase B / Manager-B) ──────────────
// Matrice rôles × capabilities RÉELLE via getRolesWithCaps() (§6.E) +
// getMyCapabilities() (§6.D). Plus de `fetch` brut sans token (ancien code
// ~ligne 11 → 401 prod) : 100% via helpers api.ts (apiFetch, auth +
// X-Sub-Account injectés). apiFetch GELÉ (§6.A) : discrimination d'erreur =
// string-match sur `error` / absence de `data`, JAMAIS `result.code`.
// i18n exclusivement via t('caps.*') (23 clés figées Phase A, §6.G) — aucune
// clé créée, aucun catalogue touché.
import { useState, useEffect } from 'react';
import { Card, Tag, EmptyState, Icon, useToast } from '@/components/ui';
import { ShieldCheck } from 'lucide-react';
import { t } from '@/lib/i18n';
import {
  getRolesWithCaps,
  getMyCapabilities,
  updateRolePermission,
  type TeamRoleWithCaps,
} from '@/lib/api';

// Liste FIGÉE des 12 capabilities (docs/LOT-TEAM-BC.md §6.C) — lignes de la
// matrice, ordre stable. Chaque clé a un libellé i18n `caps.<capability>`.
const CAPABILITIES = [
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

export function RolesPermissionsSettings() {
  const { success, error: toastError } = useToast();
  const [roles, setRoles] = useState<TeamRoleWithCaps[]>([]);
  const [myCaps, setMyCaps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [rolesRes, myRes] = await Promise.all([
        getRolesWithCaps(),
        getMyCapabilities(),
      ]);
      if (cancelled) return;
      if (rolesRes.data) {
        setRoles(rolesRes.data);
      } else {
        setError(true);
      }
      if (myRes.data) setMyCaps(myRes.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTogglePermission = async (roleName: string, cap: string, currentGranted: boolean) => {
    if (roleName === 'owner') return;

    const key = `${roleName}-${cap}`;
    setUpdating(key);
    try {
      const res = await updateRolePermission({
        role_name: roleName,
        capability: cap,
        allowed: !currentGranted,
      });
      if (res.data) {
        setRoles((prev) =>
          prev.map((r) => {
            if (r.id !== roleName) return r;
            const caps = r.capabilities || [];
            const newCaps = currentGranted
              ? caps.filter((c) => c !== cap)
              : [...caps, cap];
            return { ...r, capabilities: newCaps };
          })
        );
        success('Permission mise à jour avec succès.');
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (e: any) {
      toastError(e.message || 'Erreur lors de la modification de la permission.');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={ShieldCheck} size={16} className="text-[var(--primary)]" />{' '}
              {t('caps.matrix.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('caps.matrix.subtitle')}
            </p>
          </div>
        </header>

        {loading ? (
          <EmptyState
            variant="compact"
            icon={<ShieldCheck size={28} />}
            title={t('caps.matrix.loading')}
            description=""
          />
        ) : error ? (
          <EmptyState
            variant="compact"
            icon={<ShieldCheck size={28} />}
            title={t('caps.matrix.error')}
            description={t('caps.denied_message')}
          />
        ) : roles.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<ShieldCheck size={28} />}
            title={t('caps.matrix.empty')}
            description=""
          />
        ) : (
          <div
            className="settings-perm-matrix"
            role="table"
            aria-label={t('caps.matrix.title')}
          >
            {/* En-tête : Capacité + 1 colonne par rôle */}
            <div
              className="settings-perm-matrix__head"
              role="row"
              style={{
                gridTemplateColumns: `minmax(0,1.4fr) repeat(${roles.length}, minmax(0,1fr))`,
              }}
            >
              <span role="columnheader">{t('caps.matrix.capability_col')}</span>
              {roles.map((r) => (
                <span key={r.id} role="columnheader" title={r.description}>
                  {r.name}
                </span>
              ))}
            </div>

            {CAPABILITIES.map((cap) => (
              <div
                key={cap}
                className="settings-perm-matrix__row"
                role="row"
                style={{
                  gridTemplateColumns: `minmax(0,1.4fr) repeat(${roles.length}, minmax(0,1fr))`,
                }}
              >
                <span role="cell" className="settings-perm-matrix__label">
                  {t(`caps.${cap}`)}
                </span>
                {roles.map((r) => {
                  const granted = (r.capabilities || []).includes(cap);
                  const isOwner = r.id === 'owner';
                  const isUpdating = updating === `${r.id}-${cap}`;
                  return (
                    <button
                      key={r.id}
                      role="cell"
                      disabled={isOwner || isUpdating}
                      onClick={() => !isOwner && !isUpdating && handleTogglePermission(r.id, cap, granted)}
                      className={`settings-perm-cell ${granted ? 'is-on' : 'is-off'} ${isOwner ? 'cursor-not-allowed' : 'cursor-pointer hover:opacity-80 transition-opacity'} ${isUpdating ? 'animate-pulse' : ''}`}
                      aria-label={
                        granted
                          ? t('caps.matrix.granted')
                          : t('caps.matrix.denied')
                      }
                      style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', textAlign: 'center', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {isUpdating ? '...' : (granted ? t('caps.matrix.granted') : t('caps.matrix.denied'))}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Rappel : ces rôles sont système (mapping verrouillé owner/manager/
            member/viewer ↔ rôle technique). myCaps = capabilities effectives
            de l'utilisateur courant (résolues au choke-point, §6.D). */}
        {!loading && !error && roles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Tag variant="brand" dot>
              {t('caps.matrix.system_role')}
            </Tag>
            {myCaps.length > 0 && (
              <span className="t-caption text-[var(--gray-500)]">
                {myCaps.length} / {CAPABILITIES.length}
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
