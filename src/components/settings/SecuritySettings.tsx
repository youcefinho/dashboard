// ── SecuritySettings — Sprint 23 W31 : Switch primitive + KpiStrip + list-item-enter + Avatar
// ── Sprint 42 M3.4 — Toast + AutosaveIndicator wirage (2FA toggle + sessions revoke)
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, Button, Switch, KpiStrip, Avatar, EmptyState, Skeleton, useToast, useConfirm, Icon, AutosaveIndicator } from '@/components/ui';
import type { AutosaveState } from '@/components/ui/AutosaveIndicator';
import { Modal } from '@/components/ui/Modal';
import { getSessions, deleteSession, deleteOtherSessions, generateBackupCodes, type AdminSession } from '@/lib/api';
import { Smartphone, Monitor, Download, Copy, AlertTriangle, ShieldCheck, KeyRound, Activity } from 'lucide-react';
import { t } from '@/lib/i18n';

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
      success(t('set.sec.revoke') + ' ✓');
      setSessions((s) => s.filter((x) => x.token !== token));
    } else toastError(res.error);
  };

  const revokeOtherSessions = async () => {
    const ok = await confirm({
      title: t('set.sec.confirm_close_all'),
      description: t('set.sec.confirm_close_desc'),
      confirmLabel: t('set.sec.confirm_close_label'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteOtherSessions();
    if (!res.error) {
      success(t('set.sec.confirm_close_all') + ' ✓');
      void fetchSessions();
    } else toastError(res.error);
  };

  const handleToggleTotp = async () => {
    setAutosaveState('saving');
    if (totpEnabled) {
      const ok = await confirm({
        title: t('set.sec.confirm_2fa_off'),
        description: t('set.sec.confirm_2fa_desc'),
        confirmLabel: t('set.sec.disabled'),
        danger: true,
      });
      if (!ok) {
        setAutosaveState('idle');
        return;
      }
      setTotpEnabled(false);
      success('2FA ' + t('set.sec.disabled'));
    } else {
      setTotpEnabled(true);
      success('2FA ' + t('set.sec.enabled'));
    }
    markSaved();
  };

  const handleGenerateBackupCodes = async () => {
    const ok = await confirm({
      title: t('set.sec.confirm_gen_codes'),
      description: t('set.sec.confirm_gen_desc'),
      confirmLabel: t('set.sec.generate'),
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
        value: totpEnabled ? t('set.sec.enabled') : t('set.sec.disabled'),
        color: (totpEnabled ? 'success' : 'warning') as 'success' | 'warning',
        icon: <ShieldCheck size={12} />,
      },
      {
        label: t('set.sec.sessions_title'),
        value: sessionCount,
        color: 'brand' as const,
        icon: <Activity size={12} />,
      },
      {
        label: t('set.sec.backup_title'),
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
          <h3 className="t-h3">{t('set.sec.2fa_title')}</h3>
          <p className="t-caption text-[var(--gray-500)]">
            {t('set.sec.2fa_desc')}
          </p>
        </header>

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">{t('set.sec.totp_title')}</p>
            <p className="settings-toggle-row__desc">
              {t('set.sec.totp_desc')}
            </p>
          </div>
          <Switch
            checked={totpEnabled}
            onCheckedChange={() => void handleToggleTotp()}
            variant="success"
            label={totpEnabled ? t('set.sec.enabled') : t('set.sec.disabled')}
          />
        </div>

        {totpEnabled && (
          <div className="settings-toggle-row">
            <div className="settings-toggle-row__meta">
               <p className="settings-toggle-row__title">{t('set.sec.backup_title')}</p>
               <p className="settings-toggle-row__desc">{t('set.sec.backup_desc')}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleGenerateBackupCodes}>
              {t('set.sec.gen_codes')}
            </Button>
          </div>
        )}

        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">{t('set.sec.password')}</p>
            <p className="settings-toggle-row__desc">{t('set.sec.password_desc')}</p>
          </div>
          <Button variant="secondary" size="sm">{t('set.sec.change_pw')}</Button>
        </div>
      </Card>

      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3">{t('set.sec.sessions_title')}</h3>
            <p className="t-caption text-[var(--gray-500)]">{t('set.sec.sessions_desc')}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={revokeOtherSessions}
            className="settings-danger-action"
          >
            {t('set.sec.close_others')}
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
            title={t('set.sec.no_session')}
            description={t('set.sec.no_session_desc')}
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session, idx) => {
              const isMobile = session.user_agent?.toLowerCase().includes('mobile');
              const deviceName = session.user_agent || t('set.sec.unknown_device');
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
                            {t('set.sec.current')}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        IP: {session.ip || t('set.sec.unknown_ip')} • Actif le {new Date(session.last_active_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {!session.is_current && (
                    <Button
                      variant="ghost"
                      className="text-[var(--danger)]"
                      onClick={() => revokeSession(session.token)}
                    >
                      {t('set.sec.revoke')}
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
        title={t('set.sec.backup_modal')}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3 p-3 bg-[var(--warning)]/10 text-[var(--warning)] rounded-lg">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p className="text-sm">
              {t('set.sec.backup_warn')}
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
              {t('set.sec.copy')}
            </Button>
            <Button variant="primary" onClick={downloadCodes} leftIcon={<Icon as={Download} size={16} />}>
              {t('set.sec.download')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
