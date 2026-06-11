import { useRef, useState, useMemo, useEffect } from 'react';
import { Button, AiSparkles, Textarea, Icon, AiLoadingShimmer } from '@/components/ui';
import { Send, FileText, Variable, AlertTriangle, Sparkles, Reply, X as XIcon, Clock, Bold, Italic, Link2, Smile } from 'lucide-react';
import type { MessageChannel, Snippet, EmailTemplate, Lead } from '@/lib/types';
import { CHANNEL_LABELS } from '@/lib/types';
import { interpolateTemplate } from '@/lib/api';
import {
  SNIPPET_VARS,
  filterVars,
  listTokens,
  resolveVars,
  type LeadCtx,
  type SnippetVarDescriptor,
  type SnippetVarKey,
} from '@/lib/snippetVars';
// Sprint 32 vague 32-2A — AI draft replies (3 heuristiques)
import { generateDrafts, generateDraftsAsync, DRAFT_TONE_LABELS, type DraftOption } from '@/lib/aiDrafts';
// Sprint 33 vague 33-2B — quick replies chips persistées par lead
import { getQuickReplies, recordReply } from '@/lib/quickReplies';
import { useHaptic } from '@/hooks/useHaptic';
import { useSound } from '@/hooks/useSound';
// Sprint 49 M1 — Smart compose : ghost text + tone + proofread + lang detect
import { suggestCompose } from '@/lib/aiCompose';
import { analyzeTone, toneLeadMismatch } from '@/lib/toneAnalyzer';
import { proofreadText, type ProofreadIssue } from '@/lib/proofread';
import { shouldSuggestLangSwitch } from '@/lib/langDetect';
import { ProofreadOverlay } from './ProofreadOverlay';
import { getLocale, t } from '@/lib/i18n';

interface Props {
  composerText: string;
  setComposerText: (t: string) => void;
  handleSend: (bodyOverride?: string, isNoteOverride?: boolean, scheduledAtOverride?: string) => void | Promise<void>;
  isSending: boolean;
  channel: MessageChannel;
  snippets?: Snippet[];
  templates?: EmailTemplate[];
  leadId?: string;
  conversationId?: string;
  /** Sprint 30 vague 30-2A — contexte lead pour résolution `{{var}}` runtime */
  lead?: Pick<Lead, 'name' | 'email' | 'phone' | 'deal_value' | 'client_name' | 'score'> | null;
  /** Sprint 30 vague 30-2A — nom étape pipeline pour `{{stage}}` */
  stageName?: string | null;
  /** Sprint 32 vague 32-2A — dernier message inbound pour générer les drafts AI */
  lastInboundMessage?: string | null;
  /**
   * Sprint 44 M3.1 — Réponse à un message spécifique (swipe-to-reply).
   * Affiche un header "Réponse à [name]" + preview du message original au-dessus du textarea.
   * Le composer autofocus quand replyTo passe de null → defined.
   */
  replyTo?: {
    name: string;
    preview: string;
  } | null;
  /** Sprint 44 M3.1 — Cancel reply mode (clear replyTo state côté parent). */
  onCancelReply?: () => void;
}

type SlashMode = 'snippet' | 'var' | null;

const VAR_PREFIX = 'var';

