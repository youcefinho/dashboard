// ── CallRecordingPlayer — Sprint 34 (Agent B3) ──────────────────────────────
// Player audio Stripe-clean pour appels enregistrés. Fetch d'une URL signée R2
// (TTL ~1h worker-side) via getCallRecordingUrl(). Supporte download + delete
// RGPD (cap 'settings.manage' côté worker, DELETE /api/calls/:id/recording).
//
// Sécurité : signedUrl provient EXCLUSIVEMENT de notre worker (allowlist R2
// + signature HMAC). Ne PAS accepter d'URL fournie par un tiers ici sans
// re-signer côté worker (sinon vecteur XSS via <a href> javascript: scheme).
//
// API publique :
//   <CallRecordingPlayer callLogId="cl_xxx" onDelete={() => refetch()} />

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Download, Trash2, RotateCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { useConfirm } from '../ui/ConfirmDialog';
import { apiFetch, getCallRecordingUrl } from '../../lib/api';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';

export interface CallRecordingPlayerProps {
  callLogId: string;
  onDelete?: () => void;
}

export function CallRecordingPlayer({ callLogId, onDelete }: CallRecordingPlayerProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const confirm = useConfirm();

  // Fetch signed URL au mount (et sur retry).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSignedUrl(null);

    getCallRecordingUrl(callLogId)
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data?.url) {
          setError(res.error || t('voice.recording.not_available'));
        } else {
          setSignedUrl(res.data.url);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('voice.recording.not_available'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [callLogId, retryNonce]);

  const handleRetry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('voice.recording.player.delete_rgpd'),
      description: t('voice.recording.delete_confirm'),
      confirmLabel: t('voice.recording.player.delete_rgpd'),
      danger: true,
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/calls/${encodeURIComponent(callLogId)}/recording`,
        { method: 'DELETE' },
      );
      if (res.error) {
        setError(res.error);
        setDeleting(false);
        return;
      }
      setSignedUrl(null);
      onDelete?.();
    } catch {
      setError(t('voice.recording.not_available'));
    } finally {
      setDeleting(false);
    }
  }, [callLogId, confirm, onDelete]);

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex flex-col gap-3 p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)]"
        data-testid="recording-player-loading"
      >
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    );
  }

  if (error || !signedUrl) {
    return (
      <div
        className="flex flex-col gap-3 p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)]"
        role="alert"
      >
        <p className="text-sm text-[var(--danger)]">
          {error || t('voice.recording.not_available')}
        </p>
        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            leftIcon={<Icon as={RotateCw} size="sm" />}
            aria-label={t('voice.recording.player.play')}
          >
            {t('voice.recording.player.play')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-4 rounded-[var(--radius-md)]',
        'border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]',
      )}
    >
      <audio
        controls
        src={signedUrl}
        aria-label={t('voice.recording.player.play')}
        preload="metadata"
        className="w-full"
        data-testid="recording-player-audio"
      />
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={signedUrl}
          download
          className={cn(
            'inline-flex items-center gap-2 h-8 px-3 text-xs font-medium',
            'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)]',
            'text-[var(--text-primary)] shadow-[var(--shadow-xs)]',
            'hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
            'transition-colors duration-150',
          )}
          aria-label={t('voice.recording.player.download')}
          data-testid="recording-player-download"
        >
          <Icon as={Download} size="sm" />
          {t('voice.recording.player.download')}
        </a>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          leftIcon={
            deleting
              ? <Icon as={Loader2} size="sm" className="animate-spin" />
              : <Icon as={Trash2} size="sm" />
          }
          aria-label={t('voice.recording.player.delete_rgpd')}
          data-testid="recording-player-delete"
        >
          {t('voice.recording.player.delete_rgpd')}
        </Button>
      </div>
    </div>
  );
}

export default CallRecordingPlayer;
