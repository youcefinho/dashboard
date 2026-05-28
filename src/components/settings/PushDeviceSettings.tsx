// ── PushDeviceSettings — surface registerDevice / unregisterDevice ──────────
// 100 % additif. Carte self-service : enregistre / désinscrit CET appareil aux
// notifications push. Le token est best-effort :
//   1) tente une souscription Web Push (Notification.requestPermission + SW)
//   2) à défaut, génère un token d'appareil local persistant (localStorage).
// Aucun crash si l'API push navigateur est absente : on retombe sur le token
// local. Flag-aware : si registerDevice/unregisterDevice renvoie une erreur,
// affichage role="alert" + bouton retry, état non bloquant.
// i18n : clés pushx.* (NON ajoutées aux catalogues — t() renvoie la clé si absente).
import { useState, useCallback } from 'react';
import { Card, Button, useToast, useConfirm } from '@/components/ui';
import { registerDevice, unregisterDevice } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Smartphone } from 'lucide-react';

const TOKEN_KEY = 'intralys.pushDeviceToken';

// Token best-effort, stable pour cet appareil/navigateur.
function getOrCreateDeviceToken(): string {
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const cryptoObj = typeof window !== 'undefined' ? window.crypto : undefined;
    const token =
      cryptoObj && 'randomUUID' in cryptoObj
        ? cryptoObj.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    // localStorage indisponible (mode privé strict) → token éphémère.
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'web';
}

export function PushDeviceSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Suivi local : cet appareil est-il enregistré ? (best-effort, non autoritatif)
  const [registered, setRegistered] = useState<boolean>(() => {
    try {
      return !!window.localStorage.getItem(TOKEN_KEY + '.active');
    } catch {
      return false;
    }
  });

  const markActive = (active: boolean) => {
    try {
      if (active) window.localStorage.setItem(TOKEN_KEY + '.active', '1');
      else window.localStorage.removeItem(TOKEN_KEY + '.active');
    } catch {
      /* best-effort */
    }
    setRegistered(active);
  };

  const handleRegister = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      // Best-effort : demande la permission de notification si dispo (non bloquant).
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          /* ignore — on enregistre quand même le token */
        }
      }
      const token = getOrCreateDeviceToken();
      const res = await registerDevice(token, detectPlatform());
      if (res.error) {
        setActionError(res.error);
        toastError(res.error);
        return;
      }
      markActive(true);
      success(t('pushx.registered'));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }, [success, toastError]);

  const handleUnregister = useCallback(async () => {
    const ok = await confirm({
      title: t('pushx.unregister_confirm_title'),
      description: t('pushx.unregister_confirm_desc'),
      confirmLabel: t('pushx.unregister'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      const token = getOrCreateDeviceToken();
      const res = await unregisterDevice(token);
      if (res.error) {
        setActionError(res.error);
        toastError(res.error);
        return;
      }
      markActive(false);
      success(t('pushx.unregistered'));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }, [confirm, success, toastError]);

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Smartphone size={18} /> {t('pushx.title')}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mt-0.5">{t('pushx.desc')}</p>
      </div>

      {actionError && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('pushx.unavailable')}</p>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleRegister()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <p className="text-[12px] text-[var(--text-secondary)]">
        {registered ? t('pushx.status_on') : t('pushx.status_off')}
      </p>

      <div className="flex gap-2">
        {!registered ? (
          <Button onClick={() => void handleRegister()} disabled={busy} aria-busy={busy}>
            {busy ? t('pushx.working') : t('pushx.register')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => void handleUnregister()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t('pushx.working') : t('pushx.unregister')}
          </Button>
        )}
      </div>
    </Card>
  );
}
