import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from 'sonner';

export function NpsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Dans la réalité, on vérifierait si (now - created_at) > 90 jours et si on a pas déjà répondu
    // Pour la démo, on utilise un timeout simple
    const hasAnswered = localStorage.getItem('intralys_nps_answered');
    if (!hasAnswered) {
      const timer = setTimeout(() => setIsOpen(true), 60000); // Popup après 1 min de session MVP
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
    <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Votre avis compte">
      <div className="w-[500px] max-w-full">
        {step === 1 ? (
          <div className="text-center animate-fade-in">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-6">
              Quelle est la probabilité que vous recommandiez Intralys à un collègue ou un ami ?
            </h3>
            
            <div className="flex justify-between items-center bg-[var(--bg-surface)] p-2 rounded-xl mb-4 border border-[var(--border-default)]">
              {[0,1,2,3,4,5,6,7,8,9,10].map(num => (
                <button
                  key={num}
                  onClick={() => handleScoreSelect(num)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-medium text-[var(--text-secondary)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-primary)] hover:font-bold transition-all"
                >
                  {num}
                </button>
              ))}
            </div>
            
            <div className="flex justify-between text-xs text-[var(--text-muted)] uppercase font-medium">
              <span>Pas du tout probable</span>
              <span>Très probable</span>
            </div>
          </div>
        ) : (
          <div className="animate-fade-in">
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
              {score && score >= 9 ? 'Super ! Qu\'est-ce qui vous plaît le plus ?' :
               score && score >= 7 ? 'Merci. Que pourrions-nous améliorer ?' :
               'Désolé de l\'apprendre. Comment pouvons-nous corriger le tir ?'}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Votre réponse détaillée nous aidera à faire d'Intralys le meilleur outil pour vous.
            </p>
            
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Partagez vos pensées..."
              className="w-full h-32 p-3 border border-[var(--border-default)] rounded-xl focus:outline-none focus:border-[var(--brand-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)] mb-6 resize-none"
            />
            
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>Plus tard</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? 'Envoi...' : 'Envoyer la réponse'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
