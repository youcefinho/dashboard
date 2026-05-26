// ── LeadPredictionCard — Sprint 49 M2.1 ─────────────────────────────────────
// Section "Prévision 30 jours" en sidebar LeadDetail.
//
// Fetch lazy (au montage) GET /api/leads/:id/score-predict. Si le backend est
// indisponible, bascule sur le calcul déterministe local predictLeadLocal()
// avec les données déjà chargées dans LeadDetail — JAMAIS d'écran vide.
//
// Stripe SUBTLE : gauge SVG circulaire sober (primary, pas de glow), badge de
// confiance, 3 actions suggérées, top 3 facteurs (+/-).

import { useEffect, useState } from 'react';
import { Card, Tag, Icon } from '@/components/ui';
import { Sparkles, TrendingUp, TrendingDown, ShieldCheck } from 'lucide-react';
import { t } from '@/lib/i18n';
import {
  fetchLeadPredict,
  predictLeadLocal,
  type LeadPrediction,
  type PredictConfidence,
} from '@/lib/leadPredict';
import type { ConversionPrediction } from '@/lib/types';

interface LeadPredictionCardProps {
  leadId: string;
  /** Données du lead pour le fallback local déterministe. */
  localInput: Parameters<typeof predictLeadLocal>[0];
  /**
   * Sprint 13 — score de conversion CALIBRÉ tenant (getLeadConversionScore).
   * Optionnel : absent ⇒ comportement Sprint 49 byte-identique (rétro-compat).
   * Présent ⇒ affiche le badge « calibré » + le facteur « taux historique »
   * issus de l'agrégat won/lost réel du tenant. Best-effort : si la proba
   * calibrée est indisponible (probability 0 + factors vides), on ignore.
   */
  conversion?: ConversionPrediction | null;
}

// LOT C — label résolu AU RENDER via t(labelKey)
const CONFIDENCE_META: Record<
  PredictConfidence,
  { labelKey: string; variant: 'success' | 'warning' | 'default' }
> = {
  high: { labelKey: 'panels.predict_conf_high', variant: 'success' },
  medium: { labelKey: 'panels.predict_conf_medium', variant: 'warning' },
  low: { labelKey: 'panels.predict_conf_low', variant: 'default' },
};

function PredictionGauge({ value }: { value: number }) {
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c - (pct / 100) * c;

  return (
    <div
      className="lead-predict-gauge"
      role="img"
      aria-label={t('panels.predict_gauge_aria').replace('{pct}', String(pct))}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={stroke}
        />
        <circle
          className="lead-predict-gauge__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="lead-predict-gauge__label">
        <span className="lead-predict-gauge__value t-mono-num">{pct}%</span>
        <span className="lead-predict-gauge__sub">{t('panels.predict_under_30d')}</span>
      </div>
    </div>
  );
}

export function LeadPredictionCard({
  leadId,
  localInput,
  conversion,
}: LeadPredictionCardProps) {
  const [prediction, setPrediction] = useState<LeadPrediction | null>(null);
  const [loading, setLoading] = useState(true);

  // Sprint 13 — la couche calibrée n'est exploitable que si elle porte un signal
  // réel : proba > 0 OU au moins un facteur. Sinon (stub backend / score absent)
  // on reste sur la prévision Sprint 49 sans rien casser (best-effort).
  const hasCalibration =
    !!conversion &&
    (conversion.probability > 0 || (conversion.factors?.length ?? 0) > 0);
  const isCalibrated = hasCalibration && conversion!.calibrated === 1;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const remote = await fetchLeadPredict(leadId);
      if (!active) return;
      setPrediction(remote ?? predictLeadLocal(localInput));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // localInput est recalculé à chaque render — on se base sur leadId stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  if (loading) {
    return (
      <Card className="p-4 lead-predict-panel">
        <div className="flex items-center justify-between mb-3">
          <SectionLabel />
        </div>
        <div className="lead-predict-skeleton" aria-hidden />
      </Card>
    );
  }

  if (!prediction) return null;

  const conf = CONFIDENCE_META[prediction.confidence];

  return (
    <Card className="p-4 lead-predict-panel">
      <div className="flex items-center justify-between mb-3">
        <SectionLabel />
        <Tag size="sm" variant={conf.variant}>
          {t(conf.labelKey)}
        </Tag>
      </div>

      <div className="flex flex-col items-center gap-1 mb-3">
        <PredictionGauge value={prediction.probability30d} />
      </div>

      {/* Sprint 13 — calibration tenant (badge calibré + facteurs « taux
          historique »). Affiché seulement si la couche calibrée porte un signal
          réel. Best-effort : aucune dépendance si conversion absent. */}
      {hasCalibration && (
        <div className="lead-predict-calibration mb-3">
          {isCalibrated && (
            <div className="flex items-center justify-center mb-2">
              <Tag size="sm" variant="success" leftIcon={<Icon as={ShieldCheck} size={11} />}>
                {t('conversion.calibrated')}
              </Tag>
            </div>
          )}
          {conversion!.factors.length > 0 && (
            <div className="lead-predict-factors">
              {conversion!.factors.map((f) => {
                const pos = f.impact >= 0;
                return (
                  <div key={f.label} className="lead-predict-factor">
                    <span className="lead-predict-factor__label">{f.label}</span>
                    <span
                      className={`lead-predict-factor__impact ${
                        pos
                          ? 'lead-predict-factor__impact--pos'
                          : 'lead-predict-factor__impact--neg'
                      }`}
                    >
                      <Icon as={pos ? TrendingUp : TrendingDown} size={11} />
                      {pos ? '+' : ''}
                      {f.impact}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Facteurs (top 3, +/-) */}
      {prediction.factors.length > 0 && (
        <div className="lead-predict-factors">
          {prediction.factors.map((f) => {
            const pos = f.impact >= 0;
            return (
              <div key={f.label} className="lead-predict-factor">
                <span className="lead-predict-factor__label">{f.label}</span>
                <span
                  className={`lead-predict-factor__impact ${
                    pos
                      ? 'lead-predict-factor__impact--pos'
                      : 'lead-predict-factor__impact--neg'
                  }`}
                >
                  <Icon
                    as={pos ? TrendingUp : TrendingDown}
                    size={11}
                  />
                  {pos ? '+' : ''}
                  {f.impact}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions suggérées */}
      {prediction.suggestedActions.length > 0 && (
        <div className="lead-predict-actions">
          <p className="lead-predict-actions__title">{t('panels.predict_actions')}</p>
          <ul className="lead-predict-actions__list">
            {prediction.suggestedActions.map((a, i) => (
              <li key={i} className="lead-predict-action">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="lead-predict-foot">
        {prediction.local
          ? t('panels.predict_foot_local')
          : t('panels.predict_foot_ai')}
      </p>
    </Card>
  );
}

function SectionLabel() {
  return (
    <span className="lead-predict-title">
      <Icon as={Sparkles} size={11} className="text-[var(--primary)]" />
      {t('panels.predict_title')}
    </span>
  );
}
