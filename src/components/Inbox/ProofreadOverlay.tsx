// ── ProofreadOverlay — Sprint 49 M1.3 ───────────────────────────────────────
// Souligne en ondulé subtil les segments suspects par-dessus le textarea
// (technique "mirror div" : un calque non-interactif aligné sur le textarea
// reproduit le texte avec des <mark> aux positions des issues).
//
// Non-intrusif : aucune auto-correction. Click sur un segment → popover
// suggestion (Appliquer / Ignorer). Tout est optionnel.
//
// A11y : overlay aria-hidden (le textarea reste la source). Le compteur
// d'issues est annoncé via aria-live polite côté MessageComposer.

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { ProofreadIssue } from '@/lib/proofread';

interface Props {
  /** Texte courant du textarea (source de vérité). */
  text: string;
  /** Issues détectées (déjà bornées/validées par lib/proofread). */
  issues: ProofreadIssue[];
  /** Ref du textarea cible (pour copier métriques de scroll/typo). */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Applique une suggestion : remplace [start,end) par suggestion. */
  onApply: (issue: ProofreadIssue) => void;
  /** Ignore une issue (dismiss local, jamais ré-affichée pour ce texte). */
  onDismiss: (issue: ProofreadIssue) => void;
}

const TYPE_LABEL: Record<ProofreadIssue['type'], string> = {
  orthographe: 'Orthographe',
  grammaire: 'Grammaire',
  accord: 'Accord',
  anglicisme: 'Anglicisme',
};

export function ProofreadOverlay({
  text,
  issues,
  textareaRef,
  onApply,
  onDismiss,
}: Props) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Synchronise le scroll du calque avec celui du textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const onScroll = () => setScrollTop(ta.scrollTop);
    ta.addEventListener('scroll', onScroll, { passive: true });
    return () => ta.removeEventListener('scroll', onScroll);
  }, [textareaRef]);

  // Ferme le popover si le texte change (issues recalculées) ou Escape
  useEffect(() => {
    setActive(null);
  }, [text]);

  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  // Découpe le texte en segments (texte brut / marqué) selon les issues triées
  const segments = useMemo(() => {
    const sorted = [...issues].sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; issueIdx: number | null }> = [];
    let cursor = 0;
    sorted.forEach((iss) => {
      const realIdx = issues.indexOf(iss);
      if (iss.start > cursor) {
        out.push({ text: text.slice(cursor, iss.start), issueIdx: null });
      }
      out.push({ text: text.slice(iss.start, iss.end), issueIdx: realIdx });
      cursor = Math.max(cursor, iss.end);
    });
    if (cursor < text.length) {
      out.push({ text: text.slice(cursor), issueIdx: null });
    }
    return out;
  }, [text, issues]);

  const handleMarkClick = useCallback((idx: number) => {
    setActive((cur) => (cur === idx ? null : idx));
  }, []);

  if (issues.length === 0) return null;

  const activeIssue = active !== null ? issues[active] : null;

  return (
    <div className="proofread-overlay-wrap" aria-hidden="true">
      <div
        ref={mirrorRef}
        className="proofread-mirror"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {segments.map((seg, i) =>
          seg.issueIdx === null ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <mark
              key={i}
              className={`proofread-mark proofread-mark--${
                issues[seg.issueIdx]!.optional ? 'optional' : 'standard'
              }`}
              data-active={active === seg.issueIdx ? 'true' : 'false'}
              onClick={() => handleMarkClick(seg.issueIdx!)}
            >
              {seg.text}
            </mark>
          ),
        )}
        {/* trailing newline guard pour aligner la hauteur */}
        {text.endsWith('\n') && <span>{'​'}</span>}
      </div>

      {activeIssue && (
        <div
          className="proofread-popover"
          role="dialog"
          aria-label={`Suggestion ${TYPE_LABEL[activeIssue.type]}`}
        >
          <div className="proofread-popover-head">
            <span
              className={`proofread-tag proofread-tag--${
                activeIssue.optional ? 'optional' : 'standard'
              }`}
            >
              {TYPE_LABEL[activeIssue.type]}
              {activeIssue.optional && ' · optionnel'}
            </span>
          </div>
          <p className="proofread-popover-msg">{activeIssue.message}</p>
          <div className="proofread-popover-suggest">
            <span className="proofread-popover-from">
              {text.slice(activeIssue.start, activeIssue.end)}
            </span>
            <span className="proofread-popover-arrow" aria-hidden>
              →
            </span>
            <span className="proofread-popover-to">
              {activeIssue.suggestion}
            </span>
          </div>
          <div className="proofread-popover-actions">
            <button
              type="button"
              className="proofread-btn proofread-btn--apply"
              onClick={() => {
                onApply(activeIssue);
                setActive(null);
              }}
            >
              Appliquer
            </button>
            <button
              type="button"
              className="proofread-btn proofread-btn--ignore"
              onClick={() => {
                onDismiss(activeIssue);
                setActive(null);
              }}
            >
              Ignorer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
