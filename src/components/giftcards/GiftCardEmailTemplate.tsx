// ── GiftCardEmailTemplate — Sprint 38 (Agent B1) ────────────────────────────
// Composant pur HTML pour rendu email "carte-cadeau prête".
// Style INLINE strict (compat clients email Gmail/Outlook/Apple Mail).
// Pas de Tailwind dynamique, pas de variables CSS — chaque rule en `style={{}}`.
// Utilise t() pour les chaînes côté i18n (subject/body) + clés giftCards.email.*.
// Sortie : un <div> qu'on peut sérialiser via ReactDOMServer.renderToStaticMarkup
// puis embedder dans un payload email tenant.

import { t } from '../../lib/i18n';
import { getLocale } from '../../lib/i18n';
import { formatMoneyCents } from '../../lib/i18n/number';
import type { GiftCard } from '../../lib/api';

interface GiftCardEmailTemplateProps {
  card: GiftCard;
  tenantName: string;
}

// ── Style maps : inline (object) pour compat email ──────────────────────────

const wrapStyle: React.CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  backgroundColor: '#f5f5f7',
  padding: '32px 16px',
  margin: 0,
  width: '100%',
  color: '#111111',
};

const cardStyle: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  border: '1px solid #e5e5e7',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '24px 32px',
  borderBottom: '1px solid #ececef',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
};

const tenantNameStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#111111',
  letterSpacing: '-0.01em',
  margin: 0,
};

const logoPlaceholderStyle: React.CSSProperties = {
  width: '36px',
  height: '36px',
  borderRadius: '8px',
  backgroundColor: '#635bff',
  color: '#ffffff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
  fontWeight: 700,
};

const bodyStyle: React.CSSProperties = {
  padding: '32px',
};

const subjectStyle: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 700,
  margin: '0 0 8px 0',
  color: '#111111',
  letterSpacing: '-0.02em',
};

const introStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#4f4f55',
  margin: '0 0 24px 0',
  lineHeight: 1.5,
};

const codeBoxStyle: React.CSSProperties = {
  backgroundColor: '#f7f7f9',
  border: '1px solid #ececef',
  borderRadius: '10px',
  padding: '20px 16px',
  textAlign: 'center',
  margin: '0 0 24px 0',
};

const codeStyle: React.CSSProperties = {
  fontFamily:
    "'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: '24px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#111111',
  margin: 0,
  wordBreak: 'break-all',
};

const balanceRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  padding: '12px 0',
  borderTop: '1px solid #ececef',
};

const balanceLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#71717a',
  margin: 0,
};

const balanceValueStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#111111',
  margin: 0,
};

const expiresStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#71717a',
  margin: '4px 0 0 0',
  textAlign: 'right',
};

const instructionsTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#111111',
  margin: '24px 0 8px 0',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const instructionsListStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#4f4f55',
  lineHeight: 1.6,
  paddingLeft: '20px',
  margin: 0,
};

const footerStyle: React.CSSProperties = {
  padding: '16px 32px 24px',
  borderTop: '1px solid #ececef',
  textAlign: 'center',
};

const footerTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#9a9aa1',
  margin: 0,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function tenantInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  return trimmed.charAt(0).toUpperCase();
}

function formatExpires(date: string | null, locale: string): string {
  if (!date) return '';
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

// ── Composant ───────────────────────────────────────────────────────────────

export function GiftCardEmailTemplate({
  card,
  tenantName,
}: GiftCardEmailTemplateProps) {
  const locale = getLocale();
  const balanceFormatted = formatMoneyCents(
    card.current_balance_cents,
    locale,
    card.currency || 'CAD',
  );
  const expiresFormatted = formatExpires(card.expires_at, locale);

  return (
    <div style={wrapStyle} data-testid="gift-card-email-template">
      <div style={cardStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h1 style={tenantNameStyle}>{tenantName}</h1>
          <span
            aria-hidden="true"
            style={logoPlaceholderStyle}
            data-testid="gift-card-email-logo"
          >
            {tenantInitial(tenantName)}
          </span>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          <h2 style={subjectStyle}>{t('giftCards.email.subject')}</h2>
          <p style={introStyle}>{t('giftCards.email.body')}</p>

          {/* Big code display */}
          <div style={codeBoxStyle} data-testid="gift-card-email-code">
            <p style={codeStyle}>{card.code}</p>
          </div>

          {/* Balance + expires */}
          <div style={balanceRowStyle}>
            <p style={balanceLabelStyle}>{t('giftCards.balance')}</p>
            <p style={balanceValueStyle}>{balanceFormatted}</p>
          </div>
          {expiresFormatted ? (
            <p style={expiresStyle}>
              {t('giftCards.expires.label')} {expiresFormatted}
            </p>
          ) : null}

          {/* Instructions courtes */}
          <h3 style={instructionsTitleStyle}>
            {t('giftCards.email.subject')}
          </h3>
          <ol style={instructionsListStyle}>
            <li>{t('giftCards.email.body')}</li>
            <li>{t('giftCards.redeem.cta')}</li>
          </ol>
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <p style={footerTextStyle}>{tenantName}</p>
        </div>
      </div>
    </div>
  );
}
