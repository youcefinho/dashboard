// ── StoreConfigSettings — config boutique / business / paiement ─────────────
//
// Composant ADDITIF (enfant de PortalSettings) qui rend VISIBLE une config PRO
// jusqu'ici invisible côté portail, via les helpers FIGÉS de @/lib/api :
//   getStoreSettings()                          → ApiResponse<StoreSettings>
//   saveStoreSettings(payload: Partial<...>)    → ApiResponse<StoreSettings>
//   updateClientBusinessConfig(clientId, cfg)   → ApiResponse<{ success }>
//   getPaymentConfig()                          → ApiResponse<PaymentConfigState>
//   updatePaymentConfig(next)                   → ApiResponse<PaymentConfigState>
//
// On NE touche PAS api.ts / i18n / App.tsx. Toutes les chaînes via t('storecfg.*')
// (clés NOUVELLES — à ajouter aux catalogues). Pattern calqué sur
// CurrencySettings.tsx : useToast, loading skeleton (aria-busy / role=status),
// erreur role=alert, succès via toast, validation côté UI uniquement.
//
// ⚠ Particularités contractuelles :
//   - La business config (business_type / brand_voice / scoring_prompt_extra) est
//     WRITE-ONLY : le type Client ne l'expose pas en lecture → champs vides au
//     départ, on PATCH le client choisi. Liste via getClients() (helper figé).
//   - Le paiement est piloté SERVEUR (M1 n'expose pas d'endpoint config) :
//     getPaymentConfig renvoie read_only=true et updatePaymentConfig renvoie une
//     erreur explicite. L'UI le présente en LECTURE SEULE + message serveur.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Store, Briefcase, CreditCard, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Skeleton } from '../ui/Skeleton';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  getStoreSettings,
  saveStoreSettings,
  updateClientBusinessConfig,
  getPaymentConfig,
  updatePaymentConfig,
  getClients,
  type PaymentConfigState,
} from '../../lib/api';
import type { Client } from '../../lib/types';

