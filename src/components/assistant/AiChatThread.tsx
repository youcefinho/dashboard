// ── AiChatThread — Fil de conversation de l'assistant IA (LOT G8) ───────────
//
// Liste des messages (user / assistant) + champ de saisie + envoi. Persiste via
// les helpers api.ts (getAiThread / sendAiMessage — JSON simple, PAS de
// streaming v1 : après sendAiMessage on reçoit le message assistant complet).
//
// v1 READ-ONLY / DRAFT-ONLY : si une réponse assistant contient un brouillon
// (workflow / courriel), on l'affiche en lecture seule avec un bouton qui
// COPIE le brouillon ou NAVIGUE vers /workflows après confirmation humaine.
// AUCUNE mutation n'est exécutée automatiquement depuis une sortie LLM.
//
// Phase B Manager-C — corps réel. Props figées Phase A : { threadId? }.

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getAiThread, sendAiMessage, confirmAiAction } from '@/lib/api';
import type { AiChatMessage, AiProposedAction, AiPageContext } from '@/lib/types';
import { t } from '@/lib/i18n';
import { Icon, useToast, useConfirm, AiLoadingShimmer } from '@/components/ui';
import { Send, Copy, Check, RotateCw, Sparkles, FileText, Zap, X as XIcon, AlertTriangle } from 'lucide-react';

export interface AiChatThreadProps {
  /** Thread actif (undefined ⇒ rien à charger, le panel gère la création). */
  threadId?: string;
  /** Texte injecté par un prompt suggéré (pré-remplit l'input). Optionnel. */
  prefill?: string;
  /** Notifie le parent qu'un thread vient d'être créé implicitement (non utilisé v1). */
  onThreadActivity?: () => void;
  /**
   * SPRINT 11 (Copilot v2) — contexte de page courante (route + entité)
   * transmis à sendAiMessage. Best-effort, optionnel : absent ⇒ body v1
   * byte-identique. RE-VALIDÉ + RE-BORNÉ tenant worker-side.
   */
  pageContext?: AiPageContext;
}

// SPRINT 11 — état local d'exécution d'une action proposée (par action.id).
// 'idle' (par défaut) → 'executing' (clic Exécuter) → 'executed' | 'failed'.
type ActionState =
  | { status: 'executing' }
  | { status: 'executed'; result?: string }
  | { status: 'failed'; result?: string };

// Libellé i18n du type d'action (titre de la carte). Best-effort : si l'outil
// est inconnu, on retombe sur le libellé générique « Action suggérée ».
function actionTitleKey(tool: AiProposedAction['tool']): string {
  switch (tool) {
    case 'create_task': return 'assistant.action.create_task';
    case 'update_lead_status': return 'assistant.action.update_status';
    case 'add_lead_tag': return 'assistant.action.add_tag';
    default: return 'assistant.action.propose';
  }
}

// Détection mode démo (mock_notice) : le worker peut taguer la réponse via le
// contenu ou tool_calls. Best-effort string-match — aucune dépendance dure.
function isMockMessage(m: AiChatMessage): boolean {
  if (m.tool_calls && /mock|demo|simul/i.test(m.tool_calls)) return true;
  return false;
}

// Détection brouillon (workflow JSON / courriel) dans tool_calls sérialisés.
// On reste défensif : pas de parsing strict, juste un repérage best-effort.
interface DraftInfo {
  kind: 'workflow' | 'email' | 'generic';
  raw: string;
}

function extractDraft(m: AiChatMessage): DraftInfo | null {
  if (m.role !== 'assistant' || !m.tool_calls) return null;
  const raw = m.tool_calls;
  if (/workflow|automation/i.test(raw)) return { kind: 'workflow', raw };
  if (/email|courriel|draft_email|reply/i.test(raw)) return { kind: 'email', raw };
  // tool_calls présent mais non typé → brouillon générique copiable
  if (raw.trim().length > 0) return { kind: 'generic', raw };
  return null;
}

