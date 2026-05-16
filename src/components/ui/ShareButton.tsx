// ── ShareButton — Sprint 35 vague 35-2D ───────────────────────────────────
// Bouton de partage universel :
//  - Feature-detect navigator.share (iOS/Android natifs + Safari/Chrome mobile)
//    → ouvre la sheet OS native (AirDrop, Messages, Mail, etc.)
//  - Fallback : navigator.clipboard.writeText(url) + toast "Lien copié"
//  - Haptic light + sound `success` après copy/share réussi (sensoriel cohérent
//    avec le reste du design system, respect prefers-reduced-motion via sensorial)
//
// Usage typique :
//   <ShareButton title={lead.name} url={window.location.href} />
//
// Note design : on garde le look "icon-only chip" cohérent avec les boutons de
// toolbar LeadDetail (Download PDF, Trash) pour éviter une 3ème variante visuelle.

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { triggerHaptic, playSound } from '@/lib/sensorial';
import { t } from '@/lib/i18n';

export interface ShareButtonProps {
  /** Titre suggéré par l'OS pour le share */
  title: string;
  /** URL à partager — typiquement window.location.href */
  url: string;
  /** Texte additionnel optionnel (ex : description du lead) */
  text?: string;
  /** Override aria-label si besoin */
  ariaLabel?: string;
  /** Override title HTML (tooltip natif) */
  tooltip?: string;
  /** Variant : icon-only (default) ou avec label visible */
  variant?: 'icon' | 'labeled';
}

// Feature-detect propre. Note : `navigator.share` peut exister mais throw
// si appelé hors user gesture ou avec un payload invalide → try/catch dans
// le handler. NotAllowedError / AbortError = user a fermé le picker → silence.
function hasNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function ShareButton({
  title,
  url,
  text,
  ariaLabel,
  tooltip,
  variant = 'icon',
}: ShareButtonProps) {
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState(false);

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (hasNativeShare()) {
        try {
          await navigator.share({ title, url, text });
          triggerHaptic('light');
          playSound('success');
          return;
        } catch (err) {
          // AbortError = user a fermé la sheet → silence
          const name = (err as { name?: string } | null)?.name;
          if (name === 'AbortError') return;
          // Sinon → fallback clipboard
        }
      }
      // Fallback : clipboard
      try {
        await navigator.clipboard.writeText(url);
        success(t('share.copied'));
        triggerHaptic('light');
        playSound('success');
      } catch {
        toastError(t('api.generic_error'));
      }
    } finally {
      setBusy(false);
    }
  };

  const labelTxt = tooltip || t('share.button');
  const aria = ariaLabel || labelTxt;

  if (variant === 'labeled') {
    return (
      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={busy}
        className="action-chip"
        aria-label={aria}
        title={labelTxt}
      >
        <span className="action-chip-icon"><Icon as={Share2} size="xs" /></span>
        {labelTxt}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      disabled={busy}
      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[rgba(0,157,219,0.10)] cursor-pointer transition-all disabled:opacity-50"
      aria-label={aria}
      title={labelTxt}
    >
      <Icon as={Share2} size={16} />
    </button>
  );
}
