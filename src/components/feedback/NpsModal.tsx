import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui';
import { toast } from 'sonner';

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
      toast.success('Merci pour vos précieux retours !');
      setIsOpen(false);
    } catch (err) {
      toast.error('Erreur lors de l\'envoi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onOpenChange={setIsOpen} title="Votre avis compte">
      <div className="w-[520px] max-w-full">
        {step === 1 ? (
          <div className="text-center animate-in fade-in-0 duration-200">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-6 leading-snug">
              Quelle est la probabilité que vous recommandiez Intralys à un collègue ou un ami ?
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
                    aria-label={`Note ${num} sur 10`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>

            <div className="flex justify-between text-[10px] text-[var(--text-muted)] uppercase font-bold tracking-[0.16em] px-1">
              <span>Pas du tout probable</span>
              <span>Très probable</span>
            </div>

            {/* Légende couleurs */}
            <div className="flex items-center justify-center gap-4 mt-6 text-[10px] text-[var(--text-muted)] font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#E93D3D' }} /> Détracteurs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#FF9A00' }} /> Passifs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#37CA37' }} /> Promoteurs
              </span>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
              {score !== null && score >= 9 ? 'Super ! Qu\'est-ce qui vous plaît le plus ?' :
               score !== null && score >= 7 ? 'Merci. Que pourrions-nous améliorer ?' :
               'Désolé de l\'apprendre. Comment pouvons-nous corriger le tir ?'}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Votre réponse détaillée nous aidera à faire d'Intralys le meilleur outil pour vous.
            </p>

            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Partagez vos pensées..."
              rows={5}
              maxLength={800}
              showCounter
              resize="none"
              className="mb-6"
            />

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>Plus tard</Button>
              <Button variant="premium" onClick={() => void handleSubmit()} disabled={isSubmitting}>
                {isSubmitting ? 'Envoi...' : 'Envoyer la réponse'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
