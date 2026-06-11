// ── SmartBanner — Bandeau AI tip contextuel (Sprint 23 wave 17, signature GHL) ─
// Pattern GHL "Did you know..." / "Quick tip" — bandeau premium horizontal
// avec icon AI/Sparkles + message + CTA optionnel + dismissable persistant
// (localStorage par key). Glassmorphism + gradient brand + orb décoratif.

import { useState, type ReactNode } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';

type SmartBannerVariant = 'tip' | 'success' | 'warning' | 'ai';

interface SmartBannerProps {
  /** Clé unique localStorage pour persister la dismissal (sinon banner non-dismissable) */
  dismissKey?: string;
  variant?: SmartBannerVariant;
  /** Icon optionnel — défaut Sparkles selon variant */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** CTA action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Lien secondary à droite du CTA */
  secondaryLabel?: string;
  onSecondaryClick?: () => void;
  className?: string;
}

function resolveVariant(variant: SmartBannerVariant) {
  switch (variant) {
    case 'success':
      return {
        gradient: 'linear-gradient(135deg, rgba(55,202,55,0.10) 0%, rgba(0,157,219,0.05) 100%)',
        border: 'rgba(55,202,55,0.30)',
        iconBg: 'linear-gradient(135deg, #10B981 0%, #635BFF 100%)',
        iconGlow: '0 0 12px rgba(55,202,55,0.5)',
        orbColor: 'rgba(55,202,55,0.18)',
        accent: '#1f8f1f',
      };
    case 'warning':
      return {
        gradient: 'linear-gradient(135deg, rgba(255,154,0,0.10) 0%, rgba(217,110,39,0.05) 100%)',
        border: 'rgba(255,154,0,0.32)',
        iconBg: 'linear-gradient(135deg, #FF9A00 0%, #D96E27 100%)',
        iconGlow: '0 0 12px rgba(255,154,0,0.5)',
        orbColor: 'rgba(255,154,0,0.20)',
        accent: '#c97800',
      };
    case 'ai':
      return {
        gradient: 'linear-gradient(135deg, rgba(139,92,246,0.10) 0%, rgba(0,157,219,0.05) 100%)',
        border: 'rgba(139,92,246,0.32)',
        iconBg: 'linear-gradient(135deg, #8B5CF6 0%, #635BFF 100%)',
        iconGlow: '0 0 14px rgba(139,92,246,0.55)',
        orbColor: 'rgba(139,92,246,0.20)',
        accent: '#7C3AED',
      };
    case 'tip':
    default:
      return {
        gradient: 'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.05) 100%)',
        border: 'rgba(0,157,219,0.32)',
        iconBg: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
        iconGlow: '0 0 12px rgba(0,157,219,0.5)',
        orbColor: 'rgba(0,157,219,0.18)',
        accent: 'var(--primary)',
      };
  }
}

export function SmartBanner({
  dismissKey,
  variant = 'tip',
  icon,
  title,
  description,
  action,
  secondaryLabel,
  onSecondaryClick,
  className = '',
}: SmartBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissKey) return false;
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(`intralys_smartbanner_${dismissKey}`) === '1';
  });

  if (dismissed) return null;

  const v = resolveVariant(variant);

  const handleDismiss = () => {
    if (dismissKey) {
      localStorage.setItem(`intralys_smartbanner_${dismissKey}`, '1');
    }
    setDismissed(true);
  };

  return (
    <div
      className={`relative overflow-hidden flex items-start gap-3 px-4 py-3 rounded-2xl mb-5 ${className}`}
      style={{
        background: v.gradient,
        backdropFilter: 'blur(8px) saturate(160%)',
        WebkitBackdropFilter: 'blur(8px) saturate(160%)',
        border: `1px solid ${v.border}`,
        boxShadow: `0 1px 2px rgba(15,23,42,0.03), 0 8px 24px -8px ${v.border}, inset 0 1px 0 rgba(255,255,255,0.6)`,
      }}
    >
      {/* Orb décoratif */}
      <div
        aria-hidden
        className="absolute -top-10 -left-10 w-32 h-32 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${v.orbColor} 0%, transparent 70%)`,
          filter: 'blur(28px)',
        }}
      />

      {/* Icon chip */}
      <div
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 mt-0.5"
        style={{
          background: v.iconBg,
          boxShadow: `${v.iconGlow}, inset 0 1px 0 rgba(255,255,255,0.25)`,
          color: '#FFFFFF',
        }}
      >
        {icon || <Icon as={Sparkles} size={16} strokeWidth={2.5} />}
      </div>

      {/* Content */}
      <div className="relative flex-1 min-w-0">
        <p className="text-[13px] font-bold leading-tight" style={{ color: v.accent }}>
          {title}
        </p>
        {description && (
          <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="relative flex items-center gap-1.5 shrink-0">
        {action && (
          <button
            onClick={action.onClick}
            className="group inline-flex items-center gap-1 px-3 h-8 text-[12px] font-semibold rounded-lg text-white transition-all cursor-pointer"
            style={{
              background: v.iconBg,
              boxShadow: `0 2px 8px -2px ${v.border}, inset 0 1px 0 rgba(255,255,255,0.20)`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = `0 4px 12px -2px ${v.border}, 0 0 16px ${v.border}, inset 0 1px 0 rgba(255,255,255,0.25)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = `0 2px 8px -2px ${v.border}, inset 0 1px 0 rgba(255,255,255,0.20)`;
            }}
          >
            {action.label}
            <Icon as={ArrowRight} size={12} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
        {secondaryLabel && (
          <button
            onClick={onSecondaryClick || handleDismiss}
            className="text-[11px] font-medium px-2 h-8 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = v.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {secondaryLabel}
          </button>
        )}
        {dismissKey && (
          <button
            onClick={handleDismiss}
            aria-label="Fermer"
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = v.accent;
              e.currentTarget.style.background = `color-mix(in srgb, ${v.accent} 10%, transparent)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon as={X} size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
