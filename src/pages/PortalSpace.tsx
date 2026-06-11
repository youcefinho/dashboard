// ── PortalSpace — portail client PUBLIC (LOT PORTAL-E, Sprint E) ───────────
//
// Corps réel Phase C Manager-C. L'export nommé `PortalSpacePage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route publique `/portal/$slug`, hors
// LazyGuard/auth, calque EXACT memberSpaceRoute /m/$slug).
//
// Calque le pattern src/pages/MemberSpace.tsx : pas d'auth CRM, AUTH PORTAIL
// SÉPARÉE (token portail stocké à part — localStorage 'intralys_portal_token',
// JAMAIS le token admin de apiFetch NI le token membre 'intralys_member_token'),
// helpers api FIGÉS Phase A (portalLogin / portalSetPassword / portalLogout /
// getPortalInvoices / getPortalQuotes / getPortalAppointments /
// getPortalDocuments / getPortalTickets / createPortalTicket), spinner loading,
// écran connexion / activation, discrimination erreur = absence `data` / champ
// `error` (JAMAIS de `code`). i18n 100% t('portal.*') (clés FIGÉES Phase A —
// AUCUNE création Phase C). Vue 360 du lead courant : factures (LECTURE SEULE —
// E4 jamais, AUCUN bouton de paiement), devis, rendez-vous, documents (statut
// de signature), tickets (lecture + création). Le front n'invente JAMAIS de
// données — tout vient du backend, borné lead_id + client_id côté worker.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  portalLogin,
  portalSetPassword,
  portalLogout,
  getPortalInvoices,
  getPortalQuotes,
  getPortalAppointments,
  getPortalDocuments,
  getPortalTickets,
  createPortalTicket,
  type PortalInvoice,
  type PortalQuote,
  type PortalAppointment,
  type PortalDocument,
  type PortalTicket,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/datetime';

// Clé localStorage DISTINCTE du token admin/CRM ('intralys_token') ET du token
// membre ('intralys_member_token') — l'auth portail est strictement séparée.
const PORTAL_TOKEN_KEY = 'intralys_portal_token';

function readPortalToken(): string {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(PORTAL_TOKEN_KEY) || ''
      : '';
  } catch {
    return '';
  }
}

