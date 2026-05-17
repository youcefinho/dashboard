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
      success(biometricEnabled ? 'Biométrie désactivée' : 'Biométrie activée');
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
      decayTimerRef.current = window.setTimeout(() => {
        setAutosaveState((s) => (s === 'saved' ? 'idle' : s));
      }, 5000);
    } catch {
      setAutosaveState('error');
      toastError('Échec de la mise à jour biométrie');
    }
  };

  // Sprint 24 vague 5B — clear le flag tour completed pour relancer
  const handleRestartTour = () => {
    try { localStorage.removeItem('intralys_tour_completed'); } catch { /* ignore */ }
    setTourOpen(true);
    // Sprint 42 M3.4 — toast info feedback
    success('Tour interactif redémarré');
  };

  // ── Sprint 45 M3.3 — Reset tous les coachmarks contextuels ────────────
  const handleResetCoachmarks = () => {
    resetAllCoachmarks();
    success('Guides interactifs réinitialisés — ils réapparaîtront au fil de tes prochaines visites.');
  };

  // ── Sprint 45 M1.2 — Effacer données démo ──────────────────────────────
  const [demoLoaded, setDemoLoaded] = useState(isDemoDataLoaded());
  const [demoClearing, setDemoClearing] = useState(false);
  const handleClearDemoData = async () => {
    setDemoClearing(true);
    try {
      await clearDemoData();
      setDemoLoaded(false);
      success('Données démo effacées. Tu repars d\'une page blanche.');
    } catch {
      toastError('Échec de l\'effacement des données démo.');
    } finally {
      setDemoClearing(false);
    }
  };

  const kpiItems = useMemo(
    () => [
      {
        label: 'Mutations en attente',
        value: pendingCount,
        color: (pendingCount > 0 ? 'warning' : 'success') as 'warning' | 'success',
        icon: <CloudOff size={12} />,
      },
      {
        label: 'Plateforme native',
        value: isNative ? 'Oui' : 'Non',
        color: (isNative ? 'brand' : 'neutral') as 'brand' | 'neutral',
        icon: <Smartphone size={12} />,
      },
      {
        label: 'Biométrie',
        value: biometricEnabled ? 'Activée' : 'Désactivée',
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
              <Icon as={Fingerprint} size={16} className="text-[var(--primary)]" /> Authentification biométrique
            </h3>
            <p className="t-caption text-[var(--gray-500)]">Déverrouille l'app par FaceID ou TouchID.</p>
          </header>
          {biometricAvailable ? (
            <div className="settings-toggle-row">
              <div className="settings-toggle-row__meta">
                <p className="settings-toggle-row__title">Connexion par FaceID / TouchID</p>
                <p className="settings-toggle-row__desc">
                  {biometricEnabled
                    ? 'Activé — déverrouillage rapide au prochain login.'
                    : 'Désactivé — connecte-toi avec tes identifiants.'}
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
              La biométrie n'est pas disponible sur cet appareil.
            </p>
          )}
        </Card>
      )}

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
            <Icon as={Smartphone} size={16} className="text-[var(--primary)]" /> Mode hors ligne
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            L'app met en cache leads, conversations et tâches pour un accès même sans connexion. Sync automatique au retour online.
          </p>
        </header>
        <div className="settings-toggle-row">
          <span className="settings-toggle-row__title">Actions en attente de sync</span>
          <Tag color={pendingCount > 0 ? 'var(--warning)' : 'var(--success)'} size="sm">{pendingCount}</Tag>
        </div>
      </Card>

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
            <Icon as={Compass} size={16} className="text-[var(--primary)]" /> Onboarding & guides interactifs
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            Relance le tour complet de l'application ou réaffiche les guides contextuels (drag-drop pipeline, variables composer, sélection multiple, etc.).
          </p>
        </header>
        <div className="settings-actions settings-actions--start" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button onClick={handleRestartTour} leftIcon={<Icon as={Compass} size={14} />} aria-label="Relancer le tour complet de l'application">
            Recommencer le tour complet
          </Button>
          <Button
            variant="secondary"
            onClick={handleResetCoachmarks}
            leftIcon={<Icon as={RotateCcw} size={14} />}
            aria-label="Réafficher les guides interactifs contextuels"
          >
            Réafficher les guides interactifs
          </Button>
        </div>
        <p className="t-caption text-[var(--text-muted)]" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon as={Sparkles} size={12} />
          5 guides contextuels : Pipeline, Conversations, Tâches, Rapports, Dashboard.
        </p>
      </Card>

      {/* Sprint 45 M1.2 — Carte "Données démo" : visible uniquement si chargées */}
      {demoLoaded && (
        <Card className="settings-card p-6">
          <header className="settings-section-header">
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Sparkles} size={16} className="text-[var(--primary)]" /> Données démo
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              Tu utilises actuellement les données démo importées à l'onboarding (20 leads, 10 tâches, 5 conversations, 3 pipelines).
              Efface-les quand tu es prêt à travailler avec tes vraies données.
            </p>
          </header>
          <div className="settings-actions settings-actions--start" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button
              variant="secondary"
              onClick={() => void handleClearDemoData()}
              disabled={demoClearing}
              leftIcon={<Icon as={Trash2} size={14} />}
              aria-label="Effacer les données démo importées à l'onboarding"
            >
              {demoClearing ? 'Effacement…' : 'Effacer données démo'}
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
