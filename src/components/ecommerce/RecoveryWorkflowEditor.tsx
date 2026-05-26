// ── Boutique — Recovery Workflow Editor (séquence multi-touch) ──────────────
// Sprint 40 — Agent B4 (seq135). Editor visuel des 3 touches (steps 1/2/3)
// de la séquence de récupération des paniers abandonnés.
//
// ⚠️ La config technique des délais et discount % est FIGÉE en code via les
// constantes RECOVERY_DELAYS_MIN / RECOVERY_DISCOUNT_PCT (cf. src/lib/types.ts
// L2813-2829). Il n'existe PAS encore d'endpoint pour persister une override
// côté serveur — cet editor sert donc à :
//   1. Visualiser l'état courant de la config (délais + discount + canal +
//      templates email proposés) sans aller lire les constantes du code.
//   2. Composer / prévisualiser les templates email (sujet + corps) avec un
//      rendu propre + tokens dynamiques ({{discount_pct}}, {{coupon_code}}).
//   3. Préparer la surface UI quand un endpoint persistence sera ajouté
//      (Save = stub TODO + toast informatif pour l'instant).
//
// Layout : 3 cards côte à côte (1 par step) — sm:grid-cols-1, lg:grid-cols-3.
// Champs par card :
//   • Step number badge (1/2/3)
//   • Input delay_min (number, default RECOVERY_DELAYS_MIN[step])
//   • Input discount_pct (number 0-100, default RECOVERY_DISCOUNT_PCT[step])
//   • Select channel (email/sms)
//   • Textarea email_subject + email_body (templates per step)
//   • Preview email rendering (box stylée, pas iframe — pas de HTML user)
// Header avec boutons "Reset" + "Save" + résumé séquence (délais cumulés).
//
// Stripe-clean, FR-QC, a11y aria-labels i18n, reduced-motion safe.
// Imports RELATIFS (consigne sprint).

