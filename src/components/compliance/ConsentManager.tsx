// ── ConsentManager — Loi 25 : journal de consentement + statut cookies ───────
// Surface les fonctions API jusqu'ici invisibles : getConsent / logConsent /
// getCookieConsent. 100 % additif — aucune modification d'api.ts ni des
// catalogues i18n (toutes les NOUVELLES clés sont sous le namespace `consentx.*`).
import { useState, useEffect, useCallback } from 'react';
import { getConsent, logConsent, getCookieConsent } from '@/lib/api';
import { t } from '@/lib/i18n';
import {
  Card,
  Button,
  Input,
  Select,
  Switch,
  Tag,
  Badge,
  EmptyState,
  useToast,
  Icon,
} from '@/components/ui';
import { FileCheck, Cookie, ClipboardList, ShieldCheck } from 'lucide-react';

/** Une entrée du journal de consentement (forme libre côté worker). */
type ConsentEntry = Record<string, unknown>;

const CONSENT_TYPES = ['email', 'sms', 'marketing', 'profiling'] as const;

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function isGranted(entry: ConsentEntry): boolean {
  const g = entry.granted ?? entry.consent_granted;
  return g === true || g === 1 || g === '1';
}

export function ConsentManager() {
  const { success, error: toastError } = useToast();

  // ── Journal de consentement d'un lead (getConsent) ──────────────────────
  const [leadId, setLeadId] = useState('');
  const [queryLeadId, setQueryLeadId] = useState('');
  const [entries, setEntries] = useState<ConsentEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);

  // ── Enregistrement d'un consentement (logConsent) ───────────────────────
  const [consentType, setConsentType] = useState<string>(CONSENT_TYPES[0]);
  const [granted, setGranted] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Statut cookies de l'utilisateur courant (getCookieConsent) ──────────
  const [cookieLoading, setCookieLoading] = useState(true);
  const [cookieError, setCookieError] = useState(false);
  const [cookieCategories, setCookieCategories] = useState<Record<string, boolean> | null>(null);
  const [cookieMeta, setCookieMeta] = useState<{ version: string; grantedAt: string } | null>(null);

  const loadCookie = useCallback(() => {
    let cancelled = false;
    setCookieError(false);
    setCookieLoading(true);
    getCookieConsent()
      .then((res) => {
        if (cancelled) return;
        const rec = res.data;
        if (rec) {
          setCookieCategories(rec.categories as unknown as Record<string, boolean>);
          setCookieMeta({ version: rec.policy_version, grantedAt: rec.granted_at });
        } else {
          setCookieCategories(null);
          setCookieMeta(null);
        }
      })
      .catch(() => {
        if (!cancelled) setCookieError(true);
      })
      .finally(() => {
        if (!cancelled) setCookieLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadCookie(), [loadCookie]);

  // Recharge le journal quand un lead est interrogé.
  useEffect(() => {
    if (!queryLeadId) return;
    let cancelled = false;
    setLogError(false);
    setLogLoading(true);
    setHasQueried(true);
    getConsent(queryLeadId)
      .then((res) => {
        if (!cancelled) setEntries(res.data || []);
      })
      .catch(() => {
        if (!cancelled) setLogError(true);
      })
      .finally(() => {
        if (!cancelled) setLogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryLeadId]);

  const handleLookup = () => {
    const id = leadId.trim();
    if (!id) {
      toastError(t('consentx.toast_lead_required'));
      return;
    }
    setQueryLeadId(id);
  };

  const handleRecord = async () => {
    const id = leadId.trim();
    if (!id) {
      toastError(t('consentx.toast_lead_required'));
      return;
    }
    setSaving(true);
    try {
      await logConsent({ lead_id: id, consent_type: consentType, granted });
      success(t('consentx.toast_recorded'));
      // Rafraîchit le journal pour ce lead.
      setQueryLeadId('');
      setQueryLeadId(id);
    } catch (err: any) {
      toastError(err?.message || t('consentx.toast_record_error'));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6" data-testid="consent-manager">
      {/* ── Statut cookies (Loi 25) ───────────────────────────────────── */}
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
            <Icon as={Cookie} size="md" className="text-[var(--primary)]" />
            {t('consentx.cookie_title')}
          </h3>
          <p className="t-caption text-[var(--gray-500)]">{t('consentx.cookie_subtitle')}</p>
        </header>

        {cookieLoading ? (
          <div
            className="p-6 text-center text-sm text-[var(--text-muted)]"
            aria-busy="true"
            data-testid="consent-cookie-loading"
          >
            {t('consentx.loading')}
          </div>
        ) : cookieError ? (
          <div
            role="alert"
            className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,rgba(239,68,68,0.08))] p-4 flex items-center justify-between gap-3"
            data-testid="consent-cookie-error"
          >
            <p className="text-sm text-[var(--danger)] flex-1">{t('consentx.cookie_error')}</p>
            <Button variant="secondary" size="sm" onClick={() => loadCookie()}>
              {t('consentx.retry')}
            </Button>
          </div>
        ) : !cookieCategories ? (
          <EmptyState
            variant="compact"
            icon={<Cookie size={28} />}
            title={t('consentx.cookie_empty_title')}
            description={t('consentx.cookie_empty_desc')}
          />
        ) : (
          <div className="space-y-3" data-testid="consent-cookie-status">
            <div className="flex flex-wrap gap-2">
              {Object.entries(cookieCategories).map(([cat, on]) => (
                <Tag key={cat} variant={on ? 'success' : 'neutral'} dot>
                  {cat}
                </Tag>
              ))}
            </div>
            {cookieMeta && (
              <p className="text-[11px] text-[var(--text-muted)]">
                {t('consentx.cookie_meta')
                  .replace('{version}', cookieMeta.version)
                  .replace('{date}', new Date(cookieMeta.grantedAt).toLocaleString())}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── Journal de consentement par lead (getConsent + logConsent) ── */}
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
            <Icon as={ClipboardList} size="md" className="text-[var(--primary)]" />
            {t('consentx.log_title')}
          </h3>
          <p className="t-caption text-[var(--gray-500)]">{t('consentx.log_subtitle')}</p>
        </header>

        <div className="settings-form-row settings-form-row--full">
          <label className="settings-label" htmlFor="consent-lead-id">
            {t('consentx.lead_label')}
          </label>
          <div className="flex items-end gap-2">
            <Input
              id="consent-lead-id"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              placeholder={t('consentx.lead_placeholder')}
              containerClassName="flex-1"
              data-testid="consent-lead-input"
            />
            <Button
              variant="secondary"
              onClick={handleLookup}
              data-testid="consent-lookup"
            >
              {t('consentx.lookup')}
            </Button>
          </div>
          <p className="settings-helper">{t('consentx.lead_helper')}</p>
        </div>

        {/* Enregistrement d'un nouveau consentement */}
        <div
          className="settings-toggle-row"
          role="group"
          aria-label={t('consentx.record_aria')}
          data-testid="consent-record-group"
        >
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">{t('consentx.record_title')}</p>
            <p className="settings-toggle-row__desc">{t('consentx.record_desc')}</p>
          </div>
          <Switch checked={granted} onCheckedChange={setGranted} variant="brand" />
        </div>

        <div className="settings-form-row settings-form-row--full">
          <Select
            label={t('consentx.type_label')}
            value={consentType}
            onChange={(e) => setConsentType(e.target.value)}
            data-testid="consent-type-select"
          >
            {CONSENT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t(`consentx.type_${ct}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="settings-actions">
          <Button
            onClick={handleRecord}
            disabled={saving || !leadId.trim()}
            isLoading={saving}
            aria-busy={saving}
            leftIcon={<Icon as={ShieldCheck} size="sm" />}
            data-testid="consent-record-save"
          >
            {t('consentx.record_save')}
          </Button>
        </div>

        {/* Résultat du journal */}
        <div className="mt-2">
          {logLoading ? (
            <div
              className="p-6 text-center text-sm text-[var(--text-muted)]"
              aria-busy="true"
              data-testid="consent-log-loading"
            >
              {t('consentx.loading')}
            </div>
          ) : logError ? (
            <div
              role="alert"
              className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,rgba(239,68,68,0.08))] p-4 flex items-center justify-between gap-3"
              data-testid="consent-log-error"
            >
              <p className="text-sm text-[var(--danger)] flex-1">{t('consentx.log_error')}</p>
              <Button variant="secondary" size="sm" onClick={() => setQueryLeadId((id) => id)}>
                {t('consentx.retry')}
              </Button>
            </div>
          ) : !hasQueried ? (
            <EmptyState
              variant="compact"
              icon={<FileCheck size={28} />}
              title={t('consentx.log_prompt_title')}
              description={t('consentx.log_prompt_desc')}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<FileCheck size={28} />}
              title={t('consentx.log_empty_title')}
              description={t('consentx.log_empty_desc')}
            />
          ) : (
            <div className="space-y-2.5" data-testid="consent-log-list">
              {entries.map((entry, idx) => {
                const ct = asString(entry.consent_type ?? entry.type);
                const when = asString(entry.created_at ?? entry.logged_at ?? entry.granted_at);
                const ok = isGranted(entry);
                return (
                  <div
                    key={asString(entry.id) || idx}
                    className="row-premium flex items-center gap-3 p-3 rounded-xl"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {ct || t('consentx.type_unknown')}
                      </p>
                      {when && (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {new Date(when).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <Badge intent={ok ? 'success' : 'danger'}>
                      {ok ? t('consentx.granted') : t('consentx.revoked')}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
