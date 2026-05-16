// ── Settings — Expédition (zones & tarifs) — Sprint E5 M3.2 ─────────────────
// Page Réglages admin (groupe AVANCÉ) : CRUD zones d'expédition (nom + pays
// ISO multi-sélection) et CRUD tarifs par zone (nom, prix en cents, palier
// optionnel min/max sous-total panier). Wirée endpoints M2
// (/api/ecommerce/shipping/zones · /zones/:id/rates · /rates/:id). Money
// TOUJOURS en cents INTEGER (saisie en $ → conversion ×100).
//
// Clone structure RegionSettings/PaymentSettings (Card settings-card,
// settings-section-header, AutosaveIndicator, Skeleton). Stripe SUBTLE, FR
// québécois, a11y focus-visible + aria, reduced-motion. Aucune donnée fictive.

import { useEffect, useState } from 'react';
import {
  Card, Button, Input, Tag, AutosaveIndicator, useToast, useConfirm,
  Icon, Skeleton, type AutosaveState,
} from '@/components/ui';
import {
  listShippingZones, createShippingZone, updateShippingZone,
  deleteShippingZone, listShippingRates, createShippingRate,
  updateShippingRate, deleteShippingRate,
  type ShippingZonePayload, type ShippingRatePayload,
} from '@/lib/api';
import type { ShippingZone, ShippingRate } from '@/lib/types';
import { t } from '@/lib/i18n';
import { Truck, Plus, Trash2, MapPin } from 'lucide-react';

// Pays ISO alpha-2 fréquents (aligné régions E-R : QC / EU / DZ).
const COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'CA', label: 'Canada' },
  { code: 'US', label: 'États-Unis' },
  { code: 'FR', label: 'France' },
  { code: 'BE', label: 'Belgique' },
  { code: 'DE', label: 'Allemagne' },
  { code: 'ES', label: 'Espagne' },
  { code: 'IT', label: 'Italie' },
  { code: 'DZ', label: 'Algérie' },
];

function dollarsToCents(v: string): number {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}
function centsToDollars(c: number | null | undefined): string {
  if (c === null || c === undefined) return '';
  return (c / 100).toFixed(2);
}

