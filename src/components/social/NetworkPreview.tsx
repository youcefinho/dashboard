// ── NetworkPreview — aperçu sobre du rendu d'un post par réseau ─────────────
// LOT SOCIAL PLANNER (Sprint 9) — Manager-C (front). Composant réutilisable,
// AUCUN CSS global (uniquement utilitaires Tailwind + tokens var(--…)).
// Rendu fidèle/sobre calqué Stripe : carte légère, en-tête réseau, corps texte,
// vignettes média. PAS d'appel réseau — purement présentationnel.

import { Building2 } from 'lucide-react';
import type { SocialProvider } from '@/lib/types';
import { t } from '@/lib/i18n';

// ── Brand icons inline SVG ──────────────────────────────────────────────────
// lucide-react v1 a retiré Facebook/Instagram/Linkedin (trademark policy).
// Inline SVG avec currentColor permet de teinter via parent style={color:…}.
const FacebookIcon = (props: { size?: number }) => (
  <svg width={props.size ?? 14} height={props.size ?? 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);
const InstagramIcon = (props: { size?: number }) => (
  <svg width={props.size ?? 14} height={props.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);
const LinkedinIcon = (props: { size?: number }) => (
  <svg width={props.size ?? 14} height={props.size ?? 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

/** Métadonnées d'affichage par réseau (libellé i18n + icône + teinte sobre). */
const NETWORK_META: Record<
  SocialProvider,
  { icon: React.ReactNode; tint: string }
> = {
  facebook: { icon: <FacebookIcon size={14} />, tint: '#1877F2' },
  instagram: { icon: <InstagramIcon size={14} />, tint: '#E1306C' },
  linkedin: { icon: <LinkedinIcon size={14} />, tint: '#0A66C2' },
  google_business: { icon: <Building2 size={14} />, tint: '#34A853' },
};

export function networkLabel(provider: SocialProvider): string {
  return t(`social.network.${provider}`);
}

export function NetworkIcon({ provider }: { provider: SocialProvider }) {
  return <span style={{ color: NETWORK_META[provider].tint }}>{NETWORK_META[provider].icon}</span>;
}

interface NetworkPreviewProps {
  provider: SocialProvider;
  content: string;
  media?: string[];
}

/** Aperçu sobre du post pour un réseau donné (carte légère style Stripe). */
export function NetworkPreview({ provider, content, media = [] }: NetworkPreviewProps) {
  const meta = NETWORK_META[provider];
  const isGbp = provider === 'google_business';
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      {/* En-tête réseau */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
        <span style={{ color: meta.tint }}>{meta.icon}</span>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{networkLabel(provider)}</span>
        {isGbp && (
          <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Post · Standard
          </span>
        )}
      </div>
      {/* Corps */}
      <div className="px-3 py-3">
        {/* GBP : carte business compacte (nom + adresse fictifs) en tête, façon SERP. */}
        {isGbp && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-dashed border-[var(--border-subtle)]">
            <span
              aria-hidden
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-bold"
              style={{ background: meta.tint }}
            >
              G
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--text-primary)] leading-tight truncate">
                {t('social.network.google_business')}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] leading-tight truncate">
                {t('social.preview')}
              </p>
            </div>
          </div>
        )}
        <p className="text-[13px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">
          {content.trim() ? content : <span className="text-[var(--text-muted)] italic">{t('social.content_placeholder')}</span>}
        </p>
        {media.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {media.slice(0, 6).map((url, i) => (
              <div
                key={`${url}-${i}`}
                className="aspect-square rounded-[var(--radius-md)] overflow-hidden bg-[var(--bg-subtle)] border border-[var(--border-subtle)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            ))}
          </div>
        )}
        {/* GBP : CTA placeholder (réservation/en savoir plus) calqué Google Business. */}
        {isGbp && content.trim().length > 0 && (
          <div className="mt-3 pt-2 border-t border-dashed border-[var(--border-subtle)]">
            <span
              className="inline-flex items-center px-3 py-1.5 text-[12px] font-medium rounded-[var(--radius-md)] border"
              style={{ color: meta.tint, borderColor: meta.tint }}
            >
              {t('social.network.google_business')} · CTA
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
