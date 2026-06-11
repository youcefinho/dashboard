// ── ErrorBoundary — Capture uncaught errors (Sprint 24 vague 5A) ────────────
// Wrapper class component qui catche tout render error et affiche un fallback
// premium (orbs floats + gradient brand + actions reload/home/report).
// Inspiration : Linear & Vercel "Something went wrong" screens.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home, Bug } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught error :', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    window.location.href = '/dashboard';
  };

  handleReport = () => {
    const subject = encodeURIComponent('[Intralys] Bug report');
    const body = encodeURIComponent(
      `Une erreur s'est produite dans l'application :\n\n` +
        `Message : ${this.state.error?.message || 'inconnu'}\n\n` +
        `Stack :\n${this.state.error?.stack || '—'}\n\n` +
        `URL : ${window.location.href}\n` +
        `UA : ${navigator.userAgent}\n`,
    );
    window.location.href = `mailto:support@intralys.com?subject=${subject}&body=${body}`;
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden px-6 py-12 text-center"
        style={{
          background:
            'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
        }}
      >
        {/* Orb #1 — cyan top-left */}
        <div
          aria-hidden
          className="hero-stat-orb absolute -top-32 left-1/4 w-[440px] h-[440px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(99,91,255,0.30) 0%, rgba(99,91,255,0.10) 50%, transparent 80%)',
            filter: 'blur(70px)',
          }}
        />
        {/* Orb #2 — orange bottom-right */}
        <div
          aria-hidden
          className="hero-stat-orb absolute -bottom-32 right-1/4 w-[400px] h-[400px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(139,92,246,0.28) 0%, rgba(139,92,246,0.08) 50%, transparent 80%)',
            filter: 'blur(70px)',
            animationDelay: '3s',
          }}
        />
        {/* Orb #3 — accent center subtle */}
        <div
          aria-hidden
          className="hero-stat-orb absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[260px] h-[260px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(233,61,61,0.18) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animationDelay: '1.5s',
          }}
        />

        {/* Icon chip premium */}
        <div className="relative mb-7">
          <div
            aria-hidden
            className="absolute inset-0 rounded-3xl pointer-events-none"
            style={{
              background:
                'radial-gradient(circle, rgba(233,61,61,0.35) 0%, rgba(217,110,39,0.20) 50%, transparent 80%)',
              filter: 'blur(24px)',
              transform: 'scale(1.7)',
              animation: 'hot-lead-pulse 3.5s ease-in-out infinite',
            }}
          />
          <div
            className="relative w-[96px] h-[96px] rounded-3xl flex items-center justify-center"
            style={{
              background:
                'linear-gradient(135deg, #E93D3D 0%, #D96E27 60%, #FF9A00 100%)',
              boxShadow:
                '0 8px 32px -6px rgba(233,61,61,0.55), 0 0 40px -8px rgba(217,110,39,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            <AlertTriangle
              size={44}
              className="text-white"
              strokeWidth={2.25}
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' }}
            />
          </div>
        </div>

        <p
          className="relative text-[10px] font-bold uppercase tracking-[0.18em] mb-2"
          style={{
            background: 'linear-gradient(135deg, #635BFF 0%, #8B5CF6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {t('error.meta')}
        </p>

        <h1 className="relative text-3xl font-bold tracking-tight text-[var(--text-primary)] mb-3 max-w-2xl">
          <span className="text-gradient-brand">{t('error.oops')}</span> {t('error.title')}
        </h1>

        <p className="relative text-sm text-[var(--text-secondary)] max-w-md mb-8 leading-relaxed">
          {t('error.description')}
        </p>

        {/* Error message (dev mode helper) */}
        {this.state.error?.message && (
          <details
            className="relative mb-8 max-w-xl w-full text-left"
          >
            <summary className="text-[11px] font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors mb-2">
              {t('error.details')}
            </summary>
            <pre
              className="text-[10px] font-mono p-3 rounded-lg overflow-auto max-h-40 text-[var(--text-secondary)]"
              style={{
                background: 'rgba(99,91,255,0.04)',
                border: '1px solid rgba(99,91,255,0.18)',
              }}
            >
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
            </pre>
          </details>
        )}

        <div className="relative flex items-center gap-3 flex-wrap justify-center">
          <button
            onClick={this.handleReload}
            className="inline-flex items-center gap-2 h-11 px-5 text-sm font-semibold rounded-[10px] text-white active:scale-[0.98] transition-all cursor-pointer"
            style={{
               background:
                'var(--primary)',
               boxShadow:
                '0 4px 16px -2px rgba(99,91,255,0.45), inset 0 1px 0 rgba(255,255,255,0.20)',
              border: '1px solid rgba(99,91,255,0.55)',
            }}
          >
            <Icon as={RefreshCcw} size="md" strokeWidth={2.4} />
            {t('error.reload')}
          </button>

          <button
            onClick={this.handleHome}
            className="inline-flex items-center gap-2 h-11 px-5 text-sm font-semibold rounded-[10px] transition-all cursor-pointer"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(99,91,255,0.45)';
              e.currentTarget.style.boxShadow = '0 4px 14px -4px rgba(99,91,255,0.20)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)';
            }}
          >
            <Icon as={Home} size="md" strokeWidth={2.2} />
            {t('error.home')}
          </button>

          <button
            onClick={this.handleReport}
            className="inline-flex items-center gap-2 h-11 px-5 text-sm font-semibold rounded-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <Icon as={Bug} size="md" strokeWidth={2.2} />
            {t('error.report')}
          </button>
        </div>
      </div>
    );
  }
}
