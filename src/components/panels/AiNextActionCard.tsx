// ── AiNextActionCard — Suggestion AI de prochaine étape pour un lead inactif ─
// Affiché en sidebar LeadDetail si `lead.updated_at > 7j` et status actif.
// Génération lazy (au click "Générer") pour éviter de tirer Claude au load.
//
// Différenciateur vs GHL : action proposée + brouillon prêt à utiliser.

import { useState } from 'react';
import { Sparkles, Loader2, Mail, MessageSquare, Phone, Copy, Check } from 'lucide-react';
import { Card, Button, useToast, Icon as UIcon } from '@/components/ui';
import { aiSuggestNextAction, type AiNextAction } from '@/lib/api';

interface AiNextActionCardProps {
  leadId: string;
}

const ACTION_META: Record<AiNextAction['action'], { icon: typeof Mail; label: string; color: string }> = {
  email: { icon: Mail, label: 'Email', color: 'var(--info)' },
  sms: { icon: MessageSquare, label: 'SMS', color: 'var(--success)' },
  call: { icon: Phone, label: 'Appel', color: 'var(--accent-orange)' },
};

export function AiNextActionCard({ leadId }: AiNextActionCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<AiNextAction | null>(null);
  const [copied, setCopied] = useState(false);
  const { error: toastError, success } = useToast();

  const generate = async () => {
    setIsLoading(true);
    const res = await aiSuggestNextAction(leadId);
    setIsLoading(false);
    if (res.error || !res.data) {
      toastError(`Erreur AI : ${res.error || 'pas de suggestion disponible'}`);
      return;
    }
    setSuggestion(res.data);
  };

  const copyDraft = () => {
    if (!suggestion?.draft) return;
    void navigator.clipboard.writeText(suggestion.draft);
    setCopied(true);
    success('Brouillon copié');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!suggestion) {
    return (
      <Card className="p-4 border border-dashed border-[var(--primary)]/40 bg-gradient-to-br from-[var(--primary)]/12 to-[var(--accent-orange)]/8">
        <div className="flex items-start gap-2 mb-2">
          <UIcon as={Sparkles} size="sm" className="text-[var(--primary)] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">Prochaine étape suggérée</h3>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Ce lead semble inactif — laissez l'AI proposer une action concrète.</p>
          </div>
        </div>
        <Button size="sm" className="w-full justify-center" onClick={() => void generate()} disabled={isLoading}
          leftIcon={isLoading ? <UIcon as={Loader2} size="xs" className="animate-spin" /> : <UIcon as={Sparkles} size="xs" />}>
          {isLoading ? 'Génération…' : 'Générer une suggestion'}
        </Button>
      </Card>
    );
  }

  const meta = ACTION_META[suggestion.action] || ACTION_META.email;
  const ActionIcon = meta.icon;

  return (
    <Card className="p-4 bg-gradient-to-br from-[var(--primary)]/12 to-[var(--accent-orange)]/8 border border-[var(--primary)]/30">
      <div className="flex items-start gap-2 mb-2">
        <UIcon as={Sparkles} size="xs" className="text-[var(--primary)] mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <UIcon as={ActionIcon} size="xs" style={{ color: meta.color }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
              {meta.label} suggéré
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{suggestion.reason}</p>
        </div>
      </div>

      <div className="mt-3 p-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-h-32 overflow-y-auto">
        <p className="text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{suggestion.draft}</p>
      </div>

      <div className="flex items-center gap-1.5 mt-2">
        <Button size="sm" variant="secondary" className="flex-1 justify-center"
          leftIcon={copied ? <UIcon as={Check} size="xs" /> : <UIcon as={Copy} size="xs" />}
          onClick={copyDraft}>
          {copied ? 'Copié' : 'Copier'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setSuggestion(null); void generate(); }} title="Régénérer" aria-label="Régénérer la suggestion">
          <UIcon as={Sparkles} size="xs" />
        </Button>
      </div>
      <p className="text-[9px] text-[var(--text-muted)] mt-1.5 text-center">Généré par Claude Haiku 4.5</p>
    </Card>
  );
}
