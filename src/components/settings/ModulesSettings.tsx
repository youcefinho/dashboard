// ── ModulesSettings — Sprint E1 M2.4 (2026-05-16) ────────────────────────────
//
// Page Settings (admin only) : active/désactive les modules du tenant.
//   - CRM        : socle, toujours actif, toggle verrouillé.
//   - E-commerce : optionnel, toggle → PATCH /api/modules.
//
// Stripe SUBTLE strict (aucun glow/gradient brand). FR québécois. A11y :
// toggles = <input type=checkbox> labellisés, focus-visible géré en CSS.
// Feedback : AutosaveIndicator + Toast. Invalide le cache ModuleGuard au succès.

import { useEffect, useState } from 'react';
import { Card, AutosaveIndicator, useToast, Icon, type AutosaveState } from '@/components/ui';
import { ShoppingBag, Users as UsersIcon, Lock } from 'lucide-react';
import { getModules, patchModule, type ModuleId } from '@/lib/api';
import { invalidateModulesCache } from '@/components/ecommerce/ModuleGuard';
import { t } from '@/lib/i18n';

interface ModuleMeta {
  id: ModuleId;
  label: string;
  description: string;
  icon: typeof ShoppingBag;
}

const MODULE_CATALOG: ModuleMeta[] = [
  {
    id: 'crm',
    label: 'CRM',
    description:
      t('set.modules.crm_desc'),
    icon: UsersIcon,
  },
  {
    id: 'ecommerce',
    label: t('set.modules.ecom_label'),
    description:
      t('set.modules.ecom_desc'),
    icon: ShoppingBag,
  },
];

export function ModulesSettings() {
  const { success, error: toastError } = useToast();
  const [active, setActive] = useState<ModuleId[]>(['crm']);
  const [locked, setLocked] = useState<ModuleId[]>(['crm']);
  const [loading, setLoading] = useState(true);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<ModuleId | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModules()
      .then((r) => {
        if (cancelled || !r.data) return;
        setActive(r.data.active);
        setLocked(r.data.locked);
      })
      .catch(() => { /* fallback ['crm'] */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async (mod: ModuleMeta, enabled: boolean) => {
    if (locked.includes(mod.id)) return;
    setBusyId(mod.id);
    setAutosave('saving');
    // Optimiste
    setActive((prev) =>
      enabled ? [...new Set([...prev, mod.id])] : prev.filter((m) => m !== mod.id),
    );
    try {
      const res = await patchModule(mod.id, enabled);
      if (res.error || !res.data) {
        throw new Error(res.error || 'Échec');
      }
      setActive(res.data.active);
      invalidateModulesCache();
      setAutosave('saved');
      setLastSaved(new Date());
      success(
        enabled
          ? `Module « ${mod.label} » ${t('set.modules.activated')}`
          : `Module « ${mod.label} » ${t('set.modules.deactivated')}`,
      );
    } catch {
      // Rollback
      setActive((prev) =>
        enabled ? prev.filter((m) => m !== mod.id) : [...new Set([...prev, mod.id])],
      );
      setAutosave('error');
      toastError(`${t('set.modules.update_fail')} « ${mod.label} »`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={ShoppingBag} size={16} className="text-[var(--primary)]" /> {t('set.modules.title_label')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('set.modules.subtitle2')}
            </p>
          </div>
          <AutosaveIndicator state={autosave} lastSaved={lastSaved} />
        </header>

        <div className="modules-settings-grid">
          {MODULE_CATALOG.map((mod) => {
            const isActive = active.includes(mod.id);
            const isLocked = locked.includes(mod.id);
            return (
              <div
                key={mod.id}
                className={`module-card ${isActive ? 'is-active' : ''}`}
              >
                <span className="module-card__icon" aria-hidden>
                  <Icon as={mod.icon} size={18} />
                </span>
                <div className="module-card__body">
                  <p className="module-card__title">
                    {mod.label}
                    {isLocked && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]"
                        title={t('set.modules.core_label')}
                      >
                        <Icon as={Lock} size={11} /> {t('set.modules.included')}
                      </span>
                    )}
                  </p>
                  <p className="module-card__desc">{mod.description}</p>
                </div>
                <div className="module-card__aside">
                  <label
                    className="module-toggle"
                    aria-label={`${isActive ? t('set.modules.toggle_off') : t('set.modules.toggle_on')} le module ${mod.label}`}
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      disabled={isLocked || loading || busyId === mod.id}
                      onChange={(e) => void handleToggle(mod, e.target.checked)}
                    />
                    <span className="module-toggle-track" aria-hidden>
                      <span className="module-toggle-thumb" />
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
