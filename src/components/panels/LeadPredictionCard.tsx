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
import { Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import {
  fetchLeadPredict,
  predictLeadLocal,
  type LeadPrediction,
  type PredictConfidence,
} from '@/lib/leadPredict';

interface LeadPredictionCardProps {
  leadId: string;
  /** Données du lead pour le fallback local déterministe. */
  localInput: Parameters<typeof predictLeadLocal>[0];
}

const CONFIDENCE_META: Record<
  PredictConfidence,
  { label: string; variant: 'success' | 'warning' | 'default' }
> = {
  high: { label: 'Confiance élevée', variant: 'success' },
  medium: { label: 'Confiance moyenne', variant: 'warning' },
  low: { label: 'Confiance faible', variant: 'default' },
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
      aria-label={`Probabilité de conversion sous 30 jours : ${pct}%`}
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
        <span className="lead-predict-gauge__sub">sous 30j</span>
      </div>
    </div>
  );
}

export function LeadPredictionCard({
  leadId,
  localInput,
}: LeadPredictionCardProps) {
  const [prediction, setPrediction] = useState<LeadPrediction | null>(null);
  const [loading, setLoading] = useState(true);

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
          {conf.label}
        </Tag>
      </div>

      <div className="flex flex-col items-center gap-1 mb-3">
        <PredictionGauge value={prediction.probability30d} />
      </div>

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
          <p className="lead-predict-actions__title">Actions suggérées</p>
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
          ? 'Estimation locale (hors-ligne)'
          : 'Estimé par Claude Haiku 4.5'}
      </p>
    </Card>
  );
}

function SectionLabel() {
  return (
    <span className="lead-predict-title">
      <Icon as={Sparkles} size={11} className="text-[var(--primary)]" />
      Prévision 30 jours
    </span>
  );
}
