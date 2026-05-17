// ── SystemSettings — Sprint 23 W31 : Switch primitive + KpiStrip
// ── Sprint 24 vague 6A — autosave biometric toggle
// ── Sprint 24 vague 5B — bouton "Refaire le tour" (relance InteractiveTour)
// ── Sprint 45 M3.3 — Section "Onboarding" : reset coachmarks + relance tour
import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Card, Switch, KpiStrip, Tag, AutosaveIndicator, Icon, Button, useToast } from '@/components/ui';
import type { AutosaveState } from '@/components/ui/AutosaveIndicator';
import { Fingerprint, Smartphone, CloudOff, Compass, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
// Sprint 45 M3.3 — reset all coachmark flags
import { resetAllCoachmarks } from '@/lib/coachmarks';
// Sprint 45 M1.2 — clear demo data (effacer les seeds + flag local)
import { clearDemoData, isDemoDataLoaded } from '@/lib/demoData';
import { t } from '@/lib/i18n';

// Sprint 24 vague 5B — lazy import du tour interactif (évite charge inutile)
const InteractiveTour = lazy(() =>
  import('@/components/onboarding/InteractiveTour').then((m) => ({ default: m.InteractiveTour }))
);

export function SystemSettings() {
  const { success, error: toastError } = useToast();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // Sprint 24 vague 6A — autosave state (biométrie = save instant)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const decayTimerRef = useRef<number | null>(null);
  // Sprint 24 vague 5B — relance du tour interactif
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    };
  }, []);

  useEffect(() => {
    import('@capacitor/core').then(({ Capacitor }) => {
      setIsNative(Capacitor.isNativePlatform());
      if (Capacitor.isNativePlatform()) {
        import('@/lib/biometric').then(({ isBiometricAvailable }) => {
          isBiometricAvailable().then(setBiometricAvailable);
        });
        setBiometricEnabled(localStorage.getItem('biometric_enabled') === '1');
      }
    });
    import('@/lib/offline/db').then(({ getPendingMutationCount }) => {
      getPendingMutationCount().then(setPendingCount);
    });
  }, []);

  const toggleBiometric = async () => {
    setAutosaveState('saving');
    try {
      if (biometricEnabled) {
        const { deleteBiometricCredentials } = await import('@/lib/biometric');
        await deleteBiometricCredentials('crm.intralys.com');
        localStorage.removeItem('biometric_enabled');
        setBiometricEnabled(false);
      } else {
        localStorage.setItem('biometric_enabled', '1');
        setBiometricEnabled(true);
      }
      setAutosaveState('saved');
      setLastSaved(new Date());
      // Sprint 42 M3.4 — toast feedback non-invasif
      success(biometricEnabled ? t('set.sys.bio_disabled') : t('set.sys.bio_enabled'));
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
      decayTimerRef.current = window.setTimeout(() => {
        setAutosaveState((s) => (s === 'saved' ? 'idle' : s));
      }, 5000);
    } catch {
      setAutosaveState('error');
      toastError(t('set.sys.bio_fail'));
    }
  };

  // Sprint 24 vague 5B — clear le flag tour completed pour relancer
  const handleRestartTour = () => {
    try { localStorage.removeItem('intralys_tour_completed'); } catch { /* ignore */ }
    setTourOpen(true);
    // Sprint 42 M3.4 — toast info feedback
    success(t('set.sys.tour_restarted'));
  };

  // ── Sprint 45 M3.3 — Reset tous les coachmarks contextuels ────────────
  const handleResetCoachmarks = () => {
    resetAllCoachmarks();
    success(t('set.sys.coachmarks_reset'));
  };

  // ── Sprint 45 M1.2 — Effacer données démo ──────────────────────────────
  const [demoLoaded, setDemoLoaded] = useState(isDemoDataLoaded());
  const [demoClearing, setDemoClearing] = useState(false);
  const handleClearDemoData = async () => {
    setDemoClearing(true);
    try {
      await clearDemoData();
      setDemoLoaded(false);
      success(t('set.sys.demo_cleared'));
    } catch {
      toastError(t('set.sys.demo_clear_fail'));
    } finally {
      setDemoClearing(false);
    }
  };

  const kpiItems = useMemo(
    () => [
      {
        label: t('set.sys.mutations'),
        value: pendingCount,
        color: (pendingCount > 0 ? 'warning' : 'success') as 'warning' | 'success',
        icon: <CloudOff size={12} />,
      },
      {
        label: t('set.sys.native'),
        value: isNative ? t('set.roles.yes') : 'Non',
        color: (isNative ? 'brand' : 'neutral') as 'brand' | 'neutral',
        icon: <Smartphone size={12} />,
      },
      {
        label: t('set.sys.bio_kpi'),
        value: biometricEnabled ? t('set.sys.activated') : t('set.sys.deactivated'),
        color: (biometricEnabled ? 'success' : 'neutral') as 'success' | 'neutral',
        icon: <Fingerprint size={12} />,
      },
    ],
    [pendingCount, isNative, biometricEnabled]
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-10 flex justify-end pointer-events-none">
        <span className="pointer-events-auto">
          <AutosaveIndicator
            state={autosaveState}
            lastSaved={lastSaved}
            onRetry={() => void toggleBiometric()}
          />
        </span>
      </div>

      <KpiStrip items={kpiItems} />

      {isNative && (
        <Card className="settings-card p-6">
          <header className="settings-section-header">
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Fingerprint} size={16} className="text-[var(--primary)]" /> {t('set.sys.biometric_title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('set.sys.biometric_desc')}</p>
          </header>
          {biometricAvailable ? (
            <div className="settings-toggle-row">
              <div className="settings-toggle-row__meta">
                <p className="settings-toggle-row__title">{t('set.sys.biometric_toggle')}</p>
                <p className="settings-toggle-row__desc">
                  {biometricEnabled
                    ? t('set.sys.bio_on')
                    : t('set.sys.bio_off')}
                </p>
              </div>
              <Switch
                checked={biometricEnabled}
                onCheckedChange={() => void toggleBiometric()}
                variant="success"
              />
            </div>
          ) : (
            <p className="t-body text-[var(--gray-500)]">
              {t('set.sys.bio_unavail')}
            </p>
          )}
        </Card>
      )}

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Smartphone} size={16} className="text-[var(--primary)]" /> {t('set.sys.offline_title')}
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            {t('set.sys.offline_desc')}
          </p>
        </header>
        <div className="settings-toggle-row">
          <span className="settings-toggle-row__title">{t('set.sys.pending_sync')}</span>
          <Tag color={pendingCount > 0 ? 'var(--warning)' : 'var(--success)'} size="sm">{pendingCount}</Tag>
        </div>
      </Card>

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Compass} size={16} className="text-[var(--primary)]" /> {t('set.sys.onboarding_title')}
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            {t('set.sys.onboarding_desc')}
          </p>
        </header>
        <div className="settings-actions settings-actions--start" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button onClick={handleRestartTour} leftIcon={<Icon as={Compass} size={14} />} aria-label={t('set.sys.restart_tour_label')}>
            {t('set.sys.restart_tour')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleResetCoachmarks}
            leftIcon={<Icon as={RotateCcw} size={14} />}
            aria-label={t('set.sys.show_guides_label')}
          >
            {t('set.sys.show_guides')}
          </Button>
        </div>
        <p className="t-caption text-[var(--text-muted)]" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon as={Sparkles} size={12} />
          {t('set.sys.guides_count')}
        </p>
      </Card>

      {/* Sprint 45 M1.2 — Carte "Données démo" : visible uniquement si chargées */}
      {demoLoaded && (
        <Card className="settings-card p-6">
          <header className="settings-section-header">
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Sparkles} size={16} className="text-[var(--primary)]" /> {t('set.sys.demo_title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('set.sys.demo_desc')}
            </p>
          </header>
          <div className="settings-actions settings-actions--start" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button
              variant="secondary"
              onClick={() => void handleClearDemoData()}
              disabled={demoClearing}
              leftIcon={<Icon as={Trash2} size={14} />}
              aria-label={t('set.sys.demo_clear_label')}
            >
              {demoClearing ? t('set.sys.demo_clearing') : t('set.sys.demo_clear')}
            </Button>
          </div>
        </Card>
      )}

      {tourOpen && (
        <Suspense fallback={null}>
          <InteractiveTour open={tourOpen} onClose={() => setTourOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
