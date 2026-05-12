import { useState, useEffect } from 'react';
import { Card, Badge } from '@/components/ui';
import { Fingerprint, Smartphone } from 'lucide-react';

export function SystemSettings() {
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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
    if (biometricEnabled) {
      // Désactiver
      const { deleteBiometricCredentials } = await import('@/lib/biometric');
      await deleteBiometricCredentials('crm.intralys.com');
      localStorage.removeItem('biometric_enabled');
      setBiometricEnabled(false);
    } else {
      // Activer — les credentials seront sauvés au prochain login
      localStorage.setItem('biometric_enabled', '1');
      setBiometricEnabled(true);
    }
  };

  return (
    <div className="space-y-4">
      {isNative && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Fingerprint size={16} className="text-[var(--brand-primary)]" /> Authentification biométrique
          </h3>
          {biometricAvailable ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Connexion par FaceID / TouchID</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {biometricEnabled ? 'Activé — déverrouillage rapide au prochain login' : 'Désactivé — connectez-vous avec vos identifiants'}
                </p>
              </div>
              <button
                onClick={() => void toggleBiometric()}
                className={`w-12 h-6 rounded-full relative transition-all cursor-pointer ${biometricEnabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-default)]'}`}
              >
                <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all shadow-sm ${biometricEnabled ? 'left-[27px]' : 'left-[3px]'}`} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              La biométrie n'est pas disponible sur cet appareil.
            </p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Smartphone size={16} className="text-[var(--brand-primary)]" /> Mode hors ligne
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          L'app met en cache vos leads, conversations et tâches pour un accès rapide même sans connexion.
          Les modifications faites hors ligne sont automatiquement synchronisées au retour online.
        </p>
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-subtle)]">
          <span className="text-sm">Actions en attente de sync</span>
          <Badge color={pendingCount > 0 ? 'var(--warning)' : 'var(--success)'}>{pendingCount}</Badge>
        </div>
      </Card>
    </div>
  );
}