// Devises proposées (alignées CurrencySettings — affichage seul, le worker
// reste source de vérité). Liste figée côté UI, pas d'appel réseau.
const CURRENCY_OPTIONS = ['CAD', 'USD', 'EUR', 'DZD', 'MAD'] as const;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function StoreConfigSettings() {
  const { success, error: toastError } = useToast();

  // ── Chargement global (store + payment + clients) ─────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Store settings.
  const [storeName, setStoreName] = useState('');
  const [storeSlug, setStoreSlug] = useState('');
  const [storeCurrency, setStoreCurrency] = useState<string>('CAD');
  const [storeEnabled, setStoreEnabled] = useState(false);
  const [savingStore, setSavingStore] = useState(false);

  // Business config (write-only) — client choisi + champs.
  const [clients, setClients] = useState<Client[]>([]);
  const [bizClientId, setBizClientId] = useState('');
  const [bizType, setBizType] = useState('');
  const [bizVoice, setBizVoice] = useState('');
  const [bizScoring, setBizScoring] = useState('');
  const [savingBiz, setSavingBiz] = useState(false);

  // Payment config (lecture seule pilotée serveur).
  const [payment, setPayment] = useState<PaymentConfigState | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [storeRes, payRes, clientsRes] = await Promise.all([
      getStoreSettings(),
      getPaymentConfig(),
      getClients(),
    ]);

    if (storeRes.data) {
      setStoreName(storeRes.data.name ?? '');
      setStoreSlug(storeRes.data.slug ?? '');
      setStoreCurrency(storeRes.data.currency || 'CAD');
      setStoreEnabled(Boolean(storeRes.data.enabled));
    }
    if (payRes.data) setPayment(payRes.data);
    if (clientsRes.data) setClients(clientsRes.data);

    // Erreur globale uniquement si les 3 sources ont échoué (aucune `data`).
    if (!storeRes.data && !payRes.data && !clientsRes.data) {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Validation store ──────────────────────────────────────────────────────
  const slugTrim = storeSlug.trim();
  const nameTrim = storeName.trim();
  const slugInvalid = slugTrim.length > 0 && !SLUG_RE.test(slugTrim);
  const storeValid = nameTrim.length > 0 && slugTrim.length > 0 && !slugInvalid;

  const handleSaveStore = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!storeValid) {
        toastError(t('storecfg.store.invalid'));
        return;
      }
      setSavingStore(true);
      const res = await saveStoreSettings({
        name: nameTrim,
        slug: slugTrim,
        currency: storeCurrency,
        enabled: storeEnabled,
      });
      setSavingStore(false);
      if (res.error || !res.data) {
        toastError(res.error || t('storecfg.store.save_error'));
        return;
      }
      // Re-synchronise à partir de la réponse serveur (source de vérité).
      setStoreName(res.data.name ?? '');
      setStoreSlug(res.data.slug ?? '');
      setStoreCurrency(res.data.currency || 'CAD');
      setStoreEnabled(Boolean(res.data.enabled));
      success(t('storecfg.store.saved'));
    },
    [storeValid, nameTrim, slugTrim, storeCurrency, storeEnabled, success, toastError],
  );

  // ── Business config ────────────────────────────────────────────────────────
  const bizHasInput =
    bizType.trim().length > 0 ||
    bizVoice.trim().length > 0 ||
    bizScoring.trim().length > 0;
  const bizValid = bizClientId.length > 0 && bizHasInput;

  const handleSaveBiz = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!bizValid) {
        toastError(t('storecfg.biz.invalid'));
        return;
      }
      setSavingBiz(true);
      const res = await updateClientBusinessConfig(bizClientId, {
        business_type: bizType.trim() || undefined,
        brand_voice: bizVoice.trim() || undefined,
        scoring_prompt_extra: bizScoring.trim() || undefined,
      });
      setSavingBiz(false);
      if (res.error || !res.data?.success) {
        toastError(res.error || t('storecfg.biz.save_error'));
        return;
      }
      success(t('storecfg.biz.saved'));
    },
    [bizValid, bizClientId, bizType, bizVoice, bizScoring, success, toastError],
  );

  // ── Payment config (lecture seule — pilotée serveur) ────────────────────────
  // Le toggle « live » est désactivé si read_only ; toute tentative passe par
  // updatePaymentConfig qui renvoie l'erreur serveur explicite (jamais forgée).
  const handleToggleLive = useCallback(
    async (next: boolean) => {
      if (!payment || payment.read_only) {
        // Surface le contrat serveur sans muter l'état local.
        const res = await updatePaymentConfig({ payments_live_enabled: next });
        toastError(res.error || t('storecfg.pay.server_managed'));
        return;
      }
      setPaymentBusy(true);
      const res = await updatePaymentConfig({ payments_live_enabled: next });
      setPaymentBusy(false);
      if (res.error || !res.data) {
        toastError(res.error || t('storecfg.pay.save_error'));
        return;
      }
      setPayment(res.data);
      success(t('storecfg.pay.saved'));
    },
    [payment, success, toastError],
  );

  // ── Erreur globale de chargement ────────────────────────────────────────────
  if (loadError && !loading) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm"
        data-testid="storecfg-load-error"
      >
        <p className="font-medium text-[var(--danger)]">
          {t('storecfg.load_error')}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => void load()}
        >
          {t('storecfg.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="space-y-8"
      aria-busy={loading ? 'true' : 'false'}
      data-testid="storecfg"
    >
      {/* ── Section 1 — Réglages boutique ──────────────────────────────────── */}
      <section aria-labelledby="storecfg-store-heading" data-testid="storecfg-store">
        <header className="mb-3 flex items-center gap-2">
          <Icon as={Store} size="sm" className="text-[var(--text-muted)]" />
          <div>
            <h3 id="storecfg-store-heading" className="t-h3">
              {t('storecfg.store.title')}
            </h3>
            <p className="t-caption text-[var(--text-muted)]">
              {t('storecfg.store.desc')}
            </p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">{t('storecfg.loading')}</span>
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSaveStore(e)}
            className="rounded-xl border border-[var(--border-subtle)] bg-white p-4 space-y-4"
            data-testid="storecfg-store-form"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                id="storecfg-store-name"
                label={t('storecfg.store.name')}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
                disabled={savingStore}
              />
              <Input
                id="storecfg-store-slug"
                label={t('storecfg.store.slug')}
                value={storeSlug}
                onChange={(e) => setStoreSlug(e.target.value)}
                helper={t('storecfg.store.slug_hint')}
                error={slugInvalid ? t('storecfg.store.slug_invalid') : undefined}
                disabled={savingStore}
              />
            </div>
            <Select
              id="storecfg-store-currency"
              label={t('storecfg.store.currency')}
              value={storeCurrency}
              onChange={(e) => setStoreCurrency(e.target.value)}
              disabled={savingStore}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Switch
              checked={storeEnabled}
              onCheckedChange={setStoreEnabled}
              disabled={savingStore}
              label={t('storecfg.store.enabled')}
              description={t('storecfg.store.enabled_desc')}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                leftIcon={<Icon as={Save} size="sm" />}
                isLoading={savingStore}
                disabled={savingStore || !storeValid}
                data-testid="storecfg-store-save"
              >
                {t('storecfg.store.save')}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* ── Section 2 — Config métier (client) ─────────────────────────────── */}
      <section aria-labelledby="storecfg-biz-heading" data-testid="storecfg-biz">
        <header className="mb-3 flex items-center gap-2">
          <Icon as={Briefcase} size="sm" className="text-[var(--text-muted)]" />
          <div>
            <h3 id="storecfg-biz-heading" className="t-h3">
              {t('storecfg.biz.title')}
            </h3>
            <p className="t-caption text-[var(--text-muted)]">
              {t('storecfg.biz.desc')}
            </p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">{t('storecfg.loading')}</span>
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSaveBiz(e)}
            className="rounded-xl border border-[var(--border-subtle)] bg-white p-4 space-y-4"
            data-testid="storecfg-biz-form"
          >
            <Select
              id="storecfg-biz-client"
              label={t('storecfg.biz.client')}
              value={bizClientId}
              onChange={(e) => setBizClientId(e.target.value)}
              helper={t('storecfg.biz.client_hint')}
              disabled={savingBiz || clients.length === 0}
            >
              <option value="">{t('storecfg.biz.client_placeholder')}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.email || c.id}
                </option>
              ))}
            </Select>
            <Input
              id="storecfg-biz-type"
              label={t('storecfg.biz.type')}
              value={bizType}
              onChange={(e) => setBizType(e.target.value)}
              helper={t('storecfg.biz.type_hint')}
              disabled={savingBiz}
            />
            <Input
              id="storecfg-biz-voice"
              label={t('storecfg.biz.voice')}
              value={bizVoice}
              onChange={(e) => setBizVoice(e.target.value)}
              helper={t('storecfg.biz.voice_hint')}
              disabled={savingBiz}
            />
            <Textarea
              id="storecfg-biz-scoring"
              label={t('storecfg.biz.scoring')}
              value={bizScoring}
              onChange={(e) => setBizScoring(e.target.value)}
              helper={t('storecfg.biz.scoring_hint')}
              maxLength={2000}
              showCounter
              disabled={savingBiz}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                leftIcon={<Icon as={Save} size="sm" />}
                isLoading={savingBiz}
                disabled={savingBiz || !bizValid}
                data-testid="storecfg-biz-save"
              >
                {t('storecfg.biz.save')}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* ── Section 3 — Paiement (lecture seule, serveur) ──────────────────── */}
      <section aria-labelledby="storecfg-pay-heading" data-testid="storecfg-pay">
        <header className="mb-3 flex items-center gap-2">
          <Icon as={CreditCard} size="sm" className="text-[var(--text-muted)]" />
          <div>
            <h3 id="storecfg-pay-heading" className="t-h3">
              {t('storecfg.pay.title')}
            </h3>
            <p className="t-caption text-[var(--text-muted)]">
              {t('storecfg.pay.desc')}
            </p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">{t('storecfg.loading')}</span>
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : !payment ? (
          <p className="text-sm text-[var(--text-muted)]">
            {t('storecfg.pay.unavailable')}
          </p>
        ) : (
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-white p-4 space-y-4"
            data-testid="storecfg-pay-card"
          >
            {payment.read_only && (
              <p
                role="note"
                className="rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]"
              >
                {t('storecfg.pay.server_managed')}
              </p>
            )}
            <Switch
              checked={payment.payments_live_enabled}
              onCheckedChange={(next) => void handleToggleLive(next)}
              disabled={payment.read_only || paymentBusy}
              variant={payment.payments_live_enabled ? 'success' : 'brand'}
              label={t('storecfg.pay.live')}
              description={t('storecfg.pay.live_desc')}
            />
            <ul className="divide-y divide-[var(--border-subtle)]">
              {payment.providers.map((p) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between py-2 text-sm"
                  data-testid={`storecfg-pay-provider-${p.provider}`}
                >
                  <span className="font-medium text-[var(--text-primary)]">
                    {t(`storecfg.pay.provider_${p.provider}`)}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      className={
                        p.enabled
                          ? 'text-[var(--success)]'
                          : 'text-[var(--text-muted)]'
                      }
                    >
                      {p.enabled
                        ? t('storecfg.pay.on')
                        : t('storecfg.pay.off')}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {p.mode === 'live'
                        ? t('storecfg.pay.mode_live')
                        : t('storecfg.pay.mode_test')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

export default StoreConfigSettings;
