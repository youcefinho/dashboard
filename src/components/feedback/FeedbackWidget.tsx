import { useState } from 'react';
import { MessageSquarePlus, X, Send } from 'lucide-react';
import { toast } from 'sonner';

export function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      toast.error('Veuillez sélectionner une note.');
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
      toast.error('Erreur lors de l\'envoi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {isOpen ? (
        <div className="bg-white rounded-2xl shadow-2xl border border-[var(--border-default)] w-[320px] overflow-hidden animate-fade-in-up">
          <div className="bg-[var(--brand-primary)] p-4 text-white flex justify-between items-center">
            <h3 className="font-bold">Votre avis compte</h3>
            <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          
          <div className="p-5">
            {submitted ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Send size={24} />
                </div>
                <h4 className="font-bold text-[var(--text-primary)] mb-1">Merci !</h4>
                <p className="text-sm text-[var(--text-secondary)]">Vos retours nous aident à améliorer Intralys.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2 text-center">
                    Comment évaluez-vous votre expérience ?
                  </label>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className={`text-2xl transition-transform hover:scale-110 ${rating >= star ? 'text-amber-400' : 'text-[var(--text-muted)] grayscale opacity-50'}`}
                      >
                        ⭐️
                      </button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <textarea 
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Dites-nous ce qui fonctionne bien, ou ce qu'on pourrait améliorer..."
                    className="w-full h-24 p-3 text-sm border border-[var(--border-default)] rounded-xl focus:outline-none focus:border-[var(--brand-primary)] resize-none bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  />
                </div>
                
                <button 
                  type="submit" 
                  disabled={isSubmitting || rating === 0}
                  className="w-full py-2.5 bg-[var(--brand-primary)] text-white font-medium rounded-xl hover:bg-[var(--brand-hover)] transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Envoi...' : 'Envoyer'}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <button 
          onClick={() => setIsOpen(true)}
          className="w-12 h-12 bg-[var(--brand-primary)] text-white rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          aria-label="Donner votre avis"
        >
          <MessageSquarePlus size={24} />
        </button>
      )}
    </div>
  );
}