export function MessageComposer({
  composerText,
  setComposerText,
  handleSend,
  isSending,
  channel,
  snippets = [],
  templates = [],
  leadId,
  conversationId,
  lead = null,
  stageName = null,
  lastInboundMessage = null,
  replyTo = null,
  onCancelReply,
}: Props) {
  const [slashMode, setSlashMode] = useState<SlashMode>(null);
  const [slashQuery, setSlashQuery] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [showSchedulePopover, setShowSchedulePopover] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  // Sprint 32 vague 32-2A — popover drafts AI
  const [showDrafts, setShowDrafts] = useState(false);
  // Sprint 34 vague 34-3A — stub loading state pour préfigurer l'appel Claude Haiku
  // (actuellement drafts heuristiques sont sync, mais on simule ~350ms pour donner
  // le feedback visuel "AI réfléchit..." cohérent avec le wire futur backend).
  const [draftsLoading, setDraftsLoading] = useState(false);
  // Sprint 33 vague 33-2B — quick replies persistées par lead (max 3, FIFO)
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  // Sprint 74 — Copilote Commercial : Suggestions de Réponses IA
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftPopoverRef = useRef<HTMLDivElement>(null);
  const draftTriggerRef = useRef<HTMLButtonElement>(null);
  const { vibrate } = useHaptic();
  const { play } = useSound();

  // ── Sprint 49 M1.1 — Ghost text (Gmail Smart Compose) ──────────────────
  const [ghost, setGhost] = useState('');
  const ghostAbortRef = useRef<AbortController | null>(null);
  const ghostTimerRef = useRef<number | null>(null);
  const locale = useMemo(() => getLocale(), []);

  // ── Sprint 49 M1.3 — Proofread issues + dismissed set ──────────────────
  const [proofIssues, setProofIssues] = useState<ProofreadIssue[]>([]);
  const proofAbortRef = useRef<AbortController | null>(null);
  const proofTimerRef = useRef<number | null>(null);
  const dismissedProofRef = useRef<Set<string>>(new Set());

  // ── Sprint 49 M1.2/M1.4 — dismiss flags pour suggestions subtiles ──────
  const [toneHintDismissed, setToneHintDismissed] = useState(false);
  const [langHintDismissed, setLangHintDismissed] = useState(false);

  // Drafts générés à la volée — heuristiques sur dernier message inbound + lead ctx
  const localDrafts: DraftOption[] = useMemo(
    () =>
      generateDrafts(lastInboundMessage || '', {
        name: lead?.name ?? null,
        stage: stageName,
      }),
    [lastInboundMessage, lead?.name, stageName],
  );
  // Sprint 49 M1.4 — override async (backend Claude Haiku, targetLang multi-lingue)
  const [asyncDrafts, setAsyncDrafts] = useState<DraftOption[] | null>(null);
  const drafts = asyncDrafts ?? localDrafts;

  // Sprint 33 vague 33-2B — Charge quick replies au mount + sur changement de lead
  useEffect(() => {
    // Sprint 49 M1 — reset suggestions subtiles + cache dismiss au switch lead
    setToneHintDismissed(false);
    setLangHintDismissed(false);
    dismissedProofRef.current = new Set();
    setProofIssues([]);
    setGhost('');
    if (!leadId) {
      setQuickReplies([]);
      return;
    }
    setQuickReplies(getQuickReplies(leadId));
  }, [leadId]);

  // Sprint 74 — Copilote Commercial : Suggestions de Réponses IA
  useEffect(() => {
    setSuggestedReplies([]);
    if (!conversationId) return;

    setLoadingSuggestions(true);
    const controller = new AbortController();

    fetch('/api/ai/suggest-replies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversation_id: conversationId }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error('Erreur API');
        return res.json() as Promise<{ data: { suggestions: string[] } }>;
      })
      .then((res) => {
        if (res.data?.suggestions) {
          setSuggestedReplies(res.data.suggestions);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Erreur suggestions:', err);
        }
      })
      .finally(() => {
        setLoadingSuggestions(false);
      });

    return () => {
      controller.abort();
    };
  }, [conversationId]);

  // Sprint 44 M3.1 — Autofocus le textarea quand un reply mode s'active
  // (l'utilisateur a swipe sur un message → on attend qu'il puisse taper direct)
  useEffect(() => {
    if (replyTo) {
      requestAnimationFrame(() => {
        const ta = inputRef.current;
        if (ta) {
          ta.focus();
          const end = ta.value.length;
          ta.setSelectionRange(end, end);
        }
      });
    }
  }, [replyTo]);

  // Insert un quick reply dans le textarea (replace strategy : remplace le
  // contenu courant pour un workflow rapide "1-click reply"). Focus + curseur
  // en fin pour permettre édition immédiate.
  const applyQuickReply = (text: string) => {
    setComposerText(text);
    vibrate('light');
    play('toggle');
    requestAnimationFrame(() => {
      const ta = inputRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
      }
    });
  };

  // Sprint 34 vague 34-3A + Sprint 49 M1.4 — au open du popover, fetch backend
  // Claude Haiku (generateDraftsAsync). targetLang = langue détectée du message
  // inbound si ≠ français (multi-lingue reply). Fallback heuristique local
  // automatique côté lib si l'API est KO (offline-safe, pattern Sprint 43).
  useEffect(() => {
    if (!showDrafts) {
      setDraftsLoading(false);
      setAsyncDrafts(null);
      return;
    }
    let cancelled = false;
    setDraftsLoading(true);
    const detected = shouldSuggestLangSwitch(lastInboundMessage || '', composerText);
    void generateDraftsAsync(lastInboundMessage || '', {
      id: leadId ?? null,
      name: lead?.name ?? null,
      stage: stageName,
      targetLang: detected?.targetLocale,
    }).then((res) => {
      if (cancelled) return;
      setAsyncDrafts(res);
      setDraftsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // composerText volontairement hors deps : on fige la langue à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDrafts, lastInboundMessage, leadId, lead?.name, stageName]);

  // Click-outside + Escape pour fermer le popover drafts
  useEffect(() => {
    if (!showDrafts) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        draftPopoverRef.current?.contains(t) ||
        draftTriggerRef.current?.contains(t)
      ) {
        return;
      }
      setShowDrafts(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDrafts(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showDrafts]);

  const applyDraft = (draft: DraftOption) => {
    setComposerText(draft.body);
    setShowDrafts(false);
    vibrate('light');
    play('toggle');
    // Refocus textarea avec curseur en fin
    requestAnimationFrame(() => {
      const ta = inputRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(draft.body.length, draft.body.length);
      }
    });
  };

  const leadCtx: LeadCtx = useMemo(() => ({ lead, stageName }), [lead, stageName]);

  // ── Sprint 49 M1.2 — Tone analyzer (sync, instant) ─────────────────────
  const tone = useMemo(() => analyzeTone(composerText), [composerText]);
  const toneMismatch = useMemo(
    () =>
      toneHintDismissed
        ? null
        : toneLeadMismatch(tone.tone, stageName),
    [tone.tone, stageName, toneHintDismissed],
  );

  // ── Sprint 49 M1.4 — Multi-language detect (sync, instant) ─────────────
  const langSwitch = useMemo(
    () =>
      langHintDismissed
        ? null
        : shouldSuggestLangSwitch(lastInboundMessage || '', composerText),
    [lastInboundMessage, composerText, langHintDismissed],
  );

  // ── Sprint 49 M1.1 — Ghost text : debounce 600ms après arrêt frappe ────
  // Conditions strictes : ≥3 mots, pas de slash-actif, pas en envoi.
  useEffect(() => {
    setGhost('');
    if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current);
    ghostAbortRef.current?.abort();

    const wordCount = composerText.trim().split(/\s+/).filter(Boolean).length;
    if (slashMode !== null || isSending || wordCount < 3) return;
    // Pas de ghost si le curseur n'est pas en fin de texte (édition au milieu)
    const ta = inputRef.current;
    if (ta && ta.selectionStart !== composerText.length) return;

    ghostTimerRef.current = window.setTimeout(() => {
      const ctrl = new AbortController();
      ghostAbortRef.current = ctrl;
      void suggestCompose({
        currentDraft: composerText,
        conversationContext: lastInboundMessage || '',
        locale,
        signal: ctrl.signal,
      }).then((s) => {
        if (!ctrl.signal.aborted) setGhost(s || '');
      });
    }, 600);

    return () => {
      if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current);
      ghostAbortRef.current?.abort();
    };
  }, [composerText, slashMode, isSending, lastInboundMessage, locale]);

  // ── Sprint 49 M1.3 — Proofread : debounce 1.5s après arrêt frappe ──────
  useEffect(() => {
    if (proofTimerRef.current) window.clearTimeout(proofTimerRef.current);
    proofAbortRef.current?.abort();

    const wordCount = composerText.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 3) {
      setProofIssues([]);
      return;
    }

    proofTimerRef.current = window.setTimeout(() => {
      const ctrl = new AbortController();
      proofAbortRef.current = ctrl;
      void proofreadText(composerText, locale, ctrl.signal).then((issues) => {
        if (ctrl.signal.aborted) return;
        // Filtre les issues dismissées (clé = texte segment + suggestion)
        const filtered = issues.filter(
          (i) =>
            !dismissedProofRef.current.has(
              `${composerText.slice(i.start, i.end)}»${i.suggestion}`,
            ),
        );
        setProofIssues(filtered);
      });
    }, 1500);

    return () => {
      if (proofTimerRef.current) window.clearTimeout(proofTimerRef.current);
      proofAbortRef.current?.abort();
    };
  }, [composerText, locale]);

  // ── Sprint 49 M1.1 — Accepte le ghost text (Tab) ───────────────────────
  const acceptGhost = () => {
    if (!ghost) return;
    const next = composerText + ghost;
    setGhost('');
    setComposerText(next);
    vibrate('light');
    requestAnimationFrame(() => {
      const ta = inputRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(next.length, next.length);
      }
    });
  };

  // ── Sprint 49 M1.3 — Applique / ignore une suggestion proofread ────────
  const applyProofIssue = (issue: ProofreadIssue) => {
    const next =
      composerText.slice(0, issue.start) +
      issue.suggestion +
      composerText.slice(issue.end);
    setComposerText(next);
    setProofIssues((prev) => prev.filter((i) => i !== issue));
    vibrate('light');
    play('toggle');
  };

  const dismissProofIssue = (issue: ProofreadIssue) => {
    dismissedProofRef.current.add(
      `${composerText.slice(issue.start, issue.end)}»${issue.suggestion}`,
    );
    setProofIssues((prev) => prev.filter((i) => i !== issue));
  };

  // ── Sprint 49 M1.4 — Bascule un brouillon AI dans la langue détectée ───
  // Ouvre le popover drafts (generateDraftsAsync utilise déjà /api/ai/drafts ;
  // la langue détectée est passée comme targetLang via le contexte conv).
  const applyLangSwitch = () => {
    if (!langSwitch) return;
    setShowDrafts(true);
    setLangHintDismissed(true);
    vibrate('light');
  };

  // Détecter "/" pour ouvrir le menu : `/<query>` → snippets, `/var <query>` → variables
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComposerText(val);

    // Cherche le dernier segment slash dans le buffer (peut être multi-mot ex: "/var na")
    // On regarde les 30 derniers caractères, on récupère le dernier "/..." sans newline.
    const tail = val.slice(-40);
    const match = tail.match(/\/([a-z_]*)(?:\s+([a-z_]*))?$/i);
    if (!match) {
      setSlashMode(null);
      return;
    }
    const first = (match[1] ?? '').toLowerCase();
    const second = match[2];
    if (first === VAR_PREFIX && second !== undefined) {
      setSlashMode('var');
      setSlashQuery(second.toLowerCase());
    } else if (first === VAR_PREFIX) {
      // `/var` seul (sans espace) → propose snippets matching `var` (rare)
      setSlashMode('snippet');
      setSlashQuery(first);
    } else {
      setSlashMode('snippet');
      setSlashQuery(first);
    }
  };

  const filteredSnippets = useMemo(
    () =>
      snippets
        .filter(
          (s) =>
            s.shortcut.toLowerCase().includes(slashQuery) ||
            s.name.toLowerCase().includes(slashQuery),
        )
        .slice(0, 5),
    [snippets, slashQuery],
  );

  const filteredVars: SnippetVarDescriptor[] = useMemo(
    () => filterVars(slashQuery).slice(0, 8),
    [slashQuery],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMode === 'snippet') {
      if (e.key === 'Escape') {
        setSlashMode(null);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredSnippets.length > 0) {
          applySnippet(filteredSnippets[0]!);
        }
        return;
      }
    }
    if (slashMode === 'var') {
      if (e.key === 'Escape') {
        setSlashMode(null);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredVars.length > 0) {
          e.preventDefault();
          applyVar(filteredVars[0]!.key);
          return;
        }
      }
    }

    // Sprint 49 M1.1 — Ghost text : Tab accepte, Esc rejette.
    // Placé APRÈS la gestion slash (var Tab prioritaire) et AVANT le send.
    if (ghost && slashMode === null) {
      if (e.key === 'Tab') {
        e.preventDefault();
        acceptGhost();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setGhost('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSendResolved();
    }
  };

  const applySnippet = (snippet: Snippet) => {
    // Remplace le dernier "/xyz" par le body du snippet
    const newText = composerText.replace(/\/([a-z_]*)$/i, snippet.body);
    setComposerText(newText);
    setSlashMode(null);
    inputRef.current?.focus();
  };

  const applyVar = (key: SnippetVarKey) => {
    // Remplace `/var <q>` (avec ou sans query) par `{{key}} `
    const replaced = composerText.replace(/\/var(?:\s+[a-z_]*)?$/i, `{{${key}}} `);
    setComposerText(replaced);
    setSlashMode(null);
    inputRef.current?.focus();
  };

  const applyTemplate = async (template: EmailTemplate) => {
    if (!leadId) {
      setComposerText(template.body_text || template.body_html || '');
      setShowTemplates(false);
      return;
    }
    const res = await interpolateTemplate(template.body_text || template.body_html || '', leadId);
    if (res.data) {
      setComposerText(res.data.text);
    }
    setShowTemplates(false);
    inputRef.current?.focus();
  };

  // ── Vars présentes + missing live preview ──────────────────────────────
  const presentTokens = useMemo(() => listTokens(composerText), [composerText]);
  const previewResolve = useMemo(
    () => (presentTokens.length > 0 ? resolveVars(composerText, leadCtx) : null),
    [presentTokens.length, composerText, leadCtx],
  );
  const missingVars = previewResolve?.missing ?? [];

  // Envoi : résout les vars avant d'envoyer (override body)
  // Sprint 33 vague 33-2B — après envoi réussi, enregistre la réponse dans
  // les quick replies du lead (dedup + cap FIFO à 3) et rafraîchit les chips.
  const onSendResolved = async () => {
    const bodyToRecord = composerText.trim();
    try {
      if (presentTokens.length === 0) {
        await Promise.resolve(handleSend(undefined, isNoteMode, scheduledAt || undefined));
      } else {
        const { resolved } = resolveVars(composerText, leadCtx);
        await Promise.resolve(handleSend(resolved, isNoteMode, scheduledAt || undefined));
      }
      if (leadId && bodyToRecord && !isNoteMode && !scheduledAt) {
        recordReply(leadId, bodyToRecord);
        setQuickReplies(getQuickReplies(leadId));
      }
      setScheduledAt(null);
      setScheduleDate('');
      setScheduleTime('');
      setShowSchedulePopover(false);
    } catch {
      // Erreur d'envoi : ne pas enregistrer le quick reply.
    }
  };

  const placeholder = isNoteMode
    ? "Saisir une note interne visible uniquement par l'équipe (tapez /var pour variables)..."
    : `Répondre via ${CHANNEL_LABELS[channel] || channel} (tapez / pour modèles, /var pour variables)...`;
  const channelTemplates = templates.filter((t) => t.channel === channel);

  // ── Premium picker style (réutilisé pour snippets + templates + vars) ──
  const pickerWrapStyle: React.CSSProperties = {
    background: 'var(--bg-surface, #fff)',
    backdropFilter: 'blur(12px) saturate(140%)',
    WebkitBackdropFilter: 'blur(12px) saturate(140%)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-md, 0 8px 32px -8px rgba(0,0,0,0.12))',
  };

  const pickerHeaderStyle: React.CSSProperties = {
    background: 'var(--bg-subtle, #F6F8FA)',
    borderBottom: '1px solid var(--border)',
    letterSpacing: '0.12em',
  };

  return (
    <div className="composer-glass-s9 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 relative">
      {/* Sélecteur de canal / mode Note interne */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-2 mb-2 text-xs">
        <button
          type="button"
          onClick={() => setIsNoteMode(false)}
          className={`px-3 py-1 rounded-md font-medium transition-all ${
            !isNoteMode
              ? 'bg-[var(--primary-subtle)] text-[var(--primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          {t('inbox.mode_client_message', { channel: CHANNEL_LABELS[channel] || channel })}
        </button>
        <button
          type="button"
          onClick={() => setIsNoteMode(true)}
          className={`px-3 py-1 rounded-md font-medium transition-all ${
            isNoteMode
              ? 'bg-amber-100/70 text-amber-800 border border-amber-200/50 shadow-sm dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          {t('inbox.mode_internal_note')}
        </button>
      </div>

      {/* Date de planification du message */}
      {scheduledAt && (
        <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50 rounded-lg p-2 mb-2 text-xs text-purple-700 dark:text-purple-300">
          <div className="flex items-center gap-2">
            <Icon as={Clock} size="xs" />
            <span>
              {t('inbox.scheduled_for')}&nbsp;: {new Date(scheduledAt).toLocaleString(locale, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setScheduledAt(null)}
            className="text-purple-500 hover:text-purple-700 dark:hover:text-purple-200 font-semibold"
          >
            {t('action.cancel')}
          </button>
        </div>
      )}

      {/* ── Sprint 44 M3.1 — Reply header (swipe-to-reply target) ── */}
      {replyTo && (
        <div
          className="composer-reply-header"
          role="status"
          aria-label={`Réponse à ${replyTo.name}`}
        >
          <Icon as={Reply} size="xs" className="composer-reply-header__icon" />
          <div className="composer-reply-header__body">
            <span className="composer-reply-header__title">
              Réponse à <strong>{replyTo.name}</strong>
            </span>
            <span className="composer-reply-header__preview" title={replyTo.preview}>
              {replyTo.preview}
            </span>
          </div>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              className="composer-reply-header__close"
              aria-label="Annuler la réponse"
              title="Annuler la réponse"
            >
              <Icon as={XIcon} size={12} />
            </button>
          )}
        </div>
      )}

      {/* ── Snippet Popover — cmd-style premium ── */}
      {slashMode === 'snippet' && filteredSnippets.length > 0 && (
        <div
          className="absolute bottom-full mb-2 left-3 w-80 rounded-xl overflow-hidden z-10"
          style={pickerWrapStyle}
        >
          <div
            className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase flex items-center justify-between"
            style={pickerHeaderStyle}
          >
            <span>Réponses rapides</span>
            <span className="text-[9px] font-medium normal-case opacity-70 tracking-normal">
              Tapez <code className="font-mono">/var</code> pour insérer une variable
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filteredSnippets.map((s, i) => (
              <button
                key={s.id}
                onClick={() => applySnippet(s)}
                className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors list-item-enter ${
                  i === 0
                    ? 'bg-[var(--primary-soft)] border-l-2 border-[var(--primary)]'
                    : 'hover:bg-[var(--bg-hover)] border-l-2 border-transparent'
                }`}
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{s.name}</span>
                  {s.shortcut && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                        border: '1px solid rgba(99, 91, 255, 0.20)',
                      }}
                    >
                      /{s.shortcut}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-[var(--text-muted)] truncate">{s.body}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Variables Popover — Sprint 30 vague 30-2A ── */}
      {slashMode === 'var' && filteredVars.length > 0 && (
        <div
          className="absolute bottom-full mb-2 left-3 w-80 rounded-xl overflow-hidden z-10"
          style={pickerWrapStyle}
        >
          <div
            className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase flex items-center gap-2"
            style={pickerHeaderStyle}
          >
            <Variable size={12} />
            <span>Variables dynamiques</span>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredVars.map((v, i) => {
              const res = resolveVars(`{{${v.key}}}`, leadCtx);
              const hasValue = res.missing.length === 0;
              const preview = hasValue ? res.resolved : v.example;
              return (
                <button
                  key={v.key}
                  onClick={() => applyVar(v.key)}
                  className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors list-item-enter ${
                    i === 0
                      ? 'bg-[var(--primary-soft)] border-l-2 border-[var(--primary)]'
                      : 'hover:bg-[var(--bg-hover)] border-l-2 border-transparent'
                  }`}
                  style={{ animationDelay: `${i * 20}ms` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <code className="font-mono text-[10px] px-1 py-0.5 rounded composer-var-chip-inline">
                        {`{{${v.key}}}`}
                      </code>
                      {v.label}
                    </span>
                    <span
                      className={`text-[10px] font-medium truncate max-w-[120px] ${
                        hasValue ? 'text-[var(--primary)]' : 'text-[var(--text-muted)] italic'
                      }`}
                      title={preview}
                    >
                      {hasValue ? preview : `ex: ${v.example}`}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] truncate">{v.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Template Menu — cmd-style premium ── */}
      {showTemplates && (
        <div
          className="absolute bottom-full mb-2 left-3 w-64 rounded-xl overflow-hidden z-10"
          style={pickerWrapStyle}
        >
          <div
            className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase"
            style={pickerHeaderStyle}
          >
            Templates {CHANNEL_LABELS[channel] || channel}
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {channelTemplates.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center text-[var(--text-muted)]">
                Aucun template configuré pour ce canal.
              </div>
            ) : (
              channelTemplates.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => void applyTemplate(t)}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-primary)] truncate hover:bg-[var(--bg-hover)] transition-colors list-item-enter"
                  style={{ animationDelay: `${i * 20}ms` }}
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Sprint 49 M1.2/M1.4 — Tone chip + lang switch + hints subtils ── */}
      {(tone.tone !== 'neutre' || langSwitch || toneMismatch) && (
        <div className="sc-meta-row" role="status" aria-live="polite">
          {tone.tone !== 'neutre' && (
            <span
              className={`sc-tone-chip sc-tone-chip--${tone.tone}`}
              title="Ton détecté du brouillon"
            >
              Ton&nbsp;: {tone.label}
            </span>
          )}
          {langSwitch && (
            <button
              type="button"
              className="sc-lang-chip"
              onClick={applyLangSwitch}
              title={langSwitch.message}
            >
              <span className="sc-lang-chip-msg">{langSwitch.message}</span>
              <span className="sc-lang-chip-cta">{langSwitch.cta}</span>
            </button>
          )}
        </div>
      )}
      {toneMismatch && (
        <div className="sc-tone-hint" role="status">
          <span className="sc-tone-hint-text">{toneMismatch}</span>
          <button
            type="button"
            className="sc-tone-hint-close"
            onClick={() => setToneHintDismissed(true)}
            aria-label="Ignorer cette suggestion"
            title="Ignorer"
          >
            <Icon as={XIcon} size={11} />
          </button>
        </div>
      )}

      {/* ── Chips preview vars présentes (avec état resolved / missing) ── */}
      {presentTokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2" aria-label="Variables détectées dans le message">
          {presentTokens.map((k) => {
            const isMissing = missingVars.includes(k);
            const descriptor = SNIPPET_VARS.find((v) => v.key === k);
            return (
              <span
                key={k}
                className={`composer-var-chip ${isMissing ? 'composer-var-chip--missing' : 'composer-var-chip--resolved'}`}
                title={
                  isMissing
                    ? `Valeur manquante pour {{${k}}} — sera envoyée telle quelle`
                    : `${descriptor?.label ?? k} sera remplacé à l'envoi`
                }
              >
                {isMissing ? <AlertTriangle size={10} strokeWidth={2.5} /> : <Variable size={10} strokeWidth={2.5} />}
                <code className="font-mono">{`{{${k}}}`}</code>
              </span>
            );
          })}
        </div>
      )}

      {/* ── AI Drafts Popover — Sprint 32 vague 32-2A ── */}
      {showDrafts && (
        <div
          ref={draftPopoverRef}
          role="dialog"
          aria-label="Suggestions de réponses AI"
          className="ai-draft-popover absolute bottom-full mb-2 left-3 z-20"
        >
          <div className="ai-draft-popover-header">
            <span className="ai-draft-popover-title">
              <Sparkles size={11} strokeWidth={2.5} />
              Réponses suggérées
            </span>
            <span className="ai-draft-popover-hint">
              Heuristiques locales · prêt pour Claude Haiku
            </span>
          </div>
          <div className="ai-draft-popover-list">
            {draftsLoading ? (
              <div className="px-3 py-6 flex justify-center">
                <AiLoadingShimmer text="AI réfléchit..." />
              </div>
            ) : (
              drafts.map((draft, i) => (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => applyDraft(draft)}
                  className="ai-draft-option list-item-enter"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="ai-draft-option-head">
                    <span className="ai-draft-option-title">{draft.title}</span>
                    <span className={`ai-draft-chip ai-draft-chip--${draft.tone}`}>
                      {DRAFT_TONE_LABELS[draft.tone]}
                    </span>
                  </div>
                  <p className="ai-draft-option-preview">{draft.body}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Sprint 33 vague 33-2B — Quick replies chips per-lead ──
          Affichées seulement si ≥1 réponse historique sur ce lead. Scroll-x
          mobile + mask fade edges (CSS .quick-reply-row). Click → replace
          composer text + focus en fin. */}
      {quickReplies.length > 0 && (
        <div
          className="quick-reply-row mb-2"
          role="toolbar"
          aria-label="Réponses rapides récentes pour ce lead"
        >
          {quickReplies.map((text, i) => (
            <button
              key={`${text.slice(0, 12)}-${i}`}
              type="button"
              onClick={() => applyQuickReply(text)}
              className="quick-reply-chip"
              title={text}
              aria-label={`Insérer la réponse : ${text.slice(0, 80)}`}
            >
              <span className="quick-reply-chip-prefix" aria-hidden>↩</span>
              <span className="quick-reply-chip-text">{text}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sprint 74 — Copilote Commercial : Suggestions de Réponses IA */}
      {(loadingSuggestions || suggestedReplies.length > 0) && (
        <div className="flex flex-col gap-1 mb-2 px-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--primary)] uppercase tracking-wider">
            <Sparkles size={10} className={loadingSuggestions ? "animate-pulse" : ""} />
            <span>Copilote IA : Suggestions</span>
          </div>
          <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1 max-w-full">
            {loadingSuggestions ? (
              <>
                <div className="h-[28px] w-32 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200/50 dark:border-slate-700/50" />
                <div className="h-[28px] w-48 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200/50 dark:border-slate-700/50" />
                <div className="h-[28px] w-24 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse border border-slate-200/50 dark:border-slate-700/50" />
              </>
            ) : (
              suggestedReplies.map((reply, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setComposerText(reply);
                    vibrate('light');
                    play('toggle');
                    requestAnimationFrame(() => {
                      const ta = inputRef.current;
                      if (ta) {
                        ta.focus();
                        ta.setSelectionRange(reply.length, reply.length);
                      }
                    });
                  }}
                  className="px-3 py-1 text-xs rounded-full border border-[var(--primary-subtle)] bg-[var(--primary-subtle)] text-[var(--primary)] hover:bg-[var(--primary-hover)] hover:text-white transition-all cursor-pointer truncate max-w-[280px]"
                  title={reply}
                >
                  {reply}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5 h-full self-start mt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTemplates(!showTemplates)}
            className="h-[28px] px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Insérer un template"
          >
            <Icon as={FileText} size="md" />
          </Button>
          {/* Sprint 32 vague 32-2A — AI draft trigger */}
          <button
            ref={draftTriggerRef}
            type="button"
            onClick={() => {
              setShowDrafts((v) => !v);
              if (!showDrafts) vibrate('light');
            }}
            className="ai-draft-trigger"
            aria-haspopup="dialog"
            aria-expanded={showDrafts}
            aria-label="Suggérer une réponse AI"
            title="Suggérer une réponse (3 brouillons)"
          >
            <Sparkles size={12} strokeWidth={2.5} />
          </button>
        </div>
        <div className="flex-1 relative composer-wrap">
          {/* ── Sprint Deep 4A — Toolbar de formatage ── */}
          <div className="composer-toolbar">
            <button type="button" className="composer-toolbar-btn" title="Gras" aria-label="Mettre en gras">
              <Bold size={15} />
            </button>
            <button type="button" className="composer-toolbar-btn" title="Italique" aria-label="Mettre en italique">
              <Italic size={15} />
            </button>
            <button type="button" className="composer-toolbar-btn" title="Lien" aria-label="Insérer un lien">
              <Link2 size={15} />
            </button>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            <button type="button" className="composer-toolbar-btn" title="Emoji" aria-label="Insérer un emoji">
              <Smile size={15} />
            </button>
            <button type="button" className="composer-toolbar-btn" title="Brouillon IA" aria-label="Générer un brouillon IA">
              <Sparkles size={15} />
            </button>
          </div>
          <Textarea
            ref={inputRef}
            value={composerText}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            resize="none"
            maxLength={2000}
            showCounter
            className={`text-xs pr-10 min-h-[64px] transition-all ${
              isNoteMode
                ? 'bg-amber-50/40 border-amber-200 focus-within:border-amber-300 dark:bg-amber-950/10 dark:border-amber-900/50 text-amber-900 dark:text-amber-100'
                : 'text-[var(--text-primary)]'
            }`}
          />
          {/* ── Sprint Deep 4A — Barre de progression caractères ── */}
          <div className="char-count-bar">
            <div
              className={`char-count-bar-fill${composerText.length > 1800 ? ' is-danger' : composerText.length > 1400 ? ' is-warning' : ''}`}
              style={{ width: `${Math.min((composerText.length / 2000) * 100, 100)}%` }}
            />
          </div>
          {/* ── Sprint 49 M1.3 — Proofread underline overlay (non-intrusif) ── */}
          {proofIssues.length > 0 && (
            <ProofreadOverlay
              text={composerText}
              issues={proofIssues}
              textareaRef={inputRef}
              onApply={applyProofIssue}
              onDismiss={dismissProofIssue}
            />
          )}
          {/* ── Sprint 49 M1.1 — Ghost text overlay (Gmail Smart Compose) ── */}
          {ghost && slashMode === null && (
            <>
              <div className="sc-ghost-layer" aria-hidden="true">
                <span className="sc-ghost-typed">{composerText}</span>
                <span className="sc-ghost-suffix">{ghost}</span>
              </div>
              <span className="sc-ghost-hint" aria-hidden="true">
                <kbd>Tab</kbd> pour accepter
              </span>
              <span className="sr-only" role="status" aria-live="polite">
                Suggestion disponible : {ghost.trim()}. Appuyez sur Tab pour
                accepter.
              </span>
            </>
          )}
          {/* Sprint 41 M1.2 — hint chip slash-vars subtle (fade out au focus) */}
          {!composerText && slashMode === null && (
            <span className="composer-slash-hint" aria-hidden>
              Tapez <kbd className="composer-slash-hint-kbd">/</kbd> pour insérer une variable
            </span>
          )}
          <AiSparkles
            value={composerText}
            onChange={setComposerText}
            leadId={leadId}
            className="absolute bottom-2 right-2"
          />
        </div>
        <div className="flex flex-col gap-1.5 h-full self-end">
          <div className="flex items-center gap-1">
            {!isNoteMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSchedulePopover(!showSchedulePopover)}
                className={`h-[28px] px-2 ${
                  scheduledAt
                    ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/20'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title={t('inbox.schedule_send')}
              >
                <Icon as={Clock} size="sm" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => void onSendResolved()}
              isLoading={isSending}
              leftIcon={<Icon as={isNoteMode ? FileText : Send} size="sm" />}
              className={`h-[28px] ${
                isNoteMode
                  ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-700'
                  : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'
              }`}
            >
              {isNoteMode ? t('inbox.save_note') : t('action.send')}
            </Button>
          </div>
        </div>
      </div>

      {/* Popover de Planification */}
      {showSchedulePopover && (
        <div
          className="absolute bottom-full mb-2 right-3 w-64 rounded-xl overflow-hidden z-20 p-3 flex flex-col gap-2"
          style={pickerWrapStyle}
        >
          <div
            className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1"
          >
            {t('inbox.schedule_message')}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium text-[var(--text-secondary)]">
              {t('form.label.date')}
            </label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="text-xs p-1.5 border border-[var(--border-subtle)] rounded bg-[var(--bg-input)] text-[var(--text-primary)]"
              min={new Date().toISOString().split('T')[0]}
            />
            <label className="text-[10px] font-medium text-[var(--text-secondary)]">
              {t('form.label.time')}
            </label>
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="text-xs p-1.5 border border-[var(--border-subtle)] rounded bg-[var(--bg-input)] text-[var(--text-primary)]"
            />
            <div className="flex gap-2 mt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSchedulePopover(false)}
                className="flex-1 text-[10px]"
              >
                {t('action.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (scheduleDate && scheduleTime) {
                    const dt = new Date(`${scheduleDate}T${scheduleTime}`);
                    if (dt.getTime() > Date.now()) {
                      setScheduledAt(dt.toISOString());
                      setShowSchedulePopover(false);
                    } else {
                      alert(t('inbox.schedule_error_past'));
                    }
                  }
                }}
                className="flex-1 text-[10px]"
                disabled={!scheduleDate || !scheduleTime}
              >
                {t('action.apply')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