export function ShippingSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [ratesByZone, setRatesByZone] = useState<Record<string, ShippingRate[]>>({});
  const [loading, setLoading] = useState(true);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulaire nouvelle zone
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneCountries, setNewZoneCountries] = useState<string[]>([]);

  // Formulaire nouveau tarif (par zone ouverte)
  const [rateForm, setRateForm] = useState<
    Record<string, { name: string; price: string; min: string; max: string }>
  >({});

  const loadZones = async () => {
    setLoading(true);
    try {
      const res = await listShippingZones();
      const zs = res.data || [];
      setZones(zs);
      // Charge les tarifs de chaque zone en parallèle.
      const entries = await Promise.all(
        zs.map(async (z) => {
          try {
            const r = await listShippingRates(z.id);
            return [z.id, r.data || []] as const;
          } catch {
            return [z.id, [] as ShippingRate[]] as const;
          }
        }),
      );
      setRatesByZone(Object.fromEntries(entries));
    } catch {
      toastError(t('shop.shipping.load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSaved = () => {
    setAutosave('saved');
    setLastSaved(new Date());
  };

  const toggleCountry = (code: string) => {
    setNewZoneCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleCreateZone = async () => {
    if (!newZoneName.trim() || newZoneCountries.length === 0) {
      toastError(t('shop.shipping.zone_invalid'));
      return;
    }
    setBusy(true);
    setAutosave('saving');
    try {
      const payload: ShippingZonePayload = {
        name: newZoneName.trim(),
        countries: newZoneCountries,
      };
      const res = await createShippingZone(payload);
      if (res.error || !res.data) throw new Error(res.error || 'fail');
      setNewZoneName('');
      setNewZoneCountries([]);
      markSaved();
      success(t('shop.shipping.zone_created'));
      await loadZones();
    } catch {
      setAutosave('error');
      toastError(t('shop.shipping.save_error'));
    } finally {
      setBusy(false);
    }
  };

  const handleRenameZone = async (zone: ShippingZone, name: string) => {
    if (!name.trim() || name === zone.name) return;
    setAutosave('saving');
    try {
      const res = await updateShippingZone(zone.id, { name: name.trim() });
      if (res.error) throw new Error(res.error);
      markSaved();
      await loadZones();
    } catch {
      setAutosave('error');
      toastError(t('shop.shipping.save_error'));
    }
  };

  const handleDeleteZone = async (zone: ShippingZone) => {
    const ok = await confirm({
      title: t('shop.shipping.delete_zone_title'),
      description: t('shop.shipping.delete_zone_desc'),
      confirmLabel: t('shop.shipping.delete'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await deleteShippingZone(zone.id);
      if (res.error) throw new Error(res.error);
      markSaved();
      success(t('shop.shipping.zone_deleted'));
      await loadZones();
    } catch {
      toastError(t('shop.shipping.save_error'));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRate = async (zoneId: string) => {
    const f = rateForm[zoneId];
    if (!f || !f.name.trim()) {
      toastError(t('shop.shipping.rate_invalid'));
      return;
    }
    setBusy(true);
    setAutosave('saving');
    try {
      const payload: ShippingRatePayload = {
        name: f.name.trim(),
        price_cents: dollarsToCents(f.price),
        min_subtotal_cents: f.min.trim() ? dollarsToCents(f.min) : null,
        max_subtotal_cents: f.max.trim() ? dollarsToCents(f.max) : null,
      };
      const res = await createShippingRate(zoneId, payload);
      if (res.error || !res.data) throw new Error(res.error || 'fail');
      setRateForm((p) => ({
        ...p,
        [zoneId]: { name: '', price: '', min: '', max: '' },
      }));
      markSaved();
      success(t('shop.shipping.rate_created'));
      await loadZones();
    } catch {
      setAutosave('error');
      toastError(t('shop.shipping.save_error'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRate = async (rate: ShippingRate) => {
    const ok = await confirm({
      title: t('shop.shipping.delete_rate_title'),
      description: t('shop.shipping.delete_rate_desc'),
      confirmLabel: t('shop.shipping.delete'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await deleteShippingRate(rate.id);
      if (res.error) throw new Error(res.error);
      markSaved();
      success(t('shop.shipping.rate_deleted'));
      await loadZones();
    } catch {
      toastError(t('shop.shipping.save_error'));
    } finally {
      setBusy(false);
    }
  };

  const rf = (zoneId: string) =>
    rateForm[zoneId] || { name: '', price: '', min: '', max: '' };
  const setRf = (
    zoneId: string,
    patch: Partial<{ name: string; price: string; min: string; max: string }>,
  ) =>
    setRateForm((p) => ({ ...p, [zoneId]: { ...rf(zoneId), ...patch } }));

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="settings-card p-6 space-y-4">
          <Skeleton className="h-5 w-44 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
          <div className="space-y-3 pt-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Truck} size={16} className="text-[var(--primary)]" />
              {t('shop.shipping.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('shop.shipping.subtitle')}
            </p>
          </div>
          <AutosaveIndicator state={autosave} lastSaved={lastSaved} />
        </header>

        {/* Nouvelle zone */}
        <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
          <h4 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3">
            {t('shop.shipping.new_zone')}
          </h4>
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="ship-zone-name"
                className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
              >
                {t('shop.shipping.zone_name')}
              </label>
              <Input
                id="ship-zone-name"
                value={newZoneName}
                onChange={(e: any) => setNewZoneName(e.target.value)}
                placeholder={t('shop.shipping.zone_name_ph')}
              />
            </div>
            <div>
              <p className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
                {t('shop.shipping.countries')}
              </p>
              <div className="flex flex-wrap gap-2">
                {COUNTRY_OPTIONS.map((c) => {
                  const on = newZoneCountries.includes(c.code);
                  return (
                    <button
                      key={c.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleCountry(c.code)}
                      className="text-[12px] px-2.5 py-1 rounded-[var(--radius-sm)] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                      style={
                        on
                          ? {
                              background: 'rgba(0,157,219,0.10)',
                              borderColor: 'rgba(0,157,219,0.45)',
                              color: 'var(--primary)',
                            }
                          : {
                              background: 'var(--bg-surface)',
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--text-secondary)',
                            }
                      }
                    >
                      {c.label} ({c.code})
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleCreateZone}
                disabled={busy}
              >
                <Icon as={Plus} size="sm" /> {t('shop.shipping.add_zone')}
              </Button>
            </div>
          </div>
        </div>

        {/* Zones existantes */}
        <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] flex flex-col gap-4">
          {zones.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">
              {t('shop.shipping.no_zones')}
            </p>
          ) : (
            zones.map((zone) => {
              const rates = ratesByZone[zone.id] || [];
              const f = rf(zone.id);
              return (
                <div
                  key={zone.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <Input
                        defaultValue={zone.name}
                        onBlur={(e: any) => handleRenameZone(zone, e.target.value)}
                        aria-label={t('shop.shipping.zone_name')}
                        className="font-semibold"
                      />
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {(zone.countries || []).map((c) => (
                          <Tag key={c} size="sm" variant="neutral">
                            <Icon as={MapPin} size="xs" aria-hidden /> {c}
                          </Tag>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      style={{ color: 'var(--danger)' }}
                      disabled={busy}
                      onClick={() => handleDeleteZone(zone)}
                      aria-label={t('shop.shipping.delete_zone_title')}
                    >
                      <Icon as={Trash2} size="sm" />
                    </Button>
                  </div>

                  {/* Tarifs de la zone */}
                  <div className="border-t border-[var(--border-subtle)] pt-3">
                    <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">
                      {t('shop.shipping.rates')}
                    </p>
                    {rates.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-muted)] mb-3">
                        {t('shop.shipping.no_rates')}
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1.5 mb-3">
                        {rates.map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center gap-2 text-[12px] bg-[var(--bg-subtle)] rounded-[var(--radius-sm)] px-3 py-2"
                          >
                            <span className="font-medium min-w-0 flex-1 truncate">
                              {r.name}
                            </span>
                            <span className="t-mono-num text-[var(--text-secondary)]">
                              {(r.price_cents / 100).toLocaleString('fr-CA', {
                                style: 'currency',
                                currency: 'CAD',
                              })}
                            </span>
                            {(r.min_subtotal_cents !== null ||
                              r.max_subtotal_cents !== null) && (
                              <span className="text-[11px] text-[var(--text-muted)]">
                                {t('shop.shipping.tier')}{' '}
                                {centsToDollars(r.min_subtotal_cents) || '0'}
                                {' – '}
                                {centsToDollars(r.max_subtotal_cents) || '∞'}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              style={{ color: 'var(--danger)' }}
                              disabled={busy}
                              onClick={() => handleDeleteRate(r)}
                              aria-label={t('shop.shipping.delete_rate_title')}
                            >
                              <Icon as={Trash2} size="xs" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Ajout tarif */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <Input
                        value={f.name}
                        onChange={(e: any) => setRf(zone.id, { name: e.target.value })}
                        placeholder={t('shop.shipping.rate_name_ph')}
                        aria-label={t('shop.shipping.rate_name')}
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={f.price}
                        onChange={(e: any) => setRf(zone.id, { price: e.target.value })}
                        placeholder={t('shop.shipping.price_ph')}
                        aria-label={t('shop.shipping.price')}
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={f.min}
                        onChange={(e: any) => setRf(zone.id, { min: e.target.value })}
                        placeholder={t('shop.shipping.min_ph')}
                        aria-label={t('shop.shipping.min_subtotal')}
                      />
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={f.max}
                        onChange={(e: any) => setRf(zone.id, { max: e.target.value })}
                        placeholder={t('shop.shipping.max_ph')}
                        aria-label={t('shop.shipping.max_subtotal')}
                      />
                    </div>
                    <div className="flex justify-end mt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy}
                        onClick={() => handleCreateRate(zone.id)}
                      >
                        <Icon as={Plus} size="sm" /> {t('shop.shipping.add_rate')}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <p className="mt-5 text-[11px] text-[var(--text-muted)]">
          {t('shop.shipping.hint')}
        </p>
      </Card>
    </div>
  );
}
