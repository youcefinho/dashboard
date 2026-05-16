// ── SecuritySettings — Sprint 23 W31 : Switch primitive + KpiStrip + list-item-enter + Avatar
// ── Sprint 42 M3.4 — Toast + AutosaveIndicator wirage (2FA toggle + sessions revoke)
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, Button, Switch, KpiStrip, Avatar, EmptyState, Skeleton, useToast, useConfirm, Icon, AutosaveIndicator } from '@/components/ui';
import type { AutosaveState } from '@/components/ui/AutosaveIndicator';
import { Modal } from '@/components/ui/Modal';
import { getSessions, deleteSession, deleteOtherSessions, generateBackupCodes, type AdminSession } from '@/lib/api';
import { Smartphone, Monitor, Download, Copy, AlertTriangle, ShieldCheck, KeyRound, Activity } from 'lucide-react';

export function SecuritySettings() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesRemaining] = useState(0);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  // Sprint 42 M3.4 — autosave state pour TOTP toggle (instant save feedback)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const decayTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    };
  }, []);
  const markSaved = () => {
    setAutosaveState('saved');
    setLastSaved(new Date());
    if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    decayTimerRef.current = window.setTimeout(() => {
      setAutosaveState((s) => (s === 'saved' ? 'idle' : s));
    }, 5000);
  };

  const fetchSessions = async () => {
    setLoading(true);
    const res = await getSessions();
    if (res.data) setSessions(res.data);
    setLoading(false);
  };

  useEffect(() => {
    void fetchSessions();
  }, []);

  const revokeSession = async (token: string) => {
    const res = await deleteSession(token);
    if (!res.error) {
      success('Session révoquée avec succès');
      setSessions((s) => s.filter((x) => x.token !== token));
    } else toastError(res.error);
  };

  const revokeOtherSessions = async () => {
    const ok = await confirm({
      title: 'Fermer toutes les autres sessions ?',
      description: 'Les autres appareils connectés à votre compte seront déconnectés immédiatement.',
      confirmLabel: 'Fermer les sessions',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteOtherSessions();
    if (!res.error) {
      success('Toutes les autres sessions ont été fermées');
      void fetchSessions();
    } else toastError(res.error);
  };

  const handleToggleTotp = async () => {
    setAutosaveState('saving');
    if (totpEnabled) {
      const ok = await confirm({
        title: 'Désactiver le 2FA ?',
        description: 'Ton compte sera moins protégé. Tu peux réactiver à tout moment.',
        confirmLabel: 'Désactiver',
        danger: true,
      });
      if (!ok) {
        setAutosaveState('idle');
        return;
      }
      setTotpEnabled(false);
      success('2FA désactivé');
    } else {
      setTotpEnabled(true);
      success('2FA activé');
    }
    markSaved();
  };

  const handleGenerateBackupCodes = async () => {
    const ok = await confirm({
      title: 'Générer de nouveaux codes de secours ?',
      description: 'Les anciens codes seront invalidés immédiatement. Conservez les nouveaux en lieu sûr.',
      confirmLabel: 'Générer',
      danger: true,
    });
    if (!ok) return;
    const res = await generateBackupCodes();
    if (res.data) {
      setBackupCodes(res.data.codes);
      setShowBackupCodes(true);
      success('Codes de secours générés avec succès');
    } else toastError(res.error || 'Erreur lors de la génération');
  };

  const copyCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    success('Codes copiés dans le presse-papiers');
  };

  const downloadCodes = () => {
    const element = document.createElement('a');
    const file = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = 'intralys-backup-codes.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const sessionCount = sessions.length;
  const kpiItems = useMemo(
    () => [
      {
        label: '2FA',
        value: totpEnabled ? 'Activé' : 'Désactivé',
        color: (totpEnabled ? 'success' : 'warning') as 'success' | 'warning',
        icon: <ShieldCheck size={12} />,
      },
      {
        label: 'Sessions actives',
        value: sessionCount,
        color: 'brand' as const,
        icon: <Activity size={12} />,
      },
      {
        label: 'Codes de secours',
        value: backupCodesRemaining,
        color: 'neutral' as const,
        icon: <KeyRound size={12} />,
      },
    ],
    [totpEnabled, sessionCount, backupCodesRemaining]
  );

  return (
    <div className="space-y-6">
      {/* Sprint 42 M3.4 — Autosave indicator sticky top-right */}
      <div className="sticky top-2 z-10 flex justify-end pointer-events-none -mb-2">
        <span className="pointer-events-auto">
          <AutosaveIndicator
            state={autosaveState}
            lastSaved={lastSaved}
            onRetry={() => void handleToggleTotp()}
          />
        </span>
      </div>

      <KpiStrip items={kpiItems} />

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3">Authentification à deux facteurs (2FA)</h3>
          <p className="t-caption text-[var(--gray-500)]">
            Protège ton compte avec une couche supplémentaire.
          </p>
        </header>

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">Application d'authentification</p>
            <p className="settings-toggle-row__desc">
              Google Authenticator, Authy ou 1Password.
            </p>
          </div>
          <Switch
            checked={totpEnabled}
            onCheckedChange={() => void handleToggleTotp()}
            variant="success"
            label={totpEnabled ? 'Activé' : 'Désactivé'}
          />
        </div>

        {totpEnabled && (
          <div className="settings-toggle-row">
            <div className="settings-toggle-row__meta">
              <p className="settings-toggle-row__title">Codes de secours</p>
              <p className="settings-toggle-row__desc">En cas de perte de ton appareil.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleGenerateBackupCodes}>
              Générer nouveaux codes
            </Button>
          </div>
        )}

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">Mot de passe</p>
            <p className="settings-toggle-row__desc">Modifie-le régulièrement pour plus de sécurité.</p>
          </div>
          <Button variant="secondary" size="sm">Changer le mot de passe</Button>
        </div>
      </Card>

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3">Sessions actives</h3>
            <p className="t-caption text-[var(--gray-500)]">Appareils connectés à ton compte.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={revokeOtherSessions}
            className="settings-danger-action"
          >
            Fermer autres sessions
          </Button>
        </header>

        {loading ? (
          /* Skeleton matche session rows : device icon + nom/ua + meta + actions */
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="row-premium flex justify-between items-center p-3 rounded-xl"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', animationDelay: `${i * 50}ms` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Skeleton className="h-9 w-9 rounded-lg shrink-0" style={{ animationDelay: `${i * 50}ms` }} />
                  <div className="space-y-1.5 min-w-0">
                    <Skeleton className="h-3.5 w-40" style={{ animationDelay: `${i * 50 + 20}ms` }} />
                    <Skeleton className="h-2.5 w-32" style={{ animationDelay: `${i * 50 + 40}ms` }} />
                  </div>
                </div>
                <Skeleton className="h-7 w-20 rounded-lg shrink-0" style={{ animationDelay: `${i * 50 + 60}ms` }} />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Monitor size={28} />}
            title="Aucune session active"
            description="Vos sessions actives apparaîtront ici."
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session, idx) => {
              const isMobile = session.user_agent?.toLowerCase().includes('mobile');
              const deviceName = session.user_agent || 'Appareil inconnu';
              return (
                <div
                  key={session.token}
                  className="row-premium list-item-enter flex justify-between items-center p-3 rounded-xl"
                  style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex gap-3 items-center min-w-0">
                    <Avatar
                      size="sm"
                      name={deviceName}
                      ring={session.is_current ? 'active' : 'none'}
                      status={session.is_current ? 'online' : 'offline'}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center gap-2 truncate">
                        {isMobile ? <Smartphone size={12} className="text-[var(--primary)]" /> : <Monitor size={12} className="text-[var(--primary)]" />}
                        <span className="truncate">{deviceName}</span>
                        {session.is_current && (
                          <span className="text-[10px] bg-[var(--primary)]/10 text-[var(--primary)] px-2 py-0.5 rounded-full font-semibold">
                            Actuelle
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        IP: {session.ip || 'Inconnue'} • Actif le {new Date(session.last_active_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {!session.is_current && (
                    <Button
                      variant="ghost"
                      className="text-[var(--danger)]"
                      onClick={() => revokeSession(session.token)}
                    >
                      Révoquer
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={showBackupCodes}
        onOpenChange={() => setShowBackupCodes(false)}
        title="Codes de secours 2FA"
      >
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3 p-3 bg-[var(--warning)]/10 text-[var(--warning)] rounded-lg">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p className="text-sm">
              Ces codes ne seront affichés qu'une seule fois. Veuillez les copier ou les télécharger
              immédiatement et les conserver en lieu sûr.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 font-mono text-center text-sm p-4 bg-[var(--bg-subtle)] rounded border border-[var(--border-subtle)]">
            {backupCodes.map((code, i) => (
              <div key={i} className="tracking-widest">
                {code}
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={copyCodes} leftIcon={<Icon as={Copy} size={16} />}>
              Copier
            </Button>
            <Button variant="primary" onClick={downloadCodes} leftIcon={<Icon as={Download} size={16} />}>
              Télécharger
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