// Rendu markdown léger sans dépendance (gras **x**, italique *x*, code `x`,
// retours ligne → paragraphes). react-markdown n'est PAS importé ici pour
// éviter d'alourdir le bundle de l'assistant — rendu maison suffisant v1.
function renderLightMarkdown(text: string): ReactNode {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n');
    return (
      <p key={bi} className="aichat-md-p">
        {lines.map((line, li) => (
          <span key={li}>
            {renderInline(line)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

function renderInline(line: string): ReactNode {
  // Découpe sur **gras**, *italique*, `code` — regex simple, ordre prioritaire.
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index));
    const tok = match[0];
    if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) parts.push(<code key={key++} className="aichat-md-code">{tok.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts;
}

export function AiChatThread({ threadId, prefill, pageContext }: AiChatThreadProps = {}) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);   // chargement du thread
  const [sending, setSending] = useState(false);   // envoi message (thinking)
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null); // message à retry
  const [mockNotice, setMockNotice] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // SPRINT 11 — état d'exécution par action proposée (clé = action.id).
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  // Actions « Annuler »ées localement (masquées, pas de double-clic). Best-effort.
  const [dismissedActions, setDismissedActions] = useState<Record<string, true>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const { success } = useToast();
  const confirm = useConfirm();

  // Pré-remplissage depuis un prompt suggéré
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      inputRef.current?.focus();
    }
  }, [prefill]);

  // Chargement des messages au changement de threadId
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAiThread(threadId)
      .then((res) => {
        if (cancelled) return;
        if (res.data && Array.isArray(res.data.messages)) {
          setMessages(res.data.messages);
          if (res.data.messages.some(isMockMessage)) setMockNotice(true);
        } else if (res.error) {
          setError(res.error);
        }
      })
      .catch(() => { if (!cancelled) setError(t('assistant.error')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [threadId]);

  // Auto-scroll en bas à chaque nouveau message / état thinking
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const doSend = useCallback(async (content: string) => {
    if (!threadId || !content.trim() || sending) return;
    const text = content.trim();
    // Affichage optimiste du message user (id temporaire local).
    const optimistic: AiChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setSending(true);
    setError(null);
    setLastFailed(null);
    try {
      // SPRINT 11 — transmet le contexte de page courante (best-effort). Absent
      // ⇒ helper envoie le body v1 byte-identique (rétro-compat G8).
      const res = await sendAiMessage(threadId, text, pageContext);
      if (res.data && res.data.message) {
        const assistantMsg = res.data.message;
        if (isMockMessage(assistantMsg)) setMockNotice(true);
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // Erreur API — string-match capability ai.use (best-effort)
        const errStr = res.error || '';
        if (/cap|access|forbidden|ai\.use|403/i.test(errStr)) {
          setError(t('assistant.disabled_no_cap'));
        } else {
          setError(t('assistant.error'));
        }
        setLastFailed(text);
      }
    } catch {
      setError(t('assistant.error'));
      setLastFailed(text);
    } finally {
      setSending(false);
    }
  }, [threadId, sending, pageContext]);

  // SPRINT 11 — confirmation HUMAINE d'une action proposée. Le clic « Exécuter »
  // EST la confirmation : on appelle confirmAiAction directement (best-effort,
  // pas de crash). Une action en cours / exécutée est désactivée (pas de
  // double-clic). Le worker RE-VALIDE l'action_id + RE-BORNE le tenant.
  const handleConfirmAction = useCallback(async (action: AiProposedAction) => {
    if (!threadId) return;
    const current = actionStates[action.id];
    // Anti double-clic : déjà en cours ou déjà exécutée → on ignore.
    if (current && (current.status === 'executing' || current.status === 'executed')) return;
    setActionStates((prev) => ({ ...prev, [action.id]: { status: 'executing' } }));
    try {
      const res = await confirmAiAction(threadId, action.id);
      if (res.data && res.data.executed) {
        setActionStates((prev) => ({
          ...prev,
          [action.id]: { status: 'executed', result: res.data!.result },
        }));
        success(t('assistant.action.executed'));
      } else {
        // executed=false OU erreur API : échec propre, réessai possible.
        const result = (res.data && res.data.result) || res.error || undefined;
        setActionStates((prev) => ({
          ...prev,
          [action.id]: { status: 'failed', result },
        }));
      }
    } catch {
      setActionStates((prev) => ({
        ...prev,
        [action.id]: { status: 'failed' },
      }));
    }
  }, [threadId, actionStates, success]);

  // SPRINT 11 — « Annuler » : masque la carte localement (aucun appel réseau,
  // aucune mutation). L'action n'est jamais exécutée sans clic « Exécuter ».
  const handleDismissAction = useCallback((actionId: string) => {
    setDismissedActions((prev) => ({ ...prev, [actionId]: true }));
  }, []);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    void doSend(input);
  }, [doSend, input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envoie, Shift+Enter = nouvelle ligne
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void doSend(input);
    }
  }, [doSend, input]);

  const handleRetry = useCallback(() => {
    if (lastFailed) {
      const text = lastFailed;
      // Retire le dernier message user optimiste resté sans réponse
      setMessages((prev) => {
        const next = [...prev];
        if (next.length && next[next.length - 1]!.role === 'user') next.pop();
        return next;
      });
      void doSend(text);
    }
  }, [lastFailed, doSend]);

  const copyDraft = useCallback((id: string, raw: string) => {
    try {
      void navigator.clipboard?.writeText(raw);
      setCopiedId(id);
      success(t('assistant.copied'));
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1800);
    } catch { /* clipboard indispo — silencieux */ }
  }, [success]);

  // DRAFT-ONLY : confirmation humaine AVANT toute navigation/action. v1 ne fait
  // QUE naviguer vers /workflows (pré-rempli côté page) — aucune mutation auto.
  const handleCreateWorkflow = useCallback(async (raw: string) => {
    const ok = await confirm({
      title: t('assistant.create_workflow_cta'),
      description: t('assistant.confirm_create'),
      confirmLabel: t('assistant.confirm_create'),
    });
    if (!ok) return;
    // Pas d'exécution : on dépose le brouillon en sessionStorage pour que la
    // page Workflows puisse le pré-remplir, puis on navigue. Aucune mutation.
    try { sessionStorage.setItem('intralys_ai_workflow_draft', raw); } catch { /* ignore */ }
    void navigate({ to: '/workflows' });
  }, [confirm, navigate]);

  // ── États non-chat ─────────────────────────────────────────────────────────
  if (!threadId) {
    return (
      <div className="aichat-empty">
        <Icon as={Sparkles} size={20} className="aichat-empty-icon" />
        <p>{t('assistant.empty_state')}</p>
      </div>
    );
  }

  return (
    <div className="aichat-thread">
      {mockNotice && (
        <div className="aichat-mock-notice" role="status">
          {t('assistant.mock_notice')}
        </div>
      )}

      <div className="aichat-messages" ref={scrollRef}>
        {loading && messages.length === 0 ? (
          <div className="aichat-loading">
            <AiLoadingShimmer text={t('assistant.thinking')} size="sm" />
          </div>
        ) : messages.length === 0 ? (
          <div className="aichat-empty aichat-empty--inline">
            <span className="aichat-empty-icon-chip" aria-hidden>
              <Icon as={Sparkles} size={18} className="aichat-empty-icon" />
            </span>
            <p>{t('assistant.empty_state')}</p>
          </div>
        ) : (
          messages.map((m) => {
            const draft = extractDraft(m);
            return (
              <div key={m.id} className={`aichat-row aichat-row--${m.role}`}>
                <div className={`aichat-bubble aichat-bubble--${m.role}`}>
                  <div className="aichat-bubble-content">
                    {renderLightMarkdown(m.content)}
                  </div>

                  {/* SPRINT 11 — cartes d'action proposée (confirmation HUMAINE).
                      Le LLM PROPOSE ; rien n'est exécuté sans clic « Exécuter ». */}
                  {m.role === 'assistant' && Array.isArray(m.proposed_actions) && m.proposed_actions.length > 0 && (
                    <div className="aichat-actions">
                      {m.proposed_actions
                        .filter((a) => !dismissedActions[a.id])
                        .map((action) => {
                          const st = actionStates[action.id];
                          const isExecuting = st?.status === 'executing';
                          const isExecuted = st?.status === 'executed';
                          const isFailed = st?.status === 'failed';
                          // Désactivé pendant l'exécution et après succès (pas de double-clic).
                          const disabled = isExecuting || isExecuted;
                          return (
                            <div
                              key={action.id}
                              className={`aichat-action-card${isExecuted ? ' is-executed' : ''}${isFailed ? ' is-failed' : ''}`}
                            >
                              <div className="aichat-action-head">
                                <Icon as={Zap} size={13} className="aichat-action-icon" />
                                <span className="aichat-action-title">{t(actionTitleKey(action.tool))}</span>
                              </div>
                              <p className="aichat-action-label">{action.label}</p>

                              {isExecuted ? (
                                <div className="aichat-action-result aichat-action-result--ok" role="status">
                                  <Icon as={Check} size={12} />
                                  <span>{st.result || t('assistant.action.executed')}</span>
                                </div>
                              ) : isFailed ? (
                                <>
                                  <div className="aichat-action-result aichat-action-result--err" role="alert">
                                    <Icon as={AlertTriangle} size={12} />
                                    <span>{st.result || t('assistant.action.failed')}</span>
                                  </div>
                                  <div className="aichat-action-buttons">
                                    <button
                                      type="button"
                                      className="aichat-action-btn aichat-action-btn--primary"
                                      onClick={() => void handleConfirmAction(action)}
                                    >
                                      <Icon as={RotateCw} size={12} />
                                      {t('assistant.action.confirm')}
                                    </button>
                                    <button
                                      type="button"
                                      className="aichat-action-btn"
                                      onClick={() => handleDismissAction(action.id)}
                                    >
                                      <Icon as={XIcon} size={12} />
                                      {t('assistant.action.cancel')}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="aichat-action-buttons">
                                  <button
                                    type="button"
                                    className="aichat-action-btn aichat-action-btn--primary"
                                    disabled={disabled}
                                    onClick={() => void handleConfirmAction(action)}
                                  >
                                    {isExecuting ? (
                                      <span>{t('assistant.action.executing')}</span>
                                    ) : (
                                      <>
                                        <Icon as={Zap} size={12} />
                                        {t('assistant.action.confirm')}
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="aichat-action-btn"
                                    disabled={isExecuting}
                                    onClick={() => handleDismissAction(action.id)}
                                  >
                                    <Icon as={XIcon} size={12} />
                                    {t('assistant.action.cancel')}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* DRAFT-ONLY : brouillon en lecture + actions confirmées */}
                  {draft && (
                    <div className="aichat-draft">
                      <div className="aichat-draft-head">
                        <Icon as={FileText} size={13} />
                        <span>{draft.kind === 'workflow' ? t('assistant.create_workflow_cta') : t('assistant.draft_action')}</span>
                      </div>
                      <pre className="aichat-draft-raw">{draft.raw}</pre>
                      <div className="aichat-draft-actions">
                        <button
                          type="button"
                          className="aichat-draft-btn"
                          onClick={() => copyDraft(m.id, draft.raw)}
                        >
                          <Icon as={copiedId === m.id ? Check : Copy} size={12} />
                          {copiedId === m.id ? t('assistant.copied') : t('assistant.copy')}
                        </button>
                        {draft.kind === 'workflow' && (
                          <button
                            type="button"
                            className="aichat-draft-btn aichat-draft-btn--primary"
                            onClick={() => void handleCreateWorkflow(draft.raw)}
                          >
                            <Icon as={Sparkles} size={12} />
                            {t('assistant.create_workflow_cta')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Indicateur "thinking" pendant l'attente de la réponse */}
        {sending && (
          <div className="aichat-row aichat-row--assistant">
            <div className="aichat-bubble aichat-bubble--assistant aichat-bubble--thinking">
              <AiLoadingShimmer text={t('assistant.thinking')} size="sm" />
            </div>
          </div>
        )}
      </div>

      {/* Bloc erreur + retry */}
      {error && (
        <div className="aichat-error" role="alert">
          <span>{error}</span>
          {lastFailed && (
            <button type="button" className="aichat-retry-btn" onClick={handleRetry}>
              <Icon as={RotateCw} size={12} />
              {t('assistant.retry')}
            </button>
          )}
        </div>
      )}

      {/* Input */}
      <form className="aichat-input-bar" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="aichat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('assistant.placeholder')}
          rows={1}
          aria-label={t('assistant.placeholder')}
        />
        <button
          type="submit"
          className="aichat-send-btn"
          disabled={!input.trim() || sending}
          aria-label={t('assistant.send')}
          title={t('assistant.send')}
        >
          <Icon as={Send} size={15} />
        </button>
      </form>
    </div>
  );
}
