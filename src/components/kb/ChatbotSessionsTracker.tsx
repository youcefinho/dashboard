import { useEffect, useState, useCallback } from 'react';
import { listChatbotSessions, toggleChatbotSession } from '@/lib/api';
import type { ChatbotSession } from '@/lib/types';
import { Button, Card, Tag, Skeleton, useToast } from '@/components/ui';
import { RefreshCw, Bot, Power, Clock } from 'lucide-react';

export function ChatbotSessionsTracker() {
  const { success, error } = useToast();
  const [sessions, setSessions] = useState<ChatbotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listChatbotSessions();
      if (res.data) {
        setSessions(res.data);
      } else if (res.error) {
        error(res.error);
      }
    } catch (err) {
      error("Impossible de charger les sessions du chatbot");
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleToggleSession = async (id: string, currentActive: number) => {
    setTogglingId(id);
    const newActive = currentActive === 1 ? false : true;
    try {
      const res = await toggleChatbotSession(id, newActive);
      if (res.error) {
        error(res.error);
      } else {
        success(
          newActive
            ? "Session reprise par le chatbot IA !"
            : "Session escaladée avec succès vers un conseiller humain !"
        );
        void loadSessions();
      }
    } catch (err) {
      error("Erreur lors de la modification de la session");
    } finally {
      setTogglingId(null);
    }
  };

  const getConfidenceTag = (score: number) => {
    const val = Math.round(score * 100);
    if (score >= 0.75) {
      return (
        <Tag variant="success" size="xs">
          {val}% Confiance
        </Tag>
      );
    }
    if (score >= 0.5) {
      return (
        <Tag variant="warning" size="xs">
          {val}% Confiance
        </Tag>
      );
    }
    return (
      <Tag variant="danger" size="xs">
        {val}% Confiance
      </Tag>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-md)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="chatbot-sessions-tracker">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 className="t-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bot size={20} className="text-[var(--brand-primary)]" />
            Supervision du Chatbot
          </h2>
          <p className="t-caption">
            Suivez les sessions actives du robot conversationnel en direct et reprenez la main manuellement si besoin.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw size={14} />}
          onClick={loadSessions}
        >
          Rafraîchir
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Card className="p-6 text-center text-[var(--text-muted)] text-sm">
          Aucune session de chatbot enregistrée pour le moment.
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="kb-table" role="table">
            <div className="kb-row kb-row--head" role="row">
              <span role="columnheader">ID de Session</span>
              <span role="columnheader">Statut</span>
              <span role="columnheader">Confiance IA</span>
              <span role="columnheader">Dernière activité</span>
              <span role="columnheader" style={{ textAlign: 'right' }}>Actions</span>
            </div>

            {sessions.map(s => {
              const isToggling = togglingId === s.id;
              const dateObj = s.updated_at ? new Date(s.updated_at + 'Z') : new Date();

              return (
                <div key={s.id} className="kb-row" role="row" style={{ alignItems: 'center' }}>
                  <span role="cell" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {s.session_token.slice(0, 8)}...{s.session_token.slice(-8)}
                  </span>
                  <span role="cell">
                    {s.is_active === 1 ? (
                      <Tag variant="success" size="xs" statusIcon={true}>
                        Géré par le Bot
                      </Tag>
                    ) : (
                      <Tag variant="neutral" size="xs">
                        Humain requis
                      </Tag>
                    )}
                  </span>
                  <span role="cell">
                    {getConfidenceTag(s.confidence_avg)}
                  </span>
                  <span role="cell" className="t-caption" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: 'var(--text-muted)' }}>
                    <Clock size={11} />
                    {dateObj.toLocaleTimeString()} {dateObj.toLocaleDateString()}
                  </span>
                  <span role="cell" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button
                      variant={s.is_active === 1 ? "danger" : "secondary"}
                      size="sm"
                      leftIcon={<Power size={11} />}
                      isLoading={isToggling}
                      disabled={isToggling}
                      onClick={() => void handleToggleSession(s.id, s.is_active)}
                    >
                      {s.is_active === 1 ? "Reprendre main" : "Activer Bot"}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
