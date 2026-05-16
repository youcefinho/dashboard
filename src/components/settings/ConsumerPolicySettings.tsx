// ── Settings — Conformité consommateur — Sprint E6 M3.3 ─────────────────────
// ⚠️ ZONE RÉGULÉE — revue Rochdi/juriste requise. Affiche la POLITIQUE CONSO
// INDICATIVE (fenêtres de rétractation + mentions) résolue côté serveur à
// partir des `legal_flags` du tenant (Région & devise — E-R). Lecture seule
// ici : les drapeaux se règlent dans « Région & devise » ; cet onglet expose
// la politique INDICATIVE qui en découle (paramétrable serveur), avec une
// bannière claire « configuration indicative — revue légale requise avant
// activation ». NE constitue PAS un avis juridique.
//
// Clone du pattern RegionSettings (Card settings-card + header + Skeleton +
// a11y + FR québécois + Stripe SUBTLE). adminOnly (gating Settings.tsx).
// Réutilise getEcommerceRegion (helper E-R api.ts) — aucun nouvel endpoint.

import { useEffect, useState } from 'react';
import {
  Card, Icon, Skeleton, useToast,
} from '@/components/ui';
import { getEcommerceRegion, type RegionConfig } from '@/lib/api';
import { t } from '@/lib/i18n';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

// Référence INDICATIVE miroir du référentiel serveur (ecommerce-consumer-
// policy.ts POLICY_BY_FLAG). Affichage documentaire uniquement — la valeur
// effective appliquée à une commande vient de handleGetOrderPolicy (serveur).
// ⚠️ ZONE RÉGULÉE — revue Rochdi requise avant activation commerciale.
const INDICATIVE_REF: Array<{
  flagKey: 'loi25' | 'rgpd' | 'casl' | 'conso_dz';
  labelKey: string;
  windowDays: number;
}> = [
  { flagKey: 'loi25', labelKey: 'shop.consumer.flag_loi25', windowDays: 0 },
  { flagKey: 'rgpd', labelKey: 'shop.consumer.flag_rgpd', windowDays: 14 },
  { flagKey: 'casl', labelKey: 'shop.consumer.flag_casl', windowDays: 0 },
  { flagKey: 'conso_dz', labelKey: 'shop.consumer.flag_conso_dz', windowDays: 7 },
];

export function ConsumerPolicySettings() {
  const { error: toastError } = useToast();
  const [config, setConfig] = useState<RegionConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEcommerceRegion()
      .then((r) => {
        if (cancelled) return;
        if (r.data) setConfig(r.data);
      })
      .catch(() => {
        if (!cancelled) toastError(t('shop.consumer.load_error'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="settings-card p-6 space-y-4">
          <Skeleton className="h-5 w-52 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </Card>
      </div>
    );
  }

  const flags = config?.legal_flags || {};
  const flagVal = (k: 'loi25' | 'rgpd' | 'casl' | 'conso_dz'): boolean =>
    Boolean((flags as Record<string, unknown>)[k]);

  return (
    <div className="space-y-6">
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={ShieldCheck} size={16} className="text-[var(--primary)]" />
              {t('shop.consumer.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('shop.consumer.subtitle')}
            </p>
          </div>
        </header>

        {/* ⚠️ Bannière régulé — non négociable */}
        <div
          className="mt-5 flex items-start gap-2 rounded-[var(--radius-md)] border p-3"
          style={{
            borderColor: 'var(--warning, #b45309)',
            background: 'color-mix(in srgb, var(--warning, #b45309) 8%, transparent)',
          }}
          role="note"
        >
          <Icon
            as={AlertTriangle}
            size="sm"
            style={{ color: 'var(--warning, #b45309)' }}
            className="mt-0.5 shrink-0"
          />
          <p className="text-[12px] font-medium" style={{ color: 'var(--warning, #b45309)' }}>
            {t('shop.consumer.banner')}
          </p>
        </div>

        {/* Drapeaux légaux actifs (lecture — réglés dans Région & devise) */}
        <div className="mt-6 pt-5 border-t border-[var(--border-subtle)]">
          <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t('shop.consumer.flags_title')}
          </h4>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 mb-3">
            {t('shop.consumer.readonly_hint')}
          </p>

          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)] text-left">
                  <th className="px-3 py-2 font-semibold text-[var(--text-secondary)]">
                    {t('shop.consumer.flags_title')}
                  </th>
                  <th className="px-3 py-2 font-semibold text-[var(--text-secondary)] text-right">
                    {t('shop.consumer.window_label')}
                  </th>
                  <th className="px-3 py-2 font-semibold text-[var(--text-secondary)] text-right">
                    {t('shop.policy.region')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {INDICATIVE_REF.map((row) => {
                  const active = flagVal(row.flagKey);
                  return (
                    <tr
                      key={row.flagKey}
                      className="border-t border-[var(--border-subtle)]"
                      style={{ opacity: active ? 1 : 0.55 }}
                    >
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{
                              background: active
                                ? 'var(--primary)'
                                : 'var(--border-strong, #cbd5e1)',
                            }}
                            aria-hidden
                          />
                          {t(row.labelKey)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right t-mono-num">
                        {row.windowDays > 0
                          ? t('shop.policy.window_days').replace(
                              '{n}', String(row.windowDays),
                            )
                          : t('shop.policy.no_window')}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--text-muted)]">
                        {active ? (config?.region || '—') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-[var(--text-muted)] mt-3">
            {t('shop.policy.banner')}
          </p>
        </div>
      </Card>
    </div>
  );
}
