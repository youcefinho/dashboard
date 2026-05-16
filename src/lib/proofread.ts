// ── proofread — Sprint 49 M1.3 — Relecture FR québécois ─────────────────────
// Suggestions orthographe / grammaire / accord / anglicisme (NON-intrusif).
//
// API publique :
//   - proofreadText(text, locale, signal?): Promise<ProofreadIssue[]>
//   - localProofreadFallback(text): ProofreadIssue[]   (dico anglicismes QC)
//
// ⚠️ Jamais d'auto-correct. Toutes les suggestions sont optionnelles.
// Spécial QC : "céduler"/"canceller" SIGNALÉS mais marqués optionnels
// (usage québécois accepté — c'est une suggestion, pas une faute).

export type ProofreadIssueType =
  | 'orthographe'
  | 'grammaire'
  | 'accord'
  | 'anglicisme';

export interface ProofreadIssue {
  /** Index de départ (inclusif) dans le texte source. */
  start: number;
  /** Index de fin (exclusif). */
  end: number;
  type: ProofreadIssueType;
  /** Remplacement proposé. */
  suggestion: string;
  /** Message court FR expliquant la suggestion. */
  message: string;
  /**
   * Si true : usage accepté au QC, suggestion purement optionnelle.
   * L'UI peut styler ces issues plus discrètement.
   */
  optional?: boolean;
}

// ── Dico local anglicismes courants QC (~50) ────────────────────────────────
// `optional: true` pour les anglicismes tolérés à l'oral/informel au Québec.

interface AnglicismEntry {
  /** Mot/forme fautive (lemme, matché word-boundary insensible casse). */
  word: string;
  suggestion: string;
  message: string;
  optional?: boolean;
}

