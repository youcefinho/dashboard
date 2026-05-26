// ── Sprint 50 M3.4 — Beta feedback widget (FAB bottom-right) ───────────────
// Distinct du FeedbackWidget NPS existant (rating/comment). Celui-ci capture
// type (Bug / Idée / Question) + message + screenshot optionnel + url + email.
// FAB sober Stripe (pas glow/gradient brand), z-index SOUS Toast.
// Screenshot : html2canvas si dispo dynamiquement, sinon on skip silencieusement.

import { useState } from 'react';
import { MessageCircleQuestion, X, Send, Loader2, Camera, Check } from 'lucide-react';
import { Textarea, Icon } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/lib/i18n';

type FbType = 'bug' | 'idea' | 'question';

// LOT C — label résolu AU RENDER via t('feedback.beta_type_<key>')
const TYPES: Array<{ key: FbType; labelKey: string }> = [
  { key: 'bug', labelKey: 'feedback.beta_type_bug' },
  { key: 'idea', labelKey: 'feedback.beta_type_idea' },
  { key: 'question', labelKey: 'feedback.beta_type_question' },
];

export function BetaFeedbackWidget() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FbType>('idea');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setType('idea');
    setMessage('');
    setShot(null);
  }

  async function captureScreenshot() {
    setShotBusy(true);
    try {
      // html2canvas est OPTIONNEL (pas une dépendance du projet). Le specifier
      // est calculé dynamiquement + @vite-ignore pour que Rollup ne tente PAS
      // de résoudre le module au build. Si absent au runtime → skip silencieux.
      const lib = 'html2canvas';
      const mod = await import(/* @vite-ignore */ lib).catch(() => null);
      const fn = mod && (mod.default || mod);
      if (!fn || typeof fn !== 'function') {
        toast.error(t('feedback.beta_capture_unavail'));
        return;
      }
      const canvas = await (fn as any)(document.body, {
        logging: false,
        useCORS: true,
        scale: 0.6,
      });
      setShot(canvas.toDataURL('image/jpeg', 0.6));
    } catch {
      toast.error(t('feedback.beta_capture_failed'));
    } finally {
      setShotBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!message.trim()) {
      toast.error(t('feedback.beta_write_msg'));
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('intralys_token');
      const res = await fetch('/api/beta/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type,
          message: message.trim(),
          url: window.location.pathname + window.location.search,
        }),
      });
      if (res.ok) {
        toast.success(t('feedback.beta_thanks'), { title: t('feedback.beta_thanks_title') });
        reset();
        setOpen(false);
      } else {
        toast.error(t('feedback.beta_send_impossible'));
      }
    } catch {
      toast.error(t('feedback.beta_check_conn'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="beta-fb">
      {open ? (
        <div className="beta-fb__panel" role="dialog" aria-label={t('feedback.beta_dialog_aria')}>
          <header className="beta-fb__head">
            <h3 className="beta-fb__title">{t('feedback.beta_panel_title')}</h3>
            <button
              type="button"
              className="beta-fb__close"
              onClick={() => setOpen(false)}
              aria-label={t('feedback.beta_close')}
            >
              <Icon as={X} size={16} aria-hidden />
            </button>
          </header>

          <form className="beta-fb__form" onSubmit={handleSubmit}>
            <div className="beta-fb__seg" role="radiogroup" aria-label={t('feedback.beta_type_aria')}>
              {TYPES.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={type === opt.key}
                  className={`beta-fb__seg-btn ${type === opt.key ? 'is-active' : ''}`}
                  onClick={() => setType(opt.key)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>

            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('feedback.beta_msg_ph')}
              rows={4}
              maxLength={2000}
              resize="none"
              aria-label={t('feedback.beta_msg_aria')}
            />

            <div className="beta-fb__actions">
              <button
                type="button"
                className={`beta-fb__shot ${shot ? 'is-done' : ''}`}
                onClick={captureScreenshot}
                disabled={shotBusy || !!shot}
              >
                {shotBusy ? (
                  <Icon as={Loader2} size={14} className="animate-spin" aria-hidden />
                ) : shot ? (
                  <Icon as={Check} size={14} aria-hidden />
                ) : (
                  <Icon as={Camera} size={14} aria-hidden />
                )}
                {shot ? t('feedback.beta_shot_attached') : shotBusy ? t('feedback.beta_shot_busy') : t('feedback.beta_shot_attach')}
              </button>

              <button
                type="submit"
                className="beta-fb__submit"
                disabled={submitting}
              >
                {submitting ? (
                  <Icon as={Loader2} size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Icon as={Send} size={14} aria-hidden />
                )}
                {submitting ? t('feedback.beta_sending') : t('feedback.beta_send')}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          type="button"
          className="beta-fb__fab"
          onClick={() => setOpen(true)}
          aria-label={t('feedback.beta_fab_aria')}
        >
          <Icon as={MessageCircleQuestion} size={20} aria-hidden />
        </button>
      )}
    </div>
  );
}

export default BetaFeedbackWidget;