import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Input,
  Select,
  Textarea,
  Tag,
  Icon,
  useToast,
} from '../ui';
import { t } from '../../lib/i18n';
import {
  RECOVERY_DELAYS_MIN,
  RECOVERY_DISCOUNT_PCT,
} from '../../lib/types';
import {
  Mail,
  MailOpen,
  MailMinus,
  RotateCcw,
  Save,
  Clock,
  Percent,
  Eye,
  MessageSquare,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

type StepNum = 1 | 2 | 3;
type Channel = 'email' | 'sms';

interface StepConfig {
  delay_min: number;
  discount_pct: number;
  channel: Channel;
  email_subject: string;
  email_body: string;
}

type WorkflowState = Record<StepNum, StepConfig>;

// ── Defaults ────────────────────────────────────────────────────────────────

// Templates email FR-QC par défaut, ton "boutique" sobre. Tokens runtime
// remplacés au moment de l'envoi côté worker (généreRecoveryCoupon + send).
const DEFAULT_SUBJECTS: Record<StepNum, string> = {
  1: 'Vous avez oublié quelque chose dans votre panier',
  2: 'Profitez de {{discount_pct}} % avec le code {{coupon_code}}',
  3: 'Dernière chance — {{discount_pct}} % sur votre panier',
};

const DEFAULT_BODIES: Record<StepNum, string> = {
  1: `Bonjour,

Nous avons remarqué que vous avez laissé des articles dans votre panier. Souhaitez-vous finaliser votre commande ?

Reprendre mon panier : {{cart_link}}

Merci,
L'équipe`,
  2: `Bonjour,

Pour vous aider à finaliser votre commande, voici une remise de {{discount_pct}} % avec le code suivant :

{{coupon_code}}

Reprendre mon panier : {{cart_link}}

À bientôt,
L'équipe`,
  3: `Bonjour,

Dernière chance — votre panier expire bientôt. Profitez de {{discount_pct}} % avec le code :

{{coupon_code}}

Reprendre mon panier : {{cart_link}}

L'équipe`,
};

const DEFAULT_CHANNELS: Record<StepNum, Channel> = {
  1: 'email',
  2: 'email',
  3: 'email',
};

function makeDefaults(): WorkflowState {
  return {
    1: {
      delay_min: RECOVERY_DELAYS_MIN[1],
      discount_pct: RECOVERY_DISCOUNT_PCT[1],
      channel: DEFAULT_CHANNELS[1],
      email_subject: DEFAULT_SUBJECTS[1],
      email_body: DEFAULT_BODIES[1],
    },
    2: {
      delay_min: RECOVERY_DELAYS_MIN[2],
      discount_pct: RECOVERY_DISCOUNT_PCT[2],
      channel: DEFAULT_CHANNELS[2],
      email_subject: DEFAULT_SUBJECTS[2],
      email_body: DEFAULT_BODIES[2],
    },
    3: {
      delay_min: RECOVERY_DELAYS_MIN[3],
      discount_pct: RECOVERY_DISCOUNT_PCT[3],
      channel: DEFAULT_CHANNELS[3],
      email_subject: DEFAULT_SUBJECTS[3],
      email_body: DEFAULT_BODIES[3],
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stepIcon(step: StepNum): typeof Mail {
  if (step === 1) return Mail;
  if (step === 2) return MailOpen;
  return MailMinus;
}

function stepVariant(
  step: StepNum,
): 'info' | 'warning' | 'danger' {
  if (step === 1) return 'info';
  if (step === 2) return 'warning';
  return 'danger';
}

/**
 * Formatage humain d'une durée en minutes :
 *   60     → "1 h"
 *   1440   → "24 h" (= 1 jour)
 *   4320   → "72 h" (= 3 jours)
 * On garde l'unité "heures" pour cohérence avec les libellés métier
 * (le sprint parle de "1h / 24h / 72h") plutôt que basculer en jours.
 */
function formatDelay(min: number): string {
  if (!Number.isFinite(min) || min < 0) return '—';
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  return `${hours} h`;
}

/**
 * Rendu preview email : remplace les tokens par des placeholders visuels
 * lisibles dans le panneau de prévisualisation. Pas de HTML interprété
 * (pas d'iframe sandbox = pas de surface XSS supplémentaire — le texte est
 * affiché tel quel dans une box stylée, line-breaks préservés via white-space).
 */
function renderPreview(
  template: string,
  step: StepConfig,
): string {
  return template
    .replaceAll('{{discount_pct}}', String(step.discount_pct))
    .replaceAll('{{coupon_code}}', `RECUP${step.discount_pct}`)
    .replaceAll('{{cart_link}}', 'https://exemple.ca/panier/abc123');
}

// ── Composant ──────────────────────────────────────────────────────────────

export function RecoveryWorkflowEditor() {
  const { info } = useToast();
  const [state, setState] = useState<WorkflowState>(() => makeDefaults());

  // Délais cumulés affichés en header (Step 1 = 1h, Step 2 = +24h après step 1
  // depuis l'abandon (donc 24h total), Step 3 = 72h depuis l'abandon). Les
  // valeurs RECOVERY_DELAYS_MIN sont DÉJÀ exprimées depuis l'abandon (pas
  // cumulatives entre touches), cf. types.ts L2810-2812. On affiche donc
  // les delays bruts par step, séparés par "→".
  const sequenceSummary = useMemo(() => {
    return [1, 2, 3]
      .map((s) => formatDelay(state[s as StepNum].delay_min))
      .join(' → ');
  }, [state]);

  // ── Updaters ──────────────────────────────────────────────────────────

  const updateStep = (step: StepNum, patch: Partial<StepConfig>) => {
    setState((prev) => ({
      ...prev,
      [step]: { ...prev[step], ...patch },
    }));
  };

  const handleReset = () => {
    setState(makeDefaults());
    info(t('ecommerce.recovery.workflow.reset'));
  };

  const handleSave = () => {
    // TODO seq136 : POST /api/recovery/config quand le helper API existera.
    // Pour l'instant la config est FIGÉE dans les constantes
    // RECOVERY_DELAYS_MIN / RECOVERY_DISCOUNT_PCT — on informe l'opérateur.
    info(
      'Configuration codée — modifier RECOVERY_DELAYS_MIN/RECOVERY_DISCOUNT_PCT pour persister.',
    );
  };

  // ── Rendu ──────────────────────────────────────────────────────────────

  return (
    <section
      className="flex flex-col gap-5"
      aria-labelledby="recovery-workflow-title"
      data-testid="recovery-workflow-editor"
    >
      {/* Header : titre + résumé séquence + actions globales */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="recovery-workflow-title"
            className="text-[15px] font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"
          >
            <Icon as={Mail} size="sm" aria-hidden />
            {t('ecommerce.recovery.workflow.title')}
          </h2>
          <span
            className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1.5"
            data-testid="sequence-summary"
          >
            <Icon as={Clock} size="xs" aria-hidden />
            <span className="t-mono-num">{sequenceSummary}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={handleReset}
            aria-label={t('ecommerce.recovery.workflow.reset')}
            data-testid="reset-defaults"
          >
            <Icon as={RotateCcw} size="xs" aria-hidden />
            {t('ecommerce.recovery.workflow.reset')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="gap-1"
            onClick={handleSave}
            data-testid="save-workflow"
          >
            <Icon as={Save} size="xs" aria-hidden />
            Enregistrer
          </Button>
        </div>
      </header>

      {/* 3 cards côte à côte (responsive : stacked sur mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((s) => {
          const step = s as StepNum;
          const cfg = state[step];
          const StepIcon = stepIcon(step);
          const preview = renderPreview(cfg.email_body, cfg);
          const previewSubject = renderPreview(cfg.email_subject, cfg);

          return (
            <Card
              key={step}
              className="flex flex-col gap-3"
              data-testid={`step-card-${step}`}
            >
              {/* Card header : step badge + canal courant */}
              <div className="flex items-center justify-between gap-2">
                <Tag
                  size="sm"
                  variant={stepVariant(step)}
                  dot
                  aria-label={`Touche ${step} sur 3`}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon as={StepIcon} size="xs" aria-hidden />
                    Touche {step}/3
                  </span>
                </Tag>
                <span className="text-[11px] text-[var(--text-muted)] t-mono-num">
                  {formatDelay(cfg.delay_min)} · {cfg.discount_pct}%
                </span>
              </div>

              {/* Inputs : delay + discount */}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  size="sm"
                  min={0}
                  max={43200 /* 30 j */}
                  step={5}
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Icon as={Clock} size="xs" aria-hidden />
                      {t('ecommerce.recovery.workflow.delay')} (min)
                    </span>
                  }
                  value={cfg.delay_min}
                  onChange={(e) =>
                    updateStep(step, {
                      delay_min: Number(e.target.value) || 0,
                    })
                  }
                  aria-label={`${t('ecommerce.recovery.workflow.delay')} touche ${step}`}
                  data-testid={`delay-${step}`}
                />
                <Input
                  type="number"
                  size="sm"
                  min={0}
                  max={100}
                  step={1}
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Icon as={Percent} size="xs" aria-hidden />
                      {t('ecommerce.recovery.workflow.discount')}
                    </span>
                  }
                  value={cfg.discount_pct}
                  onChange={(e) =>
                    updateStep(step, {
                      discount_pct: Math.min(
                        100,
                        Math.max(0, Number(e.target.value) || 0),
                      ),
                    })
                  }
                  aria-label={`${t('ecommerce.recovery.workflow.discount')} touche ${step}`}
                  data-testid={`discount-${step}`}
                />
              </div>

              {/* Channel select */}
              <Select
                size="sm"
                label={
                  <span className="inline-flex items-center gap-1">
                    <Icon as={MessageSquare} size="xs" aria-hidden />
                    {t('ecommerce.recovery.workflow.channel')}
                  </span>
                }
                value={cfg.channel}
                onChange={(e) =>
                  updateStep(step, {
                    channel: e.target.value as Channel,
                  })
                }
                aria-label={`${t('ecommerce.recovery.workflow.channel')} touche ${step}`}
                data-testid={`channel-${step}`}
              >
                <option value="email">Courriel</option>
                <option value="sms">SMS</option>
              </Select>

              {/* Email subject */}
              <Input
                size="sm"
                label={t('ecommerce.recovery.workflow.subject')}
                value={cfg.email_subject}
                onChange={(e) =>
                  updateStep(step, { email_subject: e.target.value })
                }
                aria-label={`${t('ecommerce.recovery.workflow.subject')} touche ${step}`}
                data-testid={`subject-${step}`}
              />

              {/* Email body */}
              <Textarea
                label={t('ecommerce.recovery.workflow.body')}
                value={cfg.email_body}
                onChange={(e) =>
                  updateStep(step, { email_body: e.target.value })
                }
                rows={6}
                resize="vertical"
                aria-label={`${t('ecommerce.recovery.workflow.body')} touche ${step}`}
                data-testid={`body-${step}`}
              />

              {/* Preview box — pas d'iframe (pas de HTML user, juste texte
                  brut avec tokens résolus + line-breaks préservés). */}
              <div
                className="flex flex-col gap-1.5"
                data-testid={`preview-${step}`}
              >
                <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide inline-flex items-center gap-1">
                  <Icon as={Eye} size="xs" aria-hidden />
                  {t('ecommerce.recovery.workflow.preview')}
                </span>
                <div
                  className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 text-[12px] text-[var(--text-secondary)]"
                  role="region"
                  aria-label={`${t('ecommerce.recovery.workflow.preview')} touche ${step}`}
                >
                  <div
                    className="font-semibold text-[var(--text-primary)] mb-2 break-words"
                    data-testid={`preview-subject-${step}`}
                  >
                    {previewSubject}
                  </div>
                  <div
                    className="whitespace-pre-wrap break-words leading-relaxed"
                    data-testid={`preview-body-${step}`}
                  >
                    {preview}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export default RecoveryWorkflowEditor;