const QC_ANGLICISMS: AnglicismEntry[] = [
  { word: 'céduler', suggestion: 'planifier', message: 'Anglicisme (« schedule ») — usage QC accepté.', optional: true },
  { word: 'cédulé', suggestion: 'planifié', message: 'Anglicisme — usage QC accepté.', optional: true },
  { word: 'canceller', suggestion: 'annuler', message: 'Anglicisme (« cancel ») — usage QC accepté.', optional: true },
  { word: 'cancellé', suggestion: 'annulé', message: 'Anglicisme — usage QC accepté.', optional: true },
  { word: 'booker', suggestion: 'réserver', message: 'Anglicisme (« book ») — usage QC accepté.', optional: true },
  { word: 'bookée', suggestion: 'réservée', message: 'Anglicisme — usage QC accepté.', optional: true },
  { word: 'caller', suggestion: 'appeler', message: 'Anglicisme (« call ») — usage QC accepté.', optional: true },
  { word: 'checker', suggestion: 'vérifier', message: 'Anglicisme (« check ») — usage QC accepté.', optional: true },
  { word: 'matcher', suggestion: 'correspondre', message: 'Anglicisme (« match »).', optional: true },
  { word: 'updater', suggestion: 'mettre à jour', message: 'Anglicisme (« update »).' },
  { word: 'feedback', suggestion: 'retour', message: 'Anglicisme — préférez « retour » ou « commentaires ».' },
  { word: 'meeting', suggestion: 'réunion', message: 'Anglicisme — préférez « réunion ».' },
  { word: 'deadline', suggestion: 'échéance', message: 'Anglicisme — préférez « échéance ».' },
  { word: 'asap', suggestion: 'au plus vite', message: 'Abréviation anglaise — préférez « au plus vite ».' },
  { word: 'cheap', suggestion: 'bon marché', message: 'Anglicisme.' },
  { word: 'fancy', suggestion: 'chic', message: 'Anglicisme.' },
  { word: 'briefer', suggestion: 'informer', message: 'Anglicisme (« brief »).' },
  { word: 'forwarder', suggestion: 'transférer', message: 'Anglicisme (« forward »).' },
  { word: 'spotter', suggestion: 'repérer', message: 'Anglicisme (« spot »).' },
  { word: 'pitcher', suggestion: 'présenter', message: 'Anglicisme (« pitch »).' },
  { word: 'closer', suggestion: 'conclure', message: 'Anglicisme (« close ») — vente.' },
  { word: 'follow-up', suggestion: 'relance', message: 'Anglicisme — préférez « relance » ou « suivi ».' },
  { word: 'followup', suggestion: 'relance', message: 'Anglicisme — préférez « relance » ou « suivi ».' },
  { word: 'patcher', suggestion: 'corriger', message: 'Anglicisme (« patch »).' },
  { word: 'staff', suggestion: 'personnel', message: 'Anglicisme — préférez « personnel » ou « équipe ».' },
  { word: 'manager', suggestion: 'gestionnaire', message: 'Anglicisme — préférez « gestionnaire ».' },
  { word: 'timing', suggestion: 'moment', message: 'Anglicisme.' },
  { word: 'kick-off', suggestion: 'lancement', message: 'Anglicisme — préférez « lancement ».' },
  { word: 'overall', suggestion: 'globalement', message: 'Anglicisme.' },
  { word: 'anyway', suggestion: 'de toute façon', message: 'Anglicisme.' },
  { word: 'fitter', suggestion: 'ajuster', message: 'Anglicisme (« fit »).', optional: true },
  { word: 'flusher', suggestion: 'abandonner', message: 'Anglicisme (« flush »).', optional: true },
  { word: 'toaster', suggestion: 'griller', message: 'Anglicisme.', optional: true },
  { word: 'breakage', suggestion: 'bris', message: 'Anglicisme.' },
  { word: 'opportunité', suggestion: 'occasion', message: 'Souvent un calque de « opportunity » — « occasion » est plus juste.', optional: true },
  { word: 'définitivement', suggestion: 'assurément', message: 'Calque de « definitely » dans ce sens.', optional: true },
  { word: 'éventuellement', suggestion: 'finalement', message: 'Calque de « eventually » si sens « au final ».', optional: true },
  { word: 'application', suggestion: 'candidature', message: 'Calque de « application » si sens « postuler ».', optional: true },
  { word: 'compléter', suggestion: 'remplir', message: 'Calque de « complete » si sens « remplir un formulaire ».', optional: true },
  { word: 'item', suggestion: 'article', message: 'Anglicisme — préférez « article » ou « élément ».' },
  { word: 'package', suggestion: 'forfait', message: 'Anglicisme — préférez « forfait » ou « ensemble ».' },
  { word: 'deal', suggestion: 'entente', message: 'Anglicisme — préférez « entente ».' },
  { word: 'lead', suggestion: 'prospect', message: 'Anglicisme — « prospect » (toléré en CRM).', optional: true },
  { word: 'pitch', suggestion: 'présentation', message: 'Anglicisme.' },
  { word: 'scope', suggestion: 'portée', message: 'Anglicisme.' },
  { word: 'feedbacks', suggestion: 'retours', message: 'Anglicisme — préférez « retours ».' },
  { word: 'overbooké', suggestion: 'surchargé', message: 'Anglicisme.', optional: true },
  { word: 'rusher', suggestion: 'précipiter', message: 'Anglicisme (« rush »).', optional: true },
  { word: 'switcher', suggestion: 'changer', message: 'Anglicisme (« switch »).', optional: true },
  { word: 'plugger', suggestion: 'brancher', message: 'Anglicisme (« plug »).', optional: true },
];

// ── Petites règles ortho/grammaire/accord déterministes & sûres ─────────────
// Volontairement conservateur : seulement des cas non ambigus.

interface RegexRule {
  re: RegExp;
  type: ProofreadIssueType;
  build: (m: RegExpExecArray) => { suggestion: string; message: string };
}