// Date courte localisée (factures/devis/RDV/documents).
function fmtDate(value?: string | number | null): string {
  if (value == null || value === '') return '';
  return formatDate(value, getLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Montant cents → devise localisée. Source = backend (LECTURE SEULE).
function fmtMoney(cents?: number | null, currency?: string | null): string {
  if (typeof cents !== 'number') return '—';
  try {
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: currency || 'CAD',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || 'CAD'}`;
  }
}

const spinner = (
  <div className="flex justify-center py-6">
    <div
      className="portal-spinner"
      style={{
        width: 28,
        height: 28,
        border: '3px solid color-mix(in srgb, var(--primary) 20%, transparent)',
        borderTopColor: 'var(--primary)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  </div>
);

type PortalTab =
  | 'invoices'
  | 'quotes'
  | 'appointments'
  | 'documents'
  | 'tickets';

export function PortalSpacePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  // Token portail SÉPARÉ (clé localStorage distincte du token admin/membre).
  const [portalToken, setPortalToken] = useState<string>(() =>
    readPortalToken(),
  );

  // Écran auth portail : connexion vs activation (set-password sur invitation).
  const [mode, setMode] = useState<'login' | 'set'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  // Onglet 360 actif.
  const [tab, setTab] = useState<PortalTab>('invoices');

  // Données 360 (chargées à la demande par onglet).
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [quotes, setQuotes] = useState<PortalQuote[]>([]);
  const [appointments, setAppointments] = useState<PortalAppointment[]>([]);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [tickets, setTickets] = useState<PortalTicket[]>([]);

  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  // Création de ticket.
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketBody, setTicketBody] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);

  const persistToken = useCallback((token: string) => {
    try {
      if (token) window.localStorage.setItem(PORTAL_TOKEN_KEY, token);
      else window.localStorage.removeItem(PORTAL_TOKEN_KEY);
    } catch {
      /* best-effort — localStorage indisponible (mode privé) */
    }
    setPortalToken(token);
  }, []);

  // ── Auth portail (login / set-password) — token portail stocké à part ────
  const handleAuth = useCallback(async () => {
    if (authBusy) return;
    if (!email.trim() || !password.trim()) {
      setAuthError(t('portal.login.required_fields'));
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    const payload = { email: email.trim(), password };
    const res =
      mode === 'set'
        ? await portalSetPassword(slug, payload)
        : await portalLogin(slug, payload);
    setAuthBusy(false);
    // Discrimination erreur : absence `data` / champ `error` — JAMAIS de `code`.
    if (res.error || !res.data) {
      setAuthError(res.error || t('portal.login.error'));
      return;
    }
    persistToken(res.data.token);
    setPassword('');
  }, [authBusy, email, password, mode, slug, persistToken]);

  // ── Chargement de l'onglet actif (token portail EXPLICITE) ───────────────
  const loadTab = useCallback(() => {
    if (!slug || !portalToken) return;
    let alive = true;
    setLoading(true);
    setDataError('');

    const handle = <T,>(res: { data?: T; error?: string }, set: (v: T) => void) => {
      if (!alive) return;
      if (res.error || res.data == null) {
        // Token portail invalide/expiré → purge + retour login.
        if (res.error) persistToken('');
        setDataError(res.error || t('portal.login.error'));
        return;
      }
      set(res.data);
    };

    const done = () => {
      if (alive) setLoading(false);
    };

    switch (tab) {
      case 'invoices':
        getPortalInvoices(slug, portalToken)
          .then((r) => handle(r, setInvoices))
          .finally(done);
        break;
      case 'quotes':
        getPortalQuotes(slug, portalToken)
          .then((r) => handle(r, setQuotes))
          .finally(done);
        break;
      case 'appointments':
        getPortalAppointments(slug, portalToken)
          .then((r) => handle(r, setAppointments))
          .finally(done);
        break;
      case 'documents':
        getPortalDocuments(slug, portalToken)
          .then((r) => handle(r, setDocuments))
          .finally(done);
        break;
      case 'tickets':
        getPortalTickets(slug, portalToken)
          .then((r) => handle(r, setTickets))
          .finally(done);
        break;
    }

    return () => {
      alive = false;
    };
  }, [slug, portalToken, tab, persistToken]);

  useEffect(() => {
    const cleanup = loadTab();
    return cleanup;
  }, [loadTab]);

  // ── Logout portail — purge UNIQUEMENT le token portail ───────────────────
  const handleLogout = useCallback(async () => {
    if (portalToken) {
      void portalLogout(slug, portalToken);
    }
    persistToken('');
    setInvoices([]);
    setQuotes([]);
    setAppointments([]);
    setDocuments([]);
    setTickets([]);
  }, [portalToken, slug, persistToken]);

  // ── Création d'un ticket support ─────────────────────────────────────────
  const handleCreateTicket = useCallback(async () => {
    const subject = ticketSubject.trim();
    const body = ticketBody.trim();
    if (!subject || !body || ticketBusy) return;
    setTicketBusy(true);
    const res = await createPortalTicket(slug, portalToken, { subject, body });
    setTicketBusy(false);
    if (res.error || !res.data) {
      setDataError(res.error || t('portal.login.error'));
      return;
    }
    setTicketSubject('');
    setTicketBody('');
    setNewTicketOpen(false);
    loadTab();
  }, [ticketSubject, ticketBody, ticketBusy, slug, portalToken, loadTab]);

  const labelClasses =
    'mb-1 block text-sm font-medium text-[var(--text-secondary)]';
  const inputClasses =
    'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';

  // ── Écran auth (pas de token portail) ────────────────────────────────────
  if (!portalToken) {
    return (
      <div className="min-h-screen bg-[var(--bg-surface)] p-4 flex justify-center items-start">
        <div className="w-full max-w-sm p-6" data-portal-slug={slug}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            {t('portal.login.title')}
          </h1>
          <p
            className="text-sm"
            style={{ color: 'var(--text-muted)', marginBottom: 20 }}
          >
            {mode === 'set'
              ? t('portal.login.set_password')
              : t('portal.login.subtitle')}
          </p>

          <div className="space-y-4">
            <div>
              <label className={labelClasses} htmlFor="pt-email">
                {t('portal.login.email')}
              </label>
              <input
                id="pt-email"
                type="email"
                className={inputClasses}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelClasses} htmlFor="pt-password">
                {t('portal.login.password')}
              </label>
              <input
                id="pt-password"
                type="password"
                className={inputClasses}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAuth();
                }}
                required
              />
            </div>

            {authError && (
              <p className="text-sm" style={{ color: 'var(--danger)' }}>
                {authError}
              </p>
            )}

            <button
              type="button"
              onClick={handleAuth}
              disabled={authBusy}
              className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {mode === 'set'
                ? t('portal.login.set_password_cta')
                : t('portal.login.cta')}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'set' ? 'login' : 'set');
                setAuthError('');
              }}
              className="w-full text-center text-sm text-[var(--primary)]"
            >
              {mode === 'set'
                ? t('portal.login.cta')
                : t('portal.login.set_password')}
            </button>

            <p
              className="text-center pt-2"
              style={{ fontSize: 10, color: 'var(--text-muted)' }}
            >
              Propulsé par <strong>Intralys</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard 360 (token portail valide) ─────────────────────────────────
  const tabs: { key: PortalTab; label: string }[] = [
    { key: 'invoices', label: t('portal.nav.invoices') },
    { key: 'quotes', label: t('portal.nav.quotes') },
    { key: 'appointments', label: t('portal.nav.appointments') },
    { key: 'documents', label: t('portal.nav.documents') },
    { key: 'tickets', label: t('portal.nav.tickets') },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] p-4 flex justify-center items-start">
      <div className="w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            {t('portal.login.title')}
          </h1>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-[var(--primary)]"
          >
            {t('portal.login.logout')}
          </button>
        </div>

        {/* ── Onglets nav 360 ────────────────────────────────────────────── */}
        <div className="portal-tabs mb-5 flex gap-1 flex-wrap">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => {
                setTab(tb.key);
                setDataError('');
              }}
              className={`portal-tab text-sm ${tab === tb.key ? 'portal-tab--active' : ''}`}
              aria-pressed={tab === tb.key}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {loading ? (
          spinner
        ) : dataError ? (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {dataError}
          </p>
        ) : (
          <>
            {/* ── Factures — LECTURE SEULE (aucun bouton de paiement, E4) ─── */}
            {tab === 'invoices' &&
              (invoices.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('portal.empty.invoices')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {invoices.map((inv) => (
                    <li
                      key={inv.id}
                      className="rounded-lg border border-[var(--border)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {inv.number || inv.id}
                        </span>
                        <span className="text-sm font-semibold">
                          {fmtMoney(inv.total_cents, inv.currency)}
                        </span>
                      </div>
                      <div
                        className="mt-1 flex items-center justify-between text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <span>
                          {inv.status ? `${t('portal.invoices.status')} : ${inv.status}` : ''}
                        </span>
                        <span>
                          {inv.issued_at
                            ? `${t('portal.invoices.issued')} ${fmtDate(inv.issued_at)}`
                            : inv.due_at
                              ? `${t('portal.invoices.due')} ${fmtDate(inv.due_at)}`
                              : ''}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ))}

            {/* ── Devis ──────────────────────────────────────────────────── */}
            {tab === 'quotes' &&
              (quotes.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('portal.empty.quotes')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {quotes.map((q) => (
                    <li
                      key={q.id}
                      className="rounded-lg border border-[var(--border)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {q.number || q.id}
                        </span>
                        <span className="text-sm font-semibold">
                          {fmtMoney(q.total_cents, q.currency)}
                        </span>
                      </div>
                      <div
                        className="mt-1 flex items-center justify-between text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <span>
                          {q.status ? `${t('portal.quotes.status')} : ${q.status}` : ''}
                        </span>
                        <span>{fmtDate(q.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ))}

            {/* ── Rendez-vous (+ demander un RDV → booking public du slug) ── */}
            {tab === 'appointments' && (
              <>
                <div className="mb-4 flex justify-end">
                  <a
                    href={`/book/${slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--primary)] hover:border-[var(--primary)]"
                  >
                    {t('portal.appointments.request')}
                  </a>
                </div>
                {appointments.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {t('portal.empty.appointments')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {appointments.map((ap) => (
                      <li
                        key={ap.id}
                        className="rounded-lg border border-[var(--border)] p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {ap.title || t('portal.nav.appointments')}
                          </span>
                          {ap.status && (
                            <span
                              className="text-xs"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {ap.status}
                            </span>
                          )}
                        </div>
                        <p
                          className="mt-1 text-xs"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {fmtDate(ap.start_at)}
                          {ap.end_at ? ` → ${fmtDate(ap.end_at)}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {/* ── Documents (statut + lien signer si status=sent) ────────── */}
            {tab === 'documents' &&
              (documents.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('portal.empty.documents')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {documents.map((doc) => {
                    // Le backend (Manager-B) expose un `sign_url=/sign/:token`
                    // additif quand status ∈ {sent,viewed} — flux de signature
                    // par TOKEN existant. Le type figé Phase A ne le déclare pas,
                    // on le lit défensivement (jamais fabriqué côté front).
                    const signUrl = (doc as { sign_url?: string | null }).sign_url;
                    return (
                    <li
                      key={doc.id}
                      className="rounded-lg border border-[var(--border)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {doc.name || doc.id}
                        </span>
                        {signUrl &&
                        (doc.status === 'sent' || doc.status === 'viewed') ? (
                          <a
                            href={signUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-[var(--primary)]"
                          >
                            {t('portal.documents.sign')}
                          </a>
                        ) : (
                          <span
                            className="text-xs"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {doc.status}
                          </span>
                        )}
                      </div>
                      {doc.signed_at && (
                        <p
                          className="mt-1 text-xs"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {t('portal.documents.signed')} {fmtDate(doc.signed_at)}
                        </p>
                      )}
                    </li>
                    );
                  })}
                </ul>
              ))}

            {/* ── Tickets (liste + nouveau ticket) ───────────────────────── */}
            {tab === 'tickets' && (
              <>
                <div className="mb-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setNewTicketOpen((v) => !v)}
                    className="inline-flex items-center rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white"
                  >
                    {t('portal.tickets.new')}
                  </button>
                </div>

                {newTicketOpen && (
                  <div className="mb-5 rounded-lg border border-[var(--border)] p-4 space-y-3">
                    <div>
                      <label className={labelClasses} htmlFor="pt-subject">
                        {t('portal.tickets.subject')}
                      </label>
                      <input
                        id="pt-subject"
                        type="text"
                        className={inputClasses}
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClasses} htmlFor="pt-body">
                        {t('portal.tickets.body')}
                      </label>
                      <textarea
                        id="pt-body"
                        rows={3}
                        className={inputClasses}
                        value={ticketBody}
                        onChange={(e) => setTicketBody(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateTicket}
                      disabled={
                        ticketBusy || !ticketSubject.trim() || !ticketBody.trim()
                      }
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {t('portal.tickets.send')}
                    </button>
                  </div>
                )}

                {tickets.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {t('portal.empty.tickets')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tickets.map((tk) => (
                      <li
                        key={tk.id}
                        className="rounded-lg border border-[var(--border)] p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {tk.subject || tk.id}
                          </span>
                          {tk.status && (
                            <span
                              className="text-xs"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {tk.status}
                            </span>
                          )}
                        </div>
                        {tk.created_at != null && tk.created_at !== '' && (
                          <p
                            className="mt-1 text-xs"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {fmtDate(tk.created_at)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}

        <p
          className="text-center pt-6"
          style={{ fontSize: 10, color: 'var(--text-muted)' }}
        >
          Propulsé par <strong>Intralys</strong>
        </p>
      </div>
    </div>
  );
}
