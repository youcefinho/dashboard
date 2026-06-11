// ── StatCard — Carte KPI premium (Giga Sprint Design) ──────────────────
// Composant extrait de Dashboard.tsx. Utilise les classes CSS du design system
// au lieu de styles inline. Animation d'entrée stagger via className.

import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { AnimatedNumber } from '@/components/ui';

interface StatCardProps {
  /** Label KPI (ex: "Contacts", "Pipeline") */
  label: string;
  /** Valeur numérique ou string (ex: 42, "12.5K $") */
  value: number | string;
  /** Icône Lucide */
  icon: ReactNode;
  /** Couleur de fond du chip icône */
  iconBg: string;
  /** Couleur de l'icône */
  iconColor: string;
  /** Couleur d'accent pour le border-top */
  accentColor?: string;
  /** Texte delta (ex: "+12%") */
  delta?: string;
  /** Direction du delta (true = positif) */
  deltaUp?: boolean;
  /** Couleur de la sparkline */
  sparkColor: string;
  /** Données sparkline (array de nombres) */
  sparkData?: number[];
  /** Classe CSS additionnelle (pour stagger) */
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  accentColor,
  delta,
  deltaUp,
  sparkColor,
  sparkData,
  className = '',
}: StatCardProps) {
  // Générer le SVG sparkline path
  const sparkPath = (sparkData && sparkData.length > 1) ? (() => {
    const max = Math.max(...sparkData, 1);
    const min = Math.min(...sparkData, 0);
    const range = max - min || 1;
    const pts = sparkData.map((v, i) => {
      const x = (i / (sparkData.length - 1)) * 100;
      const y = 30 - ((v - min) / range) * 25;
      return `${x},${y}`;
    });
    return `M${pts.join(' L')}`;
  })() : null;

  const areaPath = sparkPath ? `${sparkPath} L100,30 L0,30 Z` : null;

  // ID unique pour le gradient SVG (basé sur le label)
  const gradientId = `spark-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div
      className={`stat-card animate-fade-in-up ${className}`}
      style={accentColor ? { borderTop: `3px solid ${accentColor}` } : undefined}
    >
      {/* En-tête : icône chip + label */}
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="stat-icon-chip"
          style={{ background: iconBg }}
        >
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <span className="stat-label">{label}</span>
      </div>

      {/* Valeur + delta badge */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="stat-value">
          <AnimatedNumber value={value} />
        </span>
        {delta && (
          <span className={`stat-delta ${deltaUp !== false ? 'stat-delta-up' : 'stat-delta-down'}`}>
            {deltaUp !== false ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {delta}
          </span>
        )}
      </div>

      {/* Sparkline SVG */}
      {sparkPath && (
        <svg className="w-full h-8 mt-1" viewBox="0 0 100 30" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={sparkColor} stopOpacity={0.18} />
              <stop offset="1" stopColor={sparkColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath!} fill={`url(#${gradientId})`} />
          <path
            d={sparkPath}
            fill="none"
            stroke={sparkColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