const REGEX_RULES: RegexRule[] = [
  {
    // " sa va" → "ça va"
    re: /\bsa va\b/gi,
    type: 'orthographe',
    build: () => ({ suggestion: 'ça va', message: '« ça va » (pronom « ça »).' }),
  },
  {
    // "malgré que" → "bien que"
    re: /\bmalgré que\b/gi,
    type: 'grammaire',
    build: () => ({ suggestion: 'bien que', message: '« malgré que » est critiqué — préférez « bien que ».' }),
  },
  {
    // "au niveau de" (tic de langage) → "concernant"
    re: /\bau niveau d[eu]\b/gi,
    type: 'grammaire',
    build: () => ({ suggestion: 'concernant', message: 'Tic de langage — « concernant » est plus clair.' }),
  },
  {
    // double espace
    re: /\S(  +)\S/g,
    type: 'orthographe',
    build: () => ({ suggestion: ' ', message: 'Espace double.' }),
  },
  {
    // "a" verbe au lieu de "à" prép : "je vais a" / "jusqu a"
    re: /\b(vais|aller|jusqu['’]?|grâce|face|quant) a\b/gi,
    type: 'grammaire',
    build: (m) => ({ suggestion: `${m[1]} à`, message: '« à » (préposition) prend un accent.' }),
  },
];

/**
 * Relecture heuristique locale instant — anglicismes QC + règles sûres.
 * Zéro réseau. Utilisé en fallback si l'API proofread est KO.
 */
export function localProofreadFallback(text: string): ProofreadIssue[] {
  const src = text || '';
  if (!src.trim()) return [];
  const issues: ProofreadIssue[] = [];

  // Anglicismes (word-boundary insensible casse, gère accents simples)
  for (const entry of QC_ANGLICISMS) {
    const esc = entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}])(${esc})(?=$|[^\\p{L}])`, 'giu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const matchStart = m.index + m[1].length;
      issues.push({
        start: matchStart,
        end: matchStart + m[2].length,
        type: 'anglicisme',
        suggestion: entry.suggestion,
        message: entry.message,
        optional: entry.optional ?? false,
      });
      if (m.index === re.lastIndex) re.lastIndex += 1; // anti-loop zero-width
    }
  }

  // Règles regex ortho/grammaire
  for (const rule of REGEX_RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(src)) !== null) {
      const built = rule.build(m);
      issues.push({
        start: m.index,
        end: m.index + m[0].length,
        type: rule.type,
        suggestion: built.suggestion,
        message: built.message,
        optional: false,
      });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex += 1;
    }
  }

  // Tri par position + dédup chevauchements (garde le premier)
  issues.sort((a, b) => a.start - b.start);
  const deduped: ProofreadIssue[] = [];
  let lastEnd = -1;
  for (const i of issues) {
    if (i.start >= lastEnd) {
      deduped.push(i);
      lastEnd = i.end;
    }
  }
  return deduped;
}

// ── Backend fetch ───────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('intralys_token');
  } catch {
    return null;
  }
}

/**
 * Relecture via backend Claude (proofreading FR québécois).
 * Retombe sur localProofreadFallback() si offline / API KO / abort.
 */
export async function proofreadText(
  text: string,
  locale = 'fr-CA',
  signal?: AbortSignal,
): Promise<ProofreadIssue[]> {
  const src = (text || '').trim();
  if (!src || src.split(/\s+/).filter(Boolean).length < 3) return [];

  if (typeof fetch === 'undefined') return localProofreadFallback(text);

  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch('/api/ai/proofread', {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ text, locale }),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { issues?: ProofreadIssue[] } };
      const issues = json.data?.issues;
      if (Array.isArray(issues)) {
        // Validation défensive des bornes
        return issues
          .filter(
            (i) =>
              typeof i.start === 'number' &&
              typeof i.end === 'number' &&
              i.start >= 0 &&
              i.end > i.start &&
              i.end <= text.length &&
              typeof i.suggestion === 'string',
          )
          .map((i) => ({
            ...i,
            type: (['orthographe', 'grammaire', 'accord', 'anglicisme'].includes(
              i.type,
            )
              ? i.type
              : 'orthographe') as ProofreadIssueType,
            optional: Boolean(i.optional),
          }));
      }
    }
  } catch {
    /* abort / réseau KO → fallback */
  }
  return localProofreadFallback(text);
}
