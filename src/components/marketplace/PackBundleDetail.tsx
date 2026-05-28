// ── PackBundleDetail — détail LISIBLE pack métier / bundle produit + install ──
//
// Composant 100% ADDITIF (LOT « surface pack/bundle detail »). Rend, dans
// l'onglet « Packs & bundles » de Marketplace.tsx, le détail d'une de deux
// entités jusqu'ici non surfacées côté UI :
//   - mode='pack'   → getPackDetail(slug)  : IndustryPack + snapshot (objet).
//                     Action Installer (confirm) → installPack(slug, clientId).
//   - mode='bundle' → getBundle(bundleId)  : ProductBundle (lecture seule —
//                     aucun helper d'install bundle n'existe côté api.ts).
//
// Contrat : api.ts FIGÉ (signatures consommées telles quelles). i18n via clés
// NEUVES `mktx.*` (le préfixe existant `marketplace.*` reste réutilisé pour les
// libellés communs install/installed/empty/free). UX : aria-busy (loading),
// EmptyState (vide), role="alert" (erreur + retry), confirm avant install.

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Tag,
  Icon,
  Skeleton,
  EmptyState,
  useToast,
  useConfirm,
} from '@/components/ui';
import { ArrowLeft, Download, PackageCheck, Boxes, Package } from 'lucide-react';
import {
  getPackDetail,
  installPack,
  getBundle,
  type IndustryPack,
  type ProductBundle,
} from '@/lib/api';
import { t } from '@/lib/i18n';

type PackDetail = IndustryPack & { snapshot: Record<string, unknown> };

export interface PackBundleDetailProps {
  /** Discriminant : pack métier (install) ou bundle produit (lecture seule). */
  mode: 'pack' | 'bundle';
  /** Pour mode='pack' : slug du pack. Pour mode='bundle' : id du bundle. */
  id: string;
  /** Client cible de l'installation (mode='pack' uniquement). */
  clientId: string;
  /** Retour à la liste. */
  onBack: () => void;
}

// Résumé LISIBLE d'un snapshot de pack (jamais le JSON brut). Compte les
// collections plausibles sans planter sur une forme backend non figée.
function snapshotSummary(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const countOf = (key: string): number =>
    Array.isArray(snapshot[key]) ? (snapshot[key] as unknown[]).length : 0;
  const parts: string[] = [];
  const cf = countOf('custom_fields');
  const wf = countOf('workflows');
  const tpl = countOf('templates');
  const sl = countOf('smart_lists');
  if (cf) parts.push(`${cf} ${t('mktx.pack.custom_fields')}`);
  if (wf) parts.push(`${wf} ${t('mktx.pack.workflows')}`);
  if (tpl) parts.push(`${tpl} ${t('mktx.pack.templates')}`);
  if (sl) parts.push(`${sl} ${t('mktx.pack.smart_lists')}`);
  return parts.length ? parts.join(' · ') : null;
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(
    cents / 100,
  );
}

