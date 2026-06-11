// ── Settings — Canaux de vente (Omnicanal) — Sprint E8 M3 ──────────────────
// Onglet Réglages admin (groupe AVANCÉ) : gère les canaux de vente du tenant.
//
//   • Le canal « natif Intralys » est toujours présent implicitement (créé
//     côté M1) et NON supprimable — c'est la source de vérité du stock.
//   • Canaux externes Shopify / WooCommerce : ajout (Modal), OAuth connect
//     (M2 → redirect_url), synchronisation manuelle + journal, suppression.
//   • Sélecteur de STRATÉGIE D'INVENTAIRE par canal (le point « chaque
//     domaine est unique ») : 3 modes avec libellés FR explicatifs + le
//     trade-off de chacun. Le défaut `intralys_master` = comportement
//     actuel, aucun risque (bannière info).
//
// Contrats : CRUD + strategy = M1 (figés). connect / sync / sync-log = M2
// (parallèle, contrat figé) : si pas branché côté worker au runtime →
// dégradation propre (bouton désactivé / état honnête, jamais de crash).
//
// Clone du pattern RegionSettings/PaymentSettings (Card settings-card +
// header + Skeleton + a11y focus-visible/aria + reduced-motion). Stripe
// SUBTLE strict (pas de glow/orb/gradient brand). FR québécois. adminOnly
// (gating Settings.tsx). Aucune donnée fictive.

import { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, Select, Tag, Modal, useToast, useConfirm,
  AutosaveIndicator, Icon, Skeleton, EmptyState,
  type AutosaveState,
} from '@/components/ui';
import {
  getChannels, createChannel, deleteChannel, setChannelStrategy,
  connectChannel, syncChannel, getChannelSyncLog,
  type SalesChannel, type InventoryStrategyKind, type ChannelSyncLog,
  type CreateChannelPayload,
} from '@/lib/api';
import { t, getLocale } from '@/lib/i18n';
import { formatDateTime } from '@/lib/i18n/datetime';
import {
  Store, Plus, Trash2, Link2, RefreshCw, ScrollText, Info,
  CheckCircle2, AlertTriangle, XCircle,
} from 'lucide-react';

// ── Stratégies d'inventaire (libellés FR + trade-off explicite) ──────────────
const STRATEGIES: Array<{ id: InventoryStrategyKind; labelKey: string; descKey: string }> = [
  { id: 'intralys_master', labelKey: 'shop.channel.strategy_master', descKey: 'shop.channel.strategy_master_desc' },
  { id: 'partitioned', labelKey: 'shop.channel.strategy_partitioned', descKey: 'shop.channel.strategy_partitioned_desc' },
  { id: 'shared_pool', labelKey: 'shop.channel.strategy_pool', descKey: 'shop.channel.strategy_pool_desc' },
];

const CHANNEL_TYPE_KEY: Record<SalesChannel['type'], string> = {
  native: 'shop.channel.type_native',
  shopify: 'shop.channel.type_shopify',
  woo: 'shop.channel.type_woo',
};

const SYNC_STATUS_META: Record<
  ChannelSyncLog['status'],
  { variant: 'success' | 'warning' | 'danger'; icon: typeof CheckCircle2; labelKey: string }
> = {
  ok: { variant: 'success', icon: CheckCircle2, labelKey: 'shop.sync.status_ok' },
  conflict: { variant: 'warning', icon: AlertTriangle, labelKey: 'shop.sync.status_conflict' },
  error: { variant: 'danger', icon: XCircle, labelKey: 'shop.sync.status_error' },
};

