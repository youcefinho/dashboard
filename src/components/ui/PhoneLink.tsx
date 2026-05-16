// ── PhoneLink — Click-to-call natif premium (Sprint 23 wave 12) ──────────────
// Sprint 11 — Capacitor V1. Refonte visuelle Sprint 23 :
// chip gradient brand + icon dans pastille gradient + glow au hover + ripple click feedback.

import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Phone } from 'lucide-react';
// Sprint 33 vague 33-1A — Icon primitive (stroke 1.75 unifié)
import { Icon } from './Icon';

interface PhoneLinkProps {
  phone: string;
  children?: React.ReactNode;
  className?: string;
  showIcon?: boolean;
  /** Variante visuelle : chip (default) = pill gradient, inline = link discret en-ligne */
  variant?: 'chip' | 'inline';
}

export function PhoneLink({
  phone,
  children,
  className = '',
  showIcon = true,
  variant = 'chip',
}: PhoneLinkProps) {
  const [isPulsing, setIsPulsing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsPulsing(true);
    window.setTimeout(() => setIsPulsing(false), 480);

    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const telUrl = `tel:${cleanPhone}`;

    if (Capacitor.isNativePlatform()) {
      window.open(telUrl, '_system');
    } else {
      window.location.href = telUrl;
    }
  };

  if (variant === 'inline') {
    return (
      <button
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`group inline-flex items-center gap-1.5 font-medium transition-all cursor-pointer ${className}`}
        style={{
          color: 'var(--primary)',
          textShadow: isHovered ? '0 0 12px rgba(0,157,219,0.45)' : undefined,
        }}
        aria-label={`Appeler ${phone}`}
      >
        {showIcon && (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-all"
            style={{
              background: isHovered
                ? 'linear-gradient(135deg,#009DDB,#D96E27)'
                : 'rgba(0,157,219,0.12)',
              boxShadow: isHovered ? '0 0 10px rgba(217,110,39,0.5)' : 'none',
            }}
          >
            <Icon as={Phone} size={9} className="text-white" strokeWidth={2.5} />
          </span>
        )}
        <span
          className="underline-offset-2"
          style={{ textDecoration: isHovered ? 'underline' : 'none' }}
        >
          {children || phone}
        </span>
      </button>
    );
  }

  // variant === 'chip' (default)
  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-[12px] transition-all cursor-pointer ${className}`}
      style={{
        background: isHovered
          ? 'linear-gradient(135deg, rgba(0,157,219,0.16) 0%, rgba(217,110,39,0.10) 100%)'
          : 'linear-gradient(135deg, rgba(0,157,219,0.08) 0%, rgba(217,110,39,0.04) 100%)',
        border: '1px solid rgba(0,157,219,0.22)',
        color: 'var(--primary)',
        boxShadow: isHovered
          ? '0 2px 8px rgba(0,157,219,0.18), 0 0 12px rgba(217,110,39,0.18), inset 0 1px 0 rgba(255,255,255,0.6)'
          : 'inset 0 1px 0 rgba(255,255,255,0.5)',
        transform: isHovered ? 'translateY(-0.5px)' : 'translateY(0)',
      }}
      aria-label={`Appeler ${phone}`}
    >
      {/* Ripple au click */}
      {isPulsing && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(0,157,219,0.55) 0%, rgba(217,110,39,0.30) 50%, transparent 80%)',
            animation: 'phonelink-ripple 480ms cubic-bezier(0.4,0,0.2,1) forwards',
          }}
        />
      )}
      {showIcon && (
        <span
          className="relative inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0"
          style={{
            background: 'linear-gradient(135deg,#009DDB,#D96E27)',
            boxShadow: '0 0 8px rgba(217,110,39,0.5)',
          }}
        >
          <Icon as={Phone} size={9} className="text-white" strokeWidth={2.5} />
        </span>
      )}
      <span className="relative tabular-nums">{children || phone}</span>
    </button>
  );
}
