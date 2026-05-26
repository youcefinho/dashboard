import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

// Couleur par tranche NPS (detractor 0-6, passive 7-8, promoter 9-10)
function npsBucket(n: number): 'detractor' | 'passive' | 'promoter' {
  if (n >= 9) return 'promoter';
  if (n >= 7) return 'passive';
  return 'detractor';
}

function bucketStyle(bucket: 'detractor' | 'passive' | 'promoter', isActive: boolean): React.CSSProperties {
  if (isActive) {
    // Active = gradient brand peu importe le bucket (signature)
    return {
      background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
      color: 'white',
      borderColor: 'transparent',
      boxShadow: '0 6px 18px -2px rgba(0,157,219,0.50), 0 0 0 4px rgba(0,157,219,0.18)',
      transform: 'scale(1.08)',
    };
  }
  if (bucket === 'detractor') {
    return {
      background: 'rgba(233,61,61,0.08)',
      borderColor: 'rgba(233,61,61,0.30)',
      color: '#c92424',
    };
  }
  if (bucket === 'passive') {
    return {
      background: 'rgba(255,154,0,0.10)',
      borderColor: 'rgba(255,154,0,0.32)',
      color: '#a86a00',
    };
  }
  return {
    background: 'rgba(55,202,55,0.10)',
    borderColor: 'rgba(55,202,55,0.32)',
    color: '#1f8f1f',
  };
}

export function NpsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const hasAnswered = localStorage.getItem('intralys_nps_answered');
    if (!hasAnswered) {
      const timer = setTimeout(() => setIsOpen(true), 60000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleScoreSelect = (s: number) => {
    setScore(s);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (score === null) return;

    setIsSubmitting(true);
    try {
      await fetch('/api/nps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('intralys_token')}`
        },
        body: JSON.stringify({ score, comment })
      });

      localStorage.setItem('intralys_nps_answered', 'true');
      toast.success(t('feedback.nps_thanks'));
      setIsOpen(false);
    } catch (err) {
      toast.error(t('feedback.nps_send_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onOpenChange={setIsOpen} title={t('feedback.nps_title')}>
      <div className="w-[520px] max-w-full">
        {step === 1 ? (
          <div className="text-center animate-in fade-in-0 duration-200">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-6 leading-snug">
              {t('feedback.nps_question')}
            </h3>

            <div className="flex flex-wrap justify-center gap-1.5 mb-4">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => {
                const bucket = npsBucket(num);
                const isActive = score === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleScoreSelect(num)}
                    className="chip-btn chip-btn--label font-bold tabular-nums transition-all duration-200"
                    style={{
                      ...bucketStyle(bucket, isActive),
                      minWidth: 38,
                      height: 38,
                      padding: '0 6px',
                      fontSize: 13,
                    }}
                    aria-label={t('feedback.nps_score_aria').replace('{n}', String(num))}
                  >
                    {num}
                  </button>
                );
              })}
            </div>

            <div className="flex justify-between text-[10px] text-[var(--text-muted)] uppercase font-bold tracking-[0.16em] px-1">
              <span>{t('feedback.nps_not_likely')}</span>
              <span>{t('feedback.nps_very_likely')}</span>
            </div>

            {/* Légende couleurs */}
            <div className="flex items-center justify-center gap-4 mt-6 text-[10px] text-[var(--text-muted)] font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#E93D3D' }} /> {t('feedback.nps_detractors')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#FF9A00' }} /> {t('feedback.nps_passives')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#37CA37' }} /> {t('feedback.nps_promoters')}
              </span>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
              {score !== null && score >= 9 ? t('feedback.nps_q_promoter') :
               score !== null && score >= 7 ? t('feedback.nps_q_passive') :
               t('feedback.nps_q_detractor')}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {t('feedback.nps_followup')}
            </p>

            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={t('feedback.nps_comment_ph')}
              rows={5}
              maxLength={800}
              showCounter
              resize="none"
              className="mb-6"
            />

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('feedback.nps_later')}</Button>
              <Button variant="premium" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                {isSubmitting ? t('feedback.nps_sending') : t('feedback.nps_send')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
