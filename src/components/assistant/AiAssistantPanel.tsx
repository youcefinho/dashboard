// ── AiAssistantPanel — Assistant IA conversationnel global (LOT G8) ─────────
//
// Panel slide-over droit, ouvert via Cmd+/ (intégration AppLayout = Phase B
// Manager-C). PAS de page → AUCUNE route ajoutée (panel only).
//
// Composition : sidebar threads (liste + nouvelle conversation + suppression)
// + zone principale = <AiChatThread threadId={activeId} />. État vide avec
// prompts suggérés cliquables qui pré-remplissent l'input du fil.
//
// v1 READ-ONLY / DRAFT-ONLY : l'assistant lit/calcule/rédige des brouillons,
// aucune action mutante automatique (FLAG sécurité #2 — enforcé dans
// AiChatThread, confirmation humaine obligatoire).
//
// Phase B Manager-C — corps réel. Props figées Phase A : { open, onOpenChange }.

import { useEffect, useState, useCallback } from 'react';
import { SlidePanel } from '@/components/ui/SlidePanel';
import { Icon, useConfirm } from '@/components/ui';
import { Plus, Trash2, MessageSquare, Sparkles, Lock } from 'lucide-react';
import { t } from '@/lib/i18n';
import { listAiThreads, createAiThread, deleteAiThread } from '@/lib/api';
import type { AiChatThread as AiChatThreadType, AiPageContext } from '@/lib/types';
import { AiChatThread } from './AiChatThread';

export interface AiAssistantPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * SPRINT 11 (Copilot v2) — contexte de page courante (route + entité) dérivé
   * par AppLayout. Best-effort, optionnel : transmis tel quel au fil, qui
   * l'envoie via sendAiMessage. RE-VALIDÉ + RE-BORNÉ tenant worker-side.
   */
  pageContext?: AiPageContext;
}

const SUGGESTED_KEYS = [
  'assistant.suggested.summarize_leads',
  'assistant.suggested.draft_email',
  'assistant.suggested.revenue',
  'assistant.suggested.next_action',
] as const;

export function AiAssistantPanel({ open, onOpenChange, pageContext }: AiAssistantPanelProps) {
  const [threads, setThreads] = useState<AiChatThreadType[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [noCap, setNoCap] = useState(false);
  const [creating, setCreating] = useState(false);
  // Texte injecté dans le fil quand l'user clique un prompt suggéré
  const [prefill, setPrefill] = useState<string | undefined>(undefined);

  const confirm = useConfirm();

  const loadThreads = useCallback(() => {
    setLoading(true);
    listAiThreads()
      .then((res) => {
        if (res.data && Array.isArray(res.data)) {
          setThreads(res.data);
          setNoCap(false);
          // Sélectionne le thread le plus récent par défaut si aucun actif
          setActiveId((prev) => prev ?? res.data![0]?.id);
        } else if (res.error) {
          // string-match capability ai.use (best-effort, dégradation gracieuse)
          if (/cap|access|forbidden|ai\.use|403/i.test(res.error)) setNoCap(true);
        }
      })
      .catch(() => { /* silencieux — état vide */ })
      .finally(() => setLoading(false));
  }, []);

  // Charge les threads à l'ouverture du panel
  useEffect(() => {
    if (open) loadThreads();
  }, [open, loadThreads]);

  const handleNewThread = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await createAiThread();
      if (res.data && res.data.id) {
        setThreads((prev) => [res.data!, ...prev]);
        setActiveId(res.data.id);
        setPrefill(undefined);
      } else if (res.error && /cap|access|forbidden|ai\.use|403/i.test(res.error)) {
        setNoCap(true);
      }
    } catch { /* silencieux */ }
    finally { setCreating(false); }
  }, [creating]);

  const handleDeleteThread = useCallback(async (id: string) => {
    const ok = await confirm({
      title: t('assistant.delete_thread'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteAiThread(id);
      if (!res.error) {
        setThreads((prev) => prev.filter((th) => th.id !== id));
        setActiveId((prev) => (prev === id ? undefined : prev));
      }
    } catch { /* silencieux */ }
  }, [confirm]);

  // Clic sur un prompt suggéré : crée un thread si besoin puis pré-remplit
  const handleSuggested = useCallback(async (text: string) => {
    if (!activeId) {
      const res = await createAiThread();
      if (res.data && res.data.id) {
        setThreads((prev) => [res.data!, ...prev]);
        setActiveId(res.data.id);
      } else {
        if (res.error && /cap|access|forbidden|ai\.use|403/i.test(res.error)) setNoCap(true);
        return;
      }
    }
    // Toggle pour forcer le useEffect prefill même si même texte
    setPrefill(undefined);
    window.setTimeout(() => setPrefill(text), 0);
  }, [activeId]);

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t('assistant.title')}
      size="lg"
      bodyClassName="!p-0"
    >
      {noCap ? (
        <div className="aichat-nocap" role="status">
          <span className="aichat-nocap-icon" aria-hidden>
            <Icon as={Lock} size={18} />
          </span>
          <p className="aichat-nocap-text">{t('assistant.disabled_no_cap')}</p>
        </div>
      ) : (
        <div className="aichat-layout">
          {/* Sidebar threads */}
          <aside className="aichat-sidebar">
            <button
              type="button"
              className="aichat-new-thread"
              onClick={() => void handleNewThread()}
              disabled={creating}
            >
              <Icon as={Plus} size={14} />
              {t('assistant.new_thread')}
            </button>

            <div className="aichat-threads-title">{t('assistant.threads_title')}</div>

            {loading && threads.length === 0 ? (
              <div className="aichat-threads-empty">{t('assistant.thinking')}</div>
            ) : threads.length === 0 ? (
              <div className="aichat-threads-empty">{t('assistant.no_threads')}</div>
            ) : (
              <ul className="aichat-threads-list">
                {threads.map((th) => (
                  <li key={th.id}>
                    <div className={`aichat-thread-item ${th.id === activeId ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="aichat-thread-select"
                        onClick={() => { setActiveId(th.id); setPrefill(undefined); }}
                      >
                        <Icon as={MessageSquare} size={13} className="aichat-thread-icon" />
                        <span className="aichat-thread-title">{th.title || t('assistant.new_thread')}</span>
                      </button>
                      <button
                        type="button"
                        className="aichat-thread-delete"
                        onClick={() => void handleDeleteThread(th.id)}
                        aria-label={t('assistant.delete_thread')}
                        title={t('assistant.delete_thread')}
                      >
                        <Icon as={Trash2} size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Zone principale = fil de conversation */}
          <div className="aichat-main">
            {activeId ? (
              <AiChatThread threadId={activeId} prefill={prefill} pageContext={pageContext} />
            ) : (
              <div className="aichat-empty">
                <span className="aichat-empty-icon-chip" aria-hidden>
                  <Icon as={Sparkles} size={20} className="aichat-empty-icon" />
                </span>
                <p>{t('assistant.empty_state')}</p>
                <div className="aichat-suggested">
                  {SUGGESTED_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="aichat-suggested-chip"
                      onClick={() => void handleSuggested(t(key))}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
                <div className="aichat-shortcut-hint">{t('assistant.shortcut_hint')}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
