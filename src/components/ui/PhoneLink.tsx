// ── PhoneLink — Click-to-call natif ─────────────────────────
// Sprint 11 — Capacitor V1

import { Capacitor } from '@capacitor/core';
import { Phone } from 'lucide-react';

interface PhoneLinkProps {
  phone: string;
  children?: React.ReactNode;
  className?: string;
  showIcon?: boolean;
}

export function PhoneLink({ phone, children, className = '', showIcon = true }: PhoneLinkProps) {
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();

    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const telUrl = `tel:${cleanPhone}`;

    if (Capacitor.isNativePlatform()) {
      // Sur natif, window.open avec _system ouvre le dialer
      window.open(telUrl, '_system');
    } else {
      window.location.href = telUrl;
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 text-[var(--brand-primary)] hover:text-[var(--brand-hover)] transition-colors ${className}`}
      aria-label={`Appeler ${phone}`}
    >
      {showIcon && <Phone size={14} />}
      {children || phone}
    </button>
  );
}