export function ChannelSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Ajout
  const [addOpen, setAddOpen] = useState(false);
  const [draftType, setDraftType] = useState<'shopify' | 'woo'>('shopify');
  const [draftDomain, setDraftDomain] = useState('');
  const [creating, setCreating] = useState(false);

  // Stratégie (autosave par canal)
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [savingStrategyId, setSavingStrategyId] = useState<string | null>(null);

  // Connect / sync / journal (état par canal)
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logOpenId, setLogOpenId] = useState<string | null>(null);
  const [logRows, setLogRows] = useState<ChannelSyncLog[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logUnavailable, setLogUnavailable] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    getChannels()
      .then((r) => {
        if (r.error || !r.data) {
          setLoadError(true);
          return;
        }
        setLoadError(false);
        setChannels(r.data);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Ajout d'un canal externe ───────────────────────────────────────────────
  const handleCreate = async () => {
    setCreating(true);
    try {
      const payload: CreateChannelPayload = {
        name: draftType === 'shopify' ? 'Shopify' : 'WooCommerce',
        type: draftType,
        shop_domain: draftDomain.trim() || undefined,
      };
      const res = await createChannel(payload);
      if (res.error || !res.data) throw new Error(res.error || 'fail');
      success(t('shop.channel.created'));
      setAddOpen(false);
      setDraftDomain('');
      setDraftType('shopify');
      reload();
    } catch {
      toastError(t('shop.channel.create_error'));
    } finally {
      setCreating(false);
    }
  };

  // ── Suppression (confirm) ─────────────────────────────────────────────────
  const handleDelete = async (ch: SalesChannel) => {
    const ok = await confirm({
      title: t('shop.channel.delete_confirm_title'),
      description: t('shop.channel.delete_confirm_body'),
      confirmLabel: t('shop.channel.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteChannel(ch.id);
      if (res.error || !res.data) throw new Error(res.error || 'fail');
      success(t('shop.channel.deleted'));
      reload();
    } catch {
      toastError(t('shop.channel.delete_error'));
    }
  };

  // ── Connexion OAuth (M2 — dégrade si endpoint absent) ─────────────────────
  const handleConnect = async (ch: SalesChannel) => {
    setBusyId(ch.id);
    try {
      const res = await connectChannel(ch.id);
      if (res.error || !res.data?.redirect_url) throw new Error(res.error || 'fail');
      // Redirige le navigateur vers le consentement OAuth du fournisseur.
      window.location.assign(res.data.redirect_url);
    } catch {
      toastError(t('shop.channel.connect_unavailable'));
    } finally {
      setBusyId(null);
    }
  };

  // ── Synchronisation manuelle (M2 — dégrade si endpoint absent) ────────────
  const handleSync = async (ch: SalesChannel) => {
    setBusyId(ch.id);
    try {
      const res = await syncChannel(ch.id);
      if (res.error || !res.data) throw new Error(res.error || 'fail');
      const { products, orders } = res.data.synced;
      success(t('shop.sync.done', { products, orders }));
    } catch {
      toastError(t('shop.sync.unavailable'));
    } finally {
      setBusyId(null);
    }
  };

  // ── Journal de synchronisation ────────────────────────────────────────────
  const openLog = async (ch: SalesChannel) => {
    setLogOpenId(ch.id);
    setLogRows([]);
    setLogUnavailable(false);
    setLogLoading(true);
    try {
      const res = await getChannelSyncLog(ch.id);
      if (res.error || !res.data) {
        setLogUnavailable(true);
        return;
      }
      setLogRows(res.data);
    } catch {
      setLogUnavailable(true);
    } finally {
      setLogLoading(false);
    }
  };

  // ── Changement de stratégie d'inventaire ──────────────────────────────────
  const handleStrategy = async (ch: SalesChannel, strategy: InventoryStrategyKind) => {
    if (strategy === ch.inventory_strategy) return;
    setSavingStrategyId(ch.id);
    setAutosave('saving');
    // Optimiste : reflète immédiatement, rollback si échec.
    const prev = ch.inventory_strategy;
    setChannels((cs) =>
      cs.map((c) => (c.id === ch.id ? { ...c, inventory_strategy: strategy } : c)),
    );
    try {
      const res = await setChannelStrategy(ch.id, strategy);
      if (res.error || !res.data) throw new Error(res.error || 'fail');
      setAutosave('saved');
      success(t('shop.channel.strategy_saved'));
    } catch {
      setChannels((cs) =>
        cs.map((c) => (c.id === ch.id ? { ...c, inventory_strategy: prev } : c)),
      );
      setAutosave('error');
      toastError(t('shop.channel.strategy_error'));
    } finally {
      setSavingStrategyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="settings-card p-6 space-y-4">
          <Skeleton className="h-5 w-44 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
          <div className="space-y-3 pt-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        </Card>
      </div>
    );
  }

  const externalChannels = channels.filter((c) => c.type !== 'native');

  return (
    <div className="space-y-6 animate-stagger">
      <Card className="settings-card p-6 form-section-s4">
        <header className="settings-section-header settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Store} size={16} className="text-[var(--primary)]" />
              {t('shop.channel.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">
              {t('shop.channel.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AutosaveIndicator state={autosave} />
            <Button onClick={() => setAddOpen(true)}>
              <Icon as={Plus} size={14} aria-hidden />
              {t('shop.channel.add')}
            </Button>
          </div>
        </header>

        {/* Bannière info : défaut Intralys-maître = comportement actuel. */}
        <div
          role="note"
          className="mt-5 rounded-[var(--radius-md)] p-4 flex gap-3"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-full shrink-0"
            style={{ background: 'rgba(0,157,219,0.10)', color: 'var(--primary)' }}
          >
            <Icon as={Info} size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">
              {t('shop.channel.banner_title')}
            </p>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
              {t('shop.channel.banner_body')}
            </p>
          </div>
        </div>

        {loadError && (
          <p className="mt-4 text-[12px] text-[var(--text-muted)]">
            {t('shop.channel.load_error')}
          </p>
        )}

        {/* Liste des canaux */}
        <div className="mt-6 flex flex-col gap-4">
          {channels.map((ch) => {
            const isNative = ch.type === 'native';
            const busy = busyId === ch.id;
            return (
              <div
                key={ch.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                {/* Ligne titre + statut */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {ch.name}
                      </p>
                      <Tag size="sm" variant="neutral">
                        {t(CHANNEL_TYPE_KEY[ch.type])}
                      </Tag>
                      <Tag size="sm" variant={ch.active ? 'success' : 'neutral'} dot>
                        {ch.active
                          ? t('shop.channel.status_active')
                          : t('shop.channel.status_inactive')}
                      </Tag>
                      {isNative && (
                        <Tag size="sm" variant="brand">
                          {t('shop.channel.native_badge')}
                        </Tag>
                      )}
                    </div>
                    {ch.shop_domain && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate">
                        {ch.shop_domain}
                      </p>
                    )}
                  </div>

                  {/* Actions canal externe */}
                  {!isNative && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-action-ghost-s1"
                        onClick={() => void handleConnect(ch)}
                        disabled={busy}
                        aria-label={t('shop.channel.connect')}
                      >
                        <Icon as={Link2} size={13} aria-hidden />
                        {t('shop.channel.connect')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-action-ghost-s1"
                        onClick={() => void handleDelete(ch)}
                        aria-label={t('shop.channel.delete')}
                      >
                        <Icon as={Trash2} size={13} aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Sélecteur de stratégie d'inventaire */}
                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                  <label
                    htmlFor={`strategy-${ch.id}`}
                    className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
                  >
                    {t('shop.channel.strategy_label')}
                  </label>
                  <Select
                    id={`strategy-${ch.id}`}
                    value={ch.inventory_strategy}
                    disabled={savingStrategyId === ch.id}
                    onChange={(e: any) =>
                      void handleStrategy(ch, e.target.value as InventoryStrategyKind)}
                    aria-label={t('shop.channel.strategy_label')}
                  >
                    {STRATEGIES.map((s) => (
                      <option key={s.id} value={s.id}>{t(s.labelKey)}</option>
                    ))}
                  </Select>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
                    {t(
                      STRATEGIES.find((s) => s.id === ch.inventory_strategy)?.descKey
                        || 'shop.channel.strategy_master_desc',
                    )}
                  </p>
                </div>

                {/* État de synchronisation (canaux externes seulement) */}
                {!isNative && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center gap-2 flex-wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleSync(ch)}
                      disabled={busy}
                    >
                      <Icon as={RefreshCw} size={13} aria-hidden />
                      {t('shop.sync.now')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="btn-action-ghost-s1"
                      onClick={() => void openLog(ch)}
                    >
                      <Icon as={ScrollText} size={13} aria-hidden />
                      {t('shop.sync.log')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {/* EmptyState honnête : aucun canal externe encore connecté. */}
          {externalChannels.length === 0 && !loadError && (
            <EmptyState
              variant="compact"
              icon={<Icon as={Store} size={40} />}
              title={t('shop.channel.empty_title')}
              description={t('shop.channel.empty_body')}
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <Icon as={Plus} size={14} aria-hidden />
                  {t('shop.channel.add')}
                </Button>
              }
            />
          )}
        </div>
      </Card>

      {/* ── Modal : ajouter un canal externe ──────────────────────────────── */}
      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t('shop.channel.add_title')}
        description={t('shop.channel.add_subtitle')}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="new-channel-type"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
            >
              {t('shop.channel.add_type')}
            </label>
            <Select
              id="new-channel-type"
              value={draftType}
              onChange={(e: any) => setDraftType(e.target.value as 'shopify' | 'woo')}
              aria-label={t('shop.channel.add_type')}
            >
              <option value="shopify">{t('shop.channel.type_shopify')}</option>
              <option value="woo">{t('shop.channel.type_woo')}</option>
            </Select>
          </div>
          <div>
            <label
              htmlFor="new-channel-domain"
              className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5"
            >
              {t('shop.channel.add_domain')}
            </label>
            <input
              id="new-channel-domain"
              type="text"
              value={draftDomain}
              onChange={(e) => setDraftDomain(e.target.value)}
              placeholder={
                draftType === 'shopify' ? 'ma-boutique.myshopify.com' : 'ma-boutique.com'
              }
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              aria-label={t('shop.channel.add_domain')}
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              {t('shop.channel.add_domain_hint')}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={creating}>
              {t('shop.channel.cancel')}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? t('shop.channel.creating') : t('shop.channel.create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal : journal de synchronisation ───────────────────────────── */}
      <Modal
        open={logOpenId !== null}
        onOpenChange={(o) => { if (!o) setLogOpenId(null); }}
        title={t('shop.sync.log_title')}
        description={t('shop.sync.log_subtitle')}
        size="md"
      >
        {logLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : logUnavailable ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={ScrollText} size={40} />}
            title={t('shop.sync.unavailable_title')}
            description={t('shop.sync.unavailable_body')}
          />
        ) : logRows.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={ScrollText} size={40} />}
            title={t('shop.sync.empty_title')}
            description={t('shop.sync.empty_body')}
          />
        ) : (
          <ul className="space-y-2">
            {logRows.map((row) => {
              const meta = SYNC_STATUS_META[row.status];
              return (
                <li
                  key={row.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Tag size="sm" variant={meta.variant} dot>
                          <Icon as={meta.icon} size={11} aria-hidden />
                          {t(meta.labelKey)}
                        </Tag>
                        <span className="text-[12px] font-medium text-[var(--text-primary)]">
                          {row.entity}
                        </span>
                        <Tag size="sm" variant="neutral">
                          {row.direction === 'in'
                            ? t('shop.sync.dir_in')
                            : t('shop.sync.dir_out')}
                        </Tag>
                      </div>
                      {(row.conflict || row.message) && (
                        <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                          {row.conflict || row.message}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0 whitespace-nowrap">
                      {formatDateTime(row.created_at, getLocale())}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </div>
  );
}
