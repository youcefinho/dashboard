import { useState } from 'react';
import { MessageSquarePlus, X, Send, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea, Icon } from '@/components/ui';
import { t } from '@/lib/i18n';

export function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      toast.error(t('feedback.fw_select_rating'));
      return;
    }

    setIsSubmitting(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('intralys_token')}`
        },
        body: JSON.stringify({ rating, comment })
      });
      setSubmitted(true);
      setTimeout(() => setIsOpen(false), 3000);
    } catch (err) {
      toast.error(t('feedback.fw_send_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {isOpen ? (
        <div
          className="rounded-2xl shadow-2xl w-[340px] overflow-hidden animate-in slide-in-from-bottom-2 fade-in-0 duration-300"
          style={{
            background: 'rgba(255,255,255,0.98)',
            backdropFilter: 'blur(12px) saturate(160%)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.28)',
          }}
        >
          {/* Header gradient brand subtil + Sparkles */}
          <div
            className="relative p-4 flex justify-between items-center"
            style={{
              background:
                'linear-gradient(135deg, rgba(0,157,219,0.18) 0%, rgba(217,110,39,0.14) 100%)',
              borderBottom: '1px solid rgba(0,157,219,0.18)',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'var(--primary)',
                  boxShadow: '0 4px 12px rgba(0,157,219,0.40)',
                }}
              >
                <Icon as={Sparkles} size="md" className="text-white" />
              </span>
              <h3 className="font-bold text-[var(--text-primary)]">{t('feedback.fw_title')}</h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded-md hover:bg-[rgba(0,0,0,0.04)]"
              aria-label={t('feedback.fw_close')}
            >
              <Icon as={X} size={18} />
            </button>
          </div>

          <div className="p-5">
            {submitted ? (
              <div className="text-center py-6 animate-in fade-in-0 zoom-in-95 duration-200">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
                  style={{
                    background: 'linear-gradient(135deg, rgba(55,202,55,0.20) 0%, rgba(0,157,219,0.16) 100%)',
                    border: '1px solid rgba(55,202,55,0.40)',
                    boxShadow: '0 0 24px -4px rgba(55,202,55,0.40)',
                  }}
                >
                  <Icon as={Send} size={24} className="text-[var(--success)]" />
                </div>
                <h4 className="font-bold text-[var(--text-primary)] mb-1">{t('feedback.fw_thanks_title')}</h4>
                <p className="text-sm text-[var(--text-secondary)]">{t('feedback.fw_thanks_body')}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2 text-center">
                    {t('feedback.fw_rate_label')}
                  </label>
                  <div className="flex justify-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const active = (hoverRating || rating) >= star;
                      return (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          className={`chip-btn chip-btn--sm transition-all duration-200 ${active ? 'is-active' : ''}`}
                          aria-label={star > 1 ? t('feedback.fw_star_aria').replace('{n}', String(star)) : t('feedback.fw_star_aria_one')}
                          style={
                            active
                              ? {
                                  background: 'var(--primary)',
                                  color: 'white',
                                  borderColor: 'transparent',
                                  boxShadow: '0 4px 12px -2px rgba(0,157,219,0.45)',
                                  transform: hoverRating === star ? 'scale(1.06)' : 'scale(1)',
                                }
                              : undefined
                          }
                        >
                          <Icon as={Star} size={14} fill={active ? 'currentColor' : 'transparent'} strokeWidth={active ? 2.5 : 2} />
                        </button>
                      );
                    })}
                  </div>
                  {rating > 0 && (
                    <p className="text-center text-xs text-[var(--text-muted)] mt-2">
                      {rating === 5 ? t('feedback.fw_r5') : rating === 4 ? t('feedback.fw_r4') : rating === 3 ? t('feedback.fw_r3') : rating === 2 ? t('feedback.fw_r2') : t('feedback.fw_r1')}
                    </p>
                  )}
                </div>

                <Textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder={t('feedback.fw_comment_ph')}
                  maxLength={500}
                  showCounter
                  rows={4}
                  resize="none"
                />

                <button
                  type="submit"
                  disabled={isSubmitting || rating === 0}
                  className="w-full py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:translate-y-[-1px] active:translate-y-0"
                  style={{
                    background: 'var(--primary)',
                    boxShadow: '0 4px 14px -2px rgba(0,157,219,0.45)',
                  }}
                >
                  {isSubmitting ? t('feedback.fw_sending') : t('feedback.fw_send')}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="w-12 h-12 text-white rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
          style={{
            background: 'var(--primary)',
            boxShadow: '0 6px 20px -2px rgba(0,157,219,0.50), 0 0 0 4px rgba(0,157,219,0.10)',
          }}
          aria-label={t('feedback.fw_fab_aria')}
        >
          <Icon as={MessageSquarePlus} size={22} />
        </button>
      )}
    </div>
  );
}