export function PackBundleDetail({ mode, id, clientId, onBack }: PackBundleDetailProps) {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [pack, setPack] = useState<PackDetail | null>(null);
  const [bundle, setBundle] = useState<ProductBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPack(null);
    setBundle(null);
    if (mode === 'pack') {
      const res = await getPackDetail(id);
      if (res.data) setPack(res.data);
      else if (res.error) setError(res.error);
    } else {
      const res = await getBundle(id);
      if (res.data) setBundle(res.data);
      else if (res.error) setError(res.error);
    }
    setLoading(false);
  }, [mode, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInstall = useCallback(async () => {
    if (!pack) return;
    const ok = await confirm({
      title: t('mktx.pack.install_confirm_title'),
      description: t('mktx.pack.install_confirm_desc').replace('{name}', pack.name),
      confirmLabel: t('marketplace.install'),
    });
    if (!ok) return;
    setInstalling(true);
    const res = await installPack(pack.slug, clientId);
    setInstalling(false);
    if (res.data) {
      setInstalled(true);
      success(res.data.message || t('marketplace.installed'));
    } else {
      toastError(res.error || t('mktx.pack.install_error'));
    }
  }, [pack, clientId, confirm, success, toastError]);

  const backBtn = (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={<Icon as={ArrowLeft} size="sm" />}
      onClick={onBack}
      aria-label={t('mktx.detail.back')}
    >
      {t('mktx.detail.back')}
    </Button>
  );

  // ── Erreur (retry) ──
  if (error && !loading) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <div>{backBtn}</div>
        <Card
          role="alert"
          aria-live="polite"
          className="p-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <span className="text-sm">{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('action.retry')}
          </Button>
        </Card>
      </div>
    );
  }

  // ── Chargement ──
  if (loading) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl" aria-busy="true" aria-live="polite">
        <div>{backBtn}</div>
        <Card className="p-6">
          <Skeleton className="h-6 w-1/2 mb-3" />
          <Skeleton className="h-3 w-1/3 mb-4" />
          <Skeleton className="h-20 w-full" />
        </Card>
      </div>
    );
  }

  // ── Détail PACK ──
  if (mode === 'pack') {
    if (!pack) {
      return (
        <div className="flex flex-col gap-4 max-w-3xl">
          <div>{backBtn}</div>
          <EmptyState icon={<Icon as={Boxes} size={40} />} title={t('mktx.empty')} />
        </div>
      );
    }
    const summary = snapshotSummary(pack.snapshot);
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <div>{backBtn}</div>
        <Card className="p-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Icon as={Boxes} size="md" className="text-muted" />
                <h2 className="t-h2">{pack.name}</h2>
                <Tag variant="info" size="sm">
                  {t('mktx.pack.tag')}
                </Tag>
              </div>
              {pack.industries ? (
                <span className="text-sm text-muted">{pack.industries}</span>
              ) : null}
            </div>
            <Button
              variant={installed ? 'secondary' : 'primary'}
              isLoading={installing}
              disabled={installed}
              leftIcon={<Icon as={installed ? PackageCheck : Download} size="sm" />}
              onClick={() => void handleInstall()}
            >
              {installed ? t('marketplace.installed') : t('marketplace.install')}
            </Button>
          </div>

          {pack.description ? (
            <p className="text-sm text-muted whitespace-pre-wrap">{pack.description}</p>
          ) : null}

          {summary ? (
            <div className="mk-structure flex items-center gap-2">
              <Icon as={Package} size="sm" className="text-muted" />
              <span className="text-sm">{summary}</span>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('mktx.pack.no_preview')}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Tag variant="success" size="sm">
              {t('marketplace.free')}
            </Tag>
          </div>
        </Card>
      </div>
    );
  }

  // ── Détail BUNDLE (lecture seule) ──
  if (!bundle) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <div>{backBtn}</div>
        <EmptyState icon={<Icon as={Package} size={40} />} title={t('mktx.empty')} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>{backBtn}</div>
      <Card className="p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Icon as={Package} size="md" className="text-muted" />
          <h2 className="t-h2">{bundle.name}</h2>
          <Tag variant="brand" size="sm">
            {t('mktx.bundle.tag')}
          </Tag>
          <Tag variant={bundle.is_active ? 'success' : 'neutral'} size="sm" statusIcon>
            {bundle.is_active ? t('mktx.bundle.active') : t('mktx.bundle.inactive')}
          </Tag>
        </div>
        {bundle.description ? (
          <p className="text-sm text-muted whitespace-pre-wrap">{bundle.description}</p>
        ) : null}
        <dl className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <dt className="text-xs text-muted">{t('mktx.bundle.price')}</dt>
            <dd className="text-sm tabular-nums">{fmtPrice(bundle.total_price_cents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('mktx.bundle.discount')}</dt>
            <dd className="text-sm tabular-nums">{bundle.discount_pct}%</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
